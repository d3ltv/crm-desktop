import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    GripVertical,
    EyeOff,
    Eye,
    ChevronDown,
    ChevronUp,
    Layers,
} from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    reorderPanelSectionIndex,
    visiblePanelSections,
    PANEL_SECTION_META,
} from "@/lib/panelSections";

/**
 * Coquille de section fiche lead : drag + masquer + déplier/replier (workspace-wide).
 * Drop avec ligne d’insertion avant/après (plus simple que « déposer sur » une grosse carte).
 */
export function PanelSectionCard({
    id,
    title,
    icon: Icon,
    children,
    onHide,
    onDragStart,
    onDragOver,
    onDrop,
    dragOver,
    dropPlace,
    collapsed = false,
    onToggleCollapse,
    /** Compteur affiché à côté du titre (ex. nb de champs importés) */
    badge,
    isDragging = false,
    /** Style plus léger (fiche « Lignes ») */
    flat = false,
}) {
    const collapsible = typeof onToggleCollapse === "function";
    const showLineBefore = dragOver && dropPlace === "before";
    const showLineAfter = dragOver && dropPlace === "after";

    return (
        <section
            data-panel-section={id}
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const place = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                onDragOver?.(id, place);
            }}
            onDragLeave={(e) => {
                // Ne clear que si on quitte vraiment la section (pas un enfant)
                if (!e.currentTarget.contains(e.relatedTarget)) {
                    onDragOver?.(null, null);
                }
            }}
            onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const place = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                onDrop?.(id, place);
            }}
            className={`relative overflow-hidden transition-[opacity,border-color,box-shadow] ${
                flat
                    ? `rounded-lg border ${isDragging ? "opacity-40 border-primary/40" : dragOver ? "border-primary/35" : "border-border/60"} bg-transparent`
                    : `rounded-xl border bg-card shadow-sm ${
                        isDragging
                            ? "opacity-40 border-primary/40"
                            : dragOver
                              ? "border-primary/40"
                              : "border-border"
                    }`
            }`}
        >
            {showLineBefore && (
                <div
                    className="absolute left-2 right-2 top-0 -translate-y-1/2 h-1 rounded-full bg-primary z-10 pointer-events-none shadow-[0_0_0_2px_hsl(var(--background))]"
                    aria-hidden
                />
            )}
            {showLineAfter && (
                <div
                    className="absolute left-2 right-2 bottom-0 translate-y-1/2 h-1 rounded-full bg-primary z-10 pointer-events-none shadow-[0_0_0_2px_hsl(var(--background))]"
                    aria-hidden
                />
            )}
            <div className={`flex items-center gap-1.5 px-3 py-2.5 border-b group/sec ${
                flat ? "border-border/40 bg-transparent" : "border-border/70 bg-muted/20"
            }`}>
                <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.setData("text/panel-section", id);
                        e.dataTransfer.effectAllowed = "move";
                        // Fantôme plus léger : évite de traîner tout le contenu
                        if (e.dataTransfer.setDragImage) {
                            const ghost = e.currentTarget.parentElement?.cloneNode(true);
                            if (ghost) {
                                ghost.style.width = "200px";
                                ghost.style.position = "absolute";
                                ghost.style.top = "-9999px";
                                document.body.appendChild(ghost);
                                e.dataTransfer.setDragImage(ghost, 20, 16);
                                requestAnimationFrame(() => ghost.remove());
                            }
                        }
                        onDragStart?.(id);
                    }}
                    onDragEnd={() => {
                        onDragStart?.(null);
                        onDragOver?.(null, null);
                    }}
                    className="cursor-grab active:cursor-grabbing p-1.5 -ml-0.5 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 touch-none"
                    title="Glisser pour réordonner (tous les leads)"
                    aria-label={`Réordonner ${title}`}
                >
                    <GripVertical size={15} />
                </button>
                <button
                    type="button"
                    onClick={() => collapsible && onToggleCollapse(id)}
                    className={`flex-1 min-w-0 flex items-center gap-1.5 text-left ${collapsible ? "cursor-pointer" : "cursor-default"}`}
                    disabled={!collapsible}
                    aria-expanded={collapsible ? !collapsed : undefined}
                >
                    <h3 className="flex-1 min-w-0 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                        {Icon && <Icon size={13} strokeWidth={2.5} className="shrink-0" />}
                        <span className="truncate">{title}</span>
                        {badge != null && badge !== "" && (
                            <span className="tabular-nums text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium normal-case tracking-normal">
                                {badge}
                            </span>
                        )}
                    </h3>
                    {collapsible && (
                        <ChevronDown
                            size={14}
                            className={`shrink-0 text-muted-foreground/60 transition-transform duration-150 ${collapsed ? "" : "rotate-180"}`}
                        />
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => onHide?.(id)}
                    className="opacity-0 group-hover/sec:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity"
                    title="Masquer cette section"
                    aria-label={`Masquer ${title}`}
                >
                    <EyeOff size={13} />
                </button>
            </div>
            {!collapsed && (
                <div className={flat ? "px-2 py-2 space-y-2" : "p-4 space-y-3"}>
                    {children}
                </div>
            )}
        </section>
    );
}

