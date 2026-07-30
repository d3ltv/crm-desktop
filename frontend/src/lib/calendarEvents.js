/**
 * Agrégation d'événements calendrier CRM — leads + événements libres (standaloneEvents).
 * Orientation prospection : uniquement ce qu'il reste à faire (RDV, relances, rappels),
 * pas l'historique des contacts déjà passés.
 */

import { toLocalDateKey } from "@/lib/dateUtils";
import { flushDesktopStorageNow } from "@/lib/desktopLocalStorage";
import { isManualRdv, isCalendarReminder } from "@/lib/nextActionUtils";
import {
    isWonColumn,
    isLostColumn,
} from "@/constants/columnPatterns";
import { normalizeInconsistencyConfig } from "@/lib/inconsistencyRules";

/** @typedef {'rdv'|'relance'|'rappel'|'surveillance'|'event'} CalendarEventType */

export const CALENDAR_EVENT_META = {
    rdv: {
        label: "RDV",
        color: "bg-blue-500",
        text: "text-blue-700 dark:text-blue-300",
        chip: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25",
        dot: "bg-blue-500",
    },
    relance: {
        label: "Relance",
        color: "bg-amber-500",
        text: "text-amber-800 dark:text-amber-300",
        chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25",
        dot: "bg-amber-500",
    },
    rappel: {
        label: "Rappel",
        color: "bg-violet-500",
        text: "text-violet-700 dark:text-violet-300",
        chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25",
        dot: "bg-violet-500",
    },
    event: {
        label: "Événement",
        color: "bg-slate-500",
        text: "text-slate-700 dark:text-slate-300",
        chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/25",
        dot: "bg-slate-500",
    },
    surveillance: {
        label: "À surveiller",
        color: "bg-rose-500",
        text: "text-rose-700 dark:text-rose-300",
        chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25",
        dot: "bg-rose-500",
    },
};

function calendarDaysBetween(fromIso, toDate = new Date()) {
    const a = toLocalDateKey(fromIso);
    const b = toLocalDateKey(toDate);
    if (!a || !b) return 0;
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    const start = Date.UTC(ay, am - 1, ad);
    const end = Date.UTC(by, bm - 1, bd);
    return Math.max(0, Math.round((end - start) / 86400000));
}

function latestActivityIso(lead) {
    let max = 0;
    if (lead.lastContact) {
        const t = new Date(lead.lastContact).getTime();
        if (Number.isFinite(t)) max = Math.max(max, t);
    }
    for (const n of lead.notes || []) {
        const t = new Date(n.at).getTime();
        if (Number.isFinite(t)) max = Math.max(max, t);
    }
    for (const r of lead.relances || []) {
        const t = new Date(r.at).getTime();
        if (Number.isFinite(t)) max = Math.max(max, t);
    }
    return max > 0 ? new Date(max).toISOString() : (lead.createdAt || null);
}

function isTerminalLead(lead, columns) {
    const name = columns?.[lead.columnId]?.name || "";
    return isWonColumn(name) || isLostColumn(name);
}

function pushEvent(out, event) {
    if (!event?.dateKey) return;
    if (!event.leadId && !event.standalone) return;
    out.push(event);
}

/**
 * @param {object[]} workspaces
 * @param {{ now?: Date, standaloneEvents?: object[] }} [opts]
 * @returns {object[]}
 */
