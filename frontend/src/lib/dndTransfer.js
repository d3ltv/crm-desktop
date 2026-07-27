/**
 * WebKit / Tauri : types MIME custom souvent masqués pendant dragover.
 * Accepte text/plain + Text / text/uri-list en secours.
 *
 * En plus : flag synchrone (avant le re-render React) pour que les
 * colonnes acceptent le drop dès le 1er dragover.
 */

/** @type {{ leadId: string, fromColumnId: string } | null} */
let activeLeadDrag = null;

/**
 * @param {{ leadId: string, fromColumnId: string } | null} payload
 */
export function setActiveLeadDrag(payload) {
    activeLeadDrag = payload;
}

export function getActiveLeadDrag() {
    return activeLeadDrag;
}

export function isLeadDragActive() {
    return activeLeadDrag != null;
}

/**
 * @param {DataTransfer|null|undefined} dataTransfer
 */
export function isLeadDragTransfer(dataTransfer) {
    if (activeLeadDrag) return true;
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types || []);
    return (
        types.includes("application/x-lead-id")
        || types.includes("text/plain")
        || types.includes("Text")
        || types.includes("text/uri-list")
    );
}
