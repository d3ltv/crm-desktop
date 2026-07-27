/**
 * columnPatterns.js — Source unique de vérité pour la détection des types de colonnes
 *
 * Ces patterns sont utilisés partout dans l'application (contexte, composants, stats)
 * pour identifier le rôle d'une colonne par son nom.
 *
 * Règle : toute modification de ces patterns se fait ICI uniquement.
 * Ne pas redéfinir ces listes dans d'autres fichiers.
 */

// ── Colonnes "Nouveau" — prospects entrants, pas encore contactés ─────────────
export const NOUVEAU_PATTERNS = [
    "nouveau",
    "new",
    "prospect",
    "entrant",
    "candidature",
    "à contacter",
    "a contacter",
];

// ── Colonnes "Contacté" — lead contacté, en attente de réponse ───────────────
export const CONTACTED_PATTERNS = [
    "contact",
    "appel",
    "call",
];

// Sous-chaînes "contact" qui NE sont PAS des colonnes contactées
const CONTACTED_EXCLUSIONS = [
    /à\s*contacter/,
    /a\s*contacter/,
    /non\s*contact/,
    /pas\s*contact/,
    /not\s*contacted/,
    /to\s*contact/,
    /recontact/,
];

// ── Colonnes "À rappeler" — rappel / callback planifié ───────────────────────
export const RAPPEL_PATTERNS = [
    "à rappeler",
    "a rappeler",
    "rappeler",
    "rappel",
    "callback",
    "call back",
    "à relancer",
    "a relancer",
];

// « Relance » seule = souvent colonne auto-followup, score plus bas
export const RELANCE_PATTERNS = ["relance"];

// ── Colonnes "Rendez-vous" — RDV planifié ────────────────────────────────────
export const MEETING_PATTERNS = [
    "rendez-vous",
    "rendez vous",
    "rdv",
    "meeting",
    "appointment",
];

// ── Colonnes proposition / négociation ───────────────────────────────────────
export const PROPOSITION_PATTERNS = [
    "proposition",
    "devis",
    "offre",
    "négociation",
    "negociation",
    "r1",
    "r2",
    "r3",
];

// ── Colonnes "Gagné" — deal signé / offre acceptée ───────────────────────────
export const WON_PATTERNS = [
    "gagné",
    "gagne",
    "won",
    "signé",
    "signe",
    "closed won",
    "accepté",
    "accepte",
    "closé",
    "close",
    "closed",
    "vendu",
];

// ── Colonnes "Perdu" — deal perdu / candidature refusée ──────────────────────
export const LOST_PATTERNS = [
    "perdu",
    "lost",
    "closed lost",
    "abandon",
    "refusé",
    "refuse",
    "hors contexte",
    "hors cible",
    "disqualifi",
];

// ── Helpers — retournent true/false pour un nom de colonne donné ─────────────

/** @param {string} name */
export function isNouveauColumn(name = "") {
    const n = name.toLowerCase().trim();
    return NOUVEAU_PATTERNS.some((p) => n.includes(p));
}

/** @param {string} name */
export function isContactedColumn(name = "") {
    const n = name.toLowerCase().trim();
    if (!n) return false;
    // Faux positifs : « À contacter », « Non contacté », etc.
    if (CONTACTED_EXCLUSIONS.some((re) => re.test(n))) return false;
    // « À rappeler » / rappel n'est pas « Contacté »
    if (isRappelColumn(n)) return false;
    return CONTACTED_PATTERNS.some((p) => n.includes(p));
}

/** @param {string} name */
export function isRappelColumn(name = "") {
    const n = name.toLowerCase().trim();
    if (!n) return false;
    if (RAPPEL_PATTERNS.some((p) => n.includes(p))) return true;
    // « Relance » seule (sans « auto ») compte comme rappel/callback
    if (RELANCE_PATTERNS.some((p) => n.includes(p)) && !n.includes("auto")) return true;
    return false;
}

/** @param {string} name */
export function isMeetingColumn(name = "") {
    const n = name.toLowerCase().trim();
    return MEETING_PATTERNS.some((p) => n.includes(p));
}

/** @param {string} name */
export function isPropositionColumn(name = "") {
    const n = name.toLowerCase().trim();
    if (!n) return false;
    if (/^r[123]$/i.test(n)) return true;
    return PROPOSITION_PATTERNS.some((p) => n.includes(p));
}

/** @param {string} name */
export function isWonColumn(name = "") {
    const n = name.toLowerCase().trim();
    return WON_PATTERNS.some((p) => n.includes(p));
}

/** @param {string} name */
export function isLostColumn(name = "") {
    const n = name.toLowerCase().trim();
    return LOST_PATTERNS.some((p) => n.includes(p));
}

/**
 * Accepte un objet colonne { name: string } ou null/undefined.
 * Même signature que les fonctions locales des composants.
 * @param {{ name: string } | null | undefined} col
 */
export function isWonCol(col) {
    if (!col) return false;
    return isWonColumn(col.name);
}

export function isNouveauCol(col) {
    if (!col) return false;
    return isNouveauColumn(col.name);
}

export function isContactedCol(col) {
    if (!col) return false;
    return isContactedColumn(col.name);
}

export function isMeetingCol(col) {
    if (!col) return false;
    return isMeetingColumn(col.name);
}

export function isRappelCol(col) {
    if (!col) return false;
    return isRappelColumn(col.name);
}

export function isPropositionCol(col) {
    if (!col) return false;
    return isPropositionColumn(col.name);
}

export function isLostCol(col) {
    if (!col) return false;
    return isLostColumn(col.name);
}

