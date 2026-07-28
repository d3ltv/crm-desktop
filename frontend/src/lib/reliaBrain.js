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
 *
 * Cercles vertueux (gérés ICI, pas dans les organes)
 * ───────────────────────────────────────────────────
 *  1. créneau observé ⊕ peak appris → heure préférée des rappels
 *  2. délais appris ⊕ niche → jours de relance post-joint
 *  3. créneau.bestDay → biais calendrier (jour cible)
 *  4. vigilance ⊕ conseils → dédup sur la fiche (voix se tait si yeux parlent)
 *  5. pulse contacts → tip_goal aligné widget objectif
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
} from "@/lib/usageMemory";
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

    return {
        vigilance,
        conseils,
        callDefaults,
        slot,
        profile,
        confidence,
        kindBoost: (kind) => safe("usageMemory", () => learnedKindBoost(kind, workspace.id), 0),
    };
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
};
