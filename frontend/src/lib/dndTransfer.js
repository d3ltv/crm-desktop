/**
 * WebKit / Tauri : DnD fragile — MIME custom masqués, drop parfois absent.
 * Flag + cible de drop synchrones (hors React) pour accepter le survol
 * dès le 1er dragover et committer le move au dragend si besoin.
 */

/** @type {{ leadId: string, fromColumnId: string } | null} */
let activeLeadDrag = null;

/** @type {{ columnId: string, index: number|null } | null} */
let pendingDropTarget = null;

/** Évite double commit (drop + dragend). */
let dropCommitted = false;

/**
 * @param {{ leadId: string, fromColumnId: string } | null} payload
 */
export function setActiveLeadDrag(payload) {
    activeLeadDrag = payload;
    pendingDropTarget = null;
    dropCommitted = false;
}

export function getActiveLeadDrag() {
    return activeLeadDrag;
}

export function isLeadDragActive() {
    return activeLeadDrag != null;
}

/**
 * @param {string} columnId
 * @param {number|null} [index]
 */
export function setPendingDropTarget(columnId, index = null) {
    if (!activeLeadDrag || !columnId) return;
    pendingDropTarget = { columnId, index };
}

export function getPendingDropTarget() {
    return pendingDropTarget;
}

export function markLeadDropCommitted() {
    dropCommitted = true;
}

export function wasLeadDropCommitted() {
    return dropCommitted;
}

export function clearLeadDrag() {
    activeLeadDrag = null;
    pendingDropTarget = null;
    dropCommitted = false;
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
    );
}
