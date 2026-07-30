/**
 * importProfiles.js — Profils d'import CSV intelligents
 *
 * Un profil = configuration de mapping sauvegardée :
 *   { id, name, headers, colMapping, createdAt, lastUsedAt, useCount, builtin? }
 *
 * Matching : profils utilisateur + presets intégrés (Relia, LinkedIn, Apollo…).
 * Si rien ne matche → suggestion « Personnalisé » via auto-détection des headers.
 */

import { normalizeHeader, autoDetectMapping, CRM_RESERVED_HEADERS } from "./csvUtils";

const STORAGE_KEY = "crm_import_profiles_v1";

export const THRESHOLD_AUTO = 0.90;
export const THRESHOLD_SUGGEST = 0.60;

const NONE = "__none__";
const EXTRA = "__extra__";

/** Presets livrés avec Relia — non persistés, toujours proposés. */
export const BUILTIN_PROFILES = [
    {
        id: "builtin_relia_crm",
        name: "Relia CRM",
        builtin: true,
        headers: [
            "company", "contact", "phone", "email", "website",
            "status", "statut", "tags", "notes", "next_action",
            "last_contact", "deal_value", "logo_url",
        ],
        colMapping: {
            company: "company",
            contact: "contact",
            phone: "phone",
            email: "email",
            website: "website",
            status: "status",
            statut: "status",
            tags: "tags",
            notes: "notes",
            next_action: "next_action",
            last_contact: "last_contact",
            deal_value: "deal_value",
            logo_url: "logo_url",
        },
    },
    {
        id: "builtin_linkedin",
        name: "LinkedIn / Sales Navigator",
        builtin: true,
        headers: [
            "First Name", "Last Name", "Company", "Email Address",
            "Mobile Phone", "Website", "LinkedIn", "Title", "Location",
        ],
        colMapping: {
            "First Name": "contact",
            "Last Name": EXTRA,
            Company: "company",
            "Email Address": "email",
            "Mobile Phone": "phone",
            Website: "website",
            LinkedIn: EXTRA,
            Title: EXTRA,
            Location: EXTRA,
        },
    },
    {
        id: "builtin_apollo",
        name: "Apollo / prospection",
        builtin: true,
        headers: [
            "Company", "First Name", "Last Name", "Email", "Phone",
            "Mobile Phone", "Website", "LinkedIn Url", "Title", "City",
        ],
        colMapping: {
            Company: "company",
            "First Name": "contact",
            "Last Name": EXTRA,
            Email: "email",
            Phone: "phone",
            "Mobile Phone": "phone",
            Website: "website",
            "LinkedIn Url": EXTRA,
            Title: EXTRA,
            City: EXTRA,
        },
    },
    {
        id: "builtin_hubspot",
        name: "HubSpot / CRM export",
        builtin: true,
        headers: [
            "Company Name", "First Name", "Last Name", "Email",
            "Phone Number", "Website URL", "Deal Amount", "Notes",
        ],
        colMapping: {
            "Company Name": "company",
            "First Name": "contact",
            "Last Name": EXTRA,
            Email: "email",
            "Phone Number": "phone",
            "Website URL": "website",
            "Deal Amount": "deal_value",
            Notes: "notes",
        },
    },
    {
        id: "builtin_google_contacts",
        name: "Google Contacts / carnet",
        builtin: true,
        headers: [
            "Organization Name", "Given Name", "Family Name", "E-mail 1 - Value",
            "Phone 1 - Value", "Website 1 - Value",
        ],
        colMapping: {
            "Organization Name": "company",
            "Given Name": "contact",
            "Family Name": EXTRA,
            "E-mail 1 - Value": "email",
            "Phone 1 - Value": "phone",
            "Website 1 - Value": "website",
        },
    },
    {
        id: "builtin_pages_jaunes",
        name: "Pages Jaunes / annuaire FR",
        builtin: true,
        headers: [
            "Raison sociale", "Téléphone", "Email", "Site web",
            "Adresse", "Ville", "Code postal", "Activité",
        ],
        colMapping: {
            "Raison sociale": "company",
            Téléphone: "phone",
            Email: "email",
            "Site web": "website",
            Adresse: EXTRA,
            Ville: EXTRA,
            "Code postal": EXTRA,
            Activité: EXTRA,
        },
    },
];

