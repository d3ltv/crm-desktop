/**
 * reliaBrain.js — Cerveau Relia.
 *
 * Compose les organes (chacun reste dans sa zone de génie) et expose une API unique
 * pour l’UI. Les spécialistes ne s’appellent plus en étoile depuis les composants.
 *
 * Organs
 * ──────
 *  heart   usageMemory      — apprend des gestes → délais, peak, affinité cloche
 *  niche   recoProfile      — seuils / vocabulaire par secteur
 *  merge   coachingProfile  — niche ⊕ learned
 *  clock   prospectingSlots — créneau jour×heure (Wilson + récence)
 *  pulse   dailyContacts    — contacts du jour (une vérité)
 *  eyes    inconsistencyRules — vigilance / process
 *  voice   followupNotifs   — conseils / cloche (reçoit le profil déjà fusionné)
 *  hands   dateUtils        — defaults NRP / calendrier
 *  breath  whisperGovernor  — ressources Whisper (threads, repos, file)
 *  blood   dealEconomics    — argent réel : LTV, valeur/appel, proba par stade
 *  skin    structureLearning — champs & colonnes inventés par l'utilisateur
 *
 * Cercles vertueux (gérés ICI, pas dans les organes)
 * ───────────────────────────────────────────────────
 *  1. créneau observé ⊕ peak appris → heure préférée des rappels
 *  2. délais appris ⊕ niche → jours de relance post-joint
 *  3. créneau.bestDay → biais calendrier (jour cible)
 *  4. vigilance ⊕ conseils → dédup sur la fiche (voix se tait si yeux parlent)
 *  5. pulse contacts → tip_goal aligné widget objectif
 *  6. argent ⊕ structure ⊕ rythme → « Informations pertinentes » par prospect,
 *     et mêmes chiffres réutilisés par les KPI de l'accueil (une seule vérité)
 *
 * Garanties du cerveau (il ne doit JAMAIS dégrader un organe)
 * ────────────────────────────────────────────────────────────
 *  - Fail-safe : un organe qui jette ne fait pas tomber l’UI — fallback dégradé
 *    + warn console une seule fois par organe.
 *  - Perf : mémo TTL (WeakMap) sur les chemins appelés en rendu — le cerveau
 *    n’ajoute pas de recalcul par rapport aux appels directs qu’il remplace.
 */

import { resolveCoachingProfile } from "@/lib/coachingProfile";
import {
    getLearnedPreferredHour,
    getSuggestedRelanceDays,
    learnedKindBoost,
    getLearnedColumnCreatedAt,
} from "@/lib/usageMemory";
import {
    computeWorkspaceEconomics,
    computeGlobalEconomics,
    estimateLeadValue,
    detectStageStall,
    matchLeadSegments,
    fmtEur,
    fmtPct,
} from "@/lib/dealEconomics";
import {
    computeColumnIntel,
} from "@/lib/structureLearning";
import { getBestProspectingSlot } from "@/lib/prospectingSlots";
import { countContactsToday } from "@/lib/dailyContacts";
import { getLeadVigilance } from "@/lib/inconsistencyRules";
import {
    getWorkspaceFollowupNotifs,
    getLeadFollowupNotifs,
    getAllFollowupNotifs as computeAllFollowupNotifs,
    getAllUnreadNotifs as computeAllUnreadNotifs,
} from "@/lib/followupNotifs";
import { suggestNoAnswerFollowUp, daysUntilWeekday } from "@/lib/dateUtils";
import { getGovernorStatus } from "@/lib/whisperGovernor";

// ── Fail-safe : un organe défaillant ne tue pas le cerveau ──────────────────

const warnedOrgans = new Set();

/**
 * Exécute un organe ; en cas d’erreur, log UNE fois et rend le fallback.
 * @template T
 * @param {string} organ
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
function safe(organ, fn, fallback) {
    try {
        return fn();
    } catch (err) {
        if (!warnedOrgans.has(organ)) {
            warnedOrgans.add(organ);
            console.warn(`[reliaBrain] organe « ${organ} » en échec — fallback dégradé:`, err);
        }
        return fallback;
    }
}

// ── Mémo TTL : pas de recalcul en rafale sur les chemins de rendu ────────────

/** Le créneau évolue par nouvel appel noté, pas à la seconde. */
const SLOT_TTL_MS = 30_000;
/** @type {WeakMap<object, { at: number, value: any }>} */
const slotCache = new WeakMap();

