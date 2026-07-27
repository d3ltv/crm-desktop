/**
 * Profil de recommandation par workspace (niche / template).
 * Chaque vue (sector + name + template + forme du pipeline + échantillon leads)
 * ajuste seuils, vocabulaire et appétence RDV — sans config manuelle.
 */

import {
    isNouveauColumn,
    isMeetingColumn,
    isPropositionColumn,
    isRappelColumn,
} from "@/constants/columnPatterns";

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   isJobs: boolean,
 *   staleNouveauDays: number,
 *   staleContactedDays: number,
 *   coldGapDays: number,
 *   forgotRelanceDays: number,
 *   rdvAfterJointDays: number,
 *   rdvAfterInterestDays: number,
 *   overdueRdvSuggestDays: number,
 *   stuckColumnDays: number,
 *   nrpChannelSwitch: number,
 *   preferRdv: boolean,
 *   preferMorningCalls: boolean,
 *   batchNouveauMin: number,
 *   batchRelanceMin: number,
 *   morningBatchSize: number,
 *   callVerb: string,
 *   callNoun: string,
 *   rdvNoun: string,
 *   nouveauNoun: string,
 *   tipFocus: 'volume' | 'quality' | 'pipeline',
 * }} RecoProfile
 */

/** @type {Array<{ id: string, re: RegExp, patch: Partial<RecoProfile> }>} */
const NICHE_RULES = [
    {
        id: "immo",
        re: /\b(immo|immobilier|agence|location|syndic|copro|maison|appartement|bien)\b/i,
        patch: {
            label: "Immobilier",
            staleNouveauDays: 1,
            coldGapDays: 10,
            stuckColumnDays: 5,
            rdvAfterJointDays: 1,
            preferRdv: true,
            tipFocus: "quality",
            callVerb: "appeler",
            rdvNoun: "visite / RDV",
            morningBatchSize: 6,
        },
    },
    {
        id: "chr",
        re: /\b(resto|restaurant|h[oô]tel|chr|caf[eé]|bar|traiteur|food)\b/i,
        patch: {
            label: "CHR",
            staleNouveauDays: 1,
            coldGapDays: 7,
            forgotRelanceDays: 1,
            stuckColumnDays: 4,
            rdvAfterJointDays: 2,
            preferRdv: true,
            preferMorningCalls: false,
            tipFocus: "volume",
            callVerb: "rappeler",
            callNoun: "rappels",
            morningBatchSize: 8,
        },
    },
    {
        id: "saas",
        re: /\b(saas|logiciel|software|tech|digital|b2b|startup|crm|it)\b/i,
        patch: {
            label: "SaaS / Tech",
            staleNouveauDays: 2,
            coldGapDays: 14,
            stuckColumnDays: 7,
            rdvAfterJointDays: 2,
            preferRdv: true,
            tipFocus: "pipeline",
            rdvNoun: "démo",
            morningBatchSize: 5,
        },
    },
    {
        id: "assurance",
        re: /\b(assur|mutuelle|courtier|pr[eé]voyance|bancassurance)\b/i,
        patch: {
            label: "Assurance",
            staleNouveauDays: 2,
            coldGapDays: 12,
            stuckColumnDays: 6,
            rdvAfterJointDays: 1,
            preferRdv: true,
            tipFocus: "quality",
            rdvNoun: "RDV conseil",
        },
    },
    {
        id: "btp",
        re: /\b(btp|chantier|travaux|artisan|plomberie|[eé]lectric|couverture|menuiser)\b/i,
        patch: {
            label: "BTP",
            staleNouveauDays: 1,
            coldGapDays: 10,
            stuckColumnDays: 5,
            rdvAfterJointDays: 2,
            preferRdv: true,
            tipFocus: "volume",
            rdvNoun: "visite chantier",
            morningBatchSize: 7,
        },
    },
    {
        id: "sante",
        re: /\b(sant[eé]|m[eé]dical|dentaire|cabinet|clinique|pharma|ost[eé]o|kin[eé])\b/i,
        patch: {
            label: "Santé",
            staleNouveauDays: 2,
            coldGapDays: 14,
            stuckColumnDays: 7,
            rdvAfterJointDays: 1,
            preferRdv: true,
            tipFocus: "quality",
            rdvNoun: "RDV",
            morningBatchSize: 4,
        },
    },
    {
        id: "retail",
        re: /\b(retail|magasin|boutique|commerce|franchise|grande distribution)\b/i,
        patch: {
            label: "Commerce",
            staleNouveauDays: 1,
            coldGapDays: 10,
            stuckColumnDays: 5,
            tipFocus: "volume",
            morningBatchSize: 8,
        },
    },
    {
        id: "formation",
        re: /\b(formation|organisme|of\b|cfa|e-?learning|coaching)\b/i,
        patch: {
            label: "Formation",
            staleNouveauDays: 2,
            stuckColumnDays: 7,
            rdvAfterJointDays: 2,
            preferRdv: true,
            tipFocus: "pipeline",
            rdvNoun: "entretien",
        },
    },
    {
        id: "rh",
        re: /\b(rh\b|recrutement|interim|int[eé]rim|staffing|talent|chasseurs?\s+de\s+t[eê]tes)\b/i,
        patch: {
            label: "RH / Interim",
            staleNouveauDays: 1,
            coldGapDays: 8,
            stuckColumnDays: 5,
            preferRdv: true,
            tipFocus: "volume",
            rdvNoun: "entretien",
            morningBatchSize: 8,
        },
    },
    {
        id: "finance",
        re: /\b(banque|finance|comptable|expertise|audit|patrimoine|investissement)\b/i,
        patch: {
            label: "Finance",
            staleNouveauDays: 2,
            coldGapDays: 14,
            stuckColumnDays: 7,
            preferRdv: true,
            tipFocus: "quality",
            rdvNoun: "RDV conseil",
            morningBatchSize: 4,
        },
    },
    {
        id: "services",
        re: /\b(service|presta|conseil|agence\s+web|marketing|comm)\b/i,
        patch: {
            label: "Services",
            staleNouveauDays: 2,
            coldGapDays: 12,
            stuckColumnDays: 6,
            preferRdv: true,
            tipFocus: "pipeline",
            rdvNoun: "RDV découverte",
        },
    },
];

