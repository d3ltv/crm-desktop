/**
 * Ordre, visibilité & collapse des sections de la fiche lead (par workspace).
 * Zone A (brief « Information pertinente ») est fixe — hors de cette liste.
 * « calendar » est une section déplaçable comme les autres.
 */

import { parseNote, detectPersonNames, detectAppointment } from "@/lib/noteParser";
import { rankContactNames } from "@/lib/contactRank";
import { isManualRdv, isCalendarReminder } from "@/lib/nextActionUtils";
import { toLocalDateKey } from "@/lib/dateUtils";
import { isMeetingColumn } from "@/constants/columnPatterns";

export const PANEL_SECTION_IDS = [
    "imported",
    "calendar",
    "voice",
    "contact",
    "notes",
    "relances",
    "tags",
    "deal",
    "history",
];

export const PANEL_SECTION_META = {
    imported: { label: "Données importées", icon: "Database" },
    calendar: { label: "Calendrier", icon: "CalendarClock" },
    voice:    { label: "Appel", icon: "Mic" },
    contact:  { label: "Contact & coordonnées", icon: "User" },
    notes:    { label: "Notes", icon: "MessageSquare" },
    relances: { label: "Relances", icon: "Repeat2" },
    tags:     { label: "Tags", icon: "Tag" },
    deal:     { label: "Valeur / Deal", icon: "Trophy" },
    history:  { label: "Historique de statut", icon: "History" },
};

/** Défaut : calendrier puis vocal juste sous l'import, avant le contact. */
export const DEFAULT_PANEL_SECTIONS = {
    order: ["imported", "calendar", "voice", "contact", "notes", "relances", "tags", "deal", "history"],
    hidden: [],
    collapsed: ["imported"],
};

export function normalizePanelSections(raw) {
    const base = DEFAULT_PANEL_SECTIONS;
    if (!raw || typeof raw !== "object") {
        return { order: [...base.order], hidden: [], collapsed: [...base.collapsed] };
    }

    const orderIn = Array.isArray(raw.order) ? raw.order.filter((id) => PANEL_SECTION_IDS.includes(id)) : [];
    const hiddenIn = Array.isArray(raw.hidden) ? raw.hidden.filter((id) => PANEL_SECTION_IDS.includes(id)) : [];
    const collapsedIn = Array.isArray(raw.collapsed)
        ? raw.collapsed.filter((id) => PANEL_SECTION_IDS.includes(id))
        : [...base.collapsed];

    const order = [...orderIn];
    for (const id of PANEL_SECTION_IDS) {
        if (order.includes(id)) continue;
        // Nouveaux workspaces / migration : vocal près du haut (sous calendrier)
        if (id === "voice") {
            const afterCal = order.indexOf("calendar");
            const beforeNotes = order.indexOf("notes");
            const insertAt = afterCal >= 0
                ? afterCal + 1
                : beforeNotes >= 0
                    ? beforeNotes
                    : order.length;
            order.splice(insertAt, 0, id);
        } else {
            order.push(id);
        }
    }

    const hidden = hiddenIn.filter((id) => order.includes(id));
    const collapsed = collapsedIn.filter((id) => order.includes(id));
    return { order, hidden, collapsed };
}

export function visiblePanelSections(layout) {
    const { order, hidden } = normalizePanelSections(layout);
    const hiddenSet = new Set(hidden);
    return order.filter((id) => !hiddenSet.has(id));
}

export function hiddenPanelSections(layout) {
    const { order, hidden } = normalizePanelSections(layout);
    const hiddenSet = new Set(hidden);
    return order.filter((id) => hiddenSet.has(id));
}

export function isSectionCollapsed(layout, id) {
    return normalizePanelSections(layout).collapsed.includes(id);
}

export function toggleCollapsedSection(layout, id) {
    const next = normalizePanelSections(layout);
    const set = new Set(next.collapsed);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    return { ...next, collapsed: [...set] };
}

/**
 * Déplace une section avant/après une autre (ordre workspace-wide).
 * `place`: "before" | "after"
 */
export function reorderPanelSection(layout, draggedId, targetId, place = "before") {
    const next = normalizePanelSections(layout);
    if (!draggedId || !targetId || draggedId === targetId) return next;
    const order = [...next.order];
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return next;
    order.splice(from, 1);
    let insertAt = order.indexOf(targetId);
    if (insertAt < 0) return next;
    if (place === "after") insertAt += 1;
    order.splice(insertAt, 0, draggedId);
    return { ...next, order };
}

/** Monte / descend d’un cran (−1 = haut, +1 = bas). */
export function movePanelSectionBy(layout, id, delta) {
    const next = normalizePanelSections(layout);
    const order = [...next.order];
    const from = order.indexOf(id);
    if (from < 0) return next;
    const to = from + delta;
    if (to < 0 || to >= order.length) return next;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    return { ...next, order };
}

/** Réordonne par indices dans la liste visible (organisateur). */
export function reorderPanelSectionIndex(layout, fromIdx, toIdx, visibleIds) {
    const next = normalizePanelSections(layout);
    if (
        fromIdx == null ||
        toIdx == null ||
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= visibleIds.length ||
        toIdx >= visibleIds.length
    ) {
        return next;
    }
    const draggedId = visibleIds[fromIdx];
    const targetId = visibleIds[toIdx];
    const place = fromIdx < toIdx ? "after" : "before";
    return reorderPanelSection(next, draggedId, targetId, place);
}

