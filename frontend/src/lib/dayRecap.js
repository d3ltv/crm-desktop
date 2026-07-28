/**
 * Récap de journée — activité réalisée + agenda du jour.
 * Notes / joints / NRP · contacts · relances · changements de colonne ·
 * RDV / rappels / relances planifiés · événements libres.
 */

import { toLocalDateKey } from "@/lib/dateUtils";
import { CALENDAR_EVENT_META } from "@/lib/calendarEvents";

/** @typedef {'joint'|'note'|'noanswer'|'contact'|'relance_done'|'moved'|'rdv'|'rappel'|'relance'|'event'} RecapKind */

export const RECAP_KINDS = {
    joint: { label: "Joint", filterLabel: "Joints", group: "activity" },
    noanswer: { label: "Pas de réponse", filterLabel: "Sans réponse", group: "activity" },
    note: { label: "Note", filterLabel: "Notes", group: "activity" },
    contact: { label: "Contacté", filterLabel: "Contactés", group: "activity" },
    relance_done: { label: "Relance faite", filterLabel: "Relances faites", group: "activity" },
    moved: { label: "Déplacé", filterLabel: "Déplacements", group: "activity" },
    rdv: { label: "RDV", filterLabel: "RDV", group: "agenda" },
    rappel: { label: "Rappel", filterLabel: "Rappels", group: "agenda" },
    relance: { label: "Relance", filterLabel: "Relances dues", group: "agenda" },
    event: { label: "Événement", filterLabel: "Événements", group: "agenda" },
};

/** Filtres affichés dans l’UI (groupés). */
export const RECAP_FILTERS = [
    { id: "all", label: "Tout" },
    { id: "activity", label: "Fait" },
    { id: "agenda", label: "Prévu" },
    { id: "joint", label: "Joints" },
    { id: "noanswer", label: "Sans réponse" },
    { id: "rdv", label: "RDV" },
    { id: "rappel", label: "Rappels" },
];

function emptySummary() {
    return Object.keys(RECAP_KINDS).reduce(
        (acc, k) => {
            acc[k] = 0;
            return acc;
        },
        { total: 0, activity: 0, agenda: 0 }
    );
}

/**
 * @param {object[]} workspaces
 * @param {string} dateKey YYYY-MM-DD
 * @param {{ dayEvents?: object[] }} [opts] événements agenda déjà filtrés pour ce jour
 */
