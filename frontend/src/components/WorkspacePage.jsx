import React, { useEffect, useRef, useState } from "react";
import { useCrm } from "@/context/CrmContext";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import { PipelineView } from "./PipelineView";
import { LeadDetailPanel } from "./LeadDetailPanel";
import { CsvImportModal } from "./CsvImportModal";
import { CallNoteModal } from "./CallNoteModal";
import { WonDealModal } from "./WonDealModal";
import { LostDealModal } from "./LostDealModal";
import { MeetingModal } from "./MeetingModal";
import { StorageErrorBanner } from "./StorageErrorBanner";
import { Users, Upload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    isWonCol as isWonColumn,
    isNouveauCol as isNouveauColumn,
    isContactedCol as isContactedColumn,
    isMeetingCol as isMeetingColumn,
    isLostCol as isLostColumn,
} from "@/constants/columnPatterns";
import { resolvePipelineColumnId } from "@/lib/pipelineRoles";
import { isManualRdv } from "@/lib/nextActionUtils";
import { PENDING_LEAD_EVENT } from "@/lib/calendarEvents";
import { trackViewChange, trackLeadOpen } from "@/lib/usageMemory";
import {
    RELIA_EVENTS,
    dispatchRelia,
    requestQuickModeToggle,
    isTypingTarget,
    isWorkspaceSearchInput,
    matchesLetterKey,
    isAltOnly,
    isCtrlAltOnly,
    isModOnly,
    isModShiftOnly,
    isSpaceKey,
} from "@/lib/reliaShortcuts";
import { toast } from "sonner";

