import React, { useMemo, useState, useEffect } from "react";
import { useCrm } from "@/context/CrmContext";
import {
    Search,
    Upload,
    Download,
    Plus,
    Bell,
    Settings2,
    Trash2,
    RotateCcw,
    Folders,
    Menu,
    X,
    Sun,
    Moon,
    Columns3,
    Undo2,
    Redo2,
    LayoutList,
    Table2,
    TrendingUp,
    Trello,
    Target,
    BellRing,
    Zap,
    PanelRight,
    Monitor,
    Info,
    MoreHorizontal,
    CheckCheck,
    AlertTriangle,
    CalendarDays,
    Keyboard,
    ChevronLeft,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { leadsToCsv } from "@/lib/csvUtils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
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
import {
    Sheet,
    SheetContent,
    SheetTrigger,
} from "@/components/ui/sheet";
import { getColumnColor } from "@/lib/columnColors";
import {
    getUnreadWorkspaceNotifs,
    markAllNotifsRead,
    markNotifItemRead,
} from "@/lib/followupNotifs";
import { collectCalendarEvents, countActionableToday } from "@/lib/calendarEvents";
import { useNotifSeenMap, useRecoDayTick, useCalendarSeenMap } from "@/hooks/useNotifSeenMap";
import { SidebarContent } from "./Sidebar";
import { CardFieldsPanel } from "./CardFieldsPanel";
import { DailyGoalWidget, DailyGoalEditor } from "./DailyGoalWidget";
import { CrmCalendar } from "./CrmCalendar";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

const QUICK_FILTERS = [
    { tag: "vigilance rouge", label: "Vigilance rouge", testId: "filter-vigilance-rouge" },
    { tag: "en retard", label: "En retard", testId: "filter-en-retard" },
];

export const TopBar = ({
    workspace,
    filter,
    setFilter,
    activeFilters,
    setActiveFilters,
    onImport,
    onNewLead,
    onOpenLead,
    onToggleSidebar,
    sidebarOpen,
    view,
    onViewChange,
    density = "compact",
    onDensityChange,
    quickMode,
    quickCount,
    onStopQuickMode,
}) => {
    const { state, dispatch, undo, redo, canUndo, canRedo } = useCrm();
    const isDark = state.theme === "dark";
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmResetView, setConfirmResetView] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [goalEditorOpen, setGoalEditorOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [filterInput, setFilterInput] = useState("");
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [notifOpen, setNotifOpen] = useState(false);

    // Raccourcis : focus / toggle recherche · ouvrir calendrier
    useEffect(() => {
        const focusSearchInput = () => {
            window.setTimeout(() => {
                document.querySelector('[data-testid="workspace-search-input"]')?.focus?.();
            }, 50);
        };
        const onFocusSearch = () => {
            setSearchOpen(true);
            focusSearchInput();
        };
        const onToggleSearch = () => {
            setSearchOpen((open) => {
                if (open) {
                    setFilterInput("");
                    setFilter("");
                    const el = document.querySelector('[data-testid="workspace-search-input"]');
                    if (el && typeof el.blur === "function") el.blur();
                    return false;
                }
                focusSearchInput();
                return true;
            });
        };
        const onOpenCalendar = () => setCalendarOpen(true);
        window.addEventListener("relia:focus-search", onFocusSearch);
        window.addEventListener("relia:toggle-search", onToggleSearch);
        window.addEventListener("relia:open-calendar", onOpenCalendar);
        return () => {
            window.removeEventListener("relia:focus-search", onFocusSearch);
            window.removeEventListener("relia:toggle-search", onToggleSearch);
            window.removeEventListener("relia:open-calendar", onOpenCalendar);
        };
    }, [setFilter]);

    const VIEWS = [
        { id: "kanban",   icon: <Trello size={15} />,      label: "Kanban" },
        { id: "list",     icon: <LayoutList size={15} />,   label: "Liste" },
        { id: "table",    icon: <Table2 size={15} />,       label: "Table" },
        { id: "pipeline", icon: <TrendingUp size={15} />,   label: "Pipeline" },
    ];

    const seenMap = useNotifSeenMap();
    const recoDayTick = useRecoDayTick();
    const calendarSeenMap = useCalendarSeenMap();

    const allWorkspaces = useMemo(
        () => state.order.map((id) => state.workspaces[id]).filter(Boolean),
        [state.order, state.workspaces]
    );

    const goalOpts = useMemo(
        () => ({ dailyGoal: state.settings?.dailyGoal || 20 }),
        [state.settings?.dailyGoal]
    );

    const calendarDueToday = useMemo(() => {
        const events = collectCalendarEvents(allWorkspaces, {
            standaloneEvents: state.standaloneEvents || [],
        });
        return countActionableToday(events, new Date(), calendarSeenMap);
    }, [allWorkspaces, state.standaloneEvents, calendarSeenMap]);

    const followups = useMemo(
        () => getUnreadWorkspaceNotifs(workspace, seenMap, goalOpts),
        [workspace.leads, workspace.columns, seenMap, goalOpts, recoDayTick] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const overdueCount = followups.filter((f) => f.overdue).length;
    const badgeCount = followups.length;

    const markNotifsAsRead = (e) => {
        e?.stopPropagation();
        const allWs = state.order.map((id) => state.workspaces[id]).filter(Boolean);
        markAllNotifsRead(allWs);
    };

    const openNotifLead = (item) => {
        markNotifItemRead({ ...item, _usageOutcome: "open" });
        setNotifOpen(false);
        // Laisser la fiche lead prendre le focus (évite popover au-dessus du panel)
        if (calendarOpen) setCalendarOpen(false);
        onOpenLead?.(item.lead);
    };

    const dismissNotif = (e, item) => {
        e?.stopPropagation();
        markNotifItemRead({ ...item, _usageOutcome: "dismiss" });
    };

    const exportCsv = () => {
        const leads = Object.values(workspace.leads).map((l) => ({
            ...l,
            _statusName: workspace.columns[l.columnId]?.name || "",
        }));
        // BOM UTF-8 pour qu'Excel ouvre correctement les accents / colonnes FR
        const csv = "\uFEFF" + leadsToCsv(leads);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${workspace.name.replace(/\s+/g, "_").toLowerCase()}_leads.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <>
        <header className="border-b border-border bg-surface/90 glass sticky top-0 z-50 safe-top">
            {/* Layout 3 colonnes : gauche / centre / droite */}
            <div className="px-3 sm:px-4 h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-2">

                {/* ── Colonne gauche : sidebar + titre ── */}
                <div className="flex items-center gap-2 min-w-0">
                    {/* Mobile: hamburger opens sidebar sheet */}
                    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                        <SheetTrigger asChild>
                            <button
                                data-testid="topbar-mobile-nav-btn"
                                aria-label="Ouvrir le menu"
                                className="md:hidden w-9 h-9 rounded-full flex items-center justify-center hover:bg-secondary text-muted-foreground shrink-0 touch-target"
                            >
                                <Menu size={17} />
                            </button>
                        </SheetTrigger>
                        <SheetContent
                            side="left"
                            className="w-72 p-0 border-r border-border bg-surface"
                            data-testid="mobile-sidebar-sheet"
                        >
                            <SidebarContent
                                forceExpanded
                                onNavigate={() => setMobileNavOpen(false)}
                            />
                        </SheetContent>
                    </Sheet>

                    {/* Desktop: sidebar permanente */}
                    <button
                        type="button"
                        data-testid="topbar-sidebar-toggle-btn"
                        onClick={onToggleSidebar}
                        aria-label={
                            sidebarOpen
                                ? "Replier la sidebar"
                                : "Afficher la sidebar"
                        }
                        aria-expanded={!!sidebarOpen}
                        title={
                            sidebarOpen
                                ? "Replier la sidebar (⌘:)"
                                : "Afficher la sidebar (⌘:)"
                        }
                        className={`hidden md:flex w-9 h-9 rounded-lg items-center justify-center shrink-0 transition-colors ${
                            sidebarOpen
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : "bg-primary/10 text-primary hover:bg-primary/15"
                        }`}
                    >
                        {sidebarOpen ? (
                            <ChevronLeft size={18} strokeWidth={2.25} />
                        ) : (
                            <Folders size={16} strokeWidth={2} />
                        )}
                    </button>

                    <div className="min-w-0">
                        <h1
                            className="text-sm sm:text-[15px] font-semibold tracking-tight truncate leading-tight"
                            data-testid="workspace-title"
                        >
                            {workspace.name}
                        </h1>
                        {workspace.sector && (
                            <p className="text-[10px] text-muted-foreground truncate hidden sm:block leading-none mt-0.5">
                                {workspace.sector}
                            </p>
                        )}
                    </div>
                </div>

                {/* ── Colonne centre : mode rapide (si actif) + objectif quotidien ── */}
                <div className="flex items-center justify-center gap-2 min-w-0 overflow-hidden">
                    {quickMode && (
                        <div className="flex items-center gap-1">
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium">
                                <Zap size={10} className="fill-primary shrink-0" />
                                <span>{quickCount}</span>
                            </div>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        aria-label="Aide mode rapide"
                                        className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
                                    >
                                        <Info size={10} strokeWidth={2.5} />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="center" sideOffset={6} className="w-52 p-3 rounded-xl text-xs space-y-1.5">
                                    <p className="font-semibold text-sm">Mode traitement rapide</p>
                                    <div className="space-y-1 text-muted-foreground">
                                        <p><kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[10px]">→</kbd> Contacter</p>
                                        <p><kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[10px]">↑↓</kbd> Naviguer</p>
                                        <p><kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono text-[10px]">Esc</kbd> Quitter</p>
                                    </div>
                                </PopoverContent>
                            </Popover>
                            <button
                                onClick={onStopQuickMode}
                                className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/20 transition-colors"
                            >
                                <X size={10} />
                            </button>
                        </div>
                    )}
                    <DailyGoalWidget
                        workspace={workspace}
                        onEditGoal={() => setGoalEditorOpen(true)}
                    />
                </div>

                {/* ── Colonne droite : actions essentielles ── */}
                <div className="flex items-center gap-1.5 justify-end min-w-0">
                    {/* Calendrier */}
                    <button
                        type="button"
                        data-testid="topbar-calendar-btn"
                        aria-label="Ouvrir le calendrier"
                        title="Calendrier"
                        onClick={() => setCalendarOpen(true)}
                        className="relative w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors touch-target"
                    >
                        <CalendarDays size={16} />
                        {calendarDueToday > 0 && (
                            <span
                                data-testid="topbar-calendar-badge"
                                className="absolute top-1 right-1 min-w-[15px] h-3.5 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center text-white bg-primary"
                            >
                                {calendarDueToday > 9 ? "9+" : calendarDueToday}
                            </span>
                        )}
                    </button>

                    {/* Recherche (ouvre une rangée pleine largeur) */}
                    <button
                        data-testid="topbar-search-btn"
                        aria-label="Rechercher"
                        onClick={() => {
                            setSearchOpen((v) => !v);
                            if (searchOpen) {
                                setFilterInput("");
                                setFilter("");
                            }
                        }}
                        className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-colors touch-target ${
                            searchOpen || (activeFilters || []).length > 0
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-secondary text-muted-foreground"
                        }`}
                    >
                        <Search size={16} />
                        {(activeFilters || []).length > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                                {(activeFilters || []).length}
                            </span>
                        )}
                    </button>

                    {/* Filtre vigilance rouge — recalculé en live sur les données */}
                    {(() => {
                        const active = (activeFilters || []).some(
                            (t) => t.toLowerCase() === "vigilance rouge"
                        );
                        return (
                            <button
                                type="button"
                                data-testid="topbar-vigilance-rouge-btn"
                                aria-label="Filtrer vigilance rouge"
                                aria-pressed={active}
                                title="Afficher uniquement les leads en vigilance rouge"
                                onClick={() => {
                                    const list = activeFilters || [];
                                    const isActive = list.some(
                                        (t) => t.toLowerCase() === "vigilance rouge"
                                    );
                                    if (isActive) {
                                        const next = list.filter(
                                            (t) => t.toLowerCase() !== "vigilance rouge"
                                        );
                                        setActiveFilters(next);
                                        // Un clic = tout fermer : filtre + barre de recherche
                                        if (next.length === 0) setSearchOpen(false);
                                    } else {
                                        setActiveFilters([...list, "vigilance rouge"]);
                                        setSearchOpen(true);
                                    }
                                    setFilterInput("");
                                    setFilter("");
                                }}
                                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors touch-target ${
                                    active
                                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                        : "hover:bg-secondary text-muted-foreground hover:text-rose-600"
                                }`}
                            >
                                <AlertTriangle size={15} strokeWidth={2.25} />
                            </button>
                        );
                    })()}

                    {/* Notifications intelligentes = hors agenda calendrier */}
                    <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                        <PopoverTrigger asChild>
                            <button
                                data-testid="topbar-notifications-btn"
                                aria-label="Notifications"
                                className="relative w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors touch-target"
                            >
                                <Bell size={16} />
                                {badgeCount > 0 && (
                                    <span
                                        data-testid="notif-badge"
                                        className={`absolute top-1.5 right-1.5 min-w-[15px] h-3.5 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center text-white ${overdueCount > 0 ? "bg-rose-500" : "bg-primary"}`}
                                    >
                                        {badgeCount}
                                    </span>
                                )}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            className="w-80 p-0 rounded-xl overflow-hidden shadow-panel bg-popover border border-border"
                            data-testid="notif-popover"
                        >
                            <div className="px-4 py-3 border-b border-border/60 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="font-semibold tracking-tight text-sm">Notifications</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                        {badgeCount === 0
                                            ? "Rien d'urgent pour l'instant."
                                            : overdueCount > 0
                                              ? `${overdueCount} manqué${overdueCount > 1 ? "s" : ""} · ${badgeCount} notification${badgeCount > 1 ? "s" : ""}`
                                              : `${badgeCount} notification${badgeCount > 1 ? "s" : ""} à regarder`}
                                    </div>
                                </div>
                                {badgeCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={markNotifsAsRead}
                                        title="Tout lire (tous les espaces)"
                                        aria-label="Tout lire les notifications"
                                        data-testid="notif-mark-read-btn"
                                        className="shrink-0 h-8 px-2.5 rounded-full flex items-center gap-1 text-[11px] font-medium transition-colors text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10"
                                    >
                                        <CheckCheck size={14} strokeWidth={2} />
                                        Tout lire
                                    </button>
                                )}
                            </div>
                            <div className="max-h-80 overflow-y-auto">
                                {followups.length === 0 && (
                                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                                        Aucune notification pour l&apos;instant. Les RDV et rappels restent dans le calendrier.
                                    </div>
                                )}
                                {followups.map((item) => {
                                    const { lead, overdue, label, title, key } = item;
                                    const col = lead ? workspace.columns[lead.columnId] : null;
                                    const cc = col ? getColumnColor(col) : { dot: "bg-primary" };
                                    return (
                                        <div
                                            key={key}
                                            className="border-b border-border/40 last:border-0 flex items-stretch hover:bg-secondary/70 transition-colors"
                                        >
                                            <button
                                                type="button"
                                                data-testid={`notif-item-${lead?.id || "tip"}`}
                                                onClick={() => lead && openNotifLead(item)}
                                                disabled={!lead}
                                                className="flex-1 min-w-0 text-left px-4 py-3 flex gap-3 disabled:cursor-default"
                                            >
                                                <span className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${overdue ? "bg-rose-500" : cc.dot}`} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="text-sm font-medium truncate">
                                                            {lead?.company || title || "Notification"}
                                                        </div>
                                                        {overdue && (
                                                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-rose-500" aria-hidden />
                                                        )}
                                                    </div>
                                                    <div className="text-[11px] text-muted-foreground truncate">
                                                        {title && lead?.company ? `${title} · ` : ""}
                                                        {label}
                                                    </div>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                title="Marquer comme lu"
                                                aria-label="Marquer comme lu"
                                                data-testid={`notif-dismiss-${lead?.id || key}`}
                                                onClick={(e) => dismissNotif(e, item)}
                                                className="shrink-0 px-3 text-muted-foreground hover:text-foreground self-center"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Overflow : champs cartes, undo/redo, thème */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                data-testid="topbar-more-btn"
                                aria-label="Plus d'actions"
                                className="w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors touch-target"
                            >
                                <MoreHorizontal size={16} />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 rounded-xl">
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Actions
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                disabled={!canUndo()}
                                onClick={() => {
                                    const did = undo();
                                    if (did) import("sonner").then(({ toast }) => toast("Action annulée", { duration: 2000 }));
                                }}
                                data-testid="topbar-undo-btn"
                            >
                                <Undo2 size={14} className="mr-2" /> Annuler
                                <span className="ml-auto text-[10px] text-muted-foreground">⌘Z</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={!canRedo()}
                                onClick={() => {
                                    const did = redo();
                                    if (did) import("sonner").then(({ toast }) => toast("Action rétablie", { duration: 2000 }));
                                }}
                                data-testid="topbar-redo-btn"
                            >
                                <Redo2 size={14} className="mr-2" /> Rétablir
                                <span className="ml-auto text-[10px] text-muted-foreground">⌘⇧Z</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="hidden sm:flex"
                                onClick={() => dispatch({ type: "SET_THEME", theme: isDark ? "light" : "dark" })}
                            >
                                {isDark ? <Sun size={14} className="mr-2" /> : <Moon size={14} className="mr-2" />}
                                {isDark ? "Mode clair" : "Mode sombre"}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Champs cartes */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                data-testid="topbar-card-fields-btn"
                                aria-label="Configurer les champs affichés sur les cartes"
                                title="Configurer la vue des cartes"
                                className="w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors touch-target"
                            >
                                <Columns3 size={16} />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            className="p-0 rounded-xl overflow-hidden shadow-panel bg-popover border border-border w-auto"
                            data-testid="card-fields-popover"
                        >
                            <CardFieldsPanel workspace={workspace} />
                        </PopoverContent>
                    </Popover>

                    {/* Paramètres */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                data-testid="topbar-settings-btn"
                                aria-label="Paramètres de l'espace"
                                className="w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors touch-target"
                            >
                                <Settings2 size={16} />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 rounded-xl">
                            <DropdownMenuItem
                                className="sm:hidden"
                                onClick={() => dispatch({ type: "SET_THEME", theme: isDark ? "light" : "dark" })}
                                data-testid="settings-theme-btn"
                            >
                                {isDark ? <Sun size={14} className="mr-2" /> : <Moon size={14} className="mr-2" />}
                                {isDark ? "Mode clair" : "Mode sombre"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="sm:hidden" />

                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Vue
                            </DropdownMenuLabel>
                            {VIEWS.map((v) => (
                                <DropdownMenuItem
                                    key={v.id}
                                    onClick={() => onViewChange(v.id)}
                                    data-testid={`settings-view-${v.id}`}
                                    className={view === v.id ? "bg-accent" : undefined}
                                >
                                    <span className="mr-2 inline-flex shrink-0 opacity-80">{v.icon}</span>
                                    <span className="flex-1">{v.label}</span>
                                    {view === v.id && (
                                        <span className="text-[10px] text-muted-foreground font-medium">Actif</span>
                                    )}
                                </DropdownMenuItem>
                            ))}
                            <div className="px-2 py-1.5">
                                <p className="text-[11px] text-muted-foreground mb-1.5">
                                    Densité des cartes
                                </p>
                                <div
                                    className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5"
                                    role="tablist"
                                    aria-label="Densité"
                                >
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={density === "compact"}
                                        onClick={() => onDensityChange?.("compact")}
                                        className={`flex-1 h-8 text-[12px] font-medium rounded-md transition-all ${
                                            density === "compact"
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                        data-testid="density-compact-btn"
                                    >
                                        Compact
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={density === "comfort"}
                                        onClick={() => onDensityChange?.("comfort")}
                                        className={`flex-1 h-8 text-[12px] font-medium rounded-md transition-all ${
                                            density === "comfort"
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                        data-testid="density-comfort-btn"
                                    >
                                        Confort
                                    </button>
                                </div>
                            </div>
                            <DropdownMenuSeparator />

                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Objectifs
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                onClick={() => setGoalEditorOpen(true)}
                                data-testid="settings-daily-goal-btn"
                            >
                                <Target size={14} className="mr-2" /> Objectif quotidien
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Aide
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                onClick={() => setShortcutsOpen(true)}
                                data-testid="settings-shortcuts-btn"
                            >
                                <Keyboard size={14} className="mr-2" /> Raccourcis clavier
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Rappels
                            </DropdownMenuLabel>
                            <div className="px-2 py-1.5">
                                <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1.5">
                                    <BellRing size={10} />
                                    Colonne de rappel auto
                                </p>
                                <div className="relative">
                                    <select
                                        value={workspace.columnOrder.find(
                                            (cid) => workspace.columns[cid]?.autoFollowup
                                        ) || ""}
                                        onChange={(e) => {
                                            workspace.columnOrder.forEach((cid) => {
                                                if (workspace.columns[cid]?.autoFollowup) {
                                                    dispatch({
                                                        type: "SET_COLUMN_AUTO_FOLLOWUP",
                                                        workspaceId: workspace.id,
                                                        columnId: cid,
                                                        enabled: false,
                                                    });
                                                }
                                            });
                                            if (e.target.value) {
                                                dispatch({
                                                    type: "SET_COLUMN_AUTO_FOLLOWUP",
                                                    workspaceId: workspace.id,
                                                    columnId: e.target.value,
                                                    enabled: true,
                                                });
                                            }
                                        }}
                                        className="w-full h-8 pl-2 pr-7 rounded-lg bg-secondary border border-border text-[12px] text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                                    >
                                        <option value="">— Aucune —</option>
                                        {workspace.columnOrder.map((cid) => {
                                            const col = workspace.columns[cid];
                                            if (!col) return null;
                                            return (
                                                <option key={cid} value={cid}>
                                                    {col.name}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    <BellRing size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                </div>
                            </div>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Affichage
                            </DropdownMenuLabel>
                            <div className="px-2 py-1.5">
                                <p className="text-[10px] text-muted-foreground mb-1.5">Fenêtre du lead</p>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => dispatch({ type: "SET_LEAD_PANEL_MODE", mode: "side" })}
                                        title="Panneau latéral"
                                        className={"flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs border transition-colors " + (state.leadPanelMode !== "modal" ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:bg-secondary")}
                                    >
                                        <PanelRight size={13} /> Côté
                                    </button>
                                    <button
                                        onClick={() => dispatch({ type: "SET_LEAD_PANEL_MODE", mode: "modal" })}
                                        title="Modale centrée"
                                        className={"flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-xs border transition-colors " + (state.leadPanelMode === "modal" ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:bg-secondary")}
                                    >
                                        <Monitor size={13} /> Centre
                                    </button>
                                </div>
                            </div>
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Données
                            </DropdownMenuLabel>
                            <DropdownMenuItem onClick={onImport} data-testid="settings-import-btn">
                                <Upload size={14} className="mr-2" /> Importer un CSV
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={exportCsv}
                                disabled={Object.keys(workspace.leads).length === 0}
                                data-testid="settings-export-btn"
                            >
                                <Download size={14} className="mr-2" /> Exporter les leads
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Espace
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                onClick={() => setConfirmResetView(true)}
                                data-testid="settings-reset-pipeline-btn"
                            >
                                <RotateCcw size={14} className="mr-2" /> Remettre la vue à zéro
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmDelete(true)}
                                data-testid="settings-delete-workspace-btn"
                            >
                                <Trash2 size={14} className="mr-2" /> Supprimer l'espace
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                        onClick={() => onNewLead()}
                        data-testid="topbar-new-lead-btn"
                        aria-label="Nouveau lead"
                        title="Nouveau lead"
                        className="w-9 h-9 rounded-full p-0 bg-primary text-primary-foreground hover:bg-primary/90 touch-target"
                    >
                        <Plus size={16} />
                    </Button>
                </div>
            </div>

            {/* Rangée recherche pleine largeur */}
            {searchOpen && (
                <div className="px-3 sm:px-4 pb-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
                    {(activeFilters || []).length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                            {(activeFilters || []).map((tag) => (
                                <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/12 border border-primary/25 text-primary text-[11px] font-medium"
                                >
                                    {tag}
                                    <button
                                        onClick={() => setActiveFilters((prev) => prev.filter((t) => t !== tag))}
                                        className="hover:text-rose-500 transition-colors"
                                        aria-label={`Retirer le filtre ${tag}`}
                                    >
                                        <X size={9} strokeWidth={2.5} />
                                    </button>
                                </span>
                            ))}
                            <button
                                onClick={() => setActiveFilters([])}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                                title="Effacer tous les filtres"
                            >
                                Tout effacer
                            </button>
                        </div>
                    )}
                    <div className="relative flex-1 min-w-[180px]">
                        <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <Input
                            data-testid="workspace-search-input"
                            value={filterInput}
                            onChange={(e) => {
                                setFilterInput(e.target.value);
                                setFilter(e.target.value);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && filterInput.trim()) {
                                    const val = filterInput.trim();
                                    if (!(activeFilters || []).includes(val)) {
                                        setActiveFilters((prev) => [...prev, val]);
                                    }
                                    setFilterInput("");
                                    setFilter("");
                                    e.preventDefault();
                                } else if (e.key === "Backspace" && !filterInput && (activeFilters || []).length > 0) {
                                    setActiveFilters((prev) => prev.slice(0, -1));
                                } else if (e.key === "Escape") {
                                    setFilterInput("");
                                    setFilter("");
                                    setSearchOpen(false);
                                }
                            }}
                            placeholder={(activeFilters || []).length > 0 ? "Ajouter un filtre…" : "Rechercher ou filtrer…"}
                            autoFocus
                            className="pl-8 pr-3 h-9 w-full rounded-lg bg-secondary/70 border-transparent focus-visible:bg-background transition-colors text-[13px]"
                        />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {QUICK_FILTERS.map(({ tag, label, testId }) => {
                            const active = (activeFilters || []).some(
                                (t) => t.toLowerCase() === tag.toLowerCase()
                            );
                            return (
                                <button
                                    key={tag}
                                    type="button"
                                    data-testid={testId}
                                    onClick={() => {
                                        setActiveFilters((prev) => {
                                            const list = prev || [];
                                            if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) {
                                                return list.filter((t) => t.toLowerCase() !== tag.toLowerCase());
                                            }
                                            return [...list, tag];
                                        });
                                        setFilterInput("");
                                        setFilter("");
                                    }}
                                    className={`h-8 px-2.5 rounded-full text-[11px] font-medium border transition-colors ${
                                        active
                                            ? tag === "vigilance rouge"
                                                ? "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300"
                                                : "bg-primary/12 border-primary/30 text-primary"
                                            : "bg-secondary/60 border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary"
                                    }`}
                                    title={
                                        tag === "vigilance rouge"
                                            ? "Afficher uniquement les leads en vigilance critique"
                                            : undefined
                                    }
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <AlertDialog open={confirmResetView} onOpenChange={(v) => !v && setConfirmResetView(false)}>
                <AlertDialogContent className="rounded-2xl" data-testid="reset-pipeline-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remettre la vue à zéro ?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tous les leads ({Object.keys(workspace.leads || {}).length}) reviennent en
                            « Nouveau ». Rappels, RDV et statuts gagné/perdu sont effacés.
                            Notes, contacts et réglages (champs carte, colonnes) restent intacts.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid="confirm-reset-pipeline-btn"
                            onClick={() => {
                                const count = Object.keys(workspace.leads || {}).length;
                                dispatch({
                                    type: "RESET_PIPELINE_VIEW",
                                    workspaceId: workspace.id,
                                });
                                setConfirmResetView(false);
                                import("sonner").then(({ toast }) =>
                                    toast.success("Vue remise à zéro", {
                                        description: count
                                            ? `${count} lead${count > 1 ? "s" : ""} en Nouveau`
                                            : "Aucun lead à déplacer",
                                    })
                                );
                            }}
                        >
                            Remettre à zéro
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(false)}>
                <AlertDialogContent className="rounded-2xl" data-testid="delete-current-ws-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer « {workspace.name} » ?</AlertDialogTitle>
                        <AlertDialogDescription>
                            L'espace, ses colonnes et tous ses leads seront supprimés. Cette action est irréversible.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid="confirm-delete-current-ws-btn"
                            onClick={() => {
                                dispatch({ type: "DELETE_WORKSPACE", id: workspace.id });
                                setConfirmDelete(false);
                            }}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            Supprimer l'espace
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </header>

        {/* Editor modal en dehors du header pour éviter les problèmes de z-index */}
        <DailyGoalEditor open={goalEditorOpen} onClose={() => setGoalEditorOpen(false)} />
        <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

        <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
            <DialogContent
                className="rounded-2xl sm:max-w-[min(1100px,94vw)] w-full max-h-[92vh] p-0 gap-0 overflow-hidden border-border bg-background"
                data-testid="topbar-calendar-dialog"
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>Calendrier</DialogTitle>
                    <DialogDescription>Agenda CRM</DialogDescription>
                </DialogHeader>
                <CrmCalendar
                    workspaces={allWorkspaces}
                    currentWorkspace={workspace}
                    variant="dialog"
                    className="border-0 rounded-2xl"
                    onOpenLead={() => setCalendarOpen(false)}
                />
            </DialogContent>
        </Dialog>
        </>
    );
};