function cachedSlot(keyObj, compute) {
    if (!keyObj || typeof keyObj !== "object") return compute();
    const hit = slotCache.get(keyObj);
    const now = Date.now();
    if (hit && now - hit.at < SLOT_TTL_MS) return hit.value;
    const value = compute();
    slotCache.set(keyObj, { at: now, value });
    return value;
}

/**
 * Mémo par identité d'objet workspace : le reducer recrée le workspace à chaque
 * changement, donc le cache s'invalide exactement quand les données bougent —
 * et une fiche ouverte ne recalcule pas l'économie à chaque frappe.
 * @template T
 * @param {WeakMap<object, T>} store
 * @param {object} keyObj
 * @param {() => T} compute
 * @returns {T}
 */
function memoByObject(store, keyObj, compute) {
    if (!keyObj || typeof keyObj !== "object") return compute();
    if (store.has(keyObj)) return store.get(keyObj);
    const value = compute();
    store.set(keyObj, value);
    return value;
}

/** @type {WeakMap<object, any>} */
const econCache = new WeakMap();
/** @type {WeakMap<object, any>} */
const columnIntelCache = new WeakMap();

const FALLBACK_PROFILE_RESULT = {
    profile: {},
    learned: { confidence: 0 },
    confidence: 0,
    peakHour: null,
};

function safeProfile(workspace) {
    return safe("coachingProfile", () => resolveCoachingProfile(workspace), FALLBACK_PROFILE_RESULT);
}

// ── API cerveau ──────────────────────────────────────────────────────────────

/**
 * Créneau global (tous workspaces) — une seule vérité accueil / fiche / stats.
 * Mémoïsé ~30 s par identité du tableau (les composants le stabilisent via useMemo).
 * @param {object[]} workspaces
 * @param {{ now?: Date }} [opts]
 */
export function getProspectingBrief(workspaces, opts = {}) {
    const list = (workspaces || []).filter(Boolean);
    if (!list.length) return null;
    // `now` custom (tests) → pas de cache
    if (opts.now) return safe("prospectingSlots", () => getBestProspectingSlot(list, opts), null);
    return cachedSlot(workspaces, () =>
        safe("prospectingSlots", () => getBestProspectingSlot(list, opts), null)
    );
}

/**
 * Defaults d’appel / relance : cerveau fusionne mémoire + créneau + niche.
 * @param {object} workspace
 * @param {{ workspaces?: object[], now?: Date }} [opts]
 */
export function getCallDefaults(workspace, opts = {}) {
    const { profile, learned, confidence, peakHour } = safeProfile(workspace);
    const slot = getProspectingBrief(opts.workspaces || (workspace ? [workspace] : []), {
        now: opts.now,
    });

    const relanceDays = safe("usageMemory", () => getSuggestedRelanceDays(workspace), 2);

    // Cercle 1 : créneau observé prioritaire si dispo, sinon peak appris
    let preferredHour = null;
    let preferredHourSource = "none";
    if (slot?.available && slot.bestHour?.hour != null) {
        preferredHour = slot.bestHour.hour;
        preferredHourSource = "slot";
    } else {
        const learnedH = safe("usageMemory", () => getLearnedPreferredHour(workspace?.id), null);
        if (learnedH != null) {
            preferredHour = learnedH;
            preferredHourSource = "learned";
        } else if (profile.preferMorningCalls) {
            preferredHour = 10;
            preferredHourSource = "niche";
        }
    }

    const preferredDay = slot?.available && slot.bestDay?.day != null
        ? { day: slot.bestDay.day, label: slot.bestDay.label, source: "slot" }
        : null;

    // Cercle 2+3 : suggestion NRP à l’heure du cerveau
    const noAnswerFollowUp = suggestNoAnswerFollowUp(opts.now || new Date(), {
        preferredHour,
    });

    /** Jours jusqu’au jour de pic ouvré (pour chips calendrier), sinon relanceDays. */
    let suggestedScheduleDays = relanceDays;
    if (
        preferredDay
        && Number.isFinite(preferredDay.day)
        && preferredDay.day >= 1
        && preferredDay.day <= 5
    ) {
        const until = daysUntilWeekday(preferredDay.day, opts.now || new Date());
        if (until >= 1 && until <= 7) suggestedScheduleDays = until;
    }

    return {
        relanceDays,
        suggestedScheduleDays,
        preferredHour,
        preferredHourSource,
        preferredDay,
        noAnswerFollowUp,
        preferMorningCalls: preferredHour != null ? preferredHour < 12 : !!profile.preferMorningCalls,
        profile,
        confidence,
        peakHour,
        slotAvailable: !!slot?.available,
        slot,
        learnedSamples: learned.samples || null,
    };
}

