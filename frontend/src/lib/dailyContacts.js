/**
 * Compteur unique « contacts du jour » — partagé widget objectif + tip_goal.
 * Un lead compte s’il a été touché aujourd’hui via lastContact, note d’appel, ou entrée Contacté.
 */

import { toLocalDateKey } from "@/lib/dateUtils";
import { isContactedColumn } from "@/constants/columnPatterns";

function isCallNoteText(text) {
    const t = String(text || "");
    return t.includes("📞") || t.includes("📵");
}

/**
 * @param {object} workspace
 * @param {Date} [now]
 * @returns {number}
 */
export function countContactsToday(workspace, now = new Date()) {
    const todayKey = toLocalDateKey(now);
    if (!todayKey) return 0;
    let count = 0;

    for (const lead of Object.values(workspace?.leads || {})) {
        if (lead.lastContact && toLocalDateKey(lead.lastContact) === todayKey) {
            count += 1;
            continue;
        }

        const notes = lead.notes || [];
        if (notes.some((n) => isCallNoteText(n.text) && toLocalDateKey(n.at) === todayKey)) {
            count += 1;
            continue;
        }

        const history = lead.statusHistory || [];
        const enteredContacted = history.some((entry) => {
            if (!entry?.at || toLocalDateKey(entry.at) !== todayKey) return false;
            const col = workspace.columns?.[entry.columnId];
            return col && isContactedColumn(col.name);
        });
        if (enteredContacted) count += 1;
    }

    return count;
}
