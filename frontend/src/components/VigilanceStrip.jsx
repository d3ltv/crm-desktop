import React, { useState } from "react";
import {
    AlertTriangle,
    Phone,
    Mail,
    UserPlus,
    Plus,
    X,
} from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QuickScheduleButton } from "./AddToCalendarDialog";
import { cn } from "@/lib/utils";

function severityOf(item) {
    if (item?.severity === "critical") return "critical";
    if (item?.severity === "warning") return "warning";
    return "info";
}

const DOT = {
    critical: "bg-rose-500",
    warning: "bg-amber-500",
    info: "bg-muted-foreground/50",
    violet: "bg-violet-500",
};

const TITLE = {
    critical: "text-rose-800 dark:text-rose-200",
    warning: "text-amber-900 dark:text-amber-100",
    info: "text-foreground",
    violet: "text-violet-800 dark:text-violet-200",
};

/** Bouton action teinté comme la pastille du problème. */
function actionBtnClass(sev = "warning") {
    const base =
        "shrink-0 h-5 w-5 rounded-md border inline-flex items-center justify-center transition-colors";
    if (sev === "critical") {
        return `${base} border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15`;
    }
    if (sev === "violet") {
        return `${base} border-violet-500/35 bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/15`;
    }
    if (sev === "info") {
        return `${base} border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/60`;
    }
    // warning (défaut) — ambre / orange comme la pastille
    return `${base} border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15`;
}

