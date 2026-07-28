import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import { inferColumnColor } from "@/lib/columnColors";
import { startAutoBackup, stopAutoBackup, saveBackup } from "@/lib/autoBackup";
import {
    isTauri,
    diskLoadState,
    diskLoadBackup,
    diskSaveState,
    diskDataDir,
} from "@/lib/diskStorage";
import { purgeExpiredCallRecordings } from "@/lib/callRecordings";
import {
    pushDesktopFollowupNotifications,
    startMorningRecoScheduler,
    stopMorningRecoScheduler,
} from "@/lib/desktopNotifications";
import { mergeImportedState } from "@/lib/mergeImportedState";
import {
    trackCrmAction,
    flushUsageMemory,
    installUsageMemoryLifecycle,
} from "@/lib/usageMemory";
import { flushDesktopStorageNow } from "@/lib/desktopLocalStorage";
import { resolveLogo } from "@/lib/logoUtils";
import {
    isContactedColumn,
    isNouveauColumn,
    isWonColumn,
    isLostColumn,
    isMeetingColumn,
    isPropositionColumn,
    isRappelColumn,
} from "@/constants/columnPatterns";
import {
    ensureSidebar,
    makeFolderId,
    moveSidebarItem,
    navIdForWorkspace,
    workspaceOrderFromSidebar,
} from "@/lib/sidebarNav";
import { isManualRdv } from "@/lib/nextActionUtils";
import { toLocalDateKey } from "@/lib/dateUtils";
import { resolveColumnIdByName } from "@/lib/csvUtils";
import { resolvePipelineColumnId, migrateWorkspacePipeline } from "@/lib/pipelineRoles";

// ---------- Utilities ----------
const uid = () =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_COLUMNS = [
    "Nouveau",
    "Contacté",
    "Relance",
    "Rendez-vous",
    "Gagné",
    "Perdu",
];

// shouldPromptNote : même logique que isContactedColumn (colonne de type "contacté")
function shouldPromptNote(name = "") {
    return isContactedColumn(name);
}

/**
 * Compte le nombre de jours ouvrés (lundi–samedi, dimanche exclu) entre
 * une date ISO passée et maintenant.
 */
function businessDaysSince(isoDate) {
    if (!isoDate) return 0;
    const start = new Date(isoDate);
    const end   = new Date();
    if (end <= start) return 0;

    let count = 0;
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    while (cur < endDay) {
        if (cur.getDay() !== 0) count++; // 0 = dimanche
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

/** Nombre de jours ouvrés requis avant qu'un lead soit marqué "stale" */
const STALE_BUSINESS_DAYS = 3;

// ---------- Card fields config ----------
// Each entry: { key, label, visible }
// "key" is either a fixed slot name or an extra/CSV column key prefixed with "extra:"
export const DEFAULT_CARD_FIELDS = [
    { key: "phone",        label: "Téléphone",               visible: true  },
    { key: "website",      label: "Site web",                visible: true  },
    { key: "email",        label: "Email",                   visible: true  },
    { key: "contact",      label: "Contact",                 visible: false },
    { key: "tags",         label: "Tags",                    visible: true  },
    { key: "dealValue",    label: "Prix / Valeur du deal",   visible: true  },
    { key: "lastNote",     label: "Dernière note",           visible: true  },
    { key: "followupBadge",label: "Badge relance auto",      visible: true  },
    { key: "inconsistencyBadge", label: "Badge incohérences", visible: true },
    { key: "nextAction",   label: "Prochaine action",        visible: true  },
    { key: "statusTime",   label: "Temps dans la colonne",   visible: true  },
    { key: "lastContact",  label: "Dernier contact",         visible: true  },
    { key: "pinnedFields", label: "Champs épinglés",         visible: true  },
    { key: "actionBar",    label: "Barre d'actions rapides", visible: true  },
];

const makeWorkspace = (name, sector = "", template = "crm") => {
    const columns = {};
    const columnOrder = [];

    // Définition des templates
    const TEMPLATES = {
        crm: {
            columns: DEFAULT_COLUMNS,
            cardFields: DEFAULT_CARD_FIELDS,
        },
        jobs: {
            columns: [
                "Candidatures envoyées",
                "Entretien RH",
                "Entretien Technique",
                "Proposition reçue",
                "Accepté 🎉",
                "Refusé",
            ],
            cardFields: [
                { key: "contact",      label: "Recruteur / Contact",  visible: true  },
                { key: "phone",        label: "Téléphone",            visible: false },
                { key: "email",        label: "Email",                visible: true  },
                { key: "website",      label: "Lien offre / Site",    visible: true  },
                { key: "tags",         label: "Tags (Tech, Remote…)", visible: true  },
                { key: "dealValue",    label: "Salaire proposé",      visible: true  },
                { key: "nextAction",   label: "Prochain entretien",   visible: true  },
                { key: "lastContact",  label: "Dernier échange",      visible: true  },
                { key: "followupBadge",label: "Badge relance",        visible: true  },
                { key: "actionBar",    label: "Barre d'actions",      visible: true  },
                { key: "statusTime",   label: "Temps dans l'étape",   visible: false },
                { key: "pinnedFields", label: "Infos épinglées",      visible: true  },
                { key: "lastNote",     label: "Dernière note",        visible: true  },
            ],
        },
    };

    const tpl = TEMPLATES[template] || TEMPLATES.crm;
    const colColors = {
        "Candidatures envoyées": "blue",
        "Entretien RH": "amber",
        "Entretien Technique": "violet",
        "Proposition reçue": "sky",
        "Accepté 🎉": "green",
        "Refusé": "red",
    };

    for (const n of tpl.columns) {
        const id = uid();
        columns[id] = {
            id,
            name: n,
            color: template === "jobs" ? (colColors[n] || "gray") : inferColumnColor(n),
            promptNoteOnEnter: shouldPromptNote(n),
            // Colonne Relance = rappel auto par défaut (pipeline CRM)
            autoFollowup: template === "crm" && /^relance$/i.test(n.trim()),
        };
        columnOrder.push(id);
    }

    const pipelineRoles = {};
    if (template === "crm") {
        const byName = Object.fromEntries(
            Object.values(columns).map((c) => [c.name.toLowerCase(), c.id])
        );
        pipelineRoles.nouveau = byName.nouveau || null;
        pipelineRoles.contacted = byName.contacté || byName.contacte || null;
        pipelineRoles.relance = byName.relance || null;
        pipelineRoles.rdv = byName["rendez-vous"] || byName.rdv || null;
        pipelineRoles.won = byName.gagné || byName.gagne || byName.closé || null;
        pipelineRoles.lost = byName.perdu || null;
    }

    return {
        id: uid(),
        name: name || "Sans nom",
        sector,
        template, // "crm" | "jobs"
        columns,
        columnOrder,
        leads: {},
        cardFields: tpl.cardFields,
        columnWidth: 340,
        cardScale: 1,
        panelInfoLayout: "classic", // "classic" | "rows" — style fiche prospect ouverte
        agencyDetectionEnabled: true,
        pipelineRoles,
        createdAt: new Date().toISOString(),
    };
};

// ---------- Auto follow-up helpers ----------
const DAY_MS = 24 * 60 * 60 * 1000;

function addDaysISO(days, from = null) {
    const base = from ? new Date(from).getTime() : Date.now();
    return new Date(base + days * DAY_MS).toISOString();
}

function isoToDate(iso) {
    // Returns YYYY-MM-DD in local calendar (used by <input type="date">)
    return toLocalDateKey(iso);
}

function followupLabel(stage) {
    if (stage <= 1) return "Relance auto · étape 1/3";
    if (stage === 2) return "Relance auto · étape 2/3 (sans réponse)";
    return "Relance auto · étape 3/3 (à rappeler !)";
}

function makeFollowup(columnId, stage = 1, from = null) {
    const startedAt = from || new Date().toISOString();
    const dueAt = addDaysISO(stage, startedAt);
    return {
        stage,
        dueAt,
        startedAt,
        columnId,
    };
}

// Given a followup, returns the matching nextAction (visible in UI)
function followupToNextAction(fu) {
    if (!fu) return null;
    return {
        date: isoToDate(fu.dueAt),
        dueAt: fu.dueAt,
        label: followupLabel(fu.stage),
        auto: true,
        stage: fu.stage,
    };
}

/** Ajuste nextAction / autoFollowup quand le lead change de colonne (cycle prospection). */
function resolveScheduleOnColumnMove(lead, targetColName, autoFollowup) {
    const name = targetColName || "";
    let nextAction = lead.nextAction;
    const hasManualRdv = isManualRdv(lead.nextAction);

    // Fin de cycle → tout nettoyer
    if (isWonColumn(name) || isLostColumn(name)) {
        return { nextAction: null, autoFollowup: null };
    }

    // Proposition / négociation : on retire les échéances dépassées
    if (isPropositionColumn(name) && nextAction) {
        const due = nextAction.dueAt || (nextAction.date ? `${nextAction.date}T09:00:00` : null);
        if (due && new Date(due).getTime() < Date.now()) {
            nextAction = null;
        }
    }

    // Déplacement hors RDV avec un RDV déjà dépassé → on nettoie (sinon la carte reste « RDV dépassé »)
    if (nextAction && hasManualRdv && !isMeetingColumn(name) && !isRappelColumn(name)) {
        const due = nextAction.dueAt || (nextAction.date ? `${nextAction.date}T09:00:00` : null);
        if (due && new Date(due).getTime() < Date.now() - 60000) {
            nextAction = null;
        }
    }

    if (autoFollowup && !isManualRdv(nextAction)) {
        nextAction = followupToNextAction(autoFollowup);
    } else if (!isManualRdv(nextAction) && nextAction?.auto && !autoFollowup) {
        nextAction = null;
    }

    return { nextAction, autoFollowup };
}

// ---------- Persistence ----------
const STORAGE_KEY = "crm_state_v1";
const BACKUP_KEY  = "crm_state_v1_backup";

/** Parse + migrate raw JSON string → state object, or null. */
function parsePersistedState(raw) {
    if (!raw) return null;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== "object" || !parsed.workspaces) return null;
        if (parsed.workspaces) {
            Object.keys(parsed.workspaces).forEach((id) => {
                let ws = parsed.workspaces[id];
                if (ws.columnWidth === undefined) ws.columnWidth = 340;
                if (ws.cardScale === undefined) ws.cardScale = 1;
                // Migration : ancien cardLayout "rows"|"compact" → panelInfoLayout
                if (ws.panelInfoLayout !== "rows" && ws.panelInfoLayout !== "classic") {
                    ws.panelInfoLayout = ws.cardLayout === "rows" ? "rows" : "classic";
                }
                if (ws.cardLayout !== undefined) delete ws.cardLayout;
                ws = migrateWorkspacePipeline(ws);
                parsed.workspaces[id] = ws;
            });
        }
        parsed.sidebar = ensureSidebar(parsed);
        // Settings (objectif quotidien, etc.) — migrés depuis prefs si besoin
        if (!parsed.settings || typeof parsed.settings !== "object") {
            parsed.settings = {};
        }
        if (parsed.settings.dailyGoal == null) {
            let fromPrefs = 20;
            try {
                const v = localStorage.getItem("crm_daily_goal");
                const n = parseInt(v, 10);
                if (!isNaN(n) && n >= 1) fromPrefs = n;
            } catch {}
            parsed.settings.dailyGoal = fromPrefs;
        }
        if (!parsed.theme) parsed.theme = "light";
        if (!parsed.leadPanelMode) parsed.leadPanelMode = "side";
        if (!Array.isArray(parsed.standaloneEvents)) parsed.standaloneEvents = [];
        return parsed;
    } catch {
        return null;
    }
}

function loadStateFromLocalStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = parsePersistedState(raw);
        if (parsed) return parsed;
    } catch {
        console.error("[CRM] État principal corrompu, tentative de restauration depuis le backup…");
    }
    try {
        const backup = localStorage.getItem(BACKUP_KEY);
        const parsed = parsePersistedState(backup);
        if (parsed) {
            console.warn("[CRM] Restauré depuis le backup localStorage.");
            return parsed;
        }
    } catch {}
    console.error("[CRM] Impossible de restaurer depuis localStorage.");
    return null;
}

/** Sync loader — navigateur uniquement (init useReducer). */
function loadState() {
    return loadStateFromLocalStorage();
}

/**
 * Charge l'état au boot desktop :
 * 1) fichier disque  2) backup disque  3) migration localStorage → disque
 */
async function loadStateAsync() {
    if (!isTauri()) return loadStateFromLocalStorage();

    try {
        let raw = await diskLoadState();
        let parsed = parsePersistedState(raw);
        if (parsed) {
            console.info("[CRM] État chargé depuis le disque.");
            return parsed;
        }

        raw = await diskLoadBackup();
        parsed = parsePersistedState(raw);
        if (parsed) {
            console.warn("[CRM] Restauré depuis le backup disque.");
            try {
                await diskSaveState(JSON.stringify(parsed));
            } catch {}
            return parsed;
        }

        // Première ouverture desktop : migrer l'éventuel localStorage webview
        const fromLs = loadStateFromLocalStorage();
        if (fromLs) {
            try {
                const { lastDeleted: _ld, ...persistent } = fromLs;
                await diskSaveState(JSON.stringify(persistent));
                console.info("[CRM] Migration localStorage → fichier disque OK.");
            } catch (err) {
                console.warn("[CRM] Migration disque partielle :", err);
            }
            return fromLs;
        }
        return null;
    } catch (err) {
        console.error("[CRM] Lecture disque échouée, fallback localStorage :", err);
        return loadStateFromLocalStorage();
    }
}

// Taille max autorisée en localStorage avant d'avertir l'utilisateur (4MB)
const LS_WARN_BYTES = 4 * 1024 * 1024;

function saveStateLocalStorage(state) {
    try {
        const { lastDeleted: _ld, ...persistent } = state;
        const serialized = JSON.stringify(persistent);

        if (serialized.length > LS_WARN_BYTES) {
            console.warn(
                `[CRM] État volumineux : ${(serialized.length / 1024).toFixed(0)} KB — risque de quota localStorage.`
            );
        }

        try {
            const current = localStorage.getItem(STORAGE_KEY);
            if (current) localStorage.setItem(BACKUP_KEY, current);
        } catch {}

        localStorage.setItem(STORAGE_KEY, serialized);
        return true;
    } catch (err) {
        console.error("[CRM] Impossible de sauvegarder dans localStorage :", err);
        saveBackup(state).catch(() => {});
        return false;
    }
}

/**
 * Sauvegarde principale.
 * Desktop (Tauri) → fichier disque (source de vérité) + miroir localStorage.
 * Navigateur → localStorage comme avant.
 * @returns {Promise<boolean>}
 */
async function saveState(state) {
    const { lastDeleted: _ld, ...persistent } = state;
    const serialized = JSON.stringify(persistent);

    if (isTauri()) {
        try {
            await diskSaveState(serialized);
            return true;
        } catch (err) {
            console.error("[Relia] Écriture disque échouée :", err);
            saveBackup(state).catch(() => {});
            return false;
        }
    }

    return saveStateLocalStorage(state);
}

// Référence au timer du debounce — module-level pour persister entre les appels
let _saveDebounceTimer = null;

/**
 * Debounce de saveState — appelle le callback onResult(success: boolean)
 * quand la sauvegarde réelle est effectuée.
 * @param {object} state
 * @param {(success: boolean) => void} [onResult]
 */
function saveStateDebounced(state, onResult) {
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
        _saveDebounceTimer = null;
        Promise.resolve(saveState(state)).then((ok) => onResult?.(ok));
    }, 500);
}

// ---------- Actions qui NE sont PAS undoables ----------
// (navigation, checks périodiques, thème)
const NON_UNDOABLE = new Set([
    "CHECK_FOLLOWUPS",
    "SET_THEME",
    "SET_LEAD_PANEL_MODE",
    "SET_DAILY_GOAL",
    "SELECT_WORKSPACE",
    "RESTORE_LAST_DELETED",
    "CLEAR_LAST_DELETED",
    "UNDO",
    "RESTORE_SNAPSHOT",
    "TOGGLE_SIDEBAR_FOLDER",
]);

// ---------- Undo/Redo stack — snapshots complets légers ----------
// Chaque entrée stocke { before, after } — les deux états complets (sans lastDeleted).
// Cela évite toute ambiguïté de sens dans les diffs et rend undo/redo parfaitement symétriques.
// Pour limiter la mémoire, on ne clone que les workspaces qui ont changé entre before et after
// (les workspaces inchangés sont partagés par référence).
const MAX_UNDO_STACK = 15;
const MAX_REDO_STACK = 15;

function stripTransient(state) {
    // Retire lastDeleted (buffer temporaire) du snapshot pour ne pas polluer le stack
    const { lastDeleted: _ld, ...clean } = state;
    return clean;
}

function statesAreEqual(a, b) {
    if (a === b) return true;
    if (
        a.order !== b.order ||
        a.currentId !== b.currentId ||
        a.theme !== b.theme ||
        a.sidebar !== b.sidebar ||
        a.settings?.dailyGoal !== b.settings?.dailyGoal
        || a.leadPanelMode !== b.leadPanelMode
        || a.standaloneEvents !== b.standaloneEvents
    ) {
        return false;
    }
    if (a.workspaces === b.workspaces) return true;
    const aIds = Object.keys(a.workspaces);
    const bIds = Object.keys(b.workspaces);
    if (aIds.length !== bIds.length) return false;
    return aIds.every((id) => a.workspaces[id] === b.workspaces[id]);
}

// Chaque entrée du stack = { before, after } — snapshots complets sans lastDeleted.
// Undo restaure `before`, Redo restaure `after`. Symétrique, sans ambiguïté de sens.

// ---------- Initial state ----------
const initialState = {
    workspaces: {},
    order: [],
    sidebar: { items: {}, rootOrder: [] },
    currentId: null,
    lastOpenedId: null,
    theme: "light",
    leadPanelMode: "side", // "side" | "modal"
    settings: {
        dailyGoal: 20,
    },
    /** Événements calendrier libres (sans fiche lead). */
    standaloneEvents: [],
    // undo stack for lead deletions (Gmail-style)
    lastDeleted: null, // { workspaceId, lead }
};

