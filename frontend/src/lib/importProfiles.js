/**
 * importProfiles.js — Profils d'import CSV intelligents
 *
 * Un profil = configuration de mapping sauvegardée :
 *   { id, name, headers, colMapping, createdAt, lastUsedAt, useCount }
 *
 * Matching automatique : quand un nouveau CSV est chargé, on calcule un score
 * de similarité avec chaque profil enregistré. Score = % de colonnes reconnues.
 * Seuil : ≥60% → profil proposé. ≥90% → profil appliqué automatiquement.
 *
 * Évolution de fichier : colonnes connues via le profil ; colonnes nouvelles
 * auto-détectées (website, email…) puis Extra en dernier recours.
 */

import { normalizeHeader, autoDetectMapping, CRM_RESERVED_HEADERS } from "./csvUtils";

const STORAGE_KEY = "crm_import_profiles_v1";

// Seuils de confiance
export const THRESHOLD_AUTO   = 0.90; // ≥90% → application automatique
export const THRESHOLD_SUGGEST = 0.60; // ≥60% → suggestion à l'utilisateur

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Charge tous les profils depuis localStorage */
export function loadProfiles() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Persiste la liste complète */
function saveProfiles(profiles) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (err) {
        console.error("[ImportProfiles] Sauvegarde impossible :", err);
    }
}

/**
 * Crée ou met à jour un profil.
 * Si id est fourni et existe → mise à jour. Sinon → création.
 * @param {{ id?: string, name: string, headers: string[], colMapping: object }} data
 * @returns {object} le profil créé/mis à jour
 */
