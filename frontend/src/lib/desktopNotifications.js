/**
 * desktopNotifications.js — Notifications macOS natives (Relia / Tauri).
 *
 * Calendrier = agenda. OS = digest des recommandations (oublis / coaching),
 * jamais 1 bannière par RDV du jour.
 *
 * Brief du matin (8h) : recalcule les conseils selon l’état actuel des leads
 * et chaque vue (niche), pousse un digest OS, et notifie l’UI cloche.
 */

import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauri } from "@/lib/diskStorage";
import { flushDesktopStorageNow } from "@/lib/desktopLocalStorage";
import { toLocalDateKey } from "@/lib/dateUtils";
import {
    getAllUnreadNotifs,
} from "@/lib/followupNotifs";

const SENT_KEY = "crm_os_notif_sent_v1";
const COOLDOWN_MS = 45 * 60 * 1000; // 45 min entre digests reco « au fil de l’eau »
export const MORNING_HOUR = 8;
export const MORNING_MINUTE = 0;
/** UI + scheduler : rafraîchir les recommandations du jour */
export const DAILY_RECO_REFRESH_EVENT = "crm_daily_reco_refresh";

let morningTimer = null;
let morningStarted = false;

function loadSentMap() {
    try {
        return JSON.parse(localStorage.getItem(SENT_KEY) || "{}") || {};
    } catch {
        return {};
    }
}

function saveSentMap(map) {
    try {
        const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 200);
        localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(entries)));
        flushDesktopStorageNow();
    } catch { /* ignore */ }
}

export async function ensureNotificationPermission() {
    if (!isTauri()) return false;
    try {
        let granted = await isPermissionGranted();
        if (!granted) {
            const perm = await requestPermission();
            granted = perm === "granted";
        }
        return granted;
    } catch (err) {
        console.warn("[Relia Notif] permission:", err);
    }
    return false;
}

/**
 * Prochaine occurrence locale de hour:minute (si déjà passé → demain).
 * @param {number} [hour]
 * @param {number} [minute]
 * @param {Date} [now]
 */
export function nextMorningAt(hour = MORNING_HOUR, minute = MORNING_MINUTE, now = new Date()) {
    const next = new Date(now.getTime());
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
    }
    return next;
}

export function msUntilNextMorning(hour = MORNING_HOUR, minute = MORNING_MINUTE, now = new Date()) {
    return Math.max(1000, nextMorningAt(hour, minute, now).getTime() - now.getTime());
}

export function isPastMorningToday(hour = MORNING_HOUR, minute = MORNING_MINUTE, now = new Date()) {
    const gate = new Date(now.getTime());
    gate.setHours(hour, minute, 0, 0);
    return now.getTime() >= gate.getTime();
}

/** Force le recalcul UI des recommandations (cloche, badges). */
export function emitDailyRecoRefresh(reason = "tick") {
    try {
        window.dispatchEvent(
            new CustomEvent(DAILY_RECO_REFRESH_EVENT, {
                detail: { reason, at: new Date().toISOString() },
            })
        );
    } catch { /* ignore */ }
}

function buildDigestCopy(items) {
    if (items.length === 1) {
        const it = items[0];
        const company = it.lead?.company;
        return {
            title: it.title ? `Relia · ${it.title}` : "Relia · Conseil",
            body: company ? `${company} — ${it.label}` : it.label,
        };
    }
    const overdue = items.filter((x) => x.overdue).length;
    if (overdue > 0) {
        return {
            title: "Relia · À regarder",
            body: `${overdue} oubli${overdue > 1 ? "s" : ""} · ${items.length} conseil${items.length > 1 ? "s" : ""}`,
        };
    }
    return {
        title: "Relia · Conseils",
        body: `${items.length} recommandation${items.length > 1 ? "s" : ""} pour ta prospection`,
    };
}

/**
 * Brief matinal : résumé par vue + état leads courant.
 * @param {import('@/lib/followupNotifs').NotifItem[]} items
 */
function buildMorningDigestCopy(items) {
    if (items.length === 0) {
        return {
            title: "Relia · Bonne journée",
            body: "Rien d’urgent — bon pipeline pour aujourd’hui",
        };
    }

    const byWs = new Map();
    for (const it of items) {
        const name = it.workspaceName || "Vue";
        byWs.set(name, (byWs.get(name) || 0) + 1);
    }
    const parts = [...byWs.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, n]) => `${n} sur « ${name} »`);

    const overdue = items.filter((x) => x.overdue).length;
    const rdv = items.filter((x) => x.kind === "suggest_rdv" || x.kind === "meeting_sans_rdv").length;

    let focus = "";
    if (rdv > 0) focus = ` · ${rdv} ${rdv > 1 ? "RDV à poser" : "RDV à poser"}`;
    else if (overdue > 0) focus = ` · ${overdue} prioritaire${overdue > 1 ? "s" : ""}`;

    return {
        title: "Relia · Brief du matin",
        body: parts.length > 0
            ? `${items.length} conseil${items.length > 1 ? "s" : ""} — ${parts.join(" · ")}${focus}`
            : `${items.length} recommandation${items.length > 1 ? "s" : ""} pour la journée${focus}`,
    };
}