/** Dates FR dans un message (ex. « 24 juil. 2026 », « 24/07/2026 »). */
const DATE_IN_TEXT_RE =
    /(\d{1,2}[\s\u00a0\u202f]+(?:janv\.?|févr\.?|fevr\.?|mars|avr\.?|mai|juin|juil\.?|août|aout|sept\.?|oct\.?|nov\.?|déc\.?|dec\.?)[\s\u00a0\u202f]+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/gi;

/** Met les dates en bleu dans un message de vigilance. */
function renderMessageWithDates(text) {
    if (!text) return null;
    const parts = String(text).split(DATE_IN_TEXT_RE);
    return parts.map((part, i) => {
        if (!part) return null;
        // Avec un groupe capturant, split place les dates sur les indices impairs
        if (i % 2 === 1) {
            return (
                <span key={i} className="text-sky-600 dark:text-sky-400 font-medium tabular-nums">
                    {part}
                </span>
            );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

/** Tooltip / aria du bouton solution. */
function actionTitle(item) {
    if (item.id === "prospection_sans_tel" || item.id === "nouveau_sans_coord") {
        return "Ajouter téléphone / email";
    }
    if (
        item.id === "meeting_sans_rdv"
        || item.id === "rdv_detected_unplanned"
        || item.id === "rdv_overdue"
        || item.id === "contacted_sans_trace"
        || item.id === "no_answer_stale"
        || item.id === "contact_gap"
        || item.id === "nouveau_stale"
        || item.action?.type === "plan_rdv"
    ) {
        return item.id === "meeting_sans_rdv" || item.id === "rdv_detected_unplanned" || item.id === "rdv_overdue" || item.action?.type === "plan_rdv"
            ? "Planifier un RDV"
            : "Planifier un rappel";
    }
    if (item.id === "won_sans_valeur" || item.id === "won_no_close_date") return "Compléter le deal";
    if (item.action?.type === "apply_field") return `Enregistrer · ${item.action.value}`;
    if (item.dismissible !== false) return "Ignorer";
    return null;
}

function ActionIcon({ item }) {
    if (actionTitle(item) === "Ignorer") {
        return <X size={11} strokeWidth={2.25} />;
    }
    return <Plus size={12} strokeWidth={2.5} />;
}

function ContactQuickAdd({ onSave, testId, sev = "warning" }) {
    const [open, setOpen] = useState(false);
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");

    const save = () => {
        const p = phone.trim();
        const e = email.trim();
        if (!p && !e) return;
        onSave?.({ phone: p || undefined, email: e || undefined });
        setPhone("");
        setEmail("");
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title="Ajouter téléphone / email"
                    aria-label="Ajouter téléphone / email"
                    data-testid={testId}
                    className={actionBtnClass(sev)}
                >
                    <Plus size={12} strokeWidth={2.5} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={8} className="w-[260px] p-3 rounded-xl space-y-2">
                <p className="text-[11px] font-semibold flex items-center gap-1.5">
                    <UserPlus size={12} className="text-amber-700" />
                    Ajouter des coordonnées
                </p>
                <div className="space-y-1.5">
                    <div className="relative">
                        <Phone size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="Téléphone"
                            className="h-8 text-[12px] pl-8"
                            autoFocus
                        />
                    </div>
                    <div className="relative">
                        <Mail size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email"
                            className="h-8 text-[12px] pl-8"
                            type="email"
                        />
                    </div>
                </div>
                <Button
                    type="button"
                    size="sm"
                    className="w-full h-8 rounded-full text-[12px]"
                    disabled={!phone.trim() && !email.trim()}
                    onClick={save}
                >
                    Enregistrer
                </Button>
            </PopoverContent>
        </Popover>
    );
}

function ProblemAction({ item, sev = "warning", onPlanMeeting, onApplyField, onSaveContact, onDismiss }) {
    const title = actionTitle(item);

    if (item.id === "prospection_sans_tel" || item.id === "nouveau_sans_coord") {
        return (
            <ContactQuickAdd
                testId={`vigilance-action-${item.id}`}
                sev={sev}
                onSave={onSaveContact}
            />
        );
    }

    if (!title) return null;

    const run = () => {
        if (
            item.id === "meeting_sans_rdv"
            || item.id === "rdv_detected_unplanned"
            || item.id === "rdv_overdue"
            || item.id === "contacted_sans_trace"
            || item.id === "no_answer_stale"
            || item.id === "contact_gap"
            || item.id === "nouveau_stale"
            || item.action?.type === "plan_rdv"
        ) {
            onPlanMeeting?.(item);
            return;
        }
        if (item.action?.type === "apply_field" || item.id === "won_sans_valeur" || item.id === "won_no_close_date") {
            onApplyField?.(item);
            return;
        }
        if (item.dismissible !== false) onDismiss?.(item.fingerprint);
    };

    return (
        <button
            type="button"
            onClick={run}
            title={title}
            aria-label={title}
            data-testid={
                title === "Ignorer"
                    ? `dismiss-inconsistency-${item.id}`
                    : `vigilance-action-${item.id}`
            }
            className={actionBtnClass(sev)}
        >
            <ActionIcon item={item} />
        </button>
    );
}

/**
 * « À surveiller » : problèmes clairs (prio via pastille / texte),
 * solution en icône à côté.
 */
export function VigilanceStrip({
    items = [],
    nudge = null,
    onPlanMeeting,
    onPlanReminder,
    onApplyField,
    onSaveContact,
    onDismiss,
    company = "",
}) {
    if (!items.length && !nudge) return null;

    const hasCritical = items.some((i) => i.severity === "critical");
    const count = items.length + (nudge ? 1 : 0);

    return (
        <div className="space-y-1.5" data-testid="lead-inconsistency-strip">
            <div
                className={cn(
                    "flex items-center gap-2 text-[11px] font-semibold",
                    hasCritical
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-amber-800 dark:text-amber-300"
                )}
            >
                <AlertTriangle size={12} strokeWidth={2.25} className="shrink-0" />
                <span>À surveiller</span>
                <span
                    className={cn(
                        "tabular-nums font-bold",
                        hasCritical
                            ? "text-rose-600/80 dark:text-rose-400/80"
                            : "text-amber-700/80 dark:text-amber-400/80"
                    )}
                >
                    · {count}
                </span>
            </div>

            <ul className="space-y-1">
                {items.map((item) => {
                    const sev = severityOf(item);
                    return (
                        <li
                            key={item.fingerprint}
                            className={cn(
                                "flex items-start gap-2 px-2 py-1.5 text-[12.5px] leading-snug rounded-lg border",
                                sev === "critical" ? "border-rose-500/40" : "border-transparent"
                            )}
                            data-testid={`lead-inconsistency-${item.id}`}
                        >
                            <span
                                className={cn("mt-[5px] w-1.5 h-1.5 rounded-full shrink-0", DOT[sev])}
                                aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className={cn("font-semibold text-[12px] leading-5 truncate min-w-0", TITLE[sev])}>
                                        {item.title}
                                    </div>
                                    <ProblemAction
                                        item={item}
                                        sev={sev}
                                        onPlanMeeting={onPlanMeeting}
                                        onApplyField={onApplyField}
                                        onSaveContact={onSaveContact}
                                        onDismiss={onDismiss}
                                    />
                                </div>
                                {item.message && (
                                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 pr-1">
                                        {renderMessageWithDates(item.message)}
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}

                {nudge && (
                    <li
                        className="flex items-start gap-2 px-2 py-1.5 text-[12.5px] leading-snug rounded-lg border border-transparent"
                        data-testid="lead-calendar-nudge"
                    >
                        <span className={cn("mt-[5px] w-1.5 h-1.5 rounded-full shrink-0", DOT.violet)} aria-hidden />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={cn("font-semibold text-[12px] leading-5 truncate min-w-0", TITLE.violet)}>
                                    {nudge.title}
                                </div>
                                <QuickScheduleButton
                                    company={company}
                                    defaultLabel={nudge.label}
                                    hint={nudge.hint}
                                    size="xs"
                                    icon="plus"
                                    testId="lead-watch-schedule-btn"
                                    onConfirm={onPlanReminder}
                                    className={actionBtnClass("violet")}
                                />
                            </div>
                            {nudge.body && (
                                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2 pr-1">
                                    {nudge.body}
                                </div>
                            )}
                        </div>
                    </li>
                )}
            </ul>
        </div>
    );
}
