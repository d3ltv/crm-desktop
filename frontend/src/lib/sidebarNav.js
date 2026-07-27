/** Navigation latérale : arbre plat (espaces + dossiers 1 niveau). */

export function navIdForWorkspace(workspaceId) {
    return `nav_${workspaceId}`;
}

export function makeFolderId() {
    return `folder_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Construit un sidebar depuis l’ancien `order` plat. */
export function buildSidebarFromOrder(order = []) {
    const items = {};
    const rootOrder = [];
    order.forEach((workspaceId) => {
        const id = navIdForWorkspace(workspaceId);
        items[id] = {
            id,
            type: "workspace",
            workspaceId,
            parentId: null,
            icon: null,
        };
        rootOrder.push(id);
    });
    return { items, rootOrder };
}

/**
 * Garantit un sidebar cohérent avec les workspaces.
 * Crée les entrées manquantes, retire les orphelines, conserve dossiers/icônes.
 * Retourne la même référence si rien n’a changé.
 */
export function ensureSidebar(state) {
    const order = Array.isArray(state.order) ? state.order : [];
    const wsIds = new Set(Object.keys(state.workspaces || {}));
    const sidebar = state.sidebar;

    if (!sidebar?.items || !Array.isArray(sidebar.rootOrder)) {
        return buildSidebarFromOrder(order.filter((id) => wsIds.has(id)));
    }

    let changed = false;
    const items = { ...sidebar.items };
    let rootOrder = sidebar.rootOrder;

    Object.keys(items).forEach((id) => {
        const item = items[id];
        if (item.type === "workspace" && !wsIds.has(item.workspaceId)) {
            delete items[id];
            changed = true;
        }
    });

    if (changed) {
        rootOrder = rootOrder.filter((id) => items[id]);
        Object.keys(items).forEach((id) => {
            const item = items[id];
            if (item.type === "folder") {
                const next = (item.childOrder || []).filter((cid) => items[cid]);
                if (next.length !== (item.childOrder || []).length) {
                    items[id] = { ...item, childOrder: next };
                }
            }
        });
    }

    order.forEach((workspaceId) => {
        if (!wsIds.has(workspaceId)) return;
        const id = navIdForWorkspace(workspaceId);
        if (!items[id]) {
            items[id] = {
                id,
                type: "workspace",
                workspaceId,
                parentId: null,
                icon: null,
            };
            if (rootOrder === sidebar.rootOrder) rootOrder = [...rootOrder];
            rootOrder.push(id);
            changed = true;
        }
    });

    if (!changed) return sidebar;
    return { items, rootOrder };
}

/** Liste visuelle aplatie pour le rendu / DnD (dossiers ouverts uniquement). */
export function flattenSidebar(sidebar) {
    if (!sidebar) return [];
    const { items, rootOrder } = sidebar;
    const rows = [];

    rootOrder.forEach((id) => {
        const item = items[id];
        if (!item) return;
        if (item.type === "folder") {
            rows.push({ id, item, depth: 0 });
            if (!item.collapsed) {
                (item.childOrder || []).forEach((childId) => {
                    const child = items[childId];
                    if (child) rows.push({ id: childId, item: child, depth: 1 });
                });
            }
        } else {
            rows.push({ id, item, depth: 0 });
        }
    });

    return rows;
}

/**
 * Déplace un item vers un parent (null = racine) à l’index donné.
 * Les dossiers ne peuvent pas être imbriqués.
 */
export function moveSidebarItem(sidebar, itemId, toParentId, toIndex) {
    const items = { ...sidebar.items };
    const item = items[itemId];
    if (!item) return sidebar;

    // Pas de dossier dans un dossier
    if (item.type === "folder" && toParentId) return sidebar;
    // Pas de drop sur soi-même
    if (toParentId === itemId) return sidebar;

    const fromParentId = item.parentId || null;

    // Retirer de l’ancien parent
    let rootOrder = [...sidebar.rootOrder];
    if (!fromParentId) {
        rootOrder = rootOrder.filter((id) => id !== itemId);
    } else if (items[fromParentId]?.type === "folder") {
        const folder = { ...items[fromParentId] };
        folder.childOrder = (folder.childOrder || []).filter((id) => id !== itemId);
        items[fromParentId] = folder;
    }

    // Insérer dans le nouveau parent
    const nextItem = { ...item, parentId: toParentId || null };
    items[itemId] = nextItem;

    if (!toParentId) {
        const idx = Math.max(0, Math.min(toIndex, rootOrder.length));
        rootOrder.splice(idx, 0, itemId);
    } else if (items[toParentId]?.type === "folder") {
        const folder = { ...items[toParentId] };
        const childOrder = [...(folder.childOrder || [])];
        const idx = Math.max(0, Math.min(toIndex, childOrder.length));
        childOrder.splice(idx, 0, itemId);
        folder.childOrder = childOrder;
        // Ouvrir le dossier cible pour voir le résultat
        folder.collapsed = false;
        items[toParentId] = folder;
    } else {
        return sidebar;
    }

    return { items, rootOrder };
}

/** Ordre plat des workspaceIds (parcours racine → dossiers). */
export function workspaceOrderFromSidebar(sidebar) {
    if (!sidebar) return [];
    const ids = [];
    const { items, rootOrder } = sidebar;
    rootOrder.forEach((id) => {
        const item = items[id];
        if (!item) return;
        if (item.type === "workspace") ids.push(item.workspaceId);
        else if (item.type === "folder") {
            (item.childOrder || []).forEach((cid) => {
                const child = items[cid];
                if (child?.type === "workspace") ids.push(child.workspaceId);
            });
        }
    });
    return ids;
}
