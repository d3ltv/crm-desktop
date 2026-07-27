/**
 * Détection d'incohérences de prospection — purement rule-based.
 * Ne invente jamais de fait : uniquement dérivé des champs lead existants.
 * Spec alignée sur le catalogue haute confiance (critical / warning / info).
 */

import {
    isNouveauColumn,
    isContactedColumn,
    isMeetingColumn,
    isWonColumn,
    isLostColumn,
} from "@/constants/columnPatterns";
import { isManualRdv } from "@/lib/nextActionUtils";
import { toLocalDateKey } from "@/lib/dateUtils";
import { parseNote, diffWithLead, detectAppointment } from "@/lib/noteParser";

export const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/** Préfixes de notes déjà normalisés par CallNoteModal / LOG_RELANCE */
const NOTE_NO_ANSWER_RE = /^📵\s*Pas de réponse/i;
const NOTE_REACHED_RE = /^📞\s*Joint/i;
const NOTE_RELANCE_RE = /^🔁\s*Relance/i;
const NOTE_EMAIL_RE = /(?:✉️|email|e-?mail|mail)\b/i;
const PHONE_LIKE_RE = /^[+\d\s.\-()]{7,}$/;

const ANNONCE_CLOSED_RE = /ferm[ée]e?|closed|pourvu[e]?|expir[ée]e?|pourvue|archiv[ée]e?/i;

export const RULE_DEFS = [
    {
        id: "rdv_overdue",
        severity: "critical",
        title: "RDV non suivi",
        defaultEnabled: true,
        description: "Un rendez-vous est passé sans contact ni note après la date.",
    },
    {
        id: "meeting_sans_rdv",
        severity: "critical",
        title: "Colonne RDV sans date",
        defaultEnabled: true,
        description: "Le lead est en colonne rendez-vous mais aucune date RDV n’est enregistrée.",
    },
    {
        id: "won_sans_valeur",
        severity: "critical",
        title: "Gagné sans montant",
        defaultEnabled: true,
        description: "Colonne gagné sans valeur de deal.",
    },
    {
        id: "contacted_sans_trace",
        severity: "critical",
        title: "Contacté sans trace",
        defaultEnabled: true,
        description: "Colonne Contacté sans lastContact ni note d’appel / relance.",
    },
    {
        id: "rdv_no_prep",
        severity: "warning",
        title: "RDV sans contact récent",
        defaultEnabled: true,
        description: "RDV futur sans contact récent (risque de no-show).",
        thresholdKey: "rdvPrepDays",
    },
    {
        id: "rdv_detected_unplanned",
        severity: "warning",
        title: "RDV détecté non planifié",
        defaultEnabled: true,
        description: "Une note récente contient un RDV détecté non ajouté à l’agenda.",
    },
    {
        id: "no_answer_stale",
        severity: "warning",
        title: "Sans réponse non relancé",
        defaultEnabled: true,
        description: "Dernier appel « pas de réponse » sans relance depuis N jours.",
        thresholdKey: "noAnswerDays",
    },
    {
        id: "contact_gap",
        severity: "warning",
        title: "Trou de prospection",
        defaultEnabled: true,
        description: "Aucun contact depuis N jours alors que le lead est encore actif.",
        thresholdKey: "contactGapDays",
    },
    {
        id: "annonce_fermee",
        severity: "warning",
        title: "Annonce fermée",
        defaultEnabled: true,
        description: "Le statut importé de l’annonce indique fermé / pourvu / expiré.",
    },
    {
        id: "prospection_sans_tel",
        severity: "warning",
        title: "Sans téléphone",
        defaultEnabled: true,
        description: "Lead actif sans numéro sur la fiche (ni custom field téléphone).",
    },
    {
        id: "nouveau_sans_coord",
        severity: "warning",
        title: "Fiche incomplète",
        defaultEnabled: true,
        description: "Prospect en Nouveau sans téléphone ni e-mail — impossible d’appeler.",
    },
    {
        id: "perdu_avec_rdv",
        severity: "warning",
        title: "Perdu avec action à venir",
        defaultEnabled: true,
        description: "Lead en Perdu alors qu’une action / RDV futur est encore planifié.",
    },
    {
        id: "nouveau_stale",
        severity: "warning",
        title: "Nouveau jamais traité",
        defaultEnabled: true,
        description: "En Nouveau sans contact depuis N jours ouvrés.",
        thresholdKey: "nouveauStaleDays",
    },
    {
        id: "unsaved_note_contact",
        severity: "info",
        title: "Coordonnée non enregistrée",
        defaultEnabled: true,
        description: "Téléphone / email / contact détecté dans une note, pas encore sur la fiche.",
    },
    {
        id: "won_no_close_date",
        severity: "info",
        title: "Gagné sans date de signature",
        defaultEnabled: true,
        description: "Deal gagné sans dealClosedAt.",
    },
    {
        id: "nouveau_deja_contacte",
        severity: "info",
        title: "Nouveau déjà contacté",
        defaultEnabled: true,
        description: "Toujours en Nouveau alors qu’un contact ou une note d’appel existe.",
    },
];