export function collectCalendarEvents(workspaces, { now = new Date(), standaloneEvents = [] } = {}) {
    const out = [];
    const todayKey = toLocalDateKey(now);

    for (const ws of workspaces || []) {
        if (!ws) continue;
        const columns = ws.columns || {};
        const config = normalizeInconsistencyConfig(ws.inconsistencyConfig);
        const gapThreshold = Math.max(7, config.thresholds?.contactGapDays || 21);

        for (const lead of Object.values(ws.leads || {})) {
            if (!lead || lead.archived) continue;
            if (isTerminalLead(lead, columns)) continue;

            const company = lead.company || "Sans nom";
            const base = {
                workspaceId: ws.id,
                workspaceName: ws.name || "Espace",
                leadId: lead.id,
                company,
            };

            // ── nextAction (RDV / rappel / relance planifiée) ────────────────
            const na = lead.nextAction;
            if (na) {
                const dueAt = na.dueAt || (na.date ? `${na.date}T09:00:00` : null);
                const dateKey = toLocalDateKey(dueAt || na.date);
                if (dateKey) {
                    let type = "rappel";
                    if (isManualRdv(na)) type = "rdv";
                    else if (na.auto) type = "relance";
                    else if (isCalendarReminder(na)) type = "rappel";

                    pushEvent(out, {
                        ...base,
                        id: `${ws.id}:${lead.id}:next:${dateKey}`,
                        type,
                        dateKey,
                        dueAt: dueAt || null,
                        title: company,
                        subtitle: na.label || CALENDAR_EVENT_META[type].label,
                        meta: { source: "nextAction" },
                    });
                }
            }

            // ── autoFollowup (si pas déjà couvert par nextAction.auto même jour) ─
            const fu = lead.autoFollowup;
            if (fu?.dueAt) {
                const dateKey = toLocalDateKey(fu.dueAt);
                const already =
                    na?.auto
                    && toLocalDateKey(na.dueAt || na.date) === dateKey;
                if (dateKey && !already) {
                    pushEvent(out, {
                        ...base,
                        id: `${ws.id}:${lead.id}:fu:${dateKey}`,
                        type: "relance",
                        dateKey,
                        dueAt: fu.dueAt,
                        title: company,
                        subtitle: `Relance auto · étape ${fu.stage || 1}/3`,
                        meta: { source: "autoFollowup", stage: fu.stage, overdue: !!fu.overdue },
                    });
                }
            }

            // ── Surveillance (panneau « À surveiller », pas la grille du jour) ─
            const lastIso = latestActivityIso(lead);
            const days = lastIso
                ? calendarDaysBetween(lastIso, now)
                : calendarDaysBetween(lead.createdAt, now);
            if (days >= gapThreshold) {
                pushEvent(out, {
                    ...base,
                    id: `${ws.id}:${lead.id}:watch`,
                    type: "surveillance",
                    dateKey: todayKey,
                    dueAt: null,
                    title: company,
                    subtitle: `Sans contact depuis ${days} j`,
                    meta: { source: "surveillance", daysSince: days, threshold: gapThreshold },
                });
            }
        }
    }

    // Événements libres (sans fiche)
    for (const ev of standaloneEvents || []) {
        if (!ev) continue;
        const dateKey = toLocalDateKey(ev.dueAt || ev.date);
        if (!dateKey) continue;
        const type = ev.type === "rdv" ? "rdv" : "event";
        pushEvent(out, {
            id: `standalone:${ev.id}`,
            workspaceId: ev.workspaceId || null,
            workspaceName: null,
            leadId: null,
            company: null,
            standalone: true,
            standaloneId: ev.id,
            type,
            dateKey,
            dueAt: ev.dueAt || null,
            title: ev.label || CALENDAR_EVENT_META[type].label,
            subtitle: CALENDAR_EVENT_META[type].label,
            meta: { source: "standalone" },
        });
    }

    out.sort((a, b) => {
        const dk = a.dateKey.localeCompare(b.dateKey);
        if (dk !== 0) return dk;
        const ta = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        const tb = b.dueAt ? new Date(b.dueAt).getTime() : 0;
        return ta - tb;
    });

    return out;
}

/** Events pour une date YYYY-MM-DD (hors surveillance, ou surveillance si jour = today). */
export function eventsForDate(events, dateKey, { includeSurveillance = true } = {}) {
    return (events || []).filter((e) => {
        if (e.dateKey !== dateKey) return false;
        if (e.type === "surveillance" && !includeSurveillance) return false;
        return true;
    });
}

/**
 * Agenda d’un jour : events du jour + (si jour = aujourd’hui) les actions en retard.
 */
export function agendaEventsForDate(events, dateKey, { todayKey, includeSurveillance = false } = {}) {
    const today = todayKey || toLocalDateKey(new Date());
    const list = [];
    const seenLeads = new Set();

    const pushUnique = (e) => {
        if (e.type === "surveillance" && !includeSurveillance) return;
        // Standalone : clé unique par id (sinon tous les rappels libres du jour collapsent)
        const key = e.standalone || !e.leadId
            ? `standalone:${e.standaloneId || e.id}`
            : `${e.workspaceId}:${e.leadId}:${e.type}`;
        if (seenLeads.has(key)) return;
        seenLeads.add(key);
        list.push(e);
    };

    for (const e of events || []) {
        if (e.dateKey === dateKey) pushUnique(e);
    }

    if (dateKey === today) {
        for (const e of events || []) {
            if (e.type === "surveillance") continue;
            if (e.dateKey < today) {
                pushUnique({ ...e, meta: { ...(e.meta || {}), overdueCarry: true } });
            }
        }
    }

    list.sort((a, b) => {
        const aOver = a.dateKey < today || a.meta?.overdueCarry ? 0 : 1;
        const bOver = b.dateKey < today || b.meta?.overdueCarry ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        const ta = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        const tb = b.dueAt ? new Date(b.dueAt).getTime() : 0;
        return ta - tb;
    });

    return list;
}

export function surveillanceEvents(events) {
    return (events || []).filter((e) => e.type === "surveillance");
}

const CALENDAR_SEEN_KEY = "crm_calendar_seen_v1";
export const CALENDAR_SEEN_EVENT = "crm_calendar_seen_changed";

/**
 * Clé stable pour une échéance calendrier (badge / Tout lire).
 * Inclut la date due : une replanif. réaffiche l’item.
 * @param {object} e
 */
