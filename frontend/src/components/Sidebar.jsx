import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCrm } from "@/context/CrmContext";
import {
    Plus,
    LayoutGrid,
    Home,
    ChevronDown,
    Folder,
    FolderOpen,
    GripVertical,
    MoreHorizontal,
    Pencil,
    Trash2,
    Smile,
} from "lucide-react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { SidebarIconDisplay, SidebarIconPicker, SidebarIconPickerContent } from "./SidebarIconPicker";
import {
    ensureSidebar,
    flattenSidebar,
    makeFolderId,
    navIdForWorkspace,
    workspaceOrderFromSidebar,
} from "@/lib/sidebarNav";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { countUnreadWorkspaceNotifs } from "@/lib/followupNotifs";
import { useNotifSeenMap } from "@/hooks/useNotifSeenMap";

const DRAG_THRESHOLD = 6;

function resolveDropTarget(sidebar, fromId, overId, place) {
    if (!overId || fromId === overId) return null;
    const from = sidebar.items[fromId];
    const over = sidebar.items[overId];
    if (!from || !over) return null;

    if (place === "into" && over.type === "folder") {
        if (from.type === "folder") return null;
        return {
            toParentId: over.id,
            toIndex: (over.childOrder || []).length,
        };
    }

    if (over.type === "folder") {
        const idx = sidebar.rootOrder.indexOf(over.id);
        if (idx < 0) return null;
        return {
            toParentId: null,
            toIndex: place === "before" ? idx : idx + 1,
        };
    }

    const parentId = over.parentId || null;
    if (from.type === "folder" && parentId) return null;

    if (parentId) {
        const folder = sidebar.items[parentId];
        const list = folder?.childOrder || [];
        const idx = list.indexOf(over.id);
        if (idx < 0) return null;
        return {
            toParentId: parentId,
            toIndex: place === "before" ? idx : idx + 1,
        };
    }

    const idx = sidebar.rootOrder.indexOf(over.id);
    if (idx < 0) return null;
    return {
        toParentId: null,
        toIndex: place === "before" ? idx : idx + 1,
    };
}

function adjustIndexForSameList(sidebar, itemId, toParentId, toIndex) {
    const from = sidebar.items[itemId];
    const fromParent = from?.parentId || null;
    if (fromParent !== toParentId) return toIndex;
    const list = toParentId
        ? sidebar.items[toParentId]?.childOrder || []
        : sidebar.rootOrder;
    const fromIdx = list.indexOf(itemId);
    if (fromIdx >= 0 && fromIdx < toIndex) return toIndex - 1;
    return toIndex;
}

