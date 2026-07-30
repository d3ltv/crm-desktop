/**
 * dealEconomics.js — Économie réelle du pipeline (organe « sang » du cerveau).
 *
 * Tout est dérivé de l'état métier (`dealValue`, `statusHistory`, notes, champs) :
 * rien n'est dupliqué dans une autre mémoire, donc les chiffres restent justes
 * après un import, un merge ou un undo.
 *
 * Sortie = des nombres actionnables, pas des jolis pourcentages :
 *  - valeur d'un client (LTV observée), d'un lead, d'un appel
 *  - probabilité de close par stade (colonnes réelles du workspace, même custom)
 *  - prix unitaire appris (« 800 €/personne ») quand un champ chiffré corrèle
 *  - segments qui gagnent / qui font perdre (tags)
 *  - trous de données qui faussent tout le reste (gagnés sans montant)
 *
 * Règle : en dessous des seuils d'échantillon, on ne prononce pas de moyenne —
 * on renvoie `available: false` et l'UI dit qu'elle apprend encore.
 */

import { resolvePipelineColumnId } from "@/lib/pipelineRoles";

/** Notes d'appel produites par le modal d'appel. */
const CALL_NOTE_RE = /^(?:📞\s*Joint|📵\s*Pas de réponse)/iu;

/** En dessous, aucune moyenne de deal n'est annoncée. */
const MIN_DEALS_FOR_BASE = 2;
/** À partir de là, on considère la base de prix fiable. */
const MIN_DEALS_TRUSTED = 6;
/** Leads closés minimum pour publier un taux (stade / segment). */
const MIN_STAGE_CLOSED = 4;
const MIN_SEGMENT_CLOSED = 4;
/** Échantillons minimum pour un prix unitaire appris. */
const MIN_UNIT_SAMPLES = 3;
/** Dispersion max (MAD / médiane) tolérée pour publier un prix unitaire. */
const MAX_UNIT_SPREAD = 0.45;

/** Labels de champs qui portent déjà de l'argent — jamais des « unités ». */
const MONEY_LABEL_RE = /€|eur|montant|prix|tarif|valeur|budget|deal|ca\b|chiffre|panier|honoraire/i;
/** Labels sans aucun sens en unité vendue (identifiants, dates, codes…). */
const NON_UNIT_LABEL_RE = /t[eé]l|phone|siret|siren|code|postal|cp\b|zip|date|ann[eé]e|id\b|num[eé]ro|nb\s*avis|note|score|étoile|etoile/i;

function toNumber(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v ?? "").trim();
    if (!s) return null;
    // « 1 200,50 » / « 1,200.50 » / « 12 » — on refuse le texte avec lettres
    if (/[a-zà-ÿ]/i.test(s.replace(/\s*(?:€|eur|k€|pers(?:onnes?)?|salari[eé]s?|postes?|places?)\s*$/i, ""))) {
        return null;
    }
    const cleaned = s
        .replace(/\s|\u202f|\u00a0/g, "")
        .replace(/[€]/g, "")
        .replace(/\.(?=\d{3}\b)/g, "")
        .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function positive(v) {
    const n = toNumber(v);
    return n != null && n > 0 ? n : null;
}

function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Écart absolu médian rapporté à la médiane — robuste aux outliers. */
function relativeSpread(arr) {
    const med = median(arr);
    if (med == null || med === 0) return Infinity;
    const mad = median(arr.map((v) => Math.abs(v - med)));
    if (mad == null) return Infinity;
    return mad / med;
}

const DAY_MS = 86_400_000;

function daysBetween(a, b) {
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
    return (tb - ta) / DAY_MS;
}

/** Historique trié, sans doublons consécutifs de colonne. */
function cleanHistory(lead) {
    const hist = (lead?.statusHistory || [])
        .filter((e) => e?.columnId && e?.at)
        .map((e) => ({ columnId: e.columnId, at: e.at, t: new Date(e.at).getTime() }))
        .filter((e) => Number.isFinite(e.t))
        .sort((a, b) => a.t - b.t);
    const out = [];
    for (const e of hist) {
        if (out.length && out[out.length - 1].columnId === e.columnId) continue;
        out.push(e);
    }
    return out;
}

