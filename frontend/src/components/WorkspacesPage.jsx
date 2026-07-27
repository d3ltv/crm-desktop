import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy } from "react";
import { useCrm } from "@/context/CrmContext";
import { Button } from "@/components/ui/button";
import {
    Plus, LayoutGrid, Trash2, Users, Trophy,
    ChevronRight, Briefcase, Target, Activity,
    Clock3, Zap, Download, Upload, Search, RefreshCw,
} from "lucide-react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalNotifBell } from "./GlobalNotifBell";
import { StorageErrorBanner } from "./StorageErrorBanner";
import { SidebarIconDisplay } from "./SidebarIconPicker";
import { navIdForWorkspace } from "@/lib/sidebarNav";
import { getColumnColor } from "@/lib/columnColors";
import {
    computeWorkspaceStats,
    computePipelineValue,
    computeMonthOverMonthTrends,
    formatTrendLabel,
} from "@/lib/statsUtils";
import { countUnreadWorkspaceNotifs } from "@/lib/followupNotifs";
import { useNotifSeenMap } from "@/hooks/useNotifSeenMap";
import { getBestProspectingSlot } from "@/lib/prospectingSlots";
import { CrmCalendar } from "./CrmCalendar";
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

const StatsDashboard = lazy(() =>
    import("./StatsDashboard").then((m) => ({ default: m.StatsDashboard }))
);
const DISPLAY_NAME_KEY = "crm_display_name";
const PENDING_FILTER_KEY = "crm_pending_filter";

const fmt = (n) =>
    new Intl.NumberFormat("fr-FR", {
        style: "currency", currency: "EUR", maximumFractionDigits: 0,
    }).format(n);

function relDate(iso) {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return "aujourd'hui";
    if (d === 1) return "hier";
    if (d < 7) return `il y a ${d} j`;
    if (d < 30) return `il y a ${Math.floor(d / 7)} sem.`;
    return `il y a ${Math.floor(d / 30)} mois`;
}

function openWorkspaceWithFilter(dispatch, workspaceId, filterTag) {
    try {
        if (filterTag) {
            sessionStorage.setItem(
                PENDING_FILTER_KEY,
                JSON.stringify({ workspaceId, filter: filterTag })
            );
        }
    } catch { /* ignore */ }
    dispatch({ type: "SELECT_WORKSPACE", id: workspaceId });
}

function loadDisplayName() {
    try {
        return localStorage.getItem(DISPLAY_NAME_KEY) || "";
    } catch {
        return "";
    }
}

// ── Greeting ────────────────────────────────────────────────────────────────
const Greeting = () => {
    const [name, setName] = useState(loadDisplayName);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const inputRef = useRef(null);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const save = () => {
        const next = draft.trim().slice(0, 40);
        setName(next);
        setEditing(false);
        try {
            if (next) localStorage.setItem(DISPLAY_NAME_KEY, next);
            else localStorage.removeItem(DISPLAY_NAME_KEY);
        } catch { /* ignore */ }
    };

    return (
        <div className="mb-8">
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-foreground leading-tight">
                {editing ? (
                    <span className="inline-flex items-baseline gap-2 flex-wrap">
                        Bonjour,{" "}
                        <input
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={save}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") save();
                                if (e.key === "Escape") {
                                    setDraft(name);
                                    setEditing(false);
                                }
                            }}
                            placeholder="votre prénom"
                            className="bg-transparent border-b border-primary/40 outline-none min-w-[8ch] max-w-[16ch] font-semibold"
                            aria-label="Modifier le prénom"
                        />
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            setDraft(name);
                            setEditing(true);
                        }}
                        className="text-left hover:opacity-80 transition-opacity"
                        title="Cliquer pour personnaliser"
                    >
                        {name ? `Bonjour, ${name} 👋` : "Bonjour 👋"}
                    </button>
                )}
            </h1>
            <p className="text-[15px] text-muted-foreground mt-2">
                Voici un aperçu de votre activité commerciale
            </p>
        </div>
    );
};

