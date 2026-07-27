import React, { useMemo } from "react";
import { Trophy, Users, TrendingUp } from "lucide-react";
import { getColumnColor } from "@/lib/columnColors";
import {
    getAgencySuspicion,
    isAgencyDetectionEnabled,
} from "@/lib/agencyDetection";
import { AgencySuspectBadge, AGENCY_NAME_CLS } from "./AgencySuspectBadge";
import { filterLeads } from "@/lib/leadFilter";

function pickEmoji(id = "") {
    const EMOJIS = ["🏢","🏗","🔧","⚡","🌿","🏠","🚀","💡","🔑","🎯","🛠","🌊","🏔","🎪","🔮","🌸","🦋","🐝","🌻","🍀","🔵","🟢","🟡","🟠","🔴","🟣","⚫","🟤","🔶","🔷"];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
    return EMOJIS[Math.abs(h) % EMOJIS.length];
}

export const PipelineView = ({ workspace, filter, activeFilters = [], onOpenLead }) => {
    const agencyOn = isAgencyDetectionEnabled(workspace);
    const stats = useMemo(() => {
        const filtered = filterLeads(
            Object.values(workspace.leads),
            { filter, activeFilters },
            workspace
        );

        const totalDeals = filtered.reduce((s, l) => s + (l.dealValue || 0), 0);
        const totalLeads = filtered.length;

        const byColumn = workspace.columnOrder.map((cid) => {
            const col = workspace.columns[cid];
            const colLeads = filtered.filter((l) => l.columnId === cid);
            const colValue = colLeads.reduce((s, l) => s + (l.dealValue || 0), 0);
            const pct = totalLeads > 0 ? (colLeads.length / totalLeads) * 100 : 0;
            return { col, cid, leads: colLeads, value: colValue, pct };
        });

        return { byColumn, totalDeals, totalLeads };
    }, [workspace, filter, activeFilters]);

    const fmt = (v) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

    return (
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* KPIs globaux */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                            <Users size={13} /> Total leads
                        </div>
                        <div className="text-2xl font-bold text-foreground">{stats.totalLeads}</div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-medium mb-1">
                            <Trophy size={13} /> Pipeline total
                        </div>
                        <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{fmt(stats.totalDeals)}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                            <TrendingUp size={13} /> Valeur moy. / lead
                        </div>
                        <div className="text-2xl font-bold text-foreground">
                            {stats.totalLeads > 0 ? fmt(stats.totalDeals / stats.totalLeads) : "—"}
                        </div>
                    </div>
                </div>

                {/* Funnel par colonne */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/60">
                        <h3 className="font-semibold text-sm">Répartition du pipeline</h3>
                    </div>
                    <div className="divide-y divide-border/50">
                        {stats.byColumn.map(({ col, cid, leads, value, pct }) => {
                            if (leads.length === 0) return null;
                            const color = getColumnColor(col);
                            return (
                                <div key={cid} className="px-4 py-3">
                                    <div className="flex items-center justify-between mb-2 gap-3">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11.5px] font-bold text-white ${color.dot} shrink-0`}>
                                                {col.name}
                                            </span>
                                            <span className="text-[12px] text-muted-foreground">{leads.length} lead{leads.length > 1 ? "s" : ""}</span>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            {value > 0 && (
                                                <span className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">{fmt(value)}</span>
                                            )}
                                            <span className="text-[11px] text-muted-foreground w-8 text-right">{Math.round(pct)}%</span>
                                        </div>
                                    </div>
                                    {/* Barre de progression */}
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                                        <div
                                            className={`h-full rounded-full transition-all ${color.dot}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    {/* Leads de cette colonne */}
                                    <div className="flex flex-wrap gap-1.5">
                                        {leads.slice(0, 8).map((lead) => {
                                            const agencySuspect = getAgencySuspicion(lead, agencyOn);
                                            return (
                                            <button
                                                key={lead.id}
                                                onClick={() => onOpenLead(lead)}
                                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-[12px] text-foreground transition-colors max-w-[200px]"
                                                title={agencySuspect ? agencySuspect.label : undefined}
                                            >
                                                {agencySuspect ? (
                                                    <AgencySuspectBadge
                                                        score={agencySuspect.score}
                                                        label={agencySuspect.label}
                                                        variant="compact"
                                                    />
                                                ) : (
                                                    <span className="text-[14px] select-none">{pickEmoji(lead.id)}</span>
                                                )}
                                                <span className={`truncate font-medium ${agencySuspect ? AGENCY_NAME_CLS : ""}`}>
                                                    {lead.company}
                                                </span>
                                                {lead.dealValue != null && (
                                                    <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">
                                                        {fmt(lead.dealValue)}
                                                    </span>
                                                )}
                                            </button>
                                            );
                                        })}
                                        {leads.length > 8 && (
                                            <span className="flex items-center px-2.5 py-1.5 text-[12px] text-muted-foreground">
                                                +{leads.length - 8} autres
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
