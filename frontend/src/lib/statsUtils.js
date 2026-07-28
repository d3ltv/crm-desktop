// ---------- Stats computation helpers ----------

import {
    isWonColumn,
    isLostColumn,
    isContactedColumn,
    isMeetingColumn,
} from "@/constants/columnPatterns";
import { toLocalDateKey } from "@/lib/dateUtils";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { getLeadVigilance } from "@/lib/inconsistencyRules";
import { getProspectingBrief } from "@/lib/reliaBrain";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function formatDuration(ms) {
    if (!ms || ms < 0) return "—";
    const days = Math.floor(ms / DAY_MS);
    const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
    if (days >= 2) return `${days} j`;
    if (days === 1) return hours > 0 ? `1 j ${hours} h` : "1 jour";
    if (hours >= 1) return `${hours} h`;
    return "< 1 h";
}

function avg(arr) {
    if (!arr.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Détecte la colonne "Gagné", "Perdu" et les colonnes "Contacté" d'un workspace
 * via les patterns centralisés dans columnPatterns.js
 */
function detectSpecialCols(columns) {
    let wonId = null, lostId = null, contactIds = [];
    for (const col of Object.values(columns)) {
        if (!wonId  && isWonColumn(col.name))      wonId = col.id;
        if (!lostId && isLostColumn(col.name))     lostId = col.id;
        if (isContactedColumn(col.name))           contactIds.push(col.id);
    }
    return { wonId, lostId, contactIds };
}

/**
 * Calcule toutes les statistiques pour un workspace donné.
 * @param {object} ws
 * @param {{ includeQuality?: boolean }} [opts]
 *   includeQuality — vigilance + cabinets (coûteux). Désactivé par défaut
 *   pour la page d'accueil / cartes espaces.
 */
export function computeWorkspaceStats(ws, { includeQuality = false } = {}) {
    const leads = Object.values(ws.leads);
    const total = leads.length;
    const { wonId, lostId, contactIds } = detectSpecialCols(ws.columns);

    const won   = leads.filter((l) => l.columnId === wonId).length;
    const lost  = leads.filter((l) => l.columnId === lostId).length;
    const active = leads.filter((l) => l.columnId !== wonId && l.columnId !== lostId).length;

    const conversionRate = total > 0 ? (won  / total) * 100 : null;
    const lostRate       = total > 0 ? (lost / total) * 100 : null;

    // Temps moyen avant premier contact
    const timeToContactMs = [];
    for (const l of leads) {
        const history = l.statusHistory || [];
        const firstEntry = history[0];
        const firstContact = history.find((e) => contactIds.includes(e.columnId) && e !== firstEntry);
        if (firstEntry && firstContact) {
            timeToContactMs.push(new Date(firstContact.at) - new Date(firstEntry.at));
        }
    }
    const avgTimeToContact = avg(timeToContactMs);

    // Durée moyenne dans le pipeline (de createdAt à maintenant, leads actifs uniquement)
    const pipelineDurations = leads
        .filter((l) => l.columnId !== wonId && l.columnId !== lostId)
        .map((l) => Date.now() - new Date(l.createdAt).getTime())
        .filter((d) => d > 0);
    const avgPipelineDuration = avg(pipelineDurations);

    // Durée moyenne pour closer (createdAt → statusHistory entry dans wonId)
    const closingDurations = [];
    for (const l of leads) {
        if (l.columnId !== wonId) continue;
        const wonEntry = [...(l.statusHistory || [])].reverse().find((e) => e.columnId === wonId);
        if (wonEntry) closingDurations.push(new Date(wonEntry.at) - new Date(l.createdAt));
    }
    const avgClosingDuration = avg(closingDurations);

    // Leads par colonne
    const byColumn = ws.columnOrder.map((cid) => {
        const col = ws.columns[cid];
        const count = leads.filter((l) => l.columnId === cid).length;
        return { id: cid, name: col.name, count, color: col.color };
    });

    // Notes & activité
    const totalNotes = leads.reduce((s, l) => s + (l.notes || []).length, 0);
    const lastContactDates = leads
        .filter((l) => l.lastContact)
        .map((l) => new Date(l.lastContact).getTime());
    const lastActivityAt = lastContactDates.length ? Math.max(...lastContactDates) : null;

    // Leads sans coordonnées (phone + email + website tous vides)
    const noContact = leads.filter((l) => !l.phone && !l.email && !l.website).length;

    // Leads avec rappel en retard
    const overdueFollowups = leads.filter(
        (l) => l.autoFollowup && (l.autoFollowup.overdue || new Date(l.autoFollowup.dueAt) <= new Date())
    ).length;

    // ---- Vigilance & cabinets (optionnel — coûteux sur gros pipelines) ----
    let agencySuspectCount = 0;
    let vigilanceCriticalCount = 0;
    let vigilanceWarningCount = 0;
    let agencyWon = 0;
    let directWon = 0;
    let agencyRate = null;
    let agencyConversionRate = null;
    let directConversionRate = null;

    if (includeQuality) {
        const agencyOn = isAgencyDetectionEnabled(ws);
        for (const l of leads) {
            const isAgency = !!getAgencySuspicion(l, agencyOn);
            if (isAgency) agencySuspectCount++;

            const vig = getLeadVigilance(l, ws.columns, ws.inconsistencyConfig);
            if (vig.level === "critical") vigilanceCriticalCount++;
            else if (vig.level === "warning") vigilanceWarningCount++;

            if (l.columnId === wonId) {
                if (isAgency) agencyWon++;
                else directWon++;
            }
        }

        const directCount = Math.max(0, total - agencySuspectCount);
        agencyRate = total > 0 ? (agencySuspectCount / total) * 100 : null;
        agencyConversionRate = agencySuspectCount > 0 ? (agencyWon / agencySuspectCount) * 100 : null;
        directConversionRate = directCount > 0 ? (directWon / directCount) * 100 : null;
    }

    // ---- Prix / deal values ----
    // Tous les leads avec un dealValue (peu importe la colonne — peut être saisi manuellement)
    const dealsWithValue = leads
        .filter((l) => l.dealValue != null && !isNaN(l.dealValue) && l.dealValue > 0)
        .sort((a, b) => {
            const ta = a.dealClosedAt ? new Date(a.dealClosedAt).getTime() : new Date(a.createdAt).getTime();
            const tb = b.dealClosedAt ? new Date(b.dealClosedAt).getTime() : new Date(b.createdAt).getTime();
            return ta - tb;
        });

    const dealValues = dealsWithValue.map((l) => l.dealValue);
    const totalRevenue  = dealValues.reduce((s, v) => s + v, 0);
    const avgDealValue  = avg(dealValues);
    const medianDealValue = median(dealValues);
    const minDealValue  = dealValues.length ? Math.min(...dealValues) : null;
    const maxDealValue  = dealValues.length ? Math.max(...dealValues) : null;

    // Série chronologique pour le graphique (cumul + valeurs individuelles)
    // Chaque point = { date: ISO string, value: montant, cumul: cumul à ce point, company }
    let cumul = 0;
    const dealTimeline = dealsWithValue.map((l) => {
        cumul += l.dealValue;
        return {
            date: l.dealClosedAt || l.createdAt,
            value: l.dealValue,
            cumul,
            company: l.company,
            id: l.id,
        };
    });

    // Distribution par tranche (ex: 0-500, 500-1000, 1000-2500, 2500-5000, 5000+)
    const BRACKETS = [
        { label: "< 500 €",      min: 0,    max: 500    },
        { label: "500–1k €",     min: 500,  max: 1000   },
        { label: "1k–2.5k €",   min: 1000, max: 2500   },
        { label: "2.5k–5k €",   min: 2500, max: 5000   },
        { label: "5k–10k €",    min: 5000, max: 10000  },
        { label: "> 10k €",     min: 10000, max: Infinity },
    ];
    const dealDistribution = BRACKETS.map((b) => ({
        ...b,
        count: dealValues.filter((v) => v >= b.min && v < b.max).length,
    })).filter((b) => b.count > 0);

    // Motifs de perte (QCM)
    const lostReasonMap = {};
    for (const l of leads) {
        if (l.columnId !== lostId) continue;
        const key = l.lostReasonLabel || l.lostReason || "Non renseigné";
        lostReasonMap[key] = (lostReasonMap[key] || 0) + 1;
    }
    const lostReasons = Object.entries(lostReasonMap)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    // Nombre moyen de passages en colonne RDV avant close (gagnés)
    const meetingIds = new Set(
        (ws.columnOrder || [])
            .filter((cid) => isMeetingColumn(ws.columns?.[cid]?.name))
    );
    const rdvBeforeClose = [];
    for (const l of leads) {
        if (l.columnId !== wonId) continue;
        const hist = l.statusHistory || [];
        let visits = 0;
        let prev = null;
        for (const e of hist) {
            if (meetingIds.has(e.columnId) && e.columnId !== prev) visits += 1;
            prev = e.columnId;
        }
        rdvBeforeClose.push(visits);
    }
    const avgRdvsBeforeClose = rdvBeforeClose.length
        ? rdvBeforeClose.reduce((s, n) => s + n, 0) / rdvBeforeClose.length
        : null;

    // CA uniquement sur deals gagnés (colonne won)
    const wonRevenue = leads
        .filter((l) => l.columnId === wonId && l.dealValue != null && !isNaN(l.dealValue) && l.dealValue > 0)
        .reduce((s, l) => s + Number(l.dealValue), 0);

    return {
        total,
        won,
        lost,
        active,
        conversionRate,
        lostRate,
        avgTimeToContact,
        avgPipelineDuration,
        avgClosingDuration,
        byColumn,
        totalNotes,
        lastActivityAt,
        noContact,
        overdueFollowups,
        // vigilance / cabinets
        agencySuspectCount,
        agencyRate,
        vigilanceCriticalCount,
        vigilanceWarningCount,
        agencyWon,
        directWon,
        agencyConversionRate,
        directConversionRate,
        // deal / prix
        totalRevenue,
        avgDealValue,
        medianDealValue,
        minDealValue,
        maxDealValue,
        dealTimeline,
        dealDistribution,
        dealsWithValueCount: dealValues.length,
        lostReasons,
        avgRdvsBeforeClose,
        wonRevenue,
    };
}

/**
 * Agrège les stats de plusieurs workspaces en un total global.
 */
export function aggregateStats(statsList) {
    if (!statsList.length) return null;

    const sum = (key) => statsList.reduce((s, st) => s + (st[key] || 0), 0);
    const avgMs = (key) => {
        const vals = statsList.map((st) => st[key]).filter((v) => v !== null);
        return avg(vals);
    };
    const avgNullable = (key) => {
        const vals = statsList.map((st) => st[key]).filter((v) => v !== null && v !== undefined);
        return avg(vals);
    };

    const total = sum("total");
    const won   = sum("won");
    const lost  = sum("lost");

    // Merge byColumn — group by column name (case-insensitive)
    const colMap = new Map();
    for (const st of statsList) {
        for (const c of st.byColumn) {
            const key = c.name.toLowerCase();
            if (!colMap.has(key)) colMap.set(key, { ...c });
            else colMap.get(key).count += c.count;
        }
    }

    // Merge deal timelines sorted chronologically
    const allTimeline = statsList.flatMap((st) => st.dealTimeline || [])
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    let cumul = 0;
    const dealTimeline = allTimeline.map((pt) => {
        cumul += pt.value;
        return { ...pt, cumul };
    });

    // Merge distributions
    const distMap = new Map();
    for (const st of statsList) {
        for (const b of (st.dealDistribution || [])) {
            if (!distMap.has(b.label)) distMap.set(b.label, { ...b });
            else distMap.get(b.label).count += b.count;
        }
    }

    const lostReasonMap = new Map();
    for (const st of statsList) {
        for (const r of (st.lostReasons || [])) {
            if (!lostReasonMap.has(r.label)) lostReasonMap.set(r.label, { label: r.label, count: r.count });
            else lostReasonMap.get(r.label).count += r.count;
        }
    }

    const allValues = statsList.flatMap((st) => (st.dealTimeline || []).map((p) => p.value));
    const totalRevenue = sum("totalRevenue");

    return {
        total,
        won,
        lost,
        active: sum("active"),
        conversionRate: total > 0 ? (won / total) * 100 : null,
        lostRate:       total > 0 ? (lost / total) * 100 : null,
        avgTimeToContact:    avgMs("avgTimeToContact"),
        avgPipelineDuration: avgMs("avgPipelineDuration"),
        avgClosingDuration:  avgMs("avgClosingDuration"),
        byColumn: [...colMap.values()],
        totalNotes: sum("totalNotes"),
        lastActivityAt: Math.max(...statsList.map((s) => s.lastActivityAt || 0)) || null,
        noContact: sum("noContact"),
        overdueFollowups: sum("overdueFollowups"),
        // vigilance / cabinets
        agencySuspectCount: sum("agencySuspectCount"),
        agencyRate: total > 0 ? (sum("agencySuspectCount") / total) * 100 : null,
        vigilanceCriticalCount: sum("vigilanceCriticalCount"),
        vigilanceWarningCount: sum("vigilanceWarningCount"),
        agencyWon: sum("agencyWon"),
        directWon: sum("directWon"),
        agencyConversionRate: (() => {
            const a = sum("agencySuspectCount");
            return a > 0 ? (sum("agencyWon") / a) * 100 : null;
        })(),
        directConversionRate: (() => {
            const d = Math.max(0, total - sum("agencySuspectCount"));
            return d > 0 ? (sum("directWon") / d) * 100 : null;
        })(),
        // deal / prix
        totalRevenue,
        avgDealValue: avgNullable("avgDealValue"),
        medianDealValue: median(allValues),
        minDealValue: allValues.length ? Math.min(...allValues) : null,
        maxDealValue: allValues.length ? Math.max(...allValues) : null,
        dealTimeline,
        dealDistribution: [...distMap.values()],
        dealsWithValueCount: sum("dealsWithValueCount"),
        lostReasons: [...lostReasonMap.values()].sort((a, b) => b.count - a.count),
        avgRdvsBeforeClose: avgNullable("avgRdvsBeforeClose"),
        wonRevenue: sum("wonRevenue"),
    };
}

/**
 * Extrait toutes les notes d'appel de tous les leads de tous les workspaces fournis.
 * Retourne un tableau de { at: Date, answered: boolean, workspaceId, leadId, company }.
 *
 * Détection :
 *   - "📞" dans le texte → appel décroché (answered = true)
 *   - "📵" dans le texte → pas de réponse (answered = false)
 */
function extractCallEvents(workspaces) {
    const events = [];
    for (const ws of workspaces) {
        for (const lead of Object.values(ws.leads || {})) {
            for (const note of lead.notes || []) {
                const text = note.text || "";
                const isCall = text.includes("📞") || text.includes("📵");
                if (!isCall) continue;
                const answered = text.includes("📞");
                const at = note.at ? new Date(note.at) : null;
                if (!at || isNaN(at)) continue;
                events.push({
                    at,
                    answered,
                    workspaceId: ws.id,
                    leadId: lead.id,
                    company: lead.company || "",
                });
            }
        }
    }
    return events;
}

/**
 * Calcule les statistiques d'appels avancées à partir des workspaces.
 *
 * Retourne :
 *   - totalCalls        : nombre total d'appels
 *   - totalAnswered     : nombre de décrochés
 *   - globalAnswerRate  : taux global de décrochage (0–100)
 *   - byHour            : [{hour, total, answered, rate}] × 24
 *   - byDayOfWeek       : [{day (0=Dim…6=Sam), label, total, answered, rate}] × 7
 *   - byDay             : [{date (YYYY-MM-DD), total, answered, rate}] — 90 derniers jours avec activité
 *   - last30Days        : [{date, total, answered, rate}] — 30 derniers jours calendaires (y.c. 0)
 *   - bestHour          : {hour, rate, total} — heure avec le meilleur taux (min 3 appels)
 *   - bestDay           : {day, label, rate, total} — jour de semaine avec le meilleur taux
 *   - streak            : nombre de jours consécutifs avec au moins 1 appel (jusqu'à aujourd'hui)
 */
export function computeCallStats(workspaces) {
    const events = extractCallEvents(workspaces);

    const total = events.length;
    const answered = events.filter((e) => e.answered).length;
    const globalAnswerRate = total > 0 ? (answered / total) * 100 : null;

    // ── Par heure (0–23) ──────────────────────────────────────────────────────
    const byHour = Array.from({ length: 24 }, (_, h) => {
        const calls = events.filter((e) => e.at.getHours() === h);
        const ans   = calls.filter((e) => e.answered).length;
        return {
            hour: h,
            total: calls.length,
            answered: ans,
            rate: calls.length > 0 ? (ans / calls.length) * 100 : null,
        };
    });

    // ── Par jour de semaine ────────────────────────────────────────────────────
    const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const byDayOfWeek = Array.from({ length: 7 }, (_, d) => {
        const calls = events.filter((e) => e.at.getDay() === d);
        const ans   = calls.filter((e) => e.answered).length;
        return {
            day: d,
            label: DAY_LABELS[d],
            total: calls.length,
            answered: ans,
            rate: calls.length > 0 ? (ans / calls.length) * 100 : null,
        };
    });

    // ── Par date (YYYY-MM-DD) ─────────────────────────────────────────────────
    const dateMap = new Map();
    for (const e of events) {
        const key = toLocalDateKey(e.at);
        if (!dateMap.has(key)) dateMap.set(key, { total: 0, answered: 0 });
        dateMap.get(key).total++;
        if (e.answered) dateMap.get(key).answered++;
    }
    const byDay = [...dateMap.entries()]
        .map(([date, { total: t, answered: a }]) => ({
            date,
            total: t,
            answered: a,
            rate: t > 0 ? (a / t) * 100 : null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // ── 30 derniers jours calendaires (rempli avec 0 pour les jours sans appel) ─
    const last30Days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = toLocalDateKey(d);
        const entry = dateMap.get(key);
        last30Days.push({
            date: key,
            total: entry?.total || 0,
            answered: entry?.answered || 0,
            rate: entry ? (entry.answered / entry.total) * 100 : null,
        });
    }

    // ── Meilleure heure / jour = cerveau Relia (même vérité accueil) ─
    const wsList = Array.isArray(workspaces) ? workspaces : [];
    const slot = getProspectingBrief(wsList);
    const bestHour = slot?.available ? slot.bestHour : null;
    const bestDay = slot?.available ? slot.bestDay : null;

    // ── Streak : jours consécutifs avec appels (jusqu'à aujourd'hui) ──────────
    let streak = 0;
    const todayKey = toLocalDateKey(today);
    let checkDate = new Date(today);
    while (true) {
        const key = toLocalDateKey(checkDate);
        if (dateMap.has(key)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else if (key === todayKey) {
            // Aujourd'hui sans appel — on remonte quand même pour voir hier
            checkDate.setDate(checkDate.getDate() - 1);
            const yesterdayKey = toLocalDateKey(checkDate);
            if (dateMap.has(yesterdayKey)) {
                checkDate = new Date(today);
                checkDate.setDate(checkDate.getDate() - 1);
                continue;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    return {
        totalCalls: total,
        totalAnswered: answered,
        globalAnswerRate,
        byHour,
        byDayOfWeek,
        byDay,
        last30Days,
        bestHour,
        bestDay,
        streak,
    };
}

/**
 * Série calendaire vide sur N jours (valeur 0).
 */
function emptyDaySeries(days = 30) {
    const series = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        series.push({ date: toLocalDateKey(d), value: 0 });
    }
    return series;
}

function monthBounds(ref = new Date()) {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const prevStart = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    const prevEnd = start;
    return { start, end, prevStart, prevEnd };
}

function inRange(ts, start, end) {
    return ts >= start.getTime() && ts < end.getTime();
}

function pctChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : null;
    return ((current - previous) / previous) * 100;
}

/**
 * Séries d'activité 30 jours pour sparklines (leads créés, notes, appels).
 * @param {Array} workspaces
 * @param {number} [days=30]
 */
export function computeActivitySeries(workspaces, days = 30) {
    const leadsCreated = emptyDaySeries(days);
    const notes = emptyDaySeries(days);
    const calls = emptyDaySeries(days);
    const leadMap = new Map(leadsCreated.map((d) => [d.date, d]));
    const noteMap = new Map(notes.map((d) => [d.date, d]));
    const callMap = new Map(calls.map((d) => [d.date, d]));

    for (const ws of workspaces || []) {
        for (const lead of Object.values(ws.leads || {})) {
            const createdKey = toLocalDateKey(lead.createdAt);
            if (leadMap.has(createdKey)) leadMap.get(createdKey).value += 1;

            for (const note of lead.notes || []) {
                const noteKey = toLocalDateKey(note.at);
                if (noteMap.has(noteKey)) noteMap.get(noteKey).value += 1;
                const text = note.text || "";
                if ((text.includes("📞") || text.includes("📵")) && callMap.has(noteKey)) {
                    callMap.get(noteKey).value += 1;
                }
            }
        }
    }

    return {
        leadsCreated,
        notes,
        calls,
        leadsCreatedValues: leadsCreated.map((d) => d.value),
        notesValues: notes.map((d) => d.value),
        callsValues: calls.map((d) => d.value),
    };
}

/**
 * Trends mois courant vs mois précédent (leads créés, notes, espaces).
 * @param {Array} workspaces
 */
export function computeMonthOverMonthTrends(workspaces) {
    const { start, end, prevStart, prevEnd } = monthBounds();
    let leadsThis = 0;
    let leadsPrev = 0;
    let notesThis = 0;
    let notesPrev = 0;
    let spacesThis = 0;
    let spacesPrev = 0;

    for (const ws of workspaces || []) {
        const createdWs = ws.createdAt ? new Date(ws.createdAt).getTime() : 0;
        if (createdWs && inRange(createdWs, start, end)) spacesThis += 1;
        if (createdWs && inRange(createdWs, prevStart, prevEnd)) spacesPrev += 1;

        for (const lead of Object.values(ws.leads || {})) {
            const created = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
            if (created && inRange(created, start, end)) leadsThis += 1;
            if (created && inRange(created, prevStart, prevEnd)) leadsPrev += 1;

            for (const note of lead.notes || []) {
                const at = note.at ? new Date(note.at).getTime() : 0;
                if (at && inRange(at, start, end)) notesThis += 1;
                if (at && inRange(at, prevStart, prevEnd)) notesPrev += 1;
            }
        }
    }

    return {
        leadsThis,
        leadsPrev,
        leadsPct: pctChange(leadsThis, leadsPrev),
        leadsDelta: leadsThis - leadsPrev,
        notesThis,
        notesPrev,
        notesPct: pctChange(notesThis, notesPrev),
        spacesThis,
        spacesPrev,
        spacesDelta: spacesThis - spacesPrev,
    };
}

/**
 * Libellé tendance FR : "+12% ce mois" / "—".
 */
export function formatTrendLabel(pct, { delta, unit } = {}) {
    if (pct == null && (delta == null || delta === 0)) return null;
    if (delta != null && unit) {
        const sign = delta > 0 ? "+" : "";
        return `${sign}${delta} ${unit}`;
    }
    if (pct == null) return null;
    const sign = pct > 0 ? "+" : "";
    return `${sign}${Math.round(pct)}% ce mois`;
}

/**
 * Valeur pipeline (€) = somme des dealValue des leads actifs (hors gagné/perdu).
 */
export function computePipelineValue(ws) {
    const { wonId, lostId } = detectSpecialCols(ws.columns || {});
    return Object.values(ws.leads || {}).reduce((sum, l) => {
        if (l.columnId === wonId || l.columnId === lostId) return sum;
        const v = l.dealValue;
        if (v == null || isNaN(v) || v <= 0) return sum;
        return sum + v;
    }, 0);
}

export { formatDuration };

/* ── Mots récurrents dans les transcriptions d'appels ───────────────── */

const FR_STOPWORDS = new Set([
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "au", "aux", "à", "a",
    "et", "ou", "mais", "donc", "or", "ni", "car", "que", "qui", "quoi", "dont", "où",
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "te", "se",
    "mon", "ton", "son", "ma", "ta", "sa", "mes", "tes", "ses", "notre", "votre", "leur",
    "ce", "cet", "cette", "ces", "cela", "ça", "c", "y", "en",
    "est", "suis", "êtes", "etes", "sont", "être", "etre", "ai", "as", "avons", "avez", "ont",
    "pas", "plus", "moins", "très", "tres", "trop", "bien", "mal", "aussi", "alors",
    "pour", "par", "avec", "sans", "sous", "sur", "dans", "chez", "vers", "entre",
    "ne", "n", "si", "oui", "non", "ok", "voilà", "voila", "bonjour", "merci", "allo", "allô",
    "euh", "hein", "bah", "ben", "voilà", "donc", "après", "avant", "pendant",
    "fait", "faire", "dit", "dire", "vais", "va", "allez", "aller", "peut", "peux", "pouvoir",
    "joint", "note", "appel", "vocale", "réponse", "reponse",
]);

function extractTranscriptCorpus(workspaces) {
    const chunks = [];
    for (const ws of workspaces || []) {
        for (const lead of Object.values(ws?.leads || {})) {
            for (const n of lead?.notes || []) {
                // Uniquement les transcriptions d'appels (pas les notes texte libres)
                const tr = String(n?.transcript || "").trim();
                if (tr) {
                    chunks.push(tr);
                    continue;
                }
                if (!n?.recordingId) continue;
                const raw = String(n?.text || "").trim();
                if (!raw) continue;
                const stripped = raw
                    .replace(/^\s*[📞📵]\s*/u, "")
                    .replace(/^(?:Joint|Pas de réponse)\s*·\s*/i, "")
                    .trim();
                if (stripped && !/^note (?:vocale|d['']appel)$/i.test(stripped)) {
                    chunks.push(stripped);
                }
            }
        }
    }
    return chunks.join("\n");
}

/**
 * Top des mots les plus fréquents dans les transcripts d'appels.
 * @returns {{ word: string, count: number }[]}
 */
export function computeTranscriptWordFreq(workspaces, { topN = 12, minLen = 4 } = {}) {
    const corpus = extractTranscriptCorpus(workspaces);
    if (!corpus.trim()) return [];

    const counts = new Map();
    const tokens = corpus
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9àâäéèêëïîôùûüç'\s-]/gi, " ")
        .split(/[\s'-]+/)
        .filter(Boolean);

    for (const raw of tokens) {
        const w = raw.trim();
        if (w.length < minLen) continue;
        if (FR_STOPWORDS.has(w)) continue;
        if (/^\d+$/.test(w)) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
    }

    return [...counts.entries()]
        .map(([word, count]) => ({ word, count }))
        .filter((x) => x.count >= 2)
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
        .slice(0, topN);
}