export const DEFAULT_THRESHOLDS = {
    noAnswerDays: 2,
    contactGapDays: 21,
    rdvPrepDays: 7,
    nouveauStaleDays: 5,
};

export function defaultInconsistencyConfig() {
    const enabled = {};
    for (const r of RULE_DEFS) enabled[r.id] = r.defaultEnabled;
    return {
        enabled,
        thresholds: { ...DEFAULT_THRESHOLDS },
        showOnCard: true,
    };
}

export function normalizeInconsistencyConfig(raw) {
    const base = defaultInconsistencyConfig();
    if (!raw || typeof raw !== "object") return base;
    const enabled = { ...base.enabled };
    if (raw.enabled && typeof raw.enabled === "object") {
        for (const r of RULE_DEFS) {
            if (typeof raw.enabled[r.id] === "boolean") enabled[r.id] = raw.enabled[r.id];
        }
    }
    const thresholds = { ...base.thresholds };
    if (raw.thresholds && typeof raw.thresholds === "object") {
        for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
            const n = Number(raw.thresholds[k]);
            if (Number.isFinite(n) && n >= 1 && n <= 365) thresholds[k] = Math.round(n);
        }
    }
    return {
        enabled,
        thresholds,
        showOnCard: raw.showOnCard !== false,
    };
}

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

