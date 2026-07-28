/**
 * Notifications Relia = recommandations prospection (pas l’agenda).
 *
 * Calendrier = RDV / rappels / relances planifiés (dues du jour).
 * Cloche / OS = coaching adapté à chaque vue (niche, template, pipeline) :
 * oublis, suggestion de RDV, replan, canal alternatif, priorité deal —
 * jamais un clone « X est dû aujourd’hui » du badge calendrier.
 */

import { toLocalDateKey } from "@/lib/dateUtils";
import { isManualRdv, isCalendarReminder } from "@/lib/nextActionUtils";
import {
    isWonColumn,
    isLostColumn,
    isNouveauColumn,
    isContactedColumn,
    isMeetingColumn,
    isPropositionColumn,
    isRappelColumn,
} from "@/constants/columnPatterns";
import { parseNote, detectAppointment } from "@/lib/noteParser";
import {
    workspaceRecoContext,
    workspaceMedianDeal,
} from "@/lib/recoProfile";
import { getLearnedRecoOverrides, learnedKindBoost, trackNotifInteraction } from "@/lib/usageMemory";
import { countContactsToday } from "@/lib/dailyContacts";
import { getLeadVigilance } from "@/lib/inconsistencyRules";
import { resolveCoachingProfile } from "@/lib/coachingProfile";

const SEEN_ITEMS_KEY = "crm_notif_seen_items_v1";
const LEGACY_SEEN_MAP_KEY = "crm_notif_seen_map_v1";
export const NOTIF_SEEN_EVENT = "crm_notif_seen_changed";

const MAX_PER_WORKSPACE = 7;
const MAX_GLOBAL = 14;
const MAX_SAME_KIND = 3;

const NOTE_NO_ANSWER_RE = /^📵\s*Pas de réponse/i;
const NOTE_REACHED_RE = /^📞\s*Joint/i;
const INTEREST_RE =
    /int[eé]ress|ok pour|budget|devis|volontiers|pourquoi pas|go pour|planifi|cr[eé]neau|d[eé]mo|visite|entretien|on se (?:voit|appelle)|dispo(?:nible)?(?:\s+pour)?|envoyer (?:un )?devis|a\s+planifier|[àa]\s+fixer/i;
const CALLBACK_LATER_RE =
    /(?:semaine\s+prochaine|mois\s+prochain|en\s+cong[eé]s|pas\s+maintenant|rappeler?\s+(?:dans|plus\s+tard)|revoir\s+plus\s+tard|apr[eè]s\s+(?:les?\s+)?vacances|d[eé]but\s+(?:de\s+)?(?:mois|semaine)|fin\s+(?:de\s+)?mois)/i;
const OBJECTION_RE =
    /trop\s+cher|pas\s+le\s+budget|d[eé]j[àa]\s+(?:un\s+)?(?:fournisseur|outil|logiciel)|pas\s+int[eé]ress|hors\s+sujet|ne\s+pas\s+rappeler/i;

function isTerminal(lead, columns) {
    const name = columns?.[lead.columnId]?.name || "";
    return isWonColumn(name) || isLostColumn(name);
}

function daysBetween(fromIso, toDate = new Date()) {
    const a = toLocalDateKey(fromIso);
    const b = toLocalDateKey(toDate);
    if (!a || !b) return null;
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    const start = Date.UTC(ay, am - 1, ad);
    const end = Date.UTC(by, bm - 1, bd);
    return Math.round((end - start) / 86400000);
}

function hourBucket(now = new Date()) {
    const h = now.getHours();
    if (h < 11) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
}

function weekdayKey(now = new Date()) {
    const d = now.getDay(); // 0 dim … 6 sam
    if (d === 1) return "monday";
    if (d === 5) return "friday";
    if (d === 0 || d === 6) return "weekend";
    return "midweek";
}

