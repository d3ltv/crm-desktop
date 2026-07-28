// Small date/time helpers — French, concise, no external lib.

/**
 * Clé calendaire locale YYYY-MM-DD (évite le décalage UTC de toISOString().slice).
 * @param {Date | string | number | null | undefined} value
 * @returns {string}
 */
export function toLocalDateKey(value) {
    if (value == null || value === "") return "";
    // Déjà une clé date pure
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function formatShortDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month} ${hh}:${mm}`;
}

export function formatRelative(iso) {
    if (!iso) return "";
    const now = new Date();
    const d = new Date(iso);
    const diffMs = now - d;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `il y a ${days} j`;
    return d.toLocaleDateString("fr-FR");
}

/**
 * Décale samedi → lundi et dimanche → lundi (jamais de rappel / RDV le week-end).
 * @param {Date} date
 * @returns {Date}
 */
export function ensureWeekday(date) {
    const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    if (Number.isNaN(d.getTime())) return d;
    const wd = d.getDay();
    if (wd === 6) d.setDate(d.getDate() + 2); // samedi → lundi
    else if (wd === 0) d.setDate(d.getDate() + 1); // dimanche → lundi
    return d;
}

/** True si la date locale tombe un dimanche. */
export function isSunday(value) {
    const d = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(d.getTime()) && d.getDay() === 0;
}

/**
 * Ajoute N jours calendaires, puis décale samedi → lundi et dimanche → lundi.
 * (Les relances commerciales se font rarement le week-end.)
 * @param {number} days
 * @param {Date} [from]
 * @returns {Date}
 */
export function addDaysSkippingWeekend(days, from = new Date()) {
    const n = Math.max(0, Math.floor(Number(days) || 0));
    const d = new Date(from);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return ensureWeekday(d);
}

/** @param {number} days @param {Date} [from] @returns {string} ISO */
export function addDaysSkippingWeekendIso(days, from = new Date()) {
    return addDaysSkippingWeekend(days, from).toISOString();
}

/**
 * Libellé relatif futur FR : « demain », « dans 2 jours »…
 * @param {Date | string | number} isoOrDate
 * @returns {string}
 */
export function formatFutureRelativeFr(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return "";
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const startTarget = new Date(d);
    startTarget.setHours(0, 0, 0, 0);
    const diffDays = Math.round((startTarget - startToday) / 86400000);
    if (diffDays <= 0) return "aujourd'hui";
    if (diffDays === 1) return "demain";
    return `dans ${diffDays} jours`;
}

/**
 * Plus petit décalage J+n (1–7) qui tombe un jour de semaine donné (0=dim…6=sam).
 * Ignore samedi/dimanche comme cibles (retourne le 1er jour ouvré utile).
 * @param {number} targetDow
 * @param {Date} [from]
 * @returns {number}
 */
export function daysUntilWeekday(targetDow, from = new Date()) {
    const target = Number(targetDow);
    if (!Number.isFinite(target) || target < 1 || target > 5) {
        return 2;
    }
    for (let n = 1; n <= 7; n += 1) {
        if (addDaysSkippingWeekend(n, from).getDay() === target) return n;
    }
    return 2;
}

export function formatDateTimeLong(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * Prochain rappel après un « pas de réponse » :
 * - matin (avant 12h) en semaine → cet après-midi (heure préférée ou 14h30)
 * - vendredi après-midi / soir → lundi (heure préférée ou 9h)
 * - sinon → +1 jour ouvré, heure préférée ou 9h
 * @param {Date} [from]
 * @param {{ preferredHour?: number|null }} [opts]
 * @returns {Date}
 */
export function suggestNoAnswerFollowUp(from = new Date(), opts = {}) {
    const now = from instanceof Date ? new Date(from.getTime()) : new Date(from);
    if (Number.isNaN(now.getTime())) return addDaysSkippingWeekend(1);
    const hour = now.getHours();
    const dow = now.getDay(); // 0=dim … 5=ven
    const isMorning = hour < 12;
    const pref = Number.isFinite(opts.preferredHour)
        ? Math.min(18, Math.max(8, Math.round(opts.preferredHour)))
        : null;
    const afternoonH = pref != null && pref >= 13 ? pref : 14;
    const morningH = pref != null && pref < 13 ? pref : (pref != null ? Math.min(pref, 11) : 9);

    // Matin en semaine → rappel l'après-midi du même jour
    if (isMorning && dow >= 1 && dow <= 5) {
        const afternoon = new Date(now);
        afternoon.setHours(afternoonH, pref != null && pref >= 13 ? 0 : 30, 0, 0);
        if (afternoon.getTime() > now.getTime()) return afternoon;
    }

    // Vendredi après-midi / soir → lundi matin
    if (dow === 5) {
        const monday = new Date(now);
        monday.setDate(monday.getDate() + 3);
        monday.setHours(morningH, 0, 0, 0);
        return monday;
    }

    // Max +1 jour ouvré, matin / heure préférée
    const next = addDaysSkippingWeekend(1, now);
    next.setHours(morningH, 0, 0, 0);
    return next;
}

/**
 * Libellé court pour le rappel « pas de réponse ».
 * @param {Date | string | number} [isoOrDate]
 * @param {Date} [from]
 * @returns {string}
 */
export function formatNoAnswerFollowUpLabel(isoOrDate, from = new Date()) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate ?? suggestNoAnswerFollowUp(from));
    if (Number.isNaN(d.getTime())) return "";
    const now = from instanceof Date ? from : new Date(from);
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const todayKey = toLocalDateKey(now);
    const dueKey = toLocalDateKey(d);
    if (dueKey === todayKey) return `cet après-midi · ${time}`;
    if (now.getDay() === 5 && d.getDay() === 1) return `lundi matin · ${time}`;
    const rel = formatFutureRelativeFr(d);
    if (rel === "demain") return `demain matin · ${time}`;
    return `${rel} · ${time}`;
}