export function calendarActionableKey(e) {
    if (!e) return "";
    if (e.standalone || !e.leadId) {
        return `standalone:${e.standaloneId || e.id}:${e.dateKey || ""}`;
    }
    return `${e.workspaceId}:${e.leadId}:${e.dateKey}:${e.type || "item"}`;
}

/**
 * Clé de dédup badge (1 pastille par lead / standalone, comme avant).
 * @param {object} e
 */
export function calendarDedupKey(e) {
    if (!e) return "";
    if (e.standalone || !e.leadId) {
        return `standalone:${e.standaloneId || e.id}`;
    }
    return `${e.workspaceId}:${e.leadId}`;
}

export function loadCalendarSeenMap() {
    try {
        const raw = localStorage.getItem(CALENDAR_SEEN_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveCalendarSeenMap(map) {
    try {
        // Garde les ~400 plus récents (valeur = timestamp)
        const entries = Object.entries(map || {})
            .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
            .slice(0, 400);
        localStorage.setItem(CALENDAR_SEEN_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* ignore */ }
    try {
        window.dispatchEvent(new Event(CALENDAR_SEEN_EVENT));
    } catch { /* ignore */ }
}

export function isCalendarActionableUnread(e, seenMap = loadCalendarSeenMap()) {
    const key = calendarActionableKey(e);
    if (!key) return false;
    return !seenMap[key];
}

/**
 * Liste des dues aujourd'hui + en retard (hors surveillance), dédupliquées par lead.
 * @param {object[]} events
 * @param {Date} [now]
 */
export function listActionableToday(events, now = new Date()) {
    const todayKey = toLocalDateKey(now);
    const out = [];
    const dedup = new Set();
    for (const e of events || []) {
        if (e.type === "surveillance") continue;
        if (e.dateKey > todayKey) continue;
        const dkey = calendarDedupKey(e);
        if (dedup.has(dkey)) continue;
        dedup.add(dkey);
        out.push(e);
    }
    return out;
}

/**
 * Compte dues aujourd'hui + en retard (rdv / relance / rappel).
 * Déduplique par lead. Ignore les items marqués lus (persistés).
 * @param {object[]} events
 * @param {Date} [now]
 * @param {Record<string, number|boolean>} [seenMap]
 */
export function countActionableToday(events, now = new Date(), seenMap = loadCalendarSeenMap()) {
    let n = 0;
    for (const e of listActionableToday(events, now)) {
        if (isCalendarActionableUnread(e, seenMap)) n += 1;
    }
    return n;
}

/**
 * Marque comme lues toutes les échéances dues / en retard actuelles.
 * Persiste dans prefs (crm_prefs via shim) → survit à la fermeture.
 * @param {object[]} events
 * @param {Date} [now]
 */
export function markCalendarActionablesRead(events, now = new Date()) {
    const map = loadCalendarSeenMap();
    const ts = Date.now();
    let changed = false;
    for (const e of listActionableToday(events, now)) {
        const key = calendarActionableKey(e);
        if (!key || map[key]) continue;
        map[key] = ts;
        changed = true;
    }
    if (changed) {
        saveCalendarSeenMap(map);
        // Flush immédiat des prefs (sinon debounce ~400 ms → perte si on quitte pile après)
        flushDesktopStorageNow();
    }
    return changed;
}

export const CALENDAR_SCOPE_KEY = "crm_calendar_scope"; // "all" | "current"

export function readCalendarScope() {
    try {
        const v = localStorage.getItem(CALENDAR_SCOPE_KEY);
        if (v === "current" || v === "all") return v;
    } catch { /* ignore */ }
    return "all";
}

export function writeCalendarScope(scope) {
    try {
        localStorage.setItem(CALENDAR_SCOPE_KEY, scope === "current" ? "current" : "all");
    } catch { /* ignore */ }
}

export const PENDING_LEAD_EVENT = "crm:pending-lead";

/** Map dateKey → Set de types présents (pour pastilles). */
export function buildDayTypeMap(events) {
    /** @type {Map<string, Set<string>>} */
    const map = new Map();
    for (const e of events || []) {
        if (e.type === "surveillance") continue;
        if (!map.has(e.dateKey)) map.set(e.dateKey, new Set());
        map.get(e.dateKey).add(e.type);
    }
    return map;
}

/**
 * Ouvre un lead depuis le calendrier (home ou workspace).
 */
export function openLeadFromCalendar(dispatch, workspaceId, leadId) {
    const payload = { workspaceId, leadId, t: Date.now() };
    try {
        sessionStorage.setItem("crm_pending_lead", JSON.stringify(payload));
    } catch { /* ignore */ }
    dispatch({ type: "SELECT_WORKSPACE", id: workspaceId });
    try {
        window.dispatchEvent(new CustomEvent(PENDING_LEAD_EVENT, { detail: payload }));
    } catch { /* ignore */ }
}
