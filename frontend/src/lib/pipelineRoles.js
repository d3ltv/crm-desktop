/**
 * Rôles de colonnes du pipeline CRM.
 * Défauts par détection de nom ; surcharge possible via workspace.pipelineRoles.
 */

import {
    findBestNouveauColumnId,
    findBestContactedColumnId,
    findBestRappelColumnId,
    findBestMeetingColumnId,
    isWonColumn,
    isLostColumn,
} from "@/constants/columnPatterns";

/** @typedef {'nouveau'|'contacted'|'relance'|'rdv'|'won'|'lost'} PipelineRole */

export const PIPELINE_ROLE_META = {
    nouveau: {
        label: "Nouveaux",
        hint: "Leads entrants, pas encore contactés",
    },
    contacted: {
        label: "Contactés",
        hint: "Tri du plus récent au plus ancien",
    },
    relance: {
        label: "Relance",
        hint: "Pas de réponse / à recontacter (sans RDV)",
    },
    rdv: {
        label: "Rendez-vous",
        hint: "Un RDV est posé — négo / R1…",
    },
    won: {
        label: "Gagné / Closé",
        hint: "Deal vendu — demande la valeur",
    },
    lost: {
        label: "Perdu",
        hint: "Hors contexte / perdu — motif rapide",
    },
};

export const PIPELINE_ROLE_IDS = /** @type {PipelineRole[]} */ ([
    "nouveau",
    "contacted",
    "relance",
    "rdv",
    "won",
    "lost",
]);

export function normalizePipelineRoles(raw) {
    const out = {};
    for (const role of PIPELINE_ROLE_IDS) {
        const v = raw?.[role];
        out[role] = typeof v === "string" && v ? v : null;
    }
    return out;
}

function findBestWonColumnId(columnOrder, columns, excludeId = null) {
    for (const cid of columnOrder || []) {
        if (cid === excludeId) continue;
        if (isWonColumn(columns?.[cid]?.name)) return cid;
    }
    return null;
}

function findBestLostColumnId(columnOrder, columns, excludeId = null) {
    for (const cid of columnOrder || []) {
        if (cid === excludeId) continue;
        if (isLostColumn(columns?.[cid]?.name)) return cid;
    }
    return null;
}

/**
 * Résout l'id de colonne pour un rôle (override settings → détection par nom).
 * @param {{ columnOrder?: string[], columns?: object, pipelineRoles?: object }} workspace
 * @param {PipelineRole} role
 * @returns {string | null}
 */
export function resolvePipelineColumnId(workspace, role) {
    if (!workspace) return null;
    const roles = normalizePipelineRoles(workspace.pipelineRoles);
    const override = roles[role];
    if (override && workspace.columns?.[override]) return override;

    const order = workspace.columnOrder || [];
    const cols = workspace.columns || {};

    switch (role) {
        case "nouveau":
            return findBestNouveauColumnId(order, cols);
        case "contacted": {
            const nouveauId = (roles.nouveau && cols[roles.nouveau])
                ? roles.nouveau
                : findBestNouveauColumnId(order, cols);
            return findBestContactedColumnId(order, cols, nouveauId);
        }
        case "relance":
            return findBestRappelColumnId(order, cols);
        case "rdv":
            return findBestMeetingColumnId(order, cols);
        case "won":
            return findBestWonColumnId(order, cols);
        case "lost":
            return findBestLostColumnId(order, cols);
        default:
            return null;
    }
}

/**
 * Motifs de perte — QCM rapide (frustration minimale).
 */
export const DEFAULT_LOST_REASONS = [
    { id: "budget", label: "Budget / trop cher" },
    { id: "timing", label: "Pas le bon moment" },
    { id: "competitor", label: "Concurrent choisi" },
    { id: "no_need", label: "Pas de besoin / hors cible" },
    { id: "ghost", label: "Injoignable / ghost" },
    { id: "no_decision", label: "Décideur introuvable" },
    { id: "other", label: "Autre" },
];

/**
 * Migration douce des espaces CRM existants vers le pipeline
 * Nouveau → Contacté → Relance → RDV → Gagné → Perdu.
 * - Renomme « Proposition » → « Relance » s'il n'y a pas déjà Relance
 * - Place Relance avant RDV si besoin
 * - Active autoFollowup sur Relance si aucune colonne auto
 * - Remplit pipelineRoles manquants
 * @param {object} ws
 * @returns {object}
 */
export function migrateWorkspacePipeline(ws) {
    if (!ws || typeof ws !== "object") return ws;
    if (ws.template === "jobs") return ws;

    const columns = { ...(ws.columns || {}) };
    let columnOrder = [...(ws.columnOrder || [])];
    let changed = false;

    const nameOf = (id) => (columns[id]?.name || "").trim();
    const hasExactRelance = columnOrder.some((id) => /^relance$/i.test(nameOf(id)));
    const propositionId = columnOrder.find((id) =>
        /^(proposition|n[eé]gociation)$/i.test(nameOf(id))
    );

    if (propositionId && !hasExactRelance) {
        columns[propositionId] = {
            ...columns[propositionId],
            name: "Relance",
            autoFollowup: columns[propositionId].autoFollowup ?? true,
        };
        changed = true;

        const rdvId = findBestMeetingColumnId(columnOrder, columns);
        const pIdx = columnOrder.indexOf(propositionId);
        const rIdx = rdvId ? columnOrder.indexOf(rdvId) : -1;
        if (rIdx >= 0 && pIdx > rIdx) {
            columnOrder.splice(pIdx, 1);
            columnOrder.splice(rIdx, 0, propositionId);
        }
    }

    const hasAnyAuto = columnOrder.some((id) => columns[id]?.autoFollowup);
    const relanceId = columnOrder.find((id) => /^relance$/i.test(nameOf(id)))
        || findBestRappelColumnId(columnOrder, columns);
    if (relanceId && !hasAnyAuto) {
        columns[relanceId] = { ...columns[relanceId], autoFollowup: true };
        changed = true;
    }

    const roles = normalizePipelineRoles(ws.pipelineRoles);
    const filled = { ...roles };
    const assignIfEmpty = (role, id) => {
        if (!filled[role] && id && columns[id]) {
            filled[role] = id;
            changed = true;
        }
    };
    const probe = { ...ws, columns, columnOrder, pipelineRoles: filled };
    assignIfEmpty("nouveau", resolvePipelineColumnId(probe, "nouveau"));
    assignIfEmpty("contacted", resolvePipelineColumnId(probe, "contacted"));
    assignIfEmpty("relance", resolvePipelineColumnId(probe, "relance"));
    assignIfEmpty("rdv", resolvePipelineColumnId(probe, "rdv"));
    assignIfEmpty("won", resolvePipelineColumnId(probe, "won"));
    assignIfEmpty("lost", resolvePipelineColumnId(probe, "lost"));

    if (!changed && JSON.stringify(roles) === JSON.stringify(filled)) {
        return ws;
    }

    return {
        ...ws,
        columns,
        columnOrder,
        pipelineRoles: filled,
    };
}