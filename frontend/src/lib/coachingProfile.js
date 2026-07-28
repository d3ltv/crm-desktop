/**
 * coachingProfile.js — Fusion niche (recoProfile) + apprentissage (usageMemory).
 * Organe pur : pas d’UI, pas de notifs. Le cerveau Relia l’appelle via resolveCoachingProfile.
 */

import { getWorkspaceRecoProfile } from "@/lib/recoProfile";
import { getLearnedRecoOverrides } from "@/lib/usageMemory";

const LEARNED_META = new Set(["confidence", "peakHour", "kindAffinity", "samples"]);

/**
 * @param {object} workspace
 * @returns {{
 *   profile: import('./recoProfile').RecoProfile,
 *   learned: ReturnType<typeof getLearnedRecoOverrides>,
 *   confidence: number,
 *   peakHour: number|null,
 * }}
 */
export function resolveCoachingProfile(workspace) {
    const base = getWorkspaceRecoProfile(workspace);
    const learned = getLearnedRecoOverrides(workspace?.id);
    const confidence = learned.confidence || 0;

    if (confidence < 0.12) {
        return {
            profile: base,
            learned,
            confidence,
            peakHour: learned.peakHour ?? null,
        };
    }

    const patch = Object.fromEntries(
        Object.entries(learned).filter(([k, v]) => !LEARNED_META.has(k) && v !== undefined)
    );

    return {
        profile: { ...base, ...patch },
        learned,
        confidence,
        peakHour: learned.peakHour ?? null,
    };
}