// ── Global KPI bar ──────────────────────────────────────────────────────────
const GlobalKPIs = ({ workspaces, onOpenOverdue, onPipelineClick }) => {
    const trends = useMemo(() => computeMonthOverMonthTrends(workspaces), [workspaces]);

    const stats = useMemo(() => {
        let totalLeads = 0;
        let totalPipeline = 0;
        let totalOverdue = 0;
        workspaces.forEach((ws) => {
            const s = computeWorkspaceStats(ws);
            totalLeads += s.total;
            totalPipeline += computePipelineValue(ws);
            totalOverdue += s.overdueFollowups || 0;
        });
        return { totalLeads, totalPipeline, totalOverdue, spaces: workspaces.length };
    }, [workspaces]);

    const items = [
        {
            label: "Espaces",
            value: stats.spaces,
            sub: formatTrendLabel(null, { delta: trends.spacesDelta, unit: "ce mois" }),
        },
        {
            label: "Leads total",
            value: stats.totalLeads,
            sub: formatTrendLabel(trends.leadsPct),
            tone: trends.leadsPct != null && trends.leadsPct > 0 ? "success" : "neutral",
        },
        {
            label: "Pipeline",
            value: stats.totalPipeline > 0 ? fmt(stats.totalPipeline) : "—",
            sub: stats.totalPipeline > 0 ? "Valeur deals actifs" : "Aucune donnée",
            onClick: onPipelineClick,
        },
        {
            label: "Relances dues",
            value: stats.totalOverdue || "0",
            sub: stats.totalOverdue > 0 ? "À traiter" : "Tout est à jour",
            tone: stats.totalOverdue > 0 ? "danger" : "neutral",
            onClick: stats.totalOverdue > 0 ? onOpenOverdue : undefined,
        },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
            {items.map((kpi) => {
                const clickable = typeof kpi.onClick === "function";
                const Comp = clickable ? "button" : "div";
                return (
                    <Comp
                        key={kpi.label}
                        type={clickable ? "button" : undefined}
                        onClick={kpi.onClick}
                        className={`rounded-xl border border-border/60 bg-card p-4 text-left transition-colors ${
                            clickable
                                ? "hover:border-foreground/15 hover:bg-muted/40 cursor-pointer"
                                : ""
                        }`}
                    >
                        <div className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
                            {kpi.label}
                        </div>
                        <div
                            className={`text-[22px] font-semibold tracking-tight leading-tight mt-1.5 tabular-nums ${
                                kpi.tone === "danger"
                                    ? "text-rose-600 dark:text-rose-400"
                                    : kpi.tone === "success"
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-foreground"
                            }`}
                        >
                            {kpi.value}
                        </div>
                        {kpi.sub && (
                            <div
                                className={`text-[12px] mt-1.5 ${
                                    kpi.tone === "danger"
                                        ? "text-rose-600/80 dark:text-rose-400/80 font-medium"
                                        : kpi.tone === "success"
                                          ? "text-emerald-600 dark:text-emerald-400"
                                          : "text-muted-foreground"
                                }`}
                            >
                                {kpi.sub}
                            </div>
                        )}
                    </Comp>
                );
            })}
        </div>
    );
};

