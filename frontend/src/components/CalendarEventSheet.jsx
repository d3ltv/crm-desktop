import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    CalendarClock,
    X,
    Phone,
    Mail,
    User,
    MapPin,
    ExternalLink,
    Sparkles,
    Pencil,
    MessageSquare,
    Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/context/CrmContext";
import {
    ensureWeekday,
    toLocalDateKey,
    formatDateTimeLong,
} from "@/lib/dateUtils";
import {
    isManualRdv,
    makeRdvNextAction,
    makeCalendarReminder,
} from "@/lib/nextActionUtils";
import { clearLeadSchedule, scheduleLeadNextAction } from "@/lib/scheduleLead";
import { openLeadFromCalendar, CALENDAR_EVENT_META } from "@/lib/calendarEvents";
import { extractLeadBrief, pickBriefSituation, briefLinkLabel, jobOfferLinkClass, jobOfferUnderlineClass } from "@/lib/panelSections";
import { parseNote, detectAppointment } from "@/lib/noteParser";
import { isMeetingColumn } from "@/constants/columnPatterns";
import { getColumnColor } from "@/lib/columnColors";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { AgencySuspectBadge, AGENCY_NAME_CLS } from "./AgencySuspectBadge";
import { VoiceMicButton } from "./VoiceMicButton";
import { saveCallRecording } from "@/lib/callRecordings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function copyBriefValue(value, label) {
    const text = String(value || "").trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(
        () => toast.success(`${label} copié`, { description: text }),
        () => toast.error("Impossible de copier")
    );
}

function toDateInputValue(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate || Date.now());
    if (Number.isNaN(d.getTime())) return toLocalDateKey(new Date());
    return toLocalDateKey(d);
}

function toTimeInputValue(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate || Date.now());
    if (Number.isNaN(d.getTime())) return "09:00";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function snapAwayFromSunday(dateStr) {
    if (!dateStr) return dateStr;
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    if (d.getDay() === 0) {
        d.setDate(d.getDate() + 1);
        toast.message("Dimanche évité", { description: "Créneau décalé au lundi." });
        return toLocalDateKey(d);
    }
    return dateStr;
}

/** Caractère de frontière après un `@Colonne` (espace, ponctuation, puce…). */
function isMentionBoundaryChar(ch) {
    if (ch == null || ch === "") return true;
    // Lettres / chiffres → encore en train de taper le nom
    return !/[0-9A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch);
}

/**
 * Détecte une saisie `@…` en cours sous le curseur (autocomplétion).
 * Ferme le menu dès qu’une colonne connue est complète et qu’on écrit après.
 */
function extractAtQuery(text, cursor, columns = []) {
    const before = String(text || "").slice(0, cursor ?? String(text || "").length);
    const atIdx = before.lastIndexOf("@");
    if (atIdx < 0) return null;
    // Évite les emails (x@y)
    if (atIdx > 0 && /[0-9A-Za-z._%]/.test(before[atIdx - 1])) return null;

    const query = before.slice(atIdx + 1);
    if (query.includes("\n") || query.length > 48) return null;

    const sorted = [...(columns || [])]
        .filter((c) => c?.name)
        .sort((a, b) => b.name.length - a.name.length);

    for (const col of sorted) {
        const name = col.name;
        if (!query.toLowerCase().startsWith(name.toLowerCase())) continue;
        const nextCh = query[name.length];
        // `@Colonne` complet + caractère après → plus en mode saisie @
        if (nextCh != null && isMentionBoundaryChar(nextCh)) return null;
    }

    return { query, start: atIdx, end: before.length };
}

/**
 * Découpe le texte pour colorer / résoudre les `@Colonne` validées.
 * @returns {{ type: 'text'|'mention', value: string, column?: object }[]}
 */
function tokenizeColumnMentions(text, columns) {
    if (!text) return [];
    const sorted = [...(columns || [])]
        .filter((c) => c?.name)
        .sort((a, b) => b.name.length - a.name.length);
    if (!sorted.length) return [{ type: "text", value: text }];

    const parts = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === "@") {
            const rest = text.slice(i + 1);
            let hit = null;
            for (const col of sorted) {
                const name = col.name;
                if (!rest.toLowerCase().startsWith(name.toLowerCase())) continue;
                const nextCh = rest[name.length];
                if (isMentionBoundaryChar(nextCh)) {
                    hit = col;
                    break;
                }
            }
            if (hit) {
                parts.push({ type: "mention", value: `@${hit.name}`, column: hit });
                i += hit.name.length + 1;
                continue;
            }
        }
        const nextAt = text.indexOf("@", i + 1);
        const end = nextAt === -1 ? text.length : nextAt;
        parts.push({ type: "text", value: text.slice(i, end) });
        i = end;
    }
    return parts;
}

