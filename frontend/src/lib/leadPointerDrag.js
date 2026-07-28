/**
 * Drag pointeur pour leads Kanban — contourne le HTML5 DnD cassé sous WKWebView/Tauri.
 */

const DRAG_THRESHOLD_PX = 8;

function clearDomSelection() {
    try {
        const sel = window.getSelection?.();
        if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch { /* ignore */ }
}

function blockSelectStart(e) {
    e.preventDefault();
}

/**
 * @param {object} opts
 * @param {(state: object|null) => void} opts.setDragState
 * @param {(columnId: string, index: number|null) => void} opts.onCommitMove
 * @returns {{
 *   onLeadPointerDown: (e: PointerEvent, lead: object) => void,
 *   didDragRef: { current: boolean },
 * }}
 */
export function createLeadPointerDrag({ setDragState, onCommitMove }) {
    /** @type {{ current: boolean }} */
    const didDragRef = { current: false };

    /** @type {object|null} */
    let session = null;

    const cleanupGhost = () => {
        if (session?.ghost?.parentNode) {
            session.ghost.parentNode.removeChild(session.ghost);
        }
        if (session?.ghost) session.ghost = null;
    };

    const unlockSelection = () => {
        document.documentElement.classList.remove("relia-lead-dragging");
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        document.documentElement.style.userSelect = "";
        document.documentElement.style.webkitUserSelect = "";
        document.body.style.cursor = "";
        document.removeEventListener("selectstart", blockSelectStart, true);
    };

    const lockSelection = () => {
        document.documentElement.classList.add("relia-lead-dragging");
        document.body.style.userSelect = "none";
        document.body.style.webkitUserSelect = "none";
        document.documentElement.style.userSelect = "none";
        document.documentElement.style.webkitUserSelect = "none";
        document.body.style.cursor = "grabbing";
        document.addEventListener("selectstart", blockSelectStart, true);
        clearDomSelection();
    };

    const endSession = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        cleanupGhost();
        unlockSelection();
        clearDomSelection();
        session = null;
        setDragState(null);
    };

    const hitColumn = (clientX, clientY) => {
        const stack = document.elementsFromPoint?.(clientX, clientY)
            || [document.elementFromPoint(clientX, clientY)].filter(Boolean);
        for (const el of stack) {
            const col = el?.closest?.("[data-kanban-column-id]");
            if (col) {
                const columnId = col.getAttribute("data-kanban-column-id");
                const idxAttr = el?.closest?.("[data-drop-index]")?.getAttribute("data-drop-index");
                const index = idxAttr != null ? Number(idxAttr) : null;
                return { columnId, index: Number.isFinite(index) ? index : null };
            }
        }
        return null;
    };

    const onPointerMove = (ev) => {
        if (!session || ev.pointerId !== session.pointerId) return;

        const dx = ev.clientX - session.startX;
        const dy = ev.clientY - session.startY;

        if (!session.activated) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
            session.activated = true;
            didDragRef.current = true;
            // Coupe la sélection native WebKit dès l’activation
            ev.preventDefault();
            lockSelection();

            const ghost = session.sourceEl.cloneNode(true);
            const w = session.sourceEl.offsetWidth;
            ghost.style.cssText = `
                position: fixed;
                left: ${ev.clientX - w / 2}px;
                top: ${ev.clientY - 24}px;
                width: ${w}px;
                z-index: 9999;
                pointer-events: none;
                opacity: 0.92;
                transform: rotate(1.5deg) scale(1.02);
                border-radius: 12px;
                box-shadow: 0 16px 40px -8px rgba(0,0,0,0.28);
                margin: 0;
                user-select: none;
                -webkit-user-select: none;
            `;
            document.body.appendChild(ghost);
            session.ghost = ghost;

            const firstHit = hitColumn(ev.clientX, ev.clientY);
            session.toColumnId = firstHit?.columnId || session.fromColumnId;
            session.toIndex = firstHit?.index ?? null;

            setDragState({
                leadId: session.leadId,
                fromColumnId: session.fromColumnId,
                toColumnId: session.toColumnId,
                toIndex: session.toIndex,
            });
        } else {
            // Empêche le drag-select bleu pendant tout le geste
            ev.preventDefault();
            clearDomSelection();
        }

        if (session.ghost) {
            const w = session.ghost.offsetWidth || 280;
            session.ghost.style.left = `${ev.clientX - w / 2}px`;
            session.ghost.style.top = `${ev.clientY - 24}px`;
            // Laisse le hit-test voir sous le fantôme
            session.ghost.style.visibility = "hidden";
        }

        const hit = hitColumn(ev.clientX, ev.clientY);
        if (session.ghost) session.ghost.style.visibility = "visible";

        if (hit?.columnId) {
            session.toColumnId = hit.columnId;
            session.toIndex = hit.index;
            setDragState((prev) =>
                prev
                    ? {
                        ...prev,
                        toColumnId: hit.columnId,
                        toIndex: hit.index,
                    }
                    : prev,
            );
        }
    };

    const onPointerUp = (ev) => {
        if (!session || ev.pointerId !== session.pointerId) return;

        const { activated, leadId, fromColumnId, toColumnId, toIndex } = session;
        const wasActive = activated;
        endSession();

        if (!wasActive) return;
        if (!toColumnId) return;

        // Cross-colonne : toujours commit (même sans index → fin / prepend Contacté)
        if (toColumnId !== fromColumnId) {
            onCommitMove({ leadId, fromColumnId, toColumnId, toIndex });
            return;
        }

        // Même colonne : reorder seulement si index précis
        if (toIndex == null) return;
        onCommitMove({ leadId, fromColumnId, toColumnId, toIndex });
    };

    /**
     * @param {PointerEvent} e
     * @param {object} lead
     */
    const onLeadPointerDown = (e, lead) => {
        if (e.button !== 0) return;
        if (e.target?.closest?.("a, button, input, textarea, [data-no-open]")) return;

        didDragRef.current = false;
        session = {
            leadId: lead.id,
            fromColumnId: lead.columnId,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId,
            sourceEl: e.currentTarget,
            activated: false,
            ghost: null,
            toColumnId: null,
            toIndex: null,
        };

        // Capture pour recevoir les move même hors fenêtre
        try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch { /* ignore */ }

        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
    };

    return { onLeadPointerDown, didDragRef };
}
