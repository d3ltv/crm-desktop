/**
 * structureLearning.js — Apprentissage de la structure que l'utilisateur crée.
 *
 * Relia ne connaît pas d'avance les champs ni les colonnes de l'utilisateur.
 * Cet organe observe ce qu'il fabrique réellement — un champ « Effectif »,
 * une colonne « Devis envoyé » — et en déduit des recommandations qui n'existaient
 * pas au moment du code :
 *
 *  - champs habituels : ce que tu remplis d'ordinaire et qui manque ici
 *  - champs gagnants : ceux surreprésentés chez les deals gagnés
 *  - colonnes custom : conversion réelle, sortie habituelle, cul-de-sac
 *
 * Les seuils sont volontairement bas mais jamais 1 : un seul cas n'est pas une habitude.
 */

import { isMainFieldDuplicateLabel } from "@/lib/customFields";
import { resolvePipelineColumnId, normalizePipelineRoles } from "@/lib/pipelineRoles";
import {
    isNouveauColumn,
    isContactedColumn,
    isRappelColumn,
    isMeetingColumn,
    isPropositionColumn,
    isWonColumn,
    isLostColumn,
} from "@/constants/columnPatterns";

/** Occurrences minimum pour parler d'« habitude » de saisie. */
const MIN_FIELD_LEADS = 3;
/** Part minimum du pipeline portant le champ pour le considérer habituel. */
const MIN_FIELD_SHARE = 0.2;
/** Leads closés minimum pour publier un lift de champ. */
const MIN_FIELD_CLOSED = 4;
/** Lift à partir duquel un champ est dit « gagnant ». */
const FIELD_WIN_LIFT = 1.3;
/** Colonne récente : première utilisation observée il y a moins de N jours. */
const RECENT_COLUMN_DAYS = 21;
/** Leads bloqués minimum pour signaler un cul-de-sac. */
const DEAD_END_MIN_LEADS = 3;
/** Ancienneté médiane minimum (jours) dans la colonne pour parler de blocage. */
const DEAD_END_MIN_DAYS = 7;

const DAY_MS = 86_400_000;

/** Libellés techniques / dupliqués : jamais des habitudes métier. */
const IGNORED_LABEL_RE = /^(?:id|uid|index|ligne|row|source|import|fichier)$/i;

function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function daysSince(iso, now) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return (now.getTime() - t) / DAY_MS;
}

function hasValue(v) {
    return String(v ?? "").trim().length > 0;
}

/** Libellés de champs d'un lead → { key, label, filled }. */
function leadFieldLabels(lead) {
    /** @type {Map<string, { label: string, filled: boolean }>} */
    const map = new Map();
    const add = (rawLabel, value) => {
        const label = String(rawLabel || "").trim();
        if (!label) return;
        if (IGNORED_LABEL_RE.test(label)) return;
        if (isMainFieldDuplicateLabel(label)) return;
        const key = label.toLowerCase();
        const prev = map.get(key);
        map.set(key, {
            label: prev?.label || label,
            filled: !!prev?.filled || hasValue(value),
        });
    };
    for (const f of lead?.customFields || []) add(f?.label, f?.value);
    for (const [k, v] of Object.entries(lead?.extra || {})) add(k, v);
    return map;
}

const EMPTY_FIELD_INTEL = {
    available: false,
    totalLeads: 0,
    labels: [],
    usual: [],
    winning: [],
};

/**
 * Ce que l'utilisateur saisit d'habitude, et ce qui corrèle avec les gagnés.
 * @param {object} workspace
 * @param {{ learnedLabels?: { key: string, label: string, n: number }[] }} [opts]
 *   learnedLabels — champs créés à la main (usageMemory) : gardent l'habitude même
 *   si le champ a été supprimé depuis, ou s'il n'existe encore que sur 1 prospect.
 */
