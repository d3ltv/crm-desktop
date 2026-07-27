import React, { useEffect, useMemo, useState } from "react";
import { useCrm } from "@/context/CrmContext";
import {
    computeWorkspaceStats,
    aggregateStats,
    formatDuration,
    computeCallStats,
    computeActivitySeries,
    computeMonthOverMonthTrends,
    computeTranscriptWordFreq,
    formatTrendLabel,
} from "@/lib/statsUtils";
import {
    BarChart3, ChevronDown, Phone, Star, ChevronRight, Users,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ---------- Helpers ----------
function pct(n) {
    if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return "—";
    return `${Number(n).toFixed(1)} %`;
}

function fmtEur(n) {
    if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function relativeDate(ts) {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    const d = Math.floor(diff / 86400000);
    if (d === 0) return "aujourd'hui";
    if (d === 1) return "hier";
    if (d < 7) return `il y a ${d} j`;
    if (d < 30) return `il y a ${Math.floor(d / 7)} sem.`;
    return `il y a ${Math.floor(d / 30)} mois`;
}

/** Opacité 0.22–1 selon intensité (0–1), teinte unique neutre */
function heatOpacity(intensity) {
    const t = Math.max(0, Math.min(1, intensity));
    return 0.22 + t * 0.78;
}

const CHART_HUE = "220 10% 28%"; // gris-ardoise — une seule teinte
const PENDING_LEAD_KEY = "crm_pending_lead";
const PENDING_FILTER_KEY = "crm_pending_filter";

/** Mini sparkline — série de valeurs numériques */
export const MiniSparkline = ({ values = [], tone = "neutral", className = "" }) => {
    const data = (values.length ? values : [0]).map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    });
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const W = 72;
    const H = 28;
    const pad = 2;
    const points = data.map((v, i) => {
        const x = pad + (i / Math.max(data.length - 1, 1)) * (W - pad * 2);
        const y = H - pad - ((v - min) / range) * (H - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const stroke =
        tone === "danger" ? "hsl(4 84% 55%)" :
        tone === "success" ? "hsl(142 64% 40%)" :
        "hsl(var(--muted-foreground))";

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className={`w-[72px] h-7 ${className}`} aria-hidden>
            <polyline
                fill="none"
                stroke={stroke}
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points.join(" ")}
                opacity="0.85"
            />
        </svg>
    );
};

// ---------- SVG Line Chart ----------
const PriceChart = ({ timeline }) => {
    const [hovered, setHovered] = useState(null);

    if (!timeline || timeline.length === 0) {
        return (
            <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                Aucun deal avec prix enregistré
            </div>
        );
    }

    const W = 600, H = 160, PAD = { top: 16, right: 16, bottom: 32, left: 56 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const cumulValues = timeline.map((p) => p.cumul);
    const minV = 0;
    const maxV = Math.max(...cumulValues) * 1.08;

    const xScale = (i) => PAD.left + (i / Math.max(timeline.length - 1, 1)) * innerW;
    const yScale = (v) => PAD.top + innerH - ((v - minV) / (maxV - minV || 1)) * innerH;

    const points = timeline.map((p, i) => ({ x: xScale(i), y: yScale(p.cumul), ...p }));
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${PAD.left.toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

    const yTicks = [0, 0.5, 1].map((t) => ({
        v: minV + t * (maxV - minV),
        y: yScale(minV + t * (maxV - minV)),
    }));

    const xLabels = [];
    const step = Math.max(1, Math.floor(timeline.length / 4));
    for (let i = 0; i < timeline.length; i += step) xLabels.push(i);
    if (!xLabels.includes(timeline.length - 1)) xLabels.push(timeline.length - 1);

    return (
        <div className="relative w-full" style={{ aspectRatio: `${W}/${H}` }}>
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-full"
                onMouseLeave={() => setHovered(null)}
            >
                <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={`hsl(${CHART_HUE})`} stopOpacity="0.12" />
                        <stop offset="100%" stopColor={`hsl(${CHART_HUE})`} stopOpacity="0" />
                    </linearGradient>
                    <clipPath id="chartClip">
                        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH + 1} />
                    </clipPath>
                </defs>

                {yTicks.map((t, i) => (
                    <line
                        key={i}
                        x1={PAD.left} y1={t.y}
                        x2={PAD.left + innerW} y2={t.y}
                        stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4 4"
                    />
                ))}

                <path d={areaPath} fill="url(#areaGrad)" clipPath="url(#chartClip)" />
                <path
                    d={linePath}
                    fill="none"
                    stroke={`hsl(${CHART_HUE})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    clipPath="url(#chartClip)"
                />

                {yTicks.map((t, i) => (
                    <text
                        key={i}
                        x={PAD.left - 6} y={t.y + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="hsl(var(--muted-foreground))"
                    >
                        {fmtEur(t.v).replace("€", "").trim()}€
                    </text>
                ))}

                {xLabels.map((i) => {
                    const p = points[i];
                    const d = new Date(timeline[i].date);
                    const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                    return (
                        <text key={i} x={p.x} y={H - 6} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">
                            {label}
                        </text>
                    );
                })}

                {points.map((p, i) => (
                    <g key={i}>
                        <circle cx={p.x} cy={p.y} r="3.5" fill={`hsl(${CHART_HUE})`} stroke="hsl(var(--background))" strokeWidth="2" />
                        <rect
                            x={p.x - 14} y={PAD.top} width={28} height={innerH}
                            fill="transparent"
                            onMouseEnter={() => setHovered({ ...p, idx: i })}
                        />
                    </g>
                ))}

                {hovered && (() => {
                    const tx = Math.min(Math.max(hovered.x, PAD.left + 40), PAD.left + innerW - 40);
                    const ty = Math.max(hovered.y - 36, PAD.top + 4);
                    return (
                        <g>
                            <line x1={hovered.x} y1={PAD.top} x2={hovered.x} y2={PAD.top + innerH} stroke={`hsl(${CHART_HUE})`} strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
                            <rect x={tx - 50} y={ty - 14} width={100} height={30} rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1" />
                            <text x={tx} y={ty + 2} textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">
                                {fmtEur(hovered.value)}
                            </text>
                            <text x={tx} y={ty + 14} textAnchor="middle" fontSize="9.5" fill="hsl(var(--muted-foreground))">
                                {hovered.company?.length > 16 ? hovered.company.slice(0, 15) + "…" : hovered.company}
                            </text>
                        </g>
                    );
                })()}
            </svg>
        </div>
    );
};

// ---------- Distribution bar chart (single hue + opacity) ----------
const DistributionBars = ({ distribution }) => {
    if (!distribution || distribution.length === 0) return null;
    const max = Math.max(...distribution.map((b) => b.count), 1);
    return (
        <div className="space-y-2.5 mt-3">
            {distribution.map((b) => {
                const intensity = b.count / max;
                return (
                    <div key={b.label} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-24 shrink-0 text-right">{b.label}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                    width: `${intensity * 100}%`,
                                    backgroundColor: `hsl(${CHART_HUE})`,
                                    opacity: heatOpacity(intensity),
                                }}
                            />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground w-6 text-right shrink-0">{b.count}</span>
                    </div>
                );
            })}
        </div>
    );
};

// ---------- Sub-components ----------

/** KPI tile — carte bordée, sparkline optionnelle, cliquable */
const Tile = ({ label, value, sub, tone = "neutral", sparkline, onClick }) => {
    const valueClass =
        tone === "danger" ? "text-rose-600 dark:text-rose-400" :
        tone === "success" ? "text-emerald-700 dark:text-emerald-400" :
        "text-foreground";

    const Comp = onClick ? "button" : "div";

    return (
        <Comp
            type={onClick ? "button" : undefined}
            onClick={onClick}
            className={`rounded-xl border border-border/60 bg-card p-5 flex flex-col gap-1.5 min-h-[104px] text-left w-full ${
                onClick ? "hover:border-foreground/15 hover:bg-muted/30 cursor-pointer transition-colors" : ""
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
                    {label}
                </div>
                {sparkline && sparkline.some((v) => v > 0) && (
                    <MiniSparkline
                        values={sparkline}
                        tone={tone === "danger" ? "danger" : tone === "success" ? "success" : "neutral"}
                    />
                )}
            </div>
            <div className={`text-[26px] font-semibold tracking-tight leading-none tabular-nums ${valueClass}`}>
                {value}
            </div>
            {sub && <div className="text-[12px] text-muted-foreground mt-1 leading-snug">{sub}</div>}
        </Comp>
    );
};

const Panel = ({ children, className = "", id }) => (
    <div id={id} className={`rounded-xl border border-border/60 bg-card p-5 ${className}`}>
        {children}
    </div>
);

const PanelLabel = ({ children, hint }) => (
    <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-[13px] font-medium text-foreground">{children}</span>
        {hint && <span className="text-[11px] text-muted-foreground shrink-0">{hint}</span>}
    </div>
);

/** Horizontal bar chart for column distribution */
const ColumnBar = ({ byColumn }) => {
    const total = byColumn.reduce((s, c) => s + c.count, 0);
    if (total === 0) return <p className="text-xs text-muted-foreground">Aucun lead</p>;
    const max = Math.max(...byColumn.map((c) => c.count), 1);
    return (
        <div className="space-y-2.5">
            {byColumn.filter((c) => c.count > 0).map((c) => {
                const intensity = c.count / max;
                return (
                    <div key={c.id || c.name} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 truncate shrink-0">{c.name}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                    width: `${(c.count / total) * 100}%`,
                                    backgroundColor: `hsl(${CHART_HUE})`,
                                    opacity: heatOpacity(intensity),
                                }}
                            />
                        </div>
                        <span className="text-xs tabular-nums text-foreground/70 w-8 text-right shrink-0 font-medium">{c.count}</span>
                    </div>
                );
            })}
        </div>
    );
};

function isNoContactLead(l) {
    return !l.phone && !l.email && !l.website;
}

function isOverdueLead(l) {
    return !!(l.autoFollowup && (l.autoFollowup.overdue || new Date(l.autoFollowup.dueAt) <= new Date()));
}

/** Collecte les leads d'alerte, groupés par espace (ordre des workspaces) */
function collectAlertLeads(workspaces, type) {
    const predicate = type === "nocontact" ? isNoContactLead : isOverdueLead;
    return workspaces
        .map((ws) => {
            const leads = Object.values(ws.leads)
                .filter(predicate)
                .sort((a, b) => (a.company || "").localeCompare(b.company || "", "fr", { sensitivity: "base" }))
                .map((lead) => ({
                    lead,
                    columnName: ws.columns[lead.columnId]?.name || "—",
                }));
            return { workspace: ws, leads };
        })
        .filter((g) => g.leads.length > 0);
}

/** Dialogue listant les leads d'une alerte, séparés par ligne, triés par espace */
const AlertLeadsDialog = ({ open, onOpenChange, type, groups, onOpenLead }) => {
    const total = groups.reduce((s, g) => s + g.leads.length, 0);
    const title = type === "nocontact"
        ? "Leads sans coordonnées"
        : "Rappels en retard";
    const description = type === "nocontact"
        ? `${total} lead${total > 1 ? "s" : ""} sans téléphone, email ni site — regroupés par espace`
        : `${total} rappel${total > 1 ? "s" : ""} en retard — regroupés par espace`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-lg p-0 gap-0 overflow-hidden rounded-2xl"
                data-testid="alert-leads-dialog"
            >
                <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 text-left">
                    <DialogTitle className="text-[17px] font-semibold tracking-tight">
                        {title}
                    </DialogTitle>
                    <DialogDescription className="text-[13px]">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[min(70vh,520px)] overflow-y-auto">
                    {groups.length === 0 ? (
                        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                            Aucun lead dans cette catégorie.
                        </div>
                    ) : (
                        groups.map(({ workspace, leads }) => (
                            <div key={workspace.id}>
                                <div className="sticky top-0 z-10 px-5 py-2 bg-muted/80 backdrop-blur-sm border-b border-border/40">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[12px] font-semibold text-foreground truncate">
                                            {workspace.name}
                                        </span>
                                        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                                            {leads.length}
                                        </span>
                                    </div>
                                    {workspace.sector && (
                                        <span className="text-[11px] text-muted-foreground">{workspace.sector}</span>
                                    )}
                                </div>
                                <ul className="divide-y divide-border/50">
                                    {leads.map(({ lead, columnName }) => (
                                        <li key={lead.id}>
                                            <button
                                                type="button"
                                                data-testid={`alert-lead-${lead.id}`}
                                                onClick={() => onOpenLead(workspace.id, lead.id)}
                                                className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors group"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[14px] font-medium text-foreground truncate">
                                                        {lead.company || "Sans nom"}
                                                    </div>
                                                    <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                                                        {columnName}
                                                        {type === "overdue" && lead.autoFollowup?.stage != null && (
                                                            <span> · étape {lead.autoFollowup.stage}/3</span>
                                                        )}
                                                        {lead.contact && <span> · {lead.contact}</span>}
                                                    </div>
                                                </div>
                                                <ChevronRight
                                                    size={15}
                                                    className="text-muted-foreground/50 group-hover:text-foreground shrink-0 transition-colors"
                                                />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

/** Grille Alertes & qualité — 4 tuiles cliquables */
const AlertQualityGrid = ({ overdue, noContact, lost, active, onOpenAlert, onFocusLost, onFocusPipeline }) => {
    const tiles = [
        {
            key: "overdue",
            label: "Rappels en retard",
            value: overdue,
            tone: overdue > 0 ? "danger" : "neutral",
            onClick: overdue > 0 ? () => onOpenAlert("overdue") : undefined,
        },
        {
            key: "nocontact",
            label: "Sans coordonnées",
            value: noContact,
            tone: noContact > 0 ? "danger" : "neutral",
            onClick: noContact > 0 ? () => onOpenAlert("nocontact") : undefined,
        },
        {
            key: "lost",
            label: "Leads perdus",
            value: lost,
            tone: "neutral",
            onClick: onFocusLost,
        },
        {
            key: "active",
            label: "Pipeline actif",
            value: active,
            tone: "neutral",
            onClick: onFocusPipeline,
        },
    ];

    return (
        <div>
            <PanelLabel>Alertes & qualité</PanelLabel>
            <div className="grid grid-cols-2 gap-2.5">
                {tiles.map((t) => {
                    const Comp = t.onClick ? "button" : "div";
                    return (
                        <Comp
                            key={t.key}
                            type={t.onClick ? "button" : undefined}
                            onClick={t.onClick}
                            className={`rounded-xl p-4 text-left border transition-colors ${
                                t.tone === "danger"
                                    ? "bg-rose-50/90 dark:bg-rose-500/10 border-rose-200/80 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/15"
                                    : "bg-muted/40 border-border/50 hover:bg-muted/70"
                            } ${t.onClick ? "cursor-pointer" : ""}`}
                        >
                            <div
                                className={`text-[22px] font-semibold tabular-nums leading-none ${
                                    t.tone === "danger"
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-foreground"
                                }`}
                            >
                                {t.value}
                            </div>
                            <div
                                className={`text-[12px] mt-1.5 font-medium ${
                                    t.tone === "danger"
                                        ? "text-rose-700/80 dark:text-rose-300/80"
                                        : "text-muted-foreground"
                                }`}
                            >
                                {t.label}
                            </div>
                        </Comp>
                    );
                })}
            </div>
        </div>
    );
};

/** Vigilance critique/warning + cabinets + conversion croisée */
const VigilanceAgencyPanel = ({
    critical,
    warning,
    agencyCount,
    agencyRate,
    agencyConversion,
    directConversion,
    onFocusCritical,
    onFocusWarning,
    onFocusAgency,
}) => {
    const tiles = [
        {
            key: "critical",
            label: "Vigilance critique",
            value: critical,
            tone: critical > 0 ? "danger" : "neutral",
            onClick: critical > 0 ? onFocusCritical : undefined,
        },
        {
            key: "warning",
            label: "Vigilance warning",
            value: warning,
            tone: warning > 0 ? "danger" : "neutral",
            onClick: warning > 0 ? onFocusWarning : undefined,
        },
        {
            key: "agency",
            label: "Suspects cabinet",
            value: agencyCount,
            sub: agencyRate != null ? `${agencyRate.toFixed(0)} % du pipeline` : null,
            tone: "neutral",
            onClick: agencyCount > 0 ? onFocusAgency : undefined,
        },
        {
            key: "conv",
            label: "Conv. cabinet / direct",
            value:
                agencyConversion == null && directConversion == null
                    ? "—"
                    : `${agencyConversion != null ? agencyConversion.toFixed(0) : "—"} / ${directConversion != null ? directConversion.toFixed(0) : "—"} %`,
            sub: "Taux gagné parmi chaque groupe",
            tone: "neutral",
        },
    ];

    return (
        <div data-testid="stats-vigilance-agency">
            <PanelLabel>Vigilance & cabinets</PanelLabel>
            <div className="grid grid-cols-2 gap-2.5">
                {tiles.map((t) => {
                    const Comp = t.onClick ? "button" : "div";
                    return (
                        <Comp
                            key={t.key}
                            type={t.onClick ? "button" : undefined}
                            onClick={t.onClick}
                            data-testid={`stats-vigilance-${t.key}`}
                            className={`rounded-xl p-4 text-left border transition-colors ${
                                t.tone === "danger"
                                    ? "bg-rose-50/90 dark:bg-rose-500/10 border-rose-200/80 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/15"
                                    : "bg-muted/40 border-border/50 hover:bg-muted/70"
                            } ${t.onClick ? "cursor-pointer" : ""}`}
                        >
                            <div
                                className={`text-[22px] font-semibold tabular-nums leading-none ${
                                    t.tone === "danger"
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-foreground"
                                }`}
                            >
                                {t.value}
                            </div>
                            <div
                                className={`text-[12px] mt-1.5 font-medium ${
                                    t.tone === "danger"
                                        ? "text-rose-700/80 dark:text-rose-300/80"
                                        : "text-muted-foreground"
                                }`}
                            >
                                {t.label}
                            </div>
                            {t.sub && (
                                <div className="text-[11px] text-muted-foreground mt-1">{t.sub}</div>
                            )}
                        </Comp>
                    );
                })}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Call Analytics
// ─────────────────────────────────────────────────────────────────────────────

const HourHeatmap = ({ byHour }) => {
    const [tooltip, setTooltip] = useState(null);
    const slots = byHour.filter((h) => h.hour >= 7 && h.hour <= 21);
    const maxTotal = Math.max(...slots.map((h) => h.total), 0);
    const hasData = maxTotal > 0;

    if (!hasData) {
        return (
            <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                    Pas encore d'appels entre 7h et 21h pour afficher le décrochage horaire.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex items-end gap-1 relative" style={{ height: 88 }}>
                {slots.map((h) => {
                    const heightPct = h.total > 0 ? (h.total / maxTotal) * 100 : 0;
                    const rateIntensity = h.rate != null ? h.rate / 100 : 0;
                    return (
                        <div
                            key={h.hour}
                            className="flex-1 flex flex-col items-center justify-end gap-1 cursor-default"
                            onMouseEnter={() => setTooltip(h)}
                            onMouseLeave={() => setTooltip(null)}
                        >
                            <div
                                className="w-full rounded-t-sm transition-all duration-300"
                                style={{
                                    height: `${heightPct}%`,
                                    minHeight: h.total > 0 ? 4 : 0,
                                    backgroundColor: `hsl(${CHART_HUE})`,
                                    opacity: h.total === 0 ? 0.08 : heatOpacity(rateIntensity),
                                }}
                            />
                        </div>
                    );
                })}
            </div>
            <div className="flex gap-1">
                {slots.map((h) => (
                    <div key={h.hour} className="flex-1 text-center text-[9px] text-muted-foreground tabular-nums">
                        {h.hour}h
                    </div>
                ))}
            </div>
            {tooltip && tooltip.total > 0 && (
                <div className="mt-1 text-xs text-center text-foreground bg-background rounded-lg px-3 py-2">
                    <span className="font-semibold">{tooltip.hour}h00</span>
                    {" · "}
                    {tooltip.total} appel{tooltip.total > 1 ? "s" : ""}
                    {" · "}
                    <span className="font-semibold tabular-nums">
                        {tooltip.rate !== null ? `${tooltip.rate.toFixed(0)} % décrochés` : "—"}
                    </span>
                </div>
            )}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: `hsl(${CHART_HUE})`, opacity: 0.25 }} />
                    Faible taux
                </span>
                <span className="text-muted-foreground/70">Hauteur = volume · Opacité = taux</span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: `hsl(${CHART_HUE})`, opacity: 1 }} />
                    Fort taux
                </span>
            </div>
        </div>
    );
};

const DayOfWeekBars = ({ byDayOfWeek }) => {
    const slots = byDayOfWeek.filter((d) => d.day !== 0 || d.total > 0);
    const maxTotal = Math.max(...slots.map((d) => d.total), 1);
    const hasData = slots.some((d) => d.total > 0);

    if (!hasData) {
        return (
            <div className="py-6 text-center text-sm text-muted-foreground">
                Aucun appel enregistré par jour de semaine.
            </div>
        );
    }

    return (
        <div className="space-y-2.5">
            {slots.map((d) => {
                const rate = d.rate ?? 0;
                const rateIntensity = rate / 100;
                return (
                    <div key={d.day} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-8 shrink-0 font-medium">{d.label}</span>
                        <div className="flex-1 h-5 rounded-md bg-muted overflow-hidden relative">
                            <div
                                className="h-full rounded-md transition-all duration-500"
                                style={{
                                    width: `${(d.total / maxTotal) * 100}%`,
                                    backgroundColor: `hsl(${CHART_HUE})`,
                                    opacity: d.total === 0 ? 0.1 : heatOpacity(rateIntensity),
                                }}
                            />
                        </div>
                        <div className="text-right w-28 shrink-0 flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground tabular-nums">{d.total}</span>
                            {d.total > 0 && (
                                <span className="text-xs font-medium tabular-nums text-foreground/80">
                                    {rate.toFixed(0)} %
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const CallSparkline = ({ last30Days }) => {
    const [hovered, setHovered] = useState(null);
    const maxTotal = Math.max(...last30Days.map((d) => d.total), 1);
    const hasData = last30Days.some((d) => d.total > 0);
    const W = 560, H = 80, PAD = { top: 8, right: 8, bottom: 28, left: 8 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const BAR_W = Math.max(2, Math.floor(innerW / last30Days.length) - 2);

    if (!hasData) {
        return (
            <div className="py-8 text-center text-sm text-muted-foreground">
                Aucune activité téléphonique sur les 30 derniers jours.
            </div>
        );
    }

    return (
        <div className="relative w-full" style={{ aspectRatio: `${W}/${H}` }}>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" onMouseLeave={() => setHovered(null)}>
                {last30Days.map((d, i) => {
                    const x = PAD.left + (i / last30Days.length) * innerW + (innerW / last30Days.length - BAR_W) / 2;
                    const totalH = (d.total / maxTotal) * innerH;
                    const answeredH = d.total > 0 ? (d.answered / d.total) * totalH : 0;
                    const rateIntensity = (d.rate ?? 0) / 100;

                    const showLabel = i === 0 || i === 14 || i === last30Days.length - 1;
                    const labelDate = new Date(d.date);
                    const labelStr = labelDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

                    return (
                        <g key={d.date}>
                            {d.total > 0 && (
                                <rect
                                    x={x} y={PAD.top + innerH - totalH}
                                    width={BAR_W} height={totalH}
                                    fill={`hsl(${CHART_HUE})`}
                                    opacity={0.12}
                                    rx={2}
                                />
                            )}
                            {d.answered > 0 && (
                                <rect
                                    x={x} y={PAD.top + innerH - answeredH}
                                    width={BAR_W} height={answeredH}
                                    fill={`hsl(${CHART_HUE})`}
                                    opacity={heatOpacity(rateIntensity)}
                                    rx={2}
                                />
                            )}
                            <rect
                                x={x - 2} y={PAD.top}
                                width={BAR_W + 4} height={innerH}
                                fill="transparent"
                                onMouseEnter={() => setHovered({ ...d, x: x + BAR_W / 2 })}
                            />
                            {showLabel && (
                                <text x={x + BAR_W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
                                    {labelStr}
                                </text>
                            )}
                        </g>
                    );
                })}

                {hovered && hovered.total > 0 && (() => {
                    const tx = Math.min(Math.max(hovered.x, 55), W - 55);
                    const labelDate = new Date(hovered.date);
                    const labelStr = labelDate.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
                    const rate = hovered.rate ?? 0;
                    return (
                        <g>
                            <rect x={tx - 52} y={4} width={104} height={38} rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1" />
                            <text x={tx} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="hsl(var(--foreground))">{labelStr}</text>
                            <text x={tx} y={34} textAnchor="middle" fontSize="9.5" fill="hsl(var(--muted-foreground))">
                                {hovered.answered}/{hovered.total} décrochés ({rate.toFixed(0)} %)
                            </text>
                        </g>
                    );
                })()}
            </svg>

            <div className="flex items-center gap-4 justify-center mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: `hsl(${CHART_HUE})`, opacity: 0.12 }} />
                    Total appels
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: `hsl(${CHART_HUE})`, opacity: 0.85 }} />
                    Décrochés
                </span>
            </div>
        </div>
    );
};

const PhoneActivityBlock = ({ callStats, wordFreq = [] }) => {
    const { totalCalls, totalAnswered, globalAnswerRate, streak, byHour, byDayOfWeek, last30Days, bestHour, bestDay } = callStats;
    const [detailsOpen, setDetailsOpen] = useState(false);

    if (totalCalls === 0) {
        return (
            <Panel>
                <PanelLabel>Activité téléphonique</PanelLabel>
                <div className="py-6 text-center">
                    <Phone size={18} className="mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">
                        Aucun appel enregistré. Les stats apparaîtront après vos premiers appels.
                    </p>
                </div>
            </Panel>
        );
    }

    const answerTone =
        globalAnswerRate === null ? "neutral" :
        globalAnswerRate >= 50 ? "success" :
        globalAnswerRate < 25 ? "danger" :
        "neutral";

    return (
        <Panel>
            <PanelLabel hint={`${totalCalls} appel${totalCalls > 1 ? "s" : ""}`}>Activité téléphonique</PanelLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-[0.06em] font-medium">Total</div>
                    <div className="text-[22px] font-semibold tabular-nums mt-1">{totalCalls}</div>
                </div>
                <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-[0.06em] font-medium">Décrochés</div>
                    <div className="text-[22px] font-semibold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">{totalAnswered}</div>
                </div>
                <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-[0.06em] font-medium">Taux</div>
                    <div className={`text-[22px] font-semibold tabular-nums mt-1 ${
                        answerTone === "success" ? "text-emerald-700 dark:text-emerald-400" :
                        answerTone === "danger" ? "text-rose-600 dark:text-rose-400" : ""
                    }`}>
                        {globalAnswerRate !== null ? `${globalAnswerRate.toFixed(1)} %` : "—"}
                    </div>
                </div>
                <div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-[0.06em] font-medium">Série</div>
                    <div className="text-[22px] font-semibold tabular-nums mt-1">{streak} j</div>
                </div>
            </div>

            <CallSparkline last30Days={last30Days} />

            {wordFreq?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border/50">
                    <div className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium mb-2">
                        Mots récurrents (appels)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {wordFreq.map((w) => (
                            <span
                                key={w.word}
                                className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] bg-muted/50 text-foreground border border-border/40"
                            >
                                <span className="font-medium">{w.word}</span>
                                <span className="tabular-nums text-muted-foreground">{w.count}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger className="mt-4 text-[13px] font-medium text-primary hover:underline inline-flex items-center gap-1">
                    {detailsOpen ? "Masquer le détail" : "Voir heures & jours"}
                    <ChevronDown size={14} className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 space-y-6">
                    {(bestHour || bestDay) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {bestHour && (
                                <div className="rounded-xl bg-muted/40 p-4 flex items-start gap-3">
                                    <Star size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium">Meilleure heure</div>
                                        <div className="text-[18px] font-semibold mt-1 tabular-nums">{bestHour.hour}h00 – {bestHour.hour + 1}h00</div>
                                        <div className="text-[12px] text-muted-foreground mt-1">
                                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">{bestHour.rate.toFixed(0)} %</span>
                                            {" · "}{bestHour.total} appels
                                        </div>
                                    </div>
                                </div>
                            )}
                            {bestDay && (
                                <div className="rounded-xl bg-muted/40 p-4 flex items-start gap-3">
                                    <Star size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium">Meilleur jour</div>
                                        <div className="text-[18px] font-semibold mt-1">{bestDay.label}</div>
                                        <div className="text-[12px] text-muted-foreground mt-1">
                                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">{bestDay.rate.toFixed(0)} %</span>
                                            {" · "}{bestDay.total} appels
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <div>
                        <PanelLabel hint="7h–21h">Décrochage par heure</PanelLabel>
                        <HourHeatmap byHour={byHour} />
                    </div>
                    <div>
                        <PanelLabel>Par jour de la semaine</PanelLabel>
                        <DayOfWeekBars byDayOfWeek={byDayOfWeek} />
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </Panel>
    );
};

// ---------- Main component ----------
export const StatsDashboard = ({ alertRequest = null, onAlertRequestHandled }) => {
    const { state, dispatch } = useCrm();
    const workspaces = state.order.map((id) => state.workspaces[id]).filter(Boolean);
    const [view, setView] = useState("total");
    const [alertType, setAlertType] = useState(null);

    useEffect(() => {
        if (!alertRequest) return;
        setAlertType(alertRequest);
        onAlertRequestHandled?.();
    }, [alertRequest, onAlertRequestHandled]);

    const statsPerWs = useMemo(
        () => workspaces.map((ws) => ({ ws, stats: computeWorkspaceStats(ws, { includeQuality: true }) })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [state.workspaces]
    );

    const totalStats = useMemo(
        () => aggregateStats(statsPerWs.map((s) => s.stats)),
        [statsPerWs]
    );

    const scopedWorkspaces = useMemo(
        () => (view === "total" ? workspaces : workspaces.filter((ws) => ws.id === view)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [state.workspaces, view]
    );

    const callStats = useMemo(() => {
        return computeCallStats(scopedWorkspaces);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.workspaces, view]);

    const wordFreq = useMemo(() => {
        return computeTranscriptWordFreq(scopedWorkspaces);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.workspaces, view]);

    const activity = useMemo(
        () => computeActivitySeries(scopedWorkspaces),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [state.workspaces, view]
    );

    const trends = useMemo(
        () => computeMonthOverMonthTrends(scopedWorkspaces),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [state.workspaces, view]
    );

    const alertGroups = useMemo(
        () => (alertType ? collectAlertLeads(scopedWorkspaces, alertType) : []),
        [scopedWorkspaces, alertType]
    );

    const current = view === "total"
        ? totalStats
        : statsPerWs.find((s) => s.ws.id === view)?.stats || null;

    const openLeadFromAlert = (workspaceId, leadId) => {
        try {
            sessionStorage.setItem(
                PENDING_LEAD_KEY,
                JSON.stringify({ workspaceId, leadId, t: Date.now() })
            );
        } catch { /* ignore */ }
        setAlertType(null);
        dispatch({ type: "SELECT_WORKSPACE", id: workspaceId });
        try {
            window.dispatchEvent(
                new CustomEvent("crm:pending-lead", { detail: { workspaceId, leadId } })
            );
        } catch { /* ignore */ }
    };

    const openWorkspace = (workspaceId) => {
        dispatch({ type: "SELECT_WORKSPACE", id: workspaceId });
    };

    const openWorkspaceWithFilter = (workspaceId, filterTag) => {
        try {
            if (filterTag) {
                sessionStorage.setItem(
                    PENDING_FILTER_KEY,
                    JSON.stringify({ workspaceId, filter: filterTag })
                );
            }
        } catch { /* ignore */ }
        dispatch({ type: "SELECT_WORKSPACE", id: workspaceId });
    };

    const pickWsByStat = (statKey) => {
        if (view !== "total") {
            return statsPerWs.find((s) => s.ws.id === view) || null;
        }
        return [...statsPerWs].sort(
            (a, b) => (b.stats[statKey] || 0) - (a.stats[statKey] || 0)
        )[0] || null;
    };

    if (!workspaces.length) return null;

    const conversionTone =
        current?.conversionRate == null ? "neutral" :
        current.conversionRate >= 30 ? "success" :
        current.conversionRate === 0 && current.total > 0 ? "danger" :
        "neutral";

    const lostTone =
        current?.lostRate != null && current.lostRate >= 20 ? "danger" : "neutral";

    return (
        <div className="space-y-8" data-testid="stats-dashboard">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    Indicateurs pour comprendre où le pipeline freine
                </p>
                <div className="relative self-start sm:self-auto">
                    <select
                        value={view}
                        onChange={(e) => setView(e.target.value)}
                        className="appearance-none h-9 pl-3.5 pr-8 rounded-lg border border-border/60 bg-card text-sm font-medium text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
                        aria-label="Choisir la vue des statistiques"
                    >
                        <option value="total">Tous les espaces</option>
                        {workspaces.map((ws) => (
                            <option key={ws.id} value={ws.id}>{ws.name}</option>
                        ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
            </div>

            <AlertLeadsDialog
                open={!!alertType}
                onOpenChange={(v) => !v && setAlertType(null)}
                type={alertType}
                groups={alertGroups}
                onOpenLead={openLeadFromAlert}
            />

            {current && current.total > 0 ? (
                <div className="space-y-8">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Tile
                            label="Total leads"
                            value={current.total}
                            sub={formatTrendLabel(trends.leadsPct) || `${current.active} actifs`}
                            sparkline={activity.leadsCreatedValues}
                            tone={trends.leadsPct != null && trends.leadsPct > 0 ? "success" : "neutral"}
                        />
                        <Tile
                            label="Taux de conversion"
                            value={pct(current.conversionRate)}
                            sub={`${current.won} gagné${current.won > 1 ? "s" : ""}`}
                            tone={conversionTone}
                        />
                        <Tile
                            label="Taux de perte"
                            value={pct(current.lostRate)}
                            sub={`${current.lost} perdu${current.lost > 1 ? "s" : ""}`}
                            tone={lostTone}
                        />
                        <Tile
                            label="Notes totales"
                            value={current.totalNotes}
                            sub={formatTrendLabel(trends.notesPct) || `Activité ${relativeDate(current.lastActivityAt)}`}
                            sparkline={activity.notesValues}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Tile
                            label="Délai moyen avant contact"
                            value={formatDuration(current.avgTimeToContact)}
                            sub="De Nouveau au 1er contact"
                        />
                        <Tile
                            label="Durée moy. dans le pipeline"
                            value={formatDuration(current.avgPipelineDuration)}
                            sub="Leads actifs uniquement"
                        />
                        <Tile
                            label="Durée moy. pour closer"
                            value={formatDuration(current.avgClosingDuration)}
                            sub="De création à Gagné"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Tile
                            label="RDV avant close"
                            value={
                                current.avgRdvsBeforeClose == null
                                    ? "—"
                                    : Number(current.avgRdvsBeforeClose).toLocaleString("fr-FR", {
                                        maximumFractionDigits: 1,
                                    })
                            }
                            sub={`${current.won} deal${current.won > 1 ? "s" : ""} gagné${current.won > 1 ? "s" : ""}`}
                        />
                        <Tile
                            label="CA deals gagnés"
                            value={fmtEur(current.wonRevenue || 0)}
                            sub="Uniquement colonne Gagné / Closé"
                            tone={(current.wonRevenue || 0) > 0 ? "success" : "neutral"}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Panel>
                            <PanelLabel>Distribution par colonne</PanelLabel>
                            <ColumnBar byColumn={current.byColumn} />
                        </Panel>
                        <Panel>
                            <PanelLabel hint={current.lost ? `${current.lost} perdu${current.lost > 1 ? "s" : ""}` : undefined}>
                                Motifs de perte
                            </PanelLabel>
                            {current.lostReasons && current.lostReasons.length > 0 ? (
                                <div className="space-y-2.5 mt-3" data-testid="lost-reasons-chart">
                                    {(() => {
                                        const max = Math.max(...current.lostReasons.map((r) => r.count), 1);
                                        return current.lostReasons.map((r) => {
                                            const intensity = r.count / max;
                                            return (
                                                <div key={r.label} className="flex items-center gap-3">
                                                    <span className="text-xs text-muted-foreground w-[140px] shrink-0 truncate" title={r.label}>
                                                        {r.label}
                                                    </span>
                                                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-rose-500/80 transition-all duration-500"
                                                            style={{ width: `${intensity * 100}%`, opacity: 0.35 + intensity * 0.65 }}
                                                        />
                                                    </div>
                                                    <span className="text-xs tabular-nums text-muted-foreground w-6 text-right shrink-0">
                                                        {r.count}
                                                    </span>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground py-6 text-center">
                                    Aucun motif encore — glissez un lead en Perdu pour le QCM rapide.
                                </p>
                            )}
                        </Panel>
                    </div>

                    <Panel>
                        <AlertQualityGrid
                            overdue={current.overdueFollowups || 0}
                            noContact={current.noContact || 0}
                            lost={current.lost || 0}
                            active={current.active || 0}
                            onOpenAlert={setAlertType}
                            onFocusLost={() => {
                                const worst = [...statsPerWs].sort((a, b) => (b.stats.lost || 0) - (a.stats.lost || 0))[0];
                                if (worst?.stats.lost > 0) openWorkspace(worst.ws.id);
                            }}
                            onFocusPipeline={() => {
                                document.getElementById("stats-perf-table")?.scrollIntoView({ behavior: "smooth" });
                            }}
                        />
                    </Panel>

                    <Panel>
                        <VigilanceAgencyPanel
                            critical={current.vigilanceCriticalCount || 0}
                            warning={current.vigilanceWarningCount || 0}
                            agencyCount={current.agencySuspectCount || 0}
                            agencyRate={current.agencyRate}
                            agencyConversion={current.agencyConversionRate}
                            directConversion={current.directConversionRate}
                            onFocusCritical={() => {
                                const target = pickWsByStat("vigilanceCriticalCount");
                                if (target?.stats.vigilanceCriticalCount > 0) {
                                    openWorkspaceWithFilter(target.ws.id, "vigilance rouge");
                                }
                            }}
                            onFocusWarning={() => {
                                const target = pickWsByStat("vigilanceWarningCount")
                                    || pickWsByStat("vigilanceCriticalCount");
                                const n = (target?.stats.vigilanceWarningCount || 0)
                                    + (target?.stats.vigilanceCriticalCount || 0);
                                if (target && n > 0) {
                                    openWorkspaceWithFilter(target.ws.id, "vigilance");
                                }
                            }}
                            onFocusAgency={() => {
                                const target = pickWsByStat("agencySuspectCount");
                                if (target?.stats.agencySuspectCount > 0) {
                                    openWorkspaceWithFilter(target.ws.id, "cabinet");
                                }
                            }}
                        />
                    </Panel>

                    <PhoneActivityBlock callStats={callStats} wordFreq={wordFreq} />

                    {current.dealsWithValueCount > 0 && (
                        <div id="stats-revenue" className="space-y-4 scroll-mt-20">
                            <h3 className="text-[18px] font-semibold tracking-tight text-foreground">
                                Chiffre d&apos;affaires
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <Tile
                                    label="CA total"
                                    value={fmtEur(current.totalRevenue)}
                                    sub={`${current.dealsWithValueCount} deal${current.dealsWithValueCount > 1 ? "s" : ""} valorisé${current.dealsWithValueCount > 1 ? "s" : ""}`}
                                    tone="success"
                                />
                                <Tile
                                    label="Prix moyen"
                                    value={fmtEur(current.avgDealValue)}
                                    sub="Moyenne des deals"
                                />
                                <Tile
                                    label="Prix médian"
                                    value={fmtEur(current.medianDealValue)}
                                    sub="50% des deals en dessous"
                                />
                                <Tile
                                    label="Fourchette"
                                    value={current.minDealValue === current.maxDealValue
                                        ? fmtEur(current.minDealValue)
                                        : `${fmtEur(current.minDealValue).replace(" €", "")} – ${fmtEur(current.maxDealValue)}`}
                                    sub="Min – Max"
                                />
                            </div>

                            <Panel>
                                <PanelLabel hint={`${current.dealsWithValueCount} point${current.dealsWithValueCount > 1 ? "s" : ""}`}>
                                    Cumul CA dans le temps
                                </PanelLabel>
                                <PriceChart timeline={current.dealTimeline} />
                            </Panel>

                            {current.dealDistribution && current.dealDistribution.length > 0 && (
                                <Panel>
                                    <PanelLabel>Distribution par tranche de prix</PanelLabel>
                                    <DistributionBars distribution={current.dealDistribution} />
                                </Panel>
                            )}
                        </div>
                    )}

                    {view === "total" && statsPerWs.length > 1 && (
                        <div id="stats-perf-table" className="space-y-4 scroll-mt-20">
                            <h3 className="text-[18px] font-semibold tracking-tight text-foreground">
                                Performance par espace
                            </h3>
                            <div className="rounded-xl overflow-hidden border border-border/60 bg-card">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border/50">
                                            <th className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium">Espace</th>
                                            <th className="text-right px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium">Leads</th>
                                            <th className="text-right px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium hidden sm:table-cell">Actifs</th>
                                            <th className="text-right px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium">Gagnés</th>
                                            <th className="text-right px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium hidden sm:table-cell">Conversion</th>
                                            <th className="text-right px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium hidden md:table-cell">Délai contact</th>
                                            <th className="text-right px-4 py-3 text-[11px] uppercase tracking-[0.06em] text-muted-foreground font-medium hidden md:table-cell">Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {statsPerWs.map(({ ws, stats }, i) => {
                                            const zeroConv = stats.total > 0 && (stats.conversionRate === 0 || stats.conversionRate == null);
                                            return (
                                                <tr
                                                    key={ws.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => openWorkspace(ws.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            openWorkspace(ws.id);
                                                        }
                                                    }}
                                                    className={`border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors cursor-pointer ${
                                                        i % 2 === 1 ? "bg-muted/20" : ""
                                                    }`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <span className="font-semibold text-foreground">{ws.name}</span>
                                                        {ws.sector && (
                                                            <span className="ml-2 text-xs text-muted-foreground font-normal">{ws.sector}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums font-medium">{stats.total}</td>
                                                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell text-muted-foreground">{stats.active}</td>
                                                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                                                        <span className={stats.won > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}>
                                                            {stats.won}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                                                        <span className={
                                                            stats.conversionRate != null && stats.conversionRate >= 30
                                                                ? "text-emerald-700 dark:text-emerald-400 font-medium"
                                                                : zeroConv
                                                                  ? "text-rose-600 dark:text-rose-400 font-medium"
                                                                  : "text-foreground/80"
                                                        }>
                                                            {pct(stats.conversionRate)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell text-muted-foreground text-xs">{formatDuration(stats.avgTimeToContact)}</td>
                                                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell text-muted-foreground">{stats.totalNotes}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
                                <Users size={12} /> Cliquez une ligne pour ouvrir l&apos;espace
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-xl border border-border/60 bg-card p-10 text-center">
                    <BarChart3 size={24} className="mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-sm text-muted-foreground">
                        {current?.total === 0
                            ? "Cet espace n'a pas encore de leads. Les statistiques apparaîtront ici."
                            : "Aucune donnée disponible."}
                    </p>
                </div>
            )}
        </div>
    );
};
