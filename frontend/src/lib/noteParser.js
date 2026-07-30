import { stripOwnerIdentity, isOwnerPerson } from "@/lib/ownerIdentity";
import { stripSpeakerLabels } from "@/lib/speakerDiarize";

/**
 * noteParser.js — Détection automatique d'informations dans le texte d'une note
 *
 * Détecte (sans jamais modifier la note) :
 *   - Numéros de téléphone français (02–09, +33, 06/07 mobile…)
 *   - Adresses e-mail
 *   - Adresses postales françaises (code postal + ville)
 *   - Noms de personnes (M. Bertrand, Madame Denis…)
 *   - Rendez-vous / rappels avec date et heure (absolu et relatif)
 *
 * Règles :
 *   - Ne jamais écraser un champ existant non vide → retourne uniquement
 *     les infos "nouvelles" que le lead ne possède pas déjà
 *   - Peut retourner plusieurs téléphones (stockés en customFields)
 *   - Les notes ne sont JAMAIS modifiées
 */

// ── Téléphone français ────────────────────────────────────────────────────────
const PHONE_RE = /(?:(?:\+33\s?|0)(?:[2-9])(?:[\s.\-]?\d{2}){4})/g;

/** Chiffres dictés (Whisper) → digit */
const FR_DIGIT_WORD = {
    zero: "0",
    zéro: "0",
    un: "1",
    une: "1",
    deux: "2",
    trois: "3",
    quatre: "4",
    cinq: "5",
    six: "6",
    sept: "7",
    huit: "8",
    neuf: "9",
};