export function computeFieldIntel(workspace, { learnedLabels = [] } = {}) {
    const leads = Object.values(workspace?.leads || {});
    if (leads.length < MIN_FIELD_LEADS) return { ...EMPTY_FIELD_INTEL, totalLeads: leads.length };

    const wonId = resolvePipelineColumnId(workspace, "won");
    const lostId = resolvePipelineColumnId(workspace, "lost");

    /** @type {Record<string, { label: string, leads: number, filled: number, closed: number, won: number }>} */
    const raw = {};
    let closedTotal = 0;
    let wonTotal = 0;

    for (const lead of leads) {
        const isWon = !!wonId && lead.columnId === wonId;
        const isClosed = isWon || (!!lostId && lead.columnId === lostId);
        if (isClosed) closedTotal += 1;
        if (isWon) wonTotal += 1;

        for (const [key, info] of leadFieldLabels(lead)) {
            if (!raw[key]) raw[key] = { label: info.label, leads: 0, filled: 0, closed: 0, won: 0 };
            const s = raw[key];
            s.leads += 1;
            if (info.filled) s.filled += 1;
            // Le lift se mesure sur les champs réellement renseignés
            if (isClosed && info.filled) {
                s.closed += 1;
                if (isWon) s.won += 1;
            }
        }
    }

    const globalWinRate = closedTotal >= MIN_FIELD_CLOSED ? wonTotal / closedTotal : null;
    const usualThreshold = Math.max(MIN_FIELD_LEADS, Math.ceil(leads.length * MIN_FIELD_SHARE));

    const createdByHand = new Map(
        (learnedLabels || [])
            .filter((l) => l?.key && (l.n || 0) >= MIN_FIELD_LEADS)
            .map((l) => [l.key, l])
    );

    const labels = Object.entries(raw).map(([key, s]) => {
        const winRate = s.closed >= MIN_FIELD_CLOSED ? s.won / s.closed : null;
        const lift = winRate != null && globalWinRate ? winRate / globalWinRate : null;
        const handCount = createdByHand.get(key)?.n || 0;
        return {
            key,
            label: s.label,
            leadCount: s.leads,
            filledCount: s.filled,
            handCount,
            fillRate: s.leads > 0 ? s.filled / s.leads : 0,
            closedSample: s.closed,
            wonSample: s.won,
            winRate,
            lift,
            isUsual: s.filled >= usualThreshold || handCount >= MIN_FIELD_LEADS,
            isWinning: lift != null && lift >= FIELD_WIN_LIFT && s.won >= 2,
        };
    });

    // Champs créés à la main puis supprimés partout : l'habitude compte quand même
    for (const [key, l] of createdByHand) {
        if (raw[key]) continue;
        labels.push({
            key,
            label: l.label,
            leadCount: 0,
            filledCount: 0,
            handCount: l.n,
            fillRate: 0,
            closedSample: 0,
            wonSample: 0,
            winRate: null,
            lift: null,
            isUsual: true,
            isWinning: false,
        });
    }

    labels.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0) || b.filledCount - a.filledCount);

    return {
        available: labels.some((l) => l.isUsual),
        totalLeads: leads.length,
        globalWinRate,
        labels,
        usual: labels.filter((l) => l.isUsual),
        winning: labels.filter((l) => l.isWinning),
    };
}

/**
 * Champs habituels absents (ou vides) sur ce prospect — donc actionnables.
 * @param {object} lead
 * @param {ReturnType<typeof computeFieldIntel>} intel
 * @param {{ limit?: number }} [opts]
 */
export function missingUsualFields(lead, intel, { limit = 2 } = {}) {
    if (!lead || !intel?.usual?.length) return [];
    const present = leadFieldLabels(lead);
    const out = [];
    for (const f of intel.usual) {
        const hit = present.get(f.key);
        if (hit?.filled) continue;
        out.push({
            key: f.key,
            label: f.label,
            existsEmpty: !!hit,
            filledCount: f.filledCount,
            handCount: f.handCount || 0,
            totalLeads: intel.totalLeads,
            lift: f.lift,
            isWinning: f.isWinning,
        });
        if (out.length >= limit) break;
    }
    // Les champs qui corrèlent aux gagnés passent devant
    return out.sort(
        (a, b) => Number(b.isWinning) - Number(a.isWinning)
            || (b.filledCount || b.handCount) - (a.filledCount || a.handCount)
    );
}

/** Une colonne dont le nom ne correspond à aucune sémantique connue. */
function isSemanticColumn(name) {
    return (
        isNouveauColumn(name)
        || isContactedColumn(name)
        || isRappelColumn(name)
        || isMeetingColumn(name)
        || isPropositionColumn(name)
        || isWonColumn(name)
        || isLostColumn(name)
    );
}

const EMPTY_COLUMN_INTEL = { available: false, columns: [], custom: [], advice: [] };

/**
 * Colonnes réelles du workspace : ce qui s'y passe vraiment.
 * Se met à jour tout seul dès qu'une colonne est créée — aucune liste en dur.
 * @param {object} workspace
 * @param {object} econ — sortie de computeWorkspaceEconomics (byStage)
 * @param {{ now?: Date, columnCreatedAt?: Record<string, string> }} [opts]
 *   columnCreatedAt — dates réelles de création (usageMemory) : permet de repérer
 *   une colonne neuve même quand aucun lead n'y est encore passé.
 */
