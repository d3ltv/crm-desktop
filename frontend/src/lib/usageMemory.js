/**
 * usageMemory.js — Mémoire d’usage locale pour nourrir l’algo de conseils.
 *
 * Enregistre silencieusement les interactions CRM (actions, cloche, vues…),
 * agrège des stats, et expose un profil appris par workspace.
 * Persistance : crm_usage_v1.json (Tauri) ou fallback localStorage navigateur.
 *
 * Aucune donnée n’est envoyée hors de la machine.
 */

import { diskLoadUsage, diskSaveUsage } from "@/lib/diskUsage";
import { isTauri } from "@/lib/diskStorage";
import { isManualRdv } from "@/lib/nextActionUtils";
import { getWorkspaceRecoProfile } from "@/lib/recoProfile";

const LS_KEY = "crm_usage_memory_v1";
const MAX_EVENTS = 400;
const MAX_SAMPLES = 40;
const SAVE_DEBOUNCE_MS = 1200;
const VERSION = 1;

/** Actions CRM suivies (bruit exclu : CHECK_FOLLOWUPS, undo technique…). */
const TRACKED_ACTIONS = new Set([
    "SELECT_WORKSPACE",
    "CREATE_WORKSPACE",
    "ADD_LEAD",
    "BULK_ADD_LEADS",
    "UPDATE_LEAD",
    "MOVE_LEAD",
    "MOVE_LEAD_ORDERED",
    "DELETE_LEAD",
    "ADD_NOTE",
    "UPDATE_NOTE",
    "DELETE_NOTE",
    "LOG_CONTACT",
    "SET_NEXT_ACTION",
    "LOG_RELANCE",
    "DELETE_RELANCE",
    "SET_DEAL_VALUE",
    "SET_LOST_REASON",
    "ADD_CUSTOM_FIELD",
    "ADD_COLUMN",
    "ADD_STANDALONE_EVENT",
    "UPDATE_STANDALONE_EVENT",
    "DELETE_STANDALONE_EVENT",
    "DISMISS_FOLLOWUP",
    "SET_DAILY_GOAL",
    "SET_THEME",
    "SET_LEAD_PANEL_MODE",
]);

const NOTE_NO_ANSWER_RE = /^📵\s*Pas de réponse/i;
const NOTE_REACHED_RE = /^📞\s*Joint/i;

/** @type {object|null} */
let memory = null;
let hydrated = false;
let hydratePromise = null;
let saveTimer = null;
let dirty = false;

/** Pending lead signals pour mesurer délais (NRP → rappel, joint → RDV). Persistés dans crm_usage_v1. */
const pendingByLead = new Map(); // leadId → { nrpAt?, reachedAt?, wsId }
const PENDING_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;
const BUSINESS_HOUR_MIN = 8;
const BUSINESS_HOUR_MAX = 19;

function syncPendingToMemory(mem) {
    if (!mem.global) mem.global = {};
    const obj = {};
    for (const [leadId, pending] of pendingByLead.entries()) {
        if (pending && (pending.nrpAt || pending.reachedAt)) {
            obj[leadId] = {
                nrpAt: pending.nrpAt || undefined,
                reachedAt: pending.reachedAt || undefined,
                wsId: pending.wsId || undefined,
            };
        }
    }
    mem.global.pendingByLead = obj;
}

function loadPendingFromMemory(mem) {
    pendingByLead.clear();
    const raw = mem?.global?.pendingByLead;
    if (!raw || typeof raw !== "object") return;
    const now = Date.now();
    for (const [leadId, pending] of Object.entries(raw)) {
        if (!pending || typeof pending !== "object") continue;
        const stamp = pending.nrpAt || pending.reachedAt;
        if (stamp) {
            const t = new Date(stamp).getTime();
            if (Number.isFinite(t) && now - t > PENDING_MAX_AGE_MS) continue;
        }
        if (pending.nrpAt || pending.reachedAt) {
            pendingByLead.set(leadId, {
                nrpAt: pending.nrpAt || undefined,
                reachedAt: pending.reachedAt || undefined,
                wsId: pending.wsId || undefined,
            });
        }
    }
}

function emptyHourCounts() {
    return Array.from({ length: 24 }, () => 0);
}