function normalizePhone(raw) {
    let digits = String(raw || "").replace(/[\s.\-]/g, "");
    if (digits.startsWith("0033")) digits = `+33${digits.slice(4)}`;
    if (digits.startsWith("+33")) {
        const local = `0${digits.slice(3)}`;
        return local.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    }
    if (digits.length === 9 && /^[1-9]/.test(digits)) {
        digits = `0${digits}`;
    }
    return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

function normalizeToken(w) {
    return String(w || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function expandSpokenDigits(text) {
    return String(text || "")
        .replace(/\bplus\s*33\b/gi, "+33")
        .replace(
            /\b(z[eé]ro|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf)\b/gi,
            (w) => {
                const key = normalizeToken(w);
                return FR_DIGIT_WORD[key] ?? w;
            }
        );
}

/** Collecte les tél. FR y compris dictés / espacés (transcripts Whisper). */
function collectPhones(text) {
    const found = new Set();
    const pushMatches = (src) => {
        if (!src) return;
        PHONE_RE.lastIndex = 0;
        const hits = src.match(PHONE_RE) || [];
        for (const h of hits) {
            const n = normalizePhone(h);
            const digits = n.replace(/\D/g, "");
            if (digits.length >= 10) found.add(n);
        }
        // Digits déjà séparés : "0 6 1 2 3 4 5 6 7 8"
        const spaced = src.match(/\b(?:\+33|0)\s*(?:[1-9](?:\s*\d){8})\b/g) || [];
        for (const h of spaced) {
            const n = normalizePhone(h);
            const digits = n.replace(/\D/g, "");
            if (digits.length >= 10) found.add(n);
        }
    };

    pushMatches(text);
    const expanded = expandSpokenDigits(text);
    pushMatches(expanded);
    // Après expansion des mots, coller les chiffres isolés pour matcher
    pushMatches(expanded.replace(/(\d)\s+(?=\d)/g, "$1"));
    return [...found];
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const ADDRESS_RE =
    /\d{1,4}[\s,]+(?:rue|avenue|av\.?|boulevard|bd\.?|impasse|allée|chemin|place|résidence|villa|route)\s+[^,\n]{3,40}[\s,]+\d{5}\s+[A-ZÀ-Ÿa-zà-ÿ\s\-]{2,30}/gi;

const ZIPCODE_CITY_RE = /\b(\d{5})\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]{2,25})\b/g;

// ── Noms de personnes ─────────────────────────────────────────────────────────
const TITLE_MAP = {
    m: "M.", mr: "M.", mister: "M.", monsieur: "Monsieur",
    mme: "Mme", madame: "Madame",
    mlle: "Mlle", mademoiselle: "Mademoiselle",
};

const STOP_NAMES = new Set([
    "aujourd", "demain", "lundi", "mardi", "mercredi", "jeudi", "vendredi",
    "samedi", "dimanche", "matin", "soir", "midi", "reponse", "réponse",
    "rappel", "relance", "dispo", "disponible", "absent", "occupe", "occupé",
    "pas", "plus", "pour", "avec", "dans", "chez", "vers", "sans", "sous",
    "au", "aux", "du", "des", "de", "la", "le", "les", "un", "une", "et",
    "ou", "qui", "que", "car", "donc", "mais", "sur", "par", "a", "à",
    "joint", "joindre", "appele", "appeler", "rappeler", "recontacter",
    "telephone", "tel", "email", "mail", "rdv", "heure", "h",
]);

function capitalizeWord(w) {
    if (!w) return "";
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function formatPersonName(titleKey, rawName) {
    const title = TITLE_MAP[titleKey] || "M.";
    const parts = String(rawName).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;

    // Ne garder que les tokens « nom » (stop au premier mot-outil)
    const nameParts = [];
    for (const p of parts) {
        if (STOP_NAMES.has(normalizeToken(p))) break;
        if (!/^[A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*$/.test(p)) break;
        nameParts.push(p);
        if (nameParts.length >= 2) break; // prénom + nom max
    }
    if (!nameParts.length) return null;

    const name = nameParts.map(capitalizeWord).join(" ");
    return `${title} ${name}`;
}

/**
 * Détecte des noms : « M. Bertrand », « Madame Denis »,
 * et intros transcript « c'est Jean Dupont », « je suis Marie Martin ».
 * @returns {string[]} noms formatés, dédupliqués
 */
export function detectPersonNames(text) {
    text = stripSpeakerLabels(text);
    if (!text || !text.trim()) return [];
    const found = [];
    const push = (formatted) => {
        if (!formatted) return;
        if (found.some((f) => personKey(f) === personKey(formatted))) return;
        found.push(formatted);
    };

    // Titre + 1 ou 2 mots
    const titled =
        /\b(m(?:onsieur)?|mr|mister|mme|madame|mlle|mademoiselle)\.?\s+([A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*)(?:\s+([A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*))?/gi;
    let m;
    while ((m = titled.exec(text)) !== null) {
        const key = m[1].toLowerCase().replace(/\./g, "");
        const raw = [m[2], m[3]].filter(Boolean).join(" ");
        push(formatPersonName(key, raw));
    }

    // Intros conversationnelles (transcripts d'appel)
    const intro =
        /\b(?:c['’]est|je\s+suis|moi\s+c['’]est|avec|joindre|appeler|parler\s+(?:à|a|avec)|au\s+nom\s+de|de\s+la\s+part\s+de)\s+([A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*)\s+([A-Za-zÀ-Ÿà-ÿ][A-Za-zÀ-Ÿà-ÿ'’-]*)\b/gi;
    while ((m = intro.exec(text)) !== null) {
        const a = m[1];
        const b = m[2];
        if (STOP_NAMES.has(normalizeToken(a)) || STOP_NAMES.has(normalizeToken(b))) continue;
        push(`${capitalizeWord(a)} ${capitalizeWord(b)}`);
    }

    return found.filter((p) => !isOwnerPerson(p));
}

function personKey(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\b(?:m|mr|mister|monsieur|mme|madame|mlle|mademoiselle)\.?\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Parse une note et retourne les infos détectées.
 * @returns {{ phones: string[], emails: string[], addresses: string[], persons: string[] }}
 */
export function parseNote(text) {
    text = stripSpeakerLabels(text);
    if (!text || !text.trim()) return { phones: [], emails: [], addresses: [], persons: [] };

    const phones = collectPhones(text);
    const emails = [...new Set(text.match(EMAIL_RE) || [])];

    let addresses = [...new Set(
        (text.match(ADDRESS_RE) || []).map((a) => a.replace(/\s+/g, " ").trim())
    )];

    if (addresses.length === 0) {
        const matches = [];
        let m;
        const re = new RegExp(ZIPCODE_CITY_RE.source, ZIPCODE_CITY_RE.flags);
        while ((m = re.exec(text)) !== null) {
            matches.push(`${m[1]} ${m[2].trim()}`);
        }
        addresses = [...new Set(matches)];
    }

    const persons = detectPersonNames(text);
    return stripOwnerIdentity({
        phones,
        emails,
        addresses,
        persons,
    });
}

/**
 * @returns {{
 *   newPhone: string | null,
 *   extraPhones: string[],
 *   newEmail: string | null,
 *   extraEmails: string[],
 *   newAddress: string | null,
 *   newContact: string | null,
 *   extraContacts: string[],
 *   willAddPersons: string[],
 * }}
 */
export function diffWithLead(detected, lead) {
    const { phones, emails, addresses, persons = [] } = detected;

    const existingPhones = new Set();
    if (lead.phone) existingPhones.add(normalizePhone(lead.phone));
    (lead.customFields || []).forEach((cf) => {
        if (cf.value && PHONE_RE.test(cf.value)) existingPhones.add(normalizePhone(cf.value));
    });
    PHONE_RE.lastIndex = 0;

    const newPhones = phones.filter((p) => !existingPhones.has(p));
    const newPhone = !lead.phone && newPhones.length > 0 ? newPhones[0] : null;
    const extraPhones = newPhone ? newPhones.slice(1) : newPhones;

    const existingEmails = new Set();
    if (lead.email) existingEmails.add(String(lead.email).toLowerCase());
    (lead.customFields || []).forEach((cf) => {
        if (!cf?.value) return;
        if (!/e-?mail|courriel|mail/i.test(cf.label || "")) return;
        existingEmails.add(String(cf.value).toLowerCase());
    });
    const newEmails = emails.filter((e) => !existingEmails.has(String(e).toLowerCase()));
    const newEmail = !lead.email && newEmails.length > 0 ? newEmails[0] : null;
    const extraEmails = newEmail ? newEmails.slice(1) : newEmails;

    const addressFieldExists = (lead.customFields || []).some(
        (cf) =>
            cf.label.toLowerCase().includes("adresse") ||
            cf.label.toLowerCase().includes("address")
    );
    const newAddress = !addressFieldExists && addresses.length > 0 ? addresses[0] : null;

    // Contacts : remplir le champ principal si vide, et TOUJOURS ajouter
    // les autres noms en customFields (même si un contact principal existe déjà).
    const existingContact = (lead.contact || "").trim();
    const existingContactNorm = existingContact.toLowerCase();
    const existingPersonNorms = new Set();
    if (existingContactNorm) existingPersonNorms.add(existingContactNorm);
    (lead.customFields || []).forEach((cf) => {
        if (!cf?.value) return;
        if (!/contact|interlocuteur|personne|nom/i.test(cf.label || "")) return;
        existingPersonNorms.add(String(cf.value).trim().toLowerCase());
    });

    const newContact = !existingContactNorm && persons.length > 0
        ? [...persons].sort((a, b) => {
            const score = (n) => (/^(m\.|mme|mlle|monsieur|madame)/i.test(n) ? 2 : 0)
                + (String(n).trim().split(/\s+/).length >= 2 ? 1 : 0);
            return score(b) - score(a);
        })[0]
        : null;


    const extraContacts = [];
    for (const p of persons) {
        const n = p.trim().toLowerCase();
        if (!n) continue;
        if (newContact && n === newContact.trim().toLowerCase()) continue;
        // Même identité que le contact principal → pas de doublon custom
        if (n === existingContactNorm) continue;
        // Déjà en customFields → skip exact duplicate
        if (existingPersonNorms.has(n)) continue;
        extraContacts.push(p);
        existingPersonNorms.add(n);
    }

    const willAddPersons = [
        ...(newContact ? [newContact] : []),
        ...extraContacts,
    ];

    return {
        newPhone,
        extraPhones,
        newEmail,
        extraEmails,
        newAddress,
        newContact,
        extraContacts,
        willAddPersons,
    };
}

export function formatDetected(detected) {
    const items = [];
    (detected.persons || []).forEach((p) => items.push({ type: "person", icon: "👤", value: p }));
    detected.phones.forEach((p) => items.push({ type: "phone", icon: "📞", value: p }));
    detected.emails.forEach((e) => items.push({ type: "email", icon: "✉️", value: e }));
    detected.addresses.forEach((a) => items.push({ type: "address", icon: "📍", value: a }));
    return items;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Détection de rendez-vous / rappels ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const MONTHS_FR = {
    janvier: 0, jan: 0,
    "f\u00e9vrier": 1, fevrier: 1, fev: 1,
    mars: 2, mar: 2,
    avril: 3, avr: 3,
    mai: 4,
    juin: 5,
    juillet: 6, juil: 6,
    "ao\u00fbt": 7, aout: 7,
    septembre: 8, sep: 8, sept: 8,
    octobre: 9, oct: 9,
    novembre: 10, nov: 10,
    "d\u00e9cembre": 11, decembre: 11, dec: 11,
};

const DAYS_FR = {
    lundi: 1, mardi: 2, mercredi: 3, jeudi: 4,
    vendredi: 5, samedi: 6, dimanche: 0,
};

/**
 * Parse une heure depuis un fragment de texte.
 * Accepte : "11h15", "11h", "14:30", "9h00", "à 11h", "14 heures", "vers 10h"
 * Retourne { hours, minutes } ou null.
 */
function parseTime(str) {
    if (!str) return null;
    const mH = str.match(/\b(\d{1,2})\s*h(?:eures?)?\s*(\d{2})?\b/i);
    if (mH) {
        const hours = parseInt(mH[1], 10);
        const minutes = parseInt(mH[2] || "0", 10);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            return { hours, minutes };
        }
    }
    const mC = str.match(/\b(\d{1,2}):(\d{2})\b/);
    if (mC) {
        const hours = parseInt(mC[1], 10);
        const minutes = parseInt(mC[2], 10);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            return { hours, minutes };
        }
    }
    return null;
}

/**
 * Calcule la date du prochain <jour de semaine> à partir de `from`.
 * Si `next` = true, on cherche vraiment la semaine prochaine (pas aujourd'hui même).
 */
function nextWeekday(from, targetDay, next = false) {
    const d = new Date(from);
    const current = d.getDay();
    let diff = targetDay - current;
    if (diff <= 0 || next) diff += 7;
    d.setDate(d.getDate() + diff);
    return d;
}

/**
 * Détecte un rendez-vous ou rappel dans le texte d'une note.
 *
 * Sensible aux formulations commerciales courantes, sans sur-détecter
 * ("aujourd'hui" seul, dates dans une adresse, etc.).
 *
 * @param {string} text
 * @param {Date} [now]
 * @returns {{ iso: string, label: string, hasTime: boolean } | null}
 */
export function detectAppointment(text, now = new Date()) {
    text = stripSpeakerLabels(text);
    if (!text || !text.trim()) return null;

    const t = text.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/['']/g, "'");

    const clone = (d) => new Date(d.getTime());
    const addDays = (d, n) => { const r = clone(d); r.setDate(r.getDate() + n); return r; };
    const refMs = now.getTime();

    // Heure dans les ~40 caractères suivant un ancrage (évite de prendre une heure lointaine)
    const extractTime = (fragment, window = 40) => {
        if (!fragment) return null;
        const slice = fragment.slice(0, window);
        const m = slice.match(/(?:(?:a|vers|pour|autour de)\s+)?(\d{1,2}\s*h(?:eures?)?\s*\d{0,2}|\d{1,2}:\d{2})/i);
        return m ? m[1].trim() : null;
    };

    // Déclencheurs forts (intention claire de planifier / rappeler)
    const STRONG_TRIGGER_RE =
        /\b(?:rdv|rendez[\s-]?vous|rappel(?:er|ler|le)?|recontact(?:er)?|relance(?:r)?|reappeler|joindre|call(?:er)?|entretien|demo|visite|planifi(?:er|e)|programmer|fixer|reporter|reporte|report(?:er)?|decaler|reprogrammer|creneau|slot)\b/;
    // Soft : contexte commercial — dates relatives claires seulement
    const SOFT_TRIGGER_RE =
        /\b(?:voir|voit|vu|callback|follow[\s-]?up|revenir|revient|rappelle|rappellerai|rappelerai|a\s+rappeler|me\s+rappeler|te\s+rappeler|a\s+relancer|on\s+se\s+(?:voit|rappelle|appelle)|dispo(?:nible)?)\b/;
    // Négation : "pas dispo ce soir" ne doit pas créer un RDV
    const NEGATIVE_NEAR_RE = /\b(?:pas\s+(?:dispo(?:nible)?|la)|indispo(?:nible)?|absent|occupe)\b/;

    const hasStrongTrigger = STRONG_TRIGGER_RE.test(t);
    const hasSoftTrigger = SOFT_TRIGGER_RE.test(t) && !NEGATIVE_NEAR_RE.test(t);
    const hasTrigger = hasStrongTrigger || hasSoftTrigger;

    // priority : 4 = créneau du jour, 3 = demain/après-demain, 2 = explicite, 1 = faible
    const candidates = [];

    const addCandidate = (date, timeStr, priority) => {
        if (!date) return;
        const d = clone(date);
        const time = timeStr ? parseTime(timeStr) : null;
        if (time) {
            d.setHours(time.hours, time.minutes, 0, 0);
        } else {
            d.setHours(9, 0, 0, 0);
        }
        // Tolérance -2 min (horloge / saisie en cours)
        if (d.getTime() < refMs - 2 * 60 * 1000) return;
        candidates.push({ date: d, hasTime: !!time, priority });
    };

    // ── 0. Créneaux relatifs du jour (besoin d'un déclencheur) ───────────────
    if (hasTrigger) {
        if (/\bce\s+soir\b/.test(t)) {
            const d = clone(now);
            d.setHours(18, 0, 0, 0);
            if (d.getTime() > refMs) addCandidate(d, "18h", 4);
        }
        if (/\bce\s+matin\b/.test(t)) {
            const d = clone(now);
            d.setHours(10, 0, 0, 0);
            if (d.getTime() > refMs) addCandidate(d, "10h", 4);
            else addCandidate(addDays(now, 1), "10h", 2);
        }
        if (/\bcet?\s+apres[\s-]?midi\b/.test(t)) {
            const d = clone(now);
            d.setHours(15, 0, 0, 0);
            if (d.getTime() > refMs) addCandidate(d, "15h", 4);
            else addCandidate(addDays(now, 1), "15h", 2);
        }
    }

    // ── 1. Aujourd'hui — heure obligatoire ───────────────────────────────────
    const huiIdx = t.search(/\baujourd'?hui\b/);
    if (huiIdx !== -1) {
        const after = t.slice(huiIdx);
        const ts = extractTime(after.replace(/^aujourd'?hui/, ""));
        if (ts) addCandidate(clone(now), ts, 3);
    }

    // ── 2. Demain / après-demain ──────────────────────────────────────────────
    // Ignorer "apres-demain" quand on matche "demain"
    const demainRe = /\bdemain\b/g;
    let mD;
    while ((mD = demainRe.exec(t)) !== null) {
        const before = t.slice(Math.max(0, mD.index - 8), mD.index);
        if (/apres[\s-]?$/.test(before)) continue;
        addCandidate(addDays(now, 1), extractTime(t.slice(mD.index + mD[0].length)), 3);
    }
    const apresRe = /\bapres[\s-]?demain\b/g;
    let mAD;
    while ((mAD = apresRe.exec(t)) !== null) {
        addCandidate(addDays(now, 2), extractTime(t.slice(mAD.index + mAD[0].length)), 3);
    }

    // ── 3. "dans X jours/semaines" / "dans 2j" / "+Xj" ───────────────────────
    const dansRe = /\bdans\s+(\d+)\s*(jours?|semaines?|j|s)\b/g;
    let mDans;
    while ((mDans = dansRe.exec(t)) !== null) {
        const n = parseInt(mDans[1], 10);
        const unit = mDans[2];
        const days = /semaine|^s$/.test(unit) ? n * 7 : n;
        if (days > 0 && days <= 60) {
            // Priorité 3 : formulation relative claire, même sans « rappel »
            addCandidate(addDays(now, days), extractTime(t.slice(mDans.index + mDans[0].length)), 3);
        }
    }
    const plusJRe = /\+(\d+)j\b/g;
    let mPJ;
    while ((mPJ = plusJRe.exec(t)) !== null) {
        const n = parseInt(mPJ[1], 10);
        if (n > 0 && n <= 60) {
            addCandidate(addDays(now, n), extractTime(t.slice(mPJ.index + mPJ[0].length)), 3);
        }
    }

    // ── 4. Semaine prochaine / fin de semaine / cette semaine ─────────────────
    if (/\bsemaine\s+prochaine\b/.test(t)) {
        // Lundi de la semaine prochaine par défaut
        const target = nextWeekday(now, 1, true);
        const timeNear = extractTime(t.slice(t.search(/\bsemaine\s+prochaine\b/)));
        addCandidate(target, timeNear, 3);
    }
    if (/\bfin\s+de\s+semaine\b|\bce\s+week[\s-]?end\b/.test(t)) {
        const target = nextWeekday(now, 5, false); // vendredi
        const idx = t.search(/\bfin\s+de\s+semaine\b|\bce\s+week[\s-]?end\b/);
        addCandidate(target, extractTime(t.slice(idx)), 3);
    }
    if (/\bcette\s+semaine\b/.test(t) && hasTrigger) {
        // Prochain jour ouvré (demain si encore la semaine, sinon lundi prochain)
        const dow = now.getDay();
        const target = dow === 5 || dow === 6 || dow === 0
            ? nextWeekday(now, 1, true)
            : addDays(now, 1);
        addCandidate(target, extractTime(t.slice(t.search(/\bcette\s+semaine\b/))), 3);
    }

    // ── 5. Jour de semaine ────────────────────────────────────────────────────
    // Si une date explicite est collée (« lundi 3/08 », « mardi 12 aout »),
    // on laisse les sections 6/7 gérer — sinon « prochain lundi » écrase le 3/08.
    const EXPLICIT_DATE_NEAR_RE =
        /(?:le\s+)?\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|(?:le\s+)?\d{1,2}\s+(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|jan|fev|avr|juil|sep|sept|oct|nov|dec)/;
    const joursRe = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/g;
    let mJour;
    while ((mJour = joursRe.exec(t)) !== null) {
        const targetDay = DAYS_FR[mJour[1]];
        const before = t.slice(Math.max(0, mJour.index - 24), mJour.index);
        const afterJour = t.slice(mJour.index + mJour[0].length);
        if (EXPLICIT_DATE_NEAR_RE.test(afterJour.slice(0, 28))) continue;
        if (EXPLICIT_DATE_NEAR_RE.test(before)) continue;
        const isNext = /prochain/.test(afterJour.slice(0, 15)) || /\bprochain\b/.test(before);
        addCandidate(nextWeekday(now, targetDay, isNext), extractTime(afterJour), 2);
    }

    // ── 6. Date absolue : "20 juillet" ───────────────────────────────────────
    // Priorité haute : une date écrite bat un simple jour de semaine.
    const moisRe = /\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|jan|fev|avr|juil|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/g;
    let mMois;
    while ((mMois = moisRe.exec(t)) !== null) {
        const day = parseInt(mMois[1], 10);
        const month = MONTHS_FR[mMois[2]];
        const year = mMois[3] ? parseInt(mMois[3], 10) : now.getFullYear();
        if (month !== undefined && day >= 1 && day <= 31) {
            const d = new Date(year, month, day);
            if (d < now && !mMois[3]) d.setFullYear(year + 1);
            // Heure : regarder aussi un peu avant (« a 12h le 3 aout » rare) et après
            const timeStr = extractTime(t.slice(mMois.index + mMois[0].length))
                || extractTime(t.slice(Math.max(0, mMois.index - 12), mMois.index));
            addCandidate(d, timeStr, 5);
        }
    }

    // ── 7. Format numérique : "20/07", "20-07-2026", "3/08" ───────────────────
    const numRe = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g;
    let mNum;
    while ((mNum = numRe.exec(t)) !== null) {
        const day = parseInt(mNum[1], 10);
        const month = parseInt(mNum[2], 10) - 1;
        let year = now.getFullYear();
        if (mNum[3]) {
            year = parseInt(mNum[3], 10);
            if (year < 100) year += 2000;
        }
        if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
            const d = new Date(year, month, day);
            // Date invalide (31/02…) → getDate() diverge
            if (d.getMonth() !== month || d.getDate() !== day) continue;
            if (d < now && !mNum[3]) d.setFullYear(year + 1);
            // Si un jour de semaine précède (« lundi 3/08 ») et ne correspond pas,
            // on garde quand même la date écrite (plus fiable que le prochain lundi).
            const timeStr = extractTime(t.slice(mNum.index + mNum[0].length))
                || extractTime(t.slice(Math.max(0, mNum.index - 12), mNum.index));
            addCandidate(d, timeStr, 5);
        }
    }

    // ── 8. "le X" / "le Xème" — seulement avec déclencheur fort ──────────────
    if (hasStrongTrigger) {
        const leRe = /\ble\s+(\d{1,2})(?:er|eme|e)?\b/g;
        let mLe;
        while ((mLe = leRe.exec(t)) !== null) {
            // Éviter "le 01" d'un téléphone / code postal collé
            const around = t.slice(mLe.index, mLe.index + 12);
            if (/\ble\s+\d{5}\b/.test(around)) continue;
            const day = parseInt(mLe[1], 10);
            if (day >= 1 && day <= 31) {
                const d = new Date(now.getFullYear(), now.getMonth(), day);
                if (d.getTime() <= refMs) d.setMonth(d.getMonth() + 1);
                addCandidate(d, extractTime(t.slice(mLe.index + mLe[0].length)), 1);
            }
        }
    }

    // ── 9. Heure seule près d'un déclencheur fort → aujourd'hui (ou demain si passé)
    if (hasStrongTrigger) {
        const timeOnlyRe = /\b(?:a|vers|pour)\s+(\d{1,2}\s*h(?:eures?)?\s*\d{0,2}|\d{1,2}:\d{2})\b/gi;
        let mT;
        while ((mT = timeOnlyRe.exec(t)) !== null) {
            // Si déjà ancré à une date relative/absolue proche, skip (évite doublons faibles)
            const ctxBefore = t.slice(Math.max(0, mT.index - 25), mT.index);
            if (/\b(demain|apres[\s-]?demain|aujourd'?hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}[\/\-]\d{1,2})\b/.test(ctxBefore)) {
                continue;
            }
            const d = clone(now);
            const time = parseTime(mT[1]);
            if (!time) continue;
            d.setHours(time.hours, time.minutes, 0, 0);
            if (d.getTime() < refMs - 2 * 60 * 1000) {
                addCandidate(addDays(now, 1), mT[1], 2);
            } else {
                addCandidate(d, mT[1], 2);
            }
        }
    }

    if (candidates.length === 0) return null;

    const isExplicitDate =
        /\b\d{1,2}[\/\-]\d{1,2}\b/.test(t) ||
        /\b\d{1,2}\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|jan|fev|avr|juil|sep|sept|oct|nov|dec)\b/.test(t);

    // Règles de validation (complaisantes, sans sur-détecter le bruit) :
    // - déclencheur fort → tout candidat OK
    // - demain / créneau du jour → OK même sans trigger
    // - date explicite (20/07, 3 août) → OK même sans heure ni trigger
    // - jour + heure (« lundi 14h ») → OK
    // - soft trigger → priorités ≥ 2
    const valid = candidates.filter((c) => {
        if (hasStrongTrigger) return true;
        if (c.priority >= 3) return true; // demain, ce soir…
        if (c.priority >= 5) return true; // date écrite
        if (c.hasTime && c.priority >= 2) return true; // lundi 14h, dans 3j à 10h…
        if (isExplicitDate && (c.hasTime || hasSoftTrigger)) return true;
        if (hasSoftTrigger && c.priority >= 2) return true;
        return false;
    });

    if (valid.length === 0) return null;

    valid.sort((a, b) =>
        b.priority !== a.priority
            ? b.priority - a.priority
            : a.date.getTime() - b.date.getTime()
    );

    const best = valid[0];
    const date = best.date;

    const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");

    const isToday = date.toDateString() === now.toDateString();
    const isTomorrow = date.toDateString() === addDays(now, 1).toDateString();
    const dayLabel = isToday ? "Aujourd'hui"
        : isTomorrow ? "Demain"
        : `${dayNames[date.getDay()]} ${dd}/${mm}`;

    const label = best.hasTime
        ? `${dayLabel} \u00e0 ${hh}h${min !== "00" ? min : ""}`
        : dayLabel;

    return {
        iso: date.toISOString(),
        label,
        hasTime: best.hasTime,
    };
}
