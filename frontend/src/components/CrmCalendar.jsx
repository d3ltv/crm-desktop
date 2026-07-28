import React, { useEffect, useMemo, useState } from "react";
import { fr } from "date-fns/locale";
import {
    format,
    startOfDay,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths,
    addDays,
    addWeeks,
    subWeeks,
} from "date-fns";
import { useCrm } from "@/context/CrmContext";
import { toLocalDateKey } from "@/lib/dateUtils";
import {
    collectCalendarEvents,
    agendaEventsForDate,
    surveillanceEvents,
    countActionableToday,
    markCalendarActionablesRead,
    readCalendarScope,
    writeCalendarScope,
    CALENDAR_EVENT_META,
} from "@/lib/calendarEvents";
import { collectDayRecap, filterAndSortRecap, RECAP_KINDS, RECAP_FILTERS } from "@/lib/dayRecap";
import { markLeadNotifsRead } from "@/lib/followupNotifs";
import { useCalendarSeenMap } from "@/hooks/useNotifSeenMap";
import {
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Layers,
    Building2,
    Check,
    CheckCheck,
    AlertTriangle,
    ChevronDown,
    ClipboardList,
    X,
    ArrowUpDown,
    Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isManualRdv } from "@/lib/nextActionUtils";
import { QuickScheduleButton, QuickScheduleForm } from "./AddToCalendarDialog";
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
import { CalendarEventSheet } from "./CalendarEventSheet";
import { scheduleLeadNextAction } from "@/lib/scheduleLead";
import { toast } from "sonner";

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

const CALENDAR_VIEW_KEY = "crm_calendar_view";

/** @typedef {'day'|'3days'|'week'|'month'} CalendarViewId */

const VIEW_OPTIONS = [
    { id: "day", label: "Jour", short: "Jour" },
    { id: "3days", label: "3 jours", short: "3 j" },
    { id: "week", label: "1 semaine", short: "Sem." },
    { id: "month", label: "1 mois", short: "Mois" },
];

function readCalendarView() {
    try {
        const v = localStorage.getItem(CALENDAR_VIEW_KEY);
        if (VIEW_OPTIONS.some((o) => o.id === v)) return /** @type {CalendarViewId} */ (v);
    } catch { /* ignore */ }
    return "month";
}

function writeCalendarView(view) {
    try {
        localStorage.setItem(CALENDAR_VIEW_KEY, view);
    } catch { /* ignore */ }
}

function formatEventTime(dueAt) {
    if (!dueAt) return null;
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime())) return null;
    return format(d, "HH:mm");
}

function eventsByDay(events) {
    /** @type {Map<string, object[]>} */
    const map = new Map();
    for (const e of events || []) {
        if (e.type === "surveillance") continue;
        if (!map.has(e.dateKey)) map.set(e.dateKey, []);
        map.get(e.dateKey).push(e);
    }
    return map;
}

function EventRow({ ev, todayKey, showWsChip, onOpen }) {
    const meta = CALENDAR_EVENT_META[ev.type] || CALENDAR_EVENT_META.rappel;
    const time = formatEventTime(ev.dueAt);
    const overdue = ev.dateKey < todayKey || ev.meta?.overdueCarry;
    return (
        <button
            type="button"
            data-testid={`calendar-event-${ev.standaloneId || ev.leadId || ev.id}`}
            onClick={() => onOpen(ev)}
            className={cn(
                "w-full text-left rounded-lg border border-border/80 px-2.5 py-2",
                "hover:bg-muted/50 hover:border-border transition-colors flex gap-2",
                overdue && "border-rose-500/35 bg-rose-500/[0.04]"
            )}
        >
            <span className={cn("w-1 self-stretch rounded-full shrink-0", meta.dot)} />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                    {time && (
                        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                            {time}
                        </span>
                    )}
                    <span className="text-[12px] font-medium truncate">{ev.title}</span>
                </div>
                {ev.subtitle && (
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{ev.subtitle}</p>
                )}
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", meta.chip)}>
                        {meta.label}
                    </span>
                    {showWsChip && (
                        <span className="text-[10px] text-muted-foreground truncate">{ev.workspaceName}</span>
                    )}
                    {overdue && (
                        <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">en retard</span>
                    )}
                </div>
            </div>
        </button>
    );
}

/**
 * Calendrier CRM — vues Jour / 3 j / Semaine / Mois + lire les notifs.
 */