function emptyWeekdayCounts() {
    return Array.from({ length: 7 }, () => 0);
}

function createEmptyMemory() {
    return {
        v: VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        global: {
            hourCounts: emptyHourCounts(),
            weekdayCounts: emptyWeekdayCounts(),
            actionCounts: {},
            notifOpened: {},
            notifDismissed: {},
            views: {},
            samples: {
                nrpToFollowupHours: [],
                reachedToRdvHours: [],
                sessionGapsHours: [],
            },
            pendingByLead: {},
            fieldLabels: {},
            lastActiveAt: null,
            uiGuidance: {
                relia2FeatureTour: {
                    status: "not_started",
                    seenFeatures: {},
                    completed: false,
                    completedAt: null,
                },
            },
        },
        workspaces: {},
        events: [],
    };
}

function ensureWs(mem, wsId, name) {
    if (!wsId) return null;
    if (!mem.workspaces[wsId]) {
        mem.workspaces[wsId] = {
            name: name || "",
            actions: 0,
            opens: 0,
            contacts: 0,
            notes: 0,
            rdvsSet: 0,
            relances: 0,
            moves: 0,
            hourCounts: emptyHourCounts(),
            notifOpened: {},
            notifDismissed: {},
            fieldLabels: {},
            columnCreatedAt: {},
            lastActiveAt: null,
        };
    } else if (name) {
        mem.workspaces[wsId].name = name;
    }
    return mem.workspaces[wsId];
}

function bump(map, key, n = 1) {
    if (!key) return;
    map[key] = (map[key] || 0) + n;
}

function pushSample(arr, value) {
    if (!Number.isFinite(value) || value < 0) return;
    arr.push(Math.round(value * 10) / 10);
    if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
}

function median(arr) {
    if (!arr?.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pic d’activité sur heures ouvrées (évite nuit / coding late). */
function peakHour(hourCounts) {
    let best = 9;
    let max = -1;
    for (let h = BUSINESS_HOUR_MIN; h <= BUSINESS_HOUR_MAX; h += 1) {
        const v = hourCounts[h] || 0;
        if (v > max) {
            max = v;
            best = h;
        }
    }
    return max > 0 ? best : null;
}

function hoursBetween(isoA, isoB) {
    const a = new Date(isoA).getTime();
    const b = new Date(isoB).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return (b - a) / 3_600_000;
}

function persistToLocalFallback(mem) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(mem));
    } catch { /* ignore */ }
}

function ensureRelia2TourState(mem) {
    if (!mem.global) mem.global = {};
    if (!mem.global.uiGuidance) mem.global.uiGuidance = {};
    if (!mem.global.uiGuidance.relia2FeatureTour) {
        mem.global.uiGuidance.relia2FeatureTour = {
            status: "not_started",
            seenFeatures: {},
            completed: false,
            completedAt: null,
        };
    }
    const tour = mem.global.uiGuidance.relia2FeatureTour;
    if (!tour.status) tour.status = tour.completed ? "completed" : "not_started";
    if (!tour.seenFeatures || typeof tour.seenFeatures !== "object") tour.seenFeatures = {};
    if (typeof tour.completed !== "boolean") tour.completed = !!tour.completedAt;
    if (!("completedAt" in tour)) tour.completedAt = null;
    return tour;
}

function loadFromLocalFallback() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushUsageMemory();
    }, SAVE_DEBOUNCE_MS);
}

export async function hydrateUsageMemory() {
    if (hydrated) return memory;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
        let raw = null;
        if (isTauri()) {
            raw = await diskLoadUsage();
        }
        if (!raw) {
            const fb = loadFromLocalFallback();
            memory = fb && fb.v === VERSION ? fb : createEmptyMemory();
        } else {
            try {
                const parsed = JSON.parse(raw);
                memory = parsed && parsed.v === VERSION ? parsed : createEmptyMemory();
            } catch {
                memory = createEmptyMemory();
            }
        }
        // Normalize arrays
        if (!memory.global.hourCounts?.length) memory.global.hourCounts = emptyHourCounts();
        if (!memory.global.weekdayCounts?.length) memory.global.weekdayCounts = emptyWeekdayCounts();
        if (!memory.global.samples) {
            memory.global.samples = {
                nrpToFollowupHours: [],
                reachedToRdvHours: [],
                sessionGapsHours: [],
            };
        }
        if (!Array.isArray(memory.events)) memory.events = [];
        if (!memory.workspaces) memory.workspaces = {};
        if (!memory.global.pendingByLead || typeof memory.global.pendingByLead !== "object") {
            memory.global.pendingByLead = {};
        }
        ensureRelia2TourState(memory);
        loadPendingFromMemory(memory);
        hydrated = true;
        return memory;
    })();
    return hydratePromise;
}