// ── Scoring pour le mode traitement rapide ───────────────────────────────────
// Évite les faux positifs (ex. « Relance » auto-followup prise pour « Contacté »,
// ou fallback silencieux sur la 1ʳᵉ colonne du board).

/**
 * Score d'une colonne comme cible « Nouveau ». -1 = pas candidate.
 * @param {string} name
 */
export function scoreNouveauColumn(name = "") {
    const n = name.toLowerCase().trim();
    if (!n) return -1;
    // Exact / quasi-exact
    if (["nouveau", "nouveaux", "new"].includes(n)) return 100;
    if (["prospect", "prospects"].includes(n)) return 90;
    if (["candidature", "candidatures"].includes(n)) return 90;
    if (["entrant", "entrants"].includes(n)) return 85;
    if (/à\s*contacter|a\s*contacter/.test(n)) return 88;
    if (!isNouveauColumn(n)) return -1;
    // Éviter les noms qui sont clairement une colonne contacté (déjà exclus par isNouveau si « à contacter »)
    if (/contact[ée]s?/.test(n) || n.includes("contacted")) return -1;
    return 50;
}

/**
 * Score d'une colonne comme cible « Contacté ». -1 = pas candidate.
 * Dépriorise fortement les colonnes rappel auto (« Relance »).
 * @param {string} name
 * @param {{ isAutoFollowup?: boolean }} [opts]
 */
export function scoreContactedColumn(name = "", { isAutoFollowup = false } = {}) {
    const n = name.toLowerCase().trim();
    if (!n) return -1;

    // Matches forts
    if (["contacté", "contacte", "contactés", "contactes", "contacted"].includes(n)) return 100;
    if (n === "contact") return 95;
    if (/contact[ée]s?/.test(n)) return 90;
    if (n.includes("contact") && !isNouveauColumn(n)) return 70;

    // « Relance » / rappel — ce n'est plus « Contacté »
    if (isRappelColumn(n)) return -1;

    // « Appel » — moyen
    if (["appel", "appels"].includes(n) || /appel[ée]/.test(n)) return 60;
    if (n.includes("call")) return 55;

    if (!isContactedColumn(n)) return -1;
    if (isAutoFollowup) return 12;
    return 35;
}

/**
 * Score colonne « À rappeler ».
 * @param {string} name
 */
export function scoreRappelColumn(name = "") {
    const n = name.toLowerCase().trim();
    if (!n) return -1;
    if (/à\s*rappeler|a\s*rappeler/.test(n)) return 100;
    if (n === "relance" || n === "relances") return 98;
    if (n === "rappel" || n === "rappels") return 95;
    if (n.includes("callback")) return 90;
    if (/à\s*relancer|a\s*relancer/.test(n)) return 88;
    if (n.includes("rappel")) return 80;
    if (n.includes("relance") && !n.includes("auto")) return 85;
    if (!isRappelColumn(n)) return -1;
    return 40;
}

/**
 * Score colonne RDV.
 * @param {string} name
 */
export function scoreMeetingColumn(name = "") {
    const n = name.toLowerCase().trim();
    if (!n) return -1;
    if (["rdv", "rendez-vous", "rendez vous", "meeting"].includes(n)) return 100;
    if (!isMeetingColumn(n)) return -1;
    return 70;
}

/**
 * Meilleure colonne « Nouveau » pour le mode rapide, ou null.
 * Pas de fallback sur la 1ʳᵉ colonne du board.
 * @param {string[]} columnOrder
 * @param {Record<string, { name?: string }>} columns
 */
export function findBestNouveauColumnId(columnOrder, columns) {
    let bestId = null;
    let bestScore = -1;
    for (const cid of columnOrder) {
        const score = scoreNouveauColumn(columns[cid]?.name);
        if (score > bestScore) {
            bestScore = score;
            bestId = cid;
        }
    }
    return bestScore >= 0 ? bestId : null;
}

/**
 * Meilleure colonne « Contacté » pour le mode rapide, ou null.
 * Exclut la colonne Nouveau si elle était aussi matchée par erreur.
 * @param {string[]} columnOrder
 * @param {Record<string, { name?: string, autoFollowup?: boolean }>} columns
 * @param {string | null} [excludeId]
 */
export function findBestContactedColumnId(columnOrder, columns, excludeId = null) {
    let bestId = null;
    let bestScore = -1;
    for (const cid of columnOrder) {
        if (cid === excludeId) continue;
        const col = columns[cid];
        const score = scoreContactedColumn(col?.name, { isAutoFollowup: !!col?.autoFollowup });
        if (score > bestScore) {
            bestScore = score;
            bestId = cid;
        }
    }
    return bestScore >= 0 ? bestId : null;
}

export function findBestRappelColumnId(columnOrder, columns, excludeId = null) {
    let bestId = null;
    let bestScore = -1;
    for (const cid of columnOrder) {
        if (cid === excludeId) continue;
        const score = scoreRappelColumn(columns[cid]?.name);
        if (score > bestScore) {
            bestScore = score;
            bestId = cid;
        }
    }
    return bestScore >= 0 ? bestId : null;
}

export function findBestMeetingColumnId(columnOrder, columns, excludeId = null) {
    let bestId = null;
    let bestScore = -1;
    for (const cid of columnOrder) {
        if (cid === excludeId) continue;
        const score = scoreMeetingColumn(columns[cid]?.name);
        if (score > bestScore) {
            bestScore = score;
            bestId = cid;
        }
    }
    return bestScore >= 0 ? bestId : null;
}

/**
 * Colonnes « début de cycle » où un rappel/RDV peut faire avancer le lead.
 */
export function isEarlyPipelineColumn(name = "") {
    return isNouveauColumn(name) || isContactedColumn(name) || isRappelColumn(name);
}
