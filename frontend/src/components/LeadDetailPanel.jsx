import React, { useState, useEffect, useRef, useMemo } from "react";
import { useCrm } from "@/context/CrmContext";
import {
    X,
    Phone,
    Globe,
    Mail,
    User,
    Trash2,
    Tag,
    Plus,
    History,
    CheckCircle2,
    Euro,
    Trophy,
    ChevronDown,
    ArrowUp,
    Database,
    MessageSquare,
    Star,
    CalendarClock,
    Sparkles,
    Lightbulb,
    Repeat2,
    MapPin,
    Pencil,
    Mic,
    AlignLeft,
    Link2,
    Hash,
    Calendar,
} from "lucide-react";
import { CopyBtn } from "./CopyBtn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { VoiceCallSection } from "@/components/VoiceCallSection";
import { getColumnColor } from "@/lib/columnColors";
import {
    ensureWeekday,
    formatDateTimeLong,
    formatFutureRelativeFr,
    toLocalDateKey,
} from "@/lib/dateUtils";
import { allocateMainDupeLabels, isMainFieldDuplicateLabel } from "@/lib/customFields";
import { telHref, mailtoHref, websiteHref } from "@/lib/actionLinks";
import { parseNote, detectAppointment, diffWithLead, formatDetected } from "@/lib/noteParser";
import { isManualRdv, isSuggestedRelance, makeRdvNextAction } from "@/lib/nextActionUtils";
import { AddToCalendarDialog, ConfirmSuggestedRelanceButton, QuickScheduleButton, QuickScheduleForm } from "./AddToCalendarDialog";
import { VigilanceStrip } from "./VigilanceStrip";
import { scheduleLeadNextAction, clearLeadSchedule } from "@/lib/scheduleLead";
import { getLeadIntel } from "@/lib/reliaBrain";
import { detectInconsistencies } from "@/lib/inconsistencyRules";
import { PanelSectionCard, HiddenSectionsMenu, PanelSectionsOrganizer } from "./PanelSectionCard";
import { useVoiceSession } from "@/context/VoiceSessionContext";
import {
    normalizePanelSections,
    visiblePanelSections,
    hiddenPanelSections,
    PANEL_SECTION_META,
    isSectionCollapsed,
    toggleCollapsedSection,
    extractLeadBrief,
    noteCorpus,
    valueAsHref,
    displayUrl,
    reorderPanelSection,
    pickBriefSituation,
    briefLinkLabel,
    jobOfferLinkClass,
    jobOfferUnderlineClass,
} from "@/lib/panelSections";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { AgencySuspectBadge, AGENCY_NAME_CLS } from "./AgencySuspectBadge";
import { LeadAvatar } from "./LeadAvatar";
import { useRecoDayTick } from "@/hooks/useNotifSeenMap";
import { isRelia2Export } from "@/lib/reliaVariant";

const SECTION_ICONS = { Database, User, MessageSquare, Repeat2, Tag, Trophy, History, CalendarClock, Mic };