export function saveProfile({ id, name, headers, colMapping }) {
    const profiles = loadProfiles();
    const now = new Date().toISOString();
    const uid = id || `prof_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const existing = profiles.findIndex((p) => p.id === uid);
    const profile = {
        id: uid,
        name: (name || "Profil sans nom").trim(),
        headers: headers.filter(Boolean),
        colMapping,
        createdAt: existing >= 0 ? profiles[existing].createdAt : now,
        lastUsedAt: now,
        useCount: existing >= 0 ? (profiles[existing].useCount || 0) : 0,
    };

    if (existing >= 0) {
        profiles[existing] = profile;
    } else {
        profiles.push(profile);
    }
    saveProfiles(profiles);
    return profile;
}

/** Renomme un profil existant */
export function renameProfile(id, newName) {
    const profiles = loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    profiles[idx] = { ...profiles[idx], name: newName.trim() };
    saveProfiles(profiles);
}

/** Duplique un profil (copie indépendante) */
export function duplicateProfile(id) {
    const profiles = loadProfiles();
    const src = profiles.find((p) => p.id === id);
    if (!src) return null;
    return saveProfile({
        name: `${src.name} (copie)`,
        headers: [...(src.headers || [])],
        colMapping: { ...(src.colMapping || {}) },
    });
}

/** Supprime un profil */
export function deleteProfile(id) {
    saveProfiles(loadProfiles().filter((p) => p.id !== id));
}

/** Marque un profil comme utilisé (incrémente useCount + lastUsedAt) */
export function touchProfile(id) {
    const profiles = loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    profiles[idx] = {
        ...profiles[idx],
        lastUsedAt: new Date().toISOString(),
        useCount: (profiles[idx].useCount || 0) + 1,
    };
    saveProfiles(profiles);
}

/**
 * Met à jour le mapping / headers d'un profil existant (conserve le nom).
 * @returns {object|null} profil mis à jour
 */
export function updateProfileMapping(id, { headers, colMapping }) {
    const profiles = loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const now = new Date().toISOString();
    profiles[idx] = {
        ...profiles[idx],
        headers: (headers || profiles[idx].headers || []).filter(Boolean),
        colMapping: colMapping || profiles[idx].colMapping,
        lastUsedAt: now,
    };
    saveProfiles(profiles);
    return profiles[idx];
}

/** Récupère un profil par id */
export function getProfile(id) {
    return loadProfiles().find((p) => p.id === id) || null;
}

// ── Matching ──────────────────────────────────────────────────────────────────

const normCol = normalizeHeader;

/**
 * Calcule le score de similarité entre un ensemble de headers CSV
 * et un profil enregistré.
 */
export function scoreProfile(headers, profile) {
    const incoming  = headers.filter(Boolean).map(normCol);
    const reference = (profile.headers || []).filter(Boolean).map(normCol);

    const matched = incoming.filter((h) => reference.includes(h));
    const maxLen  = Math.max(incoming.length, reference.length, 1);
    const score   = matched.length / maxLen;

    const newHeaders = headers.filter((h) => h && !reference.includes(normCol(h)));

    return { score, matchedHeaders: matched, newHeaders };
}

/**
 * Trouve le meilleur profil correspondant à un ensemble de headers CSV.
 */
export function findBestProfile(headers) {
    const profiles = loadProfiles();
    if (!profiles.length || !headers.length) return null;

    let best = null;
    let bestScore = 0;

    for (const profile of profiles) {
        const { score, matchedHeaders, newHeaders } = scoreProfile(headers, profile);
        if (score > bestScore) {
            bestScore = score;
            best = { profile, score, matchedHeaders, newHeaders };
        }
    }

    if (!best || bestScore < THRESHOLD_SUGGEST) return null;

    return {
        ...best,
        isAuto:       bestScore >= THRESHOLD_AUTO,
        isSuggested:  bestScore >= THRESHOLD_SUGGEST,
    };
}

/**
 * Applique un profil sur un ensemble de headers CSV entrants.
 * - Colonnes reconnues → mapping du profil
 * - Colonnes nouvelles → auto-détection (website, email…) puis Extra
 *
 * @param {string[]} headers
 * @param {object}   profile
 * @param {string[][]} [rows] — pour heuristiques email/téléphone
 * @returns {object} colMapping { header → target }
 */
export function applyProfile(headers, profile, rows = []) {
    const result = {};
    const refMapping = profile.colMapping || {};
    const usedTargets = new Set();

    // Passe 1 — profil sur colonnes connues
    headers.forEach((h) => {
        if (!h) return;
        const hn = normCol(h);
        const matchKey = Object.keys(refMapping).find((k) => normCol(k) === hn);
        if (!matchKey) return;
        const target = refMapping[matchKey];
        result[h] = target;
        if (target && target !== "__extra__" && target !== "__none__") {
            usedTargets.add(target);
        }
    });

    // Passe 2 — auto-détecter le reste
    const auto = autoDetectMapping(headers, rows);
    const autoByHeader = {};
    Object.entries(auto).forEach(([field, header]) => {
        if (header) autoByHeader[normCol(header)] = field;
    });

    headers.forEach((h) => {
        if (!h || result[h] !== undefined) return;

        const field = autoByHeader[normCol(h)];
        if (field && !usedTargets.has(field)) {
            result[h] = field;
            usedTargets.add(field);
            return;
        }

        const reserved = CRM_RESERVED_HEADERS.find((k) => normCol(k) === normCol(h));
        if (reserved && !usedTargets.has(reserved)) {
            result[h] = reserved;
            usedTargets.add(reserved);
            return;
        }
        if (normCol(h) === "statut" && !usedTargets.has("status")) {
            result[h] = "status";
            usedTargets.add("status");
            return;
        }

        result[h] = "__extra__";
    });

    return result;
}

// ── Helpers UI ────────────────────────────────────────────────────────────────

export function formatProfileDate(iso) {
    if (!iso) return "—";
    const d   = new Date(iso);
    const now = new Date();
    const diffMs  = now - d;
    const diffMin = Math.floor(diffMs / 60_000);
    const diffH   = Math.floor(diffMs / 3_600_000);
    const diffD   = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1)   return "à l'instant";
    if (diffMin < 60)  return `il y a ${diffMin} min`;
    if (diffH   < 24)  return `il y a ${diffH}h`;
    if (diffD   === 1) return "hier";
    if (diffD   < 7)   return `il y a ${diffD} j`;
    if (diffD   < 30)  return `il y a ${Math.floor(diffD / 7)} sem.`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

const CRM_FIELD_LABELS = {
    company: "Entreprise", contact: "Contact", phone: "Téléphone",
    email: "Email", website: "Site web",
    status: "Colonne / Statut", tags: "Tags", notes: "Notes",
    next_action: "Prochaine action", last_contact: "Dernier contact",
    deal_value: "Valeur du deal", logo_url: "Logo", crm_meta: "Métadonnées CRM",
    "__extra__": "Extra", "__none__": "Ignoré",
};

export function mappingLabel(target) {
    return CRM_FIELD_LABELS[target] || target;
}
