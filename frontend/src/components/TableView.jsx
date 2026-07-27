import React, { useMemo, useState, useRef, useCallback } from "react";
import { Trophy, ChevronUp, ChevronDown, Phone, Mail, Trash2, Globe, User } from "lucide-react";
import { getColumnColor } from "@/lib/columnColors";
import { telHref, mailtoHref } from "@/lib/actionLinks";
import { useCrm } from "@/context/CrmContext";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { AgencySuspectBadge, AGENCY_NAME_CLS } from "./AgencySuspectBadge";
import { filterLeads } from "@/lib/leadFilter";
import { getLeadVigilance } from "@/lib/inconsistencyRules";

function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" });
}

// Hauteur estimée d'une ligne (px) — utilisée pour le placeholder spacer
const ROW_HEIGHT = 45;
// Nombre de lignes à rendre en dehors du viewport (buffer haut + bas)
const OVERSCAN = 20;

/**
 * Hook de virtualisation légère pour une liste plate.
 * Pas de dépendance externe — utilise un scroll listener sur le conteneur.
 * Retourne l'index de début et de fin des lignes à rendre.
 */
function useVirtualRange(totalCount, containerRef) {
    const [range, setRange] = useState({ start: 0, end: Math.min(totalCount, 60) });

    const update = useCallback(() => {
        const el = containerRef.current;
        if (!el || totalCount === 0) return;
        const { scrollTop, clientHeight } = el;
        const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
        const end = Math.min(totalCount, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN);
        setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    }, [totalCount, containerRef]);

    // Écouter le scroll sur le conteneur
    const attachScroll = useCallback((el) => {
        if (!el) return;
        el.addEventListener("scroll", update, { passive: true });
        update();
        return () => el.removeEventListener("scroll", update);
    }, [update]);

    return { range, attachScroll };
}