export function getUsageMemory() {
    return memory || createEmptyMemory();
}

export async function flushUsageMemory() {
    if (!dirty || !memory) return;
    syncPendingToMemory(memory);
    memory.updatedAt = new Date().toISOString();
    const payload = JSON.stringify(memory);
    dirty = false;
    if (isTauri()) {
        const ok = await diskSaveUsage(payload);
        if (!ok) persistToLocalFallback(memory);
    } else {
        persistToLocalFallback(memory);
    }
}

function touchTime(mem, now = new Date()) {
    const h = now.getHours();
    const d = now.getDay();
    mem.global.hourCounts[h] = (mem.global.hourCounts[h] || 0) + 1;
    mem.global.weekdayCounts[d] = (mem.global.weekdayCounts[d] || 0) + 1;
    if (mem.global.lastActiveAt) {
        const gap = hoursBetween(mem.global.lastActiveAt, now.toISOString());
        // Gaps utiles : reprise après pause (1h–72h), ignore micro-gaps
        if (gap != null && gap >= 1 && gap <= 72) {
            pushSample(mem.global.samples.sessionGapsHours, gap);
        }
    }
    mem.global.lastActiveAt = now.toISOString();
}

function pushEvent(mem, evt) {
    mem.events.push(evt);
    if (mem.events.length > MAX_EVENTS) {
        mem.events.splice(0, mem.events.length - MAX_EVENTS);
    }
}

/**
 * Enregistre une interaction générique.
 * @param {{
 *   type: string,
 *   workspaceId?: string|null,
 *   workspaceName?: string|null,
 *   leadId?: string|null,
 *   meta?: object,
 * }} evt
 */
export function trackUsage(evt) {
    if (!evt?.type) return;
    if (!hydrated) {
        hydrateUsageMemory().then(() => trackUsage(evt)).catch(() => {});
        return;
    }
    const mem = memory || createEmptyMemory();
    memory = mem;
    const now = new Date();
    const iso = now.toISOString();

    touchTime(mem, now);
    bump(mem.global.actionCounts, evt.type);

    const ws = ensureWs(mem, evt.workspaceId, evt.workspaceName);
    if (ws) {
        ws.actions += 1;
        ws.lastActiveAt = iso;
        ws.hourCounts[now.getHours()] = (ws.hourCounts[now.getHours()] || 0) + 1;
    }

    pushEvent(mem, {
        t: iso,
        type: evt.type,
        ws: evt.workspaceId || null,
        lead: evt.leadId || null,
        meta: evt.meta || undefined,
    });

    scheduleSave();
}

/**
 * Suit une action du reducer CRM.
 * @param {object} action
 * @param {object} stateBefore
 * @param {object} [stateAfter]
 */