export function collectDayRecap(workspaces, dateKey, { dayEvents = [] } = {}) {
    const actions = [];
    const seen = new Set();

    const push = (item) => {
        if (!item?.id || seen.has(item.id)) return;
        seen.add(item.id);
        actions.push(item);
    };

    for (const ws of workspaces || []) {
        if (!ws) continue;
        const columns = ws.columns || {};
        const wsName = ws.name || "Espace";

        for (const lead of Object.values(ws.leads || {})) {
            if (!lead) continue;
            const company = (lead.company || "").trim() || "Sans nom";
            const stage = columns[lead.columnId]?.name || null;
            const base = {
                company,
                stage,
                workspaceId: ws.id,
                workspaceName: wsName,
                leadId: lead.id,
            };

            // ── Notes du jour ──────────────────────────────────────────────
            for (const note of lead.notes || []) {
                if (!note?.at || toLocalDateKey(note.at) !== dateKey) continue;
                const text = String(note.text || "").trim();
                if (!text) continue;

                const isContactLog = /^Contact enregistré/i.test(text)
                    || /^Relance depuis/i.test(text);
                const isJoint = text.includes("📞");
                const isNoAnswer = text.includes("📵");

                /** @type {RecapKind} */
                let kind = "note";
                if (isContactLog) kind = "contact";
                else if (isJoint) kind = "joint";
                else if (isNoAnswer) kind = "noanswer";

                const body = text
                    .replace(/^[📞📵]\s*/, "")
                    .trim();

                push({
                    ...base,
                    id: `${ws.id}:${lead.id}:note:${note.id || note.at}`,
                    kind,
                    at: note.at,
                    body: body || RECAP_KINDS[kind].label,
                    meta: { source: "note", hasRecording: !!note.recordingId },
                });
            }

            // ── Contacté (lastContact ou entrée colonne Contacté) sans note dédiée ──
            const contactAt = lead.lastContact || lead.contactedColumnEnteredAt;
            if (contactAt && toLocalDateKey(contactAt) === dateKey) {
                const already = actions.some(
                    (a) => a.leadId === lead.id
                        && a.workspaceId === ws.id
                        && (a.kind === "joint" || a.kind === "contact" || a.kind === "noanswer")
                        && toLocalDateKey(a.at) === dateKey
                );
                if (!already) {
                    push({
                        ...base,
                        id: `${ws.id}:${lead.id}:contact:${contactAt}`,
                        kind: "contact",
                        at: contactAt,
                        body: "Contact enregistré",
                        meta: { source: "lastContact" },
                    });
                }
            }

            // ── Relances manuelles loguées ─────────────────────────────────
            for (const r of lead.relances || []) {
                if (!r?.at || toLocalDateKey(r.at) !== dateKey) continue;
                const canal = r.canal || "Relance";
                const note = (r.note || "").trim();
                push({
                    ...base,
                    id: `${ws.id}:${lead.id}:relance:${r.id || r.at}`,
                    kind: "relance_done",
                    at: r.at,
                    body: note ? `${canal} · ${note}` : `${canal}${r.num ? ` #${r.num}` : ""}`,
                    meta: { source: "relance", canal, num: r.num },
                });
            }

            // ── Changements de colonne (statusHistory) ─────────────────────
            for (const h of lead.statusHistory || []) {
                if (!h?.at || toLocalDateKey(h.at) !== dateKey) continue;
                const colName = columns[h.columnId]?.name || "Colonne";
                // Skip entrée initiale à la création (souvent même seconde que createdAt)
                if (lead.createdAt && Math.abs(new Date(h.at) - new Date(lead.createdAt)) < 2000) {
                    const hist = lead.statusHistory || [];
                    if (hist.length <= 1) continue;
                }
                push({
                    ...base,
                    id: `${ws.id}:${lead.id}:moved:${h.columnId}:${h.at}`,
                    kind: "moved",
                    at: h.at,
                    body: `→ ${colName}`,
                    stage: colName,
                    meta: { source: "statusHistory", columnId: h.columnId },
                });
            }
        }
    }

    // ── Agenda du jour (RDV / rappel / relance / standalone) ───────────────
    for (const ev of dayEvents || []) {
        if (!ev || ev.type === "surveillance") continue;
        const overdue = !!(ev.meta?.overdueCarry || (ev.dateKey && ev.dateKey < dateKey));
        /** @type {RecapKind} */
        let kind = "rappel";
        if (ev.standalone) kind = "event";
        else if (ev.type === "rdv") kind = "rdv";
        else if (ev.type === "relance") kind = "relance";
        else if (ev.type === "rappel") kind = "rappel";

        const at = ev.dueAt || `${dateKey}T09:00:00`;
        const label = CALENDAR_EVENT_META[ev.type]?.label || RECAP_KINDS[kind].label;
        const subtitle = (ev.subtitle || "").trim();
        const bodyParts = [
            overdue ? "En retard" : null,
            subtitle && subtitle !== label ? subtitle : label,
        ].filter(Boolean);

        push({
            id: `agenda:${ev.id}`,
            kind,
            at,
            company: ev.company || ev.title || "Sans nom",
            body: bodyParts.join(" · ") || label,
            stage: null,
            workspaceId: ev.workspaceId || null,
            workspaceName: ev.workspaceName || null,
            leadId: ev.leadId || null,
            standalone: !!ev.standalone,
            standaloneId: ev.standaloneId || null,
            meta: {
                source: "agenda",
                calendarType: ev.type,
                overdue,
                dateKey: ev.dateKey,
            },
        });
    }

    actions.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    const summary = emptySummary();
    for (const a of actions) {
        summary[a.kind] = (summary[a.kind] || 0) + 1;
        summary.total += 1;
        const group = RECAP_KINDS[a.kind]?.group;
        if (group) summary[group] = (summary[group] || 0) + 1;
    }

    return { dateKey, actions, summary };
}

/**
 * @param {object[]} actions
 * @param {{ filter?: string, sort?: 'time'|'company'|'kind' }} opts
 */
export function filterAndSortRecap(actions, { filter = "all", sort = "time" } = {}) {
    let list = Array.isArray(actions) ? [...actions] : [];

    if (filter && filter !== "all") {
        if (filter === "activity" || filter === "agenda") {
            list = list.filter((a) => RECAP_KINDS[a.kind]?.group === filter);
        } else {
            list = list.filter((a) => a.kind === filter);
        }
    }

    if (sort === "company") {
        list.sort((a, b) => a.company.localeCompare(b.company, "fr", { sensitivity: "base" })
            || new Date(b.at).getTime() - new Date(a.at).getTime());
    } else if (sort === "kind") {
        const order = {
            rdv: 0,
            rappel: 1,
            relance: 2,
            event: 3,
            joint: 4,
            contact: 5,
            noanswer: 6,
            relance_done: 7,
            note: 8,
            moved: 9,
        };
        list.sort((a, b) => (order[a.kind] ?? 20) - (order[b.kind] ?? 20)
            || new Date(b.at).getTime() - new Date(a.at).getTime());
    } else {
        list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    }
    return list;
}