export function CrmCalendar({
    workspaces: workspacesProp,
    currentWorkspace = null,
    variant = "page",
    className,
    defaultScope,
    onOpenLead,
}) {
    const { state, dispatch } = useCrm();
    const calendarSeenMap = useCalendarSeenMap();
    const [selected, setSelected] = useState(() => startOfDay(new Date()));
    const [month, setMonth] = useState(() => startOfMonth(new Date()));
    const [scope, setScope] = useState(() => defaultScope || readCalendarScope());
    const [view, setView] = useState(() => readCalendarView());
    const [showRecap, setShowRecap] = useState(false);
    const [activeEvent, setActiveEvent] = useState(null);
    const [creatingFree, setCreatingFree] = useState(false);
    const [creatingAsMeeting, setCreatingAsMeeting] = useState(false);

    useEffect(() => {
        writeCalendarScope(scope);
    }, [scope]);

    useEffect(() => {
        writeCalendarView(view);
    }, [view]);

    const allWorkspaces = useMemo(() => {
        if (workspacesProp?.length) return workspacesProp;
        return state.order.map((id) => state.workspaces[id]).filter(Boolean);
    }, [workspacesProp, state.order, state.workspaces]);

    const activeWorkspace = currentWorkspace
        || (state.currentId ? state.workspaces[state.currentId] : null)
        || allWorkspaces[0]
        || null;

    const workspaces = useMemo(() => {
        if (scope === "current" && activeWorkspace) return [activeWorkspace];
        return allWorkspaces;
    }, [scope, activeWorkspace, allWorkspaces]);

    const events = useMemo(
        () => collectCalendarEvents(workspaces, {
            standaloneEvents: state.standaloneEvents || [],
        }),
        [workspaces, state.standaloneEvents]
    );
    const byDay = useMemo(() => eventsByDay(events), [events]);
    const todayKey = toLocalDateKey(new Date());
    const selectedKey = toLocalDateKey(selected);
    const dayEvents = useMemo(
        () => agendaEventsForDate(events, selectedKey, { todayKey, includeSurveillance: false }),
        [events, selectedKey, todayKey]
    );
    const watchList = useMemo(() => surveillanceEvents(events), [events]);
    const actionableCount = useMemo(
        () => countActionableToday(events, new Date(), calendarSeenMap),
        [events, calendarSeenMap]
    );
    const dayRecap = useMemo(
        () => collectDayRecap(workspaces, selectedKey, { dayEvents }),
        [workspaces, selectedKey, dayEvents]
    );

    const markCalendarAllRead = () => {
        markCalendarActionablesRead(events);
    };

    const rangeDays = useMemo(() => {
        const anchor = startOfDay(selected);
        if (view === "day") return [anchor];
        if (view === "3days") return [0, 1, 2].map((i) => addDays(anchor, i));
        if (view === "week") {
            const start = startOfWeek(anchor, { weekStartsOn: 1 });
            const end = endOfWeek(anchor, { weekStartsOn: 1 });
            return eachDayOfInterval({ start, end });
        }
        return null;
    }, [view, selected]);

    const gridDays = useMemo(() => {
        const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
        const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
        return eachDayOfInterval({ start, end });
    }, [month]);

    const isDialog = variant === "dialog";
    const showWsChip = scope === "all" && allWorkspaces.length > 1;
    const viewMeta = VIEW_OPTIONS.find((o) => o.id === view) || VIEW_OPTIONS[3];

    const handleOpenEvent = (evOrWsId, maybeLeadId) => {
        // Compat : ancien signature (workspaceId, leadId) → event minimal
        if (typeof evOrWsId === "string" && maybeLeadId) {
            markLeadNotifsRead(allWorkspaces, evOrWsId, maybeLeadId);
            const ws = state.workspaces[evOrWsId];
            const lead = ws?.leads?.[maybeLeadId];
            setActiveEvent({
                id: `manual:${maybeLeadId}`,
                workspaceId: evOrWsId,
                leadId: maybeLeadId,
                title: lead?.company || "Lead",
                workspaceName: ws?.name,
                type: isManualRdv(lead?.nextAction) ? "rdv" : "rappel",
                dueAt: lead?.nextAction?.dueAt || lead?.autoFollowup?.dueAt || null,
            });
            return;
        }
        if (evOrWsId && typeof evOrWsId === "object") {
            if (evOrWsId.leadId) {
                markLeadNotifsRead(allWorkspaces, evOrWsId.workspaceId, evOrWsId.leadId);
            }
            setActiveEvent(evOrWsId);
        }
    };

    const goToday = () => {
        const t = startOfDay(new Date());
        setSelected(t);
        setMonth(startOfMonth(t));
    };

    const goPrev = () => {
        if (view === "month") {
            setMonth((m) => subMonths(m, 1));
            return;
        }
        if (view === "week") {
            setSelected((d) => subWeeks(d, 1));
            return;
        }
        if (view === "3days") {
            setSelected((d) => addDays(d, -3));
            return;
        }
        setSelected((d) => addDays(d, -1));
    };

    const goNext = () => {
        if (view === "month") {
            setMonth((m) => addMonths(m, 1));
            return;
        }
        if (view === "week") {
            setSelected((d) => addWeeks(d, 1));
            return;
        }
        if (view === "3days") {
            setSelected((d) => addDays(d, 3));
            return;
        }
        setSelected((d) => addDays(d, 1));
    };

    const titleLabel = (() => {
        if (view === "month") return format(month, "MMMM yyyy", { locale: fr });
        if (!rangeDays?.length) return format(selected, "d MMMM yyyy", { locale: fr });
        if (rangeDays.length === 1) return format(rangeDays[0], "EEEE d MMMM yyyy", { locale: fr });
        const a = rangeDays[0];
        const b = rangeDays[rangeDays.length - 1];
        if (a.getMonth() === b.getMonth()) {
            return `${format(a, "d", { locale: fr })} – ${format(b, "d MMMM yyyy", { locale: fr })}`;
        }
        return `${format(a, "d MMM", { locale: fr })} – ${format(b, "d MMM yyyy", { locale: fr })}`;
    })();

    const changeView = (next) => {
        setView(next);
        if (next === "month") {
            setMonth(startOfMonth(selected));
        }
    };

    return (
        <div
            className={cn(
                "flex flex-col bg-background text-foreground overflow-hidden",
                isDialog ? "rounded-xl border border-border" : "rounded-2xl border border-border shadow-sm",
                className
            )}
            data-testid="crm-calendar"
            data-variant={variant}
            data-scope={scope}
            data-view={view}
        >
            {/* ── Toolbar ── */}
            <div className={cn(
                "flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-5 border-b border-border shrink-0",
                isDialog ? "py-3" : "py-2"
            )}>
                <button
                    type="button"
                    onClick={goToday}
                    className={cn(
                        "rounded-full border border-border text-[13px] font-medium hover:bg-muted/60 transition-colors",
                        isDialog ? "h-9 px-3.5" : "h-8 px-3"
                    )}
                >
                    Aujourd&apos;hui
                </button>
                <button
                    type="button"
                    onClick={() => setCreatingFree((v) => {
                        if (v) setCreatingAsMeeting(false);
                        return !v;
                    })}
                    className={cn(
                        "rounded-full border border-border text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-muted/60 transition-colors",
                        creatingFree && "bg-primary/10 border-primary/30 text-primary",
                        isDialog ? "h-9 px-3.5" : "h-8 px-3"
                    )}
                    data-testid="calendar-create-free"
                >
                    <Plus size={14} strokeWidth={2} />
                    Événement
                </button>
                <div className="flex items-center">
                    <button
                        type="button"
                        aria-label="Précédent"
                        onClick={goPrev}
                        className={cn(
                            "rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/70",
                            isDialog ? "w-9 h-9" : "w-8 h-8"
                        )}
                    >
                        <ChevronLeft size={isDialog ? 18 : 16} />
                    </button>
                    <button
                        type="button"
                        aria-label="Suivant"
                        onClick={goNext}
                        className={cn(
                            "rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/70",
                            isDialog ? "w-9 h-9" : "w-8 h-8"
                        )}
                    >
                        <ChevronRight size={isDialog ? 18 : 16} />
                    </button>
                </div>
                <h2 className={cn(
                    "font-normal tracking-tight capitalize text-foreground min-w-0 truncate",
                    isDialog ? "text-base sm:text-xl" : "text-[15px] sm:text-lg"
                )}>
                    {titleLabel}
                </h2>

                <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
                    {/* Sélecteur de vue */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                data-testid="calendar-view-menu"
                                className={cn(
                                    "rounded-full border border-border text-[13px] font-medium hover:bg-muted/60 transition-colors inline-flex items-center gap-1.5",
                                    isDialog ? "h-9 px-3" : "h-8 px-2.5"
                                )}
                            >
                                {viewMeta.label}
                                <ChevronDown size={14} className="text-muted-foreground" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 rounded-xl">
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Affichage
                            </DropdownMenuLabel>
                            {VIEW_OPTIONS.map((opt) => (
                                <DropdownMenuItem
                                    key={opt.id}
                                    onClick={() => changeView(opt.id)}
                                    className="gap-2"
                                    data-testid={`calendar-view-${opt.id}`}
                                >
                                    {opt.label}
                                    {view === opt.id && <Check size={14} className="ml-auto text-primary" />}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Récap de la journée */}
                    <button
                        type="button"
                        data-testid="calendar-day-recap-btn"
                        onClick={() => setShowRecap((v) => !v)}
                        title="Récap de la journée"
                        className={cn(
                            "rounded-full border text-[13px] font-medium transition-colors inline-flex items-center gap-1.5",
                            isDialog ? "h-9 px-3" : "h-8 px-2.5",
                            showRecap
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border hover:bg-muted/60"
                        )}
                    >
                        <ClipboardList size={14} strokeWidth={2} />
                        <span className="hidden sm:inline">Récap</span>
                        {dayRecap.summary.total > 0 && (
                            <span className="tabular-nums text-[11px] px-1.5 h-5 min-w-[20px] rounded-full bg-muted text-foreground flex items-center justify-center">
                                {dayRecap.summary.total > 99 ? "99+" : dayRecap.summary.total}
                            </span>
                        )}
                    </button>

                    {actionableCount > 0 && (
                        <>
                            <span className="hidden lg:inline text-[12px] text-muted-foreground tabular-nums">
                                {actionableCount} à faire
                            </span>
                            <button
                                type="button"
                                data-testid="calendar-mark-all-read-btn"
                                onClick={markCalendarAllRead}
                                title="Marquer les échéances dues comme lues"
                                aria-label="Tout lire les échéances calendrier"
                                className={cn(
                                    "rounded-full border border-border text-[11px] font-medium transition-colors inline-flex items-center gap-1",
                                    "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-500/30",
                                    isDialog ? "h-9 px-3" : "h-8 px-2.5"
                                )}
                            >
                                <CheckCheck size={14} strokeWidth={2} />
                                Tout lire
                            </button>
                        </>
                    )}

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                data-testid="calendar-scope-menu"
                                aria-label="Options"
                                className={cn(
                                    "rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/70",
                                    isDialog ? "w-9 h-9" : "w-8 h-8"
                                )}
                            >
                                <MoreHorizontal size={isDialog ? 18 : 16} />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 rounded-xl">
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Portée
                            </DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setScope("all")} className="gap-2" data-testid="calendar-scope-all">
                                <Layers size={14} /> Tous les espaces
                                {scope === "all" && <Check size={14} className="ml-auto text-primary" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => activeWorkspace && setScope("current")}
                                disabled={!activeWorkspace}
                                className="gap-2"
                                data-testid="calendar-scope-current"
                            >
                                <Building2 size={14} /> Espace courant
                                {scope === "current" && <Check size={14} className="ml-auto text-primary" />}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                                Changez la vue pour zoomer sur aujourd&apos;hui, 3 jours, la semaine ou le mois.
                            </DropdownMenuLabel>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {creatingFree && (
                <div className="mx-3 sm:mx-5 mt-3 mb-1 rounded-xl border border-border bg-card p-3 shadow-sm shrink-0 space-y-3">
                    <div className="flex gap-1.5">
                        <button
                            type="button"
                            onClick={() => setCreatingAsMeeting(false)}
                            className={cn(
                                "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                                !creatingAsMeeting
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted/50"
                            )}
                        >
                            Rappel
                        </button>
                        <button
                            type="button"
                            onClick={() => setCreatingAsMeeting(true)}
                            className={cn(
                                "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                                creatingAsMeeting
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted/50"
                            )}
                        >
                            RDV
                        </button>
                    </div>
                    <QuickScheduleForm
                        company=""
                        defaultLabel=""
                        hint="Événement libre — sans fiche prospect"
                        confirmLabel="Créer"
                        asMeeting={creatingAsMeeting}
                        onCancel={() => {
                            setCreatingFree(false);
                            setCreatingAsMeeting(false);
                        }}
                        onConfirm={(na) => {
                            const asRdv = creatingAsMeeting || isManualRdv(na);
                            dispatch({
                                type: "ADD_STANDALONE_EVENT",
                                event: {
                                    date: na.date,
                                    dueAt: na.dueAt,
                                    label: na.label || (asRdv ? "Rendez-vous" : "Événement"),
                                    type: asRdv ? "rdv" : "rappel",
                                    workspaceId: activeWorkspace?.id || null,
                                },
                            });
                            setCreatingFree(false);
                            setCreatingAsMeeting(false);
                            if (na.date) {
                                const d = new Date(`${na.date}T12:00:00`);
                                if (!Number.isNaN(d.getTime())) {
                                    setSelected(startOfDay(d));
                                    setMonth(startOfMonth(d));
                                }
                            }
                            toast.success(asRdv ? "RDV créé" : "Événement créé");
                        }}
                    />
                </div>
            )}

            {/* ── Body ── */}
            <div
                className={cn(
                    "flex flex-col lg:flex-row flex-1 min-h-0",
                    isDialog
                        ? "min-h-[520px] max-h-[min(82vh,760px)]"
                        : "min-h-[360px] h-[min(52vh,480px)] max-h-[480px]"
                )}
            >
                {showRecap ? (
                    <DayRecapPanel
                        recap={dayRecap}
                        selected={selected}
                        todayKey={todayKey}
                        showWsChip={showWsChip}
                        onClose={() => setShowRecap(false)}
                        onOpenLead={handleOpenEvent}
                        onPrevDay={() => setSelected((d) => addDays(d, -1))}
                        onNextDay={() => setSelected((d) => addDays(d, 1))}
                        onToday={() => {
                            const t = startOfDay(new Date());
                            setSelected(t);
                            setMonth(startOfMonth(t));
                        }}
                    />
                ) : view === "month" ? (
                    <>
                        {/* Grille mois */}
                        <div className="flex-1 min-w-0 flex flex-col border-b lg:border-b-0 lg:border-r border-border">
                            <div className="grid grid-cols-7 border-b border-border shrink-0">
                                {WEEKDAYS.map((d) => (
                                    <div
                                        key={d}
                                        className={cn(
                                            "text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                                            isDialog ? "py-2" : "py-1.5"
                                        )}
                                    >
                                        {d}
                                    </div>
                                ))}
                            </div>

                            <div className="flex-1 grid grid-cols-7 auto-rows-fr min-h-0 overflow-hidden">
                                {gridDays.map((day) => {
                                    const key = toLocalDateKey(day);
                                    const inMonth = isSameMonth(day, month);
                                    const isToday = key === todayKey;
                                    const isSel = isSameDay(day, selected);
                                    const dayEv = byDay.get(key) || [];
                                    const maxChips = 2;
                                    const extra = Math.max(0, dayEv.length - maxChips);

                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setSelected(startOfDay(day))}
                                            className={cn(
                                                "relative flex flex-col items-stretch text-left border-b border-r border-border/70",
                                                "transition-colors overflow-hidden",
                                                isDialog
                                                    ? "p-1 sm:p-1.5 min-h-[72px] sm:min-h-[96px] lg:min-h-[110px]"
                                                    : "p-0.5 sm:p-1 min-h-0",
                                                "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                                                !inMonth && "bg-muted/20",
                                                isSel && "bg-primary/[0.06]"
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "self-start inline-flex items-center justify-center rounded-full tabular-nums",
                                                    isDialog
                                                        ? "mb-1 w-7 h-7 text-[13px]"
                                                        : "mb-0.5 w-6 h-6 text-[12px]",
                                                    !inMonth && "text-muted-foreground/45",
                                                    isToday && "bg-primary text-primary-foreground font-semibold",
                                                    isSel && !isToday && "bg-foreground/10 font-semibold",
                                                    inMonth && !isToday && !isSel && "text-foreground"
                                                )}
                                            >
                                                {day.getDate()}
                                            </span>
                                            <div className="flex flex-col gap-0.5 w-full min-w-0 flex-1 overflow-hidden">
                                                {dayEv.slice(0, maxChips).map((ev) => {
                                                    const meta = CALENDAR_EVENT_META[ev.type] || CALENDAR_EVENT_META.rappel;
                                                    return (
                                                        <span
                                                            key={ev.id}
                                                            className={cn(
                                                                "block truncate rounded-sm px-1 font-medium leading-tight",
                                                                isDialog
                                                                    ? "py-0.5 text-[10px] sm:text-[11px]"
                                                                    : "py-px text-[9px] sm:text-[10px]",
                                                                meta.chip
                                                            )}
                                                            title={`${ev.title} — ${ev.subtitle || ""}`}
                                                        >
                                                            {formatEventTime(ev.dueAt)
                                                                ? `${formatEventTime(ev.dueAt)} `
                                                                : ""}
                                                            {ev.title}
                                                        </span>
                                                    );
                                                })}
                                                {extra > 0 && (
                                                    <span className="text-[10px] text-muted-foreground px-1 font-medium">
                                                        +{extra} autre{extra > 1 ? "s" : ""}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Panneau jour (vue mois) */}
                        <aside
                            className={cn(
                                "flex flex-col bg-card shrink-0 min-h-0",
                                isDialog ? "lg:w-[300px]" : "lg:w-[280px]",
                                isDialog ? "max-h-[360px] lg:max-h-none" : "max-h-[180px] lg:max-h-none"
                            )}
                        >
                            <div className={cn(
                                "px-4 border-b border-border shrink-0",
                                isDialog ? "py-4" : "py-2.5"
                            )}>
                                <p className={cn(
                                    "font-medium capitalize tracking-tight",
                                    isDialog ? "text-[15px]" : "text-[14px]"
                                )}>
                                    {format(selected, "EEEE d MMMM", { locale: fr })}
                                </p>
                                <p className="text-[12px] text-muted-foreground mt-0.5">
                                    {dayEvents.length === 0
                                        ? "Aucun événement"
                                        : `${dayEvents.length} événement${dayEvents.length > 1 ? "s" : ""}`}
                                    {selectedKey === todayKey ? " · aujourd'hui" : ""}
                                </p>
                            </div>

                            <div className={cn(
                                "flex-1 overflow-y-auto px-3 space-y-2",
                                isDialog ? "py-3" : "py-2"
                            )}>
                                {dayEvents.length === 0 && (
                                    <p className={cn(
                                        "text-sm text-muted-foreground text-center px-4",
                                        isDialog ? "py-10" : "py-6"
                                    )}>
                                        Rien de planifié ce jour-là.
                                        <br />
                                        <span className="text-[12px]">Seuls les rappels, RDV et relances à faire apparaissent ici.</span>
                                    </p>
                                )}
                                {dayEvents.map((ev) => (
                                    <EventRow
                                        key={ev.id + (ev.meta?.overdueCarry ? ":over" : "")}
                                        ev={ev}
                                        todayKey={todayKey}
                                        showWsChip={showWsChip}
                                        onOpen={handleOpenEvent}
                                    />
                                ))}
                            </div>

                            {watchList.length > 0 && (
                                <WatchPanel
                                    watchList={watchList}
                                    isDialog={isDialog}
                                    compact={!isDialog}
                                    onOpen={handleOpenEvent}
                                    dispatch={dispatch}
                                    state={state}
                                />
                            )}
                        </aside>
                    </>
                ) : (
                    /* Vues Jour / 3 jours / Semaine */
                    <div className="flex-1 min-w-0 flex flex-col min-h-0">
                        <div
                            className={cn(
                                "flex-1 grid min-h-0 overflow-x-auto",
                                view === "day" && "grid-cols-1",
                                view === "3days" && "grid-cols-3 min-w-[640px]",
                                view === "week" && "grid-cols-7 min-w-[900px]"
                            )}
                        >
                            {(rangeDays || []).map((day) => {
                                const key = toLocalDateKey(day);
                                const isToday = key === todayKey;
                                const isSel = isSameDay(day, selected);
                                const list = agendaEventsForDate(events, key, {
                                    todayKey,
                                    includeSurveillance: false,
                                });
                                return (
                                    <div
                                        key={key}
                                        className={cn(
                                            "flex flex-col border-r border-border/70 last:border-r-0 min-h-0",
                                            isSel && "bg-primary/[0.03]"
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setSelected(startOfDay(day))}
                                            className={cn(
                                                "shrink-0 px-2 py-2.5 border-b border-border text-center hover:bg-muted/40 transition-colors",
                                                isToday && "bg-primary/[0.06]"
                                            )}
                                        >
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                                                {format(day, "EEE", { locale: fr })}
                                            </div>
                                            <div
                                                className={cn(
                                                    "mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full text-[14px] tabular-nums",
                                                    isToday && "bg-primary text-primary-foreground font-semibold",
                                                    isSel && !isToday && "bg-foreground/10 font-semibold"
                                                )}
                                            >
                                                {day.getDate()}
                                            </div>
                                        </button>
                                        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                                            {list.length === 0 && (
                                                <p className="text-[11px] text-muted-foreground/70 text-center py-6 px-1">
                                                    —
                                                </p>
                                            )}
                                            {list.map((ev) => (
                                                <EventRow
                                                    key={ev.id + (ev.meta?.overdueCarry ? ":over" : "")}
                                                    ev={ev}
                                                    todayKey={todayKey}
                                                    showWsChip={showWsChip}
                                                    onOpen={handleOpenEvent}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {watchList.length > 0 && (
                            <WatchPanel
                                watchList={watchList}
                                isDialog={isDialog}
                                onOpen={handleOpenEvent}
                                dispatch={dispatch}
                                state={state}
                                compact
                            />
                        )}
                    </div>
                )}
            </div>

            <CalendarEventSheet
                open={!!activeEvent && !activeEvent.standalone}
                event={activeEvent?.standalone ? null : activeEvent}
                onClose={() => setActiveEvent(null)}
            />

            <AlertDialog
                open={!!activeEvent?.standalone}
                onOpenChange={(open) => {
                    if (!open) setActiveEvent(null);
                }}
            >
                <AlertDialogContent className="rounded-2xl max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{activeEvent?.title || "Événement"}</AlertDialogTitle>
                        <AlertDialogDescription>
                            Événement libre
                            {activeEvent?.dueAt
                                ? ` · ${new Date(activeEvent.dueAt).toLocaleString("fr-FR", {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}`
                                : activeEvent?.dateKey
                                    ? ` · ${activeEvent.dateKey}`
                                    : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Fermer</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (activeEvent?.standaloneId) {
                                    dispatch({
                                        type: "DELETE_STANDALONE_EVENT",
                                        id: activeEvent.standaloneId,
                                    });
                                    toast.success("Événement supprimé");
                                }
                                setActiveEvent(null);
                            }}
                        >
                            Supprimer
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function DayRecapPanel({
    recap,
    selected,
    todayKey,
    showWsChip,
    onClose,
    onOpenLead,
    onPrevDay,
    onNextDay,
    onToday,
}) {
    const { summary, actions, dateKey } = recap;
    const isToday = dateKey === todayKey;
    const [filter, setFilter] = useState("all");
    const [sort, setSort] = useState("time");

    const visible = useMemo(
        () => filterAndSortRecap(actions, { filter, sort }),
        [actions, filter, sort]
    );

    const filters = RECAP_FILTERS.map((f) => ({
        ...f,
        count: f.id === "all"
            ? summary.total
            : (summary[f.id] || 0),
    })).filter((f) => f.id === "all" || f.count > 0 || ["activity", "agenda"].includes(f.id));

    const sortOptions = [
        { id: "time", label: "Heure" },
        { id: "company", label: "Entreprise" },
        { id: "kind", label: "Type" },
    ];

    const headline = (() => {
        const parts = [];
        if (summary.activity) {
            parts.push(`${summary.activity} fait${summary.activity > 1 ? "s" : ""}`);
        }
        if (summary.agenda) {
            parts.push(`${summary.agenda} prévu${summary.agenda > 1 ? "s" : ""}`);
        }
        // Détail utile si on a des joints / RDV
        const detail = [];
        if (summary.joint) detail.push(`${summary.joint} joint${summary.joint > 1 ? "s" : ""}`);
        if (summary.rdv) detail.push(`${summary.rdv} RDV`);
        if (summary.noanswer) detail.push(`${summary.noanswer} NRP`);
        if (detail.length && parts.length) {
            return `${parts.join(" · ")} — ${detail.join(", ")}`;
        }
        return parts.length ? parts.join(" · ") : "Rien à montrer";
    })();

    return (
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-background" data-testid="calendar-day-recap">
            {/* En-tête */}
            <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
                            Récap
                            {isToday ? " · aujourd'hui" : ""}
                        </p>
                        <h3 className="text-[22px] sm:text-[26px] font-semibold tracking-tight mt-1 capitalize leading-tight">
                            {format(selected, "EEEE d MMMM", { locale: fr })}
                        </h3>
                        <p className="text-[13px] text-muted-foreground mt-1.5">
                            {headline}
                        </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
                        <button
                            type="button"
                            onClick={onPrevDay}
                            aria-label="Jour précédent"
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        {!isToday && (
                            <button
                                type="button"
                                onClick={onToday}
                                className="h-9 px-2.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            >
                                Aujourd&apos;hui
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onNextDay}
                            aria-label="Jour suivant"
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Fermer le récap"
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Filtres + tri */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Filtrer le récap">
                        {filters.map((f) => {
                            const active = filter === f.id;
                            const disabled = f.id !== "all" && f.count === 0;
                            return (
                                <button
                                    key={f.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    disabled={disabled}
                                    data-testid={`recap-filter-${f.id}`}
                                    onClick={() => setFilter(f.id)}
                                    className={cn(
                                        "h-8 px-2.5 rounded-md text-[13px] transition-colors",
                                        disabled && "opacity-35 cursor-default",
                                        active
                                            ? "bg-foreground text-background font-medium"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                    )}
                                >
                                    {f.label}
                                    {f.count > 0 && (
                                        <span className={cn(
                                            "ml-1.5 tabular-nums text-[11px]",
                                            active ? "opacity-70" : "opacity-50"
                                        )}
                                        >
                                            {f.count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                data-testid="recap-sort-menu"
                                className="h-8 px-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex items-center gap-1.5"
                            >
                                <ArrowUpDown size={13} strokeWidth={2} />
                                {sortOptions.find((s) => s.id === sort)?.label || "Tri"}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 rounded-xl">
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Trier par
                            </DropdownMenuLabel>
                            {sortOptions.map((s) => (
                                <DropdownMenuItem
                                    key={s.id}
                                    onClick={() => setSort(s.id)}
                                    className="gap-2"
                                >
                                    {s.label}
                                    {sort === s.id && <Check size={14} className="ml-auto" />}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Liste */}
            <div className="flex-1 overflow-y-auto">
                {visible.length === 0 ? (
                    <div className="px-5 py-16 text-center max-w-sm mx-auto">
                        <p className="text-[15px] font-medium text-foreground">
                            {summary.total === 0
                                ? "Pas encore d'activité"
                                : "Rien dans ce filtre"}
                        </p>
                        <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
                            {summary.total === 0
                                ? "Joints, notes, contacts, RDV et rappels du jour s'affichent ici."
                                : "Changez de filtre pour revoir la liste."}
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-border/70">
                        {visible.map((a) => {
                            const time = format(new Date(a.at), "HH:mm");
                            const kindLabel = RECAP_KINDS[a.kind]?.label || a.kind;
                            const isAgenda = RECAP_KINDS[a.kind]?.group === "agenda";
                            const overdue = !!a.meta?.overdue;
                            const canOpen = !!(a.leadId && a.workspaceId);
                            return (
                                <li key={a.id}>
                                    <button
                                        type="button"
                                        data-testid={`day-recap-item-${a.leadId || a.standaloneId || "x"}`}
                                        disabled={!canOpen}
                                        onClick={() => {
                                            if (canOpen) onOpenLead(a.workspaceId, a.leadId);
                                        }}
                                        className={cn(
                                            "w-full text-left px-5 py-4 transition-colors flex gap-4 group",
                                            canOpen ? "hover:bg-muted/40" : "cursor-default opacity-90"
                                        )}
                                    >
                                        <time
                                            dateTime={a.at}
                                            className={cn(
                                                "w-11 shrink-0 text-[13px] tabular-nums pt-0.5",
                                                overdue ? "text-rose-600 font-medium" : "text-muted-foreground"
                                            )}
                                        >
                                            {time}
                                        </time>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline gap-2 flex-wrap">
                                                <span className="text-[15px] font-semibold tracking-tight text-foreground truncate">
                                                    {a.company}
                                                </span>
                                                <span className={cn(
                                                    "text-[12px] shrink-0",
                                                    overdue
                                                        ? "text-rose-600 font-medium"
                                                        : isAgenda
                                                          ? "text-primary"
                                                          : "text-muted-foreground"
                                                )}
                                                >
                                                    {kindLabel}
                                                    {overdue ? " · retard" : ""}
                                                </span>
                                            </div>
                                            <p className="text-[13px] text-muted-foreground mt-1 leading-snug line-clamp-2">
                                                {a.body}
                                            </p>
                                            {(a.stage || showWsChip) && (
                                                <p className="text-[12px] text-muted-foreground/80 mt-1.5 truncate">
                                                    {[a.stage, showWsChip ? a.workspaceName : null]
                                                        .filter(Boolean)
                                                        .join(" · ")}
                                                </p>
                                            )}
                                        </div>
                                        {canOpen && (
                                            <ChevronRight
                                                size={16}
                                                className="text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 mt-1 transition-colors"
                                            />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

function WatchPanel({ watchList, isDialog, onOpen, dispatch, state, compact = false }) {
    return (
        <div
            className={cn(
                "border-t border-border px-3 py-3 shrink-0 overflow-y-auto bg-muted/30",
                compact ? "max-h-[120px]" : "max-h-[160px]"
            )}
        >
            <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle size={12} className="text-rose-500" />
                <span className="text-[11px] font-semibold">À surveiller</span>
                <span className="text-[10px] text-muted-foreground">· {watchList.length}</span>
            </div>
            <div className="space-y-1">
                {watchList.slice(0, isDialog ? 5 : 8).map((ev) => (
                    <div
                        key={ev.id}
                        className="flex items-center gap-1 rounded-md hover:bg-background/80"
                        data-testid={`calendar-watch-${ev.leadId}`}
                    >
                        <button
                            type="button"
                            onClick={() => onOpen(ev.workspaceId, ev.leadId)}
                            className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                            <span className="text-[12px] font-medium truncate flex-1">{ev.title}</span>
                            <span className="text-[10px] text-rose-600 tabular-nums shrink-0">
                                {ev.meta?.daysSince} j
                            </span>
                        </button>
                        <QuickScheduleButton
                            company={ev.company || ev.title}
                            defaultLabel={`Rappeler ${ev.company || ev.title}`}
                            hint={ev.subtitle}
                            size="xs"
                            icon="plus"
                            testId={`calendar-watch-schedule-${ev.leadId}`}
                            onConfirm={(nextAction) => {
                                const result = scheduleLeadNextAction(dispatch, {
                                    workspace: state.workspaces[ev.workspaceId],
                                    leadId: ev.leadId,
                                    nextAction,
                                    move: true,
                                });
                                toast.success("Rappel placé", {
                                    description: result.moved && result.toColumnName
                                        ? `${nextAction.label} · → ${result.toColumnName}`
                                        : nextAction.label,
                                });
                            }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