/** @returns {RecoProfile} */
function baseCrmProfile() {
    return {
        id: "crm",
        label: "Prospection",
        isJobs: false,
        staleNouveauDays: 2,
        staleContactedDays: 2,
        coldGapDays: 14,
        forgotRelanceDays: 1,
        rdvAfterJointDays: 3,
        rdvAfterInterestDays: 1,
        overdueRdvSuggestDays: 1,
        stuckColumnDays: 6,
        nrpChannelSwitch: 3,
        preferRdv: true,
        preferMorningCalls: true,
        batchNouveauMin: 3,
        batchRelanceMin: 2,
        morningBatchSize: 5,
        callVerb: "appeler",
        callNoun: "appels",
        rdvNoun: "RDV",
        nouveauNoun: "nouveaux",
        tipFocus: "pipeline",
    };
}

/** @returns {RecoProfile} */
function baseJobsProfile() {
    return {
        id: "jobs",
        label: "Candidatures",
        isJobs: true,
        staleNouveauDays: 3,
        staleContactedDays: 4,
        coldGapDays: 10,
        forgotRelanceDays: 2,
        rdvAfterJointDays: 2,
        rdvAfterInterestDays: 1,
        overdueRdvSuggestDays: 1,
        stuckColumnDays: 7,
        nrpChannelSwitch: 2,
        preferRdv: true,
        preferMorningCalls: true,
        batchNouveauMin: 2,
        batchRelanceMin: 2,
        morningBatchSize: 4,
        callVerb: "relancer",
        callNoun: "relances",
        rdvNoun: "entretien",
        nouveauNoun: "candidatures",
        tipFocus: "pipeline",
    };
}

/**
 * Niche déduite d’un échantillon de leads (si le nom de vue est générique).
 * @param {object} workspace
 * @returns {Partial<RecoProfile>|null}
 */
