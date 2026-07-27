/**
 * Créneau de prospection — pondéré par récence.
 * Les appels récents pèsent beaucoup plus que les vieux « acquis »
 * pour que le conseil évolue en continu.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_FULL = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const DAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

/** Demi-vie : un appel d'il y a halfLifeDays pèse 50 % d'un appel d'aujourd'hui. */
const HALF_LIFE_DAYS = 9;
/** Au-delà : quasi ignoré (garde un filet faible). */
const HARD_CUTOFF_DAYS = 45;
/** Poids minimum pour qu'un créneau soit candidat (~2 appels récents). */
const MIN_WEIGHT = 1.6;

/**
 * Extrait les événements d'appel (📞 / 📵) depuis les workspaces.
 */
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

/** Poids exponentiel selon l'âge (jours). */
function recencyWeight(ageDays) {
    if (ageDays < 0) return 1;
    if (ageDays > HARD_CUTOFF_DAYS) return Math.exp(-HARD_CUTOFF_DAYS / HALF_LIFE_DAYS) * 0.15;
    return Math.exp(-ageDays / HALF_LIFE_DAYS);
}

/**
 * Borne inférieure de Wilson sur taux (évite qu'un créneau à 1/1 batte 8/10).
 * @param {number} successes
 * @param {number} n
 */
function wilsonLower(successes, n, z = 1.0) {
    if (!(n > 0)) return 0;
    const p = Math.min(1, Math.max(0, successes / n));
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, (centre - margin) / denom);
}

/**
 * Agrège des buckets { weight, answeredWeight }.
 */
function pickBest(buckets, mapFn) {
    let best = null;
    for (const [key, { w, wa }] of buckets.entries()) {
        if (w < MIN_WEIGHT) continue;
        const rate = (wa / w) * 100;
        const score = wilsonLower(wa, w) * 100;
        const entry = mapFn(key, { w, wa, rate, score });
        if (!best || entry.score > best.score || (entry.score === best.score && entry.total > best.total)) {
            best = entry;
        }
    }
    return best;
}

/**
 * @param {object[]} workspaces
 * @param {{ now?: Date }} [opts]
 * @returns {{
 *   bestHour: { hour: number, rate: number, total: number } | null,
 *   bestDay: { day: number, label: string, rate: number, total: number } | null,
 *   shortLabel: string,
 *   detailLabel: string,
 *   sampleWeight: number,
 *   windowLabel: string,
 * } | null}
 */
export function getBestProspectingSlot(workspaces, opts = {}) {
    if (!workspaces?.length) return null;

    const now = opts.now ? new Date(opts.now) : new Date();
    const nowMs = now.getTime();
    const events = extractCallEvents(workspaces);
    if (!events.length) return null;

    const byHour = new Map();
    const byDay = new Map();
    let sampleWeight = 0;

    for (const e of events) {
        const ageDays = (nowMs - e.at.getTime()) / DAY_MS;
        const w = recencyWeight(ageDays);
        if (w < 0.02) continue;
        sampleWeight += w;

        const hour = e.at.getHours();
        const day = e.at.getDay();
        const hBucket = byHour.get(hour) || { w: 0, wa: 0 };
        hBucket.w += w;
        if (e.answered) hBucket.wa += w;
        byHour.set(hour, hBucket);

        const dBucket = byDay.get(day) || { w: 0, wa: 0 };
        dBucket.w += w;
        if (e.answered) dBucket.wa += w;
        byDay.set(day, dBucket);
    }

    if (sampleWeight < MIN_WEIGHT * 0.75) return null;

    const bestHourRaw = pickBest(byHour, (hour, { w, rate, score }) => ({
        hour,
        rate,
        total: Math.round(w * 10) / 10,
        score,
    }));
    const bestDayRaw = pickBest(byDay, (day, { w, rate, score }) => ({
        day,
        label: DAY_SHORT[day],
        rate,
        total: Math.round(w * 10) / 10,
        score,
    }));

    const bestHour = bestHourRaw
        ? { hour: bestHourRaw.hour, rate: bestHourRaw.rate, total: bestHourRaw.total }
        : null;
    const bestDay = bestDayRaw
        ? {
            day: bestDayRaw.day,
            label: bestDayRaw.label,
            rate: bestDayRaw.rate,
            total: bestDayRaw.total,
        }
        : null;

    if (!bestHour && !bestDay) return null;

    const partsShort = [];
    const partsDetail = [];

    if (bestDay) {
        const name = DAY_FULL[bestDay.day] || bestDay.label;
        partsShort.push(name.slice(0, 3) + ".");
        partsDetail.push(
            `${name} (~${Math.round(bestDay.rate)} % décroché · poids récent ${bestDay.total})`
        );
    }
    if (bestHour) {
        const h = bestHour.hour;
        const slot = `${String(h).padStart(2, "0")}–${String((h + 1) % 24).padStart(2, "0")}h`;
        partsShort.push(slot);
        partsDetail.push(
            `${slot} (~${Math.round(bestHour.rate)} % décroché · poids récent ${bestHour.total})`
        );
    }

    return {
        bestHour,
        bestDay,
        shortLabel: partsShort.join(" · "),
        detailLabel: `${partsDetail.join(" · ")} — recalculé en continu (appels récents priorisés)`,
        sampleWeight,
        windowLabel: `demi-vie ${HALF_LIFE_DAYS} j`,
    };
}