function formatDateTime(iso) {
    return formatDateTimeLong(iso);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Canaux de relance disponibles ────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const RELANCE_CANAUX = [
    { value: "Téléphone",  label: "Téléphone",   emoji: "📞" },
    { value: "Email",      label: "Email",        emoji: "✉️"  },
    { value: "SMS",        label: "SMS",          emoji: "💬" },
    { value: "LinkedIn",   label: "LinkedIn",     emoji: "💼" },
    { value: "WhatsApp",   label: "WhatsApp",     emoji: "📱" },
    { value: "Courrier",   label: "Courrier",     emoji: "📮" },
    { value: "Autre",      label: "Autre",        emoji: "🔁" },
];

// Couleurs par numéro de relance (1–7)
const RELANCE_COLORS = [
    { bg: "bg-sky-100 dark:bg-sky-900/40",       text: "text-sky-700 dark:text-sky-300",       dot: "bg-sky-500"     }, // 1
    { bg: "bg-blue-100 dark:bg-blue-900/40",      text: "text-blue-700 dark:text-blue-300",      dot: "bg-blue-500"    }, // 2
    { bg: "bg-violet-100 dark:bg-violet-900/40",  text: "text-violet-700 dark:text-violet-300",  dot: "bg-violet-500"  }, // 3
    { bg: "bg-amber-100 dark:bg-amber-900/40",    text: "text-amber-700 dark:text-amber-300",    dot: "bg-amber-500"   }, // 4
    { bg: "bg-orange-100 dark:bg-orange-900/40",  text: "text-orange-700 dark:text-orange-300",  dot: "bg-orange-500"  }, // 5
    { bg: "bg-rose-100 dark:bg-rose-900/40",      text: "text-rose-700 dark:text-rose-300",      dot: "bg-rose-500"    }, // 6
    { bg: "bg-red-100 dark:bg-red-900/40",        text: "text-red-700 dark:text-red-300",        dot: "bg-red-600"     }, // 7+
];
function getRelanceColor(num) {
    return RELANCE_COLORS[Math.min(num - 1, RELANCE_COLORS.length - 1)];
}

// ─────────────────────────────────────────────────────────────────────────────
// ── RelancesWidget (compact) ──────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const RelancesWidget = ({ lead, workspace, dispatch }) => {
    const [canal, setCanal] = useState("Téléphone");
    const [note, setNote] = useState("");
    const [adding, setAdding] = useState(false);

    const relances = lead.relances || [];
    const nextNum = relances.length + 1;
    const maxRelances = 7;
    const atMax = relances.length >= maxRelances;

    const handleLog = () => {
        if (atMax) return;
        dispatch({
            type: "LOG_RELANCE",
            workspaceId: workspace.id,
            leadId: lead.id,
            canal,
            note: note.trim(),
        });
        toast.success(`Relance #${nextNum} · ${canal}`);
        setNote("");
        setAdding(false);
    };

    const handleDelete = (relanceId) => {
        dispatch({
            type: "DELETE_RELANCE",
            workspaceId: workspace.id,
            leadId: lead.id,
            relanceId,
        });
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                {/* Pastilles compactes */}
                <div className="flex items-center gap-1 flex-1 min-w-0">
                    {Array.from({ length: maxRelances }, (_, i) => {
                        const num = i + 1;
                        const done = num <= relances.length;
                        const color = getRelanceColor(num);
                        const entry = relances[i];
                        return (
                            <div
                                key={num}
                                title={done && entry
                                    ? `#${num} · ${entry.canal} · ${new Date(entry.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
                                    : `Relance ${num}`}
                                className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold tabular-nums select-none ${
                                    done
                                        ? `${color.bg} ${color.text}`
                                        : "bg-muted/50 text-muted-foreground/35"
                                }`}
                            >
                                {num}
                            </div>
                        );
                    })}
                    {relances.length > 0 && (
                        <span className="text-[11px] text-muted-foreground ml-1 tabular-nums">
                            {relances.length}/{maxRelances}
                        </span>
                    )}
                </div>
                {!atMax ? (
                    <button
                        type="button"
                        onClick={() => setAdding((v) => !v)}
                        className={`h-6 px-2 rounded-md text-[11px] font-medium transition-colors ${
                            adding
                                ? "bg-secondary text-foreground"
                                : "bg-primary/10 text-primary hover:bg-primary/15"
                        }`}
                    >
                        {adding ? "Annuler" : `+ #${nextNum}`}
                    </button>
                ) : (
                    <span className="text-[10px] text-muted-foreground">Max</span>
                )}
            </div>

            {adding && !atMax && (
                <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2">
                    <div className="flex flex-wrap gap-1">
                        {RELANCE_CANAUX.map((c) => (
                            <button
                                key={c.value}
                                type="button"
                                onClick={() => setCanal(c.value)}
                                className={`h-6 px-2 rounded-md text-[11px] transition-colors ${
                                    canal === c.value
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-card border border-border text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1.5">
                        <input
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleLog()}
                            placeholder="Note (optionnel)"
                            className="flex-1 h-7 px-2 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                            type="button"
                            onClick={handleLog}
                            className="h-7 px-2.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            OK
                        </button>
                    </div>
                </div>
            )}

            {relances.length > 0 && (
                <ul className="space-y-0.5">
                    {[...relances].reverse().map((r) => (
                        <li
                            key={r.id}
                            className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-muted/40 group text-[12px]"
                        >
                            <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold shrink-0 ${getRelanceColor(r.num).bg} ${getRelanceColor(r.num).text}`}>
                                {r.num}
                            </span>
                            <span className="font-medium text-foreground truncate">{r.canal}</span>
                            {r.note && (
                                <span className="text-muted-foreground truncate">· {r.note}</span>
                            )}
                            <span className="ml-auto text-[10px] text-muted-foreground shrink-0 tabular-nums">
                                {new Date(r.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                            </span>
                            <button
                                type="button"
                                onClick={() => handleDelete(r.id)}
                                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-muted-foreground hover:text-rose-500"
                                title="Supprimer"
                            >
                                <X size={11} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {relances.length === 0 && !adding && (
                <p className="text-[11px] text-muted-foreground/70 py-0.5">
                    Aucune relance — ajoutez la #1.
                </p>
            )}
        </div>
    );
};

const NOTE_CALL_RE = /^(📞|📵)/;

function leadHasBeenContacted(lead) {
    if (!lead) return false;
    if (lead.lastContact) return true;
    // Si on a déjà basculé en colonne "Contacté", on considère que l'historique de contact existe
    // même si lastContact a été effacé (ex: suppression d'une note vocale).
    if (lead.contactedColumnEnteredAt) return true;
    if ((lead.relances || []).length > 0) return true;
    return (lead.notes || []).some((n) =>
        !!n?.recordingId
        || NOTE_CALL_RE.test(String(n.text || "").trim())
    );
}

/** Jours calendaires depuis l'entrée dans le CRM (createdAt). */
function calendarDaysInCrm(createdAt) {
    const a = toLocalDateKey(createdAt);
    const b = toLocalDateKey(new Date());
    if (!a || !b) return 0;
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    const start = Date.UTC(ay, am - 1, ad);
    const end = Date.UTC(by, bm - 1, bd);
    return Math.max(0, Math.round((end - start) / 86400000));
}

export const LeadDetailPanel = ({ open, lead, workspace, onClose }) => {
    const { dispatch, state } = useCrm();
    const voice = useVoiceSession();
    const panelMode = state.leadPanelMode || "side";
    const infoLayoutRows = workspace.panelInfoLayout === "rows";
    const [noteDraft, setNoteDraft] = useState("");
    const [noteSaving, setNoteSaving] = useState(false);
    const [tagDraft, setTagDraft] = useState("");
    const [cfLabel, setCfLabel] = useState("");
    const [cfValue, setCfValue] = useState("");
    const [lastAddedFieldLabel, setLastAddedFieldLabel] = useState(null);
    // RDV / calendrier
    const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
    const [calendarHint, setCalendarHint] = useState("");
    const [calendarDefaultLabel, setCalendarDefaultLabel] = useState("");
    const [calendarAsMeeting, setCalendarAsMeeting] = useState(false);
    // Sections réordonnables (zone B)
    const [dragSectionId, setDragSectionId] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);
    const [dropPlace, setDropPlace] = useState(null); // "before" | "after"
    const [briefLinksOpen, setBriefLinksOpen] = useState(false);
    const [editingCalendar, setEditingCalendar] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const panelRef = useRef(null);
    // Use the live lead from props directly — parent computes it from state.
    const local = lead;

    // Infos détectées dans notes + transcripts d'appels
    const detectedFromNotes = useMemo(() => {
        if (!local) return [];
        const allText = (local.notes || [])
            .map((n) => noteCorpus(n))
            .filter(Boolean)
            .join("\n");
        if (!allText.trim()) return [];
        const { phones, emails, addresses, persons } = parseNote(allText);
        return [
            ...persons.map((v) => ({ icon: "👤", value: v })),
            ...phones.map((v) => ({ icon: "📞", value: v })),
            ...emails.map((v) => ({ icon: "✉️", value: v })),
            ...addresses.map((v) => ({ icon: "📍", value: v })),
        ];
    }, [local?.notes]);

    // Détection en temps réel dans le draft de note
    const draftDetected = useMemo(() => parseNote(noteDraft), [noteDraft]);
    const draftDiff = useMemo(
        () => local ? diffWithLead(draftDetected, local) : {
            newPhone: null, extraPhones: [], newEmail: null, extraEmails: [], newAddress: null,
            newContact: null, extraContacts: [], willAddPersons: [],
        },
        [draftDetected, local]
    );
    const draftDetectedItems = useMemo(() => formatDetected(draftDetected), [draftDetected]);
    const draftAppointment = useMemo(() => detectAppointment(noteDraft), [noteDraft]);

    const inconsistencies = useMemo(
        () => (local
            ? detectInconsistencies(local, workspace.columns, workspace.inconsistencyConfig)
            : []),
        [local, workspace.columns, workspace.inconsistencyConfig]
    );

    const agencySuspect = useMemo(
        () => (local
            ? getAgencySuspicion(local, isAgencyDetectionEnabled(workspace))
            : null),
        [local, workspace.agencyDetectionEnabled]
    );

    useEffect(() => {
        // Reset drafts when switching to a different lead
        setNoteDraft("");
        setNoteSaving(false);
        setTagDraft("");
        setCfLabel("");
        setCfValue("");
        setBriefLinksOpen(false);
        setEditingCalendar(false);
    }, [lead?.id]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== "Escape" || !open) return;
            // Mode prêt : le dock gère Esc (confirmation) — ne pas fermer la fiche en premier
            if (voice.status === "ready") return;
            onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose, voice.status]);

    // Raccourcis : focus note / ouvrir planification relance
    useEffect(() => {
        if (!open) return undefined;
        const onFocusNote = () => {
            const el = document.querySelector('[data-testid="lead-note-input"]');
            if (el) {
                el.focus();
                el.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        };
        const onOpenRelance = () => {
            setEditingCalendar(true);
            window.setTimeout(() => {
                document
                    .querySelector('[data-testid="lead-edit-next-action"], [data-testid="lead-next-action-card"]')
                    ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
            }, 60);
        };
        window.addEventListener("relia:focus-new-note", onFocusNote);
        window.addEventListener("relia:open-relance", onOpenRelance);
        return () => {
            window.removeEventListener("relia:focus-new-note", onFocusNote);
            window.removeEventListener("relia:open-relance", onOpenRelance);
        };
    }, [open]);

    const scheduleOverdue = useMemo(() => {
        if (!local?.nextAction?.dueAt && !local?.nextAction?.date) return false;
        const due = new Date(local.nextAction.dueAt || `${local.nextAction.date}T09:00:00`);
        return !Number.isNaN(due.getTime()) && due.getTime() < Date.now() - 60000;
    }, [local?.nextAction]);

    const recoDayTick = useRecoDayTick();

    const allWorkspaces = useMemo(
        () => (state.order || []).map((id) => state.workspaces?.[id]).filter(Boolean),
        [state.workspaces, state.order]
    );

    const leadIntel = useMemo(() => {
        if (!local?.id || !workspace) return null;
        return getLeadIntel(workspace, local.id, {
            dailyGoal: state.settings?.dailyGoal || 20,
            workspaces: allWorkspaces,
        });
    }, [
        workspace,
        local?.id,
        local?.columnId,
        local?.notes,
        local?.nextAction,
        local?.autoFollowup,
        local?.lastContact,
        local?.dealValue,
        local?.phone,
        local?.email,
        local?.contact,
        state.settings?.dailyGoal,
        allWorkspaces,
        recoDayTick,
    ]);

    const prospectSlot = leadIntel?.slot || null;
    const defaultRelanceDays = leadIntel?.callDefaults?.suggestedScheduleDays
        ?? leadIntel?.callDefaults?.relanceDays
        ?? 2;
    const leadRecos = leadIntel?.conseils || [];

    const needsCalendarNudge = useMemo(() => {
        if (!local) return false;
        const watchasks = inconsistencies.some(
            (i) => i.action?.type === "plan_rdv"
                || ["rdv_overdue", "no_answer_gap", "no_answer", "contact_gap", "stale_contact", "nouveau_stale"].includes(i.id)
                || /rappel|relance|rdv|contact|jamais/i.test(`${i.title || ""} ${i.message || ""}`)
        );
        const fuOverdue = !!(local.autoFollowup && (
            local.autoFollowup.overdue
            || (local.autoFollowup.dueAt && new Date(local.autoFollowup.dueAt).getTime() <= Date.now())
        ));
        const noFutureSlot = !local.nextAction || scheduleOverdue;
        return noFutureSlot && (watchasks || fuOverdue || scheduleOverdue);
    }, [local, inconsistencies, scheduleOverdue]);

    /** Copy du bandeau calendrier : « appeler » si jamais contacté, sinon « rappeler ». */
    const calendarNudgeCopy = useMemo(() => {
        if (!local) return null;
        const neverCalled = !leadHasBeenContacted(local);
        const daysInCrm = calendarDaysInCrm(local.createdAt);
        const company = (local.company || "").trim();

        if (neverCalled) {
            const daysLabel = daysInCrm <= 0
                ? "Ce prospect vient d'arriver dans le CRM"
                : daysInCrm === 1
                    ? "Ça fait 1 jour que ce prospect est dans le CRM"
                    : `Ça fait ${daysInCrm} jours que ce prospect est dans le CRM`;
            return {
                title: "Bloquez un moment pour appeler",
                body: `${daysLabel} — planifiez le premier appel.`,
                label: company ? `Appeler ${company}` : "Premier appel",
                hint: "Choisissez quand appeler ce prospect pour la première fois.",
                shortLabel: "Appeler",
            };
        }

        if (scheduleOverdue) {
            return {
                title: "Bloquez un moment pour rappeler",
                body: "Le rappel en cours est dépassé — choisissez un nouveau créneau.",
                label: company ? `Rappeler ${company}` : "Rappeler",
                hint: "Choisissez quand rappeler ce prospect.",
                shortLabel: "Rappel",
            };
        }

        return {
            title: "Bloquez un moment pour rappeler",
            body: "Prenez un créneau dans votre journée pour rappeler ce prospect.",
            label: company ? `Rappeler ${company}` : "Rappeler",
            hint: "Choisissez quand rappeler ce prospect.",
            shortLabel: "Rappel",
        };
    }, [local, scheduleOverdue]);

    if (!open || !local) return null;

    const isJobs = workspace.template === "jobs";

    // ── Zone B : sections réordonnables (persistées par workspace) ──
    const layout = normalizePanelSections(workspace.panelSections);
    const persistLayout = (next) =>
        dispatch({ type: "SET_PANEL_SECTIONS", workspaceId: workspace.id, panelSections: next });

    const reorderSections = (draggedId, targetId, place = "before") => {
        if (!draggedId || !targetId) return;
        persistLayout(reorderPanelSection(layout, draggedId, targetId, place));
    };

    const hideSection = (sid) => {
        if (layout.hidden.includes(sid)) return;
        persistLayout({ ...layout, hidden: [...layout.hidden, sid] });
    };

    const restoreSection = (sid) => {
        persistLayout({ ...layout, hidden: layout.hidden.filter((id) => id !== sid) });
    };

    const sectionTitle = (id) => {
        switch (id) {
            case "contact":
                return isJobs ? "Entreprise & Recruteur" : "Contact & coordonnées";
            case "imported":
                return "Données importées";
            case "deal":
                return isJobs ? "Salaire proposé" : "Valeur du deal";
            case "relances":
                return "Relances";
            case "calendar":
                return "Calendrier";
            case "voice":
                return "Appel";
            default:
                return PANEL_SECTION_META[id]?.label || id;
        }
    };

    const toggleCollapse = (sid) => {
        persistLayout(toggleCollapsedSection(layout, sid));
    };

    // ── Zone A : brief fixe ──
    const brief = extractLeadBrief(local, {
        columnName: workspace.columns[local.columnId]?.name || "",
    });
    const showBrief = brief.hasBrief || leadRecos.length > 0;
    const { primary: situationPrimary, secondaryLine: situationSecondary } = pickBriefSituation(
        brief.situation || []
    );
    const actionableInsights = (brief.insights || []).filter((i) => i.actionable);
    const appointmentInsights = actionableInsights.filter((i) => i.type === "appointment");
    const otherInsights = actionableInsights.filter((i) => i.type !== "appointment");
    // Évite le doublon « Suggestion d'appel / Date détectée » (notifs) + chip RDV.
    const briefRecos = leadRecos.filter((item) => {
        if (item.kind !== "brief_suggestion") return true;
        const key = String(item.key || "");
        if (key.includes("brief_appointment") && appointmentInsights.length > 0) return false;
        if (key.includes("brief_phone") && otherInsights.some((i) => i.type === "phone")) return false;
        if (key.includes("brief_email") && otherInsights.some((i) => i.type === "email")) return false;
        if (key.includes("brief_person") && otherInsights.some((i) => i.type === "person")) return false;
        if (appointmentInsights.length > 0 && /Date détectée/i.test(item.label || "")) return false;
        return true;
    });
    const latestNote = (brief.contextualNotes || [])[0] || null;

    const applyBriefInsight = (ins) => {
        if (!ins || !local) return;
        if (ins.type === "appointment" && ins.appointment?.iso) {
            patch({
                nextAction: makeRdvNextAction({
                    date: toLocalDateKey(ins.appointment.iso),
                    dueAt: ins.appointment.iso,
                    label: ins.appointment.label,
                }),
            });
            toast.success("RDV planifié", { description: ins.value });
            return;
        }
        if (ins.applyAsExtraPhone && ins.value) {
            const [label] = allocateMainDupeLabels(local.customFields, "Téléphone", 1);
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: local.id,
                label: label || "Téléphone 2",
                value: ins.value,
                pinned: false,
                isMainDuplicate: true,
            });
            toast.success("Téléphone ajouté", { description: ins.value });
            return;
        }
        if (ins.applyAsExtraEmail && ins.value) {
            const [label] = allocateMainDupeLabels(local.customFields, "Email", 1);
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: local.id,
                label: label || "Email 2",
                value: ins.value,
                pinned: false,
                isMainDuplicate: true,
            });
            toast.success("Email ajouté", { description: ins.value });
            return;
        }
        if (!ins.applyKey) return;
        patch({ [ins.applyKey]: ins.value });
        toast.success(`${ins.label} enregistré`, { description: ins.value });
    };

    const insightChipLabel = (ins) => {
        if (ins.type === "appointment") return `RDV · ${ins.value}`;
        if (ins.type === "phone") return `Tél. · ${ins.value}`;
        if (ins.type === "email") return `Email · ${ins.value}`;
        if (ins.type === "person") return `Contact · ${ins.value}`;
        return ins.value;
    };

    const dismissInconsistency = (fingerprint) => {
        dispatch({
            type: "DISMISS_INCONSISTENCY",
            workspaceId: workspace.id,
            leadId: local.id,
            fingerprint,
        });
    };

    const patch = (p) => {
        dispatch({
            type: "UPDATE_LEAD",
            workspaceId: workspace.id,
            leadId: local.id,
            patch: p,
        });
    };

    const openCalendarScheduler = ({ hint = "", label = "", asMeeting = false } = {}) => {
        setCalendarHint(hint);
        setCalendarDefaultLabel(label);
        setCalendarAsMeeting(!!asMeeting);
        setCalendarDialogOpen(true);
    };

    const applyCalendarReminder = (nextAction) => {
        const hadSchedule = !!(local.nextAction?.dueAt || local.nextAction?.date);
        // Mise à jour d'un créneau existant : ne pas bouger les colonnes
        // (évite Relance/RDV qui se battent avec « À surveiller »).
        const result = scheduleLeadNextAction(dispatch, {
            workspace,
            leadId: local.id,
            nextAction,
            move: !hadSchedule,
        });
        toast.success(hadSchedule ? "Créneau mis à jour" : "Ajouté au calendrier", {
            description: result.moved && result.toColumnName
                ? `${nextAction.label} · déplacé vers « ${result.toColumnName} »`
                : nextAction.label,
        });
    };

    const clearSchedule = () => {
        clearLeadSchedule(dispatch, {
            workspaceId: workspace.id,
            leadId: local.id,
            dismissFollowup: true,
        });
        toast.success("Rendez-vous / rappel supprimé");
    };

    const runInconsistencyAction = (item) => {
        const action = item?.action;
        if (!action) return;
        if (action.type === "plan_rdv") {
            openCalendarScheduler({
                hint: item.message || "RDV / relance suggéré par la vigilance.",
                label: action.label || `Rappeler ${local.company || ""}`.trim(),
                asMeeting: true,
            });
            return;
        }
        if (action.type === "apply_field" && action.applyKey && action.value) {
            patch({ [action.applyKey]: action.value });
            toast.success("Enregistré", { description: String(action.value) });
        }
    };

    const changeStatus = (toColumnId) => {
        // Use MOVE_LEAD so statusHistory is updated
        dispatch({
            type: "MOVE_LEAD",
            workspaceId: workspace.id,
            leadId: local.id,
            toColumnId,
        });
    };

    const addNote = async () => {
        if (noteSaving) return;
        const content = noteDraft.trim();
        if (!content) return;

        setNoteSaving(true);
        const noteText = content;

        dispatch({
            type: "ADD_NOTE",
            workspaceId: workspace.id,
            leadId: local.id,
            text: noteText,
        });

        // Appliquer les infos détectées
        const nextPatch = {};
        if (draftDiff.newPhone) nextPatch.phone = draftDiff.newPhone;
        if (draftDiff.newEmail) nextPatch.email = draftDiff.newEmail;
        if (draftDiff.newContact) nextPatch.contact = draftDiff.newContact;

        // RDV / rappel détecté dans la note → toujours appliquer (la note prime)
        if (draftAppointment) {
            nextPatch.nextAction = makeRdvNextAction({
                date: toLocalDateKey(draftAppointment.iso),
                dueAt: draftAppointment.iso,
                label: draftAppointment.label,
            });
            if (local.autoFollowup) {
                nextPatch.autoFollowup = {
                    ...local.autoFollowup,
                    dueAt: draftAppointment.iso,
                    overdue: false,
                };
            }
        }

        if (Object.keys(nextPatch).length > 0) {
            dispatch({ type: "UPDATE_LEAD", workspaceId: workspace.id, leadId: local.id, patch: nextPatch });
        }

        // Téléphones / contacts supplémentaires → juste sous le champ principal (Contact 2…)
        const phoneLabels = allocateMainDupeLabels(local.customFields, "Téléphone", (draftDiff.extraPhones || []).length);
        (draftDiff.extraPhones || []).forEach((phone, i) => {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: local.id,
                label: phoneLabels[i] || `Téléphone ${i + 2}`,
                value: phone,
                pinned: false,
                isMainDuplicate: true,
            });
        });
        const emailLabels = allocateMainDupeLabels(local.customFields, "Email", (draftDiff.extraEmails || []).length);
        (draftDiff.extraEmails || []).forEach((email, i) => {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: local.id,
                label: emailLabels[i] || `Email ${i + 2}`,
                value: email,
                pinned: false,
                isMainDuplicate: true,
            });
        });
        const contactBase = isJobs ? "Contact RH" : "Contact";
        const contactLabels = allocateMainDupeLabels(
            local.customFields,
            contactBase,
            (draftDiff.extraContacts || []).length
        );
        (draftDiff.extraContacts || []).forEach((person, i) => {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: local.id,
                label: contactLabels[i] || `${contactBase} ${i + 2}`,
                value: person,
                pinned: false,
                highlight: true,
                isMainDuplicate: true,
            });
        });
        if (draftDiff.newAddress) {
            dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label: "Adresse", value: draftDiff.newAddress, pinned: false });
        }

        setNoteDraft("");
        setNoteSaving(false);

        if (draftAppointment) {
            toast.success("Note + RDV au calendrier", {
                description: draftAppointment.label,
            });
        } else if (/pas\s*de\s*r[eé]ponse|ne\s*r[eé]pond|rappeler|relancer|📵|📞/i.test(noteText)) {
            toast.message("Note enregistrée", {
                description: "Placez un rappel calendrier ?",
                action: {
                    label: "Calendrier",
                    onClick: () => openCalendarScheduler({
                        hint: "Suite à votre note — choisissez quand rappeler.",
                        label: `Rappeler ${local.company || ""}`.trim(),
                    }),
                },
            });
        }
    };

    const addTag = () => {
        const clean = tagDraft.trim();
        if (!clean) return;
        if ((local.tags || []).includes(clean)) {
            setTagDraft("");
            return;
        }
        patch({ tags: [...(local.tags || []), clean] });
        setTagDraft("");
    };

    const removeTag = (t) => {
        patch({ tags: (local.tags || []).filter((x) => x !== t) });
    };

    const addCustomField = () => {
        const l = cfLabel.trim();
        if (!l) return;
        dispatch({
            type: "ADD_CUSTOM_FIELD",
            workspaceId: workspace.id,
            leadId: local.id,
            label: l,
            value: cfValue.trim(),
            pinned: false,
        });
        setCfLabel("");
        setCfValue("");
    };

    const updateCustomField = (fieldId, patch) => {
        dispatch({
            type: "UPDATE_CUSTOM_FIELD",
            workspaceId: workspace.id,
            leadId: local.id,
            fieldId,
            patch,
        });
    };

    const toggleHighlightCustomField = (fieldId, current, fieldLabel) => {
        // Épingle/désépingle sur TOUS les leads du workspace ayant ce label
        dispatch({
            type: "HIGHLIGHT_FIELD_FOR_COLUMN",
            workspaceId: workspace.id,
            fieldLabel,
            currentHighlight: current,
        });
    };

    const highlightExtraField = (extraKey, extraValue) => {
        // Vérifie l'état actuel : y a-t-il déjà un customField highlight pour cette clé ?
        const currentHighlight = !!(local.customFields || []).find(
            (cf) => cf.label === extraKey && cf.highlight
        );
        // Épingle/désépingle sur TOUS les leads du workspace ayant cette clé
        dispatch({
            type: "HIGHLIGHT_FIELD_FOR_COLUMN",
            workspaceId: workspace.id,
            fieldLabel: extraKey,
            currentHighlight,
        });
    };

    const removeCustomField = (fieldId) => {
        dispatch({
            type: "REMOVE_CUSTOM_FIELD",
            workspaceId: workspace.id,
            leadId: local.id,
            fieldId,
        });
    };

    const logContactToday = () => {
        dispatch({
            type: "LOG_CONTACT",
            workspaceId: workspace.id,
            leadId: local.id,
            text: `Contact enregistré depuis « ${workspace.columns[local.columnId]?.name} »`,
        });
        toast.success("Contact du jour enregistré");
    };

    const deleteLead = () => {
        dispatch({
            type: "DELETE_LEAD",
            workspaceId: workspace.id,
            leadId: local.id,
        });
        setConfirmDelete(false);
        toast("Lead supprimé", {
            description: local.company,
            action: {
                label: "Annuler",
                onClick: () => dispatch({ type: "RESTORE_LAST_DELETED" }),
            },
            duration: 6000,
        });
        onClose();
    };

    // Promouvoir un champ importé (extra) vers un champ personnalisé
    // et mettre à jour TOUS les leads du workspace qui ont cette clé extra.
    // Ne jamais écraser une donnée existante.
    const promoteExtraField = (extraKey) => {
        dispatch({
            type: "PROMOTE_EXTRA_FIELD",
            workspaceId: workspace.id,
            extraKey,
        });
        const affectedCount = Object.values(workspace.leads).filter(
            (l) => l.extra?.[extraKey] && !(l.customFields || []).find(
                (cf) => cf.label.toLowerCase() === extraKey.toLowerCase() && cf.value
            )
        ).length;
        toast.success(`« ${extraKey} » ajouté aux infos`, {
            description: `${affectedCount} lead${affectedCount > 1 ? "s" : ""} mis à jour · données existantes préservées`,
        });
    };

    // Supprimer un champ extra sur tous les leads ayant la même clé + valeur exacte
    const deleteLeadExtraField = (extraKey, extraValue) => {
        const affectedCount = Object.values(workspace.leads).filter(
            (l) => (l.extra || {})[extraKey] === extraValue
        ).length;
        dispatch({
            type: "DELETE_LEAD_EXTRA_FIELD",
            workspaceId: workspace.id,
            leadId: local.id,
            extraKey,
            extraValue,
        });
        toast.success(`« ${extraKey} » supprimé`, {
            description: affectedCount > 1
                ? `${affectedCount} leads mis à jour (valeur identique)`
                : "Supprimé sur ce lead",
        });
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[3px] animate-in fade-in duration-200"
                onClick={onClose}
                data-testid="lead-panel-backdrop"
            />
            {/* Panel — floating sheet on desktop, full-screen on mobile */}
            <aside
                ref={panelRef}
                data-testid="lead-detail-panel"
                className={panelMode === "modal"
                    ? "fixed z-50 flex flex-col inset-0 sm:inset-auto sm:top-[2%] sm:bottom-[2%] sm:left-1/2 sm:-translate-x-1/2 w-full sm:w-[880px] bg-card sm:rounded-xl sm:border border-border shadow-panel animate-in fade-in zoom-in-95 duration-200"
                    : "fixed z-50 flex flex-col inset-0 sm:inset-auto sm:top-3 sm:bottom-3 sm:right-3 w-full sm:w-[640px] bg-card sm:rounded-xl sm:border border-border shadow-panel animate-in slide-in-from-right duration-300"}
            >
                <div className="border-b border-border/70 bg-card px-5 py-3.5 rounded-t-xl shrink-0">
                    <div className="flex items-center gap-3">
                        <LeadAvatar
                            lead={local}
                            panel
                            bgClass={getColumnColor(workspace.columns[local.columnId]).chipBg}
                        />
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                            <input
                                data-testid="lead-company-input"
                                value={local.company || ""}
                                onChange={(e) => patch({ company: e.target.value })}
                                className={`min-w-0 flex-1 bg-transparent text-xl sm:text-2xl font-semibold tracking-tight outline-none focus:ring-2 focus:ring-primary rounded ${
                                    agencySuspect ? AGENCY_NAME_CLS : ""
                                }`}
                                placeholder={isJobs ? "Nom de l'entreprise / Poste" : "Nom de l'entreprise"}
                            />
                            {agencySuspect && (
                                <AgencySuspectBadge
                                    score={agencySuspect.score}
                                    label={agencySuspect.label}
                                    variant="percent"
                                />
                            )}
                        </div>
                        <button
                            data-testid="lead-panel-close-btn"
                            onClick={onClose}
                            aria-label="Fermer"
                            className="w-8 h-8 shrink-0 rounded-full hover:bg-secondary flex items-center justify-center text-muted-foreground"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className={`flex-1 overflow-y-auto px-5 py-4 space-y-3 ${
                    infoLayoutRows ? "bg-background" : "bg-muted/20"
                }`}>
                    {/* ═══════════ ZONE A — fixe : Information pertinente + prochaine action ═══════════ */}

                    {/* 🧾 Brief interactif — personnalisé par lead (import + notes) */}
                    {showBrief && (
                        <div
                            className={`rounded-xl border border-border p-3.5 space-y-3 ${
                                infoLayoutRows ? "bg-transparent shadow-none" : "bg-card shadow-sm"
                            }`}
                            data-testid="lead-brief-strip"
                        >
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                                <Sparkles size={12} strokeWidth={2} className="sparkle-icon shrink-0" />
                                <span>Information pertinente</span>
                            </div>

                            {/* RDV détecté — une seule CTA (pas notif + chip) */}
                            {appointmentInsights.length > 0 && (
                                <section className="space-y-1.5" data-testid="lead-brief-rdv">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Suggestion
                                    </p>
                                    <div className="space-y-1.5">
                                        {appointmentInsights.map((ins) => (
                                            <button
                                                key={`${ins.type}-${ins.value}`}
                                                type="button"
                                                onClick={() => applyBriefInsight(ins)}
                                                className="w-full rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 flex items-start gap-2 text-left hover:bg-primary/10 transition-colors"
                                                title="Planifier ce rendez-vous"
                                                data-testid="lead-brief-suggest-appointment"
                                            >
                                                <CalendarClock
                                                    size={13}
                                                    strokeWidth={2}
                                                    className="shrink-0 mt-0.5 text-primary"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[12px] font-semibold leading-snug text-foreground">
                                                        RDV détecté
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                                        {ins.value}
                                                    </p>
                                                </div>
                                                <span className="shrink-0 text-[11px] font-medium text-primary mt-0.5">
                                                    Planifier
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* NOTIFICATIONS — hors suggestions déjà affichées */}
                            {briefRecos.length > 0 && (
                                <section className="space-y-1.5" data-testid="lead-brief-reco">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Notifications
                                    </p>
                                    <div className="space-y-1.5">
                                        {briefRecos.slice(0, 2).map((item) => (
                                            <div
                                                key={item.key}
                                                className={cn(
                                                    "rounded-lg border px-2.5 py-2 flex items-start gap-2",
                                                    item.overdue
                                                        ? "border-rose-500/25 bg-rose-500/5"
                                                        : "border-primary/20 bg-primary/5"
                                                )}
                                                data-testid={`lead-brief-reco-${item.kind}`}
                                            >
                                                <Lightbulb
                                                    size={13}
                                                    strokeWidth={2}
                                                    className={cn(
                                                        "shrink-0 mt-0.5",
                                                        item.overdue
                                                            ? "text-rose-600 dark:text-rose-400"
                                                            : "text-primary"
                                                    )}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[12px] font-semibold leading-snug text-foreground">
                                                        {item.title || "Notification Relia"}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                                        {item.label}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Autres suggestions (tél., email, contact) */}
                            {otherInsights.length > 0 && (
                                <section className="space-y-1.5" data-testid="lead-brief-suggestions">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Suggestions
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {otherInsights.map((ins) => (
                                            <button
                                                key={`${ins.type}-${ins.value}`}
                                                type="button"
                                                onClick={() => applyBriefInsight(ins)}
                                                className="inline-flex items-center gap-1 max-w-full h-7 px-2.5 rounded-lg text-[11px] font-medium bg-primary/8 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
                                                title={ins.label || "Ajouter"}
                                                data-testid={`lead-brief-suggest-${ins.type}`}
                                            >
                                                <Sparkles size={10} className="sparkle-icon shrink-0" />
                                                <span className="truncate">{insightChipLabel(ins)}</span>
                                                <span className="opacity-70 shrink-0">+</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* SUIVI — 1 fait principal + ligne secondaire */}
                            {situationPrimary && (
                                <section className="space-y-0.5" data-testid="lead-brief-situation">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Suivi
                                    </p>
                                    <p
                                        className={cn(
                                            "text-[13px] font-semibold leading-snug",
                                            situationPrimary.tone === "ok" && "text-emerald-800 dark:text-emerald-300",
                                            situationPrimary.tone === "warn" && "text-amber-900 dark:text-amber-300",
                                            situationPrimary.tone === "info" && "text-sky-900 dark:text-sky-300",
                                            (!situationPrimary.tone || situationPrimary.tone === "neutral") && "text-foreground"
                                        )}
                                    >
                                        {situationPrimary.label}
                                    </p>
                                    {situationSecondary && (
                                        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                                            {situationSecondary}
                                        </p>
                                    )}
                                </section>
                            )}

                            {/* CONTEXTE — annonce / poste CSV (sans lien) — masqué en Relia 2 */}
                            {!isRelia2Export && (brief.annonce || brief.jobTitle || brief.location || brief.contract) && (
                                <section className="space-y-0.5" data-testid="lead-brief-contexte">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Contexte
                                    </p>
                                    {brief.annonce && (
                                        <div className="space-y-0.5" data-testid="lead-brief-annonce">
                                            {String(brief.annonce)
                                                .split(/\s*;\s*/)
                                                .map((part) => part.trim())
                                                .filter(Boolean)
                                                .map((part, i) => (
                                                    <p
                                                        key={`${part}-${i}`}
                                                        className="text-[12px] font-medium leading-snug text-foreground"
                                                    >
                                                        {part}
                                                    </p>
                                                ))}
                                        </div>
                                    )}
                                    {brief.jobTitle && brief.jobTitle !== brief.annonce && (
                                        <div className="space-y-0.5" data-testid="lead-brief-job-title">
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
                                                                ? "text-[11px] text-muted-foreground"
                                                                : "text-[12px] font-medium text-foreground"
                                                        )}
                                                    >
                                                        {part}
                                                    </p>
                                                ))}
                                        </div>
                                    )}
                                    {(brief.location || brief.contract) && (
                                        <p className="text-[12px] text-foreground leading-snug">
                                            {brief.location && (
                                                <span className="inline-flex items-center gap-1">
                                                    <MapPin size={11} className="text-muted-foreground shrink-0" />
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

                            {/* Relia 2 — Site web mis en avant dans Informations pertinentes */}
                            {isRelia2Export && brief.website && (
                                <section className="space-y-0.5" data-testid="lead-brief-website">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Site web
                                    </p>
                                    <a
                                        href={websiteHref(brief.website) || undefined}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline max-w-full"
                                        title={brief.website}
                                    >
                                        <Globe size={12} className="shrink-0 opacity-80" />
                                        <span className="truncate">{displayUrl(websiteHref(brief.website) || brief.website)}</span>
                                    </a>
                                </section>
                            )}

                            {/* DERNIÈRE INFO */}
                            {latestNote && (
                                <section className="space-y-0.5" data-testid="lead-brief-contextual-notes">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Dernière info
                                    </p>
                                    <p className="text-[12px] leading-snug text-muted-foreground italic line-clamp-2 border-l-2 border-border/80 pl-2.5">
                                        {latestNote.text}
                                    </p>
                                </section>
                            )}

                            {/* CONTACT */}
                            {(brief.contact || brief.phone || brief.email) && (
                                <section className="space-y-1">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Contact
                                    </p>
                                    {brief.contact && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!local.contact && brief.contact) {
                                                    patch({ contact: brief.contact });
                                                    toast.success("Contact enregistré", { description: brief.contact });
                                                }
                                            }}
                                            className="inline-flex items-center gap-1.5 group/row rounded-md hover:bg-muted/60 px-1 -mx-1 py-0.5 transition-colors text-left max-w-full"
                                            title={local.contact ? "Contact du lead" : "Cliquer pour enregistrer comme contact"}
                                        >
                                            <User size={12} className="text-muted-foreground shrink-0" />
                                            <span className="text-[13px] font-semibold truncate">{brief.contact}</span>
                                            {brief.contactSource === "note" && !local.contact && (
                                                <span className="text-[9px] text-primary font-medium shrink-0">noter</span>
                                            )}
                                            <CopyBtn value={brief.contact} className="opacity-0 group-hover/row:opacity-100" />
                                        </button>
                                    )}
                                    {(brief.phone || brief.email) && (
                                        <div className="flex flex-col gap-0.5 pl-0.5 text-[12px]">
                                            {brief.phone && (
                                                <span className="inline-flex items-center gap-1.5 group/row min-w-0">
                                                    <Phone size={11} className="text-muted-foreground shrink-0" />
                                                    <a
                                                        href={telHref(brief.phone) || undefined}
                                                        className="font-medium hover:text-primary tabular-nums"
                                                    >
                                                        {brief.phone}
                                                    </a>
                                                    <CopyBtn value={brief.phone} className="opacity-0 group-hover/row:opacity-100" />
                                                </span>
                                            )}
                                            {brief.email && (
                                                <span className="inline-flex items-center gap-1.5 group/row min-w-0">
                                                    <Mail size={11} className="text-muted-foreground shrink-0" />
                                                    <a
                                                        href={mailtoHref(brief.email) || undefined}
                                                        className="font-medium hover:text-primary truncate"
                                                    >
                                                        {brief.email}
                                                    </a>
                                                    <CopyBtn value={brief.email} className="opacity-0 group-hover/row:opacity-100" />
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Offre d'emploi — lien souligné, couleur selon la source — masqué en Relia 2 */}
                            {!isRelia2Export && brief.offerLink && (
                                <a
                                    href={brief.offerLink.href}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className={jobOfferLinkClass(brief.offerLink.source)}
                                    title={brief.offerLink.href}
                                    data-testid="lead-brief-offer-link"
                                >
                                    <span className={jobOfferUnderlineClass(brief.offerLink.source)}>
                                        Voir l&apos;offre
                                    </span>
                                    <span className="opacity-50">·</span>
                                    <span className="font-normal opacity-80">
                                        {brief.offerLink.sourceLabel}
                                    </span>
                                </a>
                            )}

                            {/* Liens — repliés par défaut */}
                            {brief.links.length > 0 && (
                                <div className="min-w-0">
                                    <button
                                        type="button"
                                        onClick={() => setBriefLinksOpen((v) => !v)}
                                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                        aria-expanded={briefLinksOpen}
                                        data-testid="lead-brief-links-toggle"
                                    >
                                        <span>Liens · {brief.links.length}</span>
                                        <ChevronDown
                                            size={12}
                                            className={cn("transition-transform", briefLinksOpen && "rotate-180")}
                                        />
                                    </button>
                                    {briefLinksOpen && (
                                        <div className="mt-1 flex flex-col gap-0.5 min-w-0">
                                            {brief.links.map((l) => (
                                                <a
                                                    key={l.href}
                                                    href={l.href}
                                                    target="_blank"
                                                    rel="noreferrer noopener"
                                                    className="text-[12px] text-primary hover:underline truncate block"
                                                    title={l.href}
                                                >
                                                    {briefLinkLabel(l)}
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* À surveiller + rappel — une ligne, icônes-actions */}
                    {(inconsistencies.length > 0 || (needsCalendarNudge && calendarNudgeCopy)) && (
                        <VigilanceStrip
                            items={inconsistencies}
                            nudge={needsCalendarNudge ? calendarNudgeCopy : null}
                            company={local.company || ""}
                            onPlanMeeting={(item) => {
                                const asMeeting =
                                    item?.id === "meeting_sans_rdv"
                                    || item?.id === "rdv_detected_unplanned"
                                    || item?.id === "rdv_overdue"
                                    || item?.action?.type === "plan_rdv";
                                openCalendarScheduler({
                                    hint: item?.message || (asMeeting ? "Planifiez le rendez-vous." : "Planifiez un rappel."),
                                    label: item?.action?.label
                                        || (asMeeting
                                            ? `RDV · ${local.company || ""}`.trim()
                                            : `Rappeler ${local.company || ""}`.trim()),
                                    asMeeting,
                                });
                            }}
                            onPlanReminder={applyCalendarReminder}
                            onApplyField={(item) => {
                                if (item?.action?.type === "apply_field") {
                                    runInconsistencyAction(item);
                                    return;
                                }
                                if (item?.id === "won_sans_valeur" || item?.id === "won_no_close_date") {
                                    restoreSection("deal");
                                    toast.message(item.title, {
                                        description: "Renseignez le montant / la date dans la section deal.",
                                    });
                                    requestAnimationFrame(() => {
                                        document
                                            .querySelector('[data-testid="lead-deal-value-input"]')
                                            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                        document.querySelector('[data-testid="lead-deal-value-input"]')?.focus();
                                    });
                                }
                            }}
                            onSaveContact={({ phone, email }) => {
                                const p = {};
                                if (phone) p.phone = phone;
                                if (email) p.email = email;
                                if (!Object.keys(p).length) return;
                                patch(p);
                                toast.success("Coordonnées enregistrées", {
                                    description: [phone, email].filter(Boolean).join(" · "),
                                });
                            }}
                            onDismiss={dismissInconsistency}
                        />
                    )}

                    {/* ═══════════ ZONE B — sections réordonnables ═══════════ */}
                    <div className="flex items-center justify-between gap-2 -mb-1">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                            Sections
                        </p>
                        <PanelSectionsOrganizer
                            layout={layout}
                            onChange={persistLayout}
                            getTitle={sectionTitle}
                        />
                    </div>
                    {visiblePanelSections(layout).map((id) => {
                        if (id === "imported" && !(local.extra && Object.keys(local.extra).length > 0)) return null;
                        if (id === "history" && (local.statusHistory || []).length === 0) return null;

                        const sectionProps = {
                            key: id,
                            id,
                            title: sectionTitle(id),
                            icon: SECTION_ICONS[PANEL_SECTION_META[id]?.icon],
                            onHide: hideSection,
                            onDragStart: (sid) => {
                                setDragSectionId(sid);
                                if (!sid) {
                                    setDragOverId(null);
                                    setDropPlace(null);
                                }
                            },
                            onDragOver: (sid, place) => {
                                setDragOverId(sid);
                                setDropPlace(place);
                            },
                            onDrop: (targetId, place) => {
                                reorderSections(dragSectionId, targetId, place);
                                setDragOverId(null);
                                setDropPlace(null);
                                setDragSectionId(null);
                            },
                            dragOver: dragOverId === id && dragSectionId && dragSectionId !== id,
                            dropPlace: dragOverId === id ? dropPlace : null,
                            isDragging: dragSectionId === id,
                            collapsed: isSectionCollapsed(layout, id),
                            onToggleCollapse: toggleCollapse,
                            badge: id === "imported" && local.extra
                                ? Object.keys(local.extra).length
                                : id === "relances" && (local.relances || []).length > 0
                                    ? (local.relances || []).length
                                    : undefined,
                            flat: infoLayoutRows,
                        };

                        switch (id) {
                            case "imported": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        {infoLayoutRows ? (
                                            <div className="px-1 py-0.5" data-testid="lead-imported-rows">
                                                {Object.entries(local.extra).map(([k, v]) => {
                                                    const alreadyPromoted = (local.customFields || []).some(
                                                        (cf) => cf.label.toLowerCase() === k.toLowerCase() && cf.value
                                                    );
                                                    const isHighlighted = (local.customFields || []).some(
                                                        (cf) => cf.label === k && cf.highlight
                                                    );
                                                    const href = valueAsHref(v);
                                                    const empty = v == null || String(v).trim() === "";
                                                    const Icon = propertyIconFor(k, v);
                                                    return (
                                                        <div
                                                            key={k}
                                                            className="group grid grid-cols-[14px_minmax(0,34%)_minmax(0,1fr)_auto] items-start gap-x-2.5 px-2 py-2 rounded-md hover:bg-muted/40 transition-colors"
                                                        >
                                                            <Icon size={13} strokeWidth={1.75} className="mt-0.5 text-muted-foreground/55 shrink-0" aria-hidden />
                                                            <span className="text-[12px] text-muted-foreground truncate leading-snug pt-0.5" title={k}>{k}</span>
                                                            <div className="min-w-0 flex items-start gap-1 group/row">
                                                                {empty ? (
                                                                    <span className="text-[12.5px] text-muted-foreground/40 italic">Vide</span>
                                                                ) : href ? (
                                                                    <a
                                                                        href={href}
                                                                        target="_blank"
                                                                        rel="noreferrer noopener"
                                                                        className="text-[12.5px] text-primary hover:underline break-all leading-snug"
                                                                    >
                                                                        {displayUrl(href)}
                                                                    </a>
                                                                ) : (
                                                                    <span className="text-[12.5px] text-foreground/90 break-words leading-snug">{String(v)}</span>
                                                                )}
                                                                {!empty && <CopyBtn value={String(v)} className="opacity-0 group-hover/row:opacity-100 mt-0.5" />}
                                                            </div>
                                                            <div className="flex items-center gap-0.5 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => highlightExtraField(k, v)}
                                                                    title={isHighlighted ? "Retirer de la carte Kanban" : "Afficher sur la carte Kanban"}
                                                                    className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                                                                        isHighlighted
                                                                            ? "text-amber-500 bg-amber-500/10"
                                                                            : "text-muted-foreground/35 hover:text-amber-500 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100"
                                                                    }`}
                                                                >
                                                                    <Star size={11} strokeWidth={2} className={isHighlighted ? "fill-amber-500" : ""} />
                                                                </button>
                                                                {alreadyPromoted ? (
                                                                    <span className="w-6 h-6 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                                                        <CheckCircle2 size={12} />
                                                                    </span>
                                                                ) : (
                                                                    <ExtraPromoteButton
                                                                        extraKey={k}
                                                                        value={v}
                                                                        onPromote={promoteExtraField}
                                                                    />
                                                                )}
                                                                <ExtraDeleteButton
                                                                    extraKey={k}
                                                                    extraValue={v}
                                                                    onDelete={deleteLeadExtraField}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <p className="text-[11px] text-muted-foreground px-2 pt-1 pb-2">
                                                    ↑ Ajoute le champ sur <strong>tous les leads</strong> sans écraser.
                                                </p>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
                                                    {Object.entries(local.extra).map(([k, v]) => {
                                                        const alreadyPromoted = (local.customFields || []).some(
                                                            (cf) => cf.label.toLowerCase() === k.toLowerCase() && cf.value
                                                        );
                                                        const isHighlighted = (local.customFields || []).some(
                                                            (cf) => cf.label === k && cf.highlight
                                                        );
                                                        const href = valueAsHref(v);
                                                        return (
                                                            <div
                                                                key={k}
                                                                className="flex items-start gap-2 px-3 py-2 hover:bg-muted/30 transition-colors group"
                                                            >
                                                                <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2 text-sm">
                                                                    <span className="text-muted-foreground truncate text-[11px] font-medium pt-0.5">{k}</span>
                                                                    <span className="min-w-0 flex items-start gap-1 group/row">
                                                                        {href ? (
                                                                            <a
                                                                                href={href}
                                                                                target="_blank"
                                                                                rel="noreferrer noopener"
                                                                                className="text-[12px] text-primary hover:underline break-all leading-snug"
                                                                            >
                                                                                {displayUrl(href)}
                                                                            </a>
                                                                        ) : (
                                                                            <span className="text-[12px] break-words leading-snug">{String(v)}</span>
                                                                        )}
                                                                        <CopyBtn value={String(v)} className="opacity-0 group-hover/row:opacity-100 mt-0.5" />
                                                                    </span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => highlightExtraField(k, v)}
                                                                    title={isHighlighted ? "Retirer de la carte Kanban" : "Afficher sur la carte Kanban"}
                                                                    className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                                                                        isHighlighted
                                                                            ? "text-amber-500 bg-amber-500/10"
                                                                            : "text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100"
                                                                    }`}
                                                                >
                                                                    <Star size={11} strokeWidth={2} className={isHighlighted ? "fill-amber-500" : ""} />
                                                                </button>
                                                                {alreadyPromoted ? (
                                                                    <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center mt-1">
                                                                        <CheckCircle2 size={11} />
                                                                    </span>
                                                                ) : (
                                                                    <ExtraPromoteButton
                                                                        extraKey={k}
                                                                        value={v}
                                                                        onPromote={promoteExtraField}
                                                                    />
                                                                )}
                                                                <ExtraDeleteButton
                                                                    extraKey={k}
                                                                    extraValue={v}
                                                                    onDelete={deleteLeadExtraField}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-[11px] text-muted-foreground px-0.5">
                                                    ↑ Ajoute le champ sur <strong>tous les leads</strong> sans écraser.
                                                </p>
                                            </>
                                        )}
                                    </PanelSectionCard>
                                );
                            }

                            case "contact": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        {infoLayoutRows ? (
                                            <div className="px-1 py-0.5 space-y-0" data-testid="lead-contact-rows">
                                                <FieldGroupRows
                                                    icon={User}
                                                    label={isJobs ? "Recruteur / Contact RH" : "Contact"}
                                                    baseLabel={isJobs ? "Contact RH" : "Contact"}
                                                    value={local.contact}
                                                    onChange={(v) => patch({ contact: v })}
                                                    testId="lead-contact-input"
                                                    customFields={local.customFields || []}
                                                    lastAddedFieldLabel={lastAddedFieldLabel}
                                                    onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                    onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                    onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                    onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                                />
                                                <FieldGroupRows
                                                    icon={Phone}
                                                    label="Téléphone"
                                                    baseLabel="Téléphone"
                                                    value={local.phone}
                                                    onChange={(v) => patch({ phone: v })}
                                                    testId="lead-phone-input"
                                                    type="tel"
                                                    linkHref={telHref(local.phone)}
                                                    customFields={local.customFields || []}
                                                    lastAddedFieldLabel={lastAddedFieldLabel}
                                                    onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                    onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                    onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                    onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                                />
                                                <FieldGroupRows
                                                    icon={Mail}
                                                    label="Email"
                                                    baseLabel="Email"
                                                    value={local.email}
                                                    onChange={(v) => patch({ email: v })}
                                                    testId="lead-email-input"
                                                    type="email"
                                                    linkHref={mailtoHref(local.email)}
                                                    customFields={local.customFields || []}
                                                    lastAddedFieldLabel={lastAddedFieldLabel}
                                                    onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                    onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                    onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                    onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                                />
                                                <FieldGroupRows
                                                    icon={Globe}
                                                    label={isJobs ? "Lien offre / Site entreprise" : "Site web"}
                                                    baseLabel={isJobs ? "Site" : "Site web"}
                                                    value={local.website}
                                                    onChange={(v) => patch({ website: v })}
                                                    testId="lead-website-input"
                                                    linkHref={websiteHref(local.website)}
                                                    linkIsExternal
                                                    customFields={local.customFields || []}
                                                    lastAddedFieldLabel={lastAddedFieldLabel}
                                                    onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                    onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                    onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                    onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                                />
                                                {(local.customFields || []).filter((f) => !isMainFieldDuplicate(f.label)).map((f) => {
                                                    const val = f.value || "";
                                                    const href = valueAsHref(val)
                                                        || (/^[+\d\s.\-()]{7,}$/.test(val) && val.replace(/\D/g, "").length >= 7
                                                            ? `tel:${val.replace(/[^+\d]/g, "")}`
                                                            : null)
                                                        || (val.includes("@") && val.includes(".") ? `mailto:${val.trim()}` : null);
                                                    return (
                                                        <PropertyEditableRow
                                                            key={f.id}
                                                            icon={propertyIconFor(f.label, val)}
                                                            label={f.label}
                                                            value={val}
                                                            onChange={(v) => updateCustomField(f.id, { value: v })}
                                                            linkHref={href}
                                                            linkIsExternal={!!(href && !href.startsWith("tel:") && !href.startsWith("mailto:"))}
                                                            trailing={(
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleHighlightCustomField(f.id, f.highlight, f.label)}
                                                                    title={f.highlight ? "Retirer de la carte" : "Afficher sur la carte"}
                                                                    className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                                                                        f.highlight
                                                                            ? "text-amber-500 bg-amber-500/10"
                                                                            : "text-muted-foreground/30 hover:text-amber-500 opacity-0 group-hover:opacity-100"
                                                                    }`}
                                                                >
                                                                    <Star size={11} strokeWidth={2} className={f.highlight ? "fill-amber-500" : ""} />
                                                                </button>
                                                            )}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                        <div className="space-y-2.5">
                                            <FieldGroup
                                                icon={User}
                                                label={isJobs ? "Recruteur / Contact RH" : "Contact"}
                                                baseLabel={isJobs ? "Contact RH" : "Contact"}
                                                value={local.contact}
                                                onChange={(v) => patch({ contact: v })}
                                                testId="lead-contact-input"
                                                customFields={local.customFields || []}
                                                lastAddedFieldLabel={lastAddedFieldLabel}
                                                onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                            />
                                            <FieldGroup
                                                icon={Phone}
                                                label="Téléphone"
                                                baseLabel="Téléphone"
                                                value={local.phone}
                                                onChange={(v) => patch({ phone: v })}
                                                testId="lead-phone-input"
                                                type="tel"
                                                linkHref={telHref(local.phone)}
                                                customFields={local.customFields || []}
                                                lastAddedFieldLabel={lastAddedFieldLabel}
                                                onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                            />
                                            <FieldGroup
                                                icon={Mail}
                                                label="Email"
                                                baseLabel="Email"
                                                value={local.email}
                                                onChange={(v) => patch({ email: v })}
                                                testId="lead-email-input"
                                                type="email"
                                                linkHref={mailtoHref(local.email)}
                                                customFields={local.customFields || []}
                                                lastAddedFieldLabel={lastAddedFieldLabel}
                                                onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                            />
                                            <FieldGroup
                                                icon={Globe}
                                                label={isJobs ? "Lien offre / Site entreprise" : "Site web"}
                                                baseLabel={isJobs ? "Site" : "Site web"}
                                                value={local.website}
                                                onChange={(v) => patch({ website: v })}
                                                testId="lead-website-input"
                                                linkHref={websiteHref(local.website)}
                                                linkIsExternal
                                                customFields={local.customFields || []}
                                                lastAddedFieldLabel={lastAddedFieldLabel}
                                                onClearLastAdded={() => setLastAddedFieldLabel(null)}
                                                onAdd={(label) => { dispatch({ type: "ADD_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, label, value: "", pinned: false, isMainDuplicate: true }); setLastAddedFieldLabel(label); }}
                                                onUpdateCf={(cid, v) => updateCustomField(cid, { value: v })}
                                                onDeleteCf={(cid) => dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: local.id, fieldId: cid })}
                                            />

                                            {(local.customFields || []).filter((f) => !isMainFieldDuplicate(f.label)).length > 0 && (
                                                <>
                                                    <div className="h-px bg-border/60 -mx-1" />
                                                    <div className="space-y-2">
                                                        {(local.customFields || []).filter((f) => !isMainFieldDuplicate(f.label)).map((f) => {
                                                            const val = f.value || "";
                                                            const href = valueAsHref(val)
                                                                || (/^[+\d\s.\-()]{7,}$/.test(val) && val.replace(/\D/g, "").length >= 7
                                                                    ? `tel:${val.replace(/[^+\d]/g, "")}`
                                                                    : null)
                                                                || (val.includes("@") && val.includes(".") ? `mailto:${val.trim()}` : null);
                                                            const isLong = val.length > 60;
                                                            return (
                                                                <ExpandableCustomField
                                                                    key={f.id}
                                                                    field={f}
                                                                    isLong={isLong}
                                                                    actionHref={href}
                                                                    autoFocus={false}
                                                                    onFocused={() => {}}
                                                                    onUpdate={(v) => updateCustomField(f.id, { value: v })}
                                                                    onToggleHighlight={() => toggleHighlightCustomField(f.id, f.highlight, f.label)}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        )}
                                    </PanelSectionCard>
                                );
                            }

                            case "calendar": {
                                const na = local.nextAction;
                                const overdue = scheduleOverdue;
                                const suggested = isSuggestedRelance(na);
                                const rawDue = na?.dueAt || (na?.date ? `${na.date}T09:00:00` : null);
                                const displayDue = rawDue ? ensureWeekday(new Date(rawDue)) : null;
                                const displayLabel = suggested && displayDue
                                    ? `🔁 Relance suggérée · ${formatFutureRelativeFr(displayDue)}`
                                    : isManualRdv(na)
                                        ? (na.label || "").replace(/^📅\s*RDV détecté\s*·\s*/i, "")
                                        : (na?.label || "Rappel");
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        <div className="space-y-3" data-testid="lead-next-action-card">
                                            {na ? (
                                                <div
                                                    className={cn(
                                                        "rounded-xl border px-3 py-2.5",
                                                        overdue
                                                            ? "bg-rose-500/10 border-rose-500/25 text-rose-800 dark:text-rose-300"
                                                            : isManualRdv(na)
                                                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                                                                : "bg-violet-500/10 border-violet-500/20 text-violet-800 dark:text-violet-300"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {na.auto && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-background/60 font-medium">
                                                                        auto {na.stage || 1}/3
                                                                    </span>
                                                                )}
                                                                {overdue && (
                                                                    <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                                                                        en retard
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-[12px] font-semibold truncate mt-1">
                                                                {displayLabel}
                                                            </p>
                                                            {displayDue && !Number.isNaN(displayDue.getTime()) && (
                                                                <p className="text-[11px] opacity-80 mt-0.5">
                                                                    {displayDue.toLocaleString("fr-FR", {
                                                                        weekday: "short",
                                                                        day: "numeric",
                                                                        month: "short",
                                                                        hour: "2-digit",
                                                                        minute: "2-digit",
                                                                    })}
                                                                </p>
                                                            )}
                                                        </div>
                                                        {suggested && (
                                                            <ConfirmSuggestedRelanceButton
                                                                company={local.company || ""}
                                                                nextAction={na}
                                                                defaultDays={defaultRelanceDays}
                                                                bestDay={prospectSlot?.bestDay || null}
                                                                bestHour={prospectSlot?.bestHour || null}
                                                                onConfirm={applyCalendarReminder}
                                                            />
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingCalendar((v) => !v)}
                                                            title={editingCalendar ? "Fermer l'édition" : "Modifier le créneau"}
                                                            aria-label="Modifier"
                                                            aria-pressed={editingCalendar}
                                                            data-testid="lead-edit-next-action"
                                                            className={cn(
                                                                "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                                                editingCalendar
                                                                    ? "bg-background/70 text-foreground"
                                                                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                                                            )}
                                                        >
                                                            <Pencil size={13} strokeWidth={2} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={clearSchedule}
                                                            title="Supprimer du calendrier"
                                                            aria-label="Supprimer"
                                                            data-testid="lead-clear-next-action"
                                                            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}

                                            {(!na || editingCalendar) && (
                                                <QuickScheduleForm
                                                    key={`${local.id}-${na?.dueAt || na?.date || "new"}-${editingCalendar ? "edit" : "new"}`}
                                                    company={local.company || ""}
                                                    existingNextAction={na || null}
                                                    asMeeting={isManualRdv(na)}
                                                    defaultLabel={
                                                        na
                                                            ? ""
                                                            : (!leadHasBeenContacted(local)
                                                                ? (`Appeler ${local.company || ""}`.trim() || "Premier appel")
                                                                : (`Rappeler ${local.company || ""}`.trim() || "Rappeler"))
                                                    }
                                                    confirmLabel={na ? "Enregistrer" : "Ajouter"}
                                                    onConfirm={(next) => {
                                                        applyCalendarReminder(next);
                                                        setEditingCalendar(false);
                                                    }}
                                                    onCancel={() => setEditingCalendar(false)}
                                                    className="rounded-xl border border-border/70 bg-muted/20 p-3"
                                                />
                                            )}
                                        </div>
                                    </PanelSectionCard>
                                );
                            }

                            case "notes": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        <Textarea
                                            data-testid="lead-note-input"
                                            value={noteDraft}
                                            onChange={(e) => setNoteDraft(e.target.value)}
                                            placeholder="Ajouter une note… Ex : « RDV demain à 14h » ou « 06 12 34 56 78 »"
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                                    e.preventDefault();
                                                    addNote();
                                                }
                                            }}
                                            className="min-h-[70px] resize-none text-sm"
                                        />

                                        {/* ── Détection en temps réel ── */}
                                        {(draftAppointment
                                            || draftDetectedItems.length > 0
                                            || /pas\s*de\s*r[eé]ponse|rappeler|relancer|📵/i.test(noteDraft)
                                        ) && (
                                            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
                                                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-primary uppercase tracking-wider">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <Sparkles size={11} />
                                                        {draftAppointment || draftDetectedItems.length > 0
                                                            ? "Détecté — sera appliqué"
                                                            : "Suggestion calendrier"}
                                                    </span>
                                                </div>
                                                {draftAppointment && (
                                                    <div className="flex items-center justify-between gap-2 text-[12px] text-foreground font-medium">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <CalendarClock size={12} className="text-primary shrink-0" />
                                                            <span className="truncate">RDV → calendrier · {draftAppointment.label}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {!draftAppointment && /pas\s*de\s*r[eé]ponse|rappeler|relancer|📵/i.test(noteDraft) && (
                                                    <p className="text-[12px] text-muted-foreground">
                                                        Astuce : après la note, utilisez l&apos;icône calendrier pour un rappel.
                                                    </p>
                                                )}
                                                {draftDetectedItems.map((item, i) => {
                                                    const willAddPerson = item.type === "person"
                                                        && (draftDiff.willAddPersons || []).includes(item.value);
                                                    const isNew =
                                                        willAddPerson
                                                        || (item.type === "phone" && (draftDiff.newPhone === item.value || draftDiff.extraPhones.includes(item.value)))
                                                        || (item.type === "email" && (draftDiff.newEmail === item.value || (draftDiff.extraEmails || []).includes(item.value)))
                                                        || (item.type === "address" && draftDiff.newAddress === item.value);
                                                    return (
                                                        <div key={i} className={`flex items-center gap-2 text-[12px] rounded-lg px-2 py-0.5 ${isNew ? "text-foreground" : "text-muted-foreground opacity-70"}`}>
                                                            <span className="text-base leading-none shrink-0">{item.icon}</span>
                                                            <span className="font-medium">{item.value}</span>
                                                            {willAddPerson && (
                                                                <span className="ml-auto text-[10px] text-primary">sera ajouté</span>
                                                            )}
                                                            {!isNew && item.type === "person" && (
                                                                <span className="ml-auto text-[10px] opacity-70">sur la fiche</span>
                                                            )}
                                                            {!isNew && item.type !== "person" && (
                                                                <span className="ml-auto text-[10px] opacity-70">déjà présent</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="flex justify-end">
                                            <Button
                                                onClick={addNote}
                                                disabled={noteSaving || !noteDraft.trim()}
                                                data-testid="lead-add-note-btn"
                                                className="h-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                                            >
                                                {noteSaving ? "Enregistrement…" : "Ajouter"}
                                            </Button>
                                        </div>
                                        <div className="space-y-2 pt-2">
                                            {(local.notes || [])
                                                .filter((n) => !n.recordingId)
                                                .map((n) => (
                                                <div
                                                    key={n.id}
                                                    className="rounded-lg border border-border/60 p-3 bg-muted/30"
                                                    data-testid={`lead-note-${n.id}`}
                                                >
                                                    <div className="text-[10px] text-muted-foreground mb-1 font-medium">
                                                        {formatDateTime(n.at)}
                                                    </div>
                                                    <div className="text-sm whitespace-pre-wrap leading-relaxed">
                                                        {n.text}
                                                    </div>
                                                </div>
                                            ))}
                                            {(!local.notes || local.notes.filter((n) => !n.recordingId).length === 0) && (
                                                <p className="text-xs text-muted-foreground/70 italic text-center py-4">
                                                    Aucune note pour l&apos;instant.
                                                </p>
                                            )}
                                        </div>

                                        {/* 💡 Infos détectées dans l'ensemble des notes */}
                                        {detectedFromNotes.length > 0 && (
                                            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                                                <h4 className="text-[11px] uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
                                                    <span>✦</span> Détectés dans les notes
                                                </h4>
                                                <div className="space-y-1">
                                                    {detectedFromNotes.map((item, i) => (
                                                        <div key={i} className="flex items-center gap-2 text-[12.5px]">
                                                            <span className="text-sm shrink-0">{item.icon}</span>
                                                            <span className="text-foreground font-medium truncate">{item.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </PanelSectionCard>
                                );
                            }

                            case "voice": {
                                const voiceNotes = (local.notes || [])
                                    .filter((n) => n.recordingId)
                                    .slice(0, 8);
                                return (
                                    <PanelSectionCard {...sectionProps} badge={voiceNotes.length || undefined}>
                                        <VoiceCallSection
                                            recent={voiceNotes}
                                            leadLabel={local.company || local.contact || "appel"}
                                            workspaceId={workspace.id}
                                            leadId={local.id}
                                        />
                                    </PanelSectionCard>
                                );
                            }

                            case "relances": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        <RelancesWidget lead={local} workspace={workspace} dispatch={dispatch} />
                                    </PanelSectionCard>
                                );
                            }

                            case "tags": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        <div className="flex flex-wrap gap-1.5">
                                            {(local.tags || []).map((t) => (
                                                <span
                                                    key={t}
                                                    data-testid={`lead-tag-${t}`}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-secondary"
                                                >
                                                    {t}
                                                    <button
                                                        onClick={() => removeTag(t)}
                                                        aria-label={`Supprimer le tag ${t}`}
                                                        className="text-muted-foreground hover:text-destructive"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                data-testid="lead-tag-input"
                                                value={tagDraft}
                                                onChange={(e) => setTagDraft(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && addTag()}
                                                placeholder="Ajouter un tag (Entrée)"
                                                className="h-9 text-sm"
                                            />
                                            <Button
                                                onClick={addTag}
                                                variant="secondary"
                                                className="h-9 rounded-lg shrink-0"
                                                data-testid="lead-add-tag-btn"
                                            >
                                                <Plus size={14} />
                                            </Button>
                                        </div>
                                    </PanelSectionCard>
                                );
                            }

                            case "deal": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        <div className={`rounded-lg p-3 space-y-3 ${isJobs ? "bg-violet-500/5" : "bg-emerald-500/5"}`}>
                                            <div className="relative">
                                                <Euro size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                                <Input
                                                    data-testid="lead-deal-value-input"
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder={isJobs ? "ex. 45000 (annuel brut)" : "Montant du deal (ex. 2500)"}
                                                    value={local.dealValue != null ? String(local.dealValue) : ""}
                                                    onChange={(e) => {
                                                        const raw = e.target.value.replace(/[^0-9.,]/g, "").replace(",", ".");
                                                        const num = raw === "" ? null : parseFloat(raw);
                                                        dispatch({
                                                            type: "SET_DEAL_VALUE",
                                                            workspaceId: workspace.id,
                                                            leadId: local.id,
                                                            value: num != null && !isNaN(num) ? num : null,
                                                        });
                                                    }}
                                                    className="pl-8 h-10"
                                                />
                                            </div>
                                            {local.dealValue != null && (
                                                <p className={`text-lg font-semibold ${isJobs ? "text-violet-600 dark:text-violet-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                    {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(local.dealValue)}
                                                    {isJobs && <span className="ml-1 text-sm font-normal text-muted-foreground">/an brut</span>}
                                                    {!isJobs && local.dealClosedAt && (
                                                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                            · closé le {new Date(local.dealClosedAt).toLocaleDateString("fr-FR")}
                                                        </span>
                                                    )}
                                                </p>
                                            )}
                                        </div>
                                    </PanelSectionCard>
                                );
                            }

                            case "history": {
                                return (
                                    <PanelSectionCard {...sectionProps}>
                                        <div className="space-y-1.5">
                                            {[...local.statusHistory]
                                                .reverse()
                                                .map((entry, idx) => {
                                                    const col = workspace.columns[entry.columnId];
                                                    if (!col) return null;
                                                    const cc = getColumnColor(col);
                                                    const isCurrent = idx === 0;
                                                    return (
                                                        <div
                                                            key={idx}
                                                            className={`flex items-center gap-2.5 text-xs ${isCurrent ? "opacity-100" : "opacity-50"}`}
                                                            data-testid={`status-history-${idx}`}
                                                        >
                                                            <span className={`w-2 h-2 rounded-full ${cc.dot} shrink-0`} />
                                                            <span className="font-medium">{col.name}</span>
                                                            <span className="text-muted-foreground text-[11px]">
                                                                · {formatDateTime(entry.at)}
                                                            </span>
                                                            {isCurrent && (
                                                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary ml-auto uppercase tracking-wide font-semibold">
                                                                    actuel
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    </PanelSectionCard>
                                );
                            }

                            default:
                                return null;
                        }
                    })}

                    {/* ═══════════ ZONE C — sections masquées ═══════════ */}
                    <HiddenSectionsMenu
                        items={hiddenPanelSections(layout).map((id) => ({
                            id,
                            label: sectionTitle(id),
                            Icon: SECTION_ICONS[PANEL_SECTION_META[id]?.icon],
                        }))}
                        onRestore={restoreSection}
                    />
                </div>

                <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-2 bg-card rounded-b-xl shrink-0">
                    <div className="text-xs text-muted-foreground truncate min-w-0">
                        Créé le {formatDateTime(local.createdAt)}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <Select
                            value={local.columnId}
                            onValueChange={(v) => changeStatus(v)}
                        >
                            <SelectTrigger
                                data-testid="lead-status-select"
                                className="h-8 w-auto min-h-0 text-[11px] rounded-full bg-secondary/80 border-0 px-2.5 gap-1.5 shadow-none"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {workspace.columnOrder.map((cid) => {
                                    const c = workspace.columns[cid];
                                    const cc = getColumnColor(c);
                                    return (
                                        <SelectItem key={cid} value={cid}>
                                            <span className="flex items-center gap-2">
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${cc.dot}`}
                                                />
                                                {c.name}
                                            </span>
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                        <button
                            type="button"
                            onClick={logContactToday}
                            data-testid="lead-log-today-btn"
                            aria-label={isJobs ? "Marquer relancé" : "Marquer contacté"}
                            title={isJobs ? "Enregistrer une relance aujourd'hui" : "Enregistrer un contact aujourd'hui"}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        >
                            <Phone size={15} strokeWidth={2.25} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            aria-label="Supprimer"
                            title="Supprimer"
                            data-testid="lead-delete-btn"
                            className="w-8 h-8 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                </div>
            </aside>

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent className="rounded-2xl" data-testid="lead-delete-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Supprimer « {local.company || "ce lead"} » ?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Le lead et son historique seront supprimés. Vous pourrez annuler juste après via la notification.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid="confirm-delete-lead-btn"
                            onClick={deleteLead}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            Supprimer
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AddToCalendarDialog
                open={calendarDialogOpen}
                onOpenChange={(open) => {
                    setCalendarDialogOpen(open);
                    if (!open) setCalendarAsMeeting(false);
                }}
                company={local.company || ""}
                defaultLabel={calendarDefaultLabel}
                hint={calendarHint}
                asMeeting={calendarAsMeeting}
                existingNextAction={local.nextAction || null}
                confirmLabel={local.nextAction ? "Enregistrer" : (calendarAsMeeting ? "Planifier" : "Ajouter")}
                onConfirm={applyCalendarReminder}
            />
        </>
    );
};

function propertyIconFor(key, rawValue) {
    const k = String(key || "").toLowerCase();
    const v = rawValue == null ? "" : String(rawValue);
    if (/téléphone|telephone|phone|tel/.test(k)) return Phone;
    if (/email|mail/.test(k)) return Mail;
    if (/website|site|url|lien/.test(k)) return Globe;
    if (/contact|nom|prénom|prenom|dirigeant|recruteur/.test(k)) return User;
    if (/date|depuis|publication/.test(k)) return Calendar;
    if (/ville|adresse|gmaps|postal|département|departement/.test(k)) return MapPin;
    if (v && /^https?:\/\//i.test(v.trim())) return Link2;
    if (v && /^[+\d\s.\-()]{7,}$/.test(v) && v.replace(/\D/g, "").length >= 7) return Phone;
    if (v && v.includes("@") && v.includes(".")) return Mail;
    if (v && /^\d+([.,]\d+)?$/.test(v.trim())) return Hash;
    return AlignLeft;
}

/** Ligne éditable type Notion (fiche prospect mode Lignes). */
const PropertyEditableRow = ({
    icon: Icon,
    label,
    value,
    onChange,
    testId,
    type = "text",
    linkHref,
    linkIsExternal = false,
    trailing = null,
    onAdd = null,
    onDelete = null,
    autoFocus = false,
    onFocused,
}) => {
    const inputRef = useRef(null);
    const empty = value == null || String(value).trim() === "";

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            onFocused?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoFocus]);

    return (
        <div className="group grid grid-cols-[14px_minmax(0,34%)_minmax(0,1fr)_auto] items-start gap-x-2.5 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors">
            <Icon size={13} strokeWidth={1.75} className="mt-1.5 text-muted-foreground/55 shrink-0" aria-hidden />
            <div className="flex items-center gap-1 min-w-0 pt-1">
                <span className="text-[12px] text-muted-foreground truncate leading-snug" title={label}>{label}</span>
                {onAdd && (
                    <button
                        type="button"
                        onClick={onAdd}
                        title="Ajouter un doublon"
                        className="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/30 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                        <Plus size={11} strokeWidth={2.5} />
                    </button>
                )}
            </div>
            <div className="min-w-0 flex items-start gap-1 group/row">
                <input
                    ref={inputRef}
                    data-testid={testId}
                    type={type}
                    value={value || ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="Vide"
                    className={`flex-1 min-w-0 bg-transparent outline-none text-[12.5px] leading-snug py-1 rounded px-1 -mx-1 focus:bg-muted/50 ${
                        empty ? "text-muted-foreground/40 italic placeholder:italic" : "text-foreground/90"
                    } ${autoFocus ? "ring-1 ring-primary/40" : ""}`}
                />
                {!empty && <CopyBtn value={String(value)} className="opacity-0 group-hover/row:opacity-100 mt-1" />}
            </div>
            <div className="flex items-center gap-0.5 shrink-0 pt-0.5">
                {linkHref && !empty && (
                    <a
                        href={linkHref}
                        target={linkIsExternal ? "_blank" : undefined}
                        rel={linkIsExternal ? "noreferrer noopener" : undefined}
                        title={linkIsExternal ? displayUrl(linkHref) : value}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-primary/70 hover:bg-primary/10 opacity-0 group-hover:opacity-100"
                    >
                        <Link2 size={12} strokeWidth={2} />
                    </a>
                )}
                {trailing}
                {onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        title={`Supprimer ${label}`}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground/25 hover:text-rose-500 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100"
                    >
                        <X size={12} strokeWidth={2} />
                    </button>
                )}
            </div>
        </div>
    );
};

const FieldGroupRows = ({
    icon: Icon,
    label,
    baseLabel,
    value,
    onChange,
    testId,
    type = "text",
    linkHref,
    linkIsExternal = false,
    customFields,
    lastAddedFieldLabel,
    onClearLastAdded,
    onAdd,
    onUpdateCf,
    onDeleteCf,
}) => {
    const base = baseLabel.toLowerCase();
    const dupes = (customFields || []).filter((f) => {
        const n = (f.label || "").toLowerCase().trim();
        if (n === base) return true;
        return new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\d+$").test(n);
    });
    const nextNum = (() => {
        let max = 1;
        for (const f of dupes) {
            const m = (f.label || "").toLowerCase().trim().match(/(\d+)\s*$/);
            if (m) max = Math.max(max, Number(m[1]));
            else max = Math.max(max, 2);
        }
        return max + 1;
    })();

    const resolveHref = (val) => {
        if (!val) return null;
        if (/^[+\d\s.\-()]{7,}$/.test(val) && val.replace(/\D/g, "").length >= 7) {
            return "tel:" + val.replace(/[^+\d]/g, "");
        }
        if (val.includes("@") && val.includes(".")) return "mailto:" + val.trim();
        return valueAsHref(val);
    };

    return (
        <>
            <PropertyEditableRow
                icon={Icon}
                label={label}
                value={value}
                onChange={onChange}
                testId={testId}
                type={type}
                linkHref={linkHref}
                linkIsExternal={linkIsExternal}
                onAdd={() => onAdd(baseLabel + " " + nextNum)}
            />
            {dupes.map((f) => (
                <PropertyEditableRow
                    key={f.id}
                    icon={Icon}
                    label={f.label}
                    value={f.value || ""}
                    onChange={(v) => onUpdateCf(f.id, v)}
                    type={type}
                    linkHref={resolveHref(f.value)}
                    linkIsExternal={!!(resolveHref(f.value) && !String(resolveHref(f.value)).startsWith("tel:") && !String(resolveHref(f.value)).startsWith("mailto:"))}
                    autoFocus={lastAddedFieldLabel === f.label}
                    onFocused={onClearLastAdded}
                    onDelete={() => onDeleteCf(f.id)}
                />
            ))}
        </>
    );
};

const ExtraPromoteButton = ({ extraKey, value, onPromote }) => {
    if (!value) return null;

    return (
        <button
            onClick={() => onPromote(extraKey)}
            title={`Ajouter « ${extraKey} » comme champ personnalisé pour tous les leads (sans écraser)`}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
            aria-label={`Promouvoir ${extraKey}`}
        >
            <ArrowUp size={13} strokeWidth={2.5} />
        </button>
    );
};

const ExtraDeleteButton = ({ extraKey, extraValue, onDelete }) => {
    const [confirm, setConfirm] = useState(false);

    if (confirm) {
        return (
            <div className="flex items-center gap-1 shrink-0">
                <button
                    onClick={() => setConfirm(false)}
                    className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
                >
                    Non
                </button>
                <button
                    onClick={() => { onDelete(extraKey, extraValue); setConfirm(false); }}
                    className="text-[10px] font-medium text-white bg-rose-500 hover:bg-rose-600 px-1.5 py-0.5 rounded transition-colors"
                >
                    Oui
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => setConfirm(true)}
            title={`Supprimer « ${extraKey} » de ce lead et tous ceux avec la même valeur`}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
            aria-label={`Supprimer ${extraKey}`}
        >
            <Trash2 size={12} strokeWidth={2} />
        </button>
    );
};

/**
 * Retourne true si le label d'un customField correspond à un doublon
 * de champ principal (ex: "Téléphone 2", "Email 3", "Contact 2", "Site web 2"…)
 * Ces champs sont affichés dans FieldGroup, pas dans la section "Infos complémentaires".
 */
function isMainFieldDuplicate(label) {
    return isMainFieldDuplicateLabel(label);
}

const ExpandableCustomField = ({ field: f, isLong, actionHref, onUpdate, onToggleHighlight, autoFocus = false, onFocused }) => {
    const [expanded, setExpanded] = useState(false);
    const inputRef = useRef(null);
    const val = f.value || "";
    const isExternal = actionHref && !actionHref.startsWith("tel:") && !actionHref.startsWith("mailto:");

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            onFocused?.();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoFocus]);

    return (
        <div
            className="flex items-start gap-2 group/cf"
            data-testid={`custom-field-display-${f.id}`}
        >
            <Label className="text-[11px] text-muted-foreground w-2/5 truncate shrink-0 font-medium flex items-center gap-1 mt-2">
                {f.highlight && <Star size={9} className="text-amber-500 fill-amber-500 shrink-0" />}
                {f.label}
            </Label>
            <div className="flex-1 min-w-0 space-y-1">
                {expanded ? (
                    <textarea
                        value={f.value}
                        onChange={(e) => onUpdate(e.target.value)}
                        placeholder="—"
                        rows={3}
                        className="w-full text-sm rounded-md border border-input bg-background px-3 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                ) : (
                    <Input
                        ref={inputRef}
                        value={f.value}
                        onChange={(e) => onUpdate(e.target.value)}
                        placeholder="—"
                        className={`h-8 text-sm transition-all ${autoFocus ? "ring-2 ring-primary border-primary" : ""}`}
                    />
                )}
                {actionHref && val && (
                    <a
                        href={actionHref}
                        target={isExternal ? "_blank" : undefined}
                        rel={isExternal ? "noreferrer noopener" : undefined}
                        className="inline-block text-[11px] text-primary hover:underline break-all leading-snug"
                    >
                        {isExternal ? displayUrl(actionHref) : val}
                    </a>
                )}
            </div>
            {val && <CopyBtn value={val} className="mt-2 opacity-0 group-hover/cf:opacity-100" />}
            {isLong && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    title={expanded ? "Réduire" : "Déplier"}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-primary hover:bg-primary/10"
                >
                    <ChevronDown
                        size={13}
                        strokeWidth={2}
                        className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                    />
                </button>
            )}
            <button
                type="button"
                onClick={onToggleHighlight}
                title={f.highlight ? "Retirer de la carte Kanban" : "Afficher sur la carte Kanban"}
                className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    f.highlight
                        ? "text-amber-500 bg-amber-500/10"
                        : "text-muted-foreground/30 hover:text-amber-500 hover:bg-amber-500/10 opacity-0 group-hover/cf:opacity-100"
                }`}
            >
                <Star size={13} strokeWidth={2} className={f.highlight ? "fill-amber-500" : ""} />
            </button>
        </div>
    );
};

const FieldGroup = ({
    icon: Icon,
    label,
    baseLabel,
    value,
    onChange,
    testId,
    type = "text",
    linkHref,
    linkIsExternal = false,
    customFields,
    lastAddedFieldLabel,
    onClearLastAdded,
    onAdd,
    onUpdateCf,
    onDeleteCf,
}) => {
    const base = baseLabel.toLowerCase();
    const dupes = (customFields || []).filter((f) => {
        const n = (f.label || "").toLowerCase().trim();
        if (n === base) return true; // ancien format « Contact » sans numéro
        return new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\d+$").test(n);
    });
    const nextNum = (() => {
        let max = 1;
        for (const f of dupes) {
            const m = (f.label || "").toLowerCase().trim().match(/(\d+)\s*$/);
            if (m) max = Math.max(max, Number(m[1]));
            else max = Math.max(max, 2); // plain « Contact »
        }
        return max + 1;
    })();

    const resolveHref = (val) => {
        if (!val) return null;
        if (/^[+\d\s.\-()]{7,}$/.test(val) && val.replace(/\D/g, "").length >= 7) {
            return "tel:" + val.replace(/[^+\d]/g, "");
        }
        if (val.includes("@") && val.includes(".")) return "mailto:" + val.trim();
        return valueAsHref(val);
    };

    return (
        <div className="space-y-1.5">
            <div>
                <div className="flex items-center gap-1 mb-1">
                    <Label className="text-xs text-muted-foreground flex-1">{label}</Label>
                    <button
                        type="button"
                        onClick={() => onAdd(baseLabel + " " + nextNum)}
                        title={"Ajouter " + baseLabel + " " + nextNum}
                        className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                        <Plus size={12} strokeWidth={2.5} />
                    </button>
                </div>
                <div className="relative flex items-center gap-1.5 group/row">
                    <div className="relative flex-1">
                        <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                            data-testid={testId}
                            type={type}
                            value={value || ""}
                            onChange={(e) => onChange(e.target.value)}
                            className="pl-9 h-10"
                        />
                    </div>
                    {value && <CopyBtn value={value} className="opacity-0 group-hover/row:opacity-100" />}
                </div>
                {linkHref && value && (
                    <a
                        href={linkHref}
                        target={linkIsExternal ? "_blank" : undefined}
                        rel={linkIsExternal ? "noreferrer noopener" : undefined}
                        className="inline-block mt-1 text-[11px] text-primary hover:underline break-all"
                    >
                        {linkIsExternal ? displayUrl(linkHref) : value}
                    </a>
                )}
            </div>

            {dupes.map((f) => (
                <DupeField
                    key={f.id}
                    icon={Icon}
                    field={f}
                    type={type}
                    linkHref={resolveHref(f.value)}
                    autoFocus={lastAddedFieldLabel === f.label}
                    onFocused={onClearLastAdded}
                    onUpdate={(v) => onUpdateCf(f.id, v)}
                    onDelete={() => onDeleteCf(f.id)}
                />
            ))}
        </div>
    );
};

/** Ligne dupliquée — même rendu que Field, + bouton X au hover pour supprimer */
const DupeField = ({ icon: Icon, field: f, type = "text", linkHref, autoFocus, onFocused, onUpdate, onDelete }) => {
    const inputRef = useRef(null);
    const isExternal = linkHref && !linkHref.startsWith("tel:") && !linkHref.startsWith("mailto:");

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            onFocused && onFocused();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoFocus]);

    return (
        <div className="group/dupe">
            <Label className="text-xs text-muted-foreground mb-1 block">{f.label}</Label>
            <div className="relative flex items-center gap-1.5 group/row">
                <div className="relative flex-1">
                    <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                        ref={inputRef}
                        type={type}
                        value={f.value || ""}
                        onChange={(e) => onUpdate(e.target.value)}
                        placeholder="—"
                        className={"pl-9 h-10" + (autoFocus ? " ring-2 ring-primary" : "")}
                    />
                </div>
                {f.value && <CopyBtn value={f.value} className="opacity-0 group-hover/row:opacity-100" />}
                <button
                    type="button"
                    onClick={onDelete}
                    title={"Supprimer " + f.label}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/20 hover:text-rose-500 hover:bg-rose-500/10 transition-colors opacity-0 group-hover/dupe:opacity-100"
                >
                    <X size={13} strokeWidth={2} />
                </button>
            </div>
            {linkHref && f.value && (
                <a
                    href={linkHref}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noreferrer noopener" : undefined}
                    className="inline-block mt-1 text-[11px] text-primary hover:underline break-all"
                >
                    {isExternal ? displayUrl(linkHref) : f.value}
                </a>
            )}
        </div>
    );
};