function inferNicheFromLeadSample(workspace) {
    const leads = Object.values(workspace?.leads || {}).filter((l) => l && !l.archived);
    if (leads.length < 3) return null;
    const sample = leads.slice(0, 50);
    const hay = sample
        .map((l) => `${l.company || ""} ${(l.tags || []).join(" ")} ${l.extra?.secteur || l.extra?.Secteur || ""}`)
        .join(" ");
    for (const rule of NICHE_RULES) {
        if (rule.re.test(hay)) {
            return { ...rule.patch, id: rule.id };
        }
    }
    return null;
}

/**
 * Affinage léger selon la forme du board (colonnes).
 * @param {RecoProfile} profile
 * @param {object} workspace
 */
function refineFromPipeline(profile, workspace) {
    const cols = Object.values(workspace?.columns || {});
    const names = cols.map((c) => c?.name || "");
    const hasMeeting = names.some((n) => isMeetingColumn(n));
    const hasProp = names.some((n) => isPropositionColumn(n));
    const hasRappel = names.some((n) => isRappelColumn(n));
    const nouveauCols = names.filter((n) => isNouveauColumn(n)).length;
    const leadCount = Object.values(workspace?.leads || {}).filter((l) => l && !l.archived).length;

    const next = { ...profile };

    if (leadCount >= 80) {
        next.staleNouveauDays = Math.min(next.staleNouveauDays, 1);
        next.coldGapDays = Math.min(next.coldGapDays, 10);
        next.morningBatchSize = Math.max(next.morningBatchSize, 8);
        next.tipFocus = "volume";
        next.batchNouveauMin = Math.max(2, next.batchNouveauMin - 1);
    } else if (leadCount > 0 && leadCount <= 15) {
        next.tipFocus = "quality";
        next.preferRdv = true;
        next.rdvAfterJointDays = Math.min(next.rdvAfterJointDays, 2);
        next.stuckColumnDays = Math.min(next.stuckColumnDays, 5);
    }

    if (hasMeeting || hasProp) {
        next.preferRdv = true;
        next.tipFocus = next.tipFocus === "volume" ? "pipeline" : next.tipFocus;
    }
    if (hasRappel && !hasMeeting) {
        next.rdvAfterJointDays = Math.min(next.rdvAfterJointDays, 2);
    }
    if (nouveauCols >= 2) {
        next.batchNouveauMin = Math.max(2, next.batchNouveauMin - 1);
    }

    return next;
}

/**
 * @param {object} workspace
 * @returns {RecoProfile}
 */
export function getWorkspaceRecoProfile(workspace) {
    const isJobs = workspace?.template === "jobs";
    let profile = isJobs ? baseJobsProfile() : baseCrmProfile();

    const hay = `${workspace?.sector || ""} ${workspace?.name || ""}`.trim();
    let matched = false;
    if (hay && !isJobs) {
        for (const rule of NICHE_RULES) {
            if (rule.re.test(hay)) {
                profile = { ...profile, ...rule.patch, id: rule.id };
                matched = true;
                break;
            }
        }
    }

    if (!matched && !isJobs) {
        const inferred = inferNicheFromLeadSample(workspace);
        if (inferred) {
            profile = { ...profile, ...inferred };
        }
    }

    return refineFromPipeline(profile, workspace);
}

/**
 * Libellé court pour contextualiser un tip workspace.
 * @param {object} workspace
 * @param {RecoProfile} profile
 */
export function workspaceRecoContext(workspace, profile) {
    const name = (workspace?.name || "").trim();
    if (name) return name;
    if (workspace?.sector) return workspace.sector;
    return profile.label;
}

/**
 * Médiane des dealValue > 0 du workspace (pour prioriser les gros tickets).
 * @param {object} workspace
 * @returns {number}
 */
export function workspaceMedianDeal(workspace) {
    const vals = Object.values(workspace?.leads || {})
        .map((l) => Number(l?.dealValue))
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);
    if (!vals.length) return 0;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}
