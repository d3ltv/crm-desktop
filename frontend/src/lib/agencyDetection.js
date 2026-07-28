/**
 * Détection locale des cabinets de recrutement / agences d'intérim.
 * Matching par mots-clés uniquement — pas d'API, pas de LLM.
 * Désactivée entièrement sur la build Relia 2 (`isRelia2Export`).
 *
 * Exige un signal net (phrase métier ou 2 matches) pour limiter les faux positifs.
 */

import { isRelia2Export } from "@/lib/reliaVariant";

/** Seuil d'affichage (0–100) — un seul token faible ne suffit plus. */
export const AGENCY_SCORE_THRESHOLD = 50;

const WEIGHT_COMPANY = 40;
const WEIGHT_SECTOR = 20;

/** Phrases métier nettes (sous-chaîne après normalisation). */
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
    "agence de recrutement",
    "societe de recrutement",
    "cabinet interim",
    "staffing",
];

/** Tokens courts — ne comptent que s’il y a déjà un autre match, ou avec secteur. */
const SHORT_KEYWORDS = ["interim"];

/** Trop larges pour un match solo. */
const WEAK_SOLO = new Set(["rh", "hr"]);

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
    for (const token of [...SHORT_KEYWORDS, ...WEAK_SOLO]) {
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
    let score = Math.min(100, companyPts + sectorPts);

    const matches = [...new Set([...companyMatches, ...sectorMatches])];
    const strongCompany = companyMatches.some((m) => !WEAK_SOLO.has(m));
    const signalCount = matches.filter((m) => !WEAK_SOLO.has(m)).length
        + (WEAK_SOLO.has(matches[0]) && sectorMatches.length ? 1 : 0);

    // Un seul « RH » / « HR » sans autre signal → ignorer
    if (!strongCompany && sectorMatches.length === 0) {
        score = 0;
    } else if (signalCount < 1 && companyMatches.every((m) => WEAK_SOLO.has(m))) {
        score = 0;
    } else if (matches.length === 1 && WEAK_SOLO.has(matches[0]) && sectorMatches.length === 0) {
        score = 0;
    }

    return { score, matches, companyMatches, sectorMatches };
}

export function isAgencyDetectionEnabled(workspace) {
    if (isRelia2Export) return false;
    return workspace?.agencyDetectionEnabled !== false;
}

/**
 * @returns {{ score: number, matches: string[], label: string } | null}
 */
export function getAgencySuspicion(lead, enabled) {
    if (!enabled) return null;
    const result = scoreAgencySuspicion(lead);
    if (result.score < AGENCY_SCORE_THRESHOLD) return null;
    // Exiger au moins une phrase / interim, ou company + secteur
    const strong = result.companyMatches.some((m) => !WEAK_SOLO.has(m));
    const dual = result.companyMatches.length >= 1 && result.sectorMatches.length >= 1;
    if (!strong && !dual) return null;
    return {
        score: result.score,
        matches: result.matches,
        label: `Suspect à ${result.score}% d'être un cabinet de recrutement`,
    };
}

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
