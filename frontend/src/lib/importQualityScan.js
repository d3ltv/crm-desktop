/**
 * Scan qualité pré-import — cabinets, annonces fermées, absence de coordonnées.
 * Réutilise agencyDetection + helpers inconsistencyRules (pas de duplication de règles).
 */

import { getAgencySuspicion } from "@/lib/agencyDetection";
import {
    hasEmailAnywhere,
    hasPhoneAnywhere,
    isClosedAdLead,
} from "@/lib/inconsistencyRules";

/** Tag appliqué automatiquement aux suspects cabinet à l'import. */
export const AGENCY_IMPORT_TAG = "Cabinet";

/**
 * @param {object[]} leads — brouillons issus de rowsToLeads (avec ou sans _incomplete)
 * @param {{ agencyEnabled?: boolean }} [opts]
 * @returns {{
 *   agencyCount: number,
 *   closedAdCount: number,
 *   noContactCount: number,
 *   agencyIndexes: number[],
 *   closedAdIndexes: number[],
 *   noContactIndexes: number[],
 * }}
 */
export function scanImportLeads(leads, { agencyEnabled = true } = {}) {
    const agencyIndexes = [];
    const closedAdIndexes = [];
    const noContactIndexes = [];

    (leads || []).forEach((lead, idx) => {
        if (getAgencySuspicion(lead, agencyEnabled)) {
            agencyIndexes.push(idx);
        }
        if (isClosedAdLead(lead)) {
            closedAdIndexes.push(idx);
        }
        if (!hasPhoneAnywhere(lead) && !hasEmailAnywhere(lead)) {
            noContactIndexes.push(idx);
        }
    });

    return {
        agencyCount: agencyIndexes.length,
        closedAdCount: closedAdIndexes.length,
        noContactCount: noContactIndexes.length,
        agencyIndexes,
        closedAdIndexes,
        noContactIndexes,
    };
}

/**
 * Applique tag Cabinet et/ou filtre annonces fermées sur une liste de leads prêts à importer.
 * @returns {{ leads: object[], taggedAgency: number, excludedClosed: number }}
 */
export function applyImportQualityActions(leads, {
    agencyEnabled = true,
    tagAgencies = false,
    excludeClosedAds = false,
} = {}) {
    let taggedAgency = 0;
    let excludedClosed = 0;
    const out = [];

    for (const lead of leads || []) {
        if (excludeClosedAds && isClosedAdLead(lead)) {
            excludedClosed++;
            continue;
        }

        let next = lead;
        if (tagAgencies && getAgencySuspicion(lead, agencyEnabled)) {
            const tags = Array.isArray(lead.tags) ? [...lead.tags] : [];
            const hasTag = tags.some(
                (t) => String(t).trim().toLowerCase() === AGENCY_IMPORT_TAG.toLowerCase()
            );
            if (!hasTag) {
                tags.push(AGENCY_IMPORT_TAG);
                taggedAgency++;
                next = { ...lead, tags };
            }
        }
        out.push(next);
    }

    return { leads: out, taggedAgency, excludedClosed };
}