export function trackCrmAction(action, stateBefore, stateAfter) {
    if (!action?.type || !TRACKED_ACTIONS.has(action.type)) return;
    if (!hydrated) {
        hydrateUsageMemory()
            .then(() => trackCrmAction(action, stateBefore, stateAfter))
            .catch(() => {});
        return;
    }

    const mem = memory || createEmptyMemory();
    memory = mem;
    const now = new Date();
    const iso = now.toISOString();
    const wsId =
        action.workspaceId
        || (action.type === "SELECT_WORKSPACE" || action.type === "DELETE_WORKSPACE" || action.type === "RENAME_WORKSPACE"
            ? action.id
            : null)
        || stateBefore?.currentId
        || stateAfter?.currentId
        || null;
    const wsName = wsId
        ? (stateAfter?.workspaces?.[wsId]?.name || stateBefore?.workspaces?.[wsId]?.name || "")
        : "";
    const leadId = action.leadId || action.lead?.id || null;

    touchTime(mem, now);
    bump(mem.global.actionCounts, action.type);

    const ws = ensureWs(mem, wsId, wsName);
    if (ws) {
        ws.actions += 1;
        ws.lastActiveAt = iso;
        ws.hourCounts[now.getHours()] = (ws.hourCounts[now.getHours()] || 0) + 1;
    }

    if (action.type === "CREATE_WORKSPACE" && stateBefore && stateAfter) {
        const beforeIds = new Set(stateBefore.order || []);
        const newId = (stateAfter.order || []).find((id) => !beforeIds.has(id));
        if (newId) {
            ensureWs(mem, newId, action.name || stateAfter.workspaces?.[newId]?.name);
        }
    }

    // Signaux métier
    if (action.type === "SELECT_WORKSPACE" && ws) {
        ws.opens += 1;
    }

    if (action.type === "LOG_CONTACT" && ws) {
        ws.contacts += 1;
    }

    // Relance manuelle (email, tel…) = aussi un contact du jour pour l’objectif / créneaux
    if (action.type === "LOG_RELANCE" && ws) {
        ws.contacts += 1;
        ws.relances += 1;
        if (leadId) {
            const pending = pendingByLead.get(leadId);
            if (pending?.nrpAt) {
                const h = hoursBetween(pending.nrpAt, iso);
                if (h != null && h <= 24 * 21) {
                    pushSample(mem.global.samples.nrpToFollowupHours, h);
                }
                delete pending.nrpAt;
                if (!pending.reachedAt) pendingByLead.delete(leadId);
                else pendingByLead.set(leadId, pending);
            }
        }
    }

    if ((action.type === "ADD_NOTE" || action.type === "LOG_CONTACT") && leadId) {
        if (ws) ws.notes += 1;
        const text = String(action.text || action.note?.text || "");
        const pending = pendingByLead.get(leadId) || { wsId };
        if (NOTE_NO_ANSWER_RE.test(text)) {
            pending.nrpAt = iso;
            pending.wsId = wsId;
            pendingByLead.set(leadId, pending);
        } else if (NOTE_REACHED_RE.test(text) || action.recordingId) {
            pending.reachedAt = iso;
            pending.wsId = wsId;
            pendingByLead.set(leadId, pending);
        }
    }

    if (action.type === "SET_NEXT_ACTION" && leadId) {
        const na = action.nextAction;
        const pending = pendingByLead.get(leadId);
        if (pending?.nrpAt && na) {
            const h = hoursBetween(pending.nrpAt, iso);
            if (h != null && h <= 24 * 21) {
                pushSample(mem.global.samples.nrpToFollowupHours, h);
            }
            delete pending.nrpAt;
        }
        if (isManualRdv(na)) {
            if (ws) ws.rdvsSet += 1;
            if (pending?.reachedAt) {
                const h = hoursBetween(pending.reachedAt, iso);
                if (h != null && h <= 24 * 21) {
                    pushSample(mem.global.samples.reachedToRdvHours, h);
                }
                delete pending.reachedAt;
            }
        }
        if (pending && !pending.nrpAt && !pending.reachedAt) {
            pendingByLead.delete(leadId);
        } else if (pending) {
            pendingByLead.set(leadId, pending);
        }
    }

    if (action.type === "MOVE_LEAD" || action.type === "MOVE_LEAD_ORDERED") {
        if (ws) ws.moves += 1;
    }

    // Structure fabriquée par l'utilisateur : champs et colonnes qu'il invente.
    // Mémorisé ici car l'état seul oublie un champ supprimé ou une colonne vide.
    if (action.type === "ADD_CUSTOM_FIELD") {
        const label = String(action.label || "").trim();
        if (label && !action.isMainDuplicate) {
            const key = label.toLowerCase();
            if (!mem.global.fieldLabels) mem.global.fieldLabels = {};
            const g = mem.global.fieldLabels[key] || { label, n: 0 };
            g.label = label;
            g.n += 1;
            g.lastAt = iso;
            mem.global.fieldLabels[key] = g;
            if (ws) {
                if (!ws.fieldLabels) ws.fieldLabels = {};
                const w = ws.fieldLabels[key] || { label, n: 0 };
                w.label = label;
                w.n += 1;
                w.lastAt = iso;
                ws.fieldLabels[key] = w;
            }
        }
    }

    if (action.type === "ADD_COLUMN" && ws && stateBefore && stateAfter) {
        const beforeIds = new Set(stateBefore.workspaces?.[wsId]?.columnOrder || []);
        const newId = (stateAfter.workspaces?.[wsId]?.columnOrder || []).find((id) => !beforeIds.has(id));
        if (newId) {
            if (!ws.columnCreatedAt) ws.columnCreatedAt = {};
            ws.columnCreatedAt[newId] = iso;
        }
    }

    pushEvent(mem, {
        t: iso,
        type: `crm:${action.type}`,
        ws: wsId,
        lead: leadId,
        meta: summarizeActionMeta(action),
    });

    syncPendingToMemory(mem);
    scheduleSave();
}

