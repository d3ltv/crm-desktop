/**
 * Identité du propriétaire Relia — à exclure des détections
 * (transcripts / notes : ne jamais se proposer soi-même comme contact).
 */

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

const OWNER_PHONES = new Set(
    ["0686018054", "686018054", "+33686018054"].map(digitsOnly).filter(Boolean)
);

const OWNER_EMAILS = new Set(
    ["charly@m-players.fr"].map(normalizeEmail)
);

/** Formes de nom à ignorer (après normalisation sans titre). */
const OWNER_NAME_KEYS = new Set(
    [
        "charly",
        "silva",
        "durand",
        "durand silva",
        "charly silva",
        "charly durand",
        "charly durand silva",
        "mr silva",
        "m silva",
        "monsieur silva",
    ].map(ownerPersonKey).filter(Boolean)
);

const OWNER_NAME_TOKENS = new Set(["charly", "durand", "silva"]);

export function isOwnerPhone(value) {
    const d = digitsOnly(value);
    if (!d) return false;
    if (OWNER_PHONES.has(d)) return true;
    // +33 / 0033 → 0…
    if (d.startsWith("33") && OWNER_PHONES.has(`0${d.slice(2)}`)) return true;
    if (d.length === 9 && OWNER_PHONES.has(`0${d}`)) return true;
    return false;
}

export function isOwnerEmail(value) {
    return OWNER_EMAILS.has(normalizeEmail(value));
}

/**
 * True si le nom détecté est clairement le propriétaire
 * (Charly, Charly Durand Silva, M. Silva, etc.).
 */
export function isOwnerPerson(value) {
    const key = ownerPersonKey(value);
    if (!key) return false;
    if (OWNER_NAME_KEYS.has(key)) return true;
    const tokens = key.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    // Contient le prénom propriétaire
    if (tokens.includes("charly")) return true;
    // Tous les tokens appartiennent à l'identité (ex. « Durand Silva », « Silva »)
    if (tokens.every((t) => OWNER_NAME_TOKENS.has(t))) return true;
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
