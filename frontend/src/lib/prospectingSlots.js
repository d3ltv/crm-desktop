/**
 * Créneau de prospection — pondéré par récence.
 * Bucket joint jour×heure (pas d’axes indépendants).
 * Signal faible → message d’apprentissage, pas de créneau absurde.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_FULL = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const DAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

const HALF_LIFE_DAYS = 9;
const HARD_CUTOFF_DAYS = 45;
/** Poids min pour un créneau joint (jour×heure). */
const MIN_BUCKET_WEIGHT = 1.8;
const MIN_SAMPLE_WEIGHT = 4.5;
const MIN_RAW_EVENTS = 6;
const HOUR_MIN = 8;
const HOUR_MAX = 20;

const LEARNING_SHORT = "Pas encore assez de données";
const LEARNING_DETAIL =
    "Continuez à noter vos appels (joint / NRP) — le créneau à prioriser s’affichera ici dès qu’il y aura assez de signal.";

function extractCallEvents(workspaces) {
    const events = [];
    for (const ws of workspaces || []) {
        for (const lead of Object.values(ws.leads || {})) {
            for (const note of lead.notes || []) {
                const text = note.text || "";
                const isCall = text.includes("📞") || text.includes("📵");
                if (!isCall) continue;
                const at = note.at ? new Date(note.at) : null;
                if (!at || Number.isNaN(at.getTime())) continue;
                events.push({
                    at,
                    answered: text.includes("📞"),
                });
            }
        }
    }
    return events;
}

function recencyWeight(ageDays) {
    if (ageDays < 0) return 1;
    if (ageDays > HARD_CUTOFF_DAYS) return Math.exp(-HARD_CUTOFF_DAYS / HALF_LIFE_DAYS) * 0.15;
    return Math.exp(-ageDays / HALF_LIFE_DAYS);
}

function wilsonLower(successes, n, z = 1.0) {
    if (!(n > 0)) return 0;
    const p = Math.min(1, Math.max(0, successes / n));
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, (centre - margin) / denom);
}

function pickBest(buckets, mapFn, minWeight = MIN_BUCKET_WEIGHT) {
    let best = null;
    for (const [key, { w, wa }] of buckets.entries()) {
        if (w < minWeight) continue;
        const rate = (wa / w) * 100;
        const score = wilsonLower(wa, w) * 100;
        const entry = mapFn(key, { w, wa, rate, score });
        if (!best || entry.score > best.score || (entry.score === best.score && entry.total > best.total)) {
            best = entry;
        }
    }
    return best;
}

function learningResult(reason) {
    return {
        available: false,
        bestHour: null,
        bestDay: null,
        shortLabel: LEARNING_SHORT,
        detailLabel: LEARNING_DETAIL,
        sampleWeight: 0,
        windowLabel: `demi-vie ${HALF_LIFE_DAYS} j`,
        reason: reason || "insufficient",
    };
}

/**
 * @param {object[]} workspaces
 * @param {{ now?: Date }} [opts]
 */
export function getBestProspectingSlot(workspaces, opts = {}) {
    if (!workspaces?.length) return null;

    const now = opts.now ? new Date(opts.now) : new Date();
    const nowMs = now.getTime();
    const events = extractCallEvents(workspaces);
    if (!events.length) return learningResult("no_calls");

    /** @type {Map<string, { w: number, wa: number, day: number, hour: number }>} */
    const bySlot = new Map();
    let sampleWeight = 0;
    let rawRecent = 0;

    for (const e of events) {
        const ageDays = (nowMs - e.at.getTime()) / DAY_MS;
        const w = recencyWeight(ageDays);
        if (w < 0.02) continue;
        sampleWeight += w;
        rawRecent += 1;

        const hour = e.at.getHours();
        const day = e.at.getDay();
        if (hour < HOUR_MIN || hour > HOUR_MAX) continue;

        const key = `${day}:${hour}`;
        const bucket = bySlot.get(key) || { w: 0, wa: 0, day, hour };
        bucket.w += w;
        if (e.answered) bucket.wa += w;
        bySlot.set(key, bucket);
    }

    if (rawRecent < MIN_RAW_EVENTS || sampleWeight < MIN_SAMPLE_WEIGHT) {
        return learningResult("thin_sample");
    }

    const bestRaw = pickBest(bySlot, (key, { w, rate, score }) => {
        const [dayStr, hourStr] = String(key).split(":");
        const day = Number(dayStr);
        const hour = Number(hourStr);
        return {
            day,
            hour,
            rate,
            total: Math.round(w * 10) / 10,
            score,
        };
    });

    if (!bestRaw) return learningResult("incomplete_signal");

    const bestHour = {
        hour: bestRaw.hour,
        rate: bestRaw.rate,
        total: bestRaw.total,
    };
    const bestDay = {
        day: bestRaw.day,
        label: DAY_SHORT[bestRaw.day],
        rate: bestRaw.rate,
        total: bestRaw.total,
    };

    const dayName = DAY_FULL[bestDay.day] || bestDay.label;
    const h = bestHour.hour;
    const slot = `${String(h).padStart(2, "0")}–${String((h + 1) % 24).padStart(2, "0")}h`;

    return {
        available: true,
        bestHour,
        bestDay,
        shortLabel: `${dayName.slice(0, 3)}. · ${slot}`,
        detailLabel:
            `${dayName} ${slot} (~${Math.round(bestHour.rate)} % décroché · poids ${bestHour.total}) — créneau réellement observé`,
        sampleWeight,
        windowLabel: `demi-vie ${HALF_LIFE_DAYS} j`,
        reason: "ok",
    };
}
