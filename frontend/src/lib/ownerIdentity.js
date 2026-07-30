/**
 * Identité du propriétaire Relia — à exclure des suggestions
 * (« données pertinentes à ajouter »), pas de la transcription.
 * Stockée dans les prefs (crm_prefs via shim localStorage).
 */

import { flushDesktopStorageNow } from "@/lib/desktopLocalStorage";

export const OWNER_IDENTITY_KEY = "crm_owner_identity";

function digitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
}

function normalizeEmail(s) {
    return String(s || "").trim().toLowerCase();
}

/** Même clé que personNameKey (sans titres). */
export function ownerPersonKey(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\b(?:m|mr|mister|monsieur|mme|madame|mlle|mademoiselle)\.?\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * @typedef {{ phone: string, email: string, firstName: string, lastName: string, setupDone: boolean }} OwnerIdentity
 */

/** @returns {OwnerIdentity} */
export function emptyOwnerIdentity() {
    return {
        phone: "",
        email: "",
        firstName: "",
        lastName: "",
        setupDone: false,
    };
}

function normalizeIdentity(raw) {
    const base = emptyOwnerIdentity();
    if (!raw || typeof raw !== "object") return base;
    return {
        phone: String(raw.phone || "").trim(),
        email: String(raw.email || "").trim(),
        firstName: String(raw.firstName || "").trim(),
        lastName: String(raw.lastName || "").trim(),
        setupDone: !!raw.setupDone,
    };
}

/** @returns {OwnerIdentity} */
export function getOwnerIdentity() {
    try {
        const raw = localStorage.getItem(OWNER_IDENTITY_KEY);
        if (raw) return normalizeIdentity(JSON.parse(raw));
    } catch { /* ignore */ }
    return emptyOwnerIdentity();
}

export function isOwnerIdentitySetupDone() {
    return getOwnerIdentity().setupDone === true;
}

/**
 * @param {Partial<OwnerIdentity>} patch
 * @param {{ markSetupDone?: boolean }} [opts]
 * @returns {Promise<OwnerIdentity>}
 */
export async function saveOwnerIdentity(patch, opts = {}) {
    const prev = getOwnerIdentity();
    const next = normalizeIdentity({
        ...prev,
        ...patch,
        setupDone: opts.markSetupDone === false ? prev.setupDone : true,
    });
    try {
        localStorage.setItem(OWNER_IDENTITY_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    try {
        await flushDesktopStorageNow();
    } catch { /* ignore */ }
    return next;
}

/** Variantes de numéros à matcher (06…, 336…, etc.). */
function phoneVariants(phone) {
    const d = digitsOnly(phone);
    if (!d) return [];
    const out = new Set([d]);
    if (d.startsWith("33") && d.length >= 11) out.add(`0${d.slice(2)}`);
    if (d.startsWith("0") && d.length >= 10) out.add(`33${d.slice(1)}`);
    if (d.length === 9) out.add(`0${d}`);
    return [...out];
}

function buildNameIndex(identity) {
    const keys = new Set();
    const tokens = new Set();
    const first = ownerPersonKey(identity.firstName);
    const last = ownerPersonKey(identity.lastName);
    if (first) {
        keys.add(first);
        first.split(/\s+/).filter((t) => t.length >= 2).forEach((t) => tokens.add(t));
    }
    if (last) {
        keys.add(last);
        last.split(/\s+/).filter((t) => t.length >= 2).forEach((t) => tokens.add(t));
    }
    if (first && last) {
        keys.add(`${first} ${last}`);
        keys.add(`${last} ${first}`);
    }
    return { keys, tokens, first };
}

function getRuntimeIndex() {
    const id = getOwnerIdentity();
    return {
        phones: new Set(phoneVariants(id.phone)),
        emails: new Set(id.email ? [normalizeEmail(id.email)] : []),
        names: buildNameIndex(id),
    };
}

export function isOwnerPhone(value) {
    const d = digitsOnly(value);
    if (!d) return false;
    const { phones } = getRuntimeIndex();
    if (!phones.size) return false;
    if (phones.has(d)) return true;
    if (d.startsWith("33") && phones.has(`0${d.slice(2)}`)) return true;
    if (d.length === 9 && phones.has(`0${d}`)) return true;
    return false;
}

export function isOwnerEmail(value) {
    const { emails } = getRuntimeIndex();
    if (!emails.size) return false;
    return emails.has(normalizeEmail(value));
}

/**
 * True si le nom détecté est clairement le propriétaire.
 */
export function isOwnerPerson(value) {
    const { names } = getRuntimeIndex();
    const key = ownerPersonKey(value);
    if (!key || (!names.keys.size && !names.tokens.size)) return false;
    if (names.keys.has(key)) return true;
    const parts = key.split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    // Contient le prénom (si assez distinctif)
    if (names.first && names.first.length >= 3 && parts.includes(names.first)) return true;
    // Tous les tokens appartiennent à l'identité (ex. « Durand Silva »)
    if (names.tokens.size && parts.every((t) => names.tokens.has(t))) return true;
    return false;
}

/** Filtre le résultat de parseNote / listes détectées. */
export function stripOwnerIdentity(detected) {
    if (!detected || typeof detected !== "object") {
        return { phones: [], emails: [], addresses: [], persons: [] };
    }
    return {
        ...detected,
        phones: (detected.phones || []).filter((p) => !isOwnerPhone(p)),
        emails: (detected.emails || []).filter((e) => !isOwnerEmail(e)),
        persons: (detected.persons || []).filter((p) => !isOwnerPerson(p)),
        addresses: detected.addresses || [],
    };
}