// ── Workspace card ───────────────────────────────────────────────────────────
const WorkspaceCard = ({ ws, onOpen, onOpenColumn, onOpenOverdue, onDelete, isRecent, icon, notifCount = 0 }) => {
    const stats = useMemo(() => computeWorkspaceStats(ws), [ws]);
    const pipeline = useMemo(() => computePipelineValue(ws), [ws]);
    const isJobs = ws.template === "jobs";

    const firstColId =
        ws.columnOrder.find((cid) =>
            Object.values(ws.leads).some((l) => l.columnId === cid)
        ) || ws.columnOrder[0];
    const dominantColor = getColumnColor(ws.columns[firstColId]);

    const colDist = ws.columnOrder.slice(0, 6).map((cid) => {
        const col = ws.columns[cid];
        const count = Object.values(ws.leads).filter((l) => l.columnId === cid).length;
        const color = getColumnColor(col);
        return { id: cid, name: col.name, count, color };
    });

    const fallbackAvatar = isJobs ? "💼" : (ws.name[0] || "?").toUpperCase();

    return (
        <div
            data-testid={`workspace-card-${ws.id}`}
            onClick={onOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
            className="group relative rounded-xl border border-border bg-card overflow-hidden cursor-pointer hover:border-foreground/15 hover:shadow-card-hover transition-all duration-150"
        >
            <div className={`h-0.5 w-full ${dominantColor.dot}`} />

            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
                {notifCount > 0 && (
                    <span
                        className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums shadow-sm"
                        title={`${notifCount} notification${notifCount > 1 ? "s" : ""}`}
                        data-testid={`workspace-card-notif-${ws.id}`}
                    >
                        {notifCount > 99 ? "99+" : notifCount}
                    </span>
                )}
                {isRecent && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[9px] font-semibold">
                        <Clock3 size={8} />
                        Récent
                    </div>
                )}
            </div>

            <div className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2.5">
                    <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white text-[14px] font-bold ${dominantColor.dot}`}
                    >
                        {icon ? (
                            <SidebarIconDisplay
                                icon={icon}
                                size={16}
                                className="text-white"
                                fallback={<span>{fallbackAvatar}</span>}
                            />
                        ) : (
                            fallbackAvatar
                        )}
                    </div>
                    <div className="min-w-0 flex-1 pr-10">
                        <h3 className="font-semibold text-[13.5px] text-foreground truncate leading-tight">
                            {ws.name}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                            <span className="tabular-nums font-medium text-foreground/80">
                                {stats.total} lead{stats.total !== 1 ? "s" : ""}
                            </span>
                            {ws.sector && (
                                <>
                                    <span className="text-border">·</span>
                                    <span className="truncate">{ws.sector}</span>
                                </>
                            )}
                            {isJobs && (
                                <span className="inline-flex px-1 py-0 rounded text-[9px] font-medium bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                    Jobs
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {(pipeline > 0 || stats.overdueFollowups > 0) && (
                    <div className="flex items-center gap-2.5 mb-2 text-[11px] flex-wrap">
                        {pipeline > 0 && (
                            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <Trophy size={11} strokeWidth={1.75} />
                                <span className="font-semibold tabular-nums">{fmt(pipeline)}</span>
                            </div>
                        )}
                        {stats.overdueFollowups > 0 && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenOverdue?.();
                                }}
                                className="inline-flex items-center gap-1 text-rose-500 hover:text-rose-600 font-medium"
                            >
                                <Zap size={11} strokeWidth={1.75} />
                                <span className="tabular-nums">{stats.overdueFollowups}</span>
                                <span>en retard</span>
                            </button>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap gap-1 mb-2.5">
                    {colDist
                        .filter((c) => c.count > 0)
                        .slice(0, 3)
                        .map((col) => (
                            <button
                                key={col.id || col.name}
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenColumn?.(col.name);
                                }}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white ${col.color.dot} hover:brightness-110 transition-[filter]`}
                                title={`Ouvrir · filtre « ${col.name} »`}
                            >
                                {col.name}
                                <span className="opacity-90 tabular-nums">· {col.count}</span>
                            </button>
                        ))}
                    {colDist.filter((c) => c.count > 0).length > 3 && (
                        <span className="text-[10px] text-muted-foreground px-0.5 self-center">
                            +{colDist.filter((c) => c.count > 0).length - 3}
                        </span>
                    )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground truncate">
                        {stats.lastActivityAt ? (
                            <>
                                <Activity size={10} />
                                <span className="truncate">
                                    {relDate(new Date(stats.lastActivityAt).toISOString())}
                                </span>
                            </>
                        ) : (
                            <span className="italic">Aucune activité</span>
                        )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                        <button
                            data-testid={`workspace-delete-${ws.id}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            aria-label="Supprimer"
                            className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                            <Trash2 size={12} />
                        </button>
                        <div className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                            <ChevronRight size={13} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Main page ────────────────────────────────────────────────────────────────
export const WorkspacesPage = () => {
    const { state, dispatch, exportBackup, importBackup } = useCrm();
    const seenMap = useNotifSeenMap();
    const [open, setOpen] = useState(false);
    const [confirmDel, setConfirmDel] = useState(null);
    const [search, setSearch] = useState("");
    const [alertRequest, setAlertRequest] = useState(null);
    const searchRef = useRef(null);

    const workspaces = state.order.map((id) => state.workspaces[id]).filter(Boolean);
    const isEmpty = workspaces.length === 0;

    const prospectingSlot = useMemo(
        () => (isEmpty ? null : getBestProspectingSlot(workspaces)),
        [workspaces, isEmpty]
    );

    const handleImportBackup = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => importBackup(ev.target.result);
            reader.readAsText(file);
        };
        input.click();
    };

    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const recentId = state.lastOpenedId || state.order[state.order.length - 1];

    const filteredWorkspaces = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = [...workspaces];
        if (q) {
            list = list.filter(
                (ws) =>
                    (ws.name || "").toLowerCase().includes(q) ||
                    (ws.sector || "").toLowerCase().includes(q)
            );
        }
        return list.sort((a, b) => {
            if (a.id === recentId) return -1;
            if (b.id === recentId) return 1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
    }, [workspaces, recentId, search]);

    const clearAlertRequest = useCallback(() => setAlertRequest(null), []);

    const scrollToRevenue = () => {
        const el = document.getElementById("stats-revenue") || document.getElementById("stats-section");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const nav = (
        <nav className="border-b border-border bg-surface/90 glass sticky top-0 z-30">
            <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <LayoutGrid size={14} />
                    </div>
                    <span className="font-semibold text-[15px] hidden sm:inline">Mon CRM</span>
                </div>

                {!isEmpty && (
                    <div className="flex-1 max-w-md mx-auto relative">
                        <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <input
                            ref={searchRef}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Rechercher un espace…"
                            className="w-full h-9 pl-9 pr-14 rounded-lg border border-border bg-background text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                            aria-label="Rechercher un espace"
                        />
                        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 h-5 rounded border border-border text-[10px] text-muted-foreground font-medium tabular-nums">
                            ⌘K
                        </kbd>
                    </div>
                )}

                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    {!isEmpty && <GlobalNotifBell />}
                    <ThemeToggle />
                    {!isEmpty && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleImportBackup}
                                className="h-8 w-8 rounded-lg text-muted-foreground"
                                title="Restaurer un backup"
                            >
                                <Upload size={14} />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={exportBackup}
                                className="h-8 w-8 rounded-lg text-muted-foreground"
                                title="Exporter un backup JSON"
                            >
                                <Download size={14} />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => window.location.reload()}
                                className="h-8 w-8 rounded-lg text-muted-foreground"
                                title="Actualiser"
                            >
                                <RefreshCw size={14} />
                            </Button>
                        </>
                    )}
                    <Button
                        data-testid="create-workspace-header-btn"
                        onClick={() => setOpen(true)}
                        className="h-8 rounded-lg px-3 gap-1.5 bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                    >
                        <Plus size={14} />
                        <span className="hidden sm:inline">Nouvel espace</span>
                    </Button>
                </div>
            </div>
        </nav>
    );

    if (isEmpty) {
        return (
            <div className="min-h-screen bg-background" data-testid="workspaces-page">
                {nav}
                <OnboardingHero onCreate={() => setOpen(true)} />
                <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background" data-testid="workspaces-page">
            <StorageErrorBanner />
            {nav}

            <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
                <Greeting />
                {prospectingSlot && (
                    <div
                        className="mb-6 -mt-4 inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-[12px] text-muted-foreground"
                        data-testid="home-prospecting-slot"
                        title={prospectingSlot.detailLabel}
                    >
                        <Clock3 size={13} className="text-primary shrink-0" />
                        <span>
                            Créneau à prioriser :{" "}
                            <span className="font-medium text-foreground">{prospectingSlot.shortLabel}</span>
                        </span>
                    </div>
                )}
                <GlobalKPIs
                    workspaces={workspaces}
                    onOpenOverdue={() => setAlertRequest("overdue")}
                    onPipelineClick={scrollToRevenue}
                />

                <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
                            Vos espaces
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            {filteredWorkspaces.length}
                            {search.trim() ? ` sur ${workspaces.length}` : ""} espace
                            {filteredWorkspaces.length > 1 ? "s" : ""}
                        </p>
                    </div>
                </div>

                <div
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                    data-testid="workspaces-grid"
                >
                    {filteredWorkspaces.map((ws) => (
                        <WorkspaceCard
                            key={ws.id}
                            ws={ws}
                            isRecent={ws.id === recentId}
                            icon={state.sidebar?.items?.[navIdForWorkspace(ws.id)]?.icon}
                            notifCount={countUnreadWorkspaceNotifs(ws, seenMap)}
                            onOpen={() => dispatch({ type: "SELECT_WORKSPACE", id: ws.id })}
                            onOpenColumn={(colName) =>
                                openWorkspaceWithFilter(dispatch, ws.id, colName)
                            }
                            onOpenOverdue={() =>
                                openWorkspaceWithFilter(dispatch, ws.id, "en retard")
                            }
                            onDelete={() => setConfirmDel(ws)}
                        />
                    ))}

                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.03] transition-colors p-3.5 flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-primary min-h-[120px]"
                    >
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                            <Plus size={16} />
                        </div>
                        <span className="text-[12px] font-medium">Nouvel espace</span>
                    </button>
                </div>

                {search.trim() && filteredWorkspaces.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        Aucun espace ne correspond à « {search.trim()} ».
                    </p>
                )}

                <div id="calendar-section" className="mt-10 scroll-mt-20" data-testid="home-calendar-section">
                    <div className="mb-3">
                        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
                            Calendrier
                        </h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Cliquez un jour pour ouvrir l&apos;agenda
                        </p>
                    </div>
                    <CrmCalendar workspaces={workspaces} variant="page" />
                </div>

                <div id="stats-section" className="mt-16 scroll-mt-20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
                            Statistiques
                        </h2>
                    </div>
                    <Suspense
                        fallback={
                            <div className="rounded-xl border border-border/60 bg-card p-8 text-sm text-muted-foreground text-center">
                                Chargement des statistiques…
                            </div>
                        }
                    >
                        <StatsDashboard
                            alertRequest={alertRequest}
                            onAlertRequestHandled={clearAlertRequest}
                        />
                    </Suspense>
                </div>
            </div>

            <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />

            <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
                <AlertDialogContent data-testid="delete-workspace-dialog" className="rounded-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer « {confirmDel?.name} » ?</AlertDialogTitle>
                        <AlertDialogDescription>
                            L&apos;espace, ses colonnes et tous ses leads seront supprimés. Cette
                            action est irréversible.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid="confirm-delete-workspace-btn"
                            onClick={() => {
                                dispatch({ type: "DELETE_WORKSPACE", id: confirmDel.id });
                                setConfirmDel(null);
                            }}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            Supprimer définitivement
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// ── Onboarding ────────────────────────────────────────────────────────────────
const OnboardingHero = ({ onCreate }) => (
    <div className="max-w-2xl mx-auto px-4 py-20 sm:py-32 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
            <Target size={28} strokeWidth={1.5} />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Bienvenue dans Relia
        </h1>
        <p className="text-muted-foreground text-base mb-8 max-w-md">
            Créez votre premier espace pour organiser vos leads ou candidatures sur un tableau
            Kanban. Tout est sauvegardé localement sur votre Mac.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Button
                data-testid="create-first-workspace-btn"
                onClick={onCreate}
                className="h-11 rounded-xl px-6 text-[14px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
            >
                <Plus size={16} />
                Créer un espace
            </Button>
        </div>
        <div className="mt-8 flex items-center gap-6 text-[12px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
                <Users size={13} /> Suivi prospects
            </div>
            <div className="flex items-center gap-1.5">
                <Briefcase size={13} /> Offres d&apos;emploi
            </div>
            <div className="flex items-center gap-1.5">
                <Trophy size={13} /> Pipeline deals
            </div>
        </div>
    </div>
);