/** Toutes les entrées « champ chiffré » d'un lead (custom + import). */
function leadFieldEntries(lead) {
    const out = [];
    for (const f of lead?.customFields || []) {
        if (f?.label) out.push({ label: String(f.label).trim(), value: f.value });
    }
    for (const [k, v] of Object.entries(lead?.extra || {})) {
        if (k) out.push({ label: String(k).trim(), value: v });
    }
    return out;
}

function countCalls(lead) {
    let n = 0;
    for (const note of lead?.notes || []) {
        if (CALL_NOTE_RE.test(String(note?.text || "").trim())) n += 1;
    }
    return n;
}

/** Nombre de passages distincts en colonne « gagné » (récurrence client). */
function wonCycles(lead, wonId) {
    if (!wonId) return 0;
    const hist = cleanHistory(lead);
    const n = hist.filter((e) => e.columnId === wonId).length;
    if (n > 0) return n;
    return lead?.columnId === wonId ? 1 : 0;
}

const EMPTY_ECONOMICS = {
    available: false,
    confidence: 0,
    totalLeads: 0,
    wonCount: 0,
    lostCount: 0,
    closedCount: 0,
    activeCount: 0,
    valuedWonCount: 0,
    missingValueWon: 0,
    revenue: 0,
    avgDeal: null,
    medianDeal: null,
    minDeal: null,
    maxDeal: null,
    clients: 0,
    repeatClients: 0,
    repeatRate: null,
    ltv: null,
    conversionRate: null,
    leadWinRate: null,
    valuePerLead: null,
    callCount: 0,
    valuePerCall: null,
    callsPerWon: null,
    pipelineValue: 0,
    weightedPipeline: null,
    medianDaysToWin: null,
    byStage: {},
    segments: [],
    unitRates: [],
    topLostReason: null,
};

/**
 * Économie d'un workspace — base de tous les chiffres « Informations pertinentes ».
 * @param {object} workspace
 * @returns {typeof EMPTY_ECONOMICS}
 */