// ---------- Reducer ----------
function reducer(state, action) {
    switch (action.type) {
        case "SET_THEME":
            return { ...state, theme: action.theme };

        case "SET_LEAD_PANEL_MODE":
            return { ...state, leadPanelMode: action.mode };

        case "SET_DAILY_GOAL": {
            const n = Math.max(1, Math.min(999, Number(action.value) || 20));
            return {
                ...state,
                settings: { ...(state.settings || {}), dailyGoal: n },
            };
        }

        case "ADD_STANDALONE_EVENT": {
            const ev = action.event;
            if (!ev?.date && !ev?.dueAt) return state;
            const id = ev.id || uid();
            const date = ev.date || toLocalDateKey(ev.dueAt);
            const item = {
                id,
                date,
                dueAt: ev.dueAt || (date ? `${date}T09:00:00` : null),
                label: String(ev.label || "Événement").trim() || "Événement",
                type: ev.type === "rdv" ? "rdv" : "rappel",
                workspaceId: ev.workspaceId || state.currentId || null,
                createdAt: new Date().toISOString(),
            };
            return {
                ...state,
                standaloneEvents: [item, ...(state.standaloneEvents || [])],
            };
        }

        case "UPDATE_STANDALONE_EVENT": {
            const { id, patch } = action;
            if (!id || !patch) return state;
            return {
                ...state,
                standaloneEvents: (state.standaloneEvents || []).map((e) =>
                    e.id === id ? { ...e, ...patch } : e
                ),
            };
        }

        case "DELETE_STANDALONE_EVENT": {
            if (!action.id) return state;
            return {
                ...state,
                standaloneEvents: (state.standaloneEvents || []).filter((e) => e.id !== action.id),
            };
        }

        case "CREATE_WORKSPACE": {
            const ws = makeWorkspace(action.name, action.sector, action.template || "crm");
            const sidebar = ensureSidebar(state);
            const navId = navIdForWorkspace(ws.id);
            return {
                ...state,
                workspaces: { ...state.workspaces, [ws.id]: ws },
                order: [...state.order, ws.id],
                currentId: ws.id,
                lastOpenedId: ws.id,
                sidebar: {
                    items: {
                        ...sidebar.items,
                        [navId]: {
                            id: navId,
                            type: "workspace",
                            workspaceId: ws.id,
                            parentId: null,
                            icon: null,
                        },
                    },
                    rootOrder: [...sidebar.rootOrder, navId],
                },
            };
        }
        case "SELECT_WORKSPACE":
            return {
                ...state,
                currentId: action.id,
                lastOpenedId: action.id || state.lastOpenedId,
            };

        case "DELETE_WORKSPACE": {
            const { [action.id]: _removed, ...rest } = state.workspaces;
            const newOrder = state.order.filter((x) => x !== action.id);
            const next = { ...state, workspaces: rest, order: newOrder };
            return {
                ...next,
                sidebar: ensureSidebar(next),
                lastOpenedId:
                    state.lastOpenedId === action.id
                        ? (newOrder[0] || null)
                        : state.lastOpenedId,
                currentId:
                    state.currentId === action.id
                        ? newOrder[0] || null
                        : state.currentId,
            };
        }
        case "RENAME_WORKSPACE": {
            const ws = state.workspaces[action.id];
            if (!ws) return state;
            return {
                ...state,
                workspaces: {
                    ...state.workspaces,
                    [action.id]: { ...ws, name: action.name },
                },
            };
        }

        case "CREATE_SIDEBAR_FOLDER": {
            const sidebar = ensureSidebar(state);
            const id = action.id || makeFolderId();
            const name = (action.name || "Nouveau dossier").trim() || "Nouveau dossier";
            return {
                ...state,
                sidebar: {
                    items: {
                        ...sidebar.items,
                        [id]: {
                            id,
                            type: "folder",
                            name,
                            parentId: null,
                            collapsed: false,
                            icon: null,
                            childOrder: [],
                        },
                    },
                    rootOrder: [id, ...sidebar.rootOrder],
                },
            };
        }
        case "RENAME_SIDEBAR_FOLDER": {
            const sidebar = ensureSidebar(state);
            const folder = sidebar.items[action.id];
            if (!folder || folder.type !== "folder") return state;
            const name = (action.name || "").trim();
            if (!name) return state;
            return {
                ...state,
                sidebar: {
                    ...sidebar,
                    items: {
                        ...sidebar.items,
                        [action.id]: { ...folder, name },
                    },
                },
            };
        }
        case "DELETE_SIDEBAR_FOLDER": {
            const sidebar = ensureSidebar(state);
            const folder = sidebar.items[action.id];
            if (!folder || folder.type !== "folder") return state;
            const { [action.id]: _removed, ...restItems } = sidebar.items;
            // Dégrouper : remonter les enfants à la place du dossier
            const children = folder.childOrder || [];
            children.forEach((cid) => {
                if (restItems[cid]) {
                    restItems[cid] = { ...restItems[cid], parentId: null };
                }
            });
            const rootOrder = [];
            sidebar.rootOrder.forEach((id) => {
                if (id === action.id) rootOrder.push(...children);
                else rootOrder.push(id);
            });
            return {
                ...state,
                sidebar: { items: restItems, rootOrder },
            };
        }
        case "TOGGLE_SIDEBAR_FOLDER": {
            const sidebar = ensureSidebar(state);
            const folder = sidebar.items[action.id];
            if (!folder || folder.type !== "folder") return state;
            return {
                ...state,
                sidebar: {
                    ...sidebar,
                    items: {
                        ...sidebar.items,
                        [action.id]: {
                            ...folder,
                            collapsed: action.collapsed ?? !folder.collapsed,
                        },
                    },
                },
            };
        }
        case "SET_SIDEBAR_ITEM_ICON": {
            const sidebar = ensureSidebar(state);
            const item = sidebar.items[action.id];
            if (!item) return state;
            return {
                ...state,
                sidebar: {
                    ...sidebar,
                    items: {
                        ...sidebar.items,
                        [action.id]: { ...item, icon: action.icon ?? null },
                    },
                },
            };
        }
        case "REORDER_SIDEBAR_ITEM": {
            const sidebar = ensureSidebar(state);
            const next = moveSidebarItem(
                sidebar,
                action.itemId,
                action.toParentId ?? null,
                action.toIndex ?? 0,
            );
            if (next === sidebar) return state;
            return {
                ...state,
                sidebar: next,
                order: workspaceOrderFromSidebar(next),
            };
        }

        case "ADD_COLUMN": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const id = uid();
            const name = action.name || "Nouvelle colonne";
            return updateWs(state, ws.id, {
                columns: {
                    ...ws.columns,
                    [id]: { id, name, color: inferColumnColor(name) },
                },
                columnOrder: [...ws.columnOrder, id],
            });
        }
        case "RENAME_COLUMN": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const col = ws.columns[action.columnId];
            if (!col) return state;
            // Re-infer color if user hasn't set one manually (color === auto)
            const nextColor = col.colorSetByUser
                ? col.color
                : inferColumnColor(action.name);
            return updateWs(state, ws.id, {
                columns: {
                    ...ws.columns,
                    [action.columnId]: {
                        ...col,
                        name: action.name,
                        color: nextColor,
                    },
                },
            });
        }
        case "SET_COLUMN_COLOR": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const col = ws.columns[action.columnId];
            if (!col) return state;
            return updateWs(state, ws.id, {
                columns: {
                    ...ws.columns,
                    [action.columnId]: {
                        ...col,
                        color: action.color,
                        colorSetByUser: true,
                    },
                },
            });
        }
        case "DELETE_COLUMN": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const { [action.columnId]: _rm, ...remainingCols } = ws.columns;
            const newOrder = ws.columnOrder.filter((c) => c !== action.columnId);
            // Move orphan leads to first remaining column (or delete if none)
            const fallback = newOrder[0];
            const newLeads = { ...ws.leads };
            Object.values(newLeads).forEach((l) => {
                if (l.columnId === action.columnId) {
                    if (fallback) newLeads[l.id] = { ...l, columnId: fallback };
                    else delete newLeads[l.id];
                }
            });
            return updateWs(state, ws.id, {
                columns: remainingCols,
                columnOrder: newOrder,
                leads: newLeads,
            });
        }
        case "CLEAR_COLUMN": {
            // Supprime tous les leads d'une colonne, garde la colonne elle-même
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const newLeads = {};
            Object.values(ws.leads).forEach((l) => {
                if (l.columnId !== action.columnId) newLeads[l.id] = l;
            });
            const newLeadOrder = {
                ...(ws.leadOrder || {}),
                [action.columnId]: [],
            };
            return updateWs(state, ws.id, { leads: newLeads, leadOrder: newLeadOrder });
        }
        case "REORDER_COLUMNS": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            return updateWs(state, ws.id, { columnOrder: action.newOrder });
        }

        case "REORDER_LEADS": {
            // action.workspaceId, action.columnId, action.fromIndex, action.toIndex
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            // Build current order for the column if not stored yet
            const existingOrder = ws.leadOrder?.[action.columnId];
            const colLeads = Object.values(ws.leads)
                .filter((l) => l.columnId === action.columnId)
                .map((l) => l.id);
            const currentOrder = existingOrder
                ? existingOrder.filter((id) => colLeads.includes(id))
                : colLeads;
            // Add any leads not yet in the stored order (e.g. newly added)
            colLeads.forEach((id) => {
                if (!currentOrder.includes(id)) currentOrder.push(id);
            });
            const reordered = [...currentOrder];
            const [moved] = reordered.splice(action.fromIndex, 1);
            reordered.splice(action.toIndex, 0, moved);
            return updateWs(state, ws.id, {
                leadOrder: {
                    ...(ws.leadOrder || {}),
                    [action.columnId]: reordered,
                },
            });
        }

        case "MOVE_LEAD_ORDERED": {
            // Move lead across columns AND place at a specific index
            // action.workspaceId, action.leadId, action.toColumnId, action.toIndex
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const now = new Date().toISOString();
            const targetCol = ws.columns[action.toColumnId];
            const autoFollowupBase = targetCol?.autoFollowup
                ? makeFollowup(action.toColumnId, 1, now)
                : null;
            const { nextAction, autoFollowup } = resolveScheduleOnColumnMove(
                lead,
                targetCol?.name,
                autoFollowupBase
            );
            const destLeads = Object.values(ws.leads)
                .filter((l) => l.columnId === action.toColumnId && l.id !== action.leadId)
                .map((l) => l.id);
            const destOrder = (ws.leadOrder?.[action.toColumnId] || destLeads)
                .filter((id) => destLeads.includes(id));
            destLeads.forEach((id) => {
                if (!destOrder.includes(id)) destOrder.push(id);
            });
            // Contacté : plus récent en tête (prepend si pas d'index)
            const prependRecent = isContactedColumn(targetCol?.name || "");
            const insertAt = action.toIndex != null
                ? Math.min(action.toIndex, destOrder.length)
                : (prependRecent ? 0 : destOrder.length);
            const newDestOrder = [...destOrder];
            newDestOrder.splice(insertAt, 0, action.leadId);
            // Remove from source column order
            const srcOrder = (ws.leadOrder?.[lead.columnId] || [])
                .filter((id) => id !== action.leadId);
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        columnId: action.toColumnId,
                        statusHistory: [
                            ...(lead.statusHistory || []),
                            { columnId: action.toColumnId, at: now },
                        ],
                        autoFollowup,
                        nextAction,
                        // Enregistrer l'heure d'entrée si on arrive dans une colonne "contacté"
                        // et effacer le flag stale si on quitte cette colonne
                        contactedColumnEnteredAt: isContactedColumn(targetCol?.name || "")
                            ? (lead.contactedColumnEnteredAt || now) // ne pas écraser si déjà là
                            : null,
                        staleInContacted: isContactedColumn(targetCol?.name || "")
                            ? lead.staleInContacted // conserver si on reste dedans (reorder)
                            : false,               // reset en quittant
                    },
                },
                leadOrder: {
                    ...(ws.leadOrder || {}),
                    [lead.columnId]: srcOrder,
                    [action.toColumnId]: newDestOrder,
                },
            });
        }

        case "ADD_LEAD": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const id = uid();
            const columnId = action.columnId || ws.columnOrder[0];
            const now = new Date().toISOString();
            const lead = {
                id,
                columnId,
                company: action.lead.company || "Sans nom — à compléter",
                phone: action.lead.phone || "",
                website: action.lead.website || "",
                email: action.lead.email || "",
                contact: action.lead.contact || "",
                tags: action.lead.tags || [],
                notes: action.lead.notes || [],
                nextAction: action.lead.nextAction || null,
                lastContact: action.lead.lastContact || null,
                extra: action.lead.extra || {},
                customFields: action.lead.customFields || [],
                dealValue: action.lead.dealValue ?? null,
                statusHistory: [{ columnId, at: now }],
                createdAt: now,
                archived: false,
            };
            return updateWs(state, ws.id, {
                leads: { ...ws.leads, [id]: lead },
            });
        }
        case "BULK_ADD_LEADS": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const firstCol = ws.columnOrder[0];
            const newLeads = { ...ws.leads };
            const leadOrder = { ...(ws.leadOrder || {}) };

            // Collect all extra + custom fields from imported leads
            const allExtraKeys = new Set();
            const allCfKeys = new Set();
            action.leads.forEach((l) => {
                if (l.extra) {
                    Object.keys(l.extra).forEach((key) => {
                        allExtraKeys.add(`extra:${key}`);
                    });
                }
                (l.customFields || []).forEach((cf) => {
                    if (cf?.label) allCfKeys.add(`cf:${cf.label}`);
                });
            });

            // Update cardFields to include new extra/custom fields (visible by default)
            let updatedCardFields = [...(ws.cardFields || DEFAULT_CARD_FIELDS)];
            const existingFieldKeys = new Set(updatedCardFields.map((f) => f.key));

            [...allExtraKeys].forEach((extraKey) => {
                if (!existingFieldKeys.has(extraKey)) {
                    const label = extraKey.replace("extra:", "");
                    updatedCardFields.push({
                        key: extraKey,
                        label,
                        visible: true,
                    });
                    existingFieldKeys.add(extraKey);
                }
            });
            [...allCfKeys].forEach((cfKey) => {
                if (!existingFieldKeys.has(cfKey)) {
                    const label = cfKey.replace(/^cf:/, "");
                    updatedCardFields.push({
                        key: cfKey,
                        label,
                        visible: true,
                    });
                    existingFieldKeys.add(cfKey);
                }
            });

            action.leads.forEach((l) => {
                const id = uid();
                const now = new Date().toISOString();
                // Restaurer la colonne Kanban depuis le nom exporté (status)
                const resolvedCol =
                    (l._statusName && resolveColumnIdByName(ws, l._statusName)) ||
                    l.columnId ||
                    firstCol;

                const notes = (l.notes || []).map((n) => ({
                    id: n.id || uid(),
                    text: typeof n === "string" ? n : (n.text || ""),
                    at: (typeof n === "object" && n.at) || now,
                }));

                const customFields = (l.customFields || []).map((cf) => ({
                    id: cf.id || uid(),
                    label: cf.label,
                    value: cf.value ?? "",
                    ...(cf.highlight ? { highlight: true } : {}),
                    ...(cf.pinned ? { pinned: true } : {}),
                }));

                newLeads[id] = {
                    id,
                    columnId: resolvedCol,
                    company: l.company || "Sans nom — à compléter",
                    phone: l.phone || "",
                    website: l.website || "",
                    email: l.email || "",
                    contact: l.contact || "",
                    tags: Array.isArray(l.tags) ? l.tags : [],
                    notes,
                    nextAction: l.nextAction || null,
                    lastContact: l.lastContact || null,
                    extra: l.extra || {},
                    customFields,
                    dealValue: l.dealValue ?? null,
                    logoUrl: l.logoUrl || resolveLogo({
                        website: l.website,
                        email: l.email,
                        extra: l.extra || {},
                    }) || null,
                    ...(l.logoUrlManual ? { logoUrlManual: true } : {}),
                    ...(l.relances ? { relances: l.relances } : {}),
                    ...(l.autoFollowup ? { autoFollowup: l.autoFollowup } : {}),
                    statusHistory: [{ columnId: resolvedCol, at: now }],
                    createdAt: l.createdAt || now,
                    archived: !!l.archived,
                };

                // Maintenir l'ordre des cartes dans la colonne cible
                const prevOrder = leadOrder[resolvedCol];
                if (Array.isArray(prevOrder)) {
                    leadOrder[resolvedCol] = [...prevOrder, id];
                } else {
                    const existingInCol = Object.values(newLeads)
                        .filter((x) => x.columnId === resolvedCol && x.id !== id)
                        .map((x) => x.id);
                    leadOrder[resolvedCol] = [...existingInCol, id];
                }
            });

            return updateWs(state, ws.id, {
                leads: newLeads,
                cardFields: updatedCardFields,
                leadOrder,
            });
        }
        case "UPDATE_LEAD": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const patch = action.patch;
            // Recalculer le logo si website / email / extra change (sauf logo manuel)
            let logoUrl = lead.logoUrl;
            if (
                (patch.website !== undefined || patch.email !== undefined || patch.extra !== undefined) &&
                !lead.logoUrlManual
            ) {
                const merged = {
                    ...lead,
                    ...patch,
                    extra: patch.extra !== undefined ? patch.extra : lead.extra,
                };
                logoUrl = resolveLogo(merged) || null;
            }
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: { ...lead, ...patch, logoUrl },
                },
            });
        }
        case "MOVE_LEAD": {
            // Même sémantique que MOVE_LEAD_ORDERED (garde RDV + leadOrder),
            // sans index de destination explicite (append en fin de colonne).
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead || lead.columnId === action.toColumnId) return state;
            const now = new Date().toISOString();
            const targetCol = ws.columns[action.toColumnId];
            const autoFollowupBase = targetCol?.autoFollowup
                ? makeFollowup(action.toColumnId, 1, now)
                : null;
            const { nextAction, autoFollowup } = resolveScheduleOnColumnMove(
                lead,
                targetCol?.name,
                autoFollowupBase
            );
            const destLeads = Object.values(ws.leads)
                .filter((l) => l.columnId === action.toColumnId && l.id !== action.leadId)
                .map((l) => l.id);
            const destOrder = (ws.leadOrder?.[action.toColumnId] || destLeads)
                .filter((id) => destLeads.includes(id));
            destLeads.forEach((id) => {
                if (!destOrder.includes(id)) destOrder.push(id);
            });
            // Contacté : plus récent en tête
            const newDestOrder = isContactedColumn(targetCol?.name || "")
                ? [action.leadId, ...destOrder]
                : [...destOrder, action.leadId];
            const srcOrder = (ws.leadOrder?.[lead.columnId] || [])
                .filter((id) => id !== action.leadId);
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        columnId: action.toColumnId,
                        statusHistory: [
                            ...(lead.statusHistory || []),
                            { columnId: action.toColumnId, at: now },
                        ],
                        autoFollowup,
                        nextAction,
                        contactedColumnEnteredAt: isContactedColumn(targetCol?.name || "")
                            ? (lead.contactedColumnEnteredAt || now)
                            : null,
                        staleInContacted: isContactedColumn(targetCol?.name || "")
                            ? lead.staleInContacted
                            : false,
                    },
                },
                leadOrder: {
                    ...(ws.leadOrder || {}),
                    [lead.columnId]: srcOrder,
                    [action.toColumnId]: newDestOrder,
                },
            });
        }
        case "SET_COLUMN_PROMPT_NOTE": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const col = ws.columns[action.columnId];
            if (!col) return state;
            return updateWs(state, ws.id, {
                columns: {
                    ...ws.columns,
                    [action.columnId]: {
                        ...col,
                        promptNoteOnEnter: !!action.enabled,
                    },
                },
            });
        }
        case "SET_COLUMN_AUTO_FOLLOWUP": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const col = ws.columns[action.columnId];
            if (!col) return state;
            return updateWs(state, ws.id, {
                columns: {
                    ...ws.columns,
                    [action.columnId]: {
                        ...col,
                        autoFollowup: !!action.enabled,
                    },
                },
            });
        }
        case "DISMISS_FOLLOWUP": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        autoFollowup: null,
                        // Clear nextAction only if it was auto-generated
                        nextAction: lead.nextAction?.auto
                            ? null
                            : lead.nextAction,
                    },
                },
            });
        }
        case "DISMISS_INCONSISTENCY": {
            // action.fingerprint — ignore cette alerte tant que les faits (fingerprint) ne changent pas
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead || !action.fingerprint) return state;
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        dismissedInconsistencies: {
                            ...(lead.dismissedInconsistencies || {}),
                            [action.fingerprint]: new Date().toISOString(),
                        },
                    },
                },
            });
        }
        case "SET_INCONSISTENCY_CONFIG": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            return updateWs(state, ws.id, {
                inconsistencyConfig: action.config,
            });
        }
        case "SET_AGENCY_DETECTION_ENABLED": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            return updateWs(state, ws.id, {
                agencyDetectionEnabled: !!action.enabled,
            });
        }
        case "CHECK_FOLLOWUPS": {
            // Escalate any due followups + détecter les leads stales dans "Contacté".
            const now = Date.now();
            let changed = false;
            const newWorkspaces = { ...state.workspaces };
            for (const wsId of Object.keys(newWorkspaces)) {
                const ws = newWorkspaces[wsId];
                // ── Fast path : skip si aucun lead n'a d'autoFollowup NI de contactedColumnEnteredAt
                const hasAnyFollowup = Object.values(ws.leads).some(
                    (l) => l.autoFollowup || l.contactedColumnEnteredAt
                );
                if (!hasAnyFollowup) continue;

                let newLeads = ws.leads;
                let wsChanged = false;
                for (const leadId of Object.keys(ws.leads)) {
                    const l = ws.leads[leadId];

                    // ── Détection stale "Contacté" ─────────────────────────────
                    // Un lead est stale si :
                    //   1. Il a un contactedColumnEnteredAt (il est dans une colonne "contacté")
                    //   2. 3 jours ouvrés se sont écoulés depuis son entrée
                    //   3. Il n'est pas déjà marqué stale (évite les writes inutiles)
                    if (l.contactedColumnEnteredAt && !l.staleInContacted) {
                        const days = businessDaysSince(l.contactedColumnEnteredAt);
                        if (days >= STALE_BUSINESS_DAYS) {
                            if (!wsChanged) newLeads = { ...newLeads };
                            newLeads[leadId] = { ...l, staleInContacted: true };
                            wsChanged = true;
                            changed = true;
                        }
                    }

                    // ── Escalade auto-followup (logique existante) ─────────────
                    if (!l.autoFollowup) continue;
                    const dueTime = new Date(l.autoFollowup.dueAt).getTime();
                    if (dueTime > now) continue;
                    const stage = l.autoFollowup.stage;
                    // If lead was contacted after followup started, clear it.
                    const startedTime = new Date(
                        l.autoFollowup.startedAt,
                    ).getTime();
                    const contactedTime = l.lastContact
                        ? new Date(l.lastContact).getTime()
                        : 0;
                    if (contactedTime > startedTime) {
                        if (!wsChanged) newLeads = { ...newLeads };
                        newLeads[leadId] = {
                            ...newLeads[leadId],
                            autoFollowup: null,
                            nextAction: l.nextAction?.auto ? null : l.nextAction,
                        };
                        wsChanged = true;
                        changed = true;
                        continue;
                    }
                    if (stage < 3) {
                        const newFu = {
                            ...l.autoFollowup,
                            stage: stage + 1,
                            dueAt: addDaysISO(1, l.autoFollowup.dueAt),
                        };
                        if (!wsChanged) newLeads = { ...newLeads };
                        newLeads[leadId] = {
                            ...newLeads[leadId],
                            autoFollowup: newFu,
                            nextAction: followupToNextAction(newFu),
                        };
                        wsChanged = true;
                        changed = true;
                    } else {
                        if (!l.autoFollowup.overdue) {
                            const newFu = {
                                ...l.autoFollowup,
                                overdue: true,
                            };
                            if (!wsChanged) newLeads = { ...newLeads };
                            newLeads[leadId] = {
                                ...newLeads[leadId],
                                autoFollowup: newFu,
                                nextAction: {
                                    ...(l.nextAction || {}),
                                    date: isoToDate(l.autoFollowup.dueAt),
                                    dueAt: l.autoFollowup.dueAt,
                                    label: "Relance auto · en retard — à rappeler !",
                                    auto: true,
                                    stage: 3,
                                    overdue: true,
                                },
                            };
                            wsChanged = true;
                            changed = true;
                        }
                    }
                }
                if (wsChanged) newWorkspaces[wsId] = { ...ws, leads: newLeads };
            }
            if (!changed) return state;
            return { ...state, workspaces: newWorkspaces };
        }
        case "DELETE_LEAD": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const { [action.leadId]: _rm, ...restLeads } = ws.leads;
            return {
                ...updateWs(state, ws.id, { leads: restLeads }),
                lastDeleted: { workspaceId: ws.id, lead },
            };
        }
        case "RESTORE_LAST_DELETED": {
            if (!state.lastDeleted) return state;
            const { workspaceId, lead } = state.lastDeleted;
            const ws = state.workspaces[workspaceId];
            if (!ws) return { ...state, lastDeleted: null };
            return {
                ...updateWs(state, ws.id, {
                    leads: { ...ws.leads, [lead.id]: lead },
                }),
                lastDeleted: null,
            };
        }
        case "CLEAR_LAST_DELETED":
            return { ...state, lastDeleted: null };

        case "ADD_NOTE": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const note = {
                id: uid(),
                text: action.text,
                at: new Date().toISOString(),
                ...(action.recordingId ? { recordingId: action.recordingId } : {}),
                ...(action.transcript ? { transcript: action.transcript } : {}),
            };
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        notes: [note, ...(lead.notes || [])],
                        lastContact: new Date().toISOString(),
                    },
                },
            });
        }
        case "UPDATE_NOTE": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead || !action.noteId) return state;
            const patch = action.patch && typeof action.patch === "object" ? action.patch : {};
            const notes = (lead.notes || []).map((n) => (
                n.id === action.noteId ? { ...n, ...patch } : n
            ));
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: { ...lead, notes },
                },
            });
        }
        case "CLEAR_NOTE_RECORDING": {
            // Compat : retire aussi la note vocale entière (évite orphelin dans Notes)
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead || !action.recordingId) return state;
            const notes = (lead.notes || []).filter((n) => n.recordingId !== action.recordingId);
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: { ...lead, notes },
                },
            });
        }
        case "DELETE_NOTE": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const notes = (lead.notes || []).filter((n) => {
                if (action.noteId && n.id === action.noteId) return false;
                if (action.recordingId && n.recordingId === action.recordingId) return false;
                return true;
            });
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: { ...lead, notes },
                },
            });
        }
        case "LOG_CONTACT": {
            // Quick "I contacted this lead today" action
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const now = new Date().toISOString();
            const note = action.text
                ? [
                      {
                          id: uid(),
                          text: action.text,
                          at: now,
                          ...(action.recordingId ? { recordingId: action.recordingId } : {}),
                          ...(action.transcript ? { transcript: action.transcript } : {}),
                      },
                      ...(lead.notes || []),
                  ]
                : lead.notes || [];

            // Auto-move vers la colonne "Contacté" (rôle pipeline ou détection nom)
            const contactedColumnId = resolvePipelineColumnId(ws, "contacted");
            const contactedColumn = contactedColumnId ? ws.columns[contactedColumnId] : null;
            const shouldMove =
                contactedColumn && lead.columnId !== contactedColumn.id;

            let updatedLead = {
                ...lead,
                lastContact: now,
                notes: note,
                // Contact done → clear auto-followup + its auto nextAction
                autoFollowup: null,
                nextAction: lead.nextAction?.auto ? null : lead.nextAction,
            };

            let newLeadOrder = ws.leadOrder || {};

            if (shouldMove) {
                const targetCol = ws.columns[contactedColumn.id];
                const autoFollowup = targetCol?.autoFollowup
                    ? makeFollowup(contactedColumn.id, 1, now)
                    : null;
                updatedLead = {
                    ...updatedLead,
                    columnId: contactedColumn.id,
                    statusHistory: [
                        ...(lead.statusHistory || []),
                        { columnId: contactedColumn.id, at: now },
                    ],
                    autoFollowup,
                    nextAction: (autoFollowup && !isManualRdv(lead.nextAction))
                        ? followupToNextAction(autoFollowup)
                        : updatedLead.nextAction,
                    // Enregistrer l'entrée dans la colonne "Contacté"
                    contactedColumnEnteredAt: now,
                    staleInContacted: false,
                };
                // Update leadOrder: remove from source, prepend to destination
                const srcOrder = (ws.leadOrder?.[lead.columnId] || [])
                    .filter((id) => id !== action.leadId);
                const destOrder = [
                    action.leadId,
                    ...(ws.leadOrder?.[contactedColumn.id] || [])
                        .filter((id) => id !== action.leadId),
                ];
                newLeadOrder = {
                    ...newLeadOrder,
                    [lead.columnId]: srcOrder,
                    [contactedColumn.id]: destOrder,
                };
            } else if (contactedColumn && lead.columnId === contactedColumn.id) {
                // Déjà dans Contacté : remonter en tête (dernier contacté = premier)
                const destOrder = [
                    action.leadId,
                    ...(ws.leadOrder?.[contactedColumn.id] || [])
                        .filter((id) => id !== action.leadId),
                ];
                // Si leadOrder incomplet, reconstruire depuis les leads de la colonne
                const inCol = Object.values(ws.leads)
                    .filter((l) => l.columnId === contactedColumn.id && l.id !== action.leadId)
                    .map((l) => l.id);
                inCol.forEach((id) => {
                    if (!destOrder.includes(id)) destOrder.push(id);
                });
                newLeadOrder = {
                    ...newLeadOrder,
                    [contactedColumn.id]: destOrder,
                };
                updatedLead = {
                    ...updatedLead,
                    staleInContacted: false,
                };
            }

            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: updatedLead,
                },
                leadOrder: newLeadOrder,
            });
        }
        case "SET_NEXT_ACTION": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        nextAction: action.nextAction,
                    },
                },
            });
        }
        // ── LOG_RELANCE : enregistre une relance manuelle avec canal ────────────
        // action: { workspaceId, leadId, canal: string, note?: string }
        // Stocké dans lead.relances : [{ id, at, canal, note, num }]
        case "LOG_RELANCE": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const existing = lead.relances || [];
            const num = existing.length + 1;
            const now = new Date().toISOString();
            const entry = {
                id: uid(),
                at: now,
                canal: action.canal || "Téléphone",
                note: action.note || "",
                num,
            };
            const noteText = `🔁 Relance #${num} · ${action.canal || "Téléphone"}${action.note ? ` · ${action.note}` : ""}`;
            const noteEntry = { id: uid(), text: noteText, at: now };
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        relances: [...existing, entry],
                        notes: [noteEntry, ...(lead.notes || [])],
                        lastContact: now,
                    },
                },
            });
        }
        // ── DELETE_RELANCE : supprime une entrée de relance ───────────────────
        case "DELETE_RELANCE": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const filtered = (lead.relances || []).filter((r) => r.id !== action.relanceId);
            // Renuméroter
            const renumbered = filtered.map((r, i) => ({ ...r, num: i + 1 }));
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: { ...lead, relances: renumbered },
                },
            });
        }
        case "ADD_CUSTOM_FIELD": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const field = {
                id: uid(),
                label: action.label || "Champ",
                value: action.value || "",
                pinned: !!action.pinned,
                highlight: !!action.highlight,
            };
            // Si c'est un doublon de champ principal (Téléphone 2, Email 2…),
            // l'enregistrer automatiquement dans cardFields du workspace (visible par défaut)
            // et l'insérer juste après le champ parent (ex: "phone" pour "Téléphone 2")
            let updatedCardFields = ws.cardFields || DEFAULT_CARD_FIELDS;
            if (action.isMainDuplicate) {
                const cfKey = "cf:" + action.label;
                const alreadyInCf = updatedCardFields.some((f) => f.key === cfKey);
                if (!alreadyInCf) {
                    // Trouver la clé parente : le dernier champ cf: ou fixe du même type de base
                    // Ex: "Téléphone 2" → parent = "phone" ou dernier "cf:Téléphone N"
                    const baseLabel = action.label.replace(/\s*\d+$/, "").toLowerCase();
                    const PARENT_KEYS = {
                        "téléphone": "phone", "telephone": "phone",
                        "email": "email",
                        "contact": "contact", "contact rh": "contact",
                        "site web": "website", "site": "website", "lien offre": "website",
                    };
                    const parentKey = PARENT_KEYS[baseLabel] || null;
                    // Trouver l'index du dernier champ qui appartient à ce groupe (parent + doublons existants)
                    let insertAfterIdx = updatedCardFields.length - 1;
                    for (let i = updatedCardFields.length - 1; i >= 0; i--) {
                        const fk = updatedCardFields[i].key;
                        const fl = updatedCardFields[i].label?.toLowerCase() || "";
                        const isParent = parentKey && fk === parentKey;
                        const isSameGroup = fk.startsWith("cf:") && fl.startsWith(baseLabel);
                        if (isParent || isSameGroup) {
                            insertAfterIdx = i;
                            break;
                        }
                    }
                    const before = updatedCardFields.slice(0, insertAfterIdx + 1);
                    const after = updatedCardFields.slice(insertAfterIdx + 1);
                    updatedCardFields = [
                        ...before,
                        { key: cfKey, label: action.label, visible: true },
                        ...after,
                    ];
                }
            }
            return updateWs(state, ws.id, {
                cardFields: updatedCardFields,
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        customFields: [...(lead.customFields || []), field],
                    },
                },
            });
        }
        case "UPDATE_CUSTOM_FIELD": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        customFields: (lead.customFields || []).map((f) =>
                            f.id === action.fieldId ? { ...f, ...action.patch } : f,
                        ),
                    },
                },
            });
        }
        case "REMOVE_CUSTOM_FIELD": {
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            // Retrouver le label du champ supprimé pour éventuellement nettoyer cardFields
            const removedField = (lead.customFields || []).find((f) => f.id === action.fieldId);
            const updatedLead = {
                ...lead,
                customFields: (lead.customFields || []).filter((f) => f.id !== action.fieldId),
            };
            // Si c'était un doublon principal, vérifier si d'autres leads ont encore ce label
            let updatedCardFields = ws.cardFields;
            if (removedField && updatedCardFields) {
                const cfKey = "cf:" + removedField.label;
                const stillExists = Object.values(ws.leads).some(
                    (l) => l.id !== action.leadId &&
                           (l.customFields || []).some((f) => f.label === removedField.label)
                );
                if (!stillExists) {
                    updatedCardFields = updatedCardFields.filter((f) => f.key !== cfKey);
                }
            }
            return updateWs(state, ws.id, {
                cardFields: updatedCardFields,
                leads: {
                    ...ws.leads,
                    [action.leadId]: updatedLead,
                },
            });
        }
        case "SET_CARD_FIELDS": {
            // action.fields = full array of { key, label, visible }
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            return updateWs(state, ws.id, { cardFields: action.fields });
        }
        case "SET_PANEL_SECTIONS": {
            // action.panelSections = { order, hidden, collapsed } — partagé par tous les leads du workspace
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            return updateWs(state, ws.id, { panelSections: action.panelSections });
        }
        case "DELETE_EXTRA_FIELD": {
            // action.workspaceId, action.fieldKey (e.g. "extra:ville")
            // Removes the extra field from all leads and from cardFields
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const rawKey = action.fieldKey.replace(/^extra:/, "");
            // Strip from every lead's extra object
            const newLeads = {};
            Object.values(ws.leads).forEach((l) => {
                const { [rawKey]: _removed, ...restExtra } = l.extra || {};
                newLeads[l.id] = { ...l, extra: restExtra };
            });
            // Strip from cardFields
            const newCardFields = (ws.cardFields || []).filter(
                (f) => f.key !== action.fieldKey
            );
            return updateWs(state, ws.id, { leads: newLeads, cardFields: newCardFields });
        }
        case "DELETE_CF_FIELD": {
            // action.workspaceId, action.label (e.g. "Téléphone 2")
            // Supprime le champ de tous les customFields des leads + de cardFields
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const cfKey = "cf:" + action.label;
            const newLeads = {};
            Object.values(ws.leads).forEach((l) => {
                newLeads[l.id] = {
                    ...l,
                    customFields: (l.customFields || []).filter((f) => f.label !== action.label),
                };
            });
            const newCardFields = (ws.cardFields || []).filter((f) => f.key !== cfKey);
            return updateWs(state, ws.id, { leads: newLeads, cardFields: newCardFields });
        }
        case "SET_COLUMN_WIDTH": {
            // action.workspaceId, action.width (number 200-600)
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const w = Math.min(600, Math.max(200, action.width));
            return updateWs(state, ws.id, { columnWidth: w });
        }
        case "SET_CARD_SCALE": {
            // action.workspaceId, action.scale (number 0.7–1.0)
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const s = Math.min(1, Math.max(0.7, action.scale));
            return updateWs(state, ws.id, { cardScale: s });
        }
        case "SET_PANEL_INFO_LAYOUT": {
            // action.workspaceId, action.layout ("classic" | "rows")
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const layout = action.layout === "rows" ? "rows" : "classic";
            return updateWs(state, ws.id, { panelInfoLayout: layout });
        }
        case "SET_DEAL_VALUE": {
            // action.workspaceId, action.leadId, action.value (number | null)
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        dealValue: action.value,
                        dealClosedAt: action.value != null ? (lead.dealClosedAt || new Date().toISOString()) : null,
                    },
                },
            });
        }
        case "SET_LOST_REASON": {
            // action.workspaceId, action.leadId, action.reasonId, action.reasonLabel
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            const now = new Date().toISOString();
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        lostReason: action.reasonId || null,
                        lostReasonLabel: action.reasonLabel || null,
                        lostAt: now,
                        dealClosedAt: lead.dealClosedAt || now,
                    },
                },
            });
        }
        case "SET_PIPELINE_ROLES": {
            // action.workspaceId, action.pipelineRoles: partial map role → columnId|null
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const next = { ...(ws.pipelineRoles || {}) };
            for (const [role, colId] of Object.entries(action.pipelineRoles || {})) {
                if (colId == null || colId === "") next[role] = null;
                else if (ws.columns[colId]) next[role] = colId;
            }
            return updateWs(state, ws.id, { pipelineRoles: next });
        }
        case "RESET_PIPELINE_VIEW": {
            // Remet tous les leads en « Nouveau », efface rappels / RDV / followups / statut deal,
            // sans toucher aux réglages (cardFields, colonnes, pipelineRoles, largeur…).
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const nouveauId = resolvePipelineColumnId(ws, "nouveau") || ws.columnOrder?.[0];
            if (!nouveauId || !ws.columns[nouveauId]) return state;

            const now = new Date().toISOString();
            const updatedLeads = {};
            const nouveauOrder = [];

            for (const lead of Object.values(ws.leads || {})) {
                nouveauOrder.push(lead.id);
                updatedLeads[lead.id] = {
                    ...lead,
                    columnId: nouveauId,
                    nextAction: null,
                    autoFollowup: null,
                    contactedColumnEnteredAt: null,
                    staleInContacted: false,
                    dealValue: null,
                    dealClosedAt: null,
                    lostReason: null,
                    lostReasonLabel: null,
                    lostAt: null,
                    // Historique de colonnes remis à zéro (nouveau départ pipeline)
                    statusHistory: [{ columnId: nouveauId, at: now }],
                };
            }

            const leadOrder = {};
            for (const cid of ws.columnOrder || []) {
                leadOrder[cid] = cid === nouveauId ? nouveauOrder : [];
            }

            return updateWs(state, ws.id, {
                leads: updatedLeads,
                leadOrder,
            });
        }
        case "PROMOTE_EXTRA_FIELD": {
            // Crée un nouveau champ personnalisé avec le nom extraKey
            // pour TOUS les leads du workspace qui ont cette clé dans extra.
            // La valeur est copiée de extra[extraKey] vers customFields[]
            // SANS jamais écraser de données existantes.
            // action: { workspaceId, extraKey }
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;

            const updatedLeads = { ...ws.leads };
            Object.values(ws.leads).forEach((lead) => {
                const val = lead.extra?.[action.extraKey];
                if (val == null || val === "") return; // Skip si pas de valeur

                // Vérifier si un custom field avec ce label existe déjà
                const existing = (lead.customFields || []).find(
                    (cf) => cf.label.toLowerCase() === action.extraKey.toLowerCase()
                );

                if (!existing) {
                    // Créer un nouveau custom field
                    updatedLeads[lead.id] = {
                        ...lead,
                        customFields: [
                            ...(lead.customFields || []),
                            {
                                id: uid(),
                                label: action.extraKey,
                                value: val,
                                pinned: false, // Par défaut non épinglé
                            },
                        ],
                    };
                } else if (existing.value === "" || existing.value == null) {
                    // Si le champ existe mais est vide, on peut le remplir
                    updatedLeads[lead.id] = {
                        ...lead,
                        customFields: lead.customFields.map((cf) =>
                            cf.id === existing.id ? { ...cf, value: val } : cf
                        ),
                    };
                }
                // Sinon ne rien faire (ne jamais écraser une valeur existante)
            });
            return updateWs(state, ws.id, { leads: updatedLeads });
        }

        case "HIGHLIGHT_EXTRA_FIELD": {
            // Crée un customField highlight:true depuis un champ extra sur UN seul lead.
            // action: { workspaceId, leadId, extraKey, extraValue }
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const lead = ws.leads[action.leadId];
            if (!lead) return state;
            // Ne pas créer en double
            const already = (lead.customFields || []).find(
                (cf) => cf.label === action.extraKey && cf.highlight
            );
            if (already) {
                // toggle off
                return updateWs(state, ws.id, {
                    leads: {
                        ...ws.leads,
                        [action.leadId]: {
                            ...lead,
                            customFields: (lead.customFields || []).map((cf) =>
                                cf.id === already.id ? { ...cf, highlight: false } : cf
                            ),
                        },
                    },
                });
            }
            const field = {
                id: uid(),
                label: action.extraKey,
                value: action.extraValue,
                pinned: false,
                highlight: true,
                fromExtra: true, // marqueur pour savoir que c'est une donnée importée
            };
            return updateWs(state, ws.id, {
                leads: {
                    ...ws.leads,
                    [action.leadId]: {
                        ...lead,
                        customFields: [...(lead.customFields || []), field],
                    },
                },
            });
        }
        case "HIGHLIGHT_FIELD_FOR_COLUMN": {
            // Épingle/désépingle un champ (par label/clé) sur TOUS les leads du workspace.
            // - Pour les champs extra (données importées) : crée un customField highlight:true si absent.
            // - Pour les customFields déjà promus : met à jour highlight sur tous ceux ayant le même label.
            // action: { workspaceId, fieldLabel, currentHighlight }
            // currentHighlight: true → désépingle partout, false → épingle partout
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;

            const updatedLeads = { ...ws.leads };
            const newHighlight = !action.currentHighlight;

            Object.values(ws.leads).forEach((lead) => {

                const labelLower = action.fieldLabel.toLowerCase();
                const existing = (lead.customFields || []).find(
                    (cf) => cf.label.toLowerCase() === labelLower
                );

                if (existing) {
                    // Mettre à jour highlight sur le customField existant
                    updatedLeads[lead.id] = {
                        ...lead,
                        customFields: (lead.customFields || []).map((cf) =>
                            cf.label.toLowerCase() === labelLower
                                ? { ...cf, highlight: newHighlight }
                                : cf
                        ),
                    };
                } else if (newHighlight) {
                    // Pas encore de customField pour ce label → en créer un depuis extra si disponible
                    const extraVal = lead.extra?.[action.fieldLabel];
                    if (extraVal == null || extraVal === "") return;
                    updatedLeads[lead.id] = {
                        ...lead,
                        customFields: [
                            ...(lead.customFields || []),
                            {
                                id: uid(),
                                label: action.fieldLabel,
                                value: extraVal,
                                pinned: false,
                                highlight: true,
                                fromExtra: true,
                            },
                        ],
                    };
                }
            });

            return updateWs(state, ws.id, { leads: updatedLeads });
        }

        case "DELETE_LEAD_EXTRA_FIELD": {            // Supprime un champ extra sur TOUS les leads qui ont la même clé + valeur exacte.
            // action: { workspaceId, leadId, extraKey, extraValue }
            const ws = state.workspaces[action.workspaceId];
            if (!ws) return state;
            const sourceLead = ws.leads[action.leadId];
            if (!sourceLead) return state;
            const targetValue = action.extraValue; // valeur à matcher
            const newLeads = {};
            Object.values(ws.leads).forEach((l) => {
                const val = (l.extra || {})[action.extraKey];
                // Supprimer si même clé ET même valeur (ou si c'est le lead source)
                if (val !== undefined && (l.id === action.leadId || val === targetValue)) {
                    const { [action.extraKey]: _removed, ...restExtra } = l.extra || {};
                    newLeads[l.id] = { ...l, extra: restExtra };
                } else {
                    newLeads[l.id] = l;
                }
            });
            return updateWs(state, ws.id, { leads: newLeads });
        }

        case "RESTORE_SNAPSHOT": {
            // Full state restore for undo — keep lastDeleted cleared
            const restored = { ...action.snapshot, lastDeleted: null };
            return { ...restored, sidebar: ensureSidebar(restored) };
        }

        default:
            return state;
    }
}

