import React, { useMemo, useRef, useCallback, useState } from "react";
import {
    Phone, Mail, Globe, Trophy, Tag, BellRing, CheckCircle2, Clock,
} from "lucide-react";
import { getColumnColor } from "@/lib/columnColors";
import { telHref, mailtoHref, websiteHref } from "@/lib/actionLinks";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { AgencySuspectBadge, AGENCY_NAME_CLS } from "./AgencySuspectBadge";
import { filterLeads } from "@/lib/leadFilter";
import { getLeadVigilance } from "@/lib/inconsistencyRules";

function formatDate(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function pickEmoji(id = "") {
    const EMOJIS = ["🏢","🏗","🔧","⚡","🌿","🏠","🚀","💡","🔑","🎯","🛠","🌊","🏔","🎪","🔮","🌸","🦋","🐝","🌻","🍀","🔵","🟢","🟡","🟠","🔴","🟣","⚫","🟤","🔶","🔷"];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
    return EMOJIS[Math.abs(h) % EMOJIS.length];
}

const ROW_HEIGHT = 52; // hauteur estimée d'une ligne de lead (px)
const OVERSCAN = 15;

/**
 * Virtualisation légère pour une liste plate d'éléments.
 * Retourne seulement la tranche visible + overscan.
 */
function useVirtualList(items, containerRef) {
    const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 50) });

    const update = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const { scrollTop, clientHeight } = el;
        const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
        const end = Math.min(items.length, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN);
        setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    }, [items.length, containerRef]);

    const attachScroll = useCallback((el) => {
        if (!el) return;
        el.addEventListener("scroll", update, { passive: true });
        update();
        return () => el.removeEventListener("scroll", update);
    }, [update]);

    return { range, attachScroll };
}

export const ListView = ({ workspace, filter, activeFilters = [], onOpenLead }) => {
    const containerRef = useRef(null);

    const { grouped, flatLeads } = useMemo(() => {
        const filtered = filterLeads(
            Object.values(workspace.leads),
            { filter, activeFilters },
            workspace
        );
        // Group by column order — tri vigilance si filtre rouge actif
        const onlyRed = (activeFilters || []).some(
            (t) => String(t).toLowerCase().trim() === "vigilance rouge"
        );
        const sortByVig = (a, b) => {
            if (!onlyRed) return 0;
            const sa = getLeadVigilance(a, workspace.columns, workspace.inconsistencyConfig).score;
            const sb = getLeadVigilance(b, workspace.columns, workspace.inconsistencyConfig).score;
            return sb - sa;
        };
        const grouped = {};
        workspace.columnOrder.forEach((cid) => { grouped[cid] = []; });
        filtered.forEach((l) => { if (grouped[l.columnId]) grouped[l.columnId].push(l); });
        if (onlyRed) {
            workspace.columnOrder.forEach((cid) => {
                grouped[cid] = [...(grouped[cid] || [])].sort(sortByVig);
            });
        }
        const flatLeads = workspace.columnOrder.flatMap((cid) => grouped[cid] || []);
        return { grouped, flatLeads };
    }, [workspace, filter, activeFilters]);

    const { range, attachScroll } = useVirtualList(flatLeads, containerRef);
    const agencyOn = isAgencyDetectionEnabled(workspace);

    const setContainerRef = useCallback((el) => {
        containerRef.current = el;
        attachScroll(el);
    }, [attachScroll]);

    // Calcul du total visible par colonne pour afficher les bons compteurs
    const visibleCountByCol = useMemo(() => {
        const m = {};
        workspace.columnOrder.forEach((cid) => { m[cid] = (grouped[cid] || []).length; });
        return m;
    }, [grouped, workspace.columnOrder]);

    return (
        <div ref={setContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            <div className="max-w-5xl mx-auto space-y-6">
                {workspace.columnOrder.map((cid) => {
                    const col = workspace.columns[cid];
                    const colLeads = grouped[cid] || [];
                    if (colLeads.length === 0) return null;
                    const color = getColumnColor(col);
                    return (
                        <div key={cid}>
                            {/* Column header */}
                            <div className="flex items-center gap-2 mb-2">
                                <button className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-white ${color.dot}`}>
                                    {col.name}
                                </button>
                                <span className="text-[12px] text-muted-foreground font-medium">{visibleCountByCol[cid]}</span>
                            </div>
                            {/* Leads */}
                            <div className="rounded-xl border border-border overflow-hidden bg-card">
                                {colLeads.map((lead, i) => {
                                    const agencySuspect = getAgencySuspicion(lead, agencyOn);
                                    return (
                                    <button
                                        key={lead.id}
                                        onClick={() => onOpenLead(lead)}
                                        className={`w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-muted/40 transition-colors ${i > 0 ? "border-t border-border/60" : ""}`}
                                    >
                                        {/* Emoji */}
                                        <span className="text-[18px] shrink-0 select-none">{pickEmoji(lead.id)}</span>

                                        {/* Name + contact */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <div
                                                    className={`font-semibold text-[13.5px] truncate ${
                                                        agencySuspect ? AGENCY_NAME_CLS : "text-foreground"
                                                    }`}
                                                    title={agencySuspect ? agencySuspect.label : undefined}
                                                >
                                                    {lead.company}
                                                </div>
                                                {agencySuspect && (
                                                    <AgencySuspectBadge
                                                        score={agencySuspect.score}
                                                        label={agencySuspect.label}
                                                    />
                                                )}
                                            </div>
                                            {lead.contact && (
                                                <div className="text-[12px] text-muted-foreground truncate">{lead.contact}</div>
                                            )}
                                        </div>

                                        {/* Phone */}
                                        {lead.phone && (
                                            <a href={telHref(lead.phone) || undefined} onClick={(e) => e.stopPropagation()} className="hidden sm:flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground shrink-0">
                                                <Phone size={11} strokeWidth={1.75} />
                                                <span>{lead.phone}</span>
                                            </a>
                                        )}

                                        {/* Email */}
                                        {lead.email && (
                                            <a href={mailtoHref(lead.email) || undefined} onClick={(e) => e.stopPropagation()} className="hidden lg:flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground shrink-0 max-w-[160px] truncate">
                                                <Mail size={11} strokeWidth={1.75} className="shrink-0" />
                                                <span className="truncate">{lead.email}</span>
                                            </a>
                                        )}

                                        {/* Tags */}
                                        {lead.tags?.[0] && (
                                            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-primary text-[11px] font-medium shrink-0">
                                                <Tag size={9} />
                                                {lead.tags[0]}{lead.tags.length > 1 ? ` +${lead.tags.length - 1}` : ""}
                                            </span>
                                        )}

                                        {/* Deal value */}
                                        {lead.dealValue != null && (
                                            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold shrink-0">
                                                <Trophy size={9} strokeWidth={2} />
                                                {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(lead.dealValue)}
                                            </span>
                                        )}

                                        {/* Last contact */}
                                        {lead.lastContact && (
                                            <span className="hidden lg:flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                                                <CheckCircle2 size={10} className="text-emerald-500" />
                                                {formatDate(lead.lastContact)}
                                            </span>
                                        )}

                                        {/* Next action */}
                                        {lead.nextAction?.date && (
                                            <span className="hidden lg:flex items-center gap-1 text-[11px] text-primary shrink-0">
                                                <BellRing size={10} />
                                                {formatDate(lead.nextAction.dueAt || lead.nextAction.date)}
                                            </span>
                                        )}
                                    </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