export function computeWorkspaceEconomics(workspace) {
    const leads = Object.values(workspace?.leads || {});
    if (!leads.length) return { ...EMPTY_ECONOMICS };

    const wonId = resolvePipelineColumnId(workspace, "won");
    const lostId = resolvePipelineColumnId(workspace, "lost");

    const isWon = (l) => !!wonId && l.columnId === wonId;
    const isLost = (l) => !!lostId && l.columnId === lostId;
    const isClosed = (l) => isWon(l) || isLost(l);

    const wonLeads = leads.filter(isWon);
    const lostLeads = leads.filter(isLost);
    const closedLeads = leads.filter(isClosed);
    const activeLeads = leads.filter((l) => !isClosed(l) && !l.archived);

    // ── Argent réellement encaissé ──────────────────────────────────────────
    const wonValues = [];
    let cycles = 0;
    let repeatClients = 0;
    const daysToWin = [];
    for (const l of wonLeads) {
        const v = positive(l.dealValue);
        if (v != null) wonValues.push(v);
        const c = wonCycles(l, wonId);
        cycles += Math.max(1, c);
        if (c >= 2) repeatClients += 1;
        const wonEntry = [...cleanHistory(l)].reverse().find((e) => e.columnId === wonId);
        const d = wonEntry && l.createdAt ? daysBetween(l.createdAt, wonEntry.at) : null;
        if (d != null && d >= 0) daysToWin.push(d);
    }

    const revenue = wonValues.reduce((s, v) => s + v, 0);
    const enoughDeals = wonValues.length >= MIN_DEALS_FOR_BASE;
    const avgDeal = enoughDeals ? mean(wonValues) : null;
    const medianDeal = enoughDeals ? median(wonValues) : null;

    const clients = wonLeads.length;
    // LTV = ce qu'un client a réellement rapporté (pas une projection).
    const ltv = clients > 0 && revenue > 0 ? revenue / clients : null;

    const conversionRate = closedLeads.length >= MIN_STAGE_CLOSED
        ? wonLeads.length / closedLeads.length
        : null;
    const leadWinRate = leads.length >= 8 ? wonLeads.length / leads.length : null;

    const callCount = leads.reduce((s, l) => s + countCalls(l), 0);
    const valuePerCall = callCount >= 10 && revenue > 0 ? revenue / callCount : null;
    const callsPerWon = clients > 0 && callCount >= 5 ? callCount / clients : null;

    const pipelineValue = activeLeads.reduce((s, l) => s + (positive(l.dealValue) || 0), 0);

    // ── Probabilité par stade — marche aussi sur des colonnes créées à la main ─
    /** @type {Record<string, { won: number, closed: number, dwell: number[], next: Record<string, number> }>} */
    const stageRaw = {};
    const touchStage = (cid) => {
        if (!stageRaw[cid]) stageRaw[cid] = { won: 0, closed: 0, dwell: [], next: {} };
        return stageRaw[cid];
    };
    for (const l of leads) {
        const hist = cleanHistory(l);
        const visited = new Set(hist.map((e) => e.columnId));
        if (l.columnId) visited.add(l.columnId);
        const closed = isClosed(l);
        const won = isWon(l);
        for (const cid of visited) {
            if (cid === wonId || cid === lostId) continue;
            const s = touchStage(cid);
            if (closed) {
                s.closed += 1;
                if (won) s.won += 1;
            }
        }
        for (let i = 0; i < hist.length - 1; i += 1) {
            const from = hist[i];
            const to = hist[i + 1];
            const s = touchStage(from.columnId);
            const d = daysBetween(from.at, to.at);
            if (d != null && d >= 0 && d < 400) s.dwell.push(d);
            s.next[to.columnId] = (s.next[to.columnId] || 0) + 1;
        }
    }

    const byStage = {};
    for (const [cid, s] of Object.entries(stageRaw)) {
        const col = workspace?.columns?.[cid];
        if (!col) continue;
        const winRate = s.closed >= MIN_STAGE_CLOSED ? s.won / s.closed : null;
        const nextEntries = Object.entries(s.next).sort((a, b) => b[1] - a[1]);
        const [nextId, nextCount] = nextEntries[0] || [null, 0];
        const exits = nextEntries.reduce((sum, [, n]) => sum + n, 0);
        byStage[cid] = {
            id: cid,
            name: col.name || "",
            winRate,
            closedSample: s.closed,
            wonSample: s.won,
            medianDwellDays: s.dwell.length >= 3 ? median(s.dwell) : null,
            dwellSample: s.dwell.length,
            usualNextId: nextCount >= 3 ? nextId : null,
            usualNextName: nextCount >= 3 ? (workspace?.columns?.[nextId]?.name || null) : null,
            usualNextShare: exits > 0 && nextCount >= 3 ? nextCount / exits : null,
            expectedValue: winRate != null && medianDeal != null ? winRate * medianDeal : null,
        };
    }

    // ── Segments : quels tags gagnent vraiment ──────────────────────────────
    const globalWinRate = conversionRate;
    /** @type {Record<string, { closed: number, won: number }>} */
    const tagRaw = {};
    for (const l of closedLeads) {
        for (const tag of l.tags || []) {
            const key = String(tag).trim();
            if (!key) continue;
            if (!tagRaw[key]) tagRaw[key] = { closed: 0, won: 0 };
            tagRaw[key].closed += 1;
            if (isWon(l)) tagRaw[key].won += 1;
        }
    }
    const segments = [];
    if (globalWinRate != null && globalWinRate > 0) {
        for (const [label, s] of Object.entries(tagRaw)) {
            if (s.closed < MIN_SEGMENT_CLOSED) continue;
            const rate = s.won / s.closed;
            const lift = rate / globalWinRate;
            if (lift >= 1.3 || lift <= 0.6) {
                segments.push({
                    kind: "tag",
                    label,
                    winRate: rate,
                    lift,
                    closedSample: s.closed,
                    wonSample: s.won,
                });
            }
        }
        segments.sort((a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1));
    }

    // ── Prix unitaire appris (« tant € pour tant de personnes ») ─────────────
    /** @type {Record<string, { rates: number[], units: number[] }>} */
    const unitRaw = {};
    for (const l of wonLeads) {
        const v = positive(l.dealValue);
        if (v == null) continue;
        for (const { label, value } of leadFieldEntries(l)) {
            if (MONEY_LABEL_RE.test(label) || NON_UNIT_LABEL_RE.test(label)) continue;
            const unit = positive(value);
            // Une unité vendue reste un petit compte (effectif, postes, places…)
            if (unit == null || unit < 1 || unit > 5000 || Math.abs(unit - Math.round(unit)) > 0.001) continue;
            const key = label.toLowerCase();
            if (!unitRaw[key]) unitRaw[key] = { rates: [], units: [], label };
            unitRaw[key].rates.push(v / unit);
            unitRaw[key].units.push(unit);
        }
    }
    const unitRates = [];
    for (const s of Object.values(unitRaw)) {
        if (s.rates.length < MIN_UNIT_SAMPLES) continue;
        if (relativeSpread(s.rates) > MAX_UNIT_SPREAD) continue;
        const rate = median(s.rates);
        if (rate == null || rate <= 0) continue;
        unitRates.push({
            label: s.label,
            key: s.label.toLowerCase(),
            ratePerUnit: rate,
            samples: s.rates.length,
            medianUnits: median(s.units),
        });
    }
    unitRates.sort((a, b) => b.samples - a.samples);

    // ── Motif de perte dominant ─────────────────────────────────────────────
    const lostRaw = {};
    for (const l of lostLeads) {
        const key = l.lostReasonLabel || l.lostReason || null;
        if (!key) continue;
        lostRaw[key] = (lostRaw[key] || 0) + 1;
    }
    const lostTop = Object.entries(lostRaw).sort((a, b) => b[1] - a[1])[0] || null;
    const topLostReason = lostTop && lostTop[1] >= 2
        ? { label: lostTop[0], count: lostTop[1], share: lostTop[1] / Math.max(1, lostLeads.length) }
        : null;

    const missingValueWon = wonLeads.filter((l) => positive(l.dealValue) == null).length;

    // Pipeline pondéré : somme des valeurs attendues lead par lead, avec la MÊME
    // estimation que la fiche prospect (prix unitaire inclus) — sinon l'accueil
    // et la fiche annonceraient deux montants différents pour le même deal.
    const partialEcon = {
        byStage,
        conversionRate,
        medianDeal,
        unitRates,
        wonColumnId: wonId,
        lostColumnId: lostId,
    };
    let weightedPipeline = null;
    if (medianDeal != null) {
        weightedPipeline = activeLeads.reduce((s, l) => {
            const est = estimateLeadValue(l, partialEcon, workspace);
            return est?.expected != null ? s + est.expected : s;
        }, 0);
    }

    // Confiance : nombre de deals chiffrés, saturée à MIN_DEALS_TRUSTED
    const confidence = Math.max(
        0,
        Math.min(1, wonValues.length / MIN_DEALS_TRUSTED)
    );

    return {
        available: enoughDeals || closedLeads.length >= MIN_STAGE_CLOSED,
        confidence,
        totalLeads: leads.length,
        wonCount: wonLeads.length,
        lostCount: lostLeads.length,
        closedCount: closedLeads.length,
        activeCount: activeLeads.length,
        valuedWonCount: wonValues.length,
        missingValueWon,
        revenue,
        avgDeal,
        medianDeal,
        minDeal: wonValues.length ? Math.min(...wonValues) : null,
        maxDeal: wonValues.length ? Math.max(...wonValues) : null,
        clients,
        repeatClients,
        repeatRate: clients > 0 ? repeatClients / clients : null,
        cyclesPerClient: clients > 0 ? cycles / clients : null,
        ltv,
        conversionRate,
        leadWinRate,
        valuePerLead: revenue > 0 && leads.length >= 8 ? revenue / leads.length : null,
        callCount,
        valuePerCall,
        callsPerWon,
        pipelineValue,
        weightedPipeline,
        medianDaysToWin: daysToWin.length >= 3 ? median(daysToWin) : null,
        byStage,
        segments,
        unitRates,
        topLostReason,
        wonColumnId: wonId,
        lostColumnId: lostId,
    };
}