function lastActivityIso(lead) {
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

/** Dernière note matchant `re` (par date, pas ordre tableau). */
function lastNoteMatching(lead, re) {
    let bestAt = null;
    let bestT = -1;
    for (const n of lead.notes || []) {
        if (!re.test(String(n.text || ""))) continue;
        const t = new Date(n.at || 0).getTime();
        if (Number.isFinite(t) && t >= bestT) {
            bestT = t;
            bestAt = n.at || null;
        }
    }
    return bestAt;
}

function lastNoAnswerAt(lead) {
    return lastNoteMatching(lead, NOTE_NO_ANSWER_RE);
}

function lastReachedAt(lead) {
    let bestAt = null;
    let bestT = -1;
    for (const n of lead.notes || []) {
        const text = String(n.text || "");
        if (!NOTE_REACHED_RE.test(text) && !n.recordingId) continue;
        const t = new Date(n.at || 0).getTime();
        if (Number.isFinite(t) && t >= bestT) {
            bestT = t;
            bestAt = n.at || null;
        }
    }
    return bestAt;
}

/** Corpus limité aux N notes les plus récentes (évite faux positifs sur vieux textes). */
function recentNoteCorpus(lead, limit = 3) {
    const notes = [...(lead.notes || [])].sort(
        (a, b) => new Date(b.at || 0) - new Date(a.at || 0)
    );
    return notes.slice(0, limit).map((n) => String(n.text || "")).join("\n");
}

function hasInterestSignal(lead) {
    if (Number(lead.dealValue) > 0) return true;
    return INTEREST_RE.test(recentNoteCorpus(lead, 3));
}

function hasCallbackLaterSignal(lead) {
    return CALLBACK_LATER_RE.test(recentNoteCorpus(lead, 3));
}

function hasHardObjection(lead) {
    return OBJECTION_RE.test(recentNoteCorpus(lead, 4));
}

/** Stats d’appels depuis les notes structurées. */
function callStats(lead) {
    let nrp = 0;
    let reached = 0;
    let lastOutcome = null;
    let lastAt = null;
    const notes = [...(lead.notes || [])].sort(
        (a, b) => new Date(a.at || 0) - new Date(b.at || 0)
    );
    for (const n of notes) {
        const text = String(n.text || "");
        if (NOTE_NO_ANSWER_RE.test(text)) {
            nrp += 1;
            lastOutcome = "nrp";
            lastAt = n.at;
        } else if (NOTE_REACHED_RE.test(text) || n.recordingId) {
            reached += 1;
            lastOutcome = "reached";
            lastAt = n.at;
        }
    }
    return { nrp, reached, lastOutcome, lastAt, total: nrp + reached };
}

function daysInCurrentColumn(lead, now) {
    const hist = lead.statusHistory || [];
    const entered = [...hist].reverse().find((e) => e.columnId === lead.columnId)?.at
        || lead.contactedColumnEnteredAt
        || lead.createdAt
        || null;
    return entered ? daysBetween(entered, now) : null;
}

function dealBoost(lead, medianDeal) {
    const v = Number(lead.dealValue);
    if (!Number.isFinite(v) || v <= 0) return 0;
    if (medianDeal > 0 && v >= medianDeal * 1.5) return 14;
    if (medianDeal > 0 && v >= medianDeal) return 8;
    if (v >= 5000) return 6;
    return 3;
}

/**
 * @returns {{
 *   has: boolean,
 *   dueAt: string|null,
 *   key: string|null,
 *   overdue: boolean,
 *   active: boolean,
 *   isRdv: boolean,
 *   isReminder: boolean,
 *   daysOverdue: number|null,
 * }}
 */
function scheduleInfo(lead, todayKey, now) {
    const na = lead.nextAction;
    const af = lead.autoFollowup;
    const dueAt =
        na?.dueAt
        || (na?.date ? `${na.date}T09:00:00` : null)
        || af?.dueAt
        || null;
    if (!dueAt) {
        return {
            has: false,
            dueAt: null,
            key: null,
            overdue: false,
            active: false,
            isRdv: false,
            isReminder: false,
            daysOverdue: null,
        };
    }
    const key = toLocalDateKey(dueAt);
    const overdue = !!(key && key < todayKey);
    const active = !!(key && key >= todayKey);
    return {
        has: true,
        dueAt,
        key,
        overdue,
        active,
        isRdv: isManualRdv(na),
        isReminder: isCalendarReminder(na) || (!!af?.dueAt && !isManualRdv(na)),
        daysOverdue: overdue ? daysBetween(dueAt, now) : null,
    };
}

function selectDiverse(candidates, limit) {
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.due || 0) - (b.due || 0));
    const seenLeads = new Set();
    const kindCount = new Map();
    const out = [];
    const deferred = [];

    for (const item of candidates) {
        if (item.lead?.id) {
            if (seenLeads.has(item.lead.id)) continue;
        }
        const k = item.kind || "other";
        const n = kindCount.get(k) || 0;
        if (n >= MAX_SAME_KIND) {
            deferred.push(item);
            continue;
        }
        if (item.lead?.id) seenLeads.add(item.lead.id);
        kindCount.set(k, n + 1);
        out.push(item);
        if (out.length >= limit) return out;
    }

    for (const item of deferred) {
        if (item.lead?.id && seenLeads.has(item.lead.id)) continue;
        if (item.lead?.id) seenLeads.add(item.lead.id);
        out.push(item);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * @typedef {{
 *   key: string,
 *   lead: object|null,
 *   due: number,
 *   dueAt: string|null,
 *   overdue: boolean,
 *   today: boolean,
 *   kind: string,
 *   label: string,
 *   title?: string,
 *   score: number,
 *   workspaceId?: string,
 *   workspaceName?: string,
 * }} NotifItem
 */

/**
 * Recommandations pour un workspace — adaptées à la niche + état leads.
 * @param {object} workspace
 * @param {{ now?: Date, dailyGoal?: number }} [opts]
 * @returns {NotifItem[]}
 */
export function getWorkspaceFollowupNotifs(workspace, opts = {}) {
    const now = opts.now || new Date();
    const todayKey = toLocalDateKey(now);
    const bucket = hourBucket(now);
    const dayPart = weekdayKey(now);
    const columns = workspace?.columns || {};
    // Profil fourni par le cerveau, sinon merge local (organe + cœur)
    const resolved = opts.profile
        ? { profile: opts.profile, learned: opts.learned || getLearnedRecoOverrides(workspace?.id) }
        : resolveCoachingProfile(workspace);
    const profile = resolved.profile;
    const learned = resolved.learned;
    const ctx = workspaceRecoContext(workspace, profile);
    const medianDeal = workspaceMedianDeal(workspace);
    const candidates = [];

    const push = (item) => {
        if (!item?.key || !item?.label) return;
        const boost = learnedKindBoost(item.kind, workspace?.id);
        candidates.push({
            due: item.due ?? now.getTime(),
            dueAt: item.dueAt ?? null,
            overdue: !!item.overdue,
            today: item.today !== false,
            ...item,
            score: (item.score || 0) + boost,
        });
    };

    let activeCount = 0;
    let staleNouveau = 0;
    let forgotRelance = 0;
    let rdvOpportunities = 0;
    let overdueCoaching = 0;
    let stuckProp = 0;
    let hotLeads = 0;
    const contactedToday = countContactsToday(workspace, now);

    for (const lead of Object.values(workspace?.leads || {})) {
        if (!lead?.id || lead.archived) continue;
        if (isTerminal(lead, columns)) continue;
        activeCount += 1;

        const colName = columns[lead.columnId]?.name || "";
        const activity = lastActivityIso(lead);
        const idleDays = activity != null ? daysBetween(activity, now) : daysBetween(lead.createdAt, now);
        const createdDays = daysBetween(lead.createdAt, now) ?? 0;
        const sched = scheduleInfo(lead, todayKey, now);
        const reachedAt = lastReachedAt(lead);
        const reachedDays = reachedAt ? daysBetween(reachedAt, now) : null;
        const interest = hasInterestSignal(lead);
        const calls = callStats(lead);
        const inProp = isPropositionColumn(colName);
        const inMeeting = isMeetingColumn(colName);
        const inRappel = isRappelColumn(colName);
        const daysInCol = daysInCurrentColumn(lead, now);
        const valueBoost = dealBoost(lead, medianDeal);
        const objection = hasHardObjection(lead);
        const later = hasCallbackLaterSignal(lead);
        const calendarOwns = sched.active;

        // ── Hot lead : joint récent + intérêt → RDV prioritaire ─────────────
        const isHot =
            profile.preferRdv
            && !sched.isRdv
            && !objection
            && reachedAt
            && reachedDays != null
            && reachedDays <= 2
            && (interest || Number(lead.dealValue) > 0 || inProp);

        if (isHot && (!calendarOwns || sched.overdue) && !sched.has) {
            hotLeads += 1;
            rdvOpportunities += 1;
            push({
                key: `${workspace.id}:${lead.id}:hot_rdv:${todayKey}`,
                lead,
                kind: "suggest_rdv",
                title: `Chaud — ${profile.rdvNoun}`,
                label: interest
                    ? `Joint récemment + intérêt — pose le ${profile.rdvNoun} maintenant`
                    : `Joint récemment — enchaîne sur un ${profile.rdvNoun}`,
                overdue: false,
                score: 92 + valueBoost + (bucket === "morning" && profile.preferMorningCalls ? 4 : 0),
                due: new Date(reachedAt).getTime(),
                dueAt: reachedAt,
            });
        }

        // ── Suggestion RDV (standard / retard utile) ────────────────────────
        const canSuggestRdv =
            profile.preferRdv
            && !sched.isRdv
            && !inMeeting
            && !objection
            && !isHot
            && (
                (reachedAt && reachedDays != null && reachedDays >= profile.rdvAfterJointDays)
                || (interest && reachedAt && reachedDays != null && reachedDays >= profile.rdvAfterInterestDays)
                || (inProp && (idleDays ?? 0) >= 1)
                || (calls.reached >= 2 && (idleDays ?? 0) >= 1)
            );

        if (canSuggestRdv && (!calendarOwns || sched.overdue)) {
            if (sched.overdue && (sched.isReminder || !sched.isRdv)) {
                const d = sched.daysOverdue ?? 1;
                if (d >= profile.overdueRdvSuggestDays && (interest || reachedAt || inProp || inRappel)) {
                    overdueCoaching += 1;
                    rdvOpportunities += 1;
                    push({
                        key: `${workspace.id}:${lead.id}:suggest_rdv_overdue:${todayKey}`,
                        lead,
                        kind: "suggest_rdv",
                        title: `Passer en ${profile.rdvNoun}`,
                        label: d === 1
                            ? `Rappel dépassé — ${interest ? "intérêt clair, " : ""}fixe un ${profile.rdvNoun}`
                            : `Rappel en retard de ${d} j — transforme en ${profile.rdvNoun}`,
                        overdue: true,
                        score: 84 + Math.min(d * 2, 10) + (interest ? 6 : 0) + (inProp ? 4 : 0) + valueBoost,
                        due: new Date(sched.dueAt).getTime(),
                        dueAt: sched.dueAt,
                    });
                }
            } else if (!sched.has) {
                rdvOpportunities += 1;
                const why = inProp
                    ? `En proposition sans ${profile.rdvNoun}`
                    : interest
                        ? `Intérêt repéré — pose un ${profile.rdvNoun}`
                        : calls.reached >= 2
                            ? `${calls.reached} joints sans ${profile.rdvNoun}`
                            : `Joint il y a ${reachedDays} j — moment pour un ${profile.rdvNoun}`;
                push({
                    key: `${workspace.id}:${lead.id}:suggest_rdv:${todayKey}`,
                    lead,
                    kind: "suggest_rdv",
                    title: `Suggérer un ${profile.rdvNoun}`,
                    label: why,
                    overdue: (reachedDays ?? 0) >= profile.rdvAfterJointDays + 2 || inProp,
                    score: 72
                        + (interest ? 10 : 0)
                        + (inProp ? 8 : 0)
                        + Math.min((reachedDays || 0) * 2, 12)
                        + valueBoost
                        + (bucket === "morning" ? 4 : 0),
                    due: reachedAt ? new Date(reachedAt).getTime() : now.getTime(),
                    dueAt: reachedAt,
                });
            }
        }

        // Callback « plus tard » sans date → pose le rappel
        if (!calendarOwns && !sched.has && later && !objection) {
            push({
                key: `${workspace.id}:${lead.id}:callback_later:${todayKey}`,
                lead,
                kind: "forgot_relance",
                title: "Rappel à poser",
                label: "Ils ont demandé plus tard — ancre une date au calendrier",
                overdue: (idleDays ?? 0) >= 2,
                score: 78 + valueBoost,
                due: activity ? new Date(activity).getTime() : now.getTime(),
                dueAt: activity,
            });
        }

        // RDV passé sans maj
        if (sched.overdue && sched.isRdv) {
            const sinceRdv = sched.daysOverdue ?? 0;
            const activityAfterDue = activity && sched.dueAt
                && new Date(activity).getTime() > new Date(sched.dueAt).getTime();
            if (sinceRdv >= 1 && !activityAfterDue) {
                overdueCoaching += 1;
                push({
                    key: `${workspace.id}:${lead.id}:rdv_past_noupdate:${todayKey}`,
                    lead,
                    kind: "rdv_followup",
                    title: `${profile.rdvNoun} passé`,
                    label: sinceRdv === 1
                        ? `Hier — note le compte-rendu ou replanifie`
                        : `Il y a ${sinceRdv} j — maj ou nouveau créneau ?`,
                    overdue: true,
                    score: 90 + Math.min(sinceRdv, 8) + valueBoost,
                    due: new Date(sched.dueAt).getTime(),
                    dueAt: sched.dueAt,
                });
            }
        }

        if (calendarOwns) {
            const callText = (lead.notes || [])
                .filter((n) => n?.recordingId && String(n.transcript || "").trim())
                .map((n) => n.transcript)
                .join("\n");
            if (callText.trim() && !sched.isRdv) {
                const appt = detectAppointment(callText);
                if (appt?.iso) {
                    const existingDue = lead.nextAction?.dueAt || lead.nextAction?.date;
                    const sameDay = existingDue
                        && toLocalDateKey(existingDue) === toLocalDateKey(appt.iso);
                    if (!sameDay) {
                        push({
                            key: `${workspace.id}:${lead.id}:brief_appointment:${todayKey}`,
                            lead,
                            kind: "brief_suggestion",
                            title: "Suggestion d'appel",
                            label: `Date détectée · ${appt.label} → ${profile.rdvNoun} ?`,
                            overdue: false,
                            score: 68 + valueBoost,
                            due: now.getTime(),
                            dueAt: null,
                        });
                    }
                }
            }
            continue;
        }

        const skipGeneric = sched.overdue;

        // ── Bloqué trop longtemps dans la colonne ───────────────────────────
        if (
            !skipGeneric
            && !sched.has
            && daysInCol != null
            && daysInCol >= profile.stuckColumnDays
            && !isNouveauColumn(colName)
        ) {
            if (inProp) stuckProp += 1;
            push({
                key: `${workspace.id}:${lead.id}:stuck_column:${todayKey}`,
                lead,
                kind: "stuck_column",
                title: "Étape bloquée",
                label: inProp
                    ? `${daysInCol} j en proposition — relance décision ou ${profile.rdvNoun}`
                    : inRappel
                        ? `${daysInCol} j en rappel — ${profile.callVerb} ou avance`
                        : `${daysInCol} j dans « ${colName} » — prochain geste ?`,
                overdue: daysInCol >= profile.stuckColumnDays + 3,
                score: 63 + Math.min(daysInCol, 15) + valueBoost + (inProp ? 6 : 0),
                due: now.getTime(),
                dueAt: null,
            });
        }

        // ── NRP répétés → changer de canal ──────────────────────────────────
        if (
            !skipGeneric
            && !sched.has
            && calls.reached === 0
            && calls.nrp >= profile.nrpChannelSwitch
            && (lead.email || lead.phone)
        ) {
            const via = lead.email ? "e-mail" : "un autre créneau / SMS";
            push({
                key: `${workspace.id}:${lead.id}:channel_switch:${todayKey}`,
                lead,
                kind: "channel_switch",
                title: "Changer de canal",
                label: `${calls.nrp} NRP d’affilée — tente un ${via}`,
                overdue: calls.nrp >= profile.nrpChannelSwitch + 2,
                score: 74 + Math.min(calls.nrp * 2, 12) + valueBoost,
                due: calls.lastAt ? new Date(calls.lastAt).getTime() : now.getTime(),
                dueAt: calls.lastAt,
            });
        }

        // ── Oubli : NRP sans suite (si pas déjà channel_switch prioritaire) ─
        if (!skipGeneric && !sched.has && calls.nrp < profile.nrpChannelSwitch) {
            const nrpAt = lastNoAnswerAt(lead);
            if (nrpAt && calls.lastOutcome === "nrp") {
                const d = daysBetween(nrpAt, now);
                if (d != null && d >= profile.forgotRelanceDays) {
                    forgotRelance += 1;
                    const boost = bucket === "afternoon" ? 12 : bucket === "morning" ? 4 : 8;
                    push({
                        key: `${workspace.id}:${lead.id}:forgot_relance:${todayKey}`,
                        lead,
                        kind: "forgot_relance",
                        title: "Oubli de relance",
                        label: d === 1
                            ? `Pas de réponse hier — pose un rappel (${ctx})`
                            : `NRP il y a ${d} j — toujours sans rappel`,
                        overdue: d >= profile.forgotRelanceDays + 2,
                        score: 70 + Math.min(d * 4, 24) + boost + valueBoost,
                        due: new Date(nrpAt).getTime(),
                        dueAt: nrpAt,
                    });
                }
            }
        }

        // ── Nouveau qui dort ────────────────────────────────────────────────
        if (!skipGeneric && !sched.has && isNouveauColumn(colName) && createdDays >= profile.staleNouveauDays) {
            staleNouveau += 1;
            const boost = bucket === "morning" && profile.preferMorningCalls ? 15
                : bucket === "morning" ? 8
                    : 5;
            // Fiche vide → cloche OK ; sur la fiche lead c’est la Vigilance (pas Conseil)
            if (!lead.phone && !lead.email) {
                push({
                    key: `${workspace.id}:${lead.id}:incomplete_nouveau:${todayKey}`,
                    lead,
                    kind: "incomplete_card",
                    title: "Fiche incomplète",
                    label: `Nouveau depuis ${createdDays} j — ajoute un tél. ou e-mail`,
                    overdue: createdDays >= profile.staleNouveauDays + 3,
                    score: 58 + Math.min(createdDays * 2, 20) + boost,
                    due: new Date(lead.createdAt || now).getTime(),
                    dueAt: lead.createdAt || null,
                });
            } else {
                const action = profile.isJobs ? "relancer le recruteur" : `premier ${profile.callVerb}`;
                push({
                    key: `${workspace.id}:${lead.id}:stale_nouveau:${todayKey}`,
                    lead,
                    kind: "stale_nouveau",
                    title: profile.isJobs ? "Candidature en attente" : "Nouveau en attente",
                    label: createdDays >= profile.staleNouveauDays + 5
                        ? `Depuis ${createdDays} j — ${action} ?`
                        : `Toujours en entrée · ${createdDays} j`,
                    overdue: createdDays >= profile.staleNouveauDays + 3,
                    score: 55 + Math.min(createdDays * 3, 30) + boost + valueBoost,
                    due: new Date(lead.createdAt || now).getTime(),
                    dueAt: lead.createdAt || null,
                });
            }
        }

        // ── Contacté / rappel sans prochain geste ───────────────────────────
        if (!skipGeneric && !sched.has && (isContactedColumn(colName) || inRappel)) {
            const since = idleDays ?? createdDays;
            if (since >= profile.staleContactedDays) {
                push({
                    key: `${workspace.id}:${lead.id}:stale_contacted:${todayKey}`,
                    lead,
                    kind: "stale_contacted",
                    title: "Suite manquante",
                    label: since >= profile.staleContactedDays + 5
                        ? `Silence ${since} j — rappel ou ${profile.rdvNoun}`
                        : `Pas de suite planifiée · ${since} j`,
                    overdue: since >= profile.staleContactedDays + 3,
                    score: 60 + Math.min(since * 3, 24) + (bucket === "afternoon" ? 8 : 0) + valueBoost,
                    due: activity ? new Date(activity).getTime() : now.getTime(),
                    dueAt: activity,
                });
            }
        }

        // ── Colonne RDV sans date ───────────────────────────────────────────
        if (inMeeting && !sched.isRdv) {
            push({
                key: `${workspace.id}:${lead.id}:meeting_sans_rdv:${todayKey}`,
                lead,
                kind: "meeting_sans_rdv",
                title: `${profile.rdvNoun} incomplet`,
                label: profile.isJobs
                    ? "En colonne entretien sans date"
                    : "En colonne RDV sans date au calendrier",
                overdue: true,
                score: 88 + valueBoost,
                due: now.getTime(),
                dueAt: null,
            });
        }

        // ── Proposition sans suite ──────────────────────────────────────────
        if (!skipGeneric && !sched.has && inProp && (idleDays ?? 0) >= 2) {
            stuckProp += 1;
            push({
                key: `${workspace.id}:${lead.id}:stale_prop:${todayKey}`,
                lead,
                kind: "stale_proposition",
                title: "Proposition en pause",
                label: `Aucune suite depuis ${idleDays} j — relance ou ${profile.rdvNoun}`,
                overdue: (idleDays ?? 0) >= 5,
                score: 66 + Math.min((idleDays || 0), 12) + valueBoost,
                due: activity ? new Date(activity).getTime() : now.getTime(),
                dueAt: activity,
            });
        }

        // ── Fiche : tél manquant après joint (cloche) — fiche → Vigilance ────
        if (!skipGeneric && reachedAt && !lead.phone) {
            const d = daysBetween(reachedAt, now);
            if (d != null && d <= 14) {
                push({
                    key: `${workspace.id}:${lead.id}:missing_phone:${toLocalDateKey(reachedAt)}`,
                    lead,
                    kind: "missing_phone",
                    title: "Tél. manquant",
                    label: profile.isJobs
                        ? "Échange joint — numéro recruteur manquant"
                        : "Appel joint — aucun numéro sur la fiche",
                    overdue: false,
                    score: 48 + (bucket === "evening" ? 6 : 0),
                    due: new Date(reachedAt).getTime(),
                    dueAt: reachedAt,
                });
            }
        }

        // ── Infos d'appel non appliquées ────────────────────────────────────
        if (!skipGeneric) {
            const callText = (lead.notes || [])
                .filter((n) => n?.recordingId && String(n.transcript || "").trim())
                .map((n) => n.transcript)
                .join("\n");
            if (callText.trim()) {
                const appt = detectAppointment(callText);
                if (appt?.iso && !sched.isRdv) {
                    const existingDue = lead.nextAction?.dueAt || lead.nextAction?.date;
                    const sameDay = existingDue
                        && toLocalDateKey(existingDue) === toLocalDateKey(appt.iso);
                    if (!sameDay) {
                        push({
                            key: `${workspace.id}:${lead.id}:brief_appointment:${todayKey}`,
                            lead,
                            kind: "brief_suggestion",
                            title: "Suggestion d'appel",
                            label: `Date détectée · ${appt.label}`,
                            overdue: false,
                            score: 64 + valueBoost,
                            due: now.getTime(),
                            dueAt: null,
                        });
                    }
                } else {
                    const detected = parseNote(callText);
                    if (!lead.phone && detected.phones?.[0]) {
                        push({
                            key: `${workspace.id}:${lead.id}:brief_phone:${todayKey}`,
                            lead,
                            kind: "brief_suggestion",
                            title: "Suggestion d'appel",
                            label: `Tél. détecté · ${detected.phones[0]}`,
                            overdue: false,
                            score: 52,
                            due: now.getTime(),
                            dueAt: null,
                        });
                    } else if (!lead.contact && detected.persons?.[0]) {
                        push({
                            key: `${workspace.id}:${lead.id}:brief_person:${todayKey}`,
                            lead,
                            kind: "brief_suggestion",
                            title: "Suggestion d'appel",
                            label: `Contact détecté · ${detected.persons[0]}`,
                            overdue: false,
                            score: 50,
                            due: now.getTime(),
                            dueAt: null,
                        });
                    }
                }
            }
        }

        // ── Objection dure sans classement Perdu ────────────────────────────
        if (!skipGeneric && !sched.has && objection && (idleDays ?? 0) >= 3) {
            push({
                key: `${workspace.id}:${lead.id}:close_or_park:${todayKey}`,
                lead,
                kind: "close_park",
                title: "Trancher la piste",
                label: "Objection claire en note — reclasse Perdu ou tente un dernier angle",
                overdue: false,
                score: 44 + Math.min(idleDays || 0, 10),
                due: activity ? new Date(activity).getTime() : now.getTime(),
                dueAt: activity,
            });
        }

        // ── Silence long sans agenda ────────────────────────────────────────
        if (!skipGeneric && !sched.has && idleDays != null && idleDays >= profile.coldGapDays) {
            push({
                key: `${workspace.id}:${lead.id}:cold_gap:${todayKey}`,
                lead,
                kind: "cold_gap",
                title: "Piste froide",
                label: profile.isJobs
                    ? `Aucune nouvelle depuis ${idleDays} j`
                    : `Aucun échange depuis ${idleDays} j · ${ctx}`,
                overdue: idleDays >= profile.coldGapDays + 7,
                score: 40 + Math.min(idleDays - profile.coldGapDays, 20)
                    + (bucket === "morning" ? 5 : 0)
                    + valueBoost,
                due: activity ? new Date(activity).getTime() : now.getTime(),
                dueAt: activity,
            });
        }
    }

    const goal = Math.max(1, Number(opts.dailyGoal) || 20);

    // Tips workspace — niche + jour + moment
    if (dayPart === "monday" && bucket === "morning" && staleNouveau >= Math.max(2, profile.batchNouveauMin - 1)) {
        push({
            key: `${workspace.id}:tip:monday_start:${todayKey}`,
            lead: null,
            kind: "tip_batch",
            title: "Lundi — démarrage",
            label: `${staleNouveau} ${profile.nouveauNoun} sur « ${ctx} » — pose le rythme de la semaine`,
            overdue: false,
            score: 50,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (dayPart === "friday" && bucket !== "morning" && (overdueCoaching >= 1 || stuckProp >= 2)) {
        push({
            key: `${workspace.id}:tip:friday_wrap:${todayKey}`,
            lead: null,
            kind: "tip_batch",
            title: "Vendredi — clôture",
            label: `Range les retards / propositions sur « ${ctx} » avant le week-end`,
            overdue: false,
            score: 47,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (bucket === "morning" && hotLeads >= 1) {
        push({
            key: `${workspace.id}:tip:hot_morning:${todayKey}`,
            lead: null,
            kind: "tip_batch",
            title: "Pistes chaudes",
            label: `${hotLeads} lead${hotLeads > 1 ? "s" : ""} prêt${hotLeads > 1 ? "s" : ""} pour un ${profile.rdvNoun} sur « ${ctx} »`,
            overdue: false,
            score: 49,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (bucket === "morning" && staleNouveau >= profile.batchNouveauMin) {
        push({
            key: `${workspace.id}:tip:batch_nouveau:${todayKey}`,
            lead: null,
            kind: "tip_batch",
            title: profile.tipFocus === "volume" ? "Session volume" : "Session du matin",
            label: `${staleNouveau} ${profile.nouveauNoun} sur « ${ctx} » — enchaîne ${profile.morningBatchSize} ${profile.callNoun}`,
            overdue: false,
            score: 45,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (bucket === "afternoon" && (forgotRelance >= profile.batchRelanceMin || rdvOpportunities >= 2)) {
        if (rdvOpportunities >= 2 && profile.preferRdv) {
            push({
                key: `${workspace.id}:tip:batch_rdv:${todayKey}`,
                lead: null,
                kind: "tip_batch",
                title: `Vague ${profile.rdvNoun}`,
                label: `${rdvOpportunities} pistes prêtes pour un ${profile.rdvNoun} sur « ${ctx} »`,
                overdue: false,
                score: 48,
                due: now.getTime(),
                dueAt: null,
            });
        } else {
            push({
                key: `${workspace.id}:tip:batch_relance:${todayKey}`,
                lead: null,
                kind: "tip_batch",
                title: "Vague de relances",
                label: `${forgotRelance} NRP sans rappel — 10 min sur « ${ctx} »`,
                overdue: false,
                score: 46,
                due: now.getTime(),
                dueAt: null,
            });
        }
    } else if (bucket === "evening" && overdueCoaching >= 2) {
        push({
            key: `${workspace.id}:tip:overdue_wrap:${todayKey}`,
            lead: null,
            kind: "tip_batch",
            title: "Fin de journée",
            label: `${overdueCoaching} retards à trancher sur « ${ctx} » (RDV ou replan)`,
            overdue: false,
            score: 42,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (stuckProp >= 3 && profile.tipFocus === "pipeline") {
        push({
            key: `${workspace.id}:tip:prop_push:${todayKey}`,
            lead: null,
            kind: "tip_batch",
            title: "Pipeline propositions",
            label: `${stuckProp} propositions en pause sur « ${ctx} » — 15 min de relances`,
            overdue: false,
            score: 44,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (bucket === "evening" && contactedToday > 0 && contactedToday < goal) {
        const left = goal - contactedToday;
        push({
            key: `${workspace.id}:tip:daily_goal:${todayKey}`,
            lead: null,
            kind: "tip_goal",
            title: "Objectif du jour",
            label: `${contactedToday}/${goal} contacts — encore ${left} pour boucler`,
            overdue: false,
            score: 35,
            due: now.getTime(),
            dueAt: null,
        });
    } else if (activeCount > 0 && contactedToday === 0 && bucket !== "evening" && dayPart !== "weekend") {
        push({
            key: `${workspace.id}:tip:start_day:${todayKey}`,
            lead: null,
            kind: "tip_start",
            title: "Démarrage",
            label: profile.isJobs
                ? `Aucun suivi aujourd'hui sur « ${ctx} »`
                : `Aucun contact aujourd'hui — ouvre « ${ctx} »`,
            overdue: false,
            score: 30 + (bucket === "morning" ? 10 : 0),
            due: now.getTime(),
            dueAt: null,
        });
    }

    return selectDiverse(candidates, MAX_PER_WORKSPACE);
}

/**
 * Kinds toujours exclus du bloc « Conseil » fiche (qualité fiche = Vigilance).
 * Les autres doublons sont filtrés via VIGILANCE_SUPPRESSES_CONSEIL si l’issue est active.
 */
const BRIEF_VIGILANCE_KINDS = new Set([
    "incomplete_card",
    "missing_phone",
]);

/** Vigilance id → kinds Conseil à masquer sur la même fiche. */
const VIGILANCE_SUPPRESSES_CONSEIL = {
    nouveau_sans_coord: ["incomplete_card", "missing_phone"],
    prospection_sans_tel: ["missing_phone", "incomplete_card"],
    meeting_sans_rdv: ["meeting_sans_rdv", "suggest_rdv"],
    rdv_overdue: ["suggest_rdv", "rdv_followup"],
    no_answer_stale: ["forgot_relance", "channel_switch"],
    contact_gap: ["cold_gap"],
    nouveau_stale: ["stale_nouveau"],
    contacted_sans_trace: ["stale_contacted"],
};

/**
 * Conseils actifs pour UN lead (fiche / Information pertinente).
 * Ignore le plafond workspace : on recalcule sur ce prospect seul.
 * Exclut les kinds déjà couverts par Vigilance.
 * @param {object} workspace
 * @param {string} leadId
 * @param {{ now?: Date, dailyGoal?: number }} [opts]
 * @returns {NotifItem[]}
 */
export function getLeadFollowupNotifs(workspace, leadId, opts = {}) {
    const lead = workspace?.leads?.[leadId];
    if (!lead?.id || !workspace?.id) return [];
    const now = opts.now ? new Date(opts.now) : new Date();
    const vigIds = new Set(
        (getLeadVigilance(lead, workspace.columns || {}, workspace.inconsistencyConfig, now).issues || [])
            .map((i) => i.id)
            .filter(Boolean)
    );
    const suppressed = new Set(BRIEF_VIGILANCE_KINDS);
    for (const vid of vigIds) {
        for (const kind of VIGILANCE_SUPPRESSES_CONSEIL[vid] || []) {
            suppressed.add(kind);
        }
    }
    return getWorkspaceFollowupNotifs(
        { ...workspace, leads: { [leadId]: lead } },
        opts
    ).filter(
        (item) => item.lead?.id === leadId && !suppressed.has(item.kind)
    );
}

export function countWorkspaceFollowupNotifs(workspace) {
    return getWorkspaceFollowupNotifs(workspace).length;
}

/** @deprecated — préférer item.key */
export function notifItemKey(workspaceId, lead) {
    return `${workspaceId}:${lead?.id || ""}:reco`;
}

export function loadNotifSeenItems() {
    try {
        const raw = localStorage.getItem(SEEN_ITEMS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveNotifSeenItems(map) {
    try {
        localStorage.setItem(SEEN_ITEMS_KEY, JSON.stringify(map));
    } catch { /* ignore */ }
    try {
        window.dispatchEvent(new Event(NOTIF_SEEN_EVENT));
    } catch { /* ignore */ }
}

/** @deprecated alias */
export function loadNotifSeenMap() {
    return loadNotifSeenItems();
}

export function isNotifItemUnread(itemOrWorkspaceId, lead, seenItems = loadNotifSeenItems()) {
    if (itemOrWorkspaceId && typeof itemOrWorkspaceId === "object" && itemOrWorkspaceId.key) {
        return !seenItems[itemOrWorkspaceId.key];
    }
    if (!itemOrWorkspaceId || !lead?.id) return false;
    return !seenItems[notifItemKey(itemOrWorkspaceId, lead)];
}

export function getUnreadWorkspaceNotifs(workspace, seenItems = loadNotifSeenItems(), opts = {}) {
    return getWorkspaceFollowupNotifs(workspace, opts).filter((item) => !seenItems[item.key]);
}

export function isWorkspaceNotifUnread(workspace, seenItems = loadNotifSeenItems()) {
    return getUnreadWorkspaceNotifs(workspace, seenItems).length > 0;
}

export function countUnreadWorkspaceNotifs(workspace, seenItems = loadNotifSeenItems()) {
    return getUnreadWorkspaceNotifs(workspace, seenItems).length;
}

export function countAllUnreadNotifs(workspaces, seenItems = loadNotifSeenItems(), opts = {}) {
    let n = 0;
    for (const ws of workspaces || []) {
        n += getUnreadWorkspaceNotifs(ws, seenItems, opts).length;
    }
    return n;
}

export function getAllFollowupNotifs(workspaces, opts = {}) {
    const out = [];
    for (const ws of workspaces || []) {
        for (const item of getWorkspaceFollowupNotifs(ws, {
            ...opts,
            dailyGoal: opts.dailyGoal,
        })) {
            out.push({ ...item, workspaceId: ws.id, workspaceName: ws.name });
        }
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    return out.slice(0, MAX_GLOBAL);
}

export function getAllUnreadNotifs(workspaces, seenItems = loadNotifSeenItems(), opts = {}) {
    return getAllFollowupNotifs(workspaces, opts).filter((item) => !seenItems[item.key]);
}

export function markNotifItemRead(itemOrWorkspaceId, lead) {
    const map = loadNotifSeenItems();
    if (itemOrWorkspaceId && typeof itemOrWorkspaceId === "object" && itemOrWorkspaceId.key) {
        map[itemOrWorkspaceId.key] = true;
        saveNotifSeenItems(map);
        // open vs dismiss : le caller peut passer meta.outcome
        const outcome = itemOrWorkspaceId._usageOutcome === "dismiss" ? "dismiss" : "open";
        trackNotifInteraction(itemOrWorkspaceId, outcome);
        return;
    }
    if (!itemOrWorkspaceId || !lead?.id) return;
    map[notifItemKey(itemOrWorkspaceId, lead)] = true;
    saveNotifSeenItems(map);
}

export function markWorkspaceNotifsRead(workspace) {
    if (!workspace?.id) return;
    const map = loadNotifSeenItems();
    for (const item of getWorkspaceFollowupNotifs(workspace)) {
        map[item.key] = true;
    }
    saveNotifSeenItems(map);
}

export function markLeadNotifsRead(workspaces, workspaceId, leadId) {
    if (!workspaceId || !leadId) return;
    const map = loadNotifSeenItems();
    let changed = false;
    for (const ws of workspaces || []) {
        if (ws?.id !== workspaceId) continue;
        for (const item of getWorkspaceFollowupNotifs(ws)) {
            if (item.lead?.id !== leadId) continue;
            if (!map[item.key]) {
                map[item.key] = true;
                changed = true;
            }
        }
    }
    if (changed) saveNotifSeenItems(map);
}

export function markAllNotifsRead(workspaces) {
    const map = loadNotifSeenItems();
    for (const ws of workspaces || []) {
        if (!ws?.id) continue;
        for (const item of getWorkspaceFollowupNotifs(ws)) {
            map[item.key] = true;
        }
    }
    saveNotifSeenItems(map);
    try {
        localStorage.removeItem(LEGACY_SEEN_MAP_KEY);
    } catch { /* ignore */ }
}
