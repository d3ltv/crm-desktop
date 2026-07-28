/**
 * Fusion d’un backup JSON dans l’état courant — ajoute sans écraser.
 */

import { ensureSidebar, navIdForWorkspace } from "@/lib/sidebarNav";

function newId(prefix = "") {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueWorkspaceName(name, existingNames) {
    const base = String(name || "Espace importé").trim() || "Espace importé";
    if (!existingNames.has(base.toLowerCase())) return base;
    let i = 2;
    while (existingNames.has(`${base} (import ${i})`.toLowerCase())) i += 1;
    return `${base} (import ${i})`;
}

/**
 * @param {object} current — state Relia actuel
 * @param {object} imported — snapshot JSON parsé
 * @returns {{ state: object, addedWorkspaces: number, addedLeads: number, addedEvents: number, skipped: boolean }}
 */
export function mergeImportedState(current, imported) {
    if (!imported || typeof imported !== "object" || !imported.workspaces) {
        throw new Error("Format invalide");
    }

    const base = current && typeof current === "object" ? current : {};
    const workspaces = { ...(base.workspaces || {}) };
    const existingIds = new Set(Object.keys(workspaces));
    const existingNames = new Set(
        Object.values(workspaces).map((w) => String(w?.name || "").toLowerCase())
    );

    const order = Array.isArray(base.order) ? [...base.order] : [];
    /** @type {Map<string, string>} oldWsId → newWsId */
    const wsIdMap = new Map();

    let addedWorkspaces = 0;
    let addedLeads = 0;

    const importOrder = Array.isArray(imported.order) && imported.order.length
        ? imported.order.filter((id) => imported.workspaces?.[id])
        : Object.keys(imported.workspaces || {});

    for (const oldWsId of importOrder) {
        const src = imported.workspaces[oldWsId];
        if (!src || typeof src !== "object") continue;

        const wsId = existingIds.has(oldWsId) ? newId("ws_") : oldWsId;
        if (existingIds.has(wsId)) continue;

        const name = uniqueWorkspaceName(src.name, existingNames);
        existingNames.add(name.toLowerCase());

        const leads = {};
        Object.entries(src.leads || {}).forEach(([leadId, lead]) => {
            leads[leadId] = { ...lead, id: leadId };
        });

        workspaces[wsId] = {
            ...src,
            id: wsId,
            name,
            leads,
            columns: { ...(src.columns || {}) },
            columnOrder: Array.isArray(src.columnOrder) ? [...src.columnOrder] : src.columnOrder,
            leadOrder: Array.isArray(src.leadOrder) ? [...src.leadOrder] : src.leadOrder,
        };

        wsIdMap.set(oldWsId, wsId);
        existingIds.add(wsId);
        order.push(wsId);
        addedWorkspaces += 1;
        addedLeads += Object.keys(leads).length;
    }

    // Événements calendrier libres
    const standaloneEvents = Array.isArray(base.standaloneEvents)
        ? [...base.standaloneEvents]
        : [];
    const eventIds = new Set(standaloneEvents.map((e) => e?.id).filter(Boolean));
    let addedEvents = 0;

    for (const ev of imported.standaloneEvents || []) {
        if (!ev || typeof ev !== "object") continue;
        let id = ev.id || newId("ev_");
        if (eventIds.has(id)) id = newId("ev_");
        eventIds.add(id);

        let workspaceId = ev.workspaceId || null;
        if (workspaceId) {
            workspaceId = wsIdMap.get(workspaceId) || (
                workspaces[workspaceId] ? workspaceId : null
            );
        }

        standaloneEvents.unshift({
            ...ev,
            id,
            workspaceId,
        });
        addedEvents += 1;
    }

    // Sidebar : garder l’existant + icônes importées pour les nouveaux espaces
    const sidebarItems = { ...(base.sidebar?.items || {}) };
    const rootOrder = Array.isArray(base.sidebar?.rootOrder)
        ? [...base.sidebar.rootOrder]
        : [];

    for (const [oldWsId, newWsId] of wsIdMap) {
        const navId = navIdForWorkspace(newWsId);
        const oldNavId = navIdForWorkspace(oldWsId);
        const importedItem = imported.sidebar?.items?.[oldNavId];
        if (!sidebarItems[navId]) {
            sidebarItems[navId] = {
                id: navId,
                type: "workspace",
                workspaceId: newWsId,
                parentId: null,
                icon: importedItem?.icon ?? null,
            };
            rootOrder.push(navId);
        }
    }

    const merged = {
        workspaces,
        order,
        sidebar: { items: sidebarItems, rootOrder },
        // Préserver prefs locales — ne pas écraser thème / objectif / mode panel
        theme: base.theme || imported.theme || "light",
        leadPanelMode: base.leadPanelMode || imported.leadPanelMode || "side",
        settings: {
            ...(imported.settings || {}),
            ...(base.settings || {}),
            dailyGoal: base.settings?.dailyGoal
                ?? imported.settings?.dailyGoal
                ?? 20,
        },
        standaloneEvents,
        currentId: base.currentId ?? null,
        lastOpenedId: base.lastOpenedId || null,
        lastDeleted: null,
    };

    return {
        state: {
            ...merged,
            sidebar: ensureSidebar(merged),
        },
        addedWorkspaces,
        addedLeads,
        addedEvents,
        skipped: addedWorkspaces === 0 && addedEvents === 0,
    };
}