/**
 * Organisateur type calques Canva : liste compacte, flèches ↑↓, drag fluide.
 * L’ordre est partagé par tous les leads du workspace.
 */
export function PanelSectionsOrganizer({
    layout,
    onChange,
    getTitle,
}) {
    const [open, setOpen] = useState(false);
    const ids = visiblePanelSections(layout);
    const listRef = useRef(null);
    const dragRef = useRef({
        active: false,
        fromIdx: null,
        toIdx: null,
        pointerY: 0,
        rafId: null,
    });
    const [draggingIdx, setDraggingIdx] = useState(null);
    const [overIdx, setOverIdx] = useState(null);

    const commitIndexReorder = useCallback(
        (fromIdx, toIdx) => {
            if (fromIdx == null || toIdx == null || fromIdx === toIdx) return;
            onChange?.(reorderPanelSectionIndex(layout, fromIdx, toIdx, ids));
        },
        [layout, ids, onChange],
    );

    const moveBy = (id, delta) => {
        const idx = ids.indexOf(id);
        const targetIdx = idx + delta;
        if (idx < 0 || targetIdx < 0 || targetIdx >= ids.length) return;
        onChange?.(reorderPanelSectionIndex(layout, idx, targetIdx, ids));
    };

    const getIndexFromY = useCallback((clientY) => {
        const el = listRef.current;
        if (!el) return null;
        const rows = el.querySelectorAll("[data-section-row]");
        if (!rows.length) return null;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            const mid = r.top + r.height / 2;
            if (clientY < mid) return i;
        }
        return rows.length - 1;
    }, []);

    useEffect(() => {
        if (!open && dragRef.current.active) {
            cancelAnimationFrame(dragRef.current.rafId);
            dragRef.current.active = false;
            setDraggingIdx(null);
            setOverIdx(null);
        }
    }, [open]);

    const onGripPointerDown = (e, index) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
            active: true,
            fromIdx: index,
            toIdx: index,
            pointerY: e.clientY,
            rafId: null,
        };
        setDraggingIdx(index);
        setOverIdx(index);

        const handleMove = (ev) => {
            dragRef.current.pointerY = ev.clientY;
        };
        const handleUp = () => {
            const d = dragRef.current;
            cancelAnimationFrame(d.rafId);
            const { fromIdx, toIdx } = d;
            d.active = false;
            setDraggingIdx(null);
            setOverIdx(null);
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
            window.removeEventListener("pointercancel", handleUp);
            commitIndexReorder(fromIdx, toIdx);
        };

        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
        const loop = () => {
            if (!dragRef.current.active) return;
            const next = getIndexFromY(dragRef.current.pointerY);
            if (next != null && next !== dragRef.current.toIdx) {
                dragRef.current.toIdx = next;
                setOverIdx(next);
            }
            dragRef.current.rafId = requestAnimationFrame(loop);
        };
        dragRef.current.rafId = requestAnimationFrame(loop);
    };

    const titleOf = (id) =>
        (typeof getTitle === "function" && getTitle(id)) ||
        PANEL_SECTION_META[id]?.label ||
        id;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="panel-sections-organize-btn"
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Réordonner les sections (tous les leads)"
                >
                    <Layers size={14} />
                    <span>Organiser</span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-72 p-0 rounded-xl overflow-hidden shadow-panel"
            >
                <div className="px-3 py-2.5 border-b border-border/70">
                    <p className="text-[13px] font-semibold tracking-tight">Ordre des sections</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        Comme des calques — glisser ou ↑↓. S’applique à tous les leads.
                    </p>
                </div>
                <div ref={listRef} className="py-1 max-h-[320px] overflow-y-auto">
                    {ids.map((id, index) => {
                        const isDragging = draggingIdx === index;
                        const isOver =
                            overIdx === index &&
                            draggingIdx != null &&
                            draggingIdx !== index;
                        const place =
                            isOver && draggingIdx != null
                                ? draggingIdx < index
                                    ? "after"
                                    : "before"
                                : null;
                        return (
                            <div
                                key={id}
                                data-section-row
                                className={`relative flex items-center gap-1 px-2 py-1.5 select-none transition-colors ${
                                    isDragging
                                        ? "opacity-35 bg-secondary"
                                        : "hover:bg-secondary/50"
                                }`}
                            >
                                {place === "before" && (
                                    <div className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-primary z-10" />
                                )}
                                {place === "after" && (
                                    <div className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full bg-primary z-10" />
                                )}
                                <button
                                    type="button"
                                    onPointerDown={(e) => onGripPointerDown(e, index)}
                                    className="cursor-grab active:cursor-grabbing touch-none p-1.5 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60"
                                    aria-label={`Déplacer ${titleOf(id)}`}
                                    title="Glisser"
                                >
                                    <GripVertical size={14} />
                                </button>
                                <span className="flex-1 min-w-0 text-[13px] font-medium truncate">
                                    <span className="text-muted-foreground/50 text-[11px] tabular-nums mr-1.5">
                                        {index + 1}
                                    </span>
                                    {titleOf(id)}
                                </span>
                                <div className="flex items-center shrink-0">
                                    <button
                                        type="button"
                                        disabled={index === 0}
                                        onClick={() => moveBy(id, -1)}
                                        className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:pointer-events-none"
                                        aria-label="Monter"
                                        title="Monter"
                                    >
                                        <ChevronUp size={15} />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={index === ids.length - 1}
                                        onClick={() => moveBy(id, 1)}
                                        className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:pointer-events-none"
                                        aria-label="Descendre"
                                        title="Descendre"
                                    >
                                        <ChevronDown size={15} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function HiddenSectionsMenu({ items, onRestore }) {
    const [open, setOpen] = useState(false);
    if (!items?.length) return null;

    return (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
            >
                <span className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Eye size={13} />
                    Données cachées
                    <span className="tabular-nums text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {items.length}
                    </span>
                </span>
                <span className="text-[11px] text-muted-foreground/70">{open ? "Replier" : "Voir"}</span>
            </button>
            {open && (
                <div className="border-t border-border px-2 py-2 space-y-1">
                    {items.map((it) => (
                        <button
                            key={it.id}
                            type="button"
                            onClick={() => onRestore(it.id)}
                            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[13px] text-left hover:bg-muted/70 transition-colors"
                        >
                            {it.Icon && <it.Icon size={13} className="text-muted-foreground shrink-0" />}
                            <span className="flex-1 font-medium">{it.label}</span>
                            <span className="text-[11px] text-primary">Afficher</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