export const WorkspacePage = () => {
    const { state, dispatch, restoreEpoch } = useCrm();
    const workspace = state.workspaces[state.currentId];
    const [filter, setFilter] = useState("");
    const [activeFilters, setActiveFilters] = useState([]);
    const [openLeadId, setOpenLeadId] = useState(null);
    const [boardFocusedLeadId, setBoardFocusedLeadId] = useState(null);
    const openLeadById = (leadId) => {
        setOpenLeadId(leadId);
        if (leadId) setBoardFocusedLeadId(leadId);
        if (leadId && workspace?.id) {
            trackLeadOpen(workspace.id, leadId, workspace.name);
        }
    };
    const [importOpen, setImportOpen] = useState(false);
    // Vue active — persistée en localStorage
    const [view, setView] = useState(() => {
        try { return localStorage.getItem("crm_view") || "kanban"; } catch { return "kanban"; }
    });
    const handleViewChange = (v) => {
        setView(v);
        try { localStorage.setItem("crm_view", v); } catch {}
        trackViewChange(v, workspace?.id);
        // Mode rapide = Kanban uniquement — éviter un badge fantôme hors vue kanban
        if (v !== "kanban") {
            setQuickMode(false);
            setQuickCount(0);
        }
    };
    // Sidebar permanente (desktop) — ouverte par défaut, préférence persistée
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        try {
            const saved = localStorage.getItem("sidebar_open");
            if (saved !== null) return saved === "true";
            const legacy = localStorage.getItem("sidebar_collapsed");
            if (legacy !== null) return legacy !== "true";
            return true; // Relia desktop : ouverte par défaut
        } catch {
            return true;
        }
    });
    const persistSidebarOpen = (next) => {
        setSidebarOpen(next);
        try {
            localStorage.setItem("sidebar_open", String(next));
            localStorage.setItem("sidebar_collapsed", String(!next));
        } catch { /* ignore */ }
    };
    const toggleSidebar = () => persistSidebarOpen(!sidebarOpen);
    const closeSidebar = () => persistSidebarOpen(false);

    // Densité Kanban — compact | comfort
    const [density, setDensity] = useState(() => {
        try { return localStorage.getItem("crm_density") || "compact"; } catch { return "compact"; }
    });
    const handleDensityChange = (d) => {
        setDensity(d);
        try { localStorage.setItem("crm_density", d); } catch {}
    };
    const [callNoteLeadId, setCallNoteLeadId] = useState(null);
    const [wonLeadId, setWonLeadId] = useState(null);
    const [lostLeadId, setLostLeadId] = useState(null);
    const [meetingLeadId, setMeetingLeadId] = useState(null);
    const [quickMode, setQuickMode] = useState(false);
    const [quickCount, setQuickCount] = useState(0);
    const prevColumnsRef = useRef({});
    const prevRestoreEpochRef = useRef(restoreEpoch);
    const [pendingOpenColumnId, setPendingOpenColumnId] = useState(null);
    const prevLeadIdsRef = useRef(null);
    // Leads déplacés automatiquement depuis CallNoteModal (avec RDV déjà défini)
    // → on supprime l'ouverture de MeetingModal et d'un 2e CallNoteModal pour ces leads
    const suppressModalForLeadRef = useRef(new Set());

    const onNewLead = (columnId) => {
        if (!workspace) return;
        const col = columnId || workspace.columnOrder[0];
        prevLeadIdsRef.current = new Set(Object.keys(workspace.leads));
        setPendingOpenColumnId(col);
        dispatch({
            type: "ADD_LEAD",
            workspaceId: workspace.id,
            columnId: col,
            lead: { company: "Nouveau lead" },
        });
    };

    useEffect(() => {
        prevColumnsRef.current = {};
        setQuickMode(false);
        setQuickCount(0);
        setBoardFocusedLeadId(null);
    }, [state.currentId]);

    // Hub raccourcis clavier (phase capture — avant inputs / OS webview)
    useEffect(() => {
        const onKey = (e) => {
            if (e.repeat) return;

            // ── Toujours actifs (même dans un champ, sauf exceptions) ─────────

            // ⌘F / ⌘K — ouvrir OU fermer la recherche
            if (isModOnly(e) && (matchesLetterKey(e, "f") || matchesLetterKey(e, "k"))) {
                e.preventDefault();
                e.stopPropagation();
                dispatchRelia(RELIA_EVENTS.TOGGLE_SEARCH);
                return;
            }

            // ⌘: — afficher / masquer la barre latérale
            // (: = Shift+; QWERTY · Shift+. AZERTY — e.key === ':' couvre les deux)
            if (
                (e.metaKey || e.ctrlKey)
                && !e.altKey
                && (
                    e.key === ":"
                    || (e.shiftKey && (e.code === "Semicolon" || e.code === "Period"))
                )
            ) {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar();
                return;
            }

            // ⌥H — retour à l’accueil (tous les espaces) — pas ⌘H (masque l’app macOS)
            if (isAltOnly(e) && matchesLetterKey(e, "h")) {
                if (isTypingTarget() && !isWorkspaceSearchInput()) return;
                e.preventDefault();
                e.stopPropagation();
                dispatch({ type: "SELECT_WORKSPACE", id: null });
                return;
            }

            // Mode rapide : ⌃⌥Espace (souvent volé par macOS) + secours ⌘⇧E
            const quickChord =
                (isCtrlAltOnly(e) && isSpaceKey(e))
                || (isModShiftOnly(e) && matchesLetterKey(e, "e"));
            if (quickChord) {
                if (isTypingTarget() && !isWorkspaceSearchInput()) return;
                e.preventDefault();
                e.stopPropagation();
                if (view !== "kanban") {
                    handleViewChange("kanban");
                    toast.message("Mode rapide", {
                        description: "Vue Kanban activée.",
                        duration: 1800,
                    });
                }
                // Flag + event : si le board n’est pas encore monté, il consommera au mount
                requestQuickModeToggle();
                return;
            }

            // Appel libre : ⌥A + secours ⌘⇧A (⌥A parfois mangé / AZERTY)
            const freeCallChord =
                (isAltOnly(e) && matchesLetterKey(e, "a"))
                || (isModShiftOnly(e) && matchesLetterKey(e, "a"));
            if (freeCallChord) {
                if (isTypingTarget()) return;
                e.preventDefault();
                e.stopPropagation();
                dispatchRelia(RELIA_EVENTS.TOGGLE_FREE_CALL);
                return;
            }

            // Esc / ⌘. — fermer fiche
            if (
                e.key === "Escape"
                || (isModOnly(e) && (e.key === "." || e.code === "Period"))
            ) {
                if ((e.key === "." || e.code === "Period") && isTypingTarget()) return;
                if (document.body.getAttribute("data-voice-dock") === "ready") return;
                if (document.querySelector('[data-testid="attach-call-lead-dialog"]')) return;
                if (document.querySelector('[data-testid="call-note-modal"]')) return;
                if (openLeadId) {
                    e.preventDefault();
                    setOpenLeadId(null);
                }
                return;
            }

            if (isTypingTarget()) return;

            // ⌘N — nouveau prospect
            if (isModOnly(e) && matchesLetterKey(e, "n")) {
                e.preventDefault();
                onNewLead();
                return;
            }

            // ⌘⇧N — focus nouvelle note
            if (isModShiftOnly(e) && matchesLetterKey(e, "n")) {
                e.preventDefault();
                if (openLeadId) dispatchRelia(RELIA_EVENTS.FOCUS_NEW_NOTE);
                return;
            }

            // ⌘1…6 — colonne N
            if (isModOnly(e) && /^Digit[1-6]$/.test(e.code)) {
                e.preventDefault();
                const idx = Number(e.code.slice(5)) - 1;
                const colId = workspace?.columnOrder?.[idx];
                if (!colId) return;
                const el = document.querySelector(`[data-testid="kanban-column-${colId}"]`);
                el?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
                el?.classList?.add("ring-2", "ring-primary/40");
                window.setTimeout(() => el?.classList?.remove("ring-2", "ring-primary/40"), 900);
                return;
            }

            // ⌃⌥C — calendrier (+ secours ⌘⇧C)
            if (
                (isCtrlAltOnly(e) && matchesLetterKey(e, "c"))
                || (isModShiftOnly(e) && matchesLetterKey(e, "c"))
            ) {
                e.preventDefault();
                dispatchRelia(RELIA_EVENTS.OPEN_CALENDAR);
                return;
            }

            // ⌥R — relance sur fiche ouverte
            if (isAltOnly(e) && matchesLetterKey(e, "r")) {
                e.preventDefault();
                if (openLeadId) dispatchRelia(RELIA_EVENTS.OPEN_RELANCE);
                return;
            }

            // Espace — ouvrir/fermer lead focusé (hors mode rapide)
            if (isSpaceKey(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (quickMode) return;
                if (!boardFocusedLeadId) return;
                e.preventDefault();
                if (openLeadId === boardFocusedLeadId) setOpenLeadId(null);
                else openLeadById(boardFocusedLeadId);
            }
        };

        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openLeadId, boardFocusedLeadId, quickMode, workspace?.columnOrder, workspace?.id, view, sidebarOpen]);

    // Appliquer la densité sur le document (CSS)
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("density-compact", density === "compact");
        root.classList.toggle("density-comfort", density === "comfort");
        return () => {
            root.classList.remove("density-compact", "density-comfort");
        };
    }, [density]);

    useEffect(() => {
        if (!workspace) return;

        // Undo/redo (ou restore backup) : resynchroniser le suivi des colonnes
        // SANS rouvrir de modal — une note rouverte écraserait des données non pertinentes.
        const isRestore = restoreEpoch !== prevRestoreEpochRef.current;
        prevRestoreEpochRef.current = restoreEpoch;
        if (isRestore) {
            const next = {};
            for (const l of Object.values(workspace.leads)) {
                next[l.id] = l.columnId;
            }
            prevColumnsRef.current = next;
            setCallNoteLeadId(null);
            setWonLeadId(null);
            setLostLeadId(null);
            setMeetingLeadId(null);
            return;
        }

        const prev = prevColumnsRef.current;
        const next = {};
        const wonColId = resolvePipelineColumnId(workspace, "won");
        const lostColId = resolvePipelineColumnId(workspace, "lost");
        const rdvColId = resolvePipelineColumnId(workspace, "rdv");

        for (const l of Object.values(workspace.leads)) {
            next[l.id] = l.columnId;
            const wasIn = prev[l.id];
            if (wasIn && wasIn !== l.columnId) {
                const fromCol  = workspace.columns[wasIn];
                const targetCol = workspace.columns[l.columnId];

                // Si ce lead a été déplacé automatiquement par CallNoteModal
                // (RDV déjà enregistré dans la note), on ne rouvre pas de modal pour lui.
                if (suppressModalForLeadRef.current.has(l.id)) {
                    suppressModalForLeadRef.current.delete(l.id);
                    continue;
                }

                // Ouvrir le modal de note d'appel si :
                //   1. La colonne cible a promptNoteOnEnter activé manuellement, OU
                //   2. Le lead vient d'une colonne "Nouveau" et arrive dans une colonne "Contacté"
                const isNouveauToContacted =
                    isNouveauColumn(fromCol) && isContactedColumn(targetCol);

                if (targetCol?.promptNoteOnEnter || isNouveauToContacted) {
                    setCallNoteLeadId(l.id);
                }

                // Prompt deal value on entering "Gagné" / closé
                if (l.columnId === wonColId || isWonColumn(targetCol)) {
                    setWonLeadId(l.id);
                }
                // Motif rapide on entering "Perdu"
                if (l.columnId === lostColId || isLostColumn(targetCol)) {
                    setLostLeadId(l.id);
                }
                // Prompt meeting date on entering "Rendez-vous"
                // — sauf si le lead a déjà un RDV enregistré
                const hasExistingRdv = isManualRdv(l.nextAction);
                if ((l.columnId === rdvColId || isMeetingColumn(targetCol)) && !hasExistingRdv) {
                    setMeetingLeadId(l.id);
                }
            }
        }
        // Remplacer entièrement la ref — élimine les entrées des leads supprimés
        prevColumnsRef.current = next;
    }, [workspace?.leads, workspace?.columns, restoreEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Ouvrir automatiquement le panel sur le lead nouvellement créé
    useEffect(() => {
        if (pendingOpenColumnId === null || !prevLeadIdsRef.current || !workspace) return;
        const newLead = Object.values(workspace.leads).find(
            (l) => !prevLeadIdsRef.current.has(l.id) && l.columnId === pendingOpenColumnId
        );
        if (newLead) {
            setOpenLeadId(newLead.id);
            trackLeadOpen(workspace.id, newLead.id, workspace.name);
            setPendingOpenColumnId(null);
            prevLeadIdsRef.current = null;
        }
    }, [workspace?.leads, pendingOpenColumnId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Ouvrir un lead depuis le dashboard / calendrier (alertes stats)
    useEffect(() => {
        if (!workspace) return;

        const tryOpenPending = () => {
            try {
                const raw = sessionStorage.getItem("crm_pending_lead");
                if (!raw) return;
                const { workspaceId, leadId } = JSON.parse(raw);
                if (workspaceId !== workspace.id) return;
                if (!workspace.leads[leadId]) {
                    sessionStorage.removeItem("crm_pending_lead");
                    return;
                }
                setOpenLeadId(leadId);
                trackLeadOpen(workspace.id, leadId, workspace.name);
                sessionStorage.removeItem("crm_pending_lead");
            } catch {
                try { sessionStorage.removeItem("crm_pending_lead"); } catch { /* ignore */ }
            }
        };

        tryOpenPending();
        window.addEventListener(PENDING_LEAD_EVENT, tryOpenPending);
        return () => window.removeEventListener(PENDING_LEAD_EVENT, tryOpenPending);
    }, [workspace?.id, workspace?.leads]); // eslint-disable-line react-hooks/exhaustive-deps

    // Appliquer un filtre prérempli depuis la page d'accueil (badge colonne / en retard)
    useEffect(() => {
        if (!workspace) return;
        try {
            const raw = sessionStorage.getItem("crm_pending_filter");
            if (!raw) return;
            const { workspaceId, filter: pendingFilter } = JSON.parse(raw);
            if (workspaceId !== workspace.id) return;
            sessionStorage.removeItem("crm_pending_filter");
            const tag = String(pendingFilter || "").trim();
            if (!tag) return;
            setActiveFilters((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
        } catch {
            try { sessionStorage.removeItem("crm_pending_filter"); } catch { /* ignore */ }
        }
    }, [workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!workspace) return null;

    const openLead =
        state.workspaces[state.currentId]?.leads[openLeadId] || null;
    const callNoteLead =
        state.workspaces[state.currentId]?.leads[callNoteLeadId] || null;
    const wonLead =
        state.workspaces[state.currentId]?.leads[wonLeadId] || null;
    const lostLead =
        state.workspaces[state.currentId]?.leads[lostLeadId] || null;
    const meetingLead =
        state.workspaces[state.currentId]?.leads[meetingLeadId] || null;

    const leadCount = Object.keys(workspace.leads).length;

    return (
        <div className="min-h-screen bg-background flex" data-density={density}>
            <Sidebar
                open={sidebarOpen}
                onClose={closeSidebar}
                onToggle={toggleSidebar}
            />
            <main className="flex flex-col min-w-0 flex-1 min-h-screen overflow-x-hidden">
                {/* Alerte persistante si le quota localStorage est dépassé */}
                <StorageErrorBanner />
                <TopBar
                    workspace={workspace}
                    filter={filter}
                    setFilter={setFilter}
                    activeFilters={activeFilters}
                    setActiveFilters={setActiveFilters}
                    onImport={() => setImportOpen(true)}
                    onNewLead={onNewLead}
                    onOpenLead={(l) => openLeadById(l.id)}
                    sidebarOpen={sidebarOpen}
                    onToggleSidebar={toggleSidebar}
                    view={view}
                    onViewChange={handleViewChange}
                    density={density}
                    onDensityChange={handleDensityChange}
                    quickMode={quickMode}
                    quickCount={quickCount}
                    onStopQuickMode={() => {
                        setQuickMode(false);
                        setQuickCount(0);
                    }}
                />

                {leadCount === 0 && (
                    <div className="px-6 pt-6 pb-2" data-testid="workspace-empty-banner">
                        <div className="rounded-2xl border border-dashed border-border p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                <Users size={18} strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-base font-semibold tracking-tight">Votre pipeline est prêt</h3>
                                <p className="text-sm text-muted-foreground">
                                    Importez un CSV existant ou créez votre premier lead pour lancer le suivi.
                                </p>
                            </div>
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Button
                                    onClick={() => setImportOpen(true)}
                                    variant="secondary"
                                    className="flex-1 sm:flex-none h-10 rounded-full px-4"
                                    data-testid="empty-import-btn"
                                >
                                    <Upload size={14} className="mr-1.5" />
                                    Importer un CSV
                                </Button>
                                <Button
                                    onClick={() => onNewLead()}
                                    className="flex-1 sm:flex-none h-10 rounded-full px-4 bg-primary hover:bg-primary/90 text-primary-foreground"
                                    data-testid="empty-new-lead-btn"
                                >
                                    <Plus size={14} className="mr-1.5" />
                                    Créer un lead
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {view === "kanban" && (
                    <KanbanBoard
                        workspace={workspace}
                        filter={filter}
                        activeFilters={activeFilters}
                        onOpenLead={(l) => openLeadById(l.id)}
                        onCloseLead={() => setOpenLeadId(null)}
                        openLeadId={openLeadId}
                        onAddLead={(colId) => onNewLead(colId)}
                        quickMode={quickMode}
                        onQuickModeChange={(active, count) => {
                            setQuickMode(active);
                            setQuickCount(count);
                        }}
                        onAutoMoved={(leadId) => suppressModalForLeadRef.current.add(leadId)}
                    />
                )}
                {view === "list" && (
                    <ListView
                        workspace={workspace}
                        filter={filter}
                        activeFilters={activeFilters}
                        onOpenLead={(l) => openLeadById(l.id)}
                    />
                )}
                {view === "table" && (
                    <TableView
                        workspace={workspace}
                        filter={filter}
                        activeFilters={activeFilters}
                        onOpenLead={(l) => openLeadById(l.id)}
                    />
                )}
                {view === "pipeline" && (
                    <PipelineView
                        workspace={workspace}
                        filter={filter}
                        activeFilters={activeFilters}
                        onOpenLead={(l) => openLeadById(l.id)}
                    />
                )}
            </main>

            <LeadDetailPanel
                open={!!openLead}
                lead={openLead}
                workspace={workspace}
                onClose={() => setOpenLeadId(null)}
            />

            <CsvImportModal
                open={importOpen}
                onOpenChange={setImportOpen}
                workspaceId={workspace.id}
            />

            <CallNoteModal
                open={!!callNoteLead}
                lead={callNoteLead}
                workspace={workspace}
                onAutoMoved={(leadId) => suppressModalForLeadRef.current.add(leadId)}
                onClose={() => setCallNoteLeadId(null)}
            />

            <WonDealModal
                open={!!wonLead}
                lead={wonLead}
                workspace={workspace}
                onClose={() => setWonLeadId(null)}
            />

            <LostDealModal
                open={!!lostLead}
                lead={lostLead}
                workspace={workspace}
                onClose={() => setLostLeadId(null)}
            />

            <MeetingModal
                open={!!meetingLead}
                lead={meetingLead}
                workspace={workspace}
                onClose={() => setMeetingLeadId(null)}
            />
        </div>
    );
};
