/**
 * Variant de build Relia.
 * - défaut / normal : Relia (app perso)
 * - relia2 : build export « Rellia » (focus site web, guidage…)
 *
 * Piloté par REACT_APP_RELIA_VARIANT au moment du build CRA.
 */
export const RELIA_VARIANT = String(process.env.REACT_APP_RELIA_VARIANT || "")
    .trim()
    .toLowerCase();

/** Build export partageable (ex-Relia 2). */
export const isRelia2Export = RELIA_VARIANT === "relia2";

/** Nom affiché dans l’UI — Rellia pour l’export, Relia sinon. */
export const PRODUCT_DISPLAY_NAME = isRelia2Export ? "Rellia" : "Relia";