function summarizeActionMeta(action) {
    const meta = {};
    if (action.columnId) meta.columnId = action.columnId;
    if (action.toColumnId) meta.to = action.toColumnId;
    if (action.fromColumnId) meta.from = action.fromColumnId;
    if (action.nextAction?.meeting) meta.rdv = true;
    if (action.nextAction?.calendarReminder) meta.reminder = true;
    if (action.text) meta.note = String(action.text).slice(0, 40);
    if (action.view) meta.view = action.view;
    return Object.keys(meta).length ? meta : undefined;
}

/** Ouverture / dismiss d’une reco cloche. */
export function trackNotifInteraction(item, outcome /* 'open' | 'dismiss' */) {
    if (!item?.kind) return;
    if (!hydrated) {
        hydrateUsageMemory()
            .then(() => trackNotifInteraction(item, outcome))
            .catch(() => {});
        return;
    }
    const mem = memory || createEmptyMemory();
    memory = mem;
    const now = new Date();
    touchTime(mem, now);
    const map = outcome === "dismiss" ? mem.global.notifDismissed : mem.global.notifOpened;
    bump(map, item.kind);

    const wsId = item.workspaceId || null;
    const ws = ensureWs(mem, wsId, item.workspaceName);
    if (ws) {
        const wmap = outcome === "dismiss" ? ws.notifDismissed : ws.notifOpened;
        bump(wmap, item.kind);
        ws.lastActiveAt = now.toISOString();
    }

    pushEvent(mem, {
        t: now.toISOString(),
        type: outcome === "dismiss" ? "notif:dismiss" : "notif:open",
        ws: wsId,
        lead: item.lead?.id || null,
        meta: { kind: item.kind },
    });
    scheduleSave();
}

/** Changement de vue (kanban / list / …). */
export function trackViewChange(viewId, workspaceId) {
    if (!viewId) return;
    if (!hydrated) {
        hydrateUsageMemory().then(() => trackViewChange(viewId, workspaceId)).catch(() => {});
        return;
    }
    const mem = memory || createEmptyMemory();
    memory = mem;
    const now = new Date();
    touchTime(mem, now);
    bump(mem.global.views, viewId);
    bump(mem.global.actionCounts, "ui:view");
    const ws = ensureWs(mem, workspaceId, null);
    if (ws) {
        ws.actions += 1;
        ws.lastActiveAt = now.toISOString();
        ws.hourCounts[now.getHours()] = (ws.hourCounts[now.getHours()] || 0) + 1;
    }
    pushEvent(mem, {
        t: now.toISOString(),
        type: "ui:view",
        ws: workspaceId || null,
        lead: null,
        meta: { view: viewId },
    });
    scheduleSave();
}

/** Ouverture fiche lead (panel). */
export function trackLeadOpen(workspaceId, leadId, workspaceName) {
    trackUsage({
        type: "ui:lead_open",
        workspaceId,
        workspaceName,
        leadId,
    });
}

/**
 * Profil appris → overrides pour recoProfile.
 * @param {string} [workspaceId]
 * @returns {Partial<import('./recoProfile').RecoProfile> & { confidence: number, peakHour: number|null }}
 */