/** Champs clés affichés dans le brief fixe (haut de fiche) */
export const BRIEF_FIELD_RES = {
    // Texte brut CSV « annonce / annonces » (pas un lien)
    annonce: /^(annonces?|libell[ée]s?\s*(de\s*)?l['']?annonces?|titre\s*(de\s*)?l['']?annonces?|intitul[ée]\s*(de\s*)?l['']?annonces?)$/i,
    jobTitle: /poste|intitul|titre|job|fonction|r[oô]le|position|emploi/i,
    location: /localisation|ville|city|location|commune/i,
    contract: /contrat|contract|cdi|cdd|type.?de.?contrat/i,
    contact:  /^(contact|recruteur|rh|nom|interlocuteur|personne|manager|responsable)/i,
};

function asHref(v) {
    const s = String(v || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^www\./i.test(s)) return `https://${s}`;
    if (/^[a-z0-9][\w.-]*\.[a-z]{2,}([/?#].*)?$/i.test(s) && !/\s/.test(s) && !s.includes("@")) {
        return `https://${s}`;
    }
    return null;
}

/** Affichage court d’une URL (sans protocole) */
export function displayUrl(href) {
    if (!href) return "";
    return String(href).replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

const SITUATION_PRIORITY = [
    "rdv",
    "rdv-past",
    "relance-today",
    "call-1",
    "call-n",
    "call-story",
    "call-all-nrp",
    "call-mix",
    "relance",
    "rappel",
    "rappel-past",
    "fu-overdue",
    "fu-soon",
    "never-called",
    "col-age",
    "last-contact",
];

/**
 * Un fait principal + ligne secondaire pour le brief (évite le saladier de chips).
 * @param {{ id: string, label: string, tone?: string }[]} situation
 * @returns {{ primary: object|null, secondaryLine: string }}
 */
export function pickBriefSituation(situation = []) {
    if (!situation.length) return { primary: null, secondaryLine: "" };
    let bestIdx = 0;
    let bestRank = Infinity;
    situation.forEach((f, i) => {
        const rank = SITUATION_PRIORITY.indexOf(f.id);
        const r = rank === -1 ? 100 + i : rank;
        if (r < bestRank) {
            bestRank = r;
            bestIdx = i;
        }
    });
    const primary = situation[bestIdx];
    const secondaryLine = situation
        .filter((_, i) => i !== bestIdx)
        .map((f) => f.label
            .replace(/^«\s*/, "")
            .replace(/\s*»\s*/g, " ")
            .replace(/\s+/g, " ")
            .trim())
        .filter(Boolean)
        .join(" · ");
    return { primary, secondaryLine };
}

/** Libellé court pour un lien du brief (évite les URL Maps interminables). */
export function briefLinkLabel(link) {
    if (!link) return "Lien";
    const href = String(link.href || "");
    const rawLabel = String(link.label || "").trim();
    if (rawLabel && !/^https?:\/\//i.test(rawLabel) && rawLabel.length <= 28 && !/maps\.google|google\.[^/]+\/maps/i.test(rawLabel)) {
        return rawLabel;
    }
    if (/maps\.google|google\.[^/]+\/maps|goo\.gl\/maps/i.test(href)) return "Maps";
    const offer = detectJobOfferLink(href);
    if (offer) return `Offre · ${offer.sourceLabel}`;
    if (/francetravail|pole-emploi|emploi\.gouv/i.test(href)) return "France Travail";
    if (/linkedin\.com/i.test(href)) return "LinkedIn";
    if (rawLabel && /site|web|url/i.test(rawLabel)) return "Site";
    const host = displayUrl(href).split("/")[0] || "";
    if (host && host.length <= 28) return host.replace(/^www\./i, "");
    return "Lien";
}

/**
 * Détecte une URL d’offre d’emploi (Indeed / Hellowork / France Travail).
 * Ignore les pages entreprise, accueil, recherche générique.
 * @returns {{ href: string, source: string, sourceLabel: string } | null}
 */
export function detectJobOfferLink(rawHref) {
    const href = asHref(rawHref) || (String(rawHref || "").startsWith("http") ? String(rawHref).trim() : null);
    if (!href) return null;
    let u;
    try {
        u = new URL(href);
    } catch {
        return null;
    }
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (u.pathname || "/").toLowerCase();
    const search = (u.search || "").toLowerCase();
    const full = `${path}${search}`;

    // ── Indeed ──────────────────────────────────────────────────────────────
    if (/(^|\.)indeed\.(com|fr)$/i.test(host)) {
        // Pages entreprise / compte — pas une offre
        if (/^\/cmp(\/|$)/.test(path) || /\/companies?\//.test(path) || /\/hire\//.test(path)) {
            return null;
        }
        const isOffer =
            /\/viewjob\b/.test(path)
            || /\/rc\/clk\b/.test(path)
            || /\/pagead\/(clk|lkit)\b/.test(path)
            || /\/jobs?\/view\b/.test(path)
            || /[?&]jk=/.test(search)
            || /[?&]vjk=/.test(search);
        if (!isOffer) return null;
        return { href: u.href, source: "indeed", sourceLabel: "Indeed" };
    }

    // ── Hellowork (+ legacy RegionsJob) ─────────────────────────────────────
    if (
        /(^|\.)hellowork\.(com|fr)$/i.test(host)
        || /(^|\.)f\.hellowork\.com$/i.test(host)
        || /(^|\.)regionsjob\.com$/i.test(host)
    ) {
        if (/\/entreprises?(\/|$)/.test(path) || /\/recruteurs?(\/|$)/.test(path) || /\/company\//.test(path)) {
            return null;
        }
        // Offre : /fr-fr/emplois/slug-id.html ou /emplois/... ou /emploi/...
        const isOffer =
            /\/emplois?\/[^/]+/i.test(path)
            && !/\/emplois?\/?$/.test(path)
            && !/\/emplois?\/(recherche|search|liste)/.test(path);
        if (!isOffer) return null;
        return { href: u.href, source: "hellowork", sourceLabel: "Hellowork" };
    }

    // ── France Travail / Pôle Emploi ────────────────────────────────────────
    if (
        /(^|\.)francetravail\.fr$/i.test(host)
        || /(^|\.)pole-emploi\.fr$/i.test(host)
        || /(^|\.)candidat\.francetravail\.fr$/i.test(host)
    ) {
        if (
            /\/accueil(\/|$)/.test(path)
            || /\/entreprises?(\/|$)/.test(path)
            || /\/employeur/.test(path)
            || /\/inscription/.test(path)
        ) {
            return null;
        }
        const isOffer =
            /\/offres?\/recherche\/detail\//.test(path)
            || /\/offres?\/detail\//.test(path)
            || /\/candidat\/.*\/offres?\/.+/.test(path)
            || /\/emplois\/.+\/detail/.test(path)
            || /[?&](idoffre|id_offre|offreid|numerooffre)=/.test(full)
            // Ancien format PE : /candidat/offre/... ou numéro d'offre dans le path
            || /\/offre[s]?\/[a-z0-9_-]{6,}/i.test(path);
        // Liste de recherche seule — pas une fiche offre
        if (/\/offres?\/recherche\/?$/.test(path) && !/detail/.test(path) && !/[?&](idoffre|id_offre)=/.test(search)) {
            return null;
        }
        if (!isOffer) return null;
        return { href: u.href, source: "france_travail", sourceLabel: "France Travail" };
    }

    return null;
}

/** @param {string} href @returns {boolean} */
export function isJobOfferUrl(href) {
    return !!detectJobOfferLink(href);
}

/**
 * Classes Tailwind pour le lien « Voir l'offre » selon la source.
 * @param {string} [source]
 */
export function jobOfferLinkClass(source) {
    const base = "inline-flex items-center gap-1 text-[11px] transition-colors";
    switch (source) {
        case "indeed":
            return `${base} text-sky-600 hover:text-sky-700 dark:text-sky-400`;
        case "hellowork":
            return `${base} text-amber-600 hover:text-amber-700 dark:text-amber-400`;
        case "france_travail":
            return `${base} text-red-600 hover:text-red-700 dark:text-red-400`;
        default:
            return `${base} text-primary`;
    }
}

/** Classes pour le souligné du libellé « Voir l'offre » selon la source. */
export function jobOfferUnderlineClass(source) {
    switch (source) {
        case "indeed":
            return "underline underline-offset-2 decoration-sky-600/40 hover:decoration-sky-700/60";
        case "hellowork":
            return "underline underline-offset-2 decoration-amber-500/50 hover:decoration-amber-600/70";
        case "france_travail":
            return "underline underline-offset-2 decoration-red-600/40 hover:decoration-red-700/60";
        default:
            return "underline underline-offset-2 decoration-primary/40 hover:decoration-primary/60";
    }
}

function calendarDaysBetween(fromIso, toDate = new Date()) {
    if (!fromIso) return null;
    const a = new Date(fromIso);
    if (Number.isNaN(a.getTime())) return null;
    const start = new Date(a);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(0, 0, 0, 0);
    return Math.round((end - start) / 86400000);
}

function ordinalFr(n) {
    if (n === 1) return "1er";
    return `${n}e`;
}

function formatFrShort(isoOrDate) {
    if (!isoOrDate) return "";
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** « depuis 3 j » / « depuis 2 semaines » */
function sinceDurationLabel(days) {
    if (days == null || days < 0) return null;
    if (days === 0) return "depuis aujourd'hui";
    if (days === 1) return "depuis 1 jour";
    if (days < 7) return `depuis ${days} j`;
    const weeks = Math.round(days / 7);
    if (days < 45) return weeks <= 1 ? "depuis 1 semaine" : `depuis ${weeks} semaines`;
    const months = Math.max(1, Math.round(days / 30));
    return months === 1 ? "depuis 1 mois" : `depuis ${months} mois`;
}

/** « il y a 3 j » */
function agoDurationLabel(days) {
    if (days == null || days < 0) return null;
    if (days === 0) return "aujourd'hui";
    if (days === 1) return "hier";
    if (days < 7) return `il y a ${days} j`;
    const weeks = Math.round(days / 7);
    if (days < 45) return weeks <= 1 ? "il y a 1 semaine" : `il y a ${weeks} semaines`;
    const months = Math.max(1, Math.round(days / 30));
    return months === 1 ? "il y a 1 mois" : `il y a ${months} mois`;
}

const CALL_REACHED_NOTE_RE = /^📞\s*Joint\b/i;
const CALL_NO_ANSWER_NOTE_RE = /^📵\s*Pas de réponse\b/i;
const RELANCE_NOTE_RE = /^🔁\s*Relance\b/i;

/** Canal depuis une note « 🔁 Relance #n · LinkedIn · … » */
function canalFromRelanceNote(text) {
    const m = String(text || "").match(/^🔁\s*Relance(?:\s*#\d+)?\s*·\s*([^·\n]+)/i);
    return m ? m[1].trim() : null;
}

/**
 * Faits de prospection pour le brief (appels, réponses, relances, ancienneté RDV…).
 * @returns {{ id: string, label: string, tone?: 'neutral'|'ok'|'warn'|'info' }[]}
 */
export function extractLeadSituation(lead, { now = new Date(), columnName = "" } = {}) {
    if (!lead) return [];
    const facts = [];
    const push = (id, label, tone = "neutral") => {
        if (!label || facts.some((f) => f.id === id)) return;
        facts.push({ id, label, tone });
    };

    // Notes chronologiques (anciennes → récentes)
    const notesAsc = [...(lead.notes || [])]
        .filter((n) => n?.text)
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));

    const calls = [];
    let relanceNotes = 0;
    for (const n of notesAsc) {
        const t = String(n.text).trim();
        if (CALL_REACHED_NOTE_RE.test(t)) {
            calls.push({ at: n.at, outcome: "reached" });
        } else if (CALL_NO_ANSWER_NOTE_RE.test(t)) {
            calls.push({ at: n.at, outcome: "noanswer" });
        } else if (RELANCE_NOTE_RE.test(t)) {
            relanceNotes += 1;
        }
    }

    const relanceCount = Math.max(relanceNotes, (lead.relances || []).length);

    if (calls.length > 0) {
        const last = calls[calls.length - 1];
        const n = calls.length;
        const lastLabel = last.outcome === "reached" ? "joint" : "pas de réponse";
        const when = last.at ? agoDurationLabel(calendarDaysBetween(last.at, now)) : null;

        if (n === 1) {
            push(
                "call-1",
                last.outcome === "reached"
                    ? `1er appel · réponse${when ? ` · ${when}` : ""}`
                    : `1er appel · aucune réponse${when ? ` · ${when}` : ""}`,
                last.outcome === "reached" ? "ok" : "warn"
            );
        } else {
            const reachedCount = calls.filter((c) => c.outcome === "reached").length;
            const noAnswerCount = n - reachedCount;
            push(
                "call-n",
                `${ordinalFr(n)} appel · ${lastLabel}${when ? ` · ${when}` : ""}`,
                last.outcome === "reached" ? "ok" : "warn"
            );
            if (noAnswerCount > 0 && reachedCount > 0) {
                push(
                    "call-mix",
                    `${reachedCount} joint${reachedCount > 1 ? "s" : ""} · ${noAnswerCount} sans réponse`,
                    "info"
                );
            } else if (noAnswerCount === n && n >= 2) {
                push("call-all-nrp", `${n} appels sans réponse`, "warn");
            }
        }

        // Premier appel sans réponse puis suite
        if (n >= 2 && calls[0].outcome === "noanswer") {
            const firstReached = calls.findIndex((c) => c.outcome === "reached");
            if (firstReached === 1) {
                push("call-story", "Joint au 2e appel", "ok");
            } else if (firstReached > 1) {
                push("call-story", `Joint au ${ordinalFr(firstReached + 1)} appel`, "ok");
            }
        }
    }

    if (relanceCount > 0) {
        const sortedRelances = [...(lead.relances || [])].sort(
            (a, b) => new Date(b.at || 0) - new Date(a.at || 0)
        );
        const lastRelanceEntry = sortedRelances[0] || null;
        const lastRelanceNote = [...notesAsc].reverse().find((n) =>
            RELANCE_NOTE_RE.test(String(n.text || ""))
        );
        const lastRelanceAt = lastRelanceEntry?.at || lastRelanceNote?.at || null;
        const canal = (lastRelanceEntry?.canal || canalFromRelanceNote(lastRelanceNote?.text) || "")
            .trim();
        const days = lastRelanceAt != null ? calendarDaysBetween(lastRelanceAt, now) : null;
        const ago = days != null ? agoDurationLabel(days) : null;
        const canalPart = canal ? ` · ${canal}` : "";

        if (days === 0) {
            // Relance du jour → mise en avant dans Information pertinente
            push(
                "relance-today",
                relanceCount === 1
                    ? `Relancé aujourd'hui${canalPart}`
                    : `${ordinalFr(relanceCount)} relance aujourd'hui${canalPart}`,
                "ok"
            );
        } else {
            push(
                "relance",
                relanceCount === 1
                    ? `1re relance${canalPart}${ago ? ` · ${ago}` : ""}`
                    : `${ordinalFr(relanceCount)} relance${canalPart}${ago ? ` · ${ago}` : ""}`,
                "info"
            );
        }
    }

    // Colonne actuelle
    const hist = lead.statusHistory || [];
    const enteredCol = [...hist].reverse().find((e) => e.columnId === lead.columnId)?.at
        || lead.contactedColumnEnteredAt
        || lead.createdAt
        || null;
    if (enteredCol) {
        const days = calendarDaysBetween(enteredCol, now);
        const since = sinceDurationLabel(days);
        if (since && days >= 1) {
            const col = (columnName || "").trim();
            if (col) {
                push("col-age", `« ${col} » ${since}`, days >= 14 ? "warn" : "neutral");
            } else if (days >= 3) {
                push("col-age", `Même étape ${since}`, days >= 14 ? "warn" : "neutral");
            }
        }
    }

    // RDV / rappel planifié
    const na = lead.nextAction;
    if (na) {
        const dueRaw = na.dueAt || na.date;
        const due = dueRaw ? new Date(dueRaw) : null;
        const dueOk = due && !Number.isNaN(due.getTime());
        const rdvSetNote = [...notesAsc].find((n) =>
            /📅\s*RDV|RDV détecté|rendez[\s-]?vous|meeting/i.test(String(n.text || ""))
        );
        const plannedAt =
            rdvSetNote?.at
            || (isMeetingColumn(columnName) ? enteredCol : null)
            || null;

        if (isManualRdv(na) && dueOk) {
            const daysUntil = calendarDaysBetween(now.toISOString(), due);
            const plannedDays = plannedAt ? calendarDaysBetween(plannedAt, now) : null;
            const plannedSince = plannedDays != null && plannedDays >= 7
                ? sinceDurationLabel(plannedDays)
                : null;

            if (due.getTime() >= now.getTime() - 2 * 60 * 60 * 1000) {
                const whenDue = daysUntil <= 0
                    ? "aujourd'hui"
                    : daysUntil === 1
                        ? "demain"
                        : `dans ${daysUntil} j`;
                push(
                    "rdv",
                    plannedSince
                        ? `RDV ${whenDue} · fixé ${plannedSince}`
                        : `RDV prévu ${whenDue} · ${formatFrShort(due)}`,
                    "info"
                );
            } else {
                const overdue = calendarDaysBetween(due.toISOString(), now);
                push(
                    "rdv-past",
                    overdue != null && overdue > 0
                        ? `RDV passé ${agoDurationLabel(overdue)} · ${formatFrShort(due)}`
                        : `RDV passé · ${formatFrShort(due)}`,
                    "warn"
                );
            }
        } else if ((isCalendarReminder(na) || na.auto) && dueOk) {
            const daysUntil = calendarDaysBetween(toLocalDateKey(now), due);
            if (due.getTime() >= now.getTime() - 2 * 60 * 60 * 1000) {
                push(
                    "rappel",
                    daysUntil <= 0
                        ? "Rappel aujourd'hui"
                        : daysUntil === 1
                            ? "Rappel demain"
                            : `Rappel dans ${daysUntil} j`,
                    "neutral"
                );
            } else {
                push("rappel-past", `Rappel en retard · ${formatFrShort(due)}`, "warn");
            }
        }
    }

    // Dernier contact (si pas déjà couvert par le dernier appel)
    if (lead.lastContact && calls.length === 0) {
        const days = calendarDaysBetween(lead.lastContact, now);
        const ago = agoDurationLabel(days);
        if (ago) push("last-contact", `Dernier contact · ${ago}`, days >= 7 ? "warn" : "neutral");
    } else if (lead.lastContact && calls.length > 0) {
        const lastCallAt = calls[calls.length - 1]?.at;
        const lastCallDays = lastCallAt ? calendarDaysBetween(lastCallAt, now) : null;
        const contactDays = calendarDaysBetween(lead.lastContact, now);
        // Contact plus récent qu'un appel (ex. email) — signal utile
        if (
            contactDays != null
            && lastCallDays != null
            && contactDays < lastCallDays
            && contactDays >= 0
        ) {
            push("last-contact", `Dernier échange · ${agoDurationLabel(contactDays)}`, "neutral");
        }
    }

    // Auto-followup overdue
    if (lead.autoFollowup?.overdue) {
        push("fu-overdue", "Relance auto en retard", "warn");
    } else if (lead.autoFollowup?.dueAt) {
        const days = calendarDaysBetween(now.toISOString(), new Date(lead.autoFollowup.dueAt));
        if (days != null && days <= 1 && new Date(lead.autoFollowup.dueAt) >= now) {
            push("fu-soon", days <= 0 ? "Relance auto aujourd'hui" : "Relance auto demain", "info");
        }
    }

    // Lead créé récemment sans appel
    if (calls.length === 0 && lead.createdAt) {
        const age = calendarDaysBetween(lead.createdAt, now);
        if (age != null && age >= 2 && age <= 21 && !lead.lastContact) {
            push("never-called", `Jamais appelé · créé ${agoDurationLabel(age)}`, "warn");
        }
    }

    return facts.slice(0, 6);
}

/**
 * Brief personnalisé par lead : import CSV + notes + champs principaux.
 * `insights` = infos « pertinentes » détectées (noms dans notes, champs import…)
 * prêtes à être appliquées / mises en avant dans le panneau interactif.
 * @param {object} lead
 * @param {{ columnName?: string, now?: Date }} [opts]
 */
export function extractLeadBrief(lead, opts = {}) {
    const entries = [];
    for (const f of lead?.customFields || []) {
        if (f?.value) {
            entries.push({
                label: f.label || "",
                value: String(f.value).trim(),
                highlight: !!f.highlight,
                source: "field",
            });
        }
    }
    for (const [k, v] of Object.entries(lead?.extra || {})) {
        if (v) {
            entries.push({
                label: k,
                value: String(v).trim(),
                highlight: false,
                source: "import",
            });
        }
    }

    const pick = (re, { maxLen = 120 } = {}) => {
        const hl = entries.find((e) => e.highlight && re.test(e.label) && !asHref(e.value));
        if (hl) return hl.value;
        const hit = entries.find(
            (e) => re.test(e.label) && e.value && e.value.length <= maxLen && !asHref(e.value)
        );
        return hit?.value || null;
    };

    // Annonce CSV : texte libre, peut être plus long ; exclut les URL
    const pickAnnonce = () => {
        const re = BRIEF_FIELD_RES.annonce;
        const loose = /annonce/i;
        const prefer = entries.find(
            (e) => re.test(e.label) && e.value && !asHref(e.value) && !/lien|url|http/i.test(e.label)
        );
        if (prefer) return prefer.value.trim();
        const fallback = entries.find(
            (e) => loose.test(e.label)
                && e.value
                && !asHref(e.value)
                && !/lien|url|http|site/i.test(e.label)
                && e.value.length <= 280
        );
        return fallback?.value?.trim() || null;
    };

    const annonce = pickAnnonce();
    const jobTitle = pick(BRIEF_FIELD_RES.jobTitle);
    const location = pick(BRIEF_FIELD_RES.location);
    const contract = pick(BRIEF_FIELD_RES.contract);
    const contactFromImport = pick(BRIEF_FIELD_RES.contact);

    let notePhones = [];
    let noteEmails = [];
    /** Set of person keys trouvés dans un transcript d'appel (prioritaires). */
    const callPersonKeys = new Set();
    const noteList = lead?.notes || [];
    const callCorpus = noteList
        .filter((n) => n?.recordingId && String(n?.transcript || "").trim())
        .map((n) => String(n.transcript).trim())
        .join("\n");
    const allNotes = noteList.map(noteCorpus).filter(Boolean).join("\n");
    if (allNotes.trim()) {
        const detected = parseNote(allNotes);
        notePhones = detected.phones || [];
        noteEmails = detected.emails || [];
    }
    if (callCorpus.trim()) {
        for (const p of detectPersonNames(callCorpus)) {
            callPersonKeys.add(personNameKey(p));
        }
    }

    const rankedContacts = rankContactNames(
        [
            ...(lead?.contact ? [{ name: lead.contact, source: "lead", frequency: 1, lastNoteIndex: 0 }] : []),
            ...(contactFromImport ? [{ name: contactFromImport, source: "import", frequency: 1, lastNoteIndex: 99 }] : []),
            ...noteList.flatMap((n, idx) => {
                const corpus = noteCorpus(n);
                const fromCall = !!(n?.recordingId && String(n?.transcript || "").trim());
                return detectPersonNames(corpus).map((p) => ({
                    name: p,
                    source: fromCall ? "call" : "note",
                    frequency: fromCall ? 2 : 1,
                    lastNoteIndex: idx,
                }));
            }),
            ...(lead?.customFields || [])
                .filter((cf) => cf?.value && /contact|interlocuteur|personne|nom/i.test(cf.label || ""))
                .map((cf) => ({ name: cf.value, source: "note", frequency: 1, lastNoteIndex: 40 })),
        ],
        { leadContact: lead?.contact, totalNotes: noteList.length || 1 }
    );

    // Contact / tél / email affichés = uniquement champs confirmés (le reste → Suggestions)
    const contact = (lead?.contact || "").trim() || contactFromImport || null;
    const contactSource = lead?.contact
        ? "lead"
        : contactFromImport
            ? "import"
            : null;

    const phone = lead?.phone || null;
    const email = lead?.email || null;

    const links = [];
    const pushLink = (href, label) => {
        if (!href || links.some((l) => l.href === href)) return;
        links.push({ href, display: displayUrl(href), label: label || null });
    };

    if (lead?.website) {
        pushLink(
            asHref(lead.website) || (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`),
            "Site"
        );
    }
    for (const e of entries) {
        const href = asHref(e.value);
        if (href) pushLink(href, e.label);
    }

    // Offre d'emploi (Indeed / Hellowork / France Travail) — mise en avant
    let offerLink = null;
    const considerOffer = (href, labelHint) => {
        if (offerLink || !href) return;
        const det = detectJobOfferLink(href);
        if (!det) return;
        offerLink = {
            href: det.href,
            display: displayUrl(det.href),
            label: labelHint || null,
            source: det.source,
            sourceLabel: det.sourceLabel,
        };
    };
    // Priorité aux champs explicitement « offre / annonce »
    for (const e of entries) {
        if (!/offre|annonce|lien.?offre|url.?offre|job.?url|job.?link/i.test(e.label || "")) continue;
        considerOffer(asHref(e.value), e.label);
    }
    if (lead?.website) {
        considerOffer(
            asHref(lead.website) || (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`),
            "Lien offre"
        );
    }
    for (const l of links) {
        considerOffer(l.href, l.label);
    }

    const otherLinks = offerLink
        ? links.filter((l) => l.href !== offerLink.href)
        : links;

    const insights = [];
    const pushInsight = (item) => {
        if (!item?.value) return;
        if (insights.some((i) => i.type === item.type && String(i.value).toLowerCase() === String(item.value).toLowerCase())) {
            return;
        }
        insights.push(item);
    };

    const contextualNotes = extractContextualNotes(lead, 2);
    const contextualNoteTexts = contextualNotes.map((n) => n.text);
    const situation = extractLeadSituation(lead, {
        now: opts.now || new Date(),
        columnName: opts.columnName || "",
    });

    const callPhones = callCorpus ? (parseNote(callCorpus).phones || []) : [];
    const callEmails = callCorpus ? (parseNote(callCorpus).emails || []) : [];

    // ── RDV en premier (suggestion n°1) ──────────────────────────────────────
    const appointmentFromCall = callCorpus ? detectAppointment(callCorpus) : null;
    const appointmentFinal = appointmentFromCall || detectAppointment(allNotes);
    if (appointmentFinal?.iso && !isManualRdv(lead?.nextAction)) {
        const existingDue = lead?.nextAction?.dueAt || lead?.nextAction?.date;
        const sameDay = existingDue && toLocalDateKey(existingDue) === toLocalDateKey(appointmentFinal.iso);
        if (!sameDay) {
            pushInsight({
                type: "appointment",
                value: appointmentFinal.label,
                label: "Date détectée",
                actionable: true,
                applyKey: null,
                appointment: appointmentFinal,
                source: appointmentFromCall ? "call" : "note",
                priority: 100,
            });
        }
    }

    // ── Téléphones ──────────────────────────────────────────────────────────
    for (const p of notePhones) {
        const alreadyPrimary = lead?.phone && normalizeLoose(lead.phone) === normalizeLoose(p);
        if (alreadyPrimary) continue;
        const alreadyExtra = (lead?.customFields || []).some(
            (cf) => /t[eé]l/i.test(cf.label || "") && normalizeLoose(cf.value) === normalizeLoose(p)
        );
        if (alreadyExtra) continue;
        const fromCall = callPhones.some((c) => normalizeLoose(c) === normalizeLoose(p));
        pushInsight({
            type: "phone",
            value: p,
            label: lead?.phone ? "Tél. supplémentaire" : "Tél. détecté",
            actionable: true,
            applyKey: lead?.phone ? null : "phone",
            applyAsExtraPhone: !!lead?.phone,
            source: fromCall ? "call" : "note",
            priority: fromCall ? 90 : 80,
        });
    }

    // ── Emails ──────────────────────────────────────────────────────────────
    for (const e of noteEmails) {
        if (lead?.email && lead.email.toLowerCase() === e.toLowerCase()) continue;
        const alreadyExtra = (lead?.customFields || []).some(
            (cf) => /e-?mail|courriel/i.test(cf.label || "")
                && String(cf.value || "").toLowerCase() === e.toLowerCase()
        );
        if (alreadyExtra) continue;
        const fromCall = callEmails.some((c) => c.toLowerCase() === e.toLowerCase());
        pushInsight({
            type: "email",
            value: e,
            label: lead?.email ? "Email supplémentaire" : "Email détecté",
            actionable: true,
            applyKey: lead?.email ? null : "email",
            applyAsExtraEmail: !!lead?.email,
            source: fromCall ? "call" : "note",
            priority: fromCall ? 85 : 75,
        });
    }

    // ── Contacts / noms ─────────────────────────────────────────────────────
    for (const ranked of rankedContacts.slice(0, 8)) {
        const p = ranked.name;
        const isPrimary = lead?.contact
            && personNameKey(lead.contact) === personNameKey(p);
        if (isPrimary) continue;
        const fromCall = ranked.source === "call" || callPersonKeys.has(personNameKey(p));
        // Notes libres : garder un ancrage contexte ; appels : toujours proposer
        if (!fromCall && (ranked.source || "note") === "note") {
            const nameKey = personNameKey(p);
            const backedByContext = contextualNoteTexts.some((t) =>
                personNameKey(t).includes(nameKey) || detectPersonNames(t).some((d) => personNameKey(d) === nameKey)
            );
            if (!backedByContext) continue;
        }
        pushInsight({
            type: "person",
            value: p,
            label: fromCall ? "Contact détecté (appel)" : ranked.source === "import" ? "Contact importé" : "Contact détecté",
            actionable: true,
            applyKey: "contact",
            source: fromCall ? "call" : (ranked.source || "note"),
            score: ranked.score,
            priority: fromCall ? 70 : 50,
        });
    }

    for (const e of entries.filter((x) => x.highlight && x.value && !asHref(x.value))) {
        if (/poste|intitul|titre|job|annonce/i.test(e.label)) continue;
        pushInsight({
            type: "field",
            value: e.value,
            label: e.label,
            actionable: false,
            source: "import",
            priority: 10,
        });
    }

    const TYPE_RANK = { appointment: 0, phone: 1, email: 2, person: 3, field: 4 };
    const sortedInsights = [...insights].sort((a, b) => {
        const pa = (b.priority || 0) - (a.priority || 0);
        if (pa !== 0) return pa;
        return (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
    });

    return {
        annonce,
        jobTitle,
        location,
        contract,
        phone,
        email,
        contact,
        contactSource,
        website: lead?.website || null,
        links: otherLinks.slice(0, 8),
        offerLink,
        insights: sortedInsights.slice(0, 8),
        contextualNotes,
        situation,
        hasPertinent: sortedInsights.length > 0 || contextualNotes.length > 0 || situation.length > 0 || !!offerLink || !!annonce,
        hasBrief: !!(
            annonce
            || jobTitle
            || location
            || contract
            || phone
            || email
            || contact
            || links.length
            || offerLink
            || sortedInsights.length
            || contextualNotes.length
            || situation.length
        ),
    };
}

function personNameKey(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\b(?:m|mr|mister|monsieur|mme|madame|mlle|mademoiselle)\.?\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function normalizeLoose(s) {
    return String(s || "").replace(/\D/g, "");
}

/** Prefixe emoji / symbole d'appel — on enlève tout le bruit avant le texte. */
const NOTE_CALL_PREFIX_RE = /^(?:📞|📵|\uD83D\uDCDE|\uD83D\uDD07|[^\p{L}\p{N}]+)+/u;

/** Texte utile d'une note — préfère le transcript d'appel au libellé court. */
export function noteCorpus(n) {
    const tr = String(n?.transcript || "").trim();
    if (tr) return tr;
    return String(n?.text || "").trim();
}

/** Résultat d'appel sans contenu : « Joint · », « Pas de réponse · » */
const CALL_OUTCOME_RE =
    /^(?:joint|pas\s+de\s+r[eé]ponse|non\s+joint|nrp|injoignable)\b[\s·.\-:]*/i;

/** Titre + nom (forme libre, pour mesurer le reste hors nom). */
const PERSON_MENTION_RE =
    /\b(?:m(?:onsieur)?|mr|mister|mme|madame|mlle|mademoiselle)\.?\s+[A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*(?:\s+[A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*)?/gi;

/**
 * Note « pure rappel » : programmer un rappel sans contexte métier.
 * Ex. « rappeler demain a 12h », « 📞 appeler lundi », « relancer dans 2j ».
 */
const PURE_REMINDER_RE =
    /^(?:à\s+)?(?:re)?(?:appeler|rappeler|relancer|rappel|callback|recontacter|joindre)\b[\s,]*(?:demain|aujourd['’]?hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|matin|soir|midi|dans\s+\d+\s*(?:j(?:ours?)?|h(?:eures?)?)?|à\s*\d{1,2}(?:[:hH]\d{0,2})?|a\s*\d{1,2}(?:[:hH]\d{0,2})?|ce\s+soir)?[\s,àa0-9hH:.\-]*$/i;

/** Indices de contexte métier / dispo / décision (pas juste un créneau ou un nom). */
const CONTEXT_SIGNAL_RE =
    /\b(?:disponible|dispo|absent|occup[ée]|int[eé]ress[ée]|pas\s+int[eé]ress|budget|d[eé]cideur|d[eé]cide|semaine\s+prochaine|[aà]\s+partir|en\s+cong[eé]|en\s+r[eé]union|revient\s+de|pr[eé]f[eè]re|souhaite|demande|m['’]?a\s+dit|a\s+dit|confirme|annul|report(?:[eé])?|devis|proposition|concurrent|prix|tarif|besoin|attendre|attendre?\s+retour|enverra|envoi|document|ferme|ouvert|ok\s+pour|d['’]?accord)\b/i;

/** Longueur mini du texte utile (hors statut d'appel / hors nom). */
const MIN_SUBSTANCE_CHARS = 28;
/** Longueur mini de la note complète pour monter en info pertinente. */
const MIN_NOTE_CHARS = 40;

function noteSubstance(text) {
    return String(text || "")
        .replace(NOTE_CALL_PREFIX_RE, "")
        .replace(CALL_OUTCOME_RE, "")
        .replace(PERSON_MENTION_RE, " ")
        .replace(/\b(?:re)?(?:appeler|rappeler|relancer|rappel|callback|recontacter|joindre)\b/gi, " ")
        .replace(
            /\b(?:demain|aujourd['’]?hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|matin|soir|midi)\b/gi,
            " "
        )
        .replace(
            /\b(?:dans\s+\d+\s*(?:j(?:ours?)?|h(?:eures?)?)|à\s*\d{1,2}(?:[:hH]\d{0,2})?|a\s*\d{1,2}(?:[:hH]\d{0,2})?)\b/gi,
            " "
        )
        .replace(/[\s,.\-:;!?·]+/g, " ")
        .trim();
}

/**
 * True si la note apporte un vrai contexte (dispo, décision, détail…)
 * — pas un simple rappel, ni juste un nom (« Joint · mr durand »).
 */
export function isContextualNote(text) {
    const raw = String(text || "").trim();
    if (!raw) return false;

    const withoutEmoji = raw.replace(NOTE_CALL_PREFIX_RE, "").trim();
    const withoutOutcome = withoutEmoji.replace(CALL_OUTCOME_RE, "").trim();
    if (!withoutOutcome) return false;
    if (PURE_REMINDER_RE.test(withoutOutcome)) return false;

    const substance = noteSubstance(raw);
    const hasSignal = CONTEXT_SIGNAL_RE.test(raw);

    // Juste un nom / statut d'appel → jamais en info pertinente
    if (substance.length < MIN_SUBSTANCE_CHARS && !hasSignal) return false;
    if (withoutOutcome.length < MIN_NOTE_CHARS && !hasSignal) return false;

    // Signal métier + un minimum de texte utile
    if (hasSignal && substance.length >= 12) return true;

    // Note longue avec assez de contenu hors nom / hors créneau
    if (withoutOutcome.length >= MIN_NOTE_CHARS && substance.length >= MIN_SUBSTANCE_CHARS) {
        return true;
    }
    return false;
}

/**
 * Notes les plus récentes avec assez de contexte pour le brief.
 * @returns {{ id: string, text: string, at?: string }[]}
 */
export function extractContextualNotes(lead, limit = 2) {
    const notes = lead?.notes || [];
    const out = [];
    for (const n of notes) {
        const corpus = noteCorpus(n);
        if (!corpus) continue;
        // Notes d'appel : on prend le transcript, pas le libellé court
        if (n?.recordingId && !String(n.transcript || "").trim()) continue;
        if (!isContextualNote(corpus)) continue;
        out.push({
            id: n.id || `note-${out.length}`,
            text: String(corpus).replace(NOTE_CALL_PREFIX_RE, "").trim(),
            at: n.at || null,
        });
        if (out.length >= limit) break;
    }
    return out;
}

/** Détecte si une valeur extra/custom est une URL cliquable */
export function valueAsHref(v) {
    return asHref(v);
}
