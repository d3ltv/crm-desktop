/**
 * Variant de build Relia.
 * - défaut / normal : Relia (app perso)
 * - relia2 : build export « Rellia » (focus site web, guidage…)
 * - console : Relia Console (publish / rollback GitHub)
 *
 * Piloté par REACT_APP_RELIA_VARIANT au moment du build CRA.
 */
export const RELIA_VARIANT = String(process.env.REACT_APP_RELIA_VARIANT || "")
    .trim()
    .toLowerCase();

/** Build export partageable (ex-Relia 2). */
export const isRelia2Export = RELIA_VARIANT === "relia2";

/** Cockpit mises à jour (2ᵉ app). */
export const isReliaConsole = RELIA_VARIANT === "console";

/** Nom affiché dans l’UI. */
export const PRODUCT_DISPLAY_NAME = isReliaConsole
    ? "Relia Console"
    : isRelia2Export
      ? "Rellia"
      : "Relia";