export const SidebarContent = ({
    collapsed = false,
    onToggleCollapsed,
    onNavigate,
    forceExpanded = false,
    onExpandSidebar,
    hideBrandHeader = false,
}) => {
    const { state, dispatch } = useCrm();
    const seenMap = useNotifSeenMap();
    const [createOpen, setCreateOpen] = useState(false);
    const [renamingId, setRenamingId] = useState(null);
    const [renameValue, setRenameValue] = useState("");
    const [draggingId, setDraggingId] = useState(null);
    const [dropHint, setDropHint] = useState(null);
    const [openMenuId, setOpenMenuId] = useState(null);

    const listRef = useRef(null);
    const dragRef = useRef(null);
    const sidebarRef = useRef(null);
    const dropHintRef = useRef(null);

    const sidebar = state.sidebar?.items ? state.sidebar : ensureSidebar(state);
    const isCollapsed = forceExpanded ? false : collapsed;
    const rows = isCollapsed
        ? workspaceOrderFromSidebar(sidebar)
              .map((workspaceId) => {
                  const id = navIdForWorkspace(workspaceId);
                  const item = sidebar.items[id];
                  return item ? { id, item, depth: 0 } : null;
              })
              .filter(Boolean)
        : flattenSidebar(sidebar);

    sidebarRef.current = sidebar;
    dropHintRef.current = dropHint;

    const handleSelect = (id) => {
        dispatch({ type: "SELECT_WORKSPACE", id });
        onNavigate?.();
    };

    const createFolder = () => {
        const id = makeFolderId();
        dispatch({ type: "CREATE_SIDEBAR_FOLDER", id });
        onExpandSidebar?.();
        setRenamingId(id);
        setRenameValue("Nouveau dossier");
    };

    const commitRename = () => {
        if (!renamingId || !renameValue.trim()) {
            setRenamingId(null);
            setRenameValue("");
            return;
        }
        const item = sidebar.items[renamingId];
        if (item?.type === "folder") {
            dispatch({
                type: "RENAME_SIDEBAR_FOLDER",
                id: renamingId,
                name: renameValue.trim(),
            });
        } else if (item?.type === "workspace") {
            dispatch({
                type: "RENAME_WORKSPACE",
                id: item.workspaceId,
                name: renameValue.trim(),
            });
        }
        setRenamingId(null);
        setRenameValue("");
    };

    const startRename = (item) => {
        const name =
            item.type === "folder"
                ? item.name
                : state.workspaces[item.workspaceId]?.name || "";
        setRenamingId(item.id);
        setRenameValue(name);
    };

    const stopDragListeners = useRef(() => {});

    const onPointerMove = useCallback((ev) => {
        const d = dragRef.current;
        if (!d) return;
        if (!d.active) {
            if (Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD) return;
            d.active = true;
            setDraggingId(d.fromId);
        }

        const el = listRef.current;
        const sb = sidebarRef.current;
        if (!el || !sb) return;

        const targets = el.querySelectorAll("[data-nav-id]");
        let best = null;
        let bestDist = Infinity;
        targets.forEach((node) => {
            const id = node.getAttribute("data-nav-id");
            if (!id || id === d.fromId) return;
            const rect = node.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            const dist = Math.abs(ev.clientY - mid);
            if (dist < bestDist) {
                bestDist = dist;
                const item = sb.items[id];
                let place = ev.clientY < mid ? "before" : "after";
                if (item?.type === "folder") {
                    const band = rect.height * 0.28;
                    if (ev.clientY > rect.top + band && ev.clientY < rect.bottom - band) {
                        place = "into";
                    }
                }
                best = { id, place };
            }
        });
        dropHintRef.current = best;
        setDropHint(best);
    }, []);

    const onPointerUp = useCallback(() => {
        const d = dragRef.current;
        const hint = dropHintRef.current;
        const sb = sidebarRef.current;
        stopDragListeners.current();
        dragRef.current = null;

        if (d?.active && hint && sb) {
            const target = resolveDropTarget(sb, d.fromId, hint.id, hint.place);
            if (target) {
                const toIndex = adjustIndexForSameList(
                    sb,
                    d.fromId,
                    target.toParentId,
                    target.toIndex,
                );
                dispatch({
                    type: "REORDER_SIDEBAR_ITEM",
                    itemId: d.fromId,
                    toParentId: target.toParentId,
                    toIndex,
                });
            }
        }
        setDraggingId(null);
        setDropHint(null);
        dropHintRef.current = null;
    }, [dispatch]);

    stopDragListeners.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
    };

    const startDrag = (e, id) => {
        if (isCollapsed) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
            fromId: id,
            startY: e.clientY,
            active: false,
        };
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    };

    useEffect(() => () => stopDragListeners.current(), []);

    const defaultIcon = (item, active) => {
        if (item.type === "folder") {
            if (isCollapsed) {
                return item.collapsed ? <Folder size={14} /> : <FolderOpen size={14} />;
            }
            return item.collapsed ? (
                <Folder size={15} className="text-muted-foreground" />
            ) : (
                <FolderOpen size={15} className="text-muted-foreground" />
            );
        }
        if (isCollapsed) {
            const name = state.workspaces[item.workspaceId]?.name;
            return (
                <span className="text-xs font-semibold">
                    {(name?.[0] || "?").toUpperCase()}
                </span>
            );
        }
        return (
            <span
                className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    active ? "bg-primary" : "bg-muted-foreground/40",
                )}
            />
        );
    };

    const renderIconControl = (item, active) => {
        const inner = item.icon ? (
            <SidebarIconDisplay
                icon={item.icon}
                size={isCollapsed ? 14 : 15}
                className={active ? "text-primary" : undefined}
            />
        ) : (
            defaultIcon(item, active)
        );

        if (isCollapsed) {
            return (
                <span
                    className={cn(
                        "w-7 h-7 rounded-md flex items-center justify-center",
                        active
                            ? item.icon
                                ? "bg-primary/15 text-primary"
                                : "bg-primary text-primary-foreground"
                            : "bg-secondary",
                    )}
                >
                    {inner}
                </span>
            );
        }

        return (
            <SidebarIconPicker
                icon={item.icon}
                onChange={(icon) =>
                    dispatch({ type: "SET_SIDEBAR_ITEM_ICON", id: item.id, icon })
                }
            >
                <button
                    type="button"
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-secondary shrink-0"
                    aria-label="Changer l'icône"
                >
                    {inner}
                </button>
            </SidebarIconPicker>
        );
    };

    const itemMenu = (item) => (
        <DropdownMenu
            modal={false}
            open={openMenuId === item.id}
            onOpenChange={(o) => setOpenMenuId(o ? item.id : null)}
        >
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
                    aria-label="Options"
                >
                    <MoreHorizontal size={14} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-48">
                <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => startRename(item)}
                >
                    <Pencil size={14} />
                    Renommer
                </DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2">
                        <Smile size={14} />
                        Changer l’icône
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                        className="p-0 border-border/60"
                        sideOffset={6}
                    >
                        <SidebarIconPickerContent
                            icon={item.icon}
                            onChange={(icon) => {
                                dispatch({
                                    type: "SET_SIDEBAR_ITEM_ICON",
                                    id: item.id,
                                    icon,
                                });
                                setOpenMenuId(null);
                            }}
                        />
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                {item.type === "folder" && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="gap-2 text-destructive focus:text-destructive"
                            onSelect={() =>
                                dispatch({ type: "DELETE_SIDEBAR_FOLDER", id: item.id })
                            }
                        >
                            <Trash2 size={14} />
                            Supprimer le dossier
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const workspaceIds = workspaceOrderFromSidebar(sidebar);
    const shortcutMod =
        typeof navigator !== "undefined" &&
        /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "")
            ? "⌥"
            : "Alt+";

    return (
        <TooltipProvider delayDuration={200}>
            <div className="h-full flex flex-col">
                {!hideBrandHeader && (
                <div
                    className={cn(
                        "h-14 flex items-center border-b border-border/60 shrink-0",
                        isCollapsed ? "justify-center px-2" : "px-4 gap-2",
                    )}
                >
                    {onToggleCollapsed ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    data-testid="sidebar-toggle-btn"
                                    onClick={onToggleCollapsed}
                                    aria-label={
                                        isCollapsed
                                            ? "Ouvrir le menu des espaces"
                                            : "Fermer le menu des espaces"
                                    }
                                    aria-expanded={!isCollapsed}
                                    className="w-8 h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 flex items-center justify-center shrink-0 transition-colors"
                                >
                                    <LayoutGrid size={16} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                {isCollapsed
                                    ? "Ouvrir le menu des espaces"
                                    : "Fermer le menu des espaces"}
                            </TooltipContent>
                        </Tooltip>
                    ) : (
                        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <LayoutGrid size={16} />
                        </div>
                    )}
                    {!isCollapsed && (
                        <span className="font-semibold tracking-tight">CRM</span>
                    )}
                </div>
                )}

                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            data-testid="sidebar-home-btn"
                            onClick={() => handleSelect(null)}
                            className={cn(
                                "mx-2 mt-3 flex items-center h-11 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors",
                                isCollapsed ? "justify-center" : "px-3 gap-2",
                            )}
                        >
                            <Home size={16} />
                            {!isCollapsed && "Tous les espaces"}
                        </button>
                    </TooltipTrigger>
                    {isCollapsed && (
                        <TooltipContent side="right">Tous les espaces</TooltipContent>
                    )}
                </Tooltip>

                <div className="px-2 mt-4 flex-1 overflow-y-auto no-scrollbar">
                    <div
                        className={cn(
                            "flex items-center mb-2",
                            isCollapsed ? "justify-center" : "px-2 justify-between",
                        )}
                    >
                        {!isCollapsed && (
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                Espaces
                            </span>
                        )}
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    data-testid="sidebar-add-workspace-btn"
                                    aria-label="Ajouter"
                                    className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center justify-center"
                                >
                                    <Plus size={14} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" side="right" className="w-44">
                                <DropdownMenuItem
                                    className="gap-2"
                                    onSelect={() => setCreateOpen(true)}
                                >
                                    <Plus size={14} />
                                    Nouvel espace
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="gap-2"
                                    onSelect={createFolder}
                                >
                                    <Folder size={14} />
                                    Nouveau dossier
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <nav ref={listRef} className="space-y-0.5">
                        {rows.map(({ id, item, depth }) => {
                            const isDrag = draggingId === id;
                            const hint = dropHint?.id === id ? dropHint.place : null;
                            const insertLine = (place) =>
                                hint === place ? (
                                    <div
                                        className={cn(
                                            "absolute right-2 h-0.5 rounded-full bg-primary z-10 pointer-events-none",
                                            place === "before" ? "-top-0.5" : "-bottom-0.5",
                                            depth ? "left-6" : "left-2",
                                        )}
                                    />
                                ) : null;

                            if (item.type === "folder") {
                                const folderNotifCount = (item.childOrder || []).reduce((sum, childId) => {
                                    const child = sidebar.items[childId];
                                    if (child?.type !== "workspace") return sum;
                                    return sum + countUnreadWorkspaceNotifs(
                                        state.workspaces[child.workspaceId],
                                        seenMap
                                    );
                                }, 0);
                                const body = (
                                    <div className="relative">
                                        {insertLine("before")}
                                        <div
                                            data-nav-id={id}
                                            className={cn(
                                                "group w-full h-11 rounded-lg text-sm flex items-center transition-colors",
                                                isCollapsed ? "justify-center" : "px-1.5 gap-0.5",
                                                hint === "into" &&
                                                    "bg-primary/10 ring-1 ring-inset ring-primary/25",
                                                isDrag && "opacity-40",
                                            )}
                                        >
                                            {!isCollapsed && (
                                                <button
                                                    type="button"
                                                    onPointerDown={(e) => startDrag(e, id)}
                                                    className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover:opacity-100"
                                                    aria-label="Déplacer"
                                                >
                                                    <GripVertical size={13} />
                                                </button>
                                            )}
                                            {!isCollapsed && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        dispatch({
                                                            type: "TOGGLE_SIDEBAR_FOLDER",
                                                            id,
                                                        })
                                                    }
                                                    className="w-4 h-4 flex items-center justify-center shrink-0"
                                                    aria-label={
                                                        item.collapsed
                                                            ? "Déplier"
                                                            : "Replier"
                                                    }
                                                >
                                                    <ChevronDown
                                                        size={13}
                                                        className={cn(
                                                            "text-muted-foreground transition-transform",
                                                            item.collapsed && "-rotate-90",
                                                        )}
                                                    />
                                                </button>
                                            )}
                                            {renderIconControl(item, false)}
                                            {!isCollapsed &&
                                                (renamingId === id ? (
                                                    <input
                                                        autoFocus
                                                        value={renameValue}
                                                        onChange={(e) =>
                                                            setRenameValue(e.target.value)
                                                        }
                                                        onBlur={commitRename}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") {
                                                                e.preventDefault();
                                                                commitRename();
                                                            }
                                                            if (e.key === "Escape") {
                                                                setRenamingId(null);
                                                            }
                                                        }}
                                                        className="flex-1 min-w-0 h-7 px-1 rounded bg-background border border-border/60 text-sm outline-none"
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        data-testid={`sidebar-folder-${id}`}
                                                        onClick={() =>
                                                            dispatch({
                                                                type: "TOGGLE_SIDEBAR_FOLDER",
                                                                id,
                                                            })
                                                        }
                                                        className="flex-1 min-w-0 h-full px-1 text-left truncate text-foreground/80 font-medium relative"
                                                    >
                                                        <span className="truncate pr-6 block">{item.name}</span>
                                                        {folderNotifCount > 0 && (
                                                            <span
                                                                className="absolute top-1/2 -translate-y-1/2 right-0 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-rose-500 text-white flex items-center justify-center tabular-nums"
                                                                title={`${folderNotifCount} notification${folderNotifCount > 1 ? "s" : ""}`}
                                                                data-testid={`sidebar-folder-notif-${id}`}
                                                            >
                                                                {folderNotifCount > 9 ? "9+" : folderNotifCount}
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                            {!isCollapsed && itemMenu(item)}
                                        </div>
                                        {insertLine("after")}
                                    </div>
                                );

                                if (!isCollapsed) {
                                    return <React.Fragment key={id}>{body}</React.Fragment>;
                                }
                                return (
                                    <Tooltip key={id}>
                                        <TooltipTrigger asChild>{body}</TooltipTrigger>
                                        <TooltipContent side="right">
                                            {item.name}
                                            {folderNotifCount > 0 ? ` · ${folderNotifCount} notif` : ""}
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            }

                            const ws = state.workspaces[item.workspaceId];
                            if (!ws) return null;
                            const active = state.currentId === ws.id;
                            const leadCount = Object.keys(ws.leads).length;
                            const notifCount = countUnreadWorkspaceNotifs(ws, seenMap);
                            const shortcutIdx = workspaceIds.indexOf(ws.id);
                            const shortcutLabel =
                                shortcutIdx >= 0 && shortcutIdx < 9
                                    ? `${shortcutMod}${shortcutIdx + 1}`
                                    : null;

                            const body = (
                                <div className="relative">
                                    {insertLine("before")}
                                    <div
                                        data-nav-id={id}
                                        data-testid={`sidebar-ws-${ws.id}`}
                                        className={cn(
                                            "group w-full h-11 rounded-lg text-sm flex items-center transition-colors relative",
                                            active
                                                ? "bg-primary/10 text-primary font-medium"
                                                : "text-foreground/80 hover:bg-secondary",
                                            isCollapsed
                                                ? "justify-center"
                                                : "px-1.5 gap-0.5 text-left",
                                            depth && !isCollapsed && "pl-3",
                                            isDrag && "opacity-40",
                                        )}
                                    >
                                        {!isCollapsed && (
                                            <button
                                                type="button"
                                                onPointerDown={(e) => startDrag(e, id)}
                                                className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover:opacity-100"
                                                aria-label="Déplacer"
                                            >
                                                <GripVertical size={13} />
                                            </button>
                                        )}
                                        {renderIconControl(item, active)}
                                        {!isCollapsed &&
                                            (renamingId === id ? (
                                                <input
                                                    autoFocus
                                                    value={renameValue}
                                                    onChange={(e) =>
                                                        setRenameValue(e.target.value)
                                                    }
                                                    onBlur={commitRename}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            commitRename();
                                                        }
                                                        if (e.key === "Escape") {
                                                            setRenamingId(null);
                                                        }
                                                    }}
                                                    className="flex-1 min-w-0 h-7 px-1 rounded bg-background border border-border/60 text-sm outline-none"
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelect(ws.id)}
                                                    className="flex-1 min-w-0 h-full flex items-center gap-2 px-1 rounded-md"
                                                >
                                                    <span className="truncate flex-1 text-left">
                                                        {ws.name}
                                                    </span>
                                                    {shortcutLabel && (
                                                        <kbd
                                                            className={cn(
                                                                "hidden xl:inline-flex items-center px-1 py-0.5 rounded border border-border/60 font-mono text-[10px] tabular-nums shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                                                                active
                                                                    ? "text-primary/50"
                                                                    : "text-muted-foreground/70",
                                                            )}
                                                        >
                                                            {shortcutLabel}
                                                        </kbd>
                                                    )}
                                                    <span
                                                        className={cn(
                                                            "text-xs tabular-nums shrink-0",
                                                            active
                                                                ? "text-primary/60"
                                                                : "text-muted-foreground",
                                                        )}
                                                    >
                                                        {leadCount}
                                                    </span>
                                                </button>
                                            ))}
                                        {isCollapsed && (
                                            <button
                                                type="button"
                                                onClick={() => handleSelect(ws.id)}
                                                className="absolute inset-0"
                                                aria-label={ws.name}
                                            />
                                        )}
                                        {notifCount > 0 && (
                                            <span
                                                className="absolute top-1 right-1 min-w-[15px] h-3.5 px-1 rounded-full text-[9px] font-bold bg-rose-500 text-white flex items-center justify-center pointer-events-none z-10 tabular-nums"
                                                title={`${notifCount} notification${notifCount > 1 ? "s" : ""}`}
                                                data-testid={`sidebar-ws-notif-${ws.id}`}
                                                aria-hidden
                                            >
                                                {notifCount > 9 ? "9+" : notifCount}
                                            </span>
                                        )}
                                        {!isCollapsed && itemMenu(item)}
                                    </div>
                                    {insertLine("after")}
                                </div>
                            );

                            if (!isCollapsed) {
                                return <React.Fragment key={id}>{body}</React.Fragment>;
                            }
                            return (
                                <Tooltip key={id}>
                                    <TooltipTrigger asChild>{body}</TooltipTrigger>
                                    <TooltipContent side="right" className="flex items-center gap-2">
                                        <span>{ws.name}</span>
                                        {notifCount > 0 && (
                                            <span className="text-rose-400 font-medium">
                                                {notifCount} notif
                                            </span>
                                        )}
                                        <span className="opacity-60">{leadCount}</span>
                                        {shortcutLabel && (
                                            <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[10px] text-muted-foreground">
                                                {shortcutLabel}
                                            </kbd>
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })}
                    </nav>
                </div>

                <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
            </div>
        </TooltipProvider>
    );
};

export const Sidebar = ({ open, onClose, onToggle }) => {
    // Esc replie la sidebar (ne ferme plus un overlay)
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    return (
        <aside
            data-testid="sidebar"
            aria-hidden={!open}
            className={cn(
                "hidden md:flex flex-col shrink-0 h-screen sticky top-0 z-30",
                "border-r border-border bg-surface overflow-hidden",
                "transition-[width] duration-200 ease-out",
                open ? "w-56" : "w-0 border-r-0",
            )}
        >
            <div className="w-56 h-full flex flex-col min-h-0">
                <SidebarContent
                    forceExpanded
                    hideBrandHeader
                    onToggleCollapsed={onToggle}
                    onNavigate={undefined}
                />
            </div>
        </aside>
    );
};