function allProfiles() {
    return [...BUILTIN_PROFILES, ...loadProfiles()];
}

export function loadProfiles() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((p) => p && !p.builtin) : [];
    } catch {
        return [];
    }
}

function saveProfiles(profiles) {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(profiles.filter((p) => p && !p.builtin))
        );
    } catch (err) {
        console.error("[ImportProfiles] Sauvegarde impossible :", err);
    }
}

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

    if (existing >= 0) profiles[existing] = profile;
    else profiles.push(profile);
    saveProfiles(profiles);
    return profile;
}

export function renameProfile(id, newName) {
    if (String(id).startsWith("builtin_")) return;
    const profiles = loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return;
    profiles[idx] = { ...profiles[idx], name: newName.trim() };
    saveProfiles(profiles);
}

export function duplicateProfile(id) {
    const src = getProfile(id);
    if (!src) return null;
    return saveProfile({
        name: `${src.name} (copie)`,
        headers: [...(src.headers || [])],
        colMapping: { ...(src.colMapping || {}) },
    });
}

export function deleteProfile(id) {
    if (String(id).startsWith("builtin_")) return;
    saveProfiles(loadProfiles().filter((p) => p.id !== id));
}

export function touchProfile(id) {
    if (!id || String(id).startsWith("builtin_") || String(id).startsWith("suggest_")) return;
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

export function updateProfileMapping(id, { headers, colMapping }) {
    if (String(id).startsWith("builtin_")) return null;
    const profiles = loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    profiles[idx] = {
        ...profiles[idx],
        headers: (headers || profiles[idx].headers || []).filter(Boolean),
        colMapping: colMapping || profiles[idx].colMapping,
        lastUsedAt: new Date().toISOString(),
    };
    saveProfiles(profiles);
    return profiles[idx];
}

export function getProfile(id) {
    return allProfiles().find((p) => p.id === id) || null;
}

/** Liste UI : presets puis profils utilisateur. */
export function listProfilesForUi() {
    return allProfiles();
}

const normCol = normalizeHeader;

export function scoreProfile(headers, profile) {
    const incoming = headers.filter(Boolean).map(normCol);
    const reference = (profile.headers || []).filter(Boolean).map(normCol);
    if (!incoming.length || !reference.length) {
        return { score: 0, matchedHeaders: [], newHeaders: headers.filter(Boolean) };
    }

    const refSet = new Set(reference);
    const matched = incoming.filter((h) => refSet.has(h));
    // Score asymétrique : % des headers du profil retrouvés dans le CSV
    // (un export LinkedIn partiel doit quand même matcher)
    const coverage = matched.length / reference.length;
    const overlap = matched.length / Math.max(incoming.length, 1);
    const score = coverage * 0.65 + overlap * 0.35;

    const newHeaders = headers.filter((h) => h && !refSet.has(normCol(h)));
    return { score, matchedHeaders: matched, newHeaders };
}

/**
 * Construit un mapping « Personnalisé » à partir du CSV (noms + données).
 * @returns {{ profile: object, score: number, isAuto: boolean, isSuggested: boolean, isPersonalized: boolean, newHeaders: string[], colMapping: object }}
 */
export function suggestPersonalizedProfile(headers, rows = [], fileName = "") {
    const auto = autoDetectMapping(headers, rows);
    const colMapping = {};
    const used = new Set();

    Object.entries(auto).forEach(([field, header]) => {
        if (!header || used.has(header)) return;
        colMapping[header] = field;
        used.add(header);
        used.add(field);
    });

    headers.forEach((h) => {
        if (!h || colMapping[h] !== undefined) return;
        const reserved = CRM_RESERVED_HEADERS.find((k) => normCol(k) === normCol(h));
        if (reserved && ![...Object.values(colMapping)].includes(reserved)) {
            colMapping[h] = reserved;
            return;
        }
        if (normCol(h) === "statut" && ![...Object.values(colMapping)].includes("status")) {
            colMapping[h] = "status";
            return;
        }
        // Colonnes non reconnues → ignorées (choix explicite requis pour Extra)
        colMapping[h] = NONE;
    });

    const mappedCrm = Object.values(colMapping).filter(
        (v) => v && v !== NONE && v !== EXTRA
    ).length;
    const score = Math.min(0.95, 0.35 + mappedCrm * 0.12);

    const stem = String(fileName || "")
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim()
        .slice(0, 40);
    const name = stem
        ? `Personnalisé — ${stem}`
        : `Personnalisé — ${mappedCrm} champ${mappedCrm > 1 ? "s" : ""} CRM`;

    const profile = {
        id: `suggest_${Date.now().toString(36)}`,
        name,
        builtin: false,
        personalized: true,
        headers: headers.filter(Boolean),
        colMapping,
    };

    return {
        profile,
        score,
        isAuto: mappedCrm >= 3 && score >= 0.7,
        isSuggested: true,
        isPersonalized: true,
        newHeaders: [],
        colMapping,
        matchedHeaders: Object.keys(colMapping).filter(
            (h) => colMapping[h] !== NONE && colMapping[h] !== EXTRA
        ),
    };
}

export function findBestProfile(headers) {
    const profiles = allProfiles();
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
        isAuto: bestScore >= THRESHOLD_AUTO,
        isSuggested: bestScore >= THRESHOLD_SUGGEST,
        isPersonalized: false,
    };
}

