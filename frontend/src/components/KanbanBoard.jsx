import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useCrm } from "@/context/CrmContext";
import { KanbanColumn } from "./KanbanColumn";
import { CallNoteModal } from "./CallNoteModal";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
    findBestNouveauColumnId,
    findBestContactedColumnId,
} from "@/constants/columnPatterns";
import { isManualRdv } from "@/lib/nextActionUtils";
import { filterLeads } from "@/lib/leadFilter";
import { setActiveLeadDrag, getActiveLeadDrag } from "@/lib/dndTransfer";

export const KanbanBoard = ({
    workspace,
    filter,
    activeFilters,
    onOpenLead,
    onCloseLead,
    openLeadId,
    onAddLead,
    quickMode: quickModeProp,
    onQuickModeChange,
    onAutoMoved,
}) => {
    const { dispatch, restoreEpoch } = useCrm();

    const [dragState, setDragState] = useState(null);
    const [draggingColumnId, setDraggingColumnId] = useState(null);
    const [addingColumn, setAddingColumn] = useState(false);
    const [newColName, setNewColName] = useState("");

    // --- Mode traitement rapide — état géré ici, exposé au parent ---
    const [quickMode, setQuickMode] = useState(false);
    const [quickIndex, setQuickIndex] = useState(0);
    // Stocker l'ID uniquement — le lead est relu depuis workspace.leads (évite objet stale)
    const [quickNoteLeadId, setQuickNoteLeadId] = useState(null);

    // Undo/redo : fermer la note sans la rouvrir (données non pertinentes après restore)
    useEffect(() => {
        setQuickNoteLeadId(null);
    }, [restoreEpoch]);

    // Sync avec prop parent (stop depuis TopBar / changement de vue)
    useEffect(() => {
        if (quickModeProp === false && quickMode) {
            setQuickMode(false);
            setQuickNoteLeadId(null);
        }
    }, [quickModeProp]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup : si le composant unmount pendant un drag (navigation rapide),
    // on force la suppression de tous les clones orphelins laissés dans le body.
    useEffect(() => {
        return () => {
            document.querySelectorAll("body > [style*='-9999px']").forEach((node) => {
                if (node._cleanup) node._cleanup();
                else if (node.parentNode) node.parentNode.removeChild(node);
            });
        };
    }, []);

    // --- Filtered leads (vigilance recalculée à la volée sur les données actuelles) ---
    const filtered = useMemo(
        () => filterLeads(Object.values(workspace.leads), { filter, activeFilters }, workspace),
        [workspace, filter, activeFilters]
    );

    // --- Leads ordered per column (respects leadOrder if present) ---
    const byColumn = useMemo(() => {
        const m = {};
        workspace.columnOrder.forEach((cid) => (m[cid] = []));
        // Group filtered leads by column
        const grouped = {};
        workspace.columnOrder.forEach((cid) => (grouped[cid] = []));
        filtered.forEach((l) => {
            if (grouped[l.columnId]) grouped[l.columnId].push(l);
        });

        const activityTs = (lead) => {
            const hist = lead.statusHistory;
            const lastStatus = hist?.length ? hist[hist.length - 1]?.at : null;
            return Math.max(
                Date.parse(lead.lastContact || 0) || 0,
                Date.parse(lead.contactedColumnEnteredAt || 0) || 0,
                Date.parse(lastStatus || 0) || 0,
                Date.parse(lead.updatedAt || 0) || 0,
                Date.parse(lead.createdAt || 0) || 0
            );
        };

        // Vrai RDV manuel (pas rappel auto / followup)
        const isPriorityRdv = (lead) => isManualRdv(lead.nextAction);
        const rdvDue = (lead) => {
            const t = new Date(lead.nextAction?.dueAt || lead.nextAction?.date || 0).getTime();
            return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
        };

        workspace.columnOrder.forEach((cid) => {
            const stored = workspace.leadOrder?.[cid];
            let list;
            if (stored && stored.length > 0) {
                const idToLead = {};
                grouped[cid].forEach((l) => (idToLead[l.id] = l));
                const ordered = [];
                stored.forEach((id) => {
                    if (idToLead[id]) ordered.push(idToLead[id]);
                });
                grouped[cid].forEach((l) => {
                    if (!stored.includes(l.id)) ordered.push(l);
                });
                list = ordered;
            } else {
                list = grouped[cid];
            }

            // 1) Plus récent → plus ancien
            // 2) Vrais RDV remontent en tête (échéance croissante)
            const rdv = list.filter(isPriorityRdv).sort((a, b) => {
                const byDue = rdvDue(a) - rdvDue(b);
                if (byDue !== 0) return byDue;
                return activityTs(b) - activityTs(a);
            });
            const rest = list
                .filter((l) => !isPriorityRdv(l))
                .sort((a, b) => activityTs(b) - activityTs(a));

            m[cid] = [...rdv, ...rest];
        });
        return m;
    }, [filtered, workspace.columnOrder, workspace.leadOrder, workspace.columns]);

    // --- Colonnes détectées pour le mode rapide (scoring, pas de fallback silencieux) ---
    const nouveauColId = useMemo(
        () => findBestNouveauColumnId(workspace.columnOrder, workspace.columns),
        [workspace.columnOrder, workspace.columns]
    );

    const contactedColId = useMemo(
        () => findBestContactedColumnId(workspace.columnOrder, workspace.columns, nouveauColId),
        [workspace.columnOrder, workspace.columns, nouveauColId]
    );

    // Lead frais depuis le state CRM (columnId à jour après MOVE)
    const quickNoteLead = quickNoteLeadId ? (workspace.leads[quickNoteLeadId] ?? null) : null;

    // Si le lead a disparu (suppression) pendant la note — nettoyer l'ID
    useEffect(() => {
        if (quickNoteLeadId && !workspace.leads[quickNoteLeadId]) {
            setQuickNoteLeadId(null);
        }
    }, [quickNoteLeadId, workspace.leads]);

    // Leads de la colonne "Nouveau" dans l'ordre affiché (tri local de KanbanColumn inclus)
    // Mis à jour exclusivement par handleNouveauSortedLeads depuis KanbanColumn.
    // On initialise avec byColumn pour avoir quelque chose dès le premier render.
    const [nouveauLeads, setNouveauLeads] = useState(() =>
        (nouveauColId && byColumn[nouveauColId]) || []
    );

    // Clamp quickIndex quand la liste change (évite la sélection "aléatoire")
    useEffect(() => {
        if (!quickMode) return;
        setQuickIndex((i) => Math.min(i, Math.max(0, nouveauLeads.length - 1)));
    }, [quickMode, nouveauLeads.length]);

    // Compteur = leads restants dans Nouveau (déjà à jour après un MOVE)
    useEffect(() => {
        if (!quickMode) return;
        // Pendant la note, ne pas couper le mode même si la file est vide (lead en cours de note)
        if (quickNoteLeadId) {
            onQuickModeChange?.(true, nouveauLeads.length);
            return;
        }
        if (nouveauLeads.length === 0) {
            setQuickMode(false);
            onCloseLead?.();
            onQuickModeChange?.(false, 0);
            return;
        }
        onQuickModeChange?.(true, nouveauLeads.length);
    }, [quickMode, nouveauLeads.length, quickNoteLeadId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Lead actuellement focusé en mode rapide
    const focusedLead = quickMode ? (nouveauLeads[quickIndex] ?? null) : null;

    // Refs pour accéder aux valeurs courantes dans le handler clavier (closure stable)
    const focusedLeadRef = useRef(null);
    const openLeadIdRef = useRef(null);
    const quickNoteLeadIdRef = useRef(null);
    useEffect(() => { focusedLeadRef.current = focusedLead; }, [focusedLead]);
    useEffect(() => { openLeadIdRef.current = openLeadId; }, [openLeadId]);
    useEffect(() => { quickNoteLeadIdRef.current = quickNoteLeadId; }, [quickNoteLeadId]);

    // Fermer le panel spacebar si le lead focusé change
    useEffect(() => {
        if (quickMode) onCloseLead?.();
    }, [quickIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // Démarrer le mode rapide
    const startQuickMode = useCallback(() => {
        if (!nouveauColId) {
            toast.error("Aucune colonne « Nouveau » trouvée", {
                description: "Renommez une colonne (Nouveau, Prospect, Candidature…).",
            });
            return;
        }
        if (!contactedColId) {
            toast.error("Aucune colonne « Contacté » trouvée", {
                description: "Le mode rapide a besoin d'une colonne Contacté / Contact pour y déplacer les leads.",
            });
            return;
        }
        setQuickIndex(0);
        setQuickMode(true);
        onQuickModeChange?.(true, nouveauLeads.length);
    }, [nouveauColId, contactedColId, nouveauLeads.length, onQuickModeChange]);

    const stopQuickMode = useCallback(() => {
        setQuickMode(false);
        setQuickNoteLeadId(null);
        onCloseLead?.();
        onQuickModeChange?.(false, 0);
    }, [onCloseLead, onQuickModeChange]);

    // Ouvrir la note sur le lead focusé SANS le déplacer.
    // Le move vers Contacté se fait à l'enregistrement (Cmd+Entrée / Enregistrer).
    // Échap / Passer laisse le lead dans Nouveau.
    const processCurrentLead = useCallback(() => {
        const lead = nouveauLeads[quickIndex];
        if (!lead) return;
        if (!contactedColId) {
            toast.error("Aucune colonne « Contacté » trouvée", {
                description: "Renommez une colonne pour inclure « Contacté » ou « Contact ».",
            });
            return;
        }
        setQuickNoteLeadId(lead.id);
    }, [nouveauLeads, quickIndex, contactedColId]);

    // Clavier global en mode rapide
    useEffect(() => {
        if (!quickMode) return;
        const handler = (e) => {
            // Ignorer si on tape dans un input/textarea
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

            // Modal note ouvert : bloquer nav / → ; laisser Esc au CallNoteModal
            if (quickNoteLeadIdRef.current) {
                if (e.key === "Escape") {
                    // Ne pas stopPropagation — CallNoteModal ferme uniquement le modal
                    return;
                }
                if (
                    e.key === "ArrowRight" || e.key === "ArrowDown" ||
                    e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === " "
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }

            if (
                e.key === "ArrowRight" || e.key === "ArrowDown" ||
                e.key === "ArrowUp"    || e.key === "ArrowLeft"
            ) {
                // Capturer en phase capture pour court-circuiter Radix DropdownMenu
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "ArrowRight") {
                    processCurrentLead();
                } else if (e.key === "ArrowDown") {
                    setQuickIndex((i) => Math.min(i + 1, Math.max(0, nouveauLeads.length - 1)));
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                    setQuickIndex((i) => Math.max(i - 1, 0));
                }
            } else if (e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                const focused = focusedLeadRef.current;
                const currentOpen = openLeadIdRef.current;
                if (focused && currentOpen === focused.id) {
                    onCloseLead?.();
                } else if (focused) {
                    onOpenLead?.(focused);
                }
            } else if (e.key === "Escape") {
                if (openLeadIdRef.current !== null) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCloseLead?.();
                } else {
                    stopQuickMode();
                }
            }
        };
        document.addEventListener("keydown", handler, true);
        return () => document.removeEventListener("keydown", handler, true);
    }, [quickMode, processCurrentLead, nouveauLeads.length, stopQuickMode, onCloseLead, onOpenLead]);

    // Scroll automatique vers la carte focusée
    useEffect(() => {
        if (!quickMode || !focusedLead || quickNoteLeadId) return;
        const el = document.querySelector(`[data-testid="lead-card-${focusedLead.id}"]`);
        if (el) {
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [quickMode, focusedLead?.id, quickNoteLeadId]);

    // Callback reçu depuis KanbanColumn quand la liste triée change
    const handleNouveauSortedLeads = useCallback((sorted) => {
        setNouveauLeads(sorted);
    }, []);

    // Fermeture du modal note — le lead est déjà hors de Nouveau ; length = restants réels
    const handleQuickNoteClose = useCallback(() => {
        setQuickNoteLeadId(null);
        if (nouveauLeads.length === 0) {
            stopQuickMode();
        } else {
            onQuickModeChange?.(true, nouveauLeads.length);
        }
    }, [nouveauLeads.length, stopQuickMode, onQuickModeChange]);

    // --- Lead drag handlers ---
    // Sous WKWebView (Tauri macOS), les types MIME custom (`application/x-lead-id`)
    // sont souvent absents de dataTransfer.types pendant dragover → drop bloqué.
    // Flag synchrone (dndTransfer) + text/plain + dragState React.
    const handleLeadDragStart = useCallback((e, lead) => {
        e.dataTransfer.setData("application/x-lead-id", lead.id);
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";

        // Synchrone : avant le 1er dragover (React n’a pas encore re-rendu)
        setActiveLeadDrag({ leadId: lead.id, fromColumnId: lead.columnId });

        const el = e.currentTarget;
        if (el) {
            const clone = el.cloneNode(true);
            clone.style.cssText = `
                position: fixed; top: -9999px; left: -9999px;
                width: ${el.offsetWidth}px;
                opacity: 0.85;
                transform: rotate(2deg) scale(1.03);
                pointer-events: none;
                border-radius: 12px;
                box-shadow: 0 16px 40px -8px rgba(0,0,0,0.25);
            `;
            document.body.appendChild(clone);
            e.dataTransfer.setDragImage(clone, el.offsetWidth / 2, 24);
            const removeClone = () => {
                if (clone.parentNode) clone.parentNode.removeChild(clone);
            };
            const timer = setTimeout(removeClone, 0);
            clone._cleanup = () => { clearTimeout(timer); removeClone(); };
        }

        // Pas de colonne pré-sélectionnée : les cibles s’allument au survol
        setDragState({
            leadId: lead.id,
            fromColumnId: lead.columnId,
            toColumnId: null,
            toIndex: null,
        });
    }, []);

    const handleLeadDragEnd = useCallback(() => {
        setActiveLeadDrag(null);
        setDragState(null);
    }, []);

    // Called by KanbanColumn when the drag hovers a column + index
    const handleDragHover = useCallback((columnId, index) => {
        setDragState((prev) =>
            prev ? { ...prev, toColumnId: columnId, toIndex: index } : prev,
        );
    }, []);

    const handleDropLead = useCallback(
        (columnId, index) => {
            const active = dragState?.leadId
                ? dragState
                : null;
            // Fallback synchrone si le state React n’est pas encore à jour
            const leadId = active?.leadId || getActiveLeadDrag()?.leadId;
            const fromColumnId = active?.fromColumnId || getActiveLeadDrag()?.fromColumnId;
            if (!leadId) return;

            if (fromColumnId === columnId) {
                // Same column → reorder
                const leads = byColumn[columnId];
                const fromIndex = leads.findIndex((l) => l.id === leadId);
                if (fromIndex === -1 || fromIndex === index) {
                    setActiveLeadDrag(null);
                    setDragState(null);
                    return;
                }
                // Adjust toIndex if moving down (splice removes element first)
                const toIndex = index != null ? index : leads.length - 1;
                dispatch({
                    type: "REORDER_LEADS",
                    workspaceId: workspace.id,
                    columnId,
                    fromIndex,
                    toIndex: fromIndex < toIndex ? toIndex - 1 : toIndex,
                });
            } else {
                // Cross-column move with position
                dispatch({
                    type: "MOVE_LEAD_ORDERED",
                    workspaceId: workspace.id,
                    leadId,
                    toColumnId: columnId,
                    toIndex: index,
                });
            }
            setActiveLeadDrag(null);
            setDragState(null);
        },
        [dragState, byColumn, dispatch, workspace.id],
    );

    // --- Column drag handlers ---
    const handleColumnDragStart = (e, colId) => {
        e.dataTransfer.setData("application/x-column-id", colId);
        e.dataTransfer.effectAllowed = "move";
        setDraggingColumnId(colId);
    };
    const handleColumnDragOver = (e) => {
        e.preventDefault();
    };
    const handleColumnDrop = (targetColId) => {
        if (!draggingColumnId || draggingColumnId === targetColId) {
            setDraggingColumnId(null);
            return;
        }
        const order = [...workspace.columnOrder];
        const from = order.indexOf(draggingColumnId);
        const to = order.indexOf(targetColId);
        if (from === -1 || to === -1) return;
        order.splice(from, 1);
        order.splice(to, 0, draggingColumnId);
        dispatch({
            type: "REORDER_COLUMNS",
            workspaceId: workspace.id,
            newOrder: order,
        });
        setDraggingColumnId(null);
    };

    // --- Add column ---
    const commitNewColumn = () => {
        if (newColName.trim()) {
            dispatch({
                type: "ADD_COLUMN",
                workspaceId: workspace.id,
                name: newColName.trim(),
            });
        }
        setNewColName("");
        setAddingColumn(false);
    };

    return (
        <div className="overflow-x-auto kanban-hscroll relative flex-1">
            <div
                className="flex gap-3 px-3 sm:px-4 pb-8 pt-3 min-w-min"
                data-testid="kanban-board"
            >
                {workspace.columnOrder.map((cid) => (
                    <KanbanColumn
                        key={cid}
                        column={workspace.columns[cid]}
                        leads={byColumn[cid] || []}
                        workspace={workspace}
                        dragState={dragState}
                        onOpenLead={onOpenLead}
                        onAddLead={() => onAddLead(cid)}
                        quickMode={quickMode && cid === nouveauColId}
                        quickFocusedLeadId={focusedLead?.id}
                        onStartQuickMode={nouveauColId && cid === nouveauColId ? startQuickMode : undefined}
                        onSortedLeadsChange={nouveauColId && cid === nouveauColId ? handleNouveauSortedLeads : undefined}
                        onRename={(newName) =>
                            dispatch({
                                type: "RENAME_COLUMN",
                                workspaceId: workspace.id,
                                columnId: cid,
                                name: newName,
                            })
                        }
                        onDelete={() =>
                            dispatch({
                                type: "DELETE_COLUMN",
                                workspaceId: workspace.id,
                                columnId: cid,
                            })
                        }
                        onSetColor={(color) =>
                            dispatch({
                                type: "SET_COLUMN_COLOR",
                                workspaceId: workspace.id,
                                columnId: cid,
                                color,
                            })
                        }
                        onToggleAutoFollowup={(enabled) =>
                            dispatch({
                                type: "SET_COLUMN_AUTO_FOLLOWUP",
                                workspaceId: workspace.id,
                                columnId: cid,
                                enabled,
                            })
                        }
                        onTogglePromptNote={(enabled) =>
                            dispatch({
                                type: "SET_COLUMN_PROMPT_NOTE",
                                workspaceId: workspace.id,
                                columnId: cid,
                                enabled,
                            })
                        }
                        onDragStartLead={handleLeadDragStart}
                        onDragEndLead={handleLeadDragEnd}
                        onDragHover={handleDragHover}
                        onDropLead={handleDropLead}
                        onColumnDragStart={handleColumnDragStart}
                        onColumnDragOver={handleColumnDragOver}
                        onColumnDrop={handleColumnDrop}
                    />
                ))}

                {/* Add column */}
                <div className="shrink-0 w-[240px] pt-1 pl-2">
                    {addingColumn ? (
                        <div className="rounded-[10px] bg-surface-2 border border-border/60 p-2.5">
                            <input
                                autoFocus
                                data-testid="new-column-input"
                                value={newColName}
                                onChange={(e) => setNewColName(e.target.value)}
                                onBlur={commitNewColumn}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") commitNewColumn();
                                    if (e.key === "Escape") {
                                        setNewColName("");
                                        setAddingColumn(false);
                                    }
                                }}
                                placeholder="Nom de la colonne"
                                className="w-full bg-background border border-border rounded-lg h-9 px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    ) : (
                        <button
                            data-testid="add-column-btn"
                            onClick={() => setAddingColumn(true)}
                            className="flex items-center justify-center gap-2 w-full h-10 px-3 text-[13px] text-muted-foreground hover:text-foreground transition-colors rounded-[10px] border border-dashed border-border hover:bg-muted/40 font-medium"
                        >
                            <Plus size={14} strokeWidth={2} />
                            Ajouter une colonne
                        </button>
                    )}
                </div>
            </div>

            {/* Modal note d'appel rapide — move vers Contacté uniquement à l'enregistrement */}
            <CallNoteModal
                open={!!quickNoteLead}
                lead={quickNoteLead}
                workspace={workspace}
                pendingMoveToColumnId={contactedColId}
                onAutoMoved={onAutoMoved}
                onClose={handleQuickNoteClose}
            />
        </div>
    );
};