function collectPending(state) {
    const workspaces = Object.values(state.workspaces || {}).filter(Boolean);
    return getAllUnreadNotifs(workspaces, undefined, {
        dailyGoal: state.settings?.dailyGoal || 20,
    });
}

/**
 * @param {object} state — état CRM complet
 * @param {{ force?: boolean }} [opts]
 */
export async function pushDesktopFollowupNotifications(state, opts = {}) {
    if (!isTauri() || !state?.workspaces) return;

    const granted = await ensureNotificationPermission();
    if (!granted) {
        console.info("[Relia Notif] Permission refusée — activez Relia dans Réglages > Notifications.");
        return;
    }

    const pending = collectPending(state);
    if (pending.length === 0) return;

    const todayKey = toLocalDateKey(new Date());
    const sent = loadSentMap();
    const now = Date.now();

    // Brief du matin déjà envoyé → cooldown classique
    if (!opts.force) {
        const lastDigest = sent[`reco:${todayKey}`] || 0;
        if (now - lastDigest < COOLDOWN_MS) return;
    }

    const { title, body } = buildDigestCopy(pending);

    try {
        await Promise.resolve(sendNotification({ title, body }));
        sent[`reco:${todayKey}`] = now;
        saveSentMap(sent);
    } catch (err) {
        console.warn("[Relia Notif] send:", err);
    }
}

/**
 * Refresh 8h : UI + digest OS adapté aux vues / leads actuels.
 * Une fois par jour calendaire (clé morning:YYYY-MM-DD).
 * @param {object} state
 * @param {{ catchUp?: boolean }} [opts]
 */
export async function pushMorningRecoDigest(state, opts = {}) {
    if (!state?.workspaces) return false;

    const todayKey = toLocalDateKey(new Date());
    const sent = loadSentMap();
    const morningKey = `morning:${todayKey}`;

    if (sent[morningKey]) return false;
    if (opts.catchUp && !isPastMorningToday()) return false;

    // Toujours rafraîchir l’UI (même hors Tauri / sans permission)
    emitDailyRecoRefresh(opts.catchUp ? "morning-catchup" : "morning-8h");

    const pending = collectPending(state);

    // OS : seulement s’il y a des conseils du jour (évite spam « rien à faire »)
    if (pending.length > 0 && isTauri()) {
        const granted = await ensureNotificationPermission();
        if (granted) {
            const { title, body } = buildMorningDigestCopy(pending);
            try {
                await Promise.resolve(sendNotification({ title, body }));
            } catch (err) {
                console.warn("[Relia Notif] morning send:", err);
            }
        }
    }

    const now = Date.now();
    sent[morningKey] = now;
    // Évite un 2ᵉ digest « fil de l’eau » juste après le brief
    sent[`reco:${todayKey}`] = now;
    saveSentMap(sent);
    return true;
}

/**
 * Planifie le brief quotidien à 8h + rattrapage si l’app ouvre après 8h.
 * @param {() => object|null|undefined} getState
 */
export function startMorningRecoScheduler(getState) {
    if (morningStarted) return;
    morningStarted = true;

    const runMorning = () => {
        try {
            const state = typeof getState === "function" ? getState() : null;
            if (state) {
                pushMorningRecoDigest(state).catch((err) => {
                    console.warn("[Relia Notif] morning:", err);
                });
            } else {
                emitDailyRecoRefresh("morning-8h");
            }
        } finally {
            scheduleNext();
        }
    };

    const scheduleNext = () => {
        if (morningTimer != null) {
            clearTimeout(morningTimer);
            morningTimer = null;
        }
        const wait = msUntilNextMorning();
        morningTimer = setTimeout(runMorning, wait);
    };

    // Rattrapage : app ouverte après 8h, brief pas encore poussé aujourd’hui
    try {
        const state = typeof getState === "function" ? getState() : null;
        if (state) {
            pushMorningRecoDigest(state, { catchUp: true }).catch(() => {});
        }
    } catch { /* ignore */ }

    scheduleNext();
}

export function stopMorningRecoScheduler() {
    morningStarted = false;
    if (morningTimer != null) {
        clearTimeout(morningTimer);
        morningTimer = null;
    }
}