/**
 * Agrégat multi-workspaces pour les KPI d'accueil.
 * Les taux sont recalculés sur les totaux (pas une moyenne de moyennes).
 * @param {object[]} workspaces
 */
export function computeGlobalEconomics(workspaces = []) {
    const list = (workspaces || []).filter(Boolean);
    if (!list.length) return { ...EMPTY_ECONOMICS, perWorkspace: [] };

    const perWorkspace = list.map((ws) => ({
        id: ws.id,
        name: ws.name,
        econ: computeWorkspaceEconomics(ws),
    }));

    let revenue = 0;
    let clients = 0;
    let repeatClients = 0;
    let totalLeads = 0;
    let wonCount = 0;
    let lostCount = 0;
    let closedCount = 0;
    let callCount = 0;
    let valuedWonCount = 0;
    let missingValueWon = 0;
    let pipelineValue = 0;
    let weightedPipeline = 0;
    let weightedKnown = false;
    const allDeals = [];

    for (const { econ, ...meta } of perWorkspace) {
        revenue += econ.revenue;
        clients += econ.clients;
        repeatClients += econ.repeatClients;
        totalLeads += econ.totalLeads;
        wonCount += econ.wonCount;
        lostCount += econ.lostCount;
        closedCount += econ.closedCount;
        callCount += econ.callCount;
        valuedWonCount += econ.valuedWonCount;
        missingValueWon += econ.missingValueWon;
        pipelineValue += econ.pipelineValue;
        if (econ.weightedPipeline != null) {
            weightedPipeline += econ.weightedPipeline;
            weightedKnown = true;
        }
        if (econ.medianDeal != null) allDeals.push({ value: econ.medianDeal, n: econ.valuedWonCount, ...meta });
    }

    const enoughDeals = valuedWonCount >= MIN_DEALS_FOR_BASE;
    const ltv = clients > 0 && revenue > 0 ? revenue / clients : null;

    return {
        ...EMPTY_ECONOMICS,
        available: enoughDeals || closedCount >= MIN_STAGE_CLOSED,
        confidence: Math.min(1, valuedWonCount / MIN_DEALS_TRUSTED),
        totalLeads,
        wonCount,
        lostCount,
        closedCount,
        valuedWonCount,
        missingValueWon,
        revenue,
        avgDeal: enoughDeals && clients > 0 ? revenue / Math.max(1, valuedWonCount) : null,
        medianDeal: enoughDeals ? median(allDeals.map((d) => d.value)) : null,
        clients,
        repeatClients,
        repeatRate: clients > 0 ? repeatClients / clients : null,
        ltv,
        conversionRate: closedCount >= MIN_STAGE_CLOSED ? wonCount / closedCount : null,
        leadWinRate: totalLeads >= 8 ? wonCount / totalLeads : null,
        valuePerLead: revenue > 0 && totalLeads >= 8 ? revenue / totalLeads : null,
        callCount,
        valuePerCall: callCount >= 10 && revenue > 0 ? revenue / callCount : null,
        callsPerWon: clients > 0 && callCount >= 5 ? callCount / clients : null,
        pipelineValue,
        weightedPipeline: weightedKnown ? weightedPipeline : null,
        perWorkspace,
    };
}

