import React, { useState, memo } from "react";
import {
    CalendarClock,
    CalendarCheck,
    Clock,
    BellRing,
    AlertTriangle,
    X,
    Trophy,
    ArrowRightLeft,
    ChevronRight,
    Copy,
    Check,
    ExternalLink,
    Star,
    CheckCircle2,
    MessageSquare,
    Mic,
} from "lucide-react";
import { getColumnColor } from "@/lib/columnColors";
import { formatShortDateTime } from "@/lib/dateUtils";
import { useCrm } from "@/context/CrmContext";
import { DEFAULT_CARD_FIELDS } from "@/context/CrmContext";
import { toast } from "sonner";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LeadAvatar } from "./LeadAvatar";
import { isContactedColumn } from "@/constants/columnPatterns";
import { isManualRdv } from "@/lib/nextActionUtils";
import {
    topCardInconsistency,
    countCriticalInconsistencies,
    detectInconsistencies,
} from "@/lib/inconsistencyRules";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { AgencySuspectBadge, AGENCY_NAME_CLS } from "./AgencySuspectBadge";

/* ── Tag colors ───────────────────────────────────────────────── */
const TAG_HUES = [
    { bg: "bg-blue-100 dark:bg-blue-900/40",    text: "text-blue-700 dark:text-blue-300"    },
    { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
    { bg: "bg-amber-100 dark:bg-amber-900/40",  text: "text-amber-700 dark:text-amber-300"  },
    { bg: "bg-rose-100 dark:bg-rose-900/40",    text: "text-rose-700 dark:text-rose-300"    },
    { bg: "bg-violet-100 dark:bg-violet-900/40",text: "text-violet-700 dark:text-violet-300"},
    { bg: "bg-teal-100 dark:bg-teal-900/40",    text: "text-teal-700 dark:text-teal-300"    },
];
function hashHue(str = "") {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
    return TAG_HUES[Math.abs(h) % TAG_HUES.length];
}

/* ── Visible fields ───────────────────────────────────────────── */
function buildVisibleSet(cardFields) {
    const saved = cardFields && cardFields.length > 0 ? cardFields : [];
    const savedMap = new Map(saved.map((f) => [f.key, f]));
    const merged = DEFAULT_CARD_FIELDS.map((def) =>
        savedMap.has(def.key) ? savedMap.get(def.key) : def
    );
    saved.forEach((f) => {
        if ((f.key.startsWith("extra:") || f.key.startsWith("cf:")) && !merged.find((m) => m.key === f.key))
            merged.push(f);
    });
    return new Set(merged.filter((f) => f.visible).map((f) => f.key));
}
const _vsCache = new WeakMap();
function getVisibleSet(cardFields) {
    if (!cardFields) return buildVisibleSet([]);
    if (_vsCache.has(cardFields)) return _vsCache.get(cardFields);
    const r = buildVisibleSet(cardFields);
    _vsCache.set(cardFields, r);
    return r;
}

/* ── Copy button (inline, appears on hover) ───────────────────── */
const CopyBtn = ({ value }) => {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(String(value).trim()).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Copier"
            className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors ml-1 opacity-0 group-hover/row:opacity-100 ${
                copied ? "text-emerald-500" : "text-muted-foreground/50 hover:text-muted-foreground"
            }`}
        >
            {copied ? <Check size={10} strokeWidth={2.5} /> : <Copy size={10} strokeWidth={1.75} />}
        </button>
    );
};

/* ── External link (inline, always visible for URLs) ──────────── */
const LinkBtn = ({ href, label }) => (
    <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        title={label}
        className="inline-flex items-center gap-0.5 text-primary hover:underline font-normal"
    >
        {label}
        <ExternalLink size={9} strokeWidth={2} className="ml-0.5 opacity-60 shrink-0" />
    </a>
);

/* ── Move-column popover ──────────────────────────────────────── */
const MoveColumnButton = ({ lead, workspace, currentColumnId, dispatch, onOpenChange }) => {
    const [open, setOpen] = useState(false);
    const otherColumns = workspace.columnOrder
        .filter((cid) => cid !== currentColumnId)
        .map((cid) => workspace.columns[cid])
        .filter(Boolean);
    const moveTo = (targetColumnId) => {
        const targetName = workspace.columns[targetColumnId]?.name ?? "";
        dispatch({ type: "MOVE_LEAD_ORDERED", workspaceId: workspace.id, leadId: lead.id, toColumnId: targetColumnId, toIndex: null });
        toast.success(`Déplacé vers « ${targetName} »`, { description: lead.company });
        setOpen(false);
        onOpenChange?.(false);
    };
    return (
        <Popover open={open} onOpenChange={(v) => { setOpen(v); onOpenChange?.(v); }}>
            <PopoverTrigger asChild>
                <button
                    data-testid={`quick-move-${lead.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Changer de colonne"
                    className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                >
                    <ArrowRightLeft size={13} strokeWidth={1.75} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-52 p-1.5 rounded-xl shadow-panel" onClick={(e) => e.stopPropagation()}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5">Changer de statut</p>
                <div className="px-2 py-1.5 mb-1 flex items-center gap-2 rounded-lg bg-muted/40">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${getColumnColor(workspace.columns[currentColumnId]).dot}`} aria-hidden />
                    <span className="flex-1 truncate text-[12px] text-muted-foreground">
                        Actuellement : <span className="font-medium text-foreground">{workspace.columns[currentColumnId]?.name}</span>
                    </span>
                </div>
                <div className="h-px bg-border my-1" />
                <div className="space-y-0.5">
                    {otherColumns.map((col) => (
                        <button key={col.id} data-testid={`move-to-${col.id}-${lead.id}`} onClick={() => moveTo(col.id)}
                            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] text-left hover:bg-muted/70 transition-colors group">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getColumnColor(col).dot}`} aria-hidden />
                            <span className="flex-1 truncate font-medium">{col.name}</span>
                            <ChevronRight size={13} className="shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
                        </button>
                    ))}
                    {otherColumns.length === 0 && <p className="text-[12px] text-muted-foreground/70 px-2 py-2 italic">Aucune autre colonne</p>}
                </div>
            </PopoverContent>
        </Popover>
    );
};

