/**
 * Libellés de doublons de champs principaux (Contact 2, Téléphone 3…).
 */

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True si le label est un champ principal ou un doublon numéroté
 * (Contact, Contact 2, Téléphone 3…).
 */
export function isMainFieldDuplicateLabel(label, bases = ["téléphone", "telephone", "email", "contact", "contact rh", "site web", "site", "lien offre"]) {
    const normalized = (label || "").toLowerCase().trim();
    if (!normalized) return false;
    return bases.some((base) => {
        if (normalized === base) return true;
        return new RegExp(`^${escapeRegExp(base)}\\s*\\d+$`).test(normalized);
    });
}

/**
 * Alloue N libellés libres « Base 2 », « Base 3 »… en évitant les collisions.
 * @param {Array<{ label?: string }>} customFields
 * @param {string} baseLabel ex. "Contact"
 * @param {number} count
 * @returns {string[]}
 */
export function allocateMainDupeLabels(customFields, baseLabel, count = 1) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n === 0) return [];
    const base = (baseLabel || "").toLowerCase().trim();
    const used = new Set();
    for (const f of customFields || []) {
        const label = (f.label || "").toLowerCase().trim();
        if (!label) continue;
        if (label === base) {
            // Ancien format sans numéro → compte comme un doublon déjà pris
            used.add(2);
            continue;
        }
        const m = label.match(new RegExp(`^${escapeRegExp(base)}\\s*(\\d+)$`));
        if (m) used.add(Number(m[1]));
    }
    const out = [];
    let num = 2;
    while (out.length < n) {
        if (!used.has(num)) {
            out.push(`${baseLabel} ${num}`);
            used.add(num);
        }
        num += 1;
    }
    return out;
}

/** Prochain libellé unique « Base N ». */
export function nextMainDupeLabel(customFields, baseLabel) {
    return allocateMainDupeLabels(customFields, baseLabel, 1)[0] || `${baseLabel} 2`;
}