/**
 * Valeur attendue d'un prospect précis — la personnalisation la plus concrète.
 * Priorité : montant saisi > prix unitaire appris > panier médian.
 * @param {object} lead
 * @param {ReturnType<typeof computeWorkspaceEconomics>} econ
 * @param {object} workspace
 */
export function estimateLeadValue(lead, econ, workspace) {
    if (!lead || !econ) return null;

    const explicit = positive(lead.dealValue);
    let base = null;
    let basis = null;
    let unitDetail = null;

    if (explicit != null) {
        base = explicit;
        basis = "explicit";
    } else if (econ.unitRates?.length) {
        const entries = leadFieldEntries(lead);
        for (const rate of econ.unitRates) {
            const hit = entries.find((e) => e.label.toLowerCase() === rate.key);
            const units = hit ? positive(hit.value) : null;
            if (units == null || units < 1 || units > 5000) continue;
            base = units * rate.ratePerUnit;
            basis = "unit";
            unitDetail = {
                label: rate.label,
                units,
                ratePerUnit: rate.ratePerUnit,
                samples: rate.samples,
            };
            break;
        }
    }
    if (base == null && econ.medianDeal != null) {
        base = econ.medianDeal;
        basis = "median";
    }
    if (base == null) return null;

    const stage = econ.byStage?.[lead.columnId] || null;
    const isWon = lead.columnId === econ.wonColumnId;
    const isLost = lead.columnId === econ.lostColumnId;
    const probability = isWon ? 1 : isLost ? 0 : (stage?.winRate ?? econ.conversionRate ?? null);

    return {
        base,
        basis,
        unitDetail,
        probability,
        probabilitySource: isWon || isLost
            ? "closed"
            : stage?.winRate != null
                ? "stage"
                : econ.conversionRate != null
                    ? "global"
                    : null,
        stageName: stage?.name || workspace?.columns?.[lead.columnId]?.name || "",
        stageSample: stage?.closedSample ?? null,
        expected: probability != null ? probability * base : null,
        vsMedian: econ.medianDeal != null && econ.medianDeal > 0 ? base / econ.medianDeal : null,
    };
}