export const TableView = ({ workspace, filter, activeFilters = [], onOpenLead }) => {
    const { dispatch } = useCrm();
    const [sortKey, setSortKey] = useState("company");
    const [sortDir, setSortDir] = useState("asc");
    const containerRef = useRef(null);
    const agencyOn = isAgencyDetectionEnabled(workspace);

    const leads = useMemo(() => {
        const filtered = filterLeads(
            Object.values(workspace.leads),
            { filter, activeFilters },
            workspace
        );
        return [...filtered].sort((a, b) => {
            let va, vb;
            if (sortKey === "company") { va = a.company || ""; vb = b.company || ""; }
            else if (sortKey === "column") {
                va = workspace.columns[a.columnId]?.name || "";
                vb = workspace.columns[b.columnId]?.name || "";
            }
            else if (sortKey === "dealValue") { va = a.dealValue ?? -1; vb = b.dealValue ?? -1; }
            else if (sortKey === "lastContact") { va = a.lastContact || ""; vb = b.lastContact || ""; }
            else if (sortKey === "contact") { va = a.contact || ""; vb = b.contact || ""; }
            else if (sortKey === "vigilance") {
                va = getLeadVigilance(a, workspace.columns, workspace.inconsistencyConfig).score;
                vb = getLeadVigilance(b, workspace.columns, workspace.inconsistencyConfig).score;
            }
            else { va = ""; vb = ""; }
            const cmp = typeof va === "number"
                ? va - vb
                : va.localeCompare(vb, "fr");
            return sortDir === "asc" ? cmp : -cmp;
        });
    }, [workspace, filter, activeFilters, sortKey, sortDir]);

    const { range, attachScroll } = useVirtualRange(leads.length, containerRef);

    // Callback ref : attache le scroll listener ET stocke la ref
    const setContainerRef = useCallback((el) => {
        containerRef.current = el;
        attachScroll(el);
    }, [attachScroll]);

    const handleSort = (key) => {
        if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir(key === "vigilance" ? "desc" : "asc"); }
    };

    const Th = ({ label, k }) => (
        <th
            className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap"
            onClick={() => handleSort(k)}
        >
            <span className="inline-flex items-center gap-1">
                {label}
                {sortKey === k
                    ? sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                    : <ChevronUp size={11} className="opacity-20" />}
            </span>
        </th>
    );

    // Lignes visibles seulement (+ overscan)
    const visibleLeads = leads.slice(range.start, range.end);
    const topSpacerHeight = range.start * ROW_HEIGHT;
    const bottomSpacerHeight = (leads.length - range.end) * ROW_HEIGHT;

    return (
        <div ref={setContainerRef} className="flex-1 overflow-auto px-4 sm:px-6 py-4">
            <div className="rounded-xl border border-border overflow-hidden bg-card">
                <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50 border-b border-border sticky top-0 z-10">
                        <tr>
                            <Th label="Entreprise" k="company" />
                            <Th label="Contact" k="contact" />
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Tél. / Email</th>
                            <Th label="Statut" k="column" />
                            <Th label="Vigilance" k="vigilance" />
                            <Th label="Deal" k="dealValue" />
                            <Th label="Dernier contact" k="lastContact" />
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Relances</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tags</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Spacer haut — remplace les lignes non rendues au-dessus */}
                        {topSpacerHeight > 0 && (
                            <tr aria-hidden style={{ height: topSpacerHeight }}>
                                <td colSpan={9} />
                            </tr>
                        )}

                        {visibleLeads.map((lead, i) => {
                            const col = workspace.columns[lead.columnId];
                            const color = getColumnColor(col);
                            const globalIndex = range.start + i;
                            return (
                                <tr
                                    key={lead.id}
                                    onClick={() => onOpenLead(lead)}
                                    className={`cursor-pointer hover:bg-muted/30 transition-colors ${globalIndex > 0 ? "border-t border-border/50" : ""}`}
                                >
                                    {/* Entreprise */}
                                    <td className="px-3 py-2.5">
                                        {(() => {
                                            const agencySuspect = getAgencySuspicion(lead, agencyOn);
                                            return (
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span
                                                        className={`font-semibold text-[13px] ${
                                                            agencySuspect ? AGENCY_NAME_CLS : "text-foreground"
                                                        } ${lead.company?.startsWith("Sans nom") ? "opacity-40 italic" : ""}`}
                                                        title={agencySuspect ? agencySuspect.label : undefined}
                                                    >
                                                        {lead.company}
                                                    </span>
                                                    {agencySuspect && (
                                                        <AgencySuspectBadge
                                                            score={agencySuspect.score}
                                                            label={agencySuspect.label}
                                                        />
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </td>
                                    {/* Contact */}
                                    <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground max-w-[140px]">
                                        <span className="truncate block">{lead.contact || "—"}</span>
                                    </td>
                                    {/* Tél / Email */}
                                    <td className="px-3 py-2.5">
                                        <div className="flex flex-col gap-0.5">
                                            {/* Téléphone principal */}
                                            {lead.phone && (
                                                <a href={telHref(lead.phone) || undefined} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground truncate max-w-[150px]">
                                                    <Phone size={10} strokeWidth={1.75} className="shrink-0" />
                                                    {lead.phone}
                                                </a>
                                            )}
                                            {/* Téléphone 2, 3… */}
                                            {(lead.customFields || [])
                                                .filter((f) => /^téléphone\s*\d+$/i.test(f.label) && f.value)
                                                .map((f) => (
                                                    <div key={f.id} className="flex items-center gap-1 group/cfrow">
                                                        <a href={`tel:${f.value.replace(/[^+\d]/g,"")}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground truncate max-w-[120px]">
                                                            <Phone size={10} strokeWidth={1.75} className="shrink-0 opacity-50" />
                                                            <span className="text-[10px] text-muted-foreground/60 mr-0.5">{f.label.replace(/téléphone\s*/i,"#")}</span>
                                                            {f.value}
                                                        </a>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: lead.id, fieldId: f.id }); }}
                                                            className="opacity-0 group-hover/cfrow:opacity-60 hover:!opacity-100 text-rose-500 transition-opacity shrink-0"
                                                            title={`Supprimer ${f.label}`}
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                ))
                                            }
                                            {/* Email principal */}
                                            {lead.email && (
                                                <a href={mailtoHref(lead.email) || undefined} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground truncate max-w-[150px]">
                                                    <Mail size={10} strokeWidth={1.75} className="shrink-0" />
                                                    {lead.email}
                                                </a>
                                            )}
                                            {/* Email 2, 3… */}
                                            {(lead.customFields || [])
                                                .filter((f) => /^email\s*\d+$/i.test(f.label) && f.value)
                                                .map((f) => (
                                                    <div key={f.id} className="flex items-center gap-1 group/cfrow">
                                                        <a href={`mailto:${f.value}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground truncate max-w-[120px]">
                                                            <Mail size={10} strokeWidth={1.75} className="shrink-0 opacity-50" />
                                                            <span className="text-[10px] text-muted-foreground/60 mr-0.5">{f.label.replace(/email\s*/i,"#")}</span>
                                                            {f.value}
                                                        </a>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: lead.id, fieldId: f.id }); }}
                                                            className="opacity-0 group-hover/cfrow:opacity-60 hover:!opacity-100 text-rose-500 transition-opacity shrink-0"
                                                            title={`Supprimer ${f.label}`}
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                ))
                                            }
                                            {/* Contact 2, 3… */}
                                            {(lead.customFields || [])
                                                .filter((f) => /^contact(\s*(rh|2|3|4))?\s*\d*$/i.test(f.label) && f.value && f.label.toLowerCase() !== "contact")
                                                .map((f) => (
                                                    <div key={f.id} className="flex items-center gap-1 group/cfrow">
                                                        <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground truncate max-w-[120px]">
                                                            <User size={10} strokeWidth={1.75} className="shrink-0 opacity-50" />
                                                            <span className="text-[10px] text-muted-foreground/60 mr-0.5">{f.label}</span>
                                                            {f.value}
                                                        </span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: lead.id, fieldId: f.id }); }}
                                                            className="opacity-0 group-hover/cfrow:opacity-60 hover:!opacity-100 text-rose-500 transition-opacity shrink-0"
                                                            title={`Supprimer ${f.label}`}
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                ))
                                            }
                                            {/* Site web 2, 3… */}
                                            {(lead.customFields || [])
                                                .filter((f) => /^(site web|site)\s*\d+$/i.test(f.label) && f.value)
                                                .map((f) => (
                                                    <div key={f.id} className="flex items-center gap-1 group/cfrow">
                                                        <a href={f.value.startsWith("http") ? f.value : "https://" + f.value} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline truncate max-w-[120px]">
                                                            <Globe size={10} strokeWidth={1.75} className="shrink-0 opacity-50" />
                                                            <span className="text-[10px] text-muted-foreground/60 mr-0.5">{f.label}</span>
                                                            {f.value}
                                                        </a>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_CUSTOM_FIELD", workspaceId: workspace.id, leadId: lead.id, fieldId: f.id }); }}
                                                            className="opacity-0 group-hover/cfrow:opacity-60 hover:!opacity-100 text-rose-500 transition-opacity shrink-0"
                                                            title={`Supprimer ${f.label}`}
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                ))
                                            }
                                            {!lead.phone && !lead.email && <span className="text-[12px] text-muted-foreground/40">—</span>}
                                        </div>
                                    </td>
                                    {/* Statut */}
                                    <td className="px-3 py-2.5">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold text-white ${color.dot}`}>
                                            {col?.name || "—"}
                                        </span>
                                    </td>
                                    {/* Vigilance — badge rouge critique uniquement */}
                                    <td className="px-3 py-2.5">
                                        {(() => {
                                            const vig = getLeadVigilance(
                                                lead,
                                                workspace.columns,
                                                workspace.inconsistencyConfig
                                            );
                                            if (vig.level !== "critical" || vig.criticalCount === 0) {
                                                return <span className="text-muted-foreground/40 text-[12px]">—</span>;
                                            }
                                            return (
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-600 text-white"
                                                    title={vig.issues[0]?.message || ""}
                                                >
                                                    Rouge
                                                    {vig.criticalCount > 1 ? ` · ${vig.criticalCount}` : ""}
                                                </span>
                                            );
                                        })()}
                                    </td>
                                    {/* Deal */}
                                    <td className="px-3 py-2.5">
                                        {lead.dealValue != null ? (
                                            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                                                <Trophy size={10} strokeWidth={2} />
                                                {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(lead.dealValue)}
                                            </span>
                                        ) : <span className="text-muted-foreground/40 text-[12px]">—</span>}
                                    </td>
                                    {/* Dernier contact */}
                                    <td className="px-3 py-2.5 text-[12px] text-muted-foreground whitespace-nowrap">
                                        {formatDate(lead.lastContact)}
                                    </td>
                                    {/* Relances */}
                                    <td className="px-3 py-2.5">
                                        {(() => {
                                            const relances = lead.relances || [];
                                            if (relances.length === 0) return <span className="text-muted-foreground/40 text-[12px]">—</span>;
                                            const COLORS = [
                                                "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
                                                "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                                                "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
                                                "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                                                "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
                                                "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
                                                "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                                            ];
                                            const num = relances.length;
                                            const colorClass = COLORS[Math.min(num - 1, COLORS.length - 1)];
                                            const last = relances[num - 1];
                                            const CANAL_EMOJI = { "Téléphone": "📞", "Email": "✉️", "SMS": "💬", "LinkedIn": "💼", "WhatsApp": "📱", "Courrier": "📮", "Autre": "🔁" };
                                            return (
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${colorClass}`}>
                                                        {CANAL_EMOJI[last?.canal] || "🔁"} R{num}
                                                    </span>
                                                    <span className="text-[10.5px] text-muted-foreground hidden lg:inline">
                                                        {last?.canal}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                    </td>
                                    {/* Tags */}
                                    <td className="px-3 py-2.5">
                                        <div className="flex flex-wrap gap-1">
                                            {(lead.tags || []).slice(0, 2).map((t) => (
                                                <span key={t} className="px-1.5 py-0.5 rounded bg-primary/8 text-primary text-[10.5px] font-medium">{t}</span>
                                            ))}
                                            {lead.tags?.length > 2 && <span className="text-[10.5px] text-muted-foreground">+{lead.tags.length - 2}</span>}
                                            {!lead.tags?.length && <span className="text-muted-foreground/40 text-[12px]">—</span>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}

                        {/* Spacer bas — remplace les lignes non rendues en dessous */}
                        {bottomSpacerHeight > 0 && (
                            <tr aria-hidden style={{ height: bottomSpacerHeight }}>
                                <td colSpan={9} />
                            </tr>
                        )}

                        {leads.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">
                                    Aucun lead trouvé
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                {/* Footer */}
                <div className="px-4 py-2 border-t border-border/60 text-[11px] text-muted-foreground bg-muted/20">
                    {leads.length} lead{leads.length > 1 ? "s" : ""}
                </div>
            </div>
        </div>
    );
};
