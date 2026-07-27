import React, { useEffect, useState, useMemo } from "react";
import { Phone, PhoneOff, Save, X, Sparkles, CalendarClock, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/context/CrmContext";
import {
    formatDateTimeLong,
    toLocalDateKey,
    addDaysSkippingWeekend,
    addDaysSkippingWeekendIso,
    formatFutureRelativeFr,
    suggestNoAnswerFollowUp,
    formatNoAnswerFollowUpLabel,
} from "@/lib/dateUtils";
import { allocateMainDupeLabels } from "@/lib/customFields";
import { parseNote, diffWithLead, formatDetected, detectAppointment } from "@/lib/noteParser";
import { makeRdvNextAction, makeCalendarReminder } from "@/lib/nextActionUtils";
import { resolvePipelineColumnId } from "@/lib/pipelineRoles";
import { saveCallRecording } from "@/lib/callRecordings";
import { CallRecorderBar } from "@/components/CallRecorderBar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Défaut chips Joint — indépendant du seuil « vigilance pas de réponse ». */
const DEFAULT_JOINT_RELANCE_DAYS = 2;
const RELANCE_DAY_CHIPS = [1, 2, 3, 4, 5, 6, 7];

const newRecordingId = () =>
    `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const CallNoteModal = ({
    open,
    workspace,
    lead,
    onClose,
    onAutoMoved,
    /** Si fourni (mode rapide) : déplacer vers cette colonne uniquement à l'enregistrement, pas à l'ouverture */
    pendingMoveToColumnId = null,
}) => {
    const { dispatch } = useCrm();
    const [text, setText] = useState("");
    /** 'reached' | 'noanswer' — défaut Joint (on arrive souvent via Contacté). */
    const [outcome, setOutcome] = useState("reached");
    const [outcomeManual, setOutcomeManual] = useState(false);
    const [suggestSchedule, setSuggestSchedule] = useState(true);
    const [relanceDays, setRelanceDays] = useState(DEFAULT_JOINT_RELANCE_DAYS);
    const [pendingRecording, setPendingRecording] = useState(null);
    const [recordingBusy, setRecordingBusy] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setText("");
            setOutcome("reached");
            setOutcomeManual(false);
            setSuggestSchedule(true);
            setRelanceDays(DEFAULT_JOINT_RELANCE_DAYS);
            setPendingRecording(null);
            setRecordingBusy(false);
            setSaving(false);
        }
    }, [open, lead?.id]);

    const handleTextChange = (e) => {
        const val = e.target.value;
        setText(val);
        // Texte / vocal → Joint, sauf si l'utilisateur a choisi manuellement
        if (!outcomeManual && val.trim().length > 0) {
            setOutcome("reached");
        }
    };

    const handleOutcomeClick = (value) => {
        setOutcome(value);
        setOutcomeManual(true);
        setSuggestSchedule(true);
        if (value === "reached") {
            setRelanceDays(DEFAULT_JOINT_RELANCE_DAYS);
        }
    };

    /** Vocal = interlocuteur joint (sauf choix manuel « Pas de réponse »). */
    const handleRecordingChange = (rec) => {
        setPendingRecording(rec);
        if (rec?.blob && !outcomeManual) {
            setOutcome("reached");
        }
    };

    const detected = useMemo(() => parseNote(text), [text]);
    const diff = useMemo(
        () => (lead
            ? diffWithLead(detected, lead)
            : {
                newPhone: null,
                extraPhones: [],
                newEmail: null,
                extraEmails: [],
                newAddress: null,
                newContact: null,
                extraContacts: [],
                willAddPersons: [],
            }),
        [detected, lead]
    );
    const detectedItems = useMemo(() => formatDetected(detected), [detected]);
    const appointment = useMemo(() => detectAppointment(text), [text]);

    const hasNewInfo = !!(
        diff.newPhone
        || diff.extraPhones.length > 0
        || diff.newEmail
        || (diff.extraEmails || []).length > 0
        || diff.newAddress
        || diff.newContact
        || (diff.extraContacts || []).length > 0
    );

    const showSchedule = !appointment && (outcome === "noanswer" || outcome === "reached");

    const save = async () => {
        if (!lead || !open || saving || recordingBusy) return;
        const finalOutcome = outcome === "noanswer" ? "noanswer" : "reached";
        const content = text.trim();

        setSaving(true);
        let recordingId = null;
        if (pendingRecording?.blob) {
            try {
                recordingId = newRecordingId();
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
                console.warn("[CallNote] save recording failed:", err);
                toast.error("Audio non sauvegardé", {
                    description: "La note sera quand même enregistrée",
                });
                recordingId = null;
            }
        }

        let effectiveColumnId = lead.columnId;
        if (pendingMoveToColumnId && lead.columnId !== pendingMoveToColumnId) {
            onAutoMoved?.(lead.id);
            dispatch({
                type: "MOVE_LEAD_ORDERED",
                workspaceId: workspace.id,
                leadId: lead.id,
                toColumnId: pendingMoveToColumnId,
                toIndex: null,
            });
            effectiveColumnId = pendingMoveToColumnId;
        }

        const noteText = finalOutcome === "reached"
            ? (content ? `📞 Joint · ${content}` : "📞 Joint")
            : (content ? `📵 Pas de réponse · ${content}` : "📵 Pas de réponse");

        if (finalOutcome === "reached") {
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
                recordingId,
            });
        }

        const meetingColumnId = resolvePipelineColumnId(workspace, "rdv");
        const meetingColumn = meetingColumnId ? workspace.columns[meetingColumnId] : null;

        const relanceColumnId = resolvePipelineColumnId(workspace, "relance");
        const autoFollowupColumn = workspace.columnOrder
            .map((cid) => workspace.columns[cid])
            .find((c) => c?.autoFollowup)
            || (relanceColumnId ? workspace.columns[relanceColumnId] : null);

        const shouldMoveToMeeting =
            !!appointment && meetingColumn && effectiveColumnId !== meetingColumn.id;

        // Pas de réponse + rappel programmé → colonne Relance (sinon on reste où on est)
        const shouldMoveToFollowup =
            !appointment
            && finalOutcome === "noanswer"
            && suggestSchedule
            && autoFollowupColumn
            && effectiveColumnId !== autoFollowupColumn.id;

        if (shouldMoveToMeeting) {
            onAutoMoved?.(lead.id);
            dispatch({
                type: "MOVE_LEAD_ORDERED",
                workspaceId: workspace.id,
                leadId: lead.id,
                toColumnId: meetingColumn.id,
                toIndex: null,
            });
            effectiveColumnId = meetingColumn.id;
        } else if (shouldMoveToFollowup) {
            onAutoMoved?.(lead.id);
            dispatch({
                type: "MOVE_LEAD_ORDERED",
                workspaceId: workspace.id,
                leadId: lead.id,
                toColumnId: autoFollowupColumn.id,
                toIndex: null,
            });
            effectiveColumnId = autoFollowupColumn.id;
        }

        const patch = {};
        if (diff.newPhone) patch.phone = diff.newPhone;
        if (diff.newEmail) patch.email = diff.newEmail;
        if (diff.newContact) patch.contact = diff.newContact;

        if (appointment) {
            patch.nextAction = makeRdvNextAction({
                date: toLocalDateKey(appointment.iso),
                dueAt: appointment.iso,
                label: appointment.label,
            });
            patch.autoFollowup = null;
        } else if (suggestSchedule) {
            if (finalOutcome === "noanswer") {
                const dueDate = suggestNoAnswerFollowUp();
                const dueAt = dueDate.toISOString();
                const dateKey = toLocalDateKey(dueDate);
                const relative = formatNoAnswerFollowUpLabel(dueDate);
                const currentStage = lead.autoFollowup?.stage ?? 0;
                const nextStage = Math.min((currentStage || 0) + 1, 3);
                const now = new Date().toISOString();
                // Relance auto pipeline (étapes 1→3) — distinct d'un simple rappel calendrier
                patch.autoFollowup = {
                    stage: nextStage,
                    dueAt,
                    startedAt: lead.autoFollowup?.startedAt || now,
                    columnId: effectiveColumnId,
                    overdue: false,
                };
                patch.nextAction = {
                    date: dateKey,
                    dueAt,
                    label: `📵 Pas de réponse · rappel ${relative}`,
                    auto: true,
                    stage: nextStage,
                };
            } else {
                // Joint → rappel calendrier confirmé (pas d'étape « suggérée » à re-valider)
                const days = Math.min(Math.max(1, Number(relanceDays) || 1), 7);
                const dueDate = addDaysSkippingWeekend(days);
                dueDate.setHours(9, 0, 0, 0);
                const dueAt = dueDate.toISOString();
                const dateKey = toLocalDateKey(dueDate);
                const relative = formatFutureRelativeFr(dueDate);
                patch.autoFollowup = null;
                patch.nextAction = makeCalendarReminder({
                    date: dateKey,
                    dueAt,
                    label: `Relancer · ${relative}`,
                });
            }
        } else if (finalOutcome === "reached") {
            // Joint sans rappel : pas de relance auto fantôme (ex. si Contacté a le flag colonne)
            patch.autoFollowup = null;
        } else if (finalOutcome === "noanswer" && !suggestSchedule) {
            // Note seule — ne pas laisser un FU armé par un MOVE vers Relance (on n'y va plus)
            // ni écraser un RDV manuel existant
        }

        if (Object.keys(patch).length > 0) {
            dispatch({
                type: "UPDATE_LEAD",
                workspaceId: workspace.id,
                leadId: lead.id,
                patch,
            });
        }

        const isJobs = workspace.template === "jobs";
        const phoneLabels = allocateMainDupeLabels(lead.customFields, "Téléphone", (diff.extraPhones || []).length);
        (diff.extraPhones || []).forEach((phone, i) => {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: lead.id,
                label: phoneLabels[i] || `Téléphone ${i + 2}`,
                value: phone,
                pinned: false,
                isMainDuplicate: true,
            });
        });

        const emailLabels = allocateMainDupeLabels(lead.customFields, "Email", (diff.extraEmails || []).length);
        (diff.extraEmails || []).forEach((email, i) => {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: lead.id,
                label: emailLabels[i] || `Email ${i + 2}`,
                value: email,
                pinned: false,
                isMainDuplicate: true,
            });
        });

        const contactBase = isJobs ? "Contact RH" : "Contact";
        const contactLabels = allocateMainDupeLabels(
            lead.customFields,
            contactBase,
            (diff.extraContacts || []).length
        );
        (diff.extraContacts || []).forEach((person, i) => {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: lead.id,
                label: contactLabels[i] || `${contactBase} ${i + 2}`,
                value: person,
                pinned: false,
                highlight: true,
                isMainDuplicate: true,
            });
        });

        if (diff.newAddress) {
            dispatch({
                type: "ADD_CUSTOM_FIELD",
                workspaceId: workspace.id,
                leadId: lead.id,
                label: "Adresse",
                value: diff.newAddress,
                pinned: false,
            });
        }

        onClose();
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape" && open) onClose();
            if (e.key === "Enter" && open && !saving && !recordingBusy) {
                if (e.target.tagName === "TEXTAREA") {
                    if (e.metaKey || e.ctrlKey) save();
                } else {
                    save();
                }
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, text, outcome, pendingMoveToColumnId, suggestSchedule, relanceDays, pendingRecording, saving, recordingBusy]);

    if (!open || !lead) return null;

    const isMac = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
    const noAnswerDue = suggestNoAnswerFollowUp();
    const noAnswerDueLabel = formatNoAnswerFollowUpLabel(noAnswerDue);
    const relanceDueDate = addDaysSkippingWeekendIso(relanceDays);
    const relanceDueLabel = new Date(relanceDueDate).toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
    });
    const schedulePreviewLabel = outcome === "noanswer"
        ? noAnswerDueLabel
        : relanceDueLabel;

    const scheduleTitle = outcome === "noanswer"
        ? "Relance auto"
        : "Rappel calendrier";
    const scheduleHint = outcome === "noanswer"
        ? "Colonne Relance · matin → après-midi · sinon +1 j · ven. soir → lun. matin"
        : "Hors week-end · 9 h";

    const skip = () => onClose();

    const footerHint = hasNewInfo
        ? "Fiche mise à jour"
        : appointment
            ? `RDV · ${appointment.label}`
            : suggestSchedule && showSchedule
                ? (outcome === "noanswer"
                    ? `Relance auto · ${schedulePreviewLabel}`
                    : `Rappel · ${schedulePreviewLabel}`)
                : null;

    return (
        <>
            <div
                className="fixed inset-0 z-[60] bg-foreground/20 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={skip}
                data-testid="call-note-backdrop"
            />
            <div
                data-testid="call-note-modal"
                className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-1.5rem)] max-w-[420px] max-h-[min(92dvh,640px)] bg-card rounded-2xl shadow-panel border border-border overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
            >
                <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Phone size={18} className="text-primary" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base font-semibold tracking-tight">Note d&apos;appel</h3>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {lead.company}
                                <span className="opacity-50"> · </span>
                                {formatDateTimeLong(new Date().toISOString())}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={skip}
                        data-testid="call-note-close"
                        aria-label="Fermer"
                        className="w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground shrink-0 flex items-center justify-center"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="px-5 pb-2 space-y-3 overflow-y-auto flex-1 min-h-0">
                    <div
                        className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary/60"
                        role="group"
                        aria-label="Résultat de l'appel"
                    >
                        <button
                            type="button"
                            data-testid="call-outcome-reached"
                            onClick={() => handleOutcomeClick("reached")}
                            className={cn(
                                "h-10 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
                                outcome === "reached"
                                    ? "bg-card text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Phone size={14} strokeWidth={2} />
                            Joint
                        </button>
                        <button
                            type="button"
                            data-testid="call-outcome-noanswer"
                            onClick={() => handleOutcomeClick("noanswer")}
                            className={cn(
                                "h-10 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors",
                                outcome === "noanswer"
                                    ? "bg-card text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <PhoneOff size={14} strokeWidth={2} />
                            Pas de réponse
                        </button>
                    </div>

                    <Textarea
                        data-testid="call-note-text"
                        value={text}
                        onChange={handleTextChange}
                        placeholder="Que s'est-il dit ? Ex. « Rappeler mardi 14h »"
                        autoFocus
                        className="min-h-[88px] resize-none rounded-xl text-sm border-border"
                    />

                    <CallRecorderBar
                        onChange={handleRecordingChange}
                        onBusyChange={setRecordingBusy}
                        disabled={saving}
                    />

                    {appointment && (
                        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
                            <CalendarClock size={15} className="text-foreground shrink-0 opacity-70" strokeWidth={1.75} />
                            <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-medium text-foreground truncate">
                                    RDV · {appointment.label}
                                </p>
                                <p className="text-[10px] text-muted-foreground">Sera enregistré à la sauvegarde</p>
                            </div>
                        </div>
                    )}

                    {showSchedule && (
                        <div
                            className="rounded-xl border border-border bg-secondary/30 px-3 py-2.5 space-y-2"
                            data-testid="call-relance-suggest"
                        >
                            <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={suggestSchedule}
                                    onChange={(e) => setSuggestSchedule(e.target.checked)}
                                    className="rounded border-border accent-primary"
                                    data-testid="call-relance-toggle"
                                />
                                <BellRing size={13} className="text-muted-foreground shrink-0" strokeWidth={2} />
                                <span className="text-[12.5px] font-medium text-foreground flex-1 min-w-0">
                                    {scheduleTitle}
                                </span>
                                {suggestSchedule && (
                                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                                        {schedulePreviewLabel}
                                    </span>
                                )}
                            </label>

                            {suggestSchedule && outcome === "reached" && (
                                <div className="flex flex-wrap gap-1 pl-7">
                                    {RELANCE_DAY_CHIPS.map((d) => (
                                        <button
                                            key={d}
                                            type="button"
                                            data-testid={`call-relance-days-${d}`}
                                            onClick={() => setRelanceDays(d)}
                                            className={cn(
                                                "h-7 min-w-[2rem] px-2 rounded-lg text-[11px] font-medium transition-colors",
                                                relanceDays === d
                                                    ? "bg-foreground text-background"
                                                    : "bg-background/80 text-muted-foreground hover:text-foreground border border-border"
                                            )}
                                        >
                                            +{d}j
                                        </button>
                                    ))}
                                </div>
                            )}

                            {suggestSchedule && (
                                <p className="pl-7 text-[10px] text-muted-foreground leading-snug">
                                    {scheduleHint}
                                </p>
                            )}
                        </div>
                    )}

                    {detectedItems.length > 0 && (
                        <div className="rounded-xl border border-border px-3 py-2.5 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                <Sparkles size={11} strokeWidth={2} />
                                Détecté dans la note
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {detectedItems.map((item, i) => {
                                    const willAddPerson = item.type === "person"
                                        && (diff.willAddPersons || []).includes(item.value);
                                    const isNew =
                                        willAddPerson
                                        || (item.type === "phone" && (diff.newPhone === item.value || diff.extraPhones.includes(item.value)))
                                        || (item.type === "email" && (diff.newEmail === item.value || (diff.extraEmails || []).includes(item.value)))
                                        || (item.type === "address" && diff.newAddress === item.value);
                                    const personOnFile = item.type === "person"
                                        && !willAddPerson
                                        && (
                                            (lead.contact || "").trim().toLowerCase() === item.value.trim().toLowerCase()
                                            || (lead.customFields || []).some(
                                                (cf) => /contact|interlocuteur|personne|nom/i.test(cf.label || "")
                                                    && (cf.value || "").trim().toLowerCase() === item.value.trim().toLowerCase()
                                            )
                                        );

                                    return (
                                        <span
                                            key={i}
                                            className={cn(
                                                "inline-flex items-center gap-1 max-w-full rounded-lg px-2 py-1 text-[11px] border border-border",
                                                isNew
                                                    ? "bg-secondary/60 text-foreground"
                                                    : personOnFile
                                                        ? "text-muted-foreground"
                                                        : "text-muted-foreground/60 line-through"
                                            )}
                                            title={
                                                isNew
                                                    ? "Sera ajouté"
                                                    : personOnFile
                                                        ? "Déjà sur la fiche"
                                                        : "Déjà présent"
                                            }
                                        >
                                            <span className="shrink-0">{item.icon}</span>
                                            <span className="truncate font-medium">{item.value}</span>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between gap-2 bg-secondary/20 shrink-0">
                    <p className="text-[10px] text-muted-foreground min-w-0 truncate">
                        {footerHint || (
                            <>
                                <kbd className="font-mono opacity-70">{isMac ? "⌘" : "Ctrl"}+↵</kbd>
                                {" "}dans la note
                            </>
                        )}
                    </p>
                    <div className="flex gap-1.5 shrink-0">
                        <Button
                            variant="ghost"
                            onClick={skip}
                            data-testid="call-note-skip"
                            className="h-9 rounded-full px-3 text-[13px]"
                        >
                            Passer
                        </Button>
                        <Button
                            onClick={save}
                            disabled={saving || recordingBusy}
                            data-testid="call-note-save"
                            className="h-9 rounded-full px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-[13px]"
                        >
                            <Save size={13} className="mr-1.5" />
                            {saving ? "…" : recordingBusy ? "Stop d'abord" : "Enregistrer"}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
};