/**
 * Résout le meilleur mapping à l'ouverture d'un fichier :
 * 1) profil (user / builtin) si score ≥ seuil
 * 2) sinon suggestion personnalisée (auto-detect)
 */
export function resolveImportMapping(headers, rows = [], fileName = "") {
    const match = findBestProfile(headers);
    if (match) {
        const colMapping = applyProfile(headers, match.profile, rows);
        return { ...match, colMapping };
    }
    return suggestPersonalizedProfile(headers, rows, fileName);
}

export function applyProfile(headers, profile, rows = []) {
    const result = {};
    const refMapping = profile.colMapping || {};
    const usedTargets = new Set();

    headers.forEach((h) => {
        if (!h) return;
        const hn = normCol(h);
        const matchKey = Object.keys(refMapping).find((k) => normCol(k) === hn);
        if (!matchKey) return;
        const target = refMapping[matchKey];
        result[h] = target;
        if (target && target !== EXTRA && target !== NONE) usedTargets.add(target);
    });

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

        // Non reconnue / hors profil → ignorée (pas d’import silencieux en Extra)
        result[h] = NONE;
    });

    return result;
}

export function formatProfileDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffD = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffH < 24) return `il y a ${diffH}h`;
    if (diffD === 1) return "hier";
    if (diffD < 7) return `il y a ${diffD} j`;
    if (diffD < 30) return `il y a ${Math.floor(diffD / 7)} sem.`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

const CRM_FIELD_LABELS = {
    company: "Entreprise", contact: "Contact", phone: "Téléphone",
    email: "Email", website: "Site web",
    status: "Colonne / Statut", tags: "Tags", notes: "Notes",
    next_action: "Prochaine action", last_contact: "Dernier contact",
    deal_value: "Valeur du deal", logo_url: "Logo", crm_meta: "Métadonnées CRM",
    "__extra__": "Champ custom", "__none__": "Ignoré",
};

export function mappingLabel(target) {
    return CRM_FIELD_LABELS[target] || target;
}
