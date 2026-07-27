/**
 * Récap de journée — focus prospection : joints + notes (pas le bruit pipeline).
 */

import { toLocalDateKey } from "@/lib/dateUtils";

/** @typedef {'joint'|'note'|'noanswer'} RecapKind */

export const RECAP_KINDS = {
    joint: { label: "Joint", filterLabel: "Joints" },
    note: { label: "Note", filterLabel: "Notes" },
    noanswer: { label: "Pas de réponse", filterLabel: "Sans réponse" },
};

/**
 * @param {object[]} workspaces
 * @param {string} dateKey YYYY-MM-DD
 */
export function collectDayRecap(workspaces, dateKey) {
    const actions = [];

    for (const ws of workspaces || []) {
        if (!ws) continue;
        const columns = ws.columns || {};
        const wsName = ws.name || "Espace";

        for (const lead of Object.values(ws.leads || {})) {
            if (!lead) continue;
            const company = (lead.company || "").trim() || "Sans nom";
            const stage = columns[lead.columnId]?.name || null;

            for (const note of lead.notes || []) {
                if (!note?.at || toLocalDateKey(note.at) !== dateKey) continue;
                const text = String(note.text || "").trim();
                if (!text) continue;

                // Bruit système — pas dans le récap
                if (/^Contact enregistré/i.test(text)) continue;

                const isJoint = text.includes("📞");
                const isNoAnswer = text.includes("📵");

                /** @type {RecapKind} */
                let kind = "note";
                if (isJoint) kind = "joint";
                else if (isNoAnswer) kind = "noanswer";

                const body = text
                    .replace(/^[📞📵]\s*/, "")
                    .trim();

                actions.push({
                    id: `${ws.id}:${lead.id}:note:${note.id || note.at}`,
                    kind,
                    at: note.at,
                    company,
                    body: body || RECAP_KINDS[kind].label,
                    stage,
                    workspaceId: ws.id,
                    workspaceName: wsName,
                    leadId: lead.id,
                });
            }
        }
    }

    actions.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    const summary = {
        joint: actions.filter((a) => a.kind === "joint").length,
        note: actions.filter((a) => a.kind === "note").length,
        noanswer: actions.filter((a) => a.kind === "noanswer").length,
        total: actions.length,
    };

    return { dateKey, actions, summary };
}

/**
 * @param {object[]} actions
 * @param {{ filter?: 'all'|RecapKind, sort?: 'time'|'company'|'kind' }} opts
 */
export function filterAndSortRecap(actions, { filter = "all", sort = "time" } = {}) {
    let list = Array.isArray(actions) ? [...actions] : [];
    if (filter && filter !== "all") {
        list = list.filter((a) => a.kind === filter);
    }
    if (sort === "company") {
        list.sort((a, b) => a.company.localeCompare(b.company, "fr", { sensitivity: "base" })
            || new Date(b.at).getTime() - new Date(a.at).getTime());
    } else if (sort === "kind") {
        const order = { joint: 0, note: 1, noanswer: 2 };
        list.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9)
            || new Date(b.at).getTime() - new Date(a.at).getTime());
    } else {
        list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    }
    return list;
}