/**
 * Combien de temps ce prospect stagne, comparé au comportement appris du stade.
 * @returns {{ days: number, medianDays: number, ratio: number, usualNextName: string|null, usualNextId: string|null } | null}
 */
export function detectStageStall(lead, econ, now = new Date()) {
    const stage = econ?.byStage?.[lead?.columnId];
    if (!stage?.medianDwellDays || stage.dwellSample < 4) return null;
    const hist = cleanHistory(lead);
    const entered = [...hist].reverse().find((e) => e.columnId === lead.columnId)?.at
        || lead?.contactedColumnEnteredAt
        || lead?.createdAt;
    if (!entered) return null;
    const days = daysBetween(entered, now);
    if (days == null || days < 1) return null;
    const ratio = days / stage.medianDwellDays;
    if (ratio < 2 || days < 3) return null;
    return {
        days: Math.round(days),
        medianDays: Math.round(stage.medianDwellDays * 10) / 10,
        ratio,
        usualNextName: stage.usualNextName,
        usualNextId: stage.usualNextId,
    };
}

/** Tags de ce lead qui portent un signal appris (gagnant / perdant). */
export function matchLeadSegments(lead, econ) {
    if (!econ?.segments?.length) return [];
    const tags = new Set((lead?.tags || []).map((t) => String(t).trim().toLowerCase()));
    if (!tags.size) return [];
    return econ.segments.filter((s) => tags.has(String(s.label).toLowerCase()));
}

/** Montant en euros, sans décimales inutiles (FR). */
export function fmtEur(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${rounded.toLocaleString("fr-FR")} €`;
}

/** Pourcentage court (« 38 % »). */
export function fmtPct(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return `${Math.round(v * 100)} %`;
}