/**
 * Brief accueil Relia.
 * @param {object[]} workspaces
 * @param {{ now?: Date }} [opts]
 */
export function getHomeBrief(workspaces, opts = {}) {
    const list = (workspaces || []).filter(Boolean);
    const slot = getProspectingBrief(workspaces, opts);
    let confidence = 0;
    if (list[0]) {
        confidence = safeProfile(list[0]).confidence;
    }
    return {
        slot,
        confidence,
        learning: !slot?.available,
    };
}

/**
 * Pulse workspace : objectif + coaching cloche (profil déjà fusionné).
 * @param {object} workspace
 * @param {{ now?: Date, dailyGoal?: number, workspaces?: object[] }} [opts]
 */
export function getWorkspaceIntel(workspace, opts = {}) {
    if (!workspace?.id) {
        return {
            contactsToday: 0,
            profile: null,
            confidence: 0,
            coaching: [],
            callDefaults: null,
        };
    }
    const { profile, confidence } = safeProfile(workspace);
    const contactsToday = safe("dailyContacts", () => countContactsToday(workspace, opts.now), 0);
    const callDefaults = getCallDefaults(workspace, opts);
    const coaching = safe("followupNotifs", () => getWorkspaceFollowupNotifs(workspace, {
        now: opts.now,
        dailyGoal: opts.dailyGoal,
        profile,
    }), []);
    return {
        contactsToday,
        profile,
        confidence,
        coaching,
        callDefaults,
    };
}

/**
 * Intel fiche lead : yeux (vigilance) + voix (conseils dédupliqués) + mains (defaults).
 * @param {object} workspace
 * @param {string} leadId
 * @param {{ now?: Date, dailyGoal?: number, workspaces?: object[] }} [opts]
 */
