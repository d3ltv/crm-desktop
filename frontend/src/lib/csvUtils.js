// Small, dependency-free CSV parser + column auto-detector.
// Handles: double-quoted fields, escaped quotes ("" -> "), commas & semicolons,
// CRLF / LF line endings. Not a full RFC 4180 parser, but robust for MVP.
import { resolveLogo } from "./logoUtils";

/**
 * Normalise un nom de colonne / valeur pour comparaison :
 * minuscules, sans accents, underscores/tirets → espaces, espaces compressés.
 * Exposée pour réutilisation (import profiles, doublons, skipExisting, etc.).
 */
export function normalizeHeader(str) {
    return (str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[_\-./]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Index d'un header dans une liste, comparaison normalisée (casse / accents / _-).
 * Retourne -1 si introuvable.
 */
export function findHeaderIndex(headers, target) {
    if (!target) return -1;
    const nt = normalizeHeader(target);
    return headers.findIndex((h) => normalizeHeader(h) === nt);
}

export function parseCsv(text) {
    if (!text) return { headers: [], rows: [] };
    // Strip BOM UTF-8 / UTF-16 LE often present in Excel exports
    let cleaned = text;
    if (cleaned.charCodeAt(0) === 0xfeff) cleaned = cleaned.slice(1);
    if (cleaned.startsWith("\u00ef\u00bb\u00bf")) cleaned = cleaned.slice(3);

    // Detect delimiter — comma or semicolon (most common in FR exports).
    const firstLine = cleaned.split(/\r?\n/)[0] || "";
    const delimiter =
        (firstLine.match(/;/g) || []).length >
        (firstLine.match(/,/g) || []).length
            ? ";"
            : ",";

    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;

    const pushField = () => {
        row.push(field);
        field = "";
    };
    const pushRow = () => {
        rows.push(row);
        row = [];
    };

    for (let i = 0; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (inQuotes) {
            if (c === '"') {
                if (cleaned[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === delimiter) {
                pushField();
            } else if (c === "\n") {
                pushField();
                pushRow();
            } else if (c === "\r") {
                // handled with \n
            } else {
                field += c;
            }
        }
    }
    // flush last field/row
    if (field.length > 0 || row.length > 0) {
        pushField();
        pushRow();
    }

    // First row = headers
    const headers = (rows.shift() || []).map((h) => (h || "").trim());
    // Filter empty rows
    const dataRows = rows
        .filter((r) => r.some((c) => (c || "").trim() !== ""))
        .map((r) => {
            // pad to headers length
            const padded = [...r];
            while (padded.length < headers.length) padded.push("");
            return padded.map((c) => (c ?? "").trim());
        });
    return { headers, rows: dataRows };
}

const FIELD_HINTS = {
    company: [
        // Français — exact et variantes courantes
        "entreprise", "société", "societe", "raison sociale", "raison_sociale",
        "nom entreprise", "nom_entreprise", "nom de l'entreprise",
        "nom société", "nom_societe", "nom_société",
        "organisation", "organisme",
        // Anglais — generique
        "company", "company name", "company_name", "companyname",
        "org", "organization", "organisation name", "account", "account name",
        "account_name", "business", "business name", "business_name", "firm",
        "employer", "workplace", "corp", "corporation",
        "enseigne", "brand", "marque",
    ],
    // email avant website : évite qu'un header "E-Mail" / "e mail" soit mangé
    // par des hints website trop larges (tokens "web", "site", …)
    email: [
        // Français
        "email", "e-mail", "mail", "courriel",
        "adresse email", "adresse_email", "adresse mail", "adresse_mail",
        "email professionnel", "email_professionnel",
        // Anglais
        "email address", "email_address", "emailaddress",
        "work email", "work_email", "professional email",
        "contact email", "e mail", "electronic mail",
    ],
    phone: [
        // Français
        "téléphone", "telephone", "téléphone fixe", "telephone fixe",
        "tél", "tel", "tél.", "tel.", "tél direct", "tel direct",
        "mobile", "portable", "numéro", "numero", "num", "n° tel", "num tel",
        "numéro de téléphone", "numero de telephone",
        "téléphone mobile", "telephone mobile",
        // Anglais
        "phone", "phone number", "phone_number", "phonenumber",
        "mobile phone", "mobile_phone", "cell", "cell phone", "cellular",
        "direct phone", "work phone", "office phone", "contact phone",
        "landline", "fax",
    ],
    contact: [
        // Français — prénom / nom seul
        "contact", "prénom", "prenom", "nom", "nom complet", "nom_complet",
        "personne", "interlocuteur", "interlocutrice",
        "prénom contact", "prenom_contact", "nom contact", "nom_contact",
        "responsable", "référent", "referent", "dirigeant",
        "gérant", "gerant", "daf", "drh",
        // Nom de famille seul — doit aussi mapper vers contact
        "last_name", "lastname", "last name", "nom de famille", "surname", "family name",
        // Anglais
        "full name", "full_name", "fullname", "contact name", "contact_name",
        "first name", "first_name",
        "person", "person name", "person_name",
        "lead name", "prospect name", "owner name", "owner",
        "rep", "representative",
    ],
    website: [
        // Français
        "site", "site web", "site_web", "siteweb", "site internet",
        "site_internet", "domaine", "url site", "adresse web", "web",
        // Anglais
        "website", "website url", "website_url", "web url", "web_url",
        "url", "homepage", "domain", "company url", "company_url",
        "company website", "company_website", "profile url", "profile_url",
        "linkedin url", "linkedin_url",
    ],
};

// Colonnes reconnues mais non mappées aux champs principaux →
// renommées en français dans les champs "extra" de la carte.
// Clé = pattern (lowercase / variantes), valeur = libellé français affiché.
export const HEADER_TRANSLATIONS = {
    // Identité contact
    "first_name":           "Prénom",
    "firstname":            "Prénom",
    "first name":           "Prénom",
    "prenom":               "Prénom",
    "last_name":            "Nom",
    "lastname":             "Nom",
    "last name":            "Nom",
    "nom":                  "Nom",
    "job_title":            "Poste",
    "jobtitle":             "Poste",
    "job title":            "Poste",
    "title":                "Titre",
    "position":             "Poste",
    "role":                 "Rôle",
    "fonction":             "Fonction",

    // Entreprise
    "sector":               "Secteur",
    "secteur":              "Secteur",
    "industry":             "Secteur",
    "industrie":            "Industrie",
    "size":                 "Taille",
    "taille":               "Taille",
    "employees":            "Effectif",
    "effectif":             "Effectif",
    "headcount":            "Effectif",
    "siren":                "SIREN",
    "siret":                "SIRET",
    "vat":                  "TVA",
    "tva":                  "TVA",

    // Localisation
    "location":             "Localisation",
    "localisation":         "Localisation",
    "adresse":              "Adresse",
    "address":              "Adresse",
    "city":                 "Ville",
    "ville":                "Ville",
    "zip":                  "Code postal",
    "postal_code":          "Code postal",
    "postal code":          "Code postal",
    "code postal":          "Code postal",
    "code_postal":          "Code postal",
    "cp":                   "Code postal",
    "country":              "Pays",
    "pays":                 "Pays",
    "region":               "Région",
    "région":               "Région",
    "département":          "Département",
    "departement":          "Département",

    // Réseaux sociaux
    "linkedin_contact":     "LinkedIn contact",
    "linkedin contact":     "LinkedIn contact",
    "linkedin_entreprise":  "LinkedIn entreprise",
    "linkedin entreprise":  "LinkedIn entreprise",
    "linkedin":             "LinkedIn",
    "linkedin_url":         "LinkedIn",
    "facebook_entreprise":  "Facebook",
    "facebook":             "Facebook",
    "twitter":              "Twitter",
    "twitter_entreprise":   "Twitter",
    "instagram":            "Instagram",
    "instagram_entreprise": "Instagram",

    // Scores / données enrichies
    "score":                "Score",
    "ai_score_boost":       "Score IA",
    "rating":               "Note",
    "priority":             "Priorité",
    "priorité":             "Priorité",

    // Divers
    "description":          "Description",
    "notes":                "Notes",
    "comment":              "Commentaire",
    "commentaire":          "Commentaire",
    "source":               "Source",
    "origine":              "Origine",
    "tags":                 "Tags",
    "status":               "Statut",
    "statut":               "Statut",
    "created_at":           "Créé le",
    "updated_at":           "Modifié le",
    "date":                 "Date",
};

/** Lookup HEADER_TRANSLATIONS avec normalisation (casse / accents / _-) */
const TRANSLATION_BY_NORM = (() => {
    const map = new Map();
    for (const [key, label] of Object.entries(HEADER_TRANSLATIONS)) {
        map.set(normalizeHeader(key), label);
    }
    return map;
})();

/** Résout le libellé FR d'un header CSV, insensible à la casse / accents / séparateurs */
export function translateHeader(header) {
    if (!header) return header;
    return TRANSLATION_BY_NORM.get(normalizeHeader(header)) || header;
}

const FIRST_NAME_HINTS = [
    "first name", "firstname", "first_name", "prenom", "prénom",
    "given name", "givenname",
];
const LAST_NAME_HINTS = [
    "last name", "lastname", "last_name", "nom de famille",
    "surname", "family name", "familyname",
];

/**
 * Détecte automatiquement le mapping champ CRM → colonne CSV.
 *
 * Deux passes :
 *  1. Par nom de colonne (4 niveaux : exact → mot entier → sous-chaîne → tokens)
 *  2. Par analyse des données réelles (scan des valeurs) pour les champs non trouvés
 *     - email  : colonne dont ≥50% des valeurs non vides contiennent "@"
 *     - phone  : colonne dont ≥50% des valeurs ressemblent à un numéro de téléphone
 *     - contact: colonnes first_name + last_name fusionnées si aucun contact trouvé
 */
export function autoDetectMapping(headers, rows = []) {
    const norm = normalizeHeader;

    const normalizedHeaders = headers.map(norm);
    const map   = {};
    const used  = new Set(); // indices de colonnes déjà attribués

    // ── Passe 1 : matching par nom de colonne ─────────────────────────────────
    for (const [field, hints] of Object.entries(FIELD_HINTS)) {
        const nh = hints.map(norm);

        // Score 1 — exact après normalisation
        let idx = normalizedHeaders.findIndex((h, i) => !used.has(i) && nh.includes(h));

        // Score 2 — hint présent comme mot entier dans le header
        if (idx === -1) {
            idx = normalizedHeaders.findIndex((h, i) => {
                if (used.has(i) || !h) return false;
                return nh.some((hint) => {
                    if (!hint) return false;
                    const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(h);
                });
            });
        }

        // Score 3 — sous-chaîne dans un sens ou l'autre (évite les matches trop courts)
        if (idx === -1) {
            idx = normalizedHeaders.findIndex((h, i) => {
                if (used.has(i) || !h) return false;
                return nh.some((hint) => {
                    if (!hint || hint.length < 2) return false;
                    // Évite de matcher "nom" dans n'importe quoi trop large sans garde-fou
                    if (hint.length <= 3) return h === hint;
                    return h.includes(hint) || (h.length >= 3 && hint.includes(h));
                });
            });
        }

        // Score 4 — tous les tokens du hint présents dans le header (égalité stricte
        // ou sous-chaîne uniquement si les deux tokens font ≥ 3 chars — évite
        // que "e" de "e mail" matche dans "site" / "web")
        if (idx === -1) {
            idx = normalizedHeaders.findIndex((h, i) => {
                if (used.has(i) || !h) return false;
                const hTokens = h.split(" ").filter(Boolean);
                return nh.some((hint) => {
                    const hintTokens = hint.split(" ").filter(Boolean);
                    return hintTokens.length > 1 &&
                        hintTokens.every((t) =>
                            hTokens.some((ht) => {
                                if (t === ht) return true;
                                if (t.length >= 3 && ht.length >= 3) {
                                    return ht.includes(t) || t.includes(ht);
                                }
                                return false;
                            })
                        );
                });
            });
        }

        if (idx !== -1) {
            map[field] = headers[idx];
            used.add(idx);
        }
    }

    // ── Passe 2 : détection par analyse des données réelles ───────────────────
    if (rows.length > 0) {
        const SAMPLE = Math.min(rows.length, 20); // scanner les 20 premières lignes
        const sampleRows = rows.slice(0, SAMPLE);

        headers.forEach((h, colIdx) => {
            if (!h || used.has(colIdx)) return;

            // Valeurs non vides de cette colonne dans l'échantillon
            const values = sampleRows
                .map((r) => (r[colIdx] || "").trim())
                .filter(Boolean);
            if (values.length === 0) return;

            // ── Email : ≥50% des valeurs contiennent "@" ──────────────────────
            if (!map.email) {
                const emailCount = values.filter((v) => v.includes("@")).length;
                if (emailCount / values.length >= 0.5) {
                    map.email = h;
                    used.add(colIdx);
                    return;
                }
            }

            // ── Téléphone : ≥50% ressemblent à un numéro ─────────────────────
            // Accepte : +33..., 06..., 07..., chiffres avec espaces/tirets/points
            if (!map.phone) {
                const phoneRe = /^(\+?\d[\d\s.\-()]{6,})$/;
                const phoneCount = values.filter((v) => phoneRe.test(v.replace(/\s/g, " "))).length;
                if (phoneCount / values.length >= 0.5) {
                    map.phone = h;
                    used.add(colIdx);
                    return;
                }
            }
        });
    }

    // ── Passe 3 : fallback company sur la première colonne non utilisée ───────
    if (!map.company && headers.length > 0) {
        const fi = headers.findIndex((h, i) => h && !used.has(i));
        if (fi !== -1) {
            map.company = headers[fi];
            used.add(fi);
        }
    }

    return map;
}

// ── Colonnes CRM réservées (export CRM → réimport fidèle) ─────────────────────
// Ces headers ne doivent JAMAIS atterrir dans `extra` lors d'un réimport.
export const CRM_RESERVED_HEADERS = [
    "company", "contact", "phone", "email", "website",
    "status", "tags", "next_action", "last_contact", "notes",
    "deal_value", "logo_url", "crm_meta",
];

/** Alias FR/EN acceptés pour chaque champ CRM réservé */
const RESERVED_ALIASES = {
    company:      ["company", "entreprise", "societe", "company name"],
    contact:      ["contact", "contact name", "full name", "nom complet"],
    phone:        ["phone", "telephone", "tel", "mobile"],
    email:        ["email", "e mail", "mail", "courriel"],
    website:      ["website", "site web", "site", "url"],
    status:       ["status", "statut"],
    tags:         ["tags", "tag", "etiquettes", "labels"],
    next_action:  ["next action", "next_action", "prochaine action", "prochaine_action"],
    last_contact: ["last contact", "last_contact", "dernier contact"],
    notes:        ["notes", "note"],
    deal_value:   ["deal value", "deal_value", "valeur du deal", "dealvalue"],
    logo_url:     ["logo url", "logo_url", "logo"],
    crm_meta:     ["crm meta", "crm_meta", "crmmeta", "_crm_meta"],
};

const RESERVED_NORM_SET = new Set(
    Object.values(RESERVED_ALIASES).flat().map(normalizeHeader)
);

function isReservedHeader(header) {
    return RESERVED_NORM_SET.has(normalizeHeader(header));
}

/** Trouve l'index d'un champ réservé via mapping utilisateur OU alias auto.
 *  Respecte le choix utilisateur : `__none__` / `__extra__` → ne pas utiliser la colonne. */
function findReservedIndex(headers, mapping, fieldKey, colMapping = {}) {
    const targetOf = (h) => {
        if (!h) return undefined;
        if (colMapping[h] !== undefined) return colMapping[h];
        const nh = normalizeHeader(h);
        const key = Object.keys(colMapping).find((k) => normalizeHeader(k) === nh);
        return key != null ? colMapping[key] : undefined;
    };
    const usable = (h) => {
        const t = targetOf(h);
        // Ignoré ou forcé en Extra → ne pas alimenter le champ CRM réservé
        if (t === "__none__" || t === "__extra__") return false;
        // Mappé explicitement vers un AUTRE champ CRM → skip
        if (t && t !== fieldKey && t !== "__none__" && t !== "__extra__") return false;
        return true;
    };

    const fromMap = mapping?.[fieldKey];
    if (fromMap) {
        const i = findHeaderIndex(headers, fromMap);
        if (i >= 0 && usable(headers[i])) return i;
        // Mapping présent mais colonne ignorée/extra → ne pas fallback alias
        if (i >= 0) return -1;
    }
    const aliases = (RESERVED_ALIASES[fieldKey] || [fieldKey]).map(normalizeHeader);
    return headers.findIndex((h) => aliases.includes(normalizeHeader(h)) && usable(h));
}

/** Encode nextAction en chaîne réimportable : date||label||flags||dueAt */
export function encodeNextAction(na) {
    if (!na || typeof na !== "object") return "";
    const flags = [
        na.auto ? "auto" : null,
        na.meeting ? "meeting" : null,
        na.stage != null && na.stage !== "" ? `stage:${na.stage}` : null,
    ].filter(Boolean).join(",");
    return [na.date || "", na.label || "", flags, na.dueAt || ""].join("||");
}

/** Parse next_action (format || ou legacy "date label") */
export function parseNextAction(raw) {
    const s = (raw || "").trim();
    if (!s) return null;
    if (s.includes("||")) {
        const [date = "", label = "", flags = "", dueAt = ""] = s.split("||");
        if (!date && !label) return null;
        const auto = /\bauto\b/.test(flags);
        const meeting = /\bmeeting\b/.test(flags);
        const stageMatch = flags.match(/stage:([^\s,]+)/);
        const na = {
            date: date.trim() || null,
            label: label.trim() || "",
            auto: !!auto,
            meeting: !!meeting,
        };
        if (dueAt.trim()) na.dueAt = dueAt.trim();
        else if (na.date) na.dueAt = na.date.includes("T") ? na.date : `${na.date}T09:00:00`;
        if (stageMatch) na.stage = Number.isFinite(+stageMatch[1]) ? +stageMatch[1] : stageMatch[1];
        return na;
    }
    // Legacy : "YYYY-MM-DD label…" ou juste un label
    const m = s.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
    if (m) {
        return {
            date: m[1],
            dueAt: `${m[1]}T09:00:00`,
            label: (m[2] || "").trim(),
            auto: false,
            meeting: /rdv/i.test(m[2] || ""),
        };
    }
    return { date: null, dueAt: null, label: s, auto: false, meeting: /rdv/i.test(s) };
}

/** Encode notes : textes séparés par " | " (lisible Excel) */
function encodeNotesText(notes) {
    return (notes || []).map((n) => (typeof n === "string" ? n : n?.text || "")).filter(Boolean).join(" | ");
}

/** Parse notes texte → [{ text }] ; timestamps viennent de crm_meta si dispo */
function parseNotesText(raw) {
    const s = (raw || "").trim();
    if (!s) return [];
    return s.split(/\s\|\s/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text }));
}

function parseTags(raw) {
    const s = (raw || "").trim();
    if (!s) return [];
    return s.split("|").map((t) => t.trim()).filter(Boolean);
}

function parseDealValue(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
}

function parseCrmMeta(raw) {
    const s = (raw || "").trim();
    if (!s) return null;
    try {
        const obj = JSON.parse(s);
        return obj && typeof obj === "object" ? obj : null;
    } catch {
        return null;
    }
}

/** Construit le blob crm_meta pour un lead (fidélité totale au réimport) */
export function buildCrmMeta(lead) {
    const meta = { v: 1 };
    if (lead.nextAction) meta.nextAction = lead.nextAction;
    if (lead.notes?.length) {
        meta.notes = lead.notes.map((n) => ({
            text: n.text || "",
            ...(n.at ? { at: n.at } : {}),
        }));
    }
    if (lead.customFields?.length) {
        meta.customFields = lead.customFields.map((cf) => ({
            label: cf.label,
            value: cf.value ?? "",
            ...(cf.highlight ? { highlight: true } : {}),
            ...(cf.pinned ? { pinned: true } : {}),
        }));
    }
    if (lead.logoUrl) meta.logoUrl = lead.logoUrl;
    if (lead.logoUrlManual) meta.logoUrlManual = true;
    if (lead.createdAt) meta.createdAt = lead.createdAt;
    if (lead.archived) meta.archived = true;
    if (lead.relances?.length) meta.relances = lead.relances;
    if (lead.autoFollowup) meta.autoFollowup = lead.autoFollowup;
    if (lead.tags?.length) meta.tags = lead.tags;
    if (lead.dealValue != null && lead.dealValue !== "") meta.dealValue = lead.dealValue;
    if (lead.lastContact) meta.lastContact = lead.lastContact;
    if (lead._statusName) meta.status = lead._statusName;
    return meta;
}

/**
 * Résout un nom de colonne Kanban → columnId du workspace (casse/accents ignorés).
 * Retourne null si introuvable.
 */
export function resolveColumnIdByName(workspace, statusName) {
    if (!workspace || !statusName) return null;
    const target = normalizeHeader(statusName);
    if (!target) return null;
    const cols = workspace.columns || {};
    for (const id of workspace.columnOrder || Object.keys(cols)) {
        const col = cols[id];
        if (col && normalizeHeader(col.name) === target) return id;
    }
    // Fallback : match partiel (ex. "Contacté" vs "Contacte")
    for (const id of workspace.columnOrder || Object.keys(cols)) {
        const col = cols[id];
        if (!col?.name) continue;
        const n = normalizeHeader(col.name);
        if (n.includes(target) || target.includes(n)) return id;
    }
    return null;
}

export function rowsToLeads(headers, rows, mapping, colMapping = {}, nameHeader = null) {
    const idx = (fieldKey) => findReservedIndex(headers, mapping, fieldKey, colMapping);
    const iCompany     = idx("company");
    const iPhone       = idx("phone");
    const iWeb         = idx("website");
    const iEmail       = idx("email");
    const iContact     = idx("contact");
    const iStatus      = idx("status");
    const iTags        = idx("tags");
    const iNextAction  = idx("next_action");
    const iLastContact = idx("last_contact");
    const iNotes       = idx("notes");
    const iDeal        = idx("deal_value");
    const iLogo        = idx("logo_url");
    const iMeta        = idx("crm_meta");

    const iNameOverride = findHeaderIndex(headers, nameHeader);

    const normalizedHeaders = headers.map(normalizeHeader);
    const firstHints = FIRST_NAME_HINTS.map(normalizeHeader);
    const lastHints  = LAST_NAME_HINTS.map(normalizeHeader);
    const iFirstName = normalizedHeaders.findIndex((h) => firstHints.includes(h));
    const iLastName  = normalizedHeaders.findIndex((h) => lastHints.includes(h));

    const reservedIndices = new Set(
        [iCompany, iPhone, iWeb, iEmail, iContact, iStatus, iTags,
         iNextAction, iLastContact, iNotes, iDeal, iLogo, iMeta,
         iNameOverride]
            .filter((i) => i >= 0)
    );
    const mergedContact = iContact === -1 && (iFirstName >= 0 || iLastName >= 0);
    if (mergedContact) {
        if (iFirstName >= 0) reservedIndices.add(iFirstName);
        if (iLastName  >= 0) reservedIndices.add(iLastName);
    }

    const ignoredNorm = new Set(
        Object.entries(colMapping)
            .filter(([, v]) => v === "__none__")
            .map(([h]) => normalizeHeader(h))
    );

    // Mapping utilisateur : header → champ CRM (hors company/contact/…)
    const headerToField = {};
    Object.entries(colMapping || {}).forEach(([h, target]) => {
        if (target && target !== "__none__" && target !== "__extra__") {
            headerToField[normalizeHeader(h)] = target;
        }
    });

    // Champs CRM que l'utilisateur a explicitement déclinés (Ignorer / Extra sur la colonne source)
    // → le fallback ne doit pas les récupérer depuis extra
    const declinedFields = new Set();
    headers.forEach((h) => {
        if (!h) return;
        const t = colMapping[h];
        const tNorm = t !== undefined ? t : (() => {
            const nh = normalizeHeader(h);
            const key = Object.keys(colMapping).find((k) => normalizeHeader(k) === nh);
            return key != null ? colMapping[key] : undefined;
        })();
        if (tNorm !== "__none__" && tNorm !== "__extra__") return;
        for (const [field, aliases] of Object.entries(RESERVED_ALIASES)) {
            if (aliases.map(normalizeHeader).includes(normalizeHeader(h))) {
                declinedFields.add(field);
            }
        }
    });

    return rows.map((r) => {
        const companyFromMapping = (iCompany >= 0 ? r[iCompany] : "").trim();
        const companyFromOverride = (iNameOverride >= 0 ? r[iNameOverride] : "").trim();
        const company = companyFromOverride || companyFromMapping;

        let contactValue = iContact >= 0 ? (r[iContact] || "").trim() : "";
        if (!contactValue && mergedContact) {
            const first = iFirstName >= 0 ? (r[iFirstName] || "").trim() : "";
            const last  = iLastName  >= 0 ? (r[iLastName]  || "").trim() : "";
            contactValue = [first, last].filter(Boolean).join(" ");
        }

        // Meta CRM (export natif) — source de vérité pour structures complexes
        const meta = iMeta >= 0 ? parseCrmMeta(r[iMeta]) : null;

        // Labels custom connus via meta → ne pas les mettre en extra
        const customLabelNorms = new Set(
            (meta?.customFields || []).map((cf) => normalizeHeader(cf.label))
        );

        const extra = {};
        headers.forEach((h, i) => {
            if (reservedIndices.has(i) || !h) return;
            if (ignoredNorm.has(normalizeHeader(h))) return;
            const nh = normalizeHeader(h);
            // Colonne déjà mappée vers un champ CRM principal → skip
            if (headerToField[nh] && CRM_RESERVED_HEADERS.includes(headerToField[nh])) return;
            if (customLabelNorms.has(nh) || customLabelNorms.has(normalizeHeader(translateHeader(h)))) return;
            const v = (r[i] || "").trim();
            if (!v) return;
            const label = translateHeader(h);
            if (!extra[label]) extra[label] = v;
        });

        const FIELD_EXTRA_FALLBACKS = {
            phone:   ["telephone", "tel", "mobile", "portable", "numero", "num tel", "phone", "phone number", "cell"],
            email:   ["email", "mail", "e mail", "courriel", "adresse mail", "adresse email", "email address"],
            website: ["site", "site web", "siteweb", "website", "url", "domaine", "site internet", "homepage", "web"],
            company: ["societe", "entreprise", "organisation", "company", "raison sociale", "enseigne", "account"],
            contact: ["contact", "prenom", "nom contact", "full name", "fullname", "personne", "interlocuteur", "nom complet"],
        };

        let phone   = iPhone  >= 0 ? (r[iPhone]  || "").trim() : "";
        let website = iWeb    >= 0 ? (r[iWeb]    || "").trim() : "";
        let email   = iEmail  >= 0 ? (r[iEmail]  || "").trim() : "";
        let contact = contactValue;
        let companyFinal = company;

        for (const [field, patterns] of Object.entries(FIELD_EXTRA_FALLBACKS)) {
            if (declinedFields.has(field)) continue; // choix utilisateur : Extra / Ignorer
            const currentVal = field === "phone" ? phone
                : field === "email" ? email
                : field === "website" ? website
                : field === "contact" ? contact
                : companyFinal;
            if (currentVal) continue;
            const matchKey = Object.keys(extra).find((k) => {
                const nk = normalizeHeader(k);
                return patterns.some((p) => {
                    const np = normalizeHeader(p);
                    return nk === np || (np.length >= 3 && nk.includes(np));
                });
            });
            if (matchKey && extra[matchKey]) {
                const val = extra[matchKey];
                if (field === "phone")   { phone = val; delete extra[matchKey]; }
                if (field === "email")   { email = val; delete extra[matchKey]; }
                if (field === "website") { website = val; delete extra[matchKey]; }
                if (field === "contact") { contact = val; delete extra[matchKey]; }
                if (field === "company") { companyFinal = val; delete extra[matchKey]; }
            }
        }

        // ── Champs CRM riches (colonnes export + crm_meta) ────────────────────
        const statusName = (iStatus >= 0 ? (r[iStatus] || "").trim() : "") || meta?.status || null;

        let tags = iTags >= 0 ? parseTags(r[iTags]) : [];
        if (!tags.length && meta?.tags?.length) tags = [...meta.tags];

        let notes = iNotes >= 0 ? parseNotesText(r[iNotes]) : [];
        if (meta?.notes?.length) {
            // Fusion : textes colonne + timestamps / structure meta
            const byText = new Map(meta.notes.map((n) => [n.text, n]));
            if (notes.length) {
                notes = notes.map((n) => {
                    const m = byText.get(n.text);
                    return m ? { text: n.text, ...(m.at ? { at: m.at } : {}) } : n;
                });
            } else {
                notes = meta.notes.map((n) => ({ text: n.text || "", ...(n.at ? { at: n.at } : {}) }));
            }
        }

        let nextAction = iNextAction >= 0 ? parseNextAction(r[iNextAction]) : null;
        if (meta?.nextAction && typeof meta.nextAction === "object") {
            nextAction = meta.nextAction; // objet complet prioritaire
        }

        let lastContact = (iLastContact >= 0 ? (r[iLastContact] || "").trim() : "") || meta?.lastContact || null;
        if (!lastContact) lastContact = null;

        let dealValue = iDeal >= 0 ? parseDealValue(r[iDeal]) : null;
        if (dealValue == null && meta?.dealValue != null) dealValue = meta.dealValue;

        let customFields = [];
        if (meta?.customFields?.length) {
            customFields = meta.customFields.map((cf) => ({
                label: cf.label,
                value: cf.value ?? "",
                ...(cf.highlight ? { highlight: true } : {}),
                ...(cf.pinned ? { pinned: true } : {}),
            }));
            // Enrichir valeurs depuis colonnes homonymes si meta vide
            customFields = customFields.map((cf) => {
                if (cf.value) return cf;
                const ci = findHeaderIndex(headers, cf.label);
                if (ci >= 0 && (r[ci] || "").trim()) return { ...cf, value: r[ci].trim() };
                return cf;
            });
        }

        let logoUrl = (iLogo >= 0 ? (r[iLogo] || "").trim() : "") || meta?.logoUrl || "";
        const logoUrlManual = !!(meta?.logoUrlManual || (logoUrl && meta?.logoUrl));
        if (!logoUrl) {
            logoUrl = resolveLogo({ website, email, extra }) || "";
        }

        return {
            company: companyFinal || "Sans nom — à compléter",
            phone,
            website,
            email,
            contact,
            tags,
            notes,
            nextAction,
            lastContact,
            dealValue,
            extra,
            customFields,
            logoUrl: logoUrl || null,
            logoUrlManual,
            _statusName: statusName,
            createdAt: meta?.createdAt || null,
            archived: !!meta?.archived,
            relances: meta?.relances || undefined,
            autoFollowup: meta?.autoFollowup || undefined,
            _incomplete: !companyFinal,
        };
    });
}

/**
 * Exporte tous les leads en CSV round-tripable.
 * Colonnes CRM lisibles + `crm_meta` (JSON) pour notes/actions/highlights/logo/etc.
 */
export function leadsToCsv(leads) {
    const baseHeaders = [
        "company",
        "contact",
        "phone",
        "email",
        "website",
        "status",
        "tags",
        "next_action",
        "last_contact",
        "notes",
        "deal_value",
        "logo_url",
        "crm_meta",
    ];

    const extraKeys = [];
    const seenExtra = new Set();
    const customKeys = [];
    const seenCustom = new Set();

    for (const l of leads) {
        if (l?.extra && typeof l.extra === "object") {
            for (const key of Object.keys(l.extra)) {
                const nk = normalizeHeader(key);
                if (!nk || seenExtra.has(nk)) continue;
                if (baseHeaders.some((bh) => normalizeHeader(bh) === nk)) continue;
                if (isReservedHeader(key)) continue;
                seenExtra.add(nk);
                extraKeys.push(key);
            }
        }
        for (const cf of l?.customFields || []) {
            const label = (cf?.label || "").trim();
            if (!label) continue;
            const nk = normalizeHeader(label);
            if (seenCustom.has(nk) || seenExtra.has(nk)) continue;
            if (baseHeaders.some((bh) => normalizeHeader(bh) === nk)) continue;
            if (isReservedHeader(label)) continue;
            seenCustom.add(nk);
            customKeys.push(label);
        }
    }

    const headers = [...baseHeaders, ...extraKeys, ...customKeys];

    const escape = (v) => {
        const s = String(v ?? "");
        if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const getExtra = (l, key) => {
        if (!l?.extra) return "";
        if (l.extra[key] != null && l.extra[key] !== "") return l.extra[key];
        const nk = normalizeHeader(key);
        const match = Object.keys(l.extra).find((k) => normalizeHeader(k) === nk);
        return match != null ? (l.extra[match] ?? "") : "";
    };

    const getCustom = (l, label) => {
        const nl = normalizeHeader(label);
        const cf = (l?.customFields || []).find((f) => normalizeHeader(f.label) === nl);
        return cf?.value ?? "";
    };

    const lines = [headers.join(",")];
    for (const l of leads) {
        const meta = buildCrmMeta(l);
        const base = [
            l.company,
            l.contact || "",
            l.phone || "",
            l.email || "",
            l.website || "",
            l._statusName || "",
            (l.tags || []).join("|"),
            encodeNextAction(l.nextAction),
            l.lastContact || "",
            encodeNotesText(l.notes),
            l.dealValue != null && l.dealValue !== "" ? l.dealValue : "",
            l.logoUrl || "",
            JSON.stringify(meta),
        ];
        const extras = extraKeys.map((k) => getExtra(l, k));
        const customs = customKeys.map((k) => getCustom(l, k));
        lines.push([...base, ...extras, ...customs].map(escape).join(","));
    }
    return lines.join("\n");
}