function updateWs(state, wsId, patch) {
    return {
        ...state,
        workspaces: {
            ...state.workspaces,
            [wsId]: { ...state.workspaces[wsId], ...patch },
        },
    };
}

// ---------- Context ----------
const CrmContext = createContext(null);

export function CrmProvider({ children }) {
    const bootFromLs = !isTauri();
    const [hydrated, setHydrated] = useState(bootFromLs);
    const [dataDir, setDataDir] = useState(null);

    const [state, rawDispatch] = useReducer(reducer, initialState, (base) => {
        if (!bootFromLs) return base; // Tauri : hydrate async
        const saved = loadState();
        if (!saved) return base;
        const merged = { ...base, ...saved, lastDeleted: null };
        return { ...merged, sidebar: ensureSidebar(merged) };
    });

    // Desktop : charger le fichier disque avant d'afficher l'UI
    useEffect(() => {
        if (bootFromLs) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const dir = await diskDataDir();
                if (!cancelled && dir) setDataDir(dir);
                const saved = await loadStateAsync();
                if (cancelled) return;
                if (saved) {
                    rawDispatch({
                        type: "RESTORE_SNAPSHOT",
                        snapshot: { ...saved, lastDeleted: null },
                    });
                }
            } catch (err) {
                console.error("[CRM] Hydratation disque :", err);
            } finally {
                if (!cancelled) setHydrated(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [bootFromLs, rawDispatch]);

    // storageError : true si le dernier saveState a échoué (quota dépassé).
    // Exposé dans le contexte pour permettre l'affichage d'une alerte persistante.
    const [storageError, setStorageError] = useState(false);

    // Undo stack — diffs légers (workspaces modifiés uniquement)
    // Chaque entrée = { changedWsIds, snapshots, topLevel } produit par makeDiff()
    const undoStackRef = useRef([]); // Array<diff>
    const redoStackRef = useRef([]); // Array<diff> — forward diffs pour redo
    const stateRef = useRef(state);
    stateRef.current = state;

    // Compteur incrémenté à chaque undo/redo — les UI s'en servent pour
    // ne pas rouvrir de modals (note d'appel, etc.) sur un restore.
    const [restoreEpoch, setRestoreEpoch] = useState(0);

    // Wrapped dispatch: pousse { before, after } sur le undo stack de façon synchrone
    const dispatch = useCallback(
        (action) => {
            // Restauration complète (backup / crash) : vider l'historique pour
            // empêcher Cmd+Z de réécraser l'état restauré.
            if (action.type === "RESTORE_SNAPSHOT") {
                undoStackRef.current = [];
                redoStackRef.current = [];
            }
            const before = stateRef.current;
            const after = reducer(before, action);
            if (!NON_UNDOABLE.has(action.type)) {
                const beforeSnap = stripTransient(before);
                const afterSnap = stripTransient(after);
                if (!statesAreEqual(beforeSnap, afterSnap)) {
                    undoStackRef.current = [
                        ...undoStackRef.current.slice(-(MAX_UNDO_STACK - 1)),
                        { before: beforeSnap, after: afterSnap },
                    ];
                    redoStackRef.current = [];
                }
            }
            rawDispatch(action);
            trackCrmAction(action, before, after);
        },
        [rawDispatch],
    );

    // Undo: restaure `before`, pousse l'entrée sur le redo stack
    const undo = useCallback(() => {
        const stack = undoStackRef.current;
        if (stack.length === 0) return false;
        const entry = stack[stack.length - 1];
        undoStackRef.current = stack.slice(0, -1);
        redoStackRef.current = [
            ...redoStackRef.current.slice(-(MAX_REDO_STACK - 1)),
            entry,
        ];
        rawDispatch({ type: "RESTORE_SNAPSHOT", snapshot: entry.before });
        setRestoreEpoch((n) => n + 1);
        return true;
    }, [rawDispatch]);

    // Redo: restaure `after`, remet l'entrée sur le undo stack
    const redo = useCallback(() => {
        const stack = redoStackRef.current;
        if (stack.length === 0) return false;
        const entry = stack[stack.length - 1];
        redoStackRef.current = stack.slice(0, -1);
        undoStackRef.current = [
            ...undoStackRef.current.slice(-(MAX_UNDO_STACK - 1)),
            entry,
        ];
        rawDispatch({ type: "RESTORE_SNAPSHOT", snapshot: entry.after });
        setRestoreEpoch((n) => n + 1);
        return true;
    }, [rawDispatch]);

    // batchDispatch : groupe plusieurs actions en UNE SEULE entrée undo/redo
    const batchDispatch = useCallback(
        (actions) => {
            if (!actions || actions.length === 0) return;
            const before = stripTransient(stateRef.current);
            let intermediate = stateRef.current;
            actions.forEach((action) => {
                const prev = intermediate;
                intermediate = reducer(intermediate, action);
                trackCrmAction(action, prev, intermediate);
            });
            const after = stripTransient(intermediate);
            if (!statesAreEqual(before, after)) {
                undoStackRef.current = [
                    ...undoStackRef.current.slice(-(MAX_UNDO_STACK - 1)),
                    { before, after },
                ];
                redoStackRef.current = [];
            }
            actions.forEach((action) => rawDispatch(action));
        },
        [rawDispatch],
    );

    // Keyboard shortcut — Cmd+Z / Ctrl+Z  (undo)
    //                     Cmd+Shift+Z / Ctrl+Shift+Z  (redo)
    //                     Option/Alt+1..9  (switch workspace)
    useEffect(() => {
        const isTypingTarget = () => {
            const el = document.activeElement;
            if (!el) return false;
            const tag = el.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
            return !!el.isContentEditable;
        };

        const onKey = (e) => {
            // Option/Alt + 1..9 → ouvrir l'espace N (ordre sidebar)
            if (
                e.altKey &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.shiftKey &&
                (/^Digit[1-9]$/.test(e.code) || /^Numpad[1-9]$/.test(e.code))
            ) {
                if (isTypingTarget()) return;
                const index = Number(e.code.replace(/^(Digit|Numpad)/, "")) - 1;
                const order = workspaceOrderFromSidebar(
                    ensureSidebar(stateRef.current),
                );
                const id = order[index];
                if (!id) return;
                e.preventDefault();
                e.stopPropagation();
                if (stateRef.current.currentId !== id) {
                    dispatch({ type: "SELECT_WORKSPACE", id });
                }
                return;
            }

            const isMac = navigator.platform.toUpperCase().includes("MAC");
            const modifier = isMac ? e.metaKey : e.ctrlKey;
            if (!modifier || e.key.toLowerCase() !== "z") return;

            if (isTypingTarget()) return;

            e.preventDefault();

            if (e.shiftKey) {
                // Redo
                const didRedo = redo();
                if (didRedo) {
                    import("sonner").then(({ toast }) =>
                        toast("Action rétablie", { duration: 2000 }),
                    );
                }
            } else {
                // Undo
                const didUndo = undo();
                if (didUndo) {
                    import("sonner").then(({ toast }) =>
                        toast("Action annulée", { duration: 2000 }),
                    );
                }
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [undo, redo, dispatch]);

    // Persist — debounce 500ms. Desktop → fichier disque.
    useEffect(() => {
        if (!hydrated) return undefined;
        saveStateDebounced(state, (ok) => {
            setStorageError(!ok);
        });
    }, [state, hydrated]);

    // Flush immédiat avant fermeture — garantit que rien n'est perdu
    useEffect(() => {
        const flush = () => {
            if (_saveDebounceTimer) {
                clearTimeout(_saveDebounceTimer);
                _saveDebounceTimer = null;
            }
            void saveState(stateRef.current);
            void flushDesktopStorageNow();
            void flushUsageMemory();
            saveBackup(stateRef.current);
        };
        window.addEventListener("beforeunload", flush);
        const onVis = () => {
            if (document.visibilityState === "hidden") flush();
        };
        document.addEventListener("visibilitychange", onVis);
        // Exposé pour tests / flush manuel
        window.__reliaFlush = flush;
        return () => {
            window.removeEventListener("beforeunload", flush);
            document.removeEventListener("visibilitychange", onVis);
            delete window.__reliaFlush;
        };
    }, []);

    // Mémoire d’usage locale (apprentissage reco) — hydrate + flush lifecycle
    useEffect(() => {
        installUsageMemoryLifecycle();
    }, []);

    // Notifications Mac dès hydrate + brief quotidien 8h (recos du jour / vue)
    useEffect(() => {
        if (!hydrated) return undefined;
        const t = setTimeout(() => {
            pushDesktopFollowupNotifications(stateRef.current).catch(() => {});
        }, 2500);
        startMorningRecoScheduler(() => stateRef.current);
        return () => {
            clearTimeout(t);
            stopMorningRecoScheduler();
        };
    }, [hydrated]);

    // Backup automatique en arrière-plan — toutes les 5 minutes, silencieux
    useEffect(() => {
        // On passe une fonction qui lit toujours l'état le plus récent via stateRef
        startAutoBackup(() => stateRef.current);
        return () => stopAutoBackup();
    }, []);

    // Purge des enregistrements d'appel locaux > 90 j (sauf téléchargés)
    useEffect(() => {
        purgeExpiredCallRecordings();
    }, []);

    // Apply theme class on <html>
    useEffect(() => {
        const root = document.documentElement;
        if (state.theme === "dark") root.classList.add("dark");
        else root.classList.remove("dark");
    }, [state.theme]);

    // Periodic follow-up check — toutes les 60s + à la mise au premier plan.
    // On throttle les appels focus à 10s min pour éviter les scans répétés
    // quand l'utilisateur change d'onglet rapidement.
    useEffect(() => {
        let lastCheck = 0;
        const run = () => {
            const now = Date.now();
            if (now - lastCheck < 10_000) return;
            lastCheck = now;
            rawDispatch({ type: "CHECK_FOLLOWUPS" });
            pushDesktopFollowupNotifications(stateRef.current).catch(() => {});
        };
        run();
        const interval = setInterval(run, 60_000);
        const onFocus = () => run();
        window.addEventListener("focus", onFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    // Helpers stables (ne dépendent pas de state directement — lisent via stateRef)
    // Séparés de l'objet principal pour éviter que tout l'arbre re-render à chaque dispatch.
    const stableApi = useMemo(
        () => ({
            dispatch,
            batchDispatch,
            undo,
            redo,
            canUndo: () => undoStackRef.current.length > 0,
            canRedo: () => redoStackRef.current.length > 0,
            currentWorkspace: () =>
                stateRef.current.currentId
                    ? stateRef.current.workspaces[stateRef.current.currentId]
                    : null,
            exportBackup: () => {
                try {
                    const { lastDeleted: _ld, ...persistent } = stateRef.current;
                    const blob = new Blob([JSON.stringify(persistent, null, 2)], {
                        type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    const date = toLocalDateKey(new Date());
                    a.href = url;
                    a.download = `relia-backup-${date}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    import("sonner").then(({ toast }) =>
                        toast.success("Backup Relia exporté", { duration: 3000 })
                    );
                } catch (err) {
                    console.error("[Relia] Export échoué :", err);
                }
            },
            importBackup: (jsonString) => {
                try {
                    const parsed = JSON.parse(jsonString);
                    if (!parsed || !parsed.workspaces) throw new Error("Format invalide");

                    const {
                        state: merged,
                        addedWorkspaces,
                        addedLeads,
                        addedEvents,
                        skipped,
                    } = mergeImportedState(stateRef.current, parsed);

                    undoStackRef.current = [];
                    redoStackRef.current = [];
                    rawDispatch({ type: "RESTORE_SNAPSHOT", snapshot: merged });
                    setRestoreEpoch((n) => n + 1);
                    // Flush immédiat disque — state fusionné (pas l’import brut)
                    void saveState({ ...merged, lastDeleted: null }).then(() => {
                        // Recalcul notifs / conseils sur les nouvelles données
                        pushDesktopFollowupNotifications(merged).catch(() => {});
                    });

                    import("sonner").then(({ toast }) => {
                        if (skipped) {
                            toast.message("Rien à importer", {
                                description: "Le fichier ne contient pas de nouveaux espaces.",
                                duration: 3500,
                            });
                            return;
                        }
                        const bits = [];
                        if (addedWorkspaces) {
                            bits.push(
                                `${addedWorkspaces} espace${addedWorkspaces > 1 ? "s" : ""}`
                            );
                        }
                        if (addedLeads) {
                            bits.push(
                                `${addedLeads} lead${addedLeads > 1 ? "s" : ""}`
                            );
                        }
                        if (addedEvents) {
                            bits.push(
                                `${addedEvents} événement${addedEvents > 1 ? "s" : ""}`
                            );
                        }
                        toast.success("Import ajouté (sans écraser)", {
                            description: bits.join(" · ") || "Données fusionnées",
                            duration: 4000,
                        });
                    });
                } catch (err) {
                    console.error("[Relia] Import JSON :", err);
                    import("sonner").then(({ toast }) =>
                        toast.error("Fichier de backup invalide", { duration: 4000 })
                    );
                }
            },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [dispatch, batchDispatch, undo, redo], // rawDispatch est stable, dispatch/undo/redo aussi → ce memo ne se recrée jamais
    );

    // Objet final du contexte — state change à chaque dispatch, mais stableApi reste identique
    const api = useMemo(
        () => ({
            state,
            storageError,
            restoreEpoch,
            dataDir,
            persistence: isTauri() ? "disk" : "localStorage",
            ...stableApi,
        }),
        [state, storageError, restoreEpoch, dataDir, stableApi],
    );

    if (!hydrated) {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "system-ui, sans-serif",
                    color: "#6C727F",
                    background: "#F3F4F6",
                }}
            >
                Chargement Relia…
            </div>
        );
    }

    return <CrmContext.Provider value={api}>{children}</CrmContext.Provider>;
}

export function useCrm() {
    const ctx = useContext(CrmContext);
    if (!ctx) throw new Error("useCrm must be used within CrmProvider");
    return ctx;
}