export function getLeadIntel(workspace, leadId, opts = {}) {
    const lead = workspace?.leads?.[leadId];
    if (!lead?.id || !workspace?.id) {
        return {
            vigilance: null,
            conseils: [],
            relevance: null,
            callDefaults: null,
            slot: null,
            profile: null,
            confidence: 0,
        };
    }
    const now = opts.now ? new Date(opts.now) : new Date();
    const { profile, confidence } = safeProfile(workspace);
    const vigilance = safe("inconsistencyRules", () => getLeadVigilance(
        lead,
        workspace.columns || {},
        workspace.inconsistencyConfig,
        now
    ), { level: null, issues: [], criticalCount: 0, warningCount: 0, actionableCount: 0, score: 0 });
    const conseils = safe("followupNotifs", () => getLeadFollowupNotifs(workspace, leadId, {
        now,
        dailyGoal: opts.dailyGoal,
        profile,
    }), []);
    const callDefaults = getCallDefaults(workspace, opts);
    const slot = callDefaults.slot;
    // Cercle 6 : la vigilance passe AVANT la pertinence, qui se tait sur les
    // sujets déjà couverts (un gagné sans valeur n'est pas signalé deux fois).
    const relevance = getLeadRelevance(workspace, leadId, {
        now,
        vigilanceIssues: vigilance?.issues || [],
    });

    return {
        vigilance,
        conseils,
        relevance,
        callDefaults,
        slot,
        profile,
        confidence,
        kindBoost: (kind) => safe("usageMemory", () => learnedKindBoost(kind, workspace.id), 0),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION « INFORMATIONS PERTINENTES »
//
// Objectif : que la zone en haut de fiche dise quelque chose de VRAI et de
// PROPRE À CE PROSPECT, chiffré avec les données de l'utilisateur — pas un
// gabarit identique pour 400 leads.
//
// Trois sources, toutes apprises en prospectant :
//   argent      dealEconomics    — combien vaut ce prospect, à quelle proba
//   structure   structureLearning — champs / colonnes que l'utilisateur invente
//   rythme      byStage          — vitesse habituelle de CE stade
//
// Deux sorties distinctes, jamais mélangées :
//   facts   = constats chiffrés (on lit, on comprend, on décide)
//   actions = un geste à un clic qui améliore les données ET le pipeline
//
// Silence par défaut : sans échantillon suffisant, on ne dit rien plutôt que
// d'inventer une moyenne sur 1 deal.
// ═══════════════════════════════════════════════════════════════════════════

/** Constats affichés simultanément (le reste est du bruit). */
const MAX_FACTS = 3;
/** Actions proposées simultanément (une fiche n'est pas un formulaire). */
const MAX_ACTIONS = 2;

/** Économie du workspace, mémoïsée par identité d'objet. */
export function getWorkspaceEconomics(workspace) {
    if (!workspace?.id) return null;
    return memoByObject(econCache, workspace, () =>
        safe("dealEconomics", () => computeWorkspaceEconomics(workspace), null)
    );
}

/** Comportement réel des colonnes, y compris celles créées à la main. */
export function getColumnIntel(workspace) {
    if (!workspace?.id) return null;
    return memoByObject(columnIntelCache, workspace, () =>
        safe("structureLearning", () => computeColumnIntel(
            workspace,
            getWorkspaceEconomics(workspace),
            { columnCreatedAt: getLearnedColumnCreatedAt(workspace.id) }
        ), null)
    );
}

/** Détail lisible de la base de prix retenue pour ce prospect. */
function valueBasisDetail(estimate, econ) {
    const parts = [];
    if (estimate.basis === "unit" && estimate.unitDetail) {
        const u = estimate.unitDetail;
        parts.push(
            `${u.units} × ${fmtEur(u.ratePerUnit)} / ${u.label.toLowerCase()} appris sur ${u.samples} deals`
        );
    } else if (estimate.basis === "explicit") {
        parts.push(`montant saisi ${fmtEur(estimate.base)}`);
    } else if (estimate.basis === "median" && econ.valuedWonCount >= 2) {
        parts.push(`panier médian ${fmtEur(estimate.base)} sur ${econ.valuedWonCount} deals`);
    }
    if (estimate.probability != null && estimate.probabilitySource === "stage" && estimate.stageName) {
        parts.push(`${fmtPct(estimate.probability)} de close depuis « ${estimate.stageName} » (${estimate.stageSample} closés)`);
    } else if (estimate.probability != null && estimate.probabilitySource === "global") {
        parts.push(`${fmtPct(estimate.probability)} de close en moyenne`);
    }
    return parts.join(" · ");
}

/**
 * Algo dédié « Informations pertinentes » : ce que Relia sait de CE prospect
 * grâce à ce que l'utilisateur a réellement vendu, saisi et déplacé.
 *
 * @param {object} workspace
 * @param {string} leadId
 * @param {{ now?: Date, vigilanceIssues?: {id: string}[] }} [opts]
 * @returns {{
 *   available: boolean,
 *   learning: string|null,
 *   confidence: number,
 *   economics: object|null,
 *   facts: {id: string, label: string, detail: string, tone: string}[],
 *   actions: {id: string, kind: string, label: string, detail: string, payload: object, tone: string}[],
 * }}
 */
export function getLeadRelevance(workspace, leadId, opts = {}) {
    const lead = workspace?.leads?.[leadId];
    const empty = {
        available: false,
        learning: null,
        confidence: 0,
        economics: null,
        facts: [],
        actions: [],
    };
    if (!lead?.id || !workspace?.id) return empty;

    const now = opts.now ? new Date(opts.now) : new Date();
    const econ = getWorkspaceEconomics(workspace);
    if (!econ) return empty;

    // Cercle 4 étendu : si les yeux (vigilance) parlent déjà, la section se taît.
    const vigilanceIds = new Set((opts.vigilanceIssues || []).map((i) => i?.id).filter(Boolean));

    const facts = [];
    const actions = [];
    const pushFact = (id, label, detail, tone = "neutral", priority = 0) => {
        if (!label || facts.some((f) => f.id === id)) return;
        facts.push({ id, label, detail: detail || "", tone, priority });
    };
    const pushAction = (action) => {
        if (!action?.id || actions.some((a) => a.id === action.id)) return;
        actions.push({ tone: "neutral", priority: 0, ...action });
    };

    const isWon = lead.columnId === econ.wonColumnId;
    const isLost = lead.columnId === econ.lostColumnId;
    const estimate = safe("dealEconomics", () => estimateLeadValue(lead, econ, workspace), null);

    // ── 1. Combien vaut ce prospect, et pourquoi ────────────────────────────
    if (isWon) {
        const encaisse = Number(lead.dealValue) > 0 ? Number(lead.dealValue) : null;
        if (encaisse != null && econ.ltv != null && econ.clients >= 3) {
            const ratio = encaisse / econ.ltv;
            pushFact(
                "client_value",
                `Client à ${fmtEur(encaisse)}`,
                ratio >= 1.25
                    ? `${Math.round(ratio * 10) / 10}× ton client moyen (${fmtEur(econ.ltv)} sur ${econ.clients} clients)`
                    : ratio <= 0.75
                        ? `Sous ton client moyen (${fmtEur(econ.ltv)} sur ${econ.clients} clients)`
                        : `Dans ta moyenne (${fmtEur(econ.ltv)} sur ${econ.clients} clients)`,
                ratio >= 1.25 ? "ok" : "neutral",
                90
            );
        }
    } else if (!isLost && estimate?.expected != null && econ.confidence > 0) {
        const detail = valueBasisDetail(estimate, econ);
        pushFact(
            "expected_value",
            `Vaut ≈ ${fmtEur(estimate.expected)}`,
            detail,
            estimate.basis === "unit" || (estimate.vsMedian ?? 1) >= 1.3 ? "ok" : "neutral",
            estimate.basis === "unit" ? 95 : 80
        );
        // Gros ticket → mérite d'être traité avant les autres
        if (estimate.vsMedian != null && estimate.vsMedian >= 1.5 && estimate.basis !== "median") {
            pushFact(
                "big_ticket",
                `Gros ticket · ${Math.round(estimate.vsMedian * 10) / 10}× ton panier`,
                `Médiane de tes deals : ${fmtEur(econ.medianDeal)}`,
                "ok",
                85
            );
        }
    }

    // ── 2. Segment appris : ce type de prospect gagne-t-il chez toi ? ───────
    const segments = safe("dealEconomics", () => matchLeadSegments(lead, econ), []);
    const bestSegment = segments[0] || null;
    if (bestSegment) {
        const better = bestSegment.lift >= 1;
        pushFact(
            `segment:${bestSegment.label}`,
            better
                ? `« ${bestSegment.label} » convertit ${Math.round(bestSegment.lift * 10) / 10}× mieux`
                : `« ${bestSegment.label} » convertit ${Math.round((1 / bestSegment.lift) * 10) / 10}× moins`,
            `${fmtPct(bestSegment.winRate)} de closes sur ${bestSegment.closedSample} prospects de ce tag`,
            better ? "ok" : "warn",
            better ? 70 : 65
        );
    }

    // ── 3. Rythme : ce stade avance-t-il comme d'habitude ? ────────────────
    const stall = safe("dealEconomics", () => detectStageStall(lead, econ, now), null);
    const stallCoveredByVigilance = vigilanceIds.has("nouveau_stale") || vigilanceIds.has("no_answer_stale");
    if (stall && !stallCoveredByVigilance) {
        const colName = workspace.columns?.[lead.columnId]?.name || "cette étape";
        pushFact(
            "stage_stall",
            `${stall.days} j en « ${colName} »`,
            stall.usualNextName
                ? `Tes autres prospects en sortent en ${stall.medianDays} j · suite habituelle : « ${stall.usualNextName} »`
                : `Tes autres prospects en sortent en ${stall.medianDays} j`,
            "warn",
            75
        );
        // Pas d'action « Passer en … » : un clic auto déplacerait trop souvent à tort.
    }

    // ── 4. Effort : combien d'appels un gagné te demande-t-il ? ────────────
    if (!isWon && !isLost && econ.callsPerWon != null && econ.callsPerWon >= 1) {
        const calls = (lead.notes || []).filter((n) => /^(?:📞\s*Joint|📵\s*Pas de réponse)/iu.test(String(n?.text || "").trim())).length;
        if (calls >= 2 && calls >= econ.callsPerWon * 1.5) {
            pushFact(
                "effort_over",
                `${calls} appels ici`,
                `Un client te coûte ~${Math.round(econ.callsPerWon)} appels en moyenne`,
                "warn",
                60
            );
        }
    }

    // ── 5. Actions : uniquement un vrai trou métier, jamais un champ d'import ─
    // « Renseigner salaire_indicatif » (et co.) = bruit : un champ CSV vide l'est
    // souvent volontairement. On ne propose que ce qui débloque LTV / pipeline.
    if (isWon && !(Number(lead.dealValue) > 0) && !vigilanceIds.has("won_sans_valeur")) {
        pushAction({
            id: "set_deal_value",
            kind: "set_deal_value",
            label: "Chiffrer ce deal",
            detail: econ.missingValueWon > 1
                ? `${econ.missingValueWon} gagnés sans montant — ta LTV et tes stats sont sous-estimées`
                : "Sans montant, LTV et valeur par appel restent aveugles",
            payload: {},
            tone: "warn",
            priority: 100,
        });
    }

    facts.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    actions.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const available = facts.length > 0 || actions.length > 0;

    return {
        available,
        learning: null,
        confidence: econ.confidence,
        economics: {
            ltv: econ.ltv,
            clients: econ.clients,
            medianDeal: econ.medianDeal,
            conversionRate: econ.conversionRate,
            valuePerCall: econ.valuePerCall,
            callsPerWon: econ.callsPerWon,
            missingValueWon: econ.missingValueWon,
            estimate,
        },
        facts: facts.slice(0, MAX_FACTS),
        actions: actions.slice(0, MAX_ACTIONS),
    };
}

/**
 * Économie consolidée pour les KPI d'accueil — mêmes chiffres que la fiche,
 * donc aucun écart entre « ce que dit l'accueil » et « ce que dit le prospect ».
 * @param {object[]} workspaces
 */
export function getHomeEconomics(workspaces) {
    const list = (workspaces || []).filter(Boolean);
    if (!list.length) return null;
    return safe("dealEconomics", () => computeGlobalEconomics(list), null);
}

/**
 * Cloche globale / digests OS — passe par le cerveau.
 * @param {object[]} workspaces
 * @param {{ now?: Date, dailyGoal?: number }} [opts]
 */
export function getGlobalCoaching(workspaces, opts = {}) {
    return safe("followupNotifs", () => computeAllFollowupNotifs(workspaces, opts), []);
}

export function getGlobalUnreadCoaching(workspaces, seenItems, opts = {}) {
    return safe("followupNotifs", () => computeAllUnreadNotifs(workspaces, seenItems, opts), []);
}

/**
 * Santé système (debug / réglages) : état Whisper + confiance apprentissage.
 * @param {object[]} [workspaces]
 */
export function getSystemHealth(workspaces = []) {
    const first = (workspaces || []).find(Boolean) || null;
    return {
        whisper: safe("whisperGovernor", () => getGovernorStatus(), null),
        learning: first ? safeProfile(first).confidence : 0,
        degradedOrgans: [...warnedOrgans],
    };
}

/** Alias stables pour brancher OS / cloche sans casser les imports existants. */
export {
    getAllFollowupNotifs,
    getAllUnreadNotifs,
    markAllNotifsRead,
    markNotifItemRead,
} from "@/lib/followupNotifs";

/** Ré-exports utiles pour migration progressive (UI → brain only). */
export {
    resolveCoachingProfile,
    countContactsToday,
    getLeadVigilance,
    getSuggestedRelanceDays,
    getLearnedPreferredHour,
    fmtEur,
    fmtPct,
};
