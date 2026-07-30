/**
 * Helpers & event names for Relia keyboard shortcuts.
 */

export const RELIA_EVENTS = {
    FOCUS_SEARCH: "relia:focus-search",
    TOGGLE_SEARCH: "relia:toggle-search",
    OPEN_CALENDAR: "relia:open-calendar",
    TOGGLE_QUICK_MODE: "relia:toggle-quick-mode",
    TOGGLE_FREE_CALL: "relia:toggle-free-call",
    FOCUS_NEW_NOTE: "relia:focus-new-note",
    OPEN_RELANCE: "relia:open-relance",
    SCROLL_COLUMN: "relia:scroll-column",
    /** Empêche CallNoteModal (Joint/NRP) après un log déjà fait (relance email, contact…). */
    SUPPRESS_CALL_NOTE: "relia:suppress-call-note",
};

/** Si le board n’est pas encore monté, le prochain listener consomme ce flag. */
let pendingQuickModeToggle = false;

export function requestQuickModeToggle() {
    pendingQuickModeToggle = true;
    dispatchRelia(RELIA_EVENTS.TOGGLE_QUICK_MODE);
}

/** @returns {boolean} true si un toggle était en attente (à consommer une fois). */
export function consumePendingQuickModeToggle() {
    if (!pendingQuickModeToggle) return false;
    pendingQuickModeToggle = false;
    return true;
}

export function isTypingTarget(el = typeof document !== "undefined" ? document.activeElement : null) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return !!el.isContentEditable;
}

/** Champ recherche workspace — ⌘F/⌘K doivent pouvoir le fermer même focusé. */
export function isWorkspaceSearchInput(el = typeof document !== "undefined" ? document.activeElement : null) {
    if (!el) return false;
    return el.getAttribute?.("data-testid") === "workspace-search-input";
}

export function isMacPlatform() {
    if (typeof navigator === "undefined") return true;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
}

export function dispatchRelia(name, detail) {
    try {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {
        /* ignore */
    }
}

/** À appeler juste avant LOG_RELANCE / LOG_CONTACT pour ne pas ouvrir Joint/NRP. */
export function suppressCallNoteModal(leadId) {
    if (!leadId) return;
    dispatchRelia(RELIA_EVENTS.SUPPRESS_CALL_NOTE, { leadId });
}

/**
 * Sur Mac, Option+lettre produit un glyphe (å, æ…) et AZERTY
 * décale `e.code` vs lettre imprimée.
 */
const OPTION_GLYPH_TO_LETTER = {
    "\u00e5": "a", // å
    "\u00c5": "a",
    "\u00e6": "a", // æ
    "\u00c6": "a",
    "\u00e2": "a",
    "\u00e4": "a",
    "\u00e0": "a",
    "\u00e1": "a",
    "\u00e3": "a",
    "\u0101": "a",
    "\u00ae": "r", // ®
    "\u0159": "r",
    "\u0155": "r",
    "\u00e7": "c",
    "\u00c7": "c",
    "\u0107": "c",
    "\u010d": "c",
    "\u0109": "c",
};

/** Code physique → lettre imprimée (AZERTY FR) — lettres décalées seulement. */
const AZERTY_CODE_TO_LETTER = {
    KeyQ: "a",
    KeyA: "q",
    KeyZ: "w",
    KeyW: "z",
    KeySemicolon: "m",
};

function isFrenchLocale() {
    if (typeof navigator === "undefined") return true;
    const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    return langs.some((l) => /^fr\b/i.test(String(l)));
}

/**
 * Correspondance lettre pour raccourcis (QWERTY + AZERTY + glyphes Option).
 * Ne se fie pas à e.key seul (mangé par Option sur Mac).
 */
export function matchesLetterKey(e, letter) {
    const want = String(letter || "").toLowerCase();
    if (!want || !e) return false;

    const raw = String(e.key || "");
    if (raw.length === 1 && /[a-z]/i.test(raw) && raw.toLowerCase() === want) {
        return true;
    }
    const glyph = OPTION_GLYPH_TO_LETTER[raw] || OPTION_GLYPH_TO_LETTER[raw.toLowerCase()];
    if (glyph === want) return true;

    const code = e.code || "";
    const qwertyHit = code === `Key${want.toUpperCase()}`;
    const azertyHit = AZERTY_CODE_TO_LETTER[code] === want;

    // Layout FR : privilégier la lettre imprimée AZERTY
    if (isFrenchLocale()) {
        if (azertyHit) return true;
        // Codes non décalés (R, C, F, K, N…) : QWERTY code = lettre
        if (qwertyHit && !AZERTY_CODE_TO_LETTER[code]) return true;
        return false;
    }

    return qwertyHit;
}

export function isSpaceKey(e) {
    return e?.code === "Space" || e?.key === " " || e?.key === "Spacebar";
}

/** ⌥ / Alt sans ⌘ ni Ctrl ni Shift. */
export function isAltOnly(e) {
    return !!(e?.altKey && !e?.metaKey && !e?.ctrlKey && !e?.shiftKey);
}

/** ⌃⌥ sans ⌘ ni Shift. */
export function isCtrlAltOnly(e) {
    return !!(e?.ctrlKey && e?.altKey && !e?.metaKey && !e?.shiftKey);
}

/** ⌘⇧ (Mac) / Ctrl⇧ (autres) sans Alt. */
export function isModShiftOnly(e) {
    const mac = isMacPlatform();
    const mod = mac ? e?.metaKey : e?.ctrlKey;
    return !!(mod && e?.shiftKey && !e?.altKey && !(mac ? e?.ctrlKey : e?.metaKey));
}

export function isModOnly(e) {
    const mac = isMacPlatform();
    const mod = mac ? e?.metaKey : e?.ctrlKey;
    return !!(mod && !e?.shiftKey && !e?.altKey && !(mac ? e?.ctrlKey : e?.metaKey));
}
