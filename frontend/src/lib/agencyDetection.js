/**
 * Détection locale des cabinets de recrutement / agences d'intérim.
 * Matching par mots-clés uniquement — pas d'API, pas de LLM.
 */

/** Seuil d'affichage du signal (0–100). */
export const AGENCY_SCORE_THRESHOLD = 30;

/** Points par mot-clé trouvé dans le nom d'entreprise. */
const WEIGHT_COMPANY = 40;

/** Points par mot-clé trouvé dans un champ extra « secteur-like ». */
const WEIGHT_SECTOR = 20;

/**
 * Expressions multi-mots (sous-chaîne après normalisation).
 * Les accents sont déjà stripés au matching.
 */
const PHRASE_KEYWORDS = [
    "ressources humaines",
    "chasseur de tetes",
    "chasseurs de tetes",
    "executive search",
    "conseil rh",
    "cabinet rh",
    "agence d interim",
    "agence interim",
    "cabinet de recrutement",
    "cabinet recrutement",
    "recrutement",
    "interim",
    "staffing",
    "talents",
    "carrieres",
];

/** Tokens courts — matching avec limites de mot uniquement. */
const SHORT_KEYWORDS = ["rh", "hr"];

/** Clés extra considérées comme secteur / description. */
const SECTOR_KEY_RE =
    /secteur|industrie|activite|description|naf|ape|metier|domaine|branche|categorie/i;

function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/['’]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatches(text) {
    const norm = normalize(text);
    if (!norm) return [];
    const found = [];
    for (const phrase of PHRASE_KEYWORDS) {
        if (norm.includes(phrase)) found.push(phrase);
    }
    for (const token of SHORT_KEYWORDS) {
        // Évite le double comptage si un phrase match couvre déjà le token
        if (found.some((p) => p === token || p.includes(` ${token}`) || p.includes(`${token} `) || p.startsWith(`${token} `) || p.endsWith(` ${token}`))) {
            continue;
        }
        const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:[^a-z0-9]|$)`);
        if (re.test(norm)) found.push(token);
    }
    return found;
}

function collectSectorTexts(extra = {}) {
    const texts = [];
    for (const [key, value] of Object.entries(extra)) {
        if (value == null || value === "") continue;
        if (!SECTOR_KEY_RE.test(key)) continue;
        texts.push(String(value));
    }
    return texts;
}

/**
 * @param {object} lead
 * @returns {{ score: number, matches: string[], companyMatches: string[], sectorMatches: string[] }}
 */
export function scoreAgencySuspicion(lead) {
    const companyMatches = findMatches(lead?.company);
    const sectorMatches = [];
    for (const text of collectSectorTexts(lead?.extra)) {
        for (const m of findMatches(text)) {
            if (!sectorMatches.includes(m)) sectorMatches.push(m);
        }
    }

    const companyPts = companyMatches.length * WEIGHT_COMPANY;
    const sectorPts = sectorMatches.length * WEIGHT_SECTOR;
    const score = Math.min(100, companyPts + sectorPts);

    const matches = [...new Set([...companyMatches, ...sectorMatches])];
    return { score, matches, companyMatches, sectorMatches };
}

/** Défaut ON : undefined / null → activé. */
export function isAgencyDetectionEnabled(workspace) {
    return workspace?.agencyDetectionEnabled !== false;
}

/**
 * @returns {{ score: number, matches: string[], label: string } | null}
 */
export function getAgencySuspicion(lead, enabled) {
    if (!enabled) return null;
    const result = scoreAgencySuspicion(lead);
    if (result.score < AGENCY_SCORE_THRESHOLD) return null;
    return {
        score: result.score,
        matches: result.matches,
        label: `Suspect à ${result.score}% d'être un cabinet de recrutement`,
    };
}

/**
 * Filtre live « cabinet » / « suspect cabinet » — null si le terme n’est pas un filtre agency.
 * @returns {boolean|null}
 */
export function matchAgencyFilterTerm(term, lead, enabled) {
    const t = String(term || "")
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    if (!t) return null;
    const isAgencyFilter =
        t === "cabinet"
        || t === "cabinets"
        || t === "suspect cabinet"
        || t === "suspect cabinets"
        || t === "cabinet suspect";
    if (!isAgencyFilter) return null;
    return !!getAgencySuspicion(lead, enabled);
}