/* ── Format last contact ──────────────────────────────────────── */
/** Affiche la note ; si enregistrement audio → micro à côté de « Joint » / « Pas de réponse ». */
function NoteTextWithAudio({ note }) {
    const text = note?.text || "";
    const hasAudio = !!note?.recordingId;
    if (!hasAudio) return text;

    const mic = (
        <Mic
            size={11}
            strokeWidth={2.25}
            className="inline-block ml-0.5 -mt-0.5 text-primary shrink-0"
            aria-label="Appel enregistré"
        />
    );

    const parts = text.split(/(Joint|Pas de réponse)/i);
    if (parts.length === 1) {
        return (
            <>
                {text}
                {mic}
            </>
        );
    }

    return (
        <>
            {parts.map((part, i) => {
                if (/^(Joint|Pas de réponse)$/i.test(part)) {
                    return (
                        <span key={i} className="inline">
                            {part}
                            {mic}
                        </span>
                    );
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </>
    );
}

function formatLastContact(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const t = `${String(d.getHours()).padStart(2,"0")}h${String(d.getMinutes()).padStart(2,"0")}`;
    const yest = new Date(now); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return `ajd à ${t}`;
    if (d.toDateString() === yest.toDateString()) return `hier à ${t}`;
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} à ${t}`;
}

/* ── Detect links in a text value ────────────────────────────── */
function detectHref(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^www\./i.test(s)) return `https://${s}`;
    return null;
}

/* ══════════════════════════════════════════════════════════════
   MAIN CARD — fidèle à la maquette
   ══════════════════════════════════════════════════════════════ */
export const LeadCard = memo(({
    lead, column, workspace, onOpen, onDragStart, onDragEnd, dragging, quickFocused,
}) => {
    const { dispatch } = useCrm();
    const visible = getVisibleSet(workspace.cardFields);
    const isJobs = workspace.template === "jobs";

    // fieldOrder = toutes les clés visibles dans l'ordre exact de cardFields
    // Si cardFields est vide/absent, fallback sur l'ordre par défaut
    const fieldOrder = (() => {
        if (!workspace.cardFields || workspace.cardFields.length === 0) {
            return ["phone", "email", "website"];
        }
        return workspace.cardFields.filter((f) => f.visible).map((f) => f.key);
    })();

    const colColor = getColumnColor(column);
    const [reminderOpen, setReminderOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [reminderDate, setReminderDate] = useState(lead.nextAction?.date || "");
    const [reminderLabel, setReminderLabel] = useState(lead.nextAction?.label || "");
    const [justLogged, setJustLogged] = useState(false);

    const highlighted = (lead.customFields || []).filter((f) => f.highlight && f.value);
    const pinned      = (lead.customFields || []).filter((f) => f.pinned && f.value);
    const now = Date.now();

    const followup          = lead.autoFollowup;
    const followupDue       = followup ? (new Date(followup.dueAt).getTime() <= now || followup.overdue) : false;
    const followupIsOverdue = followup && (followup.overdue || followup.stage >= 3);
    const isStale           = !!lead.staleInContacted;

    // Recalcul pur à chaque render : ajouter un téléphone / corriger une donnée
    // fait immédiatement baisser ou disparaître la vigilance affichée.
    const allInconsistencies = detectInconsistencies(
        lead,
        workspace.columns,
        workspace.inconsistencyConfig
    );
    const cardInconsistency = topCardInconsistency(
        lead,
        workspace.columns,
        workspace.inconsistencyConfig
    );
    const inconsistencyCount = countCriticalInconsistencies(allInconsistencies);

    const agencySuspect = getAgencySuspicion(
        lead,
        isAgencyDetectionEnabled(workspace)
    );

    const currentEntry = [...(lead.statusHistory || [])].reverse().find((e) => e.columnId === lead.columnId);

    const rdv       = isManualRdv(lead.nextAction) ? lead.nextAction : null;
    const rdvDate   = rdv ? new Date(rdv.dueAt || rdv.date) : null;
    const rdvIsToday = rdvDate ? rdvDate.toDateString() === new Date().toDateString() : false;
    const rdvIsPast  = rdvDate ? rdvDate.getTime() < Date.now() - 60000 : false;
    const rdvIsSoon  = rdvDate && !rdvIsPast ? rdvDate.getTime() - Date.now() < 24 * 3600 * 1000 : false;

    const contactedLabel      = isJobs ? "Relancé" : "Contacté";
    const contactedAction     = isJobs ? "Relance enregistrée" : "Contact enregistré";
    const reminderPlaceholder = isJobs ? "ex. Entretien, Relance…" : "ex. Relance téléphonique";

    const logToday = (e) => {
        e.stopPropagation();
        // Utilise isContactedColumn (patterns centralisés) au lieu d'une comparaison exacte
        // sur "contacté" — corrige le bug où les colonnes nommées "Appel", "Relance", etc.
        // n'étaient pas détectées comme cibles de déplacement automatique.
        const contactedColumn = isJobs ? null : Object.values(workspace.columns).find(
            (c) => isContactedColumn(c.name)
        );
        const willMove = contactedColumn && lead.columnId !== contactedColumn.id;
        dispatch({ type: "LOG_CONTACT", workspaceId: workspace.id, leadId: lead.id,
            text: isJobs ? `Relance depuis « ${column.name} »` : `Contact enregistré depuis « ${column.name} »` });
        setJustLogged(true);
        setTimeout(() => setJustLogged(false), 2500);
        toast.success(contactedAction, {
            description: willMove
                ? `${lead.company} — déplacé vers « ${contactedColumn.name} »`
                : `${lead.company} — ${formatLastContact(new Date().toISOString())}`,
        });
    };

    const saveReminder = (e) => {
        e?.stopPropagation();
        dispatch({ type: "SET_NEXT_ACTION", workspaceId: workspace.id, leadId: lead.id,
            nextAction: reminderDate || reminderLabel ? { date: reminderDate, label: reminderLabel } : null });
        setReminderOpen(false);
        if (reminderDate || reminderLabel) toast.success("Rappel enregistré", { description: lead.company });
    };

    const dismissFollowup = (e) => {
        e.stopPropagation();
        dispatch({ type: "DISMISS_FOLLOWUP", workspaceId: workspace.id, leadId: lead.id });
    };

    /* ── Cadre colonne + accent côté si RDV ── */
    const glowColor = quickFocused
        ? null
        : rdv && rdvIsPast   ? "rgba(244,63,94,0.22)"
        : rdv && rdvIsSoon   ? "rgba(16,185,129,0.18)"
        : isStale            ? "rgba(244,63,94,0.16)"
        : cardInconsistency?.severity === "critical" ? "rgba(244,63,94,0.14)"
        : followupIsOverdue  ? "rgba(244,63,94,0.14)"
        : followupDue        ? "rgba(245,158,11,0.16)"
        : null;

    const hasGlow = !!glowColor;

    // Accent latéral RDV (ne remplace pas le cadre colonne)
    const rdvSideColor = !rdv || quickFocused
        ? null
        : rdvIsPast  ? "rgb(244, 63, 94)"
        : rdvIsSoon  ? "rgb(16, 185, 129)"
        : "rgb(59, 130, 246)";

    /* ── Inline data rows with copy & link ── */
    const DataRow = ({ value, isUrl, copyValue }) => {
        const href = isUrl ? detectHref(String(value)) : null;
        const cv = copyValue ?? String(value);
        return (
            <div className="group/row flex items-baseline gap-0 leading-snug">
                {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener" draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline text-[12.5px] break-all">
                        {value}
                    </a>
                ) : (
                    <span className="text-[12.5px] text-foreground/80 break-words">{value}</span>
                )}
                <CopyBtn value={cv} />
            </div>
        );
    };

    /* ── Multiple links on same row (e.g. "Google Maps, France Travail") ── */
    const LinksRow = ({ links }) => (
        <div className="group/row flex flex-wrap items-center gap-x-1 gap-y-0.5">
            {links.map((lk, i) => {
                const href = detectHref(lk.url || lk);
                const label = lk.label || lk;
                return (
                    <React.Fragment key={i}>
                        {i > 0 && <span className="text-muted-foreground/40 text-[12px]">,</span>}
                        {href ? (
                            <a href={href} target="_blank" rel="noreferrer noopener" draggable={false}
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:underline text-[12.5px]">
                                {label}
                            </a>
                        ) : (
                            <span className="text-[12.5px] text-foreground/80">{label}</span>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );

    /* ── Build field rows in order — respecte exactement l'ordre de cardFields ── */
    const renderFields = () => {
        const rows = [];
        // On itère sur fieldOrder qui est déjà dans l'ordre exact choisi par l'user
        // (incluant les extra:, cf:, et champs fixes dans n'importe quel ordre)
        const rendered = new Set(); // évite les doublons si un cf: est déjà injecté par son parent

        for (const key of fieldOrder) {
            if (rendered.has(key)) continue;

            // ── Champ fixe : phone ──────────────────────────────────────────
            if (key === "phone") {
                if (lead.phone) {
                    rows.push(
                        <div key="phone" className="group/row flex items-baseline gap-0">
                            <span className="text-[12.5px] text-foreground/80">{lead.phone}</span>
                            <CopyBtn value={lead.phone} />
                        </div>
                    );
                }
                // Injecter les doublons cf:Téléphone N s'ils sont juste après dans fieldOrder
                // (gérés ci-dessous par le cas cf:)
            }
            // ── Champ fixe : email ──────────────────────────────────────────
            else if (key === "email") {
                if (lead.email) {
                    rows.push(
                        <div key="email" className="group/row flex items-baseline gap-0 min-w-0">
                            <a href={`mailto:${lead.email}`} onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:underline text-[12.5px] truncate min-w-0">{lead.email}</a>
                            <CopyBtn value={lead.email} />
                        </div>
                    );
                }
            }
            // ── Champ fixe : website ────────────────────────────────────────
            else if (key === "website") {
                if (lead.website) {
                    const href = detectHref(lead.website) ?? `https://${lead.website}`;
                    rows.push(
                        <div key="website" className="group/row flex items-baseline gap-0 min-w-0">
                            <a href={href} target="_blank" rel="noreferrer noopener" draggable={false}
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:underline text-[12.5px] truncate min-w-0">{lead.website}</a>
                            <CopyBtn value={lead.website} />
                        </div>
                    );
                }
            }
            // ── Champ fixe : contact ────────────────────────────────────────
            else if (key === "contact") {
                // contact est affiché séparément en header — on le skip ici sauf si explicitement dans fieldOrder
                // on le rend quand même pour que l'ordre soit respecté
                if (lead.contact) {
                    rows.push(
                        <div key="contact" className="group/row flex items-baseline gap-0 min-w-0">
                            <span className="text-[12.5px] text-muted-foreground truncate min-w-0">{lead.contact}</span>
                            <CopyBtn value={lead.contact} />
                        </div>
                    );
                }
            }
            // ── Champ importé extra: ────────────────────────────────────────
            else if (key.startsWith("extra:")) {
                const ek = key.slice(6);
                const v = lead.extra?.[ek];
                if (v) {
                    const href = detectHref(String(v));
                    rows.push(
                        <div key={key} className="group/row flex items-baseline gap-0 min-w-0">
                            {href
                                ? <a href={href} target="_blank" rel="noreferrer noopener" draggable={false} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline text-[12.5px] truncate min-w-0">{v}</a>
                                : <span className="text-[12.5px] text-foreground/80 truncate min-w-0">{v}</span>
                            }
                            <CopyBtn value={String(v)} />
                        </div>
                    );
                }
            }
            // ── Doublon de champ principal cf: ──────────────────────────────
            else if (key.startsWith("cf:")) {
                const label = key.slice(3); // ex: "Téléphone 2"
                const cf = (lead.customFields || []).find((f) => f.label === label);
                if (cf && cf.value) {
                    const href = detectHref(cf.value);
                    const isPhone = !href && /^[+\d\s.\-()]{7,}$/.test(cf.value) && cf.value.replace(/\D/g, "").length >= 7;
                    const isEmail = !href && cf.value.includes("@") && cf.value.includes(".");
                    rows.push(
                        <div key={key} className="group/row flex items-baseline gap-0 min-w-0">
                            {href ? (
                                <a href={href} target="_blank" rel="noreferrer noopener" draggable={false}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-primary hover:underline text-[12.5px] truncate min-w-0">{cf.value}</a>
                            ) : isPhone ? (
                                <a href={`tel:${cf.value.replace(/[^+\d]/g, "")}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[12.5px] text-foreground/80 truncate min-w-0">{cf.value}</a>
                            ) : isEmail ? (
                                <a href={`mailto:${cf.value}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-primary hover:underline text-[12.5px] truncate min-w-0">{cf.value}</a>
                            ) : (
                                <span className="text-[12.5px] text-foreground/80 truncate min-w-0">{cf.value}</span>
                            )}
                            <CopyBtn value={cf.value} />
                        </div>
                    );
                }
                rendered.add(key);
            }
            // ── Toute autre clé (champs spéciaux comme lastNote, nextAction…) ─
            // Ces champs sont gérés séparément dans le JSX principal, on les ignore ici
        }

        return rows;
    };

    return (
        <div
            data-testid={`lead-card-${lead.id}`}
            draggable
            onDragStart={(e) => onDragStart(e, lead)}
            onDragEnd={onDragEnd}
            onClick={(e) => {
                if (e.target.closest("a, button, input, textarea, [data-no-open]")) return;
                onOpen(lead);
            }}
            className={`lead-card ${dragging ? "dragging" : ""} ${hasGlow ? "card-glow" : ""} ${rdvSideColor ? "rdv-side" : ""} ${rdv && rdvIsSoon && !rdvIsPast ? "rdv-soon" : ""} ${quickFocused ? "quick-focused" : ""} ${reminderOpen || moveOpen ? "actions-open" : ""} ${isStale && !rdv ? "card-stale" : ""} relative cursor-grab active:cursor-grabbing mb-1.5`}
            style={{
                "--col-lisere": colColor.lisere || colColor.accentBar,
                ...(glowColor ? { "--card-glow": glowColor } : {}),
                ...(rdvSideColor ? { "--rdv-side": rdvSideColor } : {}),
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onOpen(lead)}
        >
            {quickFocused && (
                <span className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-1 h-10 rounded-r-full bg-primary z-10" aria-hidden />
            )}

            <div className="lead-card-body px-3.5 pt-3.5 pb-3 space-y-2">

                {/* ── Ligne 1 : Avatar (cercle coloré colonne) + Nom + Contact ── */}
                <div className="flex items-start gap-2.5">
                    <div className="shrink-0 mt-0.5">
                        <LeadAvatar lead={lead} card bgClass={colColor.chipBg} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                            <h4 className={`font-semibold text-[14px] leading-snug ${
                                agencySuspect
                                    ? AGENCY_NAME_CLS
                                    : "text-foreground"
                            } ${
                                lead.company?.startsWith("Sans nom") ? "opacity-40 italic font-normal" : ""
                            }`} title={agencySuspect ? agencySuspect.label : lead.company}>
                                {lead.company}
                            </h4>
                            {/* Badges urgence — top right */}
                            <div className="flex items-center gap-1 shrink-0 mt-0.5 flex-wrap justify-end">
                                {agencySuspect && (
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <AgencySuspectBadge
                                            score={agencySuspect.score}
                                            label={agencySuspect.label}
                                        />
                                    </div>
                                )}
                                {/* Badge relance : numéro + canal */}
                                {(lead.relances || []).length > 0 && (() => {
                                    const relances = lead.relances;
                                    const num = relances.length;
                                    // Couleurs par étape
                                    const COLORS = [
                                        "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
                                        "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                                        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
                                        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                                        "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
                                        "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
                                        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                                    ];
                                    const colorClass = COLORS[Math.min(num - 1, COLORS.length - 1)];
                                    const lastCanal = relances[relances.length - 1]?.canal || "";
                                    const CANAL_EMOJI = { "Téléphone": "📞", "Email": "✉️", "SMS": "💬", "LinkedIn": "💼", "WhatsApp": "📱", "Courrier": "📮", "Autre": "🔁" };
                                    const emoji = CANAL_EMOJI[lastCanal] || "🔁";
                                    return (
                                        <div
                                            onClick={(e) => e.stopPropagation()}
                                            title={`${num} relance${num > 1 ? "s" : ""} · Dernier canal : ${lastCanal}`}
                                            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${colorClass}`}
                                        >
                                            <span className="text-[9px]">{emoji}</span>
                                            <span>R{num}</span>
                                        </div>
                                    );
                                })()}
                                {visible.has("followupBadge") && followup && (
                                    <div onClick={(e) => e.stopPropagation()}
                                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                                            followupIsOverdue ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                            : followupDue ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                            : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                        }`}>
                                        {followupIsOverdue ? <AlertTriangle size={9} strokeWidth={2.5} /> : <BellRing size={9} strokeWidth={2} />}
                                        <span className="ml-0.5">{followupIsOverdue ? "retard" : followupDue ? "ajd" : `+${Math.max(1, Math.ceil((new Date(followup.dueAt).getTime() - now) / 86400000))}j`}</span>
                                        <button onClick={dismissFollowup} aria-label="Ignorer" className="ml-1 opacity-50 hover:opacity-100" data-testid={`lead-followup-badge-${lead.id}`}>
                                            <X size={8} strokeWidth={3} />
                                        </button>
                                    </div>
                                )}
                                {isStale && (
                                    <div onClick={(e) => e.stopPropagation()}
                                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white"
                                        title="Dans 'Contacté' depuis plus de 3 jours ouvrés"
                                        data-testid={`lead-stale-badge-${lead.id}`}>
                                        <AlertTriangle size={9} strokeWidth={2.5} />
                                        <span>3j+</span>
                                    </div>
                                )}
                                {visible.has("inconsistencyBadge") && cardInconsistency && !isStale && !(rdv && rdvIsPast) && (
                                    <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white"
                                        title={cardInconsistency.message}
                                        data-testid={`lead-inconsistency-badge-${lead.id}`}
                                    >
                                        <AlertTriangle size={9} strokeWidth={2.5} />
                                        <span>{inconsistencyCount > 1 ? `${inconsistencyCount}!` : "!"}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Contact / Recruteur — juste sous le nom, gris */}
                        {visible.has("contact") && lead.contact && (
                            <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">{lead.contact}</p>
                        )}
                        {/* ── RDV banner — juste sous le nom/contact ── */}
                        {rdv && rdvDate && (
                            <div className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md text-[11.5px] font-semibold ${
                                rdvIsPast ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                : rdvIsSoon ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-primary/8 text-primary"
                            }`}>
                                <CalendarClock size={11} strokeWidth={2.5} className="shrink-0" />
                                <span>
                                    {rdvIsPast ? "⚠️ RDV dépassé · " : rdvIsToday ? "Auj. · " : "RDV · "}
                                    {rdvDate.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                                    {rdv.hasTime !== false && ` à ${String(rdvDate.getHours()).padStart(2,"0")}h${String(rdvDate.getMinutes()).padStart(2,"0") !== "00" ? String(rdvDate.getMinutes()).padStart(2,"0") : ""}`}
                                </span>
                            </div>
                        )}
                        {visible.has("inconsistencyBadge") && cardInconsistency && !(
                            cardInconsistency.id === "rdv_overdue" && rdv && rdvIsPast && inconsistencyCount <= 1
                        ) && (
                            <div
                                className="mt-1 text-[11px] font-medium leading-snug line-clamp-2 text-rose-600 dark:text-rose-400"
                                title={cardInconsistency.message}
                                data-testid={`lead-inconsistency-line-${lead.id}`}
                            >
                                {cardInconsistency.title}
                                {inconsistencyCount > 1 ? ` · +${inconsistencyCount - 1}` : ""}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Highlighted custom fields ── */}
                {highlighted.length > 0 && (
                    <div className="space-y-0.5">
                        {highlighted.map((f) => (
                            <div key={f.id} className="group/row flex items-baseline gap-1">
                                <Star size={9} className="shrink-0 text-amber-500 fill-amber-500 mt-1" />
                                <span className="text-[12.5px] text-foreground/80">
                                    <span className="text-muted-foreground">{f.label} · </span>{f.value}
                                </span>
                                <CopyBtn value={f.value} />
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Data fields (phone, email, site, extra) ── */}
                {(() => {
                    const fields = renderFields();
                    return fields.length > 0 ? <div className="space-y-0.5">{fields}</div> : null;
                })()}

                {/* ── Tags ── */}
                {visible.has("tags") && lead.tags && lead.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                        {lead.tags.map((tag) => {
                            const hue = hashHue(tag);
                            return (
                                <span key={tag} className={`px-2 py-0.5 rounded text-[11px] font-medium ${hue.bg} ${hue.text}`}>
                                    {tag}
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* ── Deal value ── */}
                {visible.has("dealValue") && lead.dealValue != null && (
                    <div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-semibold ${
                            isJobs ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                        }`}>
                            <Trophy size={11} strokeWidth={2} />
                            {isJobs ? "💰 " : ""}
                            {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(lead.dealValue)}
                            {isJobs ? " /an" : ""}
                        </span>
                    </div>
                )}

                {/* ── Pinned fields ── */}
                {visible.has("pinnedFields") && pinned.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {pinned.map((f) => (
                            <span key={f.id} className="px-2 py-0.5 rounded bg-muted text-[11.5px] text-foreground/70" data-testid={`lead-pinned-${f.id}`}>
                                {f.value}
                            </span>
                        ))}
                    </div>
                )}

                {/* ════════ ACTION BAR — survol ════════ */}
                {visible.has("actionBar") && (
                    <div className="lead-card-actions flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {/* Contacté — CTA principal */}
                        <button
                            data-testid={`quick-log-${lead.id}`}
                            onClick={logToday}
                            className={`flex-1 h-8 rounded-lg border text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all min-w-0 ${
                                justLogged
                                    ? "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400"
                                    : "bg-primary/10 border-primary/25 text-primary hover:bg-primary/15"
                            }`}
                        >
                            <CheckCircle2 size={13} strokeWidth={justLogged ? 2.5 : 1.75} className="shrink-0" />
                            <span className="truncate">{contactedLabel}</span>
                        </button>

                        {/* Rappel — icône seule */}
                        <Popover open={reminderOpen} onOpenChange={setReminderOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    data-testid={`quick-reminder-${lead.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    title={isJobs ? "Entretien / rappel" : "Rappel"}
                                    aria-label={isJobs ? "Entretien / rappel" : "Rappel"}
                                    className="h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center hover:bg-muted/60 hover:text-foreground transition-colors shrink-0"
                                >
                                    <CalendarClock size={13} strokeWidth={1.75} />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" sideOffset={8} className="w-64 p-3 rounded-xl" onClick={(e) => e.stopPropagation()}>
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold">{isJobs ? "Prochain entretien / rappel" : "Prochaine action"}</p>
                                    <Input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveReminder(e)} data-testid={`quick-reminder-date-${lead.id}`} className="h-9" />
                                    <Input placeholder={reminderPlaceholder} value={reminderLabel} onChange={(e) => setReminderLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveReminder(e)} data-testid={`quick-reminder-label-${lead.id}`} className="h-9" />
                                    <div className="flex justify-end gap-1.5 pt-1">
                                        <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs" onClick={() => { setReminderDate(""); setReminderLabel(""); }}>Effacer</Button>
                                        <Button size="sm" onClick={saveReminder} data-testid={`quick-reminder-save-${lead.id}`} className="h-8 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90">Enregistrer</Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        {/* Déplacer */}
                        <MoveColumnButton lead={lead} workspace={workspace} currentColumnId={lead.columnId} dispatch={dispatch} onOpenChange={setMoveOpen} />
                    </div>
                )}

                {/* ════════ FOOTER : timestamps ════════ */}
                {(lead.lastContact || (visible.has("statusTime") && currentEntry) || (visible.has("nextAction") && lead.nextAction?.date) || (visible.has("lastNote") && lead.notes?.length > 0)) && (
                    <div className="space-y-0.5 pt-0.5">

                        {/* Dernier contact */}
                        {lead.lastContact && (
                            <p className="text-[11.5px] text-muted-foreground" data-testid={`lead-event-contact-${lead.id}`}>
                                Contacté {formatLastContact(lead.lastContact)}
                            </p>
                        )}

                        {/* Dernière note */}
                        {lead.notes && lead.notes.length > 0 && (visible.has("lastNote") || isStale) && (
                            <div className={`flex items-start gap-1.5 text-[11.5px] ${isStale ? "text-rose-600 dark:text-rose-400 font-medium" : "text-muted-foreground"}`} data-testid={`lead-event-note-${lead.id}`}>
                                <MessageSquare size={10} strokeWidth={1.5} className="shrink-0 mt-0.5 opacity-60" />
                                <span className="line-clamp-2 leading-relaxed">
                                    <NoteTextWithAudio note={lead.notes[0]} />
                                </span>
                            </div>
                        )}

                        {/* Prochaine action */}
                        {visible.has("nextAction") && lead.nextAction?.date && (() => {
                            const na = lead.nextAction;
                            const dueTime = na.dueAt ? new Date(na.dueAt).getTime() : new Date(na.date + "T09:00:00").getTime();
                            const isPast  = dueTime <= now;
                            const isToday = new Date(na.dueAt || na.date).toDateString() === new Date().toDateString();
                            const isMeeting = !!na.meeting;
                            const cls = isMeeting
                                ? (isPast ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")
                                : (isPast || na.overdue ? "text-rose-600 dark:text-rose-400" : isToday ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground");
                            const dateStr = new Date(na.dueAt || na.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
                            const dueDate = na.dueAt ? new Date(na.dueAt) : null;
                            const timeStr = dueDate && !(dueDate.getHours() === 9 && dueDate.getMinutes() === 0)
                                ? ` à ${String(dueDate.getHours()).padStart(2,"0")}h${String(dueDate.getMinutes()).padStart(2,"0")}` : "";
                            return (
                                <div className={`flex items-center gap-1.5 text-[11.5px] font-medium ${cls}`} data-testid={`lead-next-action-badge-${lead.id}`}>
                                    {isMeeting ? <CalendarCheck size={10} strokeWidth={2} /> : <BellRing size={10} strokeWidth={2} />}
                                    <span className="truncate">{dateStr}{timeStr}{!na.auto && na.label ? ` · ${na.label}` : ""}</span>
                                </div>
                            );
                        })()}

                        {/* Temps dans la colonne */}
                        {visible.has("statusTime") && currentEntry && (
                            <p className="text-[11px] text-muted-foreground/50" data-testid={`lead-status-time-${lead.id}`}>
                                {formatShortDateTime(currentEntry.at)}
                            </p>
                        )}
                    </div>
                )}

            </div>{/* /px-4 */}
        </div>
    );
}, (prev, next) =>
    prev.lead === next.lead &&
    prev.column === next.column &&
    prev.dragging === next.dragging &&
    prev.quickFocused === next.quickFocused &&
    prev.workspace.cardFields === next.workspace.cardFields &&
    prev.workspace.columnWidth === next.workspace.columnWidth &&
    prev.workspace.inconsistencyConfig === next.workspace.inconsistencyConfig &&
    prev.workspace.agencyDetectionEnabled === next.workspace.agencyDetectionEnabled &&
    prev.workspace.columns === next.workspace.columns
);
