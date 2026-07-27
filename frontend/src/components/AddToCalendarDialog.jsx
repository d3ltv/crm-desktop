import React, { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    addDaysSkippingWeekend,
    daysUntilWeekday,
    ensureWeekday,
    isSunday,
    formatFutureRelativeFr,
    toLocalDateKey,
} from "@/lib/dateUtils";
import { makeCalendarReminder, makeRdvNextAction, isManualRdv } from "@/lib/nextActionUtils";
import { CalendarPlus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const RELANCE_DAY_CHIPS = [1, 2, 3, 4, 5, 6, 7];

function tomorrowKey() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toLocalDateKey(d);
}

function timeFromDue(isoOrDate) {
    if (!isoOrDate) return "09:00";
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return "09:00";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function cleanScheduleLabel(na) {
    if (!na?.label) return "";
    return String(na.label)
        .replace(/^📅\s*RDV détecté\s*[·—-]?\s*/i, "")
        .replace(/^📅\s*RDV\s*[·—-]?\s*/i, "")
        .replace(/^📅\s*Rappel\s*[·—-]?\s*/i, "")
        .replace(/^🔁\s*Relance suggérée\s*[·—-]?\s*/i, "")
        .trim();
}

/**
 * Formulaire compact : date + heure natives.
 * Avec `existingNextAction`, préremplit le créneau et conserve le type RDV/rappel.
 */
export function QuickScheduleForm({
    company = "",
    defaultLabel = "",
    hint = "",
    onConfirm,
    onCancel,
    confirmLabel = "Ajouter",
    className,
    existingNextAction = null,
    asMeeting = false,
}) {
    const seed = !!existingNextAction?.dueAt || !!existingNextAction?.date;
    const [date, setDate] = useState(() =>
        seed
            ? (toLocalDateKey(existingNextAction.dueAt || existingNextAction.date) || tomorrowKey())
            : tomorrowKey()
    );
    const [time, setTime] = useState(() =>
        seed ? timeFromDue(existingNextAction.dueAt || `${existingNextAction.date}T09:00:00`) : "09:00"
    );
    const [label, setLabel] = useState(() =>
        seed
            ? (cleanScheduleLabel(existingNextAction) || defaultLabel || "")
            : (defaultLabel || (company ? `Rappeler ${company}` : ""))
    );

    useEffect(() => {
        if (existingNextAction?.dueAt || existingNextAction?.date) {
            const due = existingNextAction.dueAt || `${existingNextAction.date}T09:00:00`;
            setDate(toLocalDateKey(due) || tomorrowKey());
            setTime(timeFromDue(due));
            setLabel(cleanScheduleLabel(existingNextAction) || defaultLabel || "");
            return;
        }
        setDate(tomorrowKey());
        setTime("09:00");
        setLabel(defaultLabel || (company ? `Rappeler ${company}` : ""));
    }, [
        company,
        defaultLabel,
        existingNextAction?.dueAt,
        existingNextAction?.date,
        existingNextAction?.label,
        existingNextAction?.meeting,
    ]);

    const submit = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        if (!date || !time) return;
        const raw = new Date(`${date}T${time}:00`);
        if (Number.isNaN(raw.getTime())) return;
        const dueAtDate = ensureWeekday(raw);
        const dateKey = toLocalDateKey(dueAtDate);
        const dueAt = dueAtDate.toISOString();
        const trimmed = label.trim() || undefined;
        const keepMeeting = asMeeting || isManualRdv(existingNextAction);
        onConfirm?.(
            keepMeeting
                ? makeRdvNextAction({ date: dateKey, dueAt, label: trimmed })
                : makeCalendarReminder({ date: dateKey, dueAt, label: trimmed })
        );
    };

    return (
        <form
            onSubmit={submit}
            className={cn("space-y-3", className)}
            onClick={(e) => e.stopPropagation()}
            data-testid="quick-schedule-form"
        >
            {hint && (
                <p className="text-[12px] text-muted-foreground leading-snug">{hint}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1 min-w-0">
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Date
                    </label>
                    <Input
                        type="date"
                        value={date}
                        onChange={(e) => {
                            let v = e.target.value;
                            if (v && isSunday(`${v}T12:00:00`)) {
                                const d = ensureWeekday(new Date(`${v}T12:00:00`));
                                v = toLocalDateKey(d);
                                toast.message("Dimanche évité", { description: "Créneau décalé au lundi." });
                            }
                            setDate(v);
                        }}
                        className="h-9 rounded-lg"
                        data-testid="add-cal-date"
                    />
                </div>
                <div className="space-y-1 min-w-0">
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Heure
                    </label>
                    <Input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="h-9 rounded-lg"
                        data-testid="add-cal-time"
                    />
                </div>
            </div>
            <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Libellé
                </label>
                <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="ex. Rappeler"
                    className="h-9 rounded-lg"
                    data-testid="add-cal-label"
                />
            </div>
            <div className="flex justify-end gap-1.5 pt-0.5">
                {onCancel && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        onClick={onCancel}
                    >
                        Annuler
                    </Button>
                )}
                <Button
                    type="submit"
                    size="sm"
                    disabled={!date || !time}
                    className="h-8 rounded-lg text-xs"
                    data-testid="add-cal-confirm"
                >
                    {confirmLabel}
                </Button>
            </div>
        </form>
    );
}

/** Dialogue modal (fiche lead). */
export function AddToCalendarDialog({
    open,
    onOpenChange,
    company = "",
    defaultLabel = "",
    hint = "",
    onConfirm,
    asMeeting = false,
    existingNextAction = null,
    confirmLabel = "Ajouter",
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="rounded-2xl sm:max-w-[360px] max-h-[90vh] overflow-y-auto"
                data-testid="add-to-calendar-dialog"
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <CalendarPlus size={17} className="text-primary" />
                        {asMeeting ? "Planifier un RDV" : "Placer un rappel"}
                    </DialogTitle>
                    <DialogDescription>
                        {company
                            ? (asMeeting
                                ? `Rendez-vous pour « ${company} ».`
                                : `Rappel calendrier pour « ${company} ».`)
                            : "Choisissez une date et une heure."}
                    </DialogDescription>
                </DialogHeader>
                <QuickScheduleForm
                    key={open ? `open-${asMeeting ? "rdv" : "rappel"}` : "closed"}
                    company={company}
                    defaultLabel={defaultLabel}
                    hint={hint}
                    asMeeting={asMeeting}
                    existingNextAction={existingNextAction}
                    confirmLabel={confirmLabel}
                    onConfirm={(na) => {
                        onConfirm?.(na);
                        onOpenChange?.(false);
                    }}
                    onCancel={() => onOpenChange?.(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

/**
 * Bouton « + » à côté d’une relance suggérée : chips +1j…+7j (hors week-end),
 * prérempli avec le meilleur jour de prospection si dispo.
 */
export function ConfirmSuggestedRelanceButton({
    company = "",
    nextAction = null,
    defaultDays = 2,
    bestDay = null,
    bestHour = null,
    onConfirm,
    className,
    testId = "confirm-suggested-relance-btn",
}) {
    const [open, setOpen] = useState(false);

    const initialDays = useMemo(() => {
        if (Number.isFinite(nextAction?.suggestedDays) && nextAction.suggestedDays >= 1 && nextAction.suggestedDays <= 7) {
            return nextAction.suggestedDays;
        }
        const fromLabel = Number((nextAction?.label || "").match(/J\+(\d+)/i)?.[1]);
        if (Number.isFinite(fromLabel) && fromLabel >= 1 && fromLabel <= 7) return fromLabel;
        if (bestDay && Number.isFinite(bestDay.day)) {
            return daysUntilWeekday(bestDay.day);
        }
        return Math.min(Math.max(1, Number(defaultDays) || 2), 7);
    }, [nextAction?.suggestedDays, nextAction?.label, bestDay, defaultDays]);

    const [days, setDays] = useState(initialDays);

    useEffect(() => {
        if (open) setDays(initialDays);
    }, [open, initialDays]);

    const preview = useMemo(() => {
        const due = addDaysSkippingWeekend(days);
        if (bestHour && Number.isFinite(bestHour.hour)) {
            due.setHours(bestHour.hour, 0, 0, 0);
        } else if (nextAction?.dueAt) {
            const prev = new Date(nextAction.dueAt);
            if (!Number.isNaN(prev.getTime())) {
                due.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
            } else {
                due.setHours(9, 0, 0, 0);
            }
        } else {
            due.setHours(9, 0, 0, 0);
        }
        return ensureWeekday(due);
    }, [days, bestHour, nextAction?.dueAt]);

    const confirm = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const dueAt = preview;
        onConfirm?.(
            makeCalendarReminder({
                date: toLocalDateKey(dueAt),
                dueAt: dueAt.toISOString(),
                label: company ? `Rappeler ${company}` : `Relance · +${days}j`,
            })
        );
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid={testId}
                    title="Ajuster la relance"
                    aria-label="Ajuster la relance"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0",
                        "border border-violet-500/30 bg-background/80 text-violet-700",
                        "hover:bg-violet-500/15 dark:text-violet-300 transition-colors",
                        className
                    )}
                >
                    <Plus size={14} strokeWidth={2.5} />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={8}
                className="w-[280px] p-3 rounded-xl space-y-2.5"
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-xs font-semibold">Confirmer la relance</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    {formatFutureRelativeFr(preview)}
                    {" · "}
                    {preview.toLocaleString("fr-FR", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                    {bestDay?.label ? ` · pic ${bestDay.label}` : ""}
                    {" · hors week-end"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                    {RELANCE_DAY_CHIPS.map((d) => (
                        <button
                            key={d}
                            type="button"
                            data-testid={`confirm-relance-days-${d}`}
                            onClick={() => setDays(d)}
                            className={cn(
                                "h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors",
                                days === d
                                    ? "bg-violet-600 text-white"
                                    : "bg-muted/60 border border-border text-muted-foreground hover:text-foreground"
                            )}
                        >
                            +{d} j
                        </button>
                    ))}
                </div>
                <div className="flex justify-end gap-1.5 pt-0.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        onClick={() => setOpen(false)}
                    >
                        Annuler
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        data-testid="confirm-suggested-relance-submit"
                        onClick={confirm}
                    >
                        Confirmer
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/**
 * Bouton icône calendrier + popover (pas de libellé texte).
 */
export function QuickScheduleButton({
    company = "",
    defaultLabel = "",
    hint = "Conseil : placez un rappel pour relancer ce lead.",
    onConfirm,
    className,
    size = "sm",
    testId = "quick-schedule-btn",
    open: controlledOpen,
    onOpenChange,
}) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = controlledOpen ?? uncontrolledOpen;
    const setOpen = onOpenChange ?? setUncontrolledOpen;

    const dim = size === "xs" ? "h-7 w-7" : "h-8 w-8";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid={testId}
                    title="Rappel calendrier"
                    aria-label="Rappel calendrier"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "inline-flex items-center justify-center rounded-lg border transition-colors shrink-0",
                        "border-border bg-background text-muted-foreground",
                        "hover:text-foreground hover:bg-muted/60",
                        dim,
                        className
                    )}
                >
                    <CalendarPlus size={size === "xs" ? 13 : 15} strokeWidth={2} />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={8}
                className="w-[300px] p-3 rounded-xl max-h-[min(80vh,520px)] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                    <CalendarPlus size={13} className="text-primary" />
                    Rappel
                </p>
                <QuickScheduleForm
                    key={open ? "open" : "closed"}
                    company={company}
                    defaultLabel={defaultLabel}
                    hint={hint}
                    onConfirm={(na) => {
                        onConfirm?.(na);
                        setOpen(false);
                    }}
                    onCancel={() => setOpen(false)}
                />
            </PopoverContent>
        </Popover>
    );
}