export function computeColumnIntel(workspace, econ, { now = new Date(), columnCreatedAt = {} } = {}) {
    const order = workspace?.columnOrder || [];
    if (!order.length) return { ...EMPTY_COLUMN_INTEL };

    const leads = Object.values(workspace?.leads || {});
    const wonId = resolvePipelineColumnId(workspace, "won");
    const lostId = resolvePipelineColumnId(workspace, "lost");
    const roles = normalizePipelineRoles(workspace?.pipelineRoles);
    const assignedIds = new Set(Object.values(roles).filter(Boolean));

    /** @type {Record<string, { count: number, ages: number[], firstSeen: number|null }>} */
    const raw = {};
    for (const cid of order) raw[cid] = { count: 0, ages: [], firstSeen: null };

    for (const lead of leads) {
        for (const e of lead.statusHistory || []) {
            const slot = raw[e?.columnId];
            if (!slot || !e?.at) continue;
            const t = new Date(e.at).getTime();
            if (!Number.isFinite(t)) continue;
            if (slot.firstSeen == null || t < slot.firstSeen) slot.firstSeen = t;
        }
        const slot = raw[lead.columnId];
        if (!slot) continue;
        slot.count += 1;
        const entered = [...(lead.statusHistory || [])]
            .reverse()
            .find((e) => e?.columnId === lead.columnId && e?.at)?.at
            || lead.contactedColumnEnteredAt
            || lead.createdAt;
        const age = entered ? daysSince(entered, now) : null;
        if (age != null && age >= 0) slot.ages.push(age);
    }

    const columns = order.map((cid) => {
        const col = workspace.columns?.[cid];
        const s = raw[cid] || { count: 0, ages: [], firstSeen: null };
        const stage = econ?.byStage?.[cid] || null;
        const name = col?.name || "";
        const seenDays = s.firstSeen != null ? daysSince(new Date(s.firstSeen).toISOString(), now) : null;
        const createdDays = columnCreatedAt?.[cid] ? daysSince(columnCreatedAt[cid], now) : null;
        const firstSeenDays = createdDays != null
            ? (seenDays != null ? Math.min(createdDays, seenDays) : createdDays)
            : seenDays;
        const medianAge = median(s.ages);
        const isTerminal = cid === wonId || cid === lostId;
        return {
            id: cid,
            name,
            count: s.count,
            medianAgeDays: medianAge,
            firstSeenDays,
            isTerminal,
            isSemantic: isSemanticColumn(name),
            hasRole: assignedIds.has(cid),
            winRate: stage?.winRate ?? null,
            closedSample: stage?.closedSample ?? 0,
            medianDwellDays: stage?.medianDwellDays ?? null,
            dwellSample: stage?.dwellSample ?? 0,
            usualNextId: stage?.usualNextId || null,
            usualNextName: stage?.usualNextName || null,
            expectedValue: stage?.expectedValue ?? null,
        };
    });

    const custom = columns.filter((c) => !c.isTerminal && !c.isSemantic && !c.hasRole);

    const advice = [];

    // 1. Colonne fraîchement créée qui n'a encore aucune sortie observée
    for (const c of custom) {
        if (c.count < 1) continue;
        const isRecent = c.firstSeenDays != null && c.firstSeenDays <= RECENT_COLUMN_DAYS;
        if (!isRecent || c.dwellSample >= 3) continue;
        advice.push({
            id: `column_new:${c.id}`,
            kind: "column_new",
            columnId: c.id,
            label: `Nouvelle colonne « ${c.name} »`,
            detail: c.count === 1
                ? "1 prospect dedans, aucune sortie observée — Relia apprendra sa suite dès le premier déplacement."
                : `${c.count} prospects dedans, aucune sortie observée — Relia apprendra sa suite dès le premier déplacement.`,
            tone: "neutral",
        });
    }

    // 2. Cul-de-sac : ça entre, ça ne sort pas, et ça vieillit
    const alreadyFlaggedNew = new Set(advice.map((a) => a.columnId));
    for (const c of columns) {
        if (c.isTerminal) continue;
        // Une colonne qu'on vient de créer n'est pas un cul-de-sac, juste neuve
        if (alreadyFlaggedNew.has(c.id)) continue;
        if (c.count < DEAD_END_MIN_LEADS) continue;
        if (c.dwellSample >= 3) continue;
        if (c.medianAgeDays == null || c.medianAgeDays < DEAD_END_MIN_DAYS) continue;
        advice.push({
            id: `column_dead_end:${c.id}`,
            kind: "column_dead_end",
            columnId: c.id,
            label: `« ${c.name} » ne se vide jamais`,
            detail: `${c.count} prospects y attendent depuis ${Math.round(c.medianAgeDays)} j en médiane, aucun n'en est ressorti.`,
            tone: "warn",
        });
    }

    // 3. Colonne qui convertit nettement mieux que la moyenne du pipeline
    const rated = columns.filter((c) => !c.isTerminal && c.winRate != null && c.closedSample >= 5);
    if (rated.length >= 2 && econ?.conversionRate) {
        const best = [...rated].sort((a, b) => b.winRate - a.winRate)[0];
        if (best.winRate >= econ.conversionRate * 1.4) {
            advice.push({
                id: `column_lever:${best.id}`,
                kind: "column_lever",
                columnId: best.id,
                label: `« ${best.name} » est ton levier`,
                detail: `${Math.round(best.winRate * 100)} % des prospects passés par là finissent gagnés (vs ${Math.round(econ.conversionRate * 100)} % en moyenne, sur ${best.closedSample} closés).`,
                tone: "ok",
            });
        }
    }

    return {
        available: columns.some((c) => c.closedSample >= 4 || c.dwellSample >= 3),
        columns,
        custom,
        advice,
    };
}
