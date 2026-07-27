/**
 * Filtrage / scoring des leads (recherche + tags actifs).
 * Les filtres de vigilance sont évalués à la volée (données proactives).
 */

import { matchVigilanceFilterTerm } from "@/lib/inconsistencyRules";
import {
    isAgencyDetectionEnabled,
    matchAgencyFilterTerm,
} from "@/lib/agencyDetection";

/**
 * @param {object} lead
 * @param {string} term
 * @param {object} workspace
 * @returns {boolean}
 */
export function leadMatchesTerm(lead, term, workspace) {
    const t = String(term || "").toLowerCase().trim();
    if (!t) return true;

    const vigHit = matchVigilanceFilterTerm(t, lead, workspace.columns, workspace.inconsistencyConfig);
    if (vigHit !== null) return vigHit;

    const agencyHit = matchAgencyFilterTerm(
        t,
        lead,
        isAgencyDetectionEnabled(workspace)
    );
    if (agencyHit !== null) return agencyHit;

    const colName = (workspace.columns?.[lead.columnId]?.name || "").toLowerCase();
    const isOverdue = !!(
        lead.autoFollowup
        && (lead.autoFollowup.overdue || new Date(lead.autoFollowup.dueAt) <= new Date())
    );

    return (
        (lead.company || "").toLowerCase().includes(t)
        || (lead.contact || "").toLowerCase().includes(t)
        || (lead.phone || "").toLowerCase().includes(t)
        || (lead.website || "").toLowerCase().includes(t)
        || (lead.email || "").toLowerCase().includes(t)
        || colName.includes(t)
        || (t === "en retard" && isOverdue)
        || (lead.tags || []).some((tag) => tag.toLowerCase().includes(t))
        || Object.entries(lead.extra || {}).some(([, v]) =>
            String(v || "").toLowerCase().includes(t)
        )
        || (lead.customFields || []).some((cf) =>
            (cf.label || "").toLowerCase().includes(t)
            || (cf.value || "").toLowerCase().includes(t)
        )
    );
}

/**
 * @param {object[]} leads
 * @param {{ filter?: string, activeFilters?: string[] }} opts
 * @param {object} workspace
 * @returns {object[]}
 */
export function filterLeads(leads, { filter = "", activeFilters = [] } = {}, workspace) {
    const q = (filter || "").toLowerCase().trim();
    const tags = (activeFilters || []).map((f) => f.toLowerCase().trim()).filter(Boolean);
    let result = leads;

    if (q) result = result.filter((l) => leadMatchesTerm(l, q, workspace));

    if (tags.length > 0) {
        result = result
            .map((l) => ({
                lead: l,
                score: tags.filter((tag) => leadMatchesTerm(l, tag, workspace)).length,
            }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((x) => x.lead);
    }

    return result;
}