export function getLearnedRecoOverrides(workspaceId) {
    const mem = memory || createEmptyMemory();
    const g = mem.global;
    const ws = workspaceId ? mem.workspaces[workspaceId] : null;

    const hourSource = ws?.hourCounts?.some((n) => n > 0) ? ws.hourCounts : g.hourCounts;
    const peak = peakHour(hourSource);

    const nrpMed = median(g.samples?.nrpToFollowupHours || []);
    const rdvMed = median(g.samples?.reachedToRdvHours || []);

    const opened = { ...(g.notifOpened || {}), ...(ws?.notifOpened || {}) };
    const dismissed = { ...(g.notifDismissed || {}), ...(ws?.notifDismissed || {}) };

    /** @type {Record<string, number>} */
    const kindAffinity = {};
    const kinds = new Set([...Object.keys(opened), ...Object.keys(dismissed)]);
    for (const k of kinds) {
        const o = opened[k] || 0;
        const d = dismissed[k] || 0;
        kindAffinity[k] = o - d * 0.6;
    }

    const totalActions = Object.values(g.actionCounts || {}).reduce((s, n) => s + n, 0)
        + (ws?.actions || 0);
    const sampleN = (g.samples?.nrpToFollowupHours?.length || 0)
        + (g.samples?.reachedToRdvHours?.length || 0);
    // Gestes + échantillons de délais → confiance un peu plus tôt
    const confidence = Math.min(1, totalActions / 80 + sampleN * 0.04);

    /** @type {Partial<import('./recoProfile').RecoProfile>} */
    const patch = {};

    if (peak != null && confidence >= 0.15) {
        patch.preferMorningCalls = peak < 12;
    }

    if (rdvMed != null && (g.samples?.reachedToRdvHours?.length || 0) >= 3) {
        // Médiane heures → jours (arrondi 1–5)
        const days = Math.min(5, Math.max(1, Math.round(rdvMed / 24) || 1));
        patch.rdvAfterJointDays = days;
        patch.rdvAfterInterestDays = Math.max(1, days - 1);
    }

    if (nrpMed != null && (g.samples?.nrpToFollowupHours?.length || 0) >= 3) {
        const days = Math.min(4, Math.max(1, Math.round(nrpMed / 24) || 1));
        patch.forgotRelanceDays = days;
    }

    // Volume : beaucoup d’actions / contacts → tip volume + batch plus gros
    if (ws && ws.actions >= 40 && ws.contacts >= 15) {
        patch.tipFocus = "volume";
        patch.morningBatchSize = 8;
        patch.staleNouveauDays = 1;
    } else if (ws && ws.rdvsSet >= 8 && ws.rdvsSet >= (ws.contacts || 1) * 0.25) {
        patch.tipFocus = "pipeline";
        patch.preferRdv = true;
        patch.rdvAfterJointDays = Math.min(patch.rdvAfterJointDays ?? 2, 2);
    } else if (ws && ws.actions >= 20 && ws.rdvsSet > 0 && ws.rdvsSet < 3) {
        patch.tipFocus = "quality";
    }

    // Affinity : si user dismiss souvent cold_gap, relever le seuil
    if ((dismissed.cold_gap || 0) >= 3 && (opened.cold_gap || 0) <= (dismissed.cold_gap || 0)) {
        patch.coldGapDays = 18;
    }
    if ((opened.suggest_rdv || 0) >= 3) {
        patch.preferRdv = true;
        patch.rdvAfterJointDays = Math.min(patch.rdvAfterJointDays ?? 2, 2);
    }
    if ((dismissed.suggest_rdv || 0) >= 4 && (opened.suggest_rdv || 0) < 2) {
        patch.preferRdv = false;
    }

    return {
        ...patch,
        confidence,
        peakHour: peak,
        kindAffinity,
        samples: {
            nrpToFollowupHours: nrpMed,
            reachedToRdvHours: rdvMed,
            events: mem.events?.length || 0,
            actions: totalActions,
        },
    };
}

/**
 * Score multiplicateur selon l’affinité apprise pour un kind de reco.
 * @param {string} kind
 * @param {string} [workspaceId]
 */
