import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { LeadCard } from "./LeadCard";
import {
    Plus,
    MoreHorizontal,
    Trash2,
    GripVertical,
    Palette,
    BellRing,
    Check,
    MessageSquarePlus,
    Eraser,
    Zap,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    X as XIcon,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ColorPickerRow } from "./ColorPickerRow";
import { getColumnColor } from "@/lib/columnColors";
import { useCrm } from "@/context/CrmContext";
import { isNouveauColumn, isWonColumn } from "@/constants/columnPatterns";
import { isManualRdv } from "@/lib/nextActionUtils";
import { getLeadVigilance } from "@/lib/inconsistencyRules";

// Wrapper qui applique un scale CSS sur la card sans changer le flow du document.
// Un margin-bottom négatif compense la hauteur "fantôme" réservée par le navigateur.
const CardScaleWrapper = ({ scale = 1, children }) => {
    const ref = React.useRef(null);
    const [negMargin, setNegMargin] = React.useState(0);

    React.useEffect(() => {
        const el = ref.current;
        if (!el || scale >= 1) return;
        const update = () => {
            const h = el.scrollHeight;
            setNegMargin(Math.round(h * (1 - scale)));
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [scale]);

    if (scale >= 1) return children;

    return (
        <div
            ref={ref}
            style={{
                transform: `scale(${scale})`,
                transformOrigin: "top center",
                marginBottom: `-${negMargin}px`,
                willChange: "transform",
            }}
        >
            {children}
        </div>
    );
};

// DropZone between cards — shows an animated insertion line
const InsertionPlaceholder = () => (
    <div
        aria-hidden
        className="kanban-insert-placeholder mx-1 rounded-lg"
        style={{
            height: "4px",
            margin: "2px 4px",
            background: "hsl(var(--primary) / 0.5)",
            borderRadius: "4px",
            animation: "placeholderPulse 900ms ease-in-out infinite",
        }}
    />
);

// Zone d’insertion entre cartes (drag pointeur)
const CardDropSlot = ({ index, isActive, children }) => (
    <div className="kanban-drop-slot" data-drop-index={index}>
        {isActive && <InsertionPlaceholder />}
        {children}
    </div>
);

export const KanbanColumn = ({
    column,
    leads,
    workspace,
    onOpenLead,
    onAddLead,
    onRename,
    onDelete,
    onSetColor,
    onToggleAutoFollowup,
    onTogglePromptNote,
    onLeadPointerDown,
    onColumnDragStart,
    onColumnDragOver,
    onColumnDrop,
    dragState,
    quickMode,
    quickFocusedLeadId,
    onStartQuickMode,
    onSortedLeadsChange,
}) => {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(column.name);
    const [confirmDel, setConfirmDel] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const inputRef = useRef(null);
    const contentRef = useRef(null);
    const [bgHeight, setBgHeight] = useState(160);
    const color = getColumnColor(column);
    const { dispatch } = useCrm();

    const isWonColumnView = isWonColumn(column.name)
        || workspace?.pipelineRoles?.won === column.id;

    const wonTotal = useMemo(() => {
        if (!isWonColumnView) return 0;
        return leads.reduce((sum, l) => {
            const v = Number(l.dealValue);
            return sum + (Number.isFinite(v) ? v : 0);
        }, 0);
    }, [leads, isWonColumnView]);

    const wonTotalLabel = useMemo(() => {
        if (!isWonColumnView) return null;
        return new Intl.NumberFormat("fr-FR", {
            style: "currency",
            currency: "EUR",
            maximumFractionDigits: 0,
        }).format(wonTotal);
    }, [isWonColumnView, wonTotal]);

    // ── Tri local — persisté par colonne ──────────────────────────────────────
    const SORT_KEY = `crm_sort_${column.id}`;
    // Défaut toutes colonnes : plus récent → plus ancien (activité / contact / création)
    const DEFAULT_SORT = { key: "lastContact", dir: "desc", label: "Plus récent" };

    const [sort, setSort] = useState(() => {
        try {
            const s = localStorage.getItem(SORT_KEY);
            if (s !== null) {
                const parsed = JSON.parse(s);
                if (parsed) return parsed;
            }
        } catch {}
        return DEFAULT_SORT;
    }); // null = ordre manuel | { key, dir, label }

    // Toujours un tri date par défaut (pas d’ordre manuel désordonné)
    const effectiveSort = sort || DEFAULT_SORT;

    const applySort = (key, label, { preferDesc = false } = {}) => {
        setSort((prev) => {
            const current = prev || DEFAULT_SORT;
            let next;
            if (current?.key === key) {
                if (preferDesc) {
                    if (current.dir === "desc") next = { key, dir: "asc", label };
                    else next = DEFAULT_SORT;
                } else {
                    if (current.dir === "asc") next = { key, dir: "desc", label };
                    else next = DEFAULT_SORT;
                }
            } else {
                next = { key, dir: preferDesc ? "desc" : "asc", label };
            }
            try { localStorage.setItem(SORT_KEY, JSON.stringify(next)); } catch {}
            return next;
        });
    };

    const clearSort = () => {
        setSort(DEFAULT_SORT);
        try { localStorage.setItem(SORT_KEY, JSON.stringify(DEFAULT_SORT)); } catch {}
    };

    // Champs extra disponibles dans cette colonne
    const extraKeys = useMemo(() => {
        const keys = new Set();
        leads.forEach((l) => Object.keys(l.extra || {}).forEach((k) => keys.add(k)));
        return [...keys].sort();
    }, [leads]);

    // Leads triés : RDV manuels d’abord, puis plus récent → plus ancien
    const sortedLeads = useMemo(() => {
        const { key, dir } = effectiveSort;
        const mul = dir === "asc" ? 1 : -1;

        const activityTs = (lead) => {
            const hist = lead.statusHistory;
            const lastStatus = hist?.length ? hist[hist.length - 1]?.at : null;
            const t = Math.max(
                Date.parse(lead.lastContact || 0) || 0,
                Date.parse(lead.contactedColumnEnteredAt || 0) || 0,
                Date.parse(lastStatus || 0) || 0,
                Date.parse(lead.updatedAt || 0) || 0,
                Date.parse(lead.createdAt || 0) || 0
            );
            return t;
        };

        const getValue = (lead) => {
            if (key === "company")     return (lead.company || "").toLowerCase();
            if (key === "createdAt")   return lead.createdAt || "";
            if (key === "lastContact") return activityTs(lead);
            if (key === "phone")       return (lead.phone || "").replace(/\D/g, "");
            if (key === "email")       return (lead.email || "").toLowerCase();
            if (key === "dealValue")   return lead.dealValue ?? -Infinity;
            if (key === "contact")     return (lead.contact || "").toLowerCase();
            if (key === "vigilance") {
                return getLeadVigilance(lead, workspace.columns, workspace.inconsistencyConfig).score;
            }
            if (key.startsWith("extra:")) {
                const ek = key.slice(6);
                return (lead.extra?.[ek] || "").toString().toLowerCase();
            }
            return "";
        };

        const sortByActive = (a, b) => {
            const va = getValue(a), vb = getValue(b);
            if (va === vb) return 0;
            if (key === "vigilance") {
                if (va === 0 && vb === 0) return 0;
                return va < vb ? -mul : mul;
            }
            if (va === "" || va === -Infinity) return 1;
            if (vb === "" || vb === -Infinity) return -1;
            return va < vb ? -mul : mul;
        };

        // Vrais RDV (pas rappel auto / followup) → toujours en tête, bientôt d’abord
        const isPriorityRdv = (lead) => isManualRdv(lead.nextAction);
        const rdvDue = (lead) => {
            const t = new Date(lead.nextAction?.dueAt || lead.nextAction?.date || 0).getTime();
            return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
        };

        const rdvFirst = [...leads.filter(isPriorityRdv)].sort((a, b) => {
            const byDue = rdvDue(a) - rdvDue(b);
            if (byDue !== 0) return byDue;
            return sortByActive(a, b);
        });
        const rest = [...leads.filter((l) => !isPriorityRdv(l))].sort(sortByActive);

        return [...rdvFirst, ...rest];
    }, [leads, effectiveSort, workspace.columns, workspace.inconsistencyConfig]);

    useEffect(() => {
        if (editing) inputRef.current?.select();
    }, [editing]);
    useEffect(() => setName(column.name), [column.name]);

    // Notifie le parent (KanbanBoard) de l'ordre trié réel — utilisé par le mode rapide.
    // On compare les IDs pour éviter des notifications parasites dues aux re-renders
    // provoqués par CardScaleWrapper (ResizeObserver → setState → re-render).
    const sortedIdsRef = useRef(null);
    useEffect(() => {
        const ids = sortedLeads.map((l) => l.id).join(",");
        if (ids === sortedIdsRef.current) return; // même ordre, pas la peine
        sortedIdsRef.current = ids;
        onSortedLeadsChange?.(sortedLeads);
    }, [sortedLeads, onSortedLeadsChange]);

    // Mesure la hauteur réelle du contenu pour animer le fond
    useEffect(() => {
        if (!contentRef.current) return;
        const el = contentRef.current;
        const measure = () => {
            const h = el.scrollHeight;
            setBgHeight(Math.max(120, h));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [leads.length]);

    const commit = () => {
        const clean = name.trim();
        setEditing(false);
        if (clean && clean !== column.name) onRename(clean);
        else setName(column.name);
    };

    // Un lead est en train d’être déplacé
    const leadDragging = !!dragState?.leadId;
    const isDragTarget = leadDragging && dragState?.toColumnId === column.id;
    const insertIndex = isDragTarget ? dragState.toIndex : null;

    return (
        <div
            data-testid={`kanban-column-${column.id}`}
            data-kanban-column-id={column.id}
            className={`kanban-col relative shrink-0 flex flex-col transition-colors duration-150 ${
                isDragTarget
                    ? "column-drop-active"
                    : leadDragging
                      ? "column-drop-ready"
                      : ""
            } ${leadDragging ? "is-lead-dragging" : ""}`}
            style={{
                width: `${workspace.columnWidth ?? 340}px`,
            }}
            onDragOver={(e) => {
                // Reorder de colonnes (HTML5) uniquement
                if (Array.from(e.dataTransfer?.types || []).includes("application/x-column-id")) {
                    onColumnDragOver(e, column.id);
                }
            }}
            onDrop={(e) => {
                if (Array.from(e.dataTransfer?.types || []).includes("application/x-column-id")) {
                    onColumnDrop(column.id);
                }
            }}
        >
            {/* Contenu */}
            <div ref={contentRef} className={`flex flex-col ${leadDragging ? "min-h-[120px]" : ""}`}>

            {/* ── Header ── */}
            <div
                className="px-2 pt-2 pb-1.5 flex items-center gap-1.5 group"
                draggable={!leadDragging}
                onDragStart={(e) => {
                    if (leadDragging) {
                        e.preventDefault();
                        return;
                    }
                    onColumnDragStart(e, column.id);
                }}
            >
                {/* Grip — visible au hover */}
                <button
                    aria-label="Réordonner la colonne"
                    className="cursor-grab active:cursor-grabbing text-foreground/20 hover:text-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    data-testid={`column-grip-${column.id}`}
                >
                    <GripVertical size={12} />
                </button>

                {/* Pastille couleur + nom (plus de pill pleine) */}
                {editing ? (
                    <input
                        ref={inputRef}
                        data-testid={`column-title-input-${column.id}`}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") { setName(column.name); setEditing(false); }
                        }}
                        className="flex-1 bg-transparent text-[13px] font-semibold outline-none border-b border-foreground/30 text-foreground"
                    />
                ) : (
                    <button
                        data-testid={`column-title-${column.id}`}
                        onDoubleClick={() => setEditing(true)}
                        className="inline-flex items-center gap-2 min-w-0 flex-1 text-left"
                        title="Double-cliquez pour renommer"
                    >
                        <span
                            className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`}
                            aria-hidden
                        />
                        <span className="text-[13px] font-semibold text-foreground truncate max-w-[160px]">
                            {column.name}
                        </span>
                    </button>
                )}

                <span
                    data-testid={`column-count-${column.id}`}
                    className={
                        isWonColumnView
                            ? "text-[12px] text-foreground/90 tabular-nums shrink-0 font-semibold"
                            : "text-[12px] text-muted-foreground/70 tabular-nums shrink-0 font-medium"
                    }
                    title={isWonColumnView ? `${leads.length} deal${leads.length !== 1 ? "s" : ""}` : undefined}
                >
                    {isWonColumnView ? wonTotalLabel : leads.length}
                </span>
                {effectiveSort && (
                    <span title={`Trié par ${effectiveSort.label}`} className="shrink-0 text-primary/70">
                        {effectiveSort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                    </span>
                )}
                {column.autoFollowup && (
                    <span title="Rappels automatiques" className="shrink-0 text-foreground/35">
                        <BellRing size={11} data-testid={`column-followup-badge-${column.id}`} />
                    </span>
                )}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            data-testid={`column-menu-${column.id}`}
                            aria-label="Options de colonne"
                            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all shrink-0"
                        >
                            <MoreHorizontal size={15} />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60 rounded-xl">
                        <DropdownMenuItem onClick={() => setEditing(true)}>
                            Renommer la colonne
                        </DropdownMenuItem>
                        {/* Mode traitement rapide — déplacé ici depuis le header */}
                        {onStartQuickMode && leads.length > 0 && (
                            <DropdownMenuItem
                                onClick={() => { onStartQuickMode(); }}
                                data-testid={`column-quick-mode-${column.id}`}
                            >
                                <Zap size={14} className={`mr-2 ${quickMode ? "text-primary fill-primary" : ""}`} />
                                Mode traitement rapide
                                {quickMode && <Check size={13} className="ml-auto text-primary" />}
                                {!quickMode && <span className="ml-auto text-[10px] text-muted-foreground">→ / ↑↓</span>}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                            onClick={() => onToggleAutoFollowup(!column.autoFollowup)}
                            data-testid={`column-toggle-followup-${column.id}`}
                        >
                            <BellRing size={14} className="mr-2" />
                            Rappel auto (+1j / +2j / +3j)
                            {column.autoFollowup && <Check size={13} className="ml-auto text-primary" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => onTogglePromptNote(!column.promptNoteOnEnter)}
                            data-testid={`column-toggle-prompt-${column.id}`}
                        >
                            <MessageSquarePlus size={14} className="mr-2" />
                            Note d'appel à l'arrivée
                            {column.promptNoteOnEnter && <Check size={13} className="ml-auto text-primary" />}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        {/* ── Trier par ── */}
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="flex items-center gap-2">
                                <ArrowUpDown size={14} className="text-muted-foreground" />
                                <span>Trier par</span>
                                {effectiveSort && (
                                    <span className="ml-auto text-[10px] font-medium text-primary truncate max-w-[80px]">
                                        {effectiveSort.label}
                                    </span>
                                )}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-52 rounded-xl">
                                {/* Reset */}
                                {effectiveSort?.key !== "lastContact" && (
                                    <>
                                        <DropdownMenuItem onClick={clearSort} className="text-muted-foreground">
                                            <XIcon size={13} className="mr-2" />
                                            Plus récent (défaut)
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                )}
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                    Champs principaux
                                </DropdownMenuLabel>
                                {[
                                    { key: "company",     label: "Nom entreprise" },
                                    { key: "contact",     label: "Contact" },
                                    { key: "phone",       label: "Téléphone" },
                                    { key: "email",       label: "Email" },
                                    { key: "dealValue",   label: "Valeur deal" },
                                    { key: "createdAt",   label: "Date création" },
                                    { key: "lastContact", label: "Plus récent", preferDesc: true },
                                    { key: "vigilance",   label: "Vigilance", preferDesc: true },
                                ].map(({ key, label, preferDesc }) => {
                                    const active = effectiveSort?.key === key;
                                    return (
                                        <DropdownMenuItem
                                            key={key}
                                            onClick={() => applySort(key, label, { preferDesc: !!preferDesc })}
                                        >
                                            <span className="flex-1">{label}</span>
                                            {active && (
                                                effectiveSort.dir === "asc"
                                                    ? <ArrowUp size={13} className="text-primary" />
                                                    : <ArrowDown size={13} className="text-primary" />
                                            )}
                                        </DropdownMenuItem>
                                    );
                                })}
                                {extraKeys.length > 0 && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                            Données importées
                                        </DropdownMenuLabel>
                                        {extraKeys.map((k) => {
                                            const key = `extra:${k}`;
                                            const active = effectiveSort?.key === key;
                                            return (
                                                <DropdownMenuItem key={key} onClick={() => applySort(key, k)}>
                                                    <span className="flex-1 truncate">{k}</span>
                                                    {active && (
                                                        effectiveSort.dir === "asc"
                                                            ? <ArrowUp size={13} className="text-primary" />
                                                            : <ArrowDown size={13} className="text-primary" />
                                                    )}
                                                </DropdownMenuItem>
                                            );
                                        })}
                                    </>
                                )}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
                            <Palette size={12} /> Couleur
                        </DropdownMenuLabel>
                        <ColorPickerRow current={column.color} onPick={onSetColor} />
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setConfirmClear(true)}
                            disabled={leads.length === 0}
                            data-testid={`column-clear-${column.id}`}
                        >
                            <Eraser size={14} className="mr-2" />
                            Vider la colonne
                            {leads.length > 0 && (
                                <span className="ml-auto text-[11px] opacity-60">
                                    {leads.length} lead{leads.length > 1 ? "s" : ""}
                                </span>
                            )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setConfirmDel(true)}
                            data-testid={`column-delete-${column.id}`}
                        >
                            <Trash2 size={14} className="mr-2" />
                            Supprimer la colonne
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Cards list */}
            <div className="flex-1 px-2 pb-3" data-drop-index={leads.length}>
                <CardDropSlot
                    index={0}
                    isActive={isDragTarget && insertIndex === 0}
                >
                    <div className="pt-1" />
                </CardDropSlot>

                {sortedLeads.map((lead, i) => (
                    <React.Fragment key={lead.id}>
                        <CardScaleWrapper scale={workspace.cardScale ?? 1}>
                            <LeadCard
                                lead={lead}
                                column={column}
                                workspace={workspace}
                                onOpen={onOpenLead}
                                onPointerDownLead={onLeadPointerDown}
                                dragging={dragState?.leadId === lead.id}
                                quickFocused={quickMode && lead.id === quickFocusedLeadId}
                            />
                        </CardScaleWrapper>
                        <CardDropSlot
                            index={i + 1}
                            isActive={isDragTarget && insertIndex === i + 1}
                        >
                            <div className="pt-2" />
                        </CardDropSlot>
                    </React.Fragment>
                ))}

                {/* Empty state — Nouveau only */}
                {leads.length === 0 && !leadDragging && isNouveauColumn(column.name) && (
                    <div className="pt-1 pb-2 px-1">
                        <button
                            onClick={onAddLead}
                            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-primary text-[12px] font-medium"
                        >
                            <Plus size={13} />
                            <span>Nouveau lead</span>
                        </button>
                    </div>
                )}

                {leadDragging && (
                    <div
                        data-drop-index={leads.length}
                        className={`kanban-drop-zone rounded-xl border-2 border-dashed mx-1 flex items-center justify-center transition-colors ${
                            leads.length === 0 ? "py-10" : "py-3 mt-1"
                        } ${
                            isDragTarget
                                ? "border-primary/50 bg-primary/15"
                                : "border-primary/25 bg-primary/5"
                        }`}
                    >
                        <span className={`text-xs font-medium ${isDragTarget ? "text-primary" : "text-foreground/60"}`}>
                            Déposer ici
                        </span>
                    </div>
                )}

            <div className="pb-1" />
            </div>

            </div>{/* fin relative */}

            <AlertDialog
                open={confirmClear}
                onOpenChange={(v) => !v && setConfirmClear(false)}
            >
                <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Vider « {column.name} » ?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {leads.length} lead{leads.length > 1 ? "s" : ""} sera{leads.length > 1 ? "ont" : ""} supprimé{leads.length > 1 ? "s" : ""} définitivement. La colonne restera en place.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid={`confirm-column-clear-${column.id}`}
                            onClick={() => {
                                dispatch({
                                    type: "CLEAR_COLUMN",
                                    workspaceId: workspace.id,
                                    columnId: column.id,
                                });
                                setConfirmClear(false);
                            }}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            Vider la colonne
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={confirmDel}
                onOpenChange={(v) => !v && setConfirmDel(false)}
            >
                <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Supprimer « {column.name} » ?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {leads.length > 0
                                ? `Les ${Object.values(workspace.leads).filter((l) => l.columnId === column.id).length} lead(s) seront déplacés vers la première colonne.`
                                : "Cette colonne est vide et sera supprimée."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid={`confirm-column-delete-${column.id}`}
                            onClick={() => {
                                onDelete();
                                setConfirmDel(false);
                            }}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            Supprimer la colonne
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