/** Jours ouvrés (dimanche exclus) — aligné CrmContext. */
function businessDaysSince(isoDate, now = new Date()) {
    if (!isoDate) return 0;
    const start = new Date(isoDate);
    const end = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(start.getTime()) || end <= start) return 0;
    let count = 0;
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    while (cur < endDay) {
        if (cur.getDay() !== 0) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function formatFrDate(isoOrDate) {
    if (!isoOrDate) return "";
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function columnName(lead, columns) {
    return columns?.[lead?.columnId]?.name || "";
}

function isTerminal(colName) {
    return isWonColumn(colName) || isLostColumn(colName);
}

function latestActivityAt(lead) {
    let max = 0;
    if (lead.lastContact) max = Math.max(max, new Date(lead.lastContact).getTime() || 0);
    for (const n of lead.notes || []) {
        const t = new Date(n.at).getTime();
        if (Number.isFinite(t)) max = Math.max(max, t);
    }
    for (const r of lead.relances || []) {
        const t = new Date(r.at).getTime();
        if (Number.isFinite(t)) max = Math.max(max, t);
    }
    return max > 0 ? new Date(max).toISOString() : null;
}

function findLatestMatchingNote(notes, re) {
    let best = null;
    let bestT = -1;
    for (const n of notes || []) {
        if (!n?.text || !re.test(String(n.text).trim())) continue;
        const t = new Date(n.at).getTime();
        if (!Number.isFinite(t)) continue;
        if (t >= bestT) {
            bestT = t;
            best = n;
        }
    }
    return best;
}

function hasActivityAfter(lead, afterIso) {
    if (!afterIso) return false;
    const after = new Date(afterIso).getTime();
    if (!Number.isFinite(after)) return false;
    if (lead.lastContact) {
        const t = new Date(lead.lastContact).getTime();
        if (Number.isFinite(t) && t > after + 1000) return true;
    }
    for (const n of lead.notes || []) {
        const t = new Date(n.at).getTime();
        if (Number.isFinite(t) && t > after + 1000) return true;
    }
    for (const r of lead.relances || []) {
        const t = new Date(r.at).getTime();
        if (Number.isFinite(t) && t > after + 1000) return true;
    }
    return false;
}

/** Preuve structurée d'appel / relance (préfixes CallNote / LOG_RELANCE). */
function hasStrictCallOrRelanceEvidence(lead) {
    if ((lead.relances || []).length > 0) return true;
    for (const n of lead.notes || []) {
        const t = String(n.text || "").trim();
        if (NOTE_NO_ANSWER_RE.test(t) || NOTE_REACHED_RE.test(t) || NOTE_RELANCE_RE.test(t)) return true;
    }
    return false;
}

/** Preuve large (inclut lastContact + emails envoyés). */
function hasCallOrRelanceEvidence(lead) {
    if (lead.lastContact) return true;
    if (hasStrictCallOrRelanceEvidence(lead)) return true;
    for (const n of lead.notes || []) {
        const t = String(n.text || "").trim();
        if (NOTE_EMAIL_RE.test(t) && /envoy/i.test(t)) return true;
    }
    return false;
}

/**
 * Indices « doux » (email, note libre, lastContact…) pour enrichir un message
 * sans inventer — uniquement des faits déjà présents sur le lead.
 * @returns {{ at: string, canal: string, label: string } | null}
 */
function findSoftActivityHint(lead) {
    let best = null;
    let bestT = -1;

    const consider = (at, canal) => {
        if (!at || !canal) return;
        const t = new Date(at).getTime();
        if (!Number.isFinite(t)) return;
        if (t >= bestT) {
            bestT = t;
            best = { at, canal, label: `dernier contact le ${formatFrDate(at)} par ${canal}` };
        }
    };

    if (lead.lastContact) {
        // Canal par défaut ; affiné si une note proche mentionne email / LinkedIn…
        let canal = "contact";
        for (const n of lead.notes || []) {
            if (!n.at) continue;
            const dt = Math.abs(new Date(n.at).getTime() - new Date(lead.lastContact).getTime());
            if (dt > 2 * 86400000) continue;
            const text = String(n.text || "");
            if (NOTE_EMAIL_RE.test(text) || /e-?mail|mail/i.test(text)) { canal = "email"; break; }
            if (/linkedin/i.test(text)) { canal = "LinkedIn"; break; }
            if (NOTE_REACHED_RE.test(text) || NOTE_NO_ANSWER_RE.test(text)) { canal = "téléphone"; break; }
        }
        consider(lead.lastContact, canal);
    }

    for (const r of lead.relances || []) {
        consider(r.at, r.canal || "relance");
    }

    for (const n of lead.notes || []) {
        const text = String(n.text || "").trim();
        if (!text || !n.at) continue;
        if (NOTE_REACHED_RE.test(text)) {
            consider(n.at, "téléphone");
            continue;
        }
        if (NOTE_NO_ANSWER_RE.test(text)) {
            consider(n.at, "appel (sans réponse)");
            continue;
        }
        if (NOTE_RELANCE_RE.test(text)) {
            const canalMatch = text.match(/Relance\s*#?\d*\s*·\s*([^·]+)/i);
            consider(n.at, (canalMatch?.[1] || "relance").trim());
            continue;
        }
        if (NOTE_EMAIL_RE.test(text) || /mail\s+envoy|envoyé\s+(un\s+)?mail|envoyé\s+(un\s+)?e-?mail/i.test(text)) {
            consider(n.at, "email");
            continue;
        }
        if (/linkedin|whatsapp|sms/i.test(text)) {
            const canal = /linkedin/i.test(text) ? "LinkedIn"
                : /whatsapp/i.test(text) ? "WhatsApp"
                : "SMS";
            consider(n.at, canal);
        }
    }

    return best;
}

function daysInCurrentColumn(lead, now) {
    const entered = enteredCurrentColumnAt(lead);
    if (!entered) return null;
    return calendarDaysBetween(entered, now);
}

function withFoundHint(message, hint) {
    if (!hint?.label) return message;
    return `${message}. Information trouvée : ${hint.label}`;
}

export function hasPhoneAnywhere(lead) {
    if ((lead.phone || "").trim()) return true;
    for (const cf of lead.customFields || []) {
        const v = String(cf?.value || "").trim();
        if (v && PHONE_LIKE_RE.test(v) && v.replace(/\D/g, "").length >= 7) return true;
    }
    return false;
}

export function hasEmailAnywhere(lead) {
    if ((lead.email || "").trim()) return true;
    for (const cf of lead.customFields || []) {
        const v = String(cf?.value || "").trim();
        if (v.includes("@") && v.includes(".")) return true;
    }
    return false;
}

function pickAnnonceStatut(lead) {
    const extras = lead.extra || {};
    for (const [k, v] of Object.entries(extras)) {
        if (!v) continue;
        if (/^statut$/i.test(k) || /status/i.test(k) || /[ée]tat\s*(annonce|offre)?/i.test(k)) {
            return { label: k, value: String(v).trim() };
        }
    }
    return null;
}

/** True si un champ extra statut/état indique une annonce fermée / pourvue / expirée. */
export function isClosedAdLead(lead) {
    const statut = pickAnnonceStatut(lead);
    return !!(statut && ANNONCE_CLOSED_RE.test(statut.value));
}

function enteredCurrentColumnAt(lead) {
    const hist = [...(lead.statusHistory || [])].reverse();
    const hit = hist.find((e) => e.columnId === lead.columnId);
    return hit?.at || lead.createdAt || null;
}

function nextActionDue(nextAction) {
    if (!nextAction) return null;
    const raw = nextAction.dueAt || nextAction.date;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function issue(partial) {
    return {
        dismissible: true,
        ...partial,
        fingerprint: partial.fingerprint || `${partial.id}:${partial.relatedAt || "x"}`,
    };
}

/**
 * Évalue toutes les règles actives pour un lead.
 * @returns {Array<{id, severity, title, message, facts, fingerprint, relatedAt?, dismissible, action?}>}
 */
export function detectInconsistencies(lead, columns = {}, configRaw = null, now = new Date()) {
    if (!lead || lead.archived) return [];
    const config = normalizeInconsistencyConfig(configRaw);
    const colName = columnName(lead, columns);
    const dismissed = lead.dismissedInconsistencies || {};
    const out = [];

    const push = (item) => {
        if (!config.enabled[item.id]) return;
        if (dismissed[item.fingerprint]) return;
        out.push(item);
    };

    const rdv = isManualRdv(lead.nextAction) ? lead.nextAction : null;
    const rdvDue = rdv ? nextActionDue(rdv) : null;
    const rdvIsPast = rdvDue && rdvDue.getTime() < now.getTime();
    const rdvIsFuture = rdvDue && rdvDue.getTime() > now.getTime();

    // ── 1. RDV passé sans suivi (critical) ───────────────────────────────────
    if (rdvDue && rdvIsPast) {
        const dueIso = rdvDue.toISOString();
        if (!hasActivityAfter(lead, dueIso)) {
            const days = calendarDaysBetween(dueIso, now);
            push(issue({
                id: "rdv_overdue",
                severity: "critical",
                title: "RDV non suivi",
                message: isMeetingColumn(colName)
                    ? `RDV du ${formatFrDate(rdvDue)} passé — toujours en « ${colName} »`
                    : days <= 0
                        ? `RDV prévu le ${formatFrDate(rdvDue)} — aucun contact depuis`
                        : `RDV prévu le ${formatFrDate(rdvDue)} — aucun contact depuis ${days} j`,
                relatedAt: dueIso,
                facts: { dueAt: dueIso, daysSince: days, column: colName },
                fingerprint: `rdv_overdue:${toLocalDateKey(rdvDue)}`,
                dismissible: false,
            }));
        }
    }

    // ── 2. Colonne RDV sans date (critical) ──────────────────────────────────
    if (isMeetingColumn(colName) && !rdv && !isTerminal(colName)) {
        const days = daysInCurrentColumn(lead, now);
        push(issue({
            id: "meeting_sans_rdv",
            severity: "critical",
            title: "Colonne RDV sans date",
            message: days != null && days > 0
                ? `En « ${colName} » depuis ${days} j — sans date de rendez-vous planifiée`
                : `En « ${colName} » sans date de rendez-vous planifiée`,
            relatedAt: enteredCurrentColumnAt(lead) || lead.createdAt || null,
            facts: { column: colName, daysInColumn: days },
            fingerprint: `meeting_sans_rdv:${lead.columnId}`,
            dismissible: false,
        }));
    }

    // ── 3. Gagné sans montant (critical) ─────────────────────────────────────
    if (isWonColumn(colName) && (lead.dealValue == null || lead.dealValue === "" || lead.dealValue === 0)) {
        push(issue({
            id: "won_sans_valeur",
            severity: "critical",
            title: "Gagné sans montant",
            message: "Deal gagné — montant non renseigné",
            relatedAt: lead.dealClosedAt || null,
            facts: {},
            fingerprint: "won_sans_valeur",
            dismissible: false,
        }));
    }

    // ── 4. Contacté sans trace d'appel/relance (critical) ────────────────────
    if (isContactedColumn(colName) && !isTerminal(colName) && !hasStrictCallOrRelanceEvidence(lead)) {
        const days = daysInCurrentColumn(lead, now);
        const hint = findSoftActivityHint(lead);
        const base = days != null && days > 0
            ? `En « ${colName} » depuis ${days} j — aucun appel ni relance enregistré`
            : `En « ${colName} » — aucun appel ni relance enregistré`;
        push(issue({
            id: "contacted_sans_trace",
            severity: "critical",
            title: "Contacté sans trace",
            message: withFoundHint(base, hint),
            relatedAt: lead.contactedColumnEnteredAt || enteredCurrentColumnAt(lead) || null,
            facts: {
                column: colName,
                daysInColumn: days,
                foundAt: hint?.at || null,
                foundCanal: hint?.canal || null,
            },
            fingerprint: `contacted_sans_trace:${lead.columnId}`,
            dismissible: false,
        }));
    }

    // ── 5. RDV futur sans contact récent (warning) ───────────────────────────
    if (rdvDue && rdvIsFuture && !isTerminal(colName)) {
        const prep = config.thresholds.rdvPrepDays;
        const last = lead.lastContact;
        const days = last ? businessDaysSince(last, now) : null;
        if (!last || days >= prep) {
            push(issue({
                id: "rdv_no_prep",
                severity: "warning",
                title: "RDV sans contact récent",
                message: last
                    ? `RDV prévu le ${formatFrDate(rdvDue)} — aucun contact depuis ${days} j ouvrés`
                    : `RDV prévu le ${formatFrDate(rdvDue)} — aucun contact enregistré avant`,
                relatedAt: rdvDue.toISOString(),
                facts: { dueAt: rdvDue.toISOString(), daysSince: days, threshold: prep },
                fingerprint: `rdv_no_prep:${toLocalDateKey(rdvDue)}`,
            }));
        }
    }

    // ── 6. RDV détecté dans note, non planifié (warning) ─────────────────────
    // Ne pas alerter s'il existe déjà un créneau (RDV ou rappel) le même jour.
    if (!isTerminal(colName)) {
        const latest = (lead.notes || [])[0];
        if (latest?.text) {
            const appt = detectAppointment(latest.text, now);
            if (appt?.iso) {
                const scheduledDue = nextActionDue(lead.nextAction);
                const sameDayPlanned = scheduledDue
                    && toLocalDateKey(scheduledDue) === toLocalDateKey(appt.iso);
                const alreadyRdv = !!rdv;
                if (!sameDayPlanned && !alreadyRdv) {
                    push(issue({
                        id: "rdv_detected_unplanned",
                        severity: "warning",
                        title: "RDV détecté non planifié",
                        message: `RDV détecté dans une note (${appt.label}) — non ajouté à l’agenda`,
                        relatedAt: latest.at || null,
                        facts: {
                            apptLabel: appt.label,
                            apptIso: appt.iso,
                            hasTime: !!appt.hasTime,
                        },
                        fingerprint: `rdv_detected_unplanned:${appt.iso}:${toLocalDateKey(latest.at) || "x"}`,
                        action: { type: "plan_rdv", dueAt: appt.iso, label: appt.label },
                    }));
                }
            }
        }
    }

    // ── 7. Pas de réponse non relancé ────────────────────────────────────────
    if (!isTerminal(colName)) {
        const noAnswer = findLatestMatchingNote(lead.notes, NOTE_NO_ANSWER_RE);
        if (noAnswer?.at) {
            const days = calendarDaysBetween(noAnswer.at, now);
            const threshold = config.thresholds.noAnswerDays;
            if (days >= threshold && !hasActivityAfter(lead, noAnswer.at)) {
                push(issue({
                    id: "no_answer_stale",
                    severity: "warning",
                    title: "Sans réponse non relancé",
                    message: `Pas de réponse le ${formatFrDate(noAnswer.at)} — aucune relance depuis ${days} j`,
                    relatedAt: noAnswer.at,
                    facts: { noteAt: noAnswer.at, daysSince: days, threshold },
                    fingerprint: `no_answer_stale:${toLocalDateKey(noAnswer.at)}`,
                }));
            }
        }
    }

    // ── 8. Trou de prospection ───────────────────────────────────────────────
    if (!isTerminal(colName) && !isNouveauColumn(colName)) {
        const last = lead.lastContact || latestActivityAt(lead);
        if (last) {
            const days = calendarDaysBetween(last, now);
            const threshold = config.thresholds.contactGapDays;
            if (days >= threshold && !rdvIsPast) {
                push(issue({
                    id: "contact_gap",
                    severity: "warning",
                    title: "Trou de prospection",
                    message: `Dernier contact le ${formatFrDate(last)} — il y a ${days} j`,
                    relatedAt: last,
                    facts: { lastContact: last, daysSince: days, threshold },
                    fingerprint: `contact_gap:${toLocalDateKey(last)}`,
                }));
            }
        }
    }

    // ── 9. Annonce fermée ────────────────────────────────────────────────────
    if (!isTerminal(colName)) {
        const statut = pickAnnonceStatut(lead);
        if (statut && ANNONCE_CLOSED_RE.test(statut.value)) {
            push(issue({
                id: "annonce_fermee",
                severity: "warning",
                title: "Annonce fermée",
                message: `${statut.label} : ${statut.value}`,
                relatedAt: null,
                facts: { label: statut.label, value: statut.value },
                fingerprint: `annonce_fermee:${statut.label}:${statut.value.toLowerCase()}`,
            }));
        }
    }

    // ── 10. Sans téléphone / coordonnées ─────────────────────────────────────
    if (
        isNouveauColumn(colName)
        && !isTerminal(colName)
        && !hasPhoneAnywhere(lead)
        && !hasEmailAnywhere(lead)
    ) {
        const entered = enteredCurrentColumnAt(lead) || lead.createdAt;
        const days = calendarDaysBetween(entered, now) ?? 0;
        push(issue({
            id: "nouveau_sans_coord",
            severity: "warning",
            title: "Fiche incomplète",
            message: days <= 0
                ? "Ajoute un téléphone ou un e-mail pour pouvoir appeler"
                : days === 1
                    ? "Nouveau depuis 1 j — ajoute un tél. ou e-mail"
                    : `Nouveau depuis ${days} j — ajoute un tél. ou e-mail`,
            relatedAt: entered || null,
            facts: { daysSince: days, column: colName },
            fingerprint: `nouveau_sans_coord:${lead.columnId}`,
        }));
    } else if (
        !isTerminal(colName)
        && !isNouveauColumn(colName)
        && !hasPhoneAnywhere(lead)
        && !hasEmailAnywhere(lead)
    ) {
        push(issue({
            id: "prospection_sans_tel",
            severity: "warning",
            title: "Sans coordonnée",
            message: "Aucun téléphone ni email enregistré",
            relatedAt: null,
            facts: { column: colName },
            fingerprint: `prospection_sans_tel:${lead.columnId}`,
        }));
    } else if (
        (isContactedColumn(colName) || isMeetingColumn(colName))
        && !isTerminal(colName)
        && !hasPhoneAnywhere(lead)
    ) {
        push(issue({
            id: "prospection_sans_tel",
            severity: "warning",
            title: "Sans téléphone",
            message: "En prospection sans numéro sur la fiche",
            relatedAt: null,
            facts: { column: colName },
            fingerprint: `prospection_sans_tel:${lead.columnId}`,
        }));
    }

    // ── 11. Perdu avec action / RDV futur ────────────────────────────────────
    if (isLostColumn(colName)) {
        const due = nextActionDue(lead.nextAction);
        if (due && due.getTime() > now.getTime()) {
            push(issue({
                id: "perdu_avec_rdv",
                severity: "warning",
                title: "Perdu avec action à venir",
                message: `Lead perdu mais action programmée le ${formatFrDate(due)}`,
                relatedAt: due.toISOString(),
                facts: { dueAt: due.toISOString(), column: colName },
                fingerprint: `perdu_avec_rdv:${toLocalDateKey(due)}`,
            }));
        }
    }

    // ── 12. Nouveau jamais traité ────────────────────────────────────────────
    if (isNouveauColumn(colName) && !hasCallOrRelanceEvidence(lead)) {
        const entered = enteredCurrentColumnAt(lead);
        const days = businessDaysSince(entered, now);
        const threshold = config.thresholds.nouveauStaleDays;
        if (entered && days >= threshold) {
            push(issue({
                id: "nouveau_stale",
                severity: "warning",
                title: "Nouveau jamais traité",
                message: `Jamais contacté depuis ${days} jours ouvrés`,
                relatedAt: entered,
                facts: { daysSince: days, threshold },
                fingerprint: `nouveau_stale:${toLocalDateKey(entered)}`,
            }));
        }
    }

    // ── 13. Coordonnées détectées dans notes (info) ──────────────────────────
    {
        const allNotes = (lead.notes || [])
            .map((n) => String(n?.transcript || "").trim() || String(n?.text || "").trim())
            .filter(Boolean)
            .join("\n");
        if (allNotes.trim()) {
            const diff = diffWithLead(parseNote(allNotes), lead);
            const candidates = [
                diff.newPhone && { kind: "phone", label: "Téléphone", value: diff.newPhone, applyKey: "phone" },
                diff.newEmail && { kind: "email", label: "Email", value: diff.newEmail, applyKey: "email" },
                diff.newContact && { kind: "contact", label: "Contact", value: diff.newContact, applyKey: "contact" },
            ].filter(Boolean);
            for (const c of candidates) {
                push(issue({
                    id: "unsaved_note_contact",
                    severity: "info",
                    title: "Coordonnée non enregistrée",
                    message: `${c.label} détecté dans une note : ${c.value}`,
                    relatedAt: (lead.notes || [])[0]?.at || null,
                    facts: { kind: c.kind, value: c.value, applyKey: c.applyKey },
                    fingerprint: `unsaved_note_contact:${c.kind}:${c.value}`,
                    action: { type: "apply_field", applyKey: c.applyKey, value: c.value },
                }));
            }
        }
    }

    // ── 14. Gagné sans date de signature ─────────────────────────────────────
    if (isWonColumn(colName) && !lead.dealClosedAt) {
        push(issue({
            id: "won_no_close_date",
            severity: "info",
            title: "Gagné sans date de signature",
            message: "Deal gagné — date de signature manquante",
            relatedAt: null,
            facts: {},
            fingerprint: "won_no_close_date",
        }));
    }

    // ── 15. Nouveau déjà contacté ────────────────────────────────────────────
    if (isNouveauColumn(colName) && hasCallOrRelanceEvidence(lead)) {
        const at = lead.lastContact || latestActivityAt(lead) || lead.createdAt;
        push(issue({
            id: "nouveau_deja_contacte",
            severity: "info",
            title: "Nouveau déjà contacté",
            message: "Toujours en Nouveau alors qu’un contact a déjà été enregistré",
            relatedAt: at,
            facts: { lastContact: lead.lastContact || null },
            fingerprint: `nouveau_deja_contacte:${toLocalDateKey(at) || "x"}`,
        }));
    }

    // ── Subsumption ──────────────────────────────────────────────────────────
    const ids = new Set(out.map((i) => i.id));
    let filtered = out;
    if (ids.has("rdv_overdue")) {
        filtered = filtered.filter((i) => i.id !== "meeting_sans_rdv" && i.id !== "rdv_no_prep");
    }
    if (filtered.some((i) => i.id === "unsaved_note_contact" && (i.facts?.kind === "phone" || i.facts?.kind === "email"))) {
        // une coordonnée existe dans les notes → on garde prospection_sans_tel seulement si vraiment aucune fiche
        // (déjà couvert) — rien à supprimer de plus ici
    }

    filtered.sort((a, b) => {
        const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (sr !== 0) return sr;
        const ai = RULE_DEFS.findIndex((r) => r.id === a.id);
        const bi = RULE_DEFS.findIndex((r) => r.id === b.id);
        if (ai !== bi) return ai - bi;
        return (b.relatedAt || "").localeCompare(a.relatedAt || "");
    });
    return filtered;
}

/** Top signal carte : uniquement les critiques (pas de badge orange/warning). */
export function topCardInconsistency(lead, columns, configRaw, now = new Date()) {
    const config = normalizeInconsistencyConfig(configRaw);
    if (!config.showOnCard) return null;
    const all = detectInconsistencies(lead, columns, config, now);
    return all.find((i) => i.severity === "critical") || null;
}

export function countCriticalInconsistencies(issues) {
    return (issues || []).filter((i) => i.severity === "critical").length;
}

export function countActionableInconsistencies(issues) {
    return (issues || []).filter((i) => i.severity === "critical" || i.severity === "warning").length;
}

/**
 * Résumé de vigilance d’un lead (recalculé à chaque lecture — pure / proactif).
 * @returns {{
 *   level: 'critical'|'warning'|'info'|null,
 *   issues: Array,
 *   criticalCount: number,
 *   warningCount: number,
 *   actionableCount: number,
 *   score: number,
 * }}
 */
export function getLeadVigilance(lead, columns = {}, configRaw = null, now = new Date()) {
    const issues = detectInconsistencies(lead, columns, configRaw, now);
    let criticalCount = 0;
    let warningCount = 0;
    for (const i of issues) {
        if (i.severity === "critical") criticalCount++;
        else if (i.severity === "warning") warningCount++;
    }
    const level = criticalCount > 0
        ? "critical"
        : warningCount > 0
            ? "warning"
            : issues.length > 0
                ? "info"
                : null;
    return {
        level,
        issues,
        criticalCount,
        warningCount,
        actionableCount: criticalCount + warningCount,
        // Score de tri : critiques d’abord, puis warnings, puis infos
        score: criticalCount * 100 + warningCount * 10 + (issues.length - criticalCount - warningCount),
    };
}

/** Mots-clés de filtre pour la vigilance (retourne null si le terme n’est pas un filtre vigilance). */
export function matchVigilanceFilterTerm(term, lead, columns = {}, configRaw = null) {
    const t = String(term || "").toLowerCase().trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    if (!t) return null;

    const isRed = (
        t === "vigilance rouge"
        || t === "alerte rouge"
        || t === "critique"
        || t === "critiques"
        || t === "vigilance:rouge"
        || t === "vigilance=rouge"
    );
    const isAny = (
        t === "vigilance"
        || t === "a surveiller"
        || t === "surveiller"
        || t === "incoherence"
        || t === "incoherences"
        || t === "alerte"
        || t === "alertes"
    );
    if (!isRed && !isAny) return null;

    const vig = getLeadVigilance(lead, columns, configRaw);
    if (isRed) return vig.level === "critical";
    return vig.actionableCount > 0;
}