/** Première `@Colonne` reconnue dans le texte (nom exact vs colonnes du workspace). */
function findMentionInText(text, columns) {
    const tokens = tokenizeColumnMentions(text, columns);
    let pos = 0;
    for (const tok of tokens) {
        if (tok.type === "mention" && tok.column) {
            return {
                column: tok.column,
                raw: tok.value,
                start: pos,
                end: pos + tok.value.length,
            };
        }
        pos += tok.value.length;
    }
    return null;
}

/** Retire les `@Colonne` du texte note, sans toucher au reste (date, contact…). */
function stripColumnMentions(text, columns) {
    return tokenizeColumnMentions(text, columns)
        .filter((t) => t.type !== "mention")
        .map((t) => t.value)
        .join("")
        .replace(/\s*[·•|/]\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

/**
 * Fenêtre légère calendrier : infos pertinentes + note intelligente + RDV.
 */
export function CalendarEventSheet({ open, event, onClose }) {
    const { state, dispatch } = useCrm();
    const workspace = event ? state.workspaces[event.workspaceId] : null;
    const lead = workspace?.leads?.[event?.leadId] || null;
    const noteRef = useRef(null);
    const highlightRef = useRef(null);
    const scheduleDirtyRef = useRef(false);
    const appliedIsoRef = useRef(null);

    const [date, setDate] = useState("");
    const [time, setTime] = useState("09:00");
    const [note, setNote] = useState("");
    const [editingSchedule, setEditingSchedule] = useState(false);
    const [atMenu, setAtMenu] = useState(null); // { query, start, end }
    const [pendingMeetingCol, setPendingMeetingCol] = useState(null);
    const [pendingRecording, setPendingRecording] = useState(null);
    const [recordingBusy, setRecordingBusy] = useState(false);
    const [micKey, setMicKey] = useState(0);
    const [applying, setApplying] = useState(false);

    const columnName = workspace?.columns?.[lead?.columnId]?.name || "";
    const brief = useMemo(
        () => (lead ? extractLeadBrief(lead, { columnName }) : null),
        [lead, columnName]
    );

    const agencySuspect = useMemo(
        () => (lead ? getAgencySuspicion(lead, isAgencyDetectionEnabled(workspace)) : null),
        [lead, workspace]
    );

    const columns = useMemo(
        () => (workspace?.columnOrder || []).map((id) => workspace.columns[id]).filter(Boolean),
        [workspace]
    );

    const atSuggestions = useMemo(() => {
        if (!atMenu) return [];
        const q = atMenu.query.toLowerCase();
        return columns.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 8);
    }, [atMenu, columns]);

    const noteTokens = useMemo(
        () => tokenizeColumnMentions(note, columns),
        [note, columns]
    );
    const hasColoredMention = noteTokens.some((t) => t.type === "mention");

    const liveDetect = useMemo(() => {
        if (!note.trim()) return { appointment: null, persons: [], column: null };
        const appointment = detectAppointment(note);
        const { persons } = parseNote(note);
        const mention = findMentionInText(note, columns);
        return { appointment, persons: persons || [], column: mention?.column || null };
    }, [note, columns]);

    // Note → champs date/heure : une seule fois, jamais si l'utilisateur a corrigé à la main
    useEffect(() => {
        if (!open || !liveDetect.appointment?.iso) return;
        if (scheduleDirtyRef.current) return;
        if (appliedIsoRef.current === liveDetect.appointment.iso) return;
        const d = new Date(liveDetect.appointment.iso);
        if (Number.isNaN(d.getTime())) return;
        appliedIsoRef.current = liveDetect.appointment.iso;
        setDate(toDateInputValue(d));
        if (liveDetect.appointment.hasTime) {
            setTime(toTimeInputValue(d));
        }
        setEditingSchedule(true);
    }, [open, liveDetect.appointment?.iso, liveDetect.appointment?.hasTime]);

    useEffect(() => {
        if (!open || !event) return;
        const due = event.dueAt || lead?.nextAction?.dueAt || lead?.nextAction?.date;
        scheduleDirtyRef.current = false;
        appliedIsoRef.current = null;
        setDate(toDateInputValue(due));
        setTime(toTimeInputValue(due));
        setNote("");
        setEditingSchedule(false);
        setAtMenu(null);
        setPendingMeetingCol(null);
        setPendingRecording(null);
        setRecordingBusy(false);
        setApplying(false);
        setMicKey((k) => k + 1);
    }, [open, event?.id, event?.dueAt, lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === "Escape") {
                if (atMenu) setAtMenu(null);
                else onClose?.();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose, atMenu]);

    const meta = useMemo(
        () => CALENDAR_EVENT_META[event?.type] || CALENDAR_EVENT_META.rappel,
        [event?.type]
    );

    if (!open || !event || !lead || !workspace || !brief) return null;

    const isRdv = event.type === "rdv" || isManualRdv(lead.nextAction);
    const hasBrief = brief.hasBrief;
    const { primary: situationPrimary, secondaryLine: situationSecondary } = pickBriefSituation(
        brief.situation || []
    );
    const latestNote = (brief.contextualNotes || [])[0] || null;

    const buildDueFromInputs = () => {
        const safeDate = snapAwayFromSunday(date);
        const raw = new Date(`${safeDate}T${time || "09:00"}:00`);
        if (Number.isNaN(raw.getTime())) return null;
        return ensureWeekday(raw);
    };

    const applyScheduleDue = (due, { asRdv = isRdv, closeAfter = true } = {}) => {
        if (!due) return false;
        const dateKey = toLocalDateKey(due);
        const dueAt = due.toISOString();
        const existing = lead.nextAction;
        let nextAction;
        if (asRdv) {
            nextAction = makeRdvNextAction({ date: dateKey, dueAt, label: existing?.label });
        } else if (existing?.auto) {
            nextAction = {
                ...existing,
                date: dateKey,
                dueAt,
                label: existing.label || `Rappel · ${formatDateTimeLong(dueAt)}`,
            };
        } else {
            nextAction = makeCalendarReminder({
                date: dateKey,
                dueAt,
                label: (existing?.label || "").replace(/^📅\s*Rappel\s*[·—-]?\s*/i, "") || lead.company,
            });
        }
        const patch = { nextAction };
        if (lead.autoFollowup) {
            patch.autoFollowup = { ...lead.autoFollowup, dueAt, overdue: false };
        }
        dispatch({ type: "UPDATE_LEAD", workspaceId: workspace.id, leadId: lead.id, patch });
        if (asRdv) {
            scheduleLeadNextAction(dispatch, {
                workspace,
                leadId: lead.id,
                nextAction,
                move: true,
            });
        }
        if (closeAfter) {
            toast.success(asRdv ? "RDV mis à jour" : "Rappel mis à jour", {
                description: formatDateTimeLong(dueAt),
            });
            onClose?.();
        }
        return true;
    };

    const saveSchedule = () => {
        const due = buildDueFromInputs();
        if (!due) {
            toast.error("Date ou heure invalide");
            return;
        }
        if (pendingMeetingCol) {
            dispatch({
                type: "MOVE_LEAD",
                workspaceId: workspace.id,
                leadId: lead.id,
                toColumnId: pendingMeetingCol.id,
            });
            applyScheduleDue(due, { asRdv: true, closeAfter: true });
            setPendingMeetingCol(null);
            return;
        }
        applyScheduleDue(due, { asRdv: isRdv || pendingMeetingCol, closeAfter: true });
    };

    const insertColumnMention = (col) => {
        if (!atMenu || !col) return;
        const before = note.slice(0, atMenu.start);
        const after = note.slice(atMenu.end);
        const inserted = `@${col.name}`;
        const spacer = after && !/^\s/.test(after) ? " " : "";
        const next = `${before}${inserted}${spacer}${after}`;
        setNote(next);
        setAtMenu(null);
        // Mémorise l'intention RDV sans ouvrir le picker tout de suite —
        // laisse taper « demain 14h » dans la même note.
        if (isMeetingColumn(col.name) && !detectAppointment(next)) {
            setPendingMeetingCol(col);
        } else if (!isMeetingColumn(col.name)) {
            setPendingMeetingCol(null);
        }
        requestAnimationFrame(() => {
            const el = noteRef.current;
            if (!el) return;
            el.focus();
            const pos = before.length + inserted.length + spacer.length;
            el.setSelectionRange(pos, pos);
        });
    };

    const syncHighlightScroll = () => {
        const src = noteRef.current;
        const dst = highlightRef.current;
        if (src && dst) dst.scrollTop = src.scrollTop;
    };

    const onNoteChange = (e) => {
        const val = e.target.value;
        const cursor = e.target.selectionStart ?? val.length;
        setNote(val);
        setAtMenu(extractAtQuery(val, cursor, columns));

        const mention = findMentionInText(val, columns);
        if (mention && isMeetingColumn(mention.column.name)) {
            setPendingMeetingCol(mention.column);
        } else {
            setPendingMeetingCol(null);
        }
    };

    const applySmartNote = async () => {
        if (applying || recordingBusy) return;
        const raw = note.trim();
        if (!raw && !pendingMeetingCol && !pendingRecording?.blob) return;

        setApplying(true);
        let recordingId = null;
        if (pendingRecording?.blob) {
            try {
                recordingId = `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                await saveCallRecording({
                    id: recordingId,
                    leadId: lead.id,
                    workspaceId: workspace.id,
                    blob: pendingRecording.blob,
                    mimeType: pendingRecording.mimeType,
                    durationMs: pendingRecording.durationMs,
                    peaks: pendingRecording.peaks,
                });
            } catch (err) {
                console.warn("[CalendarNote] save recording failed:", err);
                toast.error("Audio non sauvegardé");
                recordingId = null;
            }
        }

        const appointment = detectAppointment(raw);
        const detected = parseNote(raw);
        const mention = findMentionInText(raw, columns);
        // La mention dans le texte prime ; pending couvre le cas « @RDV » seul
        const targetCol = mention?.column || pendingMeetingCol || null;

        // Note affichée sans le @Colonne (date / contact / rappel restent)
        let noteText = stripColumnMentions(raw, columns);
        if (!noteText && targetCol) {
            noteText = `Déplacé vers « ${targetCol.name} »`;
        }
        // Vocal = Joint
        if (recordingId) {
            noteText = noteText
                ? (/^📞|^📵/.test(noteText) ? noteText : `📞 Joint · ${noteText}`)
                : "📞 Joint · Note d'appel";
        }

        if (noteText) {
            if (recordingId) {
                dispatch({
                    type: "LOG_CONTACT",
                    workspaceId: workspace.id,
                    leadId: lead.id,
                    text: noteText,
                    recordingId,
                });
            } else {
                dispatch({
                    type: "ADD_NOTE",
                    workspaceId: workspace.id,
                    leadId: lead.id,
                    text: noteText,
                });
            }
        }

        const patch = {};
        const person = (detected.persons || [])[0];
        if (person && !(lead.contact || "").trim()) {
            patch.contact = person;
        }
        if (detected.phones?.[0] && !lead.phone) patch.phone = detected.phones[0];
        if (detected.emails?.[0] && !lead.email) patch.email = detected.emails[0];

        // Report / nouveau créneau depuis le texte — compatible avec @Colonne
        if (appointment) {
            const due = ensureWeekday(new Date(appointment.iso));
            const dateKey = toLocalDateKey(due);
            const dueAt = due.toISOString();
            const asMeeting = isRdv || (targetCol && isMeetingColumn(targetCol.name));
            patch.nextAction = asMeeting
                ? makeRdvNextAction({ date: dateKey, dueAt, label: appointment.label })
                : makeCalendarReminder({ date: dateKey, dueAt, label: appointment.label });
            if (lead.autoFollowup) {
                patch.autoFollowup = { ...lead.autoFollowup, dueAt, overdue: false };
            }
        }

        if (Object.keys(patch).length) {
            dispatch({
                type: "UPDATE_LEAD",
                workspaceId: workspace.id,
                leadId: lead.id,
                patch,
            });
        }

        // Colonne RDV sans date dans la note → picker inline
        if (targetCol && isMeetingColumn(targetCol.name) && !appointment) {
            setPendingMeetingCol(targetCol);
            setEditingSchedule(true);
            setNote(noteText || raw);
            setAtMenu(null);
            setPendingRecording(null);
            setMicKey((k) => k + 1);
            setApplying(false);
            toast.message(`RDV requis pour « ${targetCol.name} »`, {
                description: "Indiquez la date ci-dessous ou dans la note (ex. lundi 14h).",
            });
            return;
        }

        if (targetCol && targetCol.id !== lead.columnId) {
            dispatch({
                type: "MOVE_LEAD",
                workspaceId: workspace.id,
                leadId: lead.id,
                toColumnId: targetCol.id,
            });
            if (appointment && patch.nextAction) {
                scheduleLeadNextAction(dispatch, {
                    workspace: {
                        ...workspace,
                        leads: {
                            ...workspace.leads,
                            [lead.id]: { ...lead, ...patch, columnId: targetCol.id },
                        },
                    },
                    leadId: lead.id,
                    nextAction: patch.nextAction,
                    move: false,
                });
            }
        } else if (appointment && patch.nextAction) {
            scheduleLeadNextAction(dispatch, {
                workspace,
                leadId: lead.id,
                nextAction: patch.nextAction,
                move: true,
            });
        }

        const bits = [];
        if (recordingId) bits.push("appel");
        if (noteText) bits.push("note");
        if (person) bits.push(`contact ${person}`);
        if (appointment) bits.push(appointment.label);
        if (targetCol) bits.push(`→ ${targetCol.name}`);
        toast.success("Note intelligente appliquée", {
            description: bits.join(" · ") || undefined,
        });
        setNote("");
        setPendingMeetingCol(null);
        setPendingRecording(null);
        setMicKey((k) => k + 1);
        setAtMenu(null);
        setApplying(false);
        onClose?.();
    };

    const clearSchedule = () => {
        clearLeadSchedule(dispatch, {
            workspaceId: workspace.id,
            leadId: lead.id,
            dismissFollowup: true,
        });
        toast.success("Créneau retiré");
        onClose?.();
    };

    const openFullSheet = () => {
        onClose?.();
        openLeadFromCalendar(dispatch, workspace.id, lead.id);
    };

    return (
        <>
            <div
                className="fixed inset-0 z-[80] bg-foreground/20 backdrop-blur-sm animate-in fade-in duration-150"
                onClick={onClose}
                data-testid="calendar-event-sheet-backdrop"
            />
            <div
                role="dialog"
                aria-modal="true"
                data-testid="calendar-event-sheet"
                className={cn(
                    "fixed z-[90] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,440px)] max-h-[min(90dvh,600px)] bg-card rounded-2xl border border-border shadow-panel animate-in fade-in zoom-in-95 duration-150",
                    // overflow visible quand le menu @ est ouvert (sinon le menu est clippé / inert hors du dialog)
                    atMenu ? "overflow-visible" : "overflow-y-auto"
                )}
            >
                {/* Header compact */}
                <div className="px-3.5 pt-3.5 pb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <CalendarClock size={15} className="text-primary" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                {meta.label}
                                {event.workspaceName ? ` · ${event.workspaceName}` : ""}
                            </p>
                            <div className="flex items-center gap-1.5 min-w-0">
                                <h3
                                    className={cn(
                                        "text-[15px] font-semibold tracking-tight truncate leading-tight",
                                        agencySuspect && AGENCY_NAME_CLS
                                    )}
                                    title={agencySuspect?.label || undefined}
                                >
                                    {lead.company || event.title}
                                </h3>
                                {agencySuspect && (
                                    <AgencySuspectBadge
                                        score={agencySuspect.score}
                                        label={agencySuspect.label}
                                        variant="percent"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fermer"
                        className="w-8 h-8 rounded-full hover:bg-secondary text-muted-foreground flex items-center justify-center shrink-0"
                    >
                        <X size={15} />
                    </button>
                </div>

                <div className="px-3.5 pb-3 space-y-2.5">
                    {/* Infos pertinentes — compact */}
                    {hasBrief && (
                        <div
                            className="rounded-lg border border-border/80 bg-muted/15 px-2.5 py-2 space-y-2"
                            data-testid="calendar-event-pertinent"
                        >
                            <div className="flex items-center gap-1 text-[10px] font-medium text-primary">
                                <Sparkles size={10} strokeWidth={2} className="sparkle-icon shrink-0" />
                                <span>Information pertinente</span>
                            </div>

                            {situationPrimary && (
                                <section className="space-y-0.5" data-testid="calendar-event-situation">
                                    <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Suivi
                                    </p>
                                    <p
                                        className={cn(
                                            "text-[12px] font-semibold leading-snug",
                                            situationPrimary.tone === "ok" && "text-emerald-800 dark:text-emerald-300",
                                            situationPrimary.tone === "warn" && "text-amber-900 dark:text-amber-300",
                                            situationPrimary.tone === "info" && "text-sky-900 dark:text-sky-300",
                                            (!situationPrimary.tone || situationPrimary.tone === "neutral") && "text-foreground"
                                        )}
                                    >
                                        {situationPrimary.label}
                                    </p>
                                    {situationSecondary && (
                                        <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
                                            {situationSecondary}
                                        </p>
                                    )}
                                </section>
                            )}

                            {(brief.annonce || brief.jobTitle || brief.location || brief.contract) && (
                                <section className="space-y-0.5" data-testid="calendar-brief-contexte">
                                    <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Contexte
                                    </p>
                                    {brief.annonce && (
                                        <div className="space-y-0.5">
                                            {String(brief.annonce)
                                                .split(/\s*;\s*/)
                                                .map((part) => part.trim())
                                                .filter(Boolean)
                                                .map((part, i) => (
                                                    <p
                                                        key={`${part}-${i}`}
                                                        className="text-[11px] font-medium leading-snug text-foreground"
                                                    >
                                                        {part}
                                                    </p>
                                                ))}
                                        </div>
                                    )}
                                    {brief.jobTitle && brief.jobTitle !== brief.annonce && (
                                        <div className="space-y-0.5">
                                            {String(brief.jobTitle)
                                                .split(/\s*;\s*/)
                                                .map((part) => part.trim())
                                                .filter(Boolean)
                                                .map((part, i) => (
                                                    <p
                                                        key={`${part}-${i}`}
                                                        className={cn(
                                                            "leading-snug",
                                                            brief.annonce
                                                                ? "text-[10px] text-muted-foreground"
                                                                : "text-[11px] font-medium text-foreground"
                                                        )}
                                                    >
                                                        {part}
                                                    </p>
                                                ))}
                                        </div>
                                    )}
                                    {(brief.location || brief.contract) && (
                                        <p className="text-[11px] text-foreground leading-snug">
                                            {brief.location && (
                                                <span className="inline-flex items-center gap-0.5">
                                                    <MapPin size={10} className="text-muted-foreground" />
                                                    {brief.location}
                                                </span>
                                            )}
                                            {brief.location && brief.contract && (
                                                <span className="text-muted-foreground"> · </span>
                                            )}
                                            {brief.contract && (
                                                <span className="text-muted-foreground">{brief.contract}</span>
                                            )}
                                        </p>
                                    )}
                                </section>
                            )}

                            {latestNote && (
                                <section className="space-y-0.5">
                                    <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Dernière info
                                    </p>
                                    <p className="text-[11px] leading-snug text-muted-foreground italic line-clamp-2 border-l-2 border-border/70 pl-2">
                                        {latestNote.text}
                                    </p>
                                </section>
                            )}

                            {(brief.contact || brief.phone || brief.email) && (
                                <section className="space-y-0.5">
                                    <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Contact
                                    </p>
                                    {brief.contact && (
                                        <p className="text-[12px] font-semibold truncate inline-flex items-center gap-1">
                                            <User size={10} className="text-muted-foreground shrink-0" />
                                            {brief.contact}
                                        </p>
                                    )}
                                    {(brief.phone || brief.email) && (
                                        <div className="flex flex-col gap-0.5 text-[11px]">
                                            {brief.phone && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyBriefValue(brief.phone, "Téléphone");
                                                    }}
                                                    title="Cliquer pour copier"
                                                    className="inline-flex items-center gap-1 tabular-nums text-left hover:text-primary transition-colors"
                                                >
                                                    <Phone size={10} className="text-muted-foreground shrink-0" />
                                                    {brief.phone}
                                                </button>
                                            )}
                                            {brief.email && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyBriefValue(brief.email, "Email");
                                                    }}
                                                    title="Cliquer pour copier"
                                                    className="inline-flex items-center gap-1 truncate text-left hover:text-primary transition-colors"
                                                >
                                                    <Mail size={10} className="text-muted-foreground shrink-0" />
                                                    <span className="truncate">{brief.email}</span>
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}

                            {brief.offerLink && (
                                <a
                                    href={brief.offerLink.href}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className={jobOfferLinkClass(brief.offerLink.source)}
                                    title={brief.offerLink.href}
                                    data-testid="calendar-brief-offer-link"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <span className={jobOfferUnderlineClass(brief.offerLink.source)}>
                                        Voir l&apos;offre
                                    </span>
                                    {" · "}
                                    {brief.offerLink.sourceLabel}
                                </a>
                            )}

                            {brief.links.length > 0 && (
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                    {brief.links.slice(0, 3).map((l) => (
                                        <a
                                            key={l.href}
                                            href={l.href}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="text-[11px] text-primary hover:underline"
                                            title={l.href}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {briefLinkLabel(l)}
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* RDV — crayon */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-medium">
                                {isRdv ? "Modifier le RDV" : "Modifier le rappel"}
                            </p>
                            {!editingSchedule && (
                                <button
                                    type="button"
                                    onClick={() => setEditingSchedule(true)}
                                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/70"
                                    data-testid="calendar-event-edit-schedule"
                                >
                                    <Pencil size={13} />
                                </button>
                            )}
                        </div>
                        {!editingSchedule && (
                            <p className="text-[12px] text-muted-foreground tabular-nums">
                                {date && time ? formatDateTimeLong(`${date}T${time}:00`) : "Aucun créneau"}
                            </p>
                        )}
                        {editingSchedule && (
                            <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/10 p-2">
                                {pendingMeetingCol && (
                                    <p className="text-[11px] text-primary font-medium">
                                        RDV pour « {pendingMeetingCol.name} »
                                    </p>
                                )}
                                <div className="grid grid-cols-2 gap-1.5">
                                    <input
                                        type="date"
                                        value={date}
                                        onChange={(e) => {
                                            scheduleDirtyRef.current = true;
                                            setDate(snapAwayFromSunday(e.target.value));
                                        }}
                                        className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]"
                                        data-testid="calendar-event-date"
                                    />
                                    <input
                                        type="time"
                                        value={time}
                                        onChange={(e) => {
                                            scheduleDirtyRef.current = true;
                                            setTime(e.target.value);
                                        }}
                                        className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]"
                                        data-testid="calendar-event-time"
                                    />
                                </div>
                                <div className="flex gap-1.5">
                                    <Button type="button" className="flex-1 h-8 rounded-full text-[12px]" onClick={saveSchedule}>
                                        Enregistrer
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-8 rounded-full text-[12px]"
                                        onClick={() => {
                                            setEditingSchedule(false);
                                            setPendingMeetingCol(null);
                                        }}
                                    >
                                        Annuler
                                    </Button>
                                    <Button type="button" variant="ghost" className="h-8 rounded-full text-[12px]" onClick={clearSchedule}>
                                        Retirer
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Note intelligente */}
                    <div className="space-y-1.5 pt-1 border-t border-border/50 relative">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-medium inline-flex items-center gap-1.5">
                                <Wand2 size={12} className="text-primary" />
                                Note intelligente
                            </p>
                            <VoiceMicButton
                                key={micKey}
                                onChange={setPendingRecording}
                                onBusyChange={setRecordingBusy}
                                disabled={applying}
                            />
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                            Ex. « reporter lundi 14h », « mr Durand », « @Relance » — @ propose les colonnes.
                        </p>
                        <div className="relative rounded-lg border border-input shadow-sm focus-within:ring-1 focus-within:ring-ring">
                            {/* Calque coloré : @Colonne dans la teinte de la colonne */}
                            {note && hasColoredMention && (
                                <div
                                    ref={highlightRef}
                                    aria-hidden
                                    className="absolute inset-0 overflow-hidden pointer-events-none px-3 py-2 text-[12px] leading-normal whitespace-pre-wrap break-words"
                                    data-testid="calendar-note-highlight"
                                >
                                    {noteTokens.map((tok, idx) => {
                                        if (tok.type !== "mention") {
                                            return (
                                                <span key={idx} className="text-foreground">
                                                    {tok.value}
                                                </span>
                                            );
                                        }
                                        const cc = getColumnColor(tok.column);
                                        return (
                                            <span
                                                key={idx}
                                                className={cn(
                                                    "rounded px-0.5 font-semibold",
                                                    cc.chipBg,
                                                    cc.chipText
                                                )}
                                            >
                                                {tok.value}
                                            </span>
                                        );
                                    })}
                                    {"\n"}
                                </div>
                            )}
                            <Textarea
                                ref={noteRef}
                                value={note}
                                onChange={onNoteChange}
                                onScroll={syncHighlightScroll}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape" && atMenu) {
                                        e.stopPropagation();
                                        setAtMenu(null);
                                        return;
                                    }
                                    if (
                                        atMenu
                                        && atSuggestions.length > 0
                                        && (e.key === "Enter" || e.key === "Tab")
                                        && !e.metaKey
                                        && !e.ctrlKey
                                    ) {
                                        e.preventDefault();
                                        insertColumnMention(atSuggestions[0]);
                                        return;
                                    }
                                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                        e.preventDefault();
                                        applySmartNote();
                                    }
                                }}
                                placeholder="reporter demain 10h · @Rendez-vous · mr Martin…"
                                className={cn(
                                    "min-h-[56px] text-[12px] rounded-lg resize-none border-0 shadow-none focus-visible:ring-0 relative z-[1]",
                                    hasColoredMention
                                        ? "bg-transparent text-transparent caret-foreground"
                                        : "bg-transparent"
                                )}
                                data-testid="calendar-event-note"
                            />
                            {/* Menu @ colonnes — dans le dialog (pas en portal body) pour rester cliquable sous aria-modal */}
                            {atMenu && atSuggestions.length > 0 && (
                                <div
                                    className="absolute left-0 right-0 bottom-[calc(100%+6px)] z-50 rounded-xl border border-border bg-card shadow-xl overflow-y-auto overscroll-contain max-h-[min(240px,40vh)]"
                                    data-testid="calendar-at-columns"
                                    role="listbox"
                                    aria-label="Colonnes"
                                    onMouseDown={(e) => e.preventDefault()}
                                >
                                    {atSuggestions.map((col) => {
                                        const cc = getColumnColor(col);
                                        const needsRdv = isMeetingColumn(col.name);
                                        return (
                                            <button
                                                key={col.id}
                                                type="button"
                                                role="option"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    insertColumnMention(col);
                                                }}
                                                className="w-full text-left px-2.5 py-2 text-[12px] hover:bg-muted/60 flex items-center gap-2"
                                            >
                                                <span className={cn("w-2 h-2 rounded-full shrink-0", cc.dot)} />
                                                <span className={cn("font-semibold truncate flex-1", cc.chipText)}>
                                                    {col.name}
                                                </span>
                                                {needsRdv && (
                                                    <span className="text-[10px] text-muted-foreground">RDV</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Aperçu détection live */}
                        {(liveDetect.appointment || liveDetect.persons[0] || liveDetect.column) && (
                            <div className="flex flex-wrap gap-1">
                                {liveDetect.appointment && (
                                    <span className="text-[10px] px-1.5 h-5 rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300 inline-flex items-center">
                                        📅 {liveDetect.appointment.label}
                                    </span>
                                )}
                                {liveDetect.persons[0] && (
                                    <span className="text-[10px] px-1.5 h-5 rounded-md bg-primary/10 text-primary inline-flex items-center gap-0.5">
                                        <User size={9} /> {liveDetect.persons[0]}
                                    </span>
                                )}
                                {liveDetect.column && (() => {
                                    const cc = getColumnColor(liveDetect.column);
                                    return (
                                        <span
                                            className={cn(
                                                "text-[10px] px-1.5 h-5 rounded-md inline-flex items-center gap-1 font-semibold border border-transparent",
                                                cc.chipBg,
                                                cc.chipText
                                            )}
                                        >
                                            <span className={cn("w-1.5 h-1.5 rounded-full", cc.dot)} />
                                            @{liveDetect.column.name}
                                        </span>
                                    );
                                })()}
                            </div>
                        )}

                        <Button
                            type="button"
                            disabled={
                                applying
                                || recordingBusy
                                || (!note.trim() && !pendingMeetingCol && !pendingRecording?.blob)
                            }
                            className="h-8 rounded-full text-[12px] w-full"
                            onClick={applySmartNote}
                            data-testid="calendar-event-apply-smart"
                        >
                            <MessageSquare size={12} className="mr-1.5" />
                            {applying
                                ? "…"
                                : recordingBusy
                                    ? "Stop d'abord"
                                    : pendingRecording?.blob && !note.trim()
                                        ? "Enregistrer l'appel"
                                        : "Appliquer"}
                        </Button>
                    </div>
                </div>

                <div className="px-3.5 py-2 border-t border-border/50 bg-muted/15 flex justify-end">
                    <button
                        type="button"
                        onClick={openFullSheet}
                        className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        data-testid="calendar-event-open-lead"
                    >
                        Ouvrir la fiche
                        <ExternalLink size={10} />
                    </button>
                </div>
            </div>
        </>
    );
}