export function learnedKindBoost(kind, workspaceId) {
    const { kindAffinity, confidence } = getLearnedRecoOverrides(workspaceId);
    if (!kind || confidence < 0.1) return 0;
    const a = kindAffinity?.[kind] || 0;
    if (a >= 3) return 8;
    if (a >= 1) return 4;
    if (a <= -3) return -10;
    if (a <= -1) return -4;
    return 0;
}

/**
 * Jours de relance post-joint : appris → profil niche → défaut 2.
 * @param {object} [workspace]
 * @returns {number} 1–7
 */
export function getSuggestedRelanceDays(workspace) {
    const learned = getLearnedRecoOverrides(workspace?.id);
    if (learned.rdvAfterJointDays != null && learned.confidence >= 0.12) {
        return Math.min(7, Math.max(1, Number(learned.rdvAfterJointDays) || 2));
    }
    const days = getWorkspaceRecoProfile(workspace)?.rdvAfterJointDays;
    if (Number.isFinite(days) && days >= 1) return Math.min(7, Math.max(1, days));
    return 2;
}

/**
 * Heure préférée apprise (8–19) pour defaults de rappel.
 * @param {string} [workspaceId]
 * @returns {number|null}
 */
export function getLearnedPreferredHour(workspaceId) {
    const { peakHour: peak, confidence } = getLearnedRecoOverrides(workspaceId);
    if (peak == null || confidence < 0.12) return null;
    return Math.min(BUSINESS_HOUR_MAX, Math.max(BUSINESS_HOUR_MIN, peak));
}

/**
 * Champs que l'utilisateur a créés à la main, du plus utilisé au moins utilisé.
 * L'état oublie un champ supprimé — la mémoire, non : l'intention reste connue.
 * @param {string} [workspaceId] restreint au workspace, sinon global
 * @returns {{ key: string, label: string, n: number, lastAt?: string }[]}
 */
export function getLearnedFieldLabels(workspaceId) {
    const mem = memory;
    if (!mem) return [];
    const scoped = workspaceId ? mem.workspaces?.[workspaceId]?.fieldLabels : null;
    const src = scoped && Object.keys(scoped).length ? scoped : mem.global?.fieldLabels;
    if (!src) return [];
    return Object.entries(src)
        .map(([key, v]) => ({ key, label: v?.label || key, n: v?.n || 0, lastAt: v?.lastAt }))
        .filter((f) => f.n > 0)
        .sort((a, b) => b.n - a.n);
}

/**
 * Date de création réelle des colonnes (l'état ne l'enregistre pas).
 * @param {string} [workspaceId]
 * @returns {Record<string, string>} columnId → ISO
 */
export function getLearnedColumnCreatedAt(workspaceId) {
    if (!workspaceId) return {};
    return memory?.workspaces?.[workspaceId]?.columnCreatedAt || {};
}

/** Flush à la fermeture / background. */
export function installUsageMemoryLifecycle() {
    hydrateUsageMemory().catch(() => {});
    const flush = () => {
        flushUsageMemory().catch(() => {});
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    });
}

/** Relia 2 — tour guidé déjà terminé ? */
export function isRelia2FeatureTourCompleted() {
    const mem = memory || createEmptyMemory();
    return !!ensureRelia2TourState(mem).completed;
}

/** Relia 2 — feature déjà vue ? */
export function isRelia2FeatureSeen(featureId) {
    if (!featureId) return false;
    const mem = memory || createEmptyMemory();
    const tour = ensureRelia2TourState(mem);
    return !!tour.seenFeatures[featureId];
}

/** Relia 2 — marque une feature comme vue. */
export function markRelia2FeatureSeen(featureId) {
    if (!featureId) return;
    if (!memory) memory = createEmptyMemory();
    const tour = ensureRelia2TourState(memory);
    if (tour.seenFeatures[featureId]) return;
    tour.seenFeatures[featureId] = true;
    if (tour.status === "not_started") tour.status = "in_progress";
    scheduleSave();
    void flushUsageMemory();
}

/** Relia 2 — marque le tour comme terminé (persistant, une seule fois). */
export function markRelia2FeatureTourCompleted() {
    if (!memory) memory = createEmptyMemory();
    const tour = ensureRelia2TourState(memory);
    tour.status = "completed";
    tour.completed = true;
    tour.completedAt = new Date().toISOString();
    scheduleSave();
    void flushUsageMemory();
}
