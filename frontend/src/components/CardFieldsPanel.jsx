import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useCrm } from "@/context/CrmContext";
import { DEFAULT_CARD_FIELDS } from "@/context/CrmContext";
import { GripVertical, Eye, EyeOff, PanelsLeftRight, Trash2, GalleryHorizontal, AlertTriangle, Building2, GitBranch, RotateCcw, Rows3, LayoutList } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
    RULE_DEFS,
    normalizeInconsistencyConfig,
    defaultInconsistencyConfig,
} from "@/lib/inconsistencyRules";
import { isAgencyDetectionEnabled } from "@/lib/agencyDetection";
import { isRelia2Export } from "@/lib/reliaVariant";
import {
    PIPELINE_ROLE_IDS,
    PIPELINE_ROLE_META,
    normalizePipelineRoles,
    resolvePipelineColumnId,
} from "@/lib/pipelineRoles";

const MIN_WIDTH = 260;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 340;

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.0;
const DEFAULT_SCALE = 1.0;

const ROW_H = 40; // hauteur estimée d'une ligne en px
const SCROLL_ZONE = 48; // zone en px depuis le bord qui déclenche l'auto-scroll
const SCROLL_SPEED = 8; // px par frame

/**
 * Popover content for configuring card fields visibility/order,
 * column width, and card scale (persisted in workspace).
 */
export const CardFieldsPanel = ({ workspace }) => {
    const { dispatch } = useCrm();
    const listRef = useRef(null);
    const [confirmResetView, setConfirmResetView] = useState(false);

    // Drag state — pointer-based pour un glisser fluide avec auto-scroll
    const dragState = useRef({
        active: false,
        fromIdx: null,
        toIdx: null,
        ghostY: 0,
        startY: 0,
        itemH: ROW_H,
        rafId: null,
        pointerY: 0,
    });
    const [draggingIdx, setDraggingIdx] = useState(null);
    const [overIdx, setOverIdx] = useState(null);

    const currentWidth = workspace.columnWidth ?? DEFAULT_WIDTH;
    const currentScale = workspace.cardScale ?? DEFAULT_SCALE;
    const currentPanelLayout = workspace.panelInfoLayout === "rows" ? "rows" : "classic";
    const inconsistencyConfig = normalizeInconsistencyConfig(workspace.inconsistencyConfig);
    const agencyDetectionOn = isAgencyDetectionEnabled(workspace);

    const patchInconsistencyConfig = (partial) => {
        const next = {
            ...inconsistencyConfig,
            ...partial,
            enabled: { ...inconsistencyConfig.enabled, ...(partial.enabled || {}) },
            thresholds: { ...inconsistencyConfig.thresholds, ...(partial.thresholds || {}) },
        };
        dispatch({
            type: "SET_INCONSISTENCY_CONFIG",
            workspaceId: workspace.id,
            config: next,
        });
    };

    const extraKeys = useMemo(() => {
        const known = new Set(DEFAULT_CARD_FIELDS.map((f) => f.key));
        const extras = new Set();
        Object.values(workspace.leads).forEach((l) => {
            Object.keys(l.extra || {}).forEach((k) => extras.add(`extra:${k}`));
        });
        return [...extras].filter((k) => !known.has(k));
    }, [workspace.leads]);

    const cfKeys = useMemo(() => {
        const MAIN_BASES = ["téléphone", "telephone", "email", "contact", "contact rh", "site web", "site", "lien offre"];
        const cfSet = new Set();
        Object.values(workspace.leads).forEach((l) => {
            (l.customFields || []).forEach((f) => {
                const label = f.label.toLowerCase().trim();
                const isDupe = MAIN_BASES.some((base) =>
                    new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\d+$").test(label)
                );
                if (isDupe) cfSet.add(f.label);
            });
        });
        return [...cfSet];
    }, [workspace.leads]);

    const fields = useMemo(() => {
        const saved = workspace.cardFields && workspace.cardFields.length > 0
            ? workspace.cardFields : [];
        const savedMap = new Map(saved.map((f) => [f.key, f]));
        const merged = DEFAULT_CARD_FIELDS.map((def) =>
            savedMap.has(def.key) ? savedMap.get(def.key) : def
        );
        saved.forEach((f) => {
            if ((f.key.startsWith("extra:") || f.key.startsWith("cf:")) && !merged.find((m) => m.key === f.key))
                merged.push(f);
        });
        const existingKeys = new Set(merged.map((f) => f.key));
        extraKeys.filter((k) => !existingKeys.has(k)).forEach((k) => {
            merged.push({ key: k, label: k.replace("extra:", ""), visible: false });
        });
        cfKeys.filter((label) => !existingKeys.has("cf:" + label)).forEach((label) => {
            merged.push({ key: "cf:" + label, label, visible: true });
        });
        return merged;
    }, [workspace.cardFields, extraKeys, cfKeys]);

    const toggle = (key) => {
        const updated = fields.map((f) => f.key === key ? { ...f, visible: !f.visible } : f);
        dispatch({ type: "SET_CARD_FIELDS", workspaceId: workspace.id, fields: updated });
    };

    const deleteExtraField = (key) => {
        if (key.startsWith("cf:")) {
            const label = key.slice(3);
            dispatch({ type: "DELETE_CF_FIELD", workspaceId: workspace.id, label });
        } else {
            dispatch({ type: "DELETE_EXTRA_FIELD", workspaceId: workspace.id, fieldKey: key });
        }
    };

    const visibleCount = fields.filter((f) => f.visible).length;
    const allVisible = visibleCount === fields.length;

    const toggleAll = () => {
        dispatch({
            type: "SET_CARD_FIELDS",
            workspaceId: workspace.id,
            fields: fields.map((f) => ({ ...f, visible: !allVisible })),
        });
    };

    const handleWidthChange = (e) => {
        dispatch({ type: "SET_COLUMN_WIDTH", workspaceId: workspace.id, width: Number(e.target.value) });
    };

    const handleScaleChange = (e) => {
        dispatch({ type: "SET_CARD_SCALE", workspaceId: workspace.id, scale: Number(e.target.value) });
    };

    // ── Pointer drag handlers ──────────────────────────────────────────────────
    const commitReorder = useCallback((fromIdx, toIdx) => {
        if (fromIdx === null || toIdx === null || fromIdx === toIdx) return;
        const reordered = [...fields];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        dispatch({ type: "SET_CARD_FIELDS", workspaceId: workspace.id, fields: reordered });
    }, [fields, dispatch, workspace.id]);

    const getIndexFromY = useCallback((clientY) => {
        const el = listRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const relY = clientY - rect.top + el.scrollTop;
        const idx = Math.floor(relY / dragState.current.itemH);
        return Math.max(0, Math.min(fields.length - 1, idx));
    }, [fields.length]);

    const autoScroll = useCallback(() => {
        const el = listRef.current;
        if (!el || !dragState.current.active) return;
        const rect = el.getBoundingClientRect();
        const y = dragState.current.pointerY;
        const distFromTop = y - rect.top;
        const distFromBottom = rect.bottom - y;
        if (distFromTop < SCROLL_ZONE) {
            el.scrollTop -= SCROLL_SPEED * (1 - distFromTop / SCROLL_ZONE);
        } else if (distFromBottom < SCROLL_ZONE) {
            el.scrollTop += SCROLL_SPEED * (1 - distFromBottom / SCROLL_ZONE);
        }
        const newIdx = getIndexFromY(y);
        if (newIdx !== dragState.current.toIdx) {
            dragState.current.toIdx = newIdx;
            setOverIdx(newIdx);
        }
        dragState.current.rafId = requestAnimationFrame(autoScroll);
    }, [getIndexFromY]);

    const onGripPointerDown = useCallback((e, index) => {
        e.preventDefault();
        e.stopPropagation();
        const el = listRef.current;
        if (!el) return;
        // Mesure la hauteur réelle d'une ligne
        const rows = el.querySelectorAll("[data-field-row]");
        const itemH = rows[0]?.getBoundingClientRect().height || ROW_H;
        dragState.current = {
            active: true,
            fromIdx: index,
            toIdx: index,
            startY: e.clientY,
            itemH,
            rafId: null,
            pointerY: e.clientY,
        };
        setDraggingIdx(index);
        setOverIdx(index);

        const onMove = (ev) => {
            dragState.current.pointerY = ev.clientY;
        };
        const onUp = () => {
            cancelAnimationFrame(dragState.current.rafId);
            const { fromIdx, toIdx } = dragState.current;
            dragState.current.active = false;
            setDraggingIdx(null);
            setOverIdx(null);
            commitReorder(fromIdx, toIdx);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        dragState.current.rafId = requestAnimationFrame(autoScroll);
    }, [autoScroll, commitReorder]);

    // Cleanup on unmount
    useEffect(() => () => {
        cancelAnimationFrame(dragState.current.rafId);
    }, []);

    return (
        <div className="w-80">
            {/* ── Slider largeur des colonnes ── */}
            <div className="px-4 pt-4 pb-3 border-b border-border/60">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <PanelsLeftRight size={14} className="text-muted-foreground" />
                        Largeur des colonnes
                    </div>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums">{currentWidth}px</span>
                </div>
                <input type="range" min={MIN_WIDTH} max={MAX_WIDTH} step={10} value={currentWidth} onChange={handleWidthChange}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-border"
                    aria-label="Largeur des colonnes" data-testid="column-width-slider" />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>Étroit</span><span>Large</span>
                </div>
            </div>

            {/* ── Slider taille des cartes ── */}
            <div className="px-4 pt-3 pb-3 border-b border-border/60">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <GalleryHorizontal size={14} className="text-muted-foreground" />
                        Taille des cartes
                    </div>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums">
                        {currentScale === DEFAULT_SCALE ? "100%" : `${Math.round(currentScale * 100)}%`}
                    </span>
                </div>
                <input type="range" min={MIN_SCALE} max={MAX_SCALE} step={0.05} value={currentScale} onChange={handleScaleChange}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-border"
                    aria-label="Taille des cartes" data-testid="card-scale-slider" />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>Compact</span><span>Normal</span>
                </div>
            </div>

            {/* ── Style fiche prospect (panel ouvert) ── */}
            <div className="px-4 pt-3 pb-3 border-b border-border/60" data-testid="panel-info-layout-config">
                <div className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                    <Rows3 size={14} className="text-muted-foreground" />
                    Fiche prospect
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug mb-2.5">
                    Style des infos quand un prospect est ouvert (le Kanban ne change pas).
                </p>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/50 border border-border/60">
                    <button
                        type="button"
                        data-testid="panel-layout-classic"
                        onClick={() => dispatch({
                            type: "SET_PANEL_INFO_LAYOUT",
                            workspaceId: workspace.id,
                            layout: "classic",
                        })}
                        className={`h-8 rounded-lg text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                            currentPanelLayout === "classic"
                                ? "bg-card text-foreground shadow-sm border border-border"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <LayoutList size={13} strokeWidth={2} />
                        Classique
                    </button>
                    <button
                        type="button"
                        data-testid="panel-layout-rows"
                        onClick={() => dispatch({
                            type: "SET_PANEL_INFO_LAYOUT",
                            workspaceId: workspace.id,
                            layout: "rows",
                        })}
                        className={`h-8 rounded-lg text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                            currentPanelLayout === "rows"
                                ? "bg-card text-foreground shadow-sm border border-border"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Rows3 size={13} strokeWidth={2} />
                        Lignes
                    </button>
                </div>
            </div>

            {/* ── Champs visibles ── */}
            <div className="px-4 py-3 border-b border-border/60">
                <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">Champs sur les cartes</div>
                    <button onClick={toggleAll} title={allVisible ? "Tout masquer" : "Tout afficher"}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                            allVisible ? "border-border text-muted-foreground hover:bg-secondary"
                            : "border-primary/30 bg-primary/8 text-primary hover:bg-primary/15"
                        }`}>
                        {allVisible ? <><EyeOff size={12} /> Masquer</> : <><Eye size={12} /> Tout afficher</>}
                    </button>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                    {visibleCount}/{fields.length} visible{visibleCount > 1 ? "s" : ""} · glisser la poignée pour réordonner
                </div>
            </div>

            {/* Liste avec scroll et drag fluide */}
            <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
                {fields.map((f, index) => (
                    <FieldRow
                        key={f.key}
                        field={f}
                        index={index}
                        isDragging={draggingIdx === index}
                        isOver={overIdx === index && draggingIdx !== null && draggingIdx !== index}
                        onToggle={toggle}
                        onDelete={deleteExtraField}
                        onGripDown={onGripPointerDown}
                    />
                ))}
            </div>

            {/* ── Pipeline colonnes ── */}
            <div className="px-4 pt-3 pb-3 border-t border-border/60 space-y-2.5" data-testid="pipeline-roles-config">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <GitBranch size={14} className="text-primary shrink-0" />
                    Rôles des colonnes
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    Pipeline par défaut : Nouveaux → Contactés → Relance → RDV → Gagné → Perdu.
                    Laissez « Auto » pour détecter par le nom, ou forcez une colonne.
                </p>
                <div className="space-y-2">
                    {PIPELINE_ROLE_IDS.map((role) => {
                        const meta = PIPELINE_ROLE_META[role];
                        const roles = normalizePipelineRoles(workspace.pipelineRoles);
                        const override = roles[role];
                        const resolved = resolvePipelineColumnId(workspace, role);
                        return (
                            <label key={role} className="block space-y-0.5">
                                <span className="text-[11px] font-medium text-foreground">{meta.label}</span>
                                <span className="block text-[10px] text-muted-foreground">{meta.hint}</span>
                                <select
                                    value={override || ""}
                                    onChange={(e) => {
                                        const v = e.target.value || null;
                                        dispatch({
                                            type: "SET_PIPELINE_ROLES",
                                            workspaceId: workspace.id,
                                            pipelineRoles: { [role]: v },
                                        });
                                    }}
                                    className="w-full h-8 rounded-md border border-border bg-background px-2 text-[12px]"
                                    data-testid={`pipeline-role-${role}`}
                                >
                                    <option value="">
                                        Auto{resolved ? ` · ${workspace.columns[resolved]?.name || ""}` : " · non détecté"}
                                    </option>
                                    {workspace.columnOrder.map((cid) => (
                                        <option key={cid} value={cid}>
                                            {workspace.columns[cid]?.name || cid}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        );
                    })}
                </div>
            </div>

            {/* ── Remise à zéro de la vue pipeline ── */}
            <div className="px-4 pt-3 pb-3 border-t border-border/60 space-y-2" data-testid="reset-pipeline-view">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <RotateCcw size={14} className="text-muted-foreground shrink-0" />
                    Remettre la vue à zéro
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    Tous les leads reviennent en « Nouveau ». Rappels, RDV, relances auto et
                    statuts gagné/perdu sont effacés. Les fiches (notes, contacts, champs)
                    et vos réglages (champs carte, colonnes, rôles) restent intacts.
                </p>
                {!confirmResetView ? (
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full h-9 rounded-lg text-[12.5px]"
                        data-testid="reset-pipeline-view-btn"
                        onClick={() => setConfirmResetView(true)}
                    >
                        <RotateCcw size={13} className="mr-1.5" />
                        Remettre la vue à zéro…
                    </Button>
                ) : (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/8 p-2.5 space-y-2">
                        <p className="text-[12px] text-rose-700 dark:text-rose-300 leading-snug">
                            Confirmer ? {Object.keys(workspace.leads || {}).length} lead
                            {Object.keys(workspace.leads || {}).length > 1 ? "s" : ""} seront
                            renvoyés en Nouveau.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                className="flex-1 h-8 rounded-lg text-[12px]"
                                onClick={() => setConfirmResetView(false)}
                            >
                                Annuler
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 h-8 rounded-lg text-[12px] bg-rose-600 hover:bg-rose-700 text-white"
                                data-testid="reset-pipeline-view-confirm"
                                onClick={() => {
                                    const count = Object.keys(workspace.leads || {}).length;
                                    dispatch({
                                        type: "RESET_PIPELINE_VIEW",
                                        workspaceId: workspace.id,
                                    });
                                    setConfirmResetView(false);
                                    toast.success("Vue remise à zéro", {
                                        description: count
                                            ? `${count} lead${count > 1 ? "s" : ""} en Nouveau — rappels effacés`
                                            : "Aucun lead à déplacer",
                                    });
                                }}
                            >
                                Confirmer
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Détection cabinets de recrutement (masqué Relia 2) ── */}
            {!isRelia2Export && (
            <div className="px-4 pt-3 pb-3 border-t border-border/60 space-y-2" data-testid="agency-detection-config">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Building2 size={14} className="text-orange-600 shrink-0" />
                    Détection cabinets de recrutement
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    Flag les cabinets / agences d’intérim via mots-clés (nom, secteur importé) — aucune API.
                </p>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] text-foreground">Activer la détection</span>
                    <Switch
                        checked={agencyDetectionOn}
                        onCheckedChange={(v) =>
                            dispatch({
                                type: "SET_AGENCY_DETECTION_ENABLED",
                                workspaceId: workspace.id,
                                enabled: v,
                            })
                        }
                        aria-label="Détection cabinets de recrutement"
                    />
                </div>
            </div>
            )}

            {/* ── Incohérences prospection ── */}
            <div className="px-4 pt-3 pb-3 border-t border-border/60 space-y-3" data-testid="inconsistency-config">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                    Incohérences prospection
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    Règles locales — aucune IA, uniquement les données du lead.
                </p>

                <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] text-foreground">Afficher sur les cartes</span>
                    <Switch
                        checked={inconsistencyConfig.showOnCard}
                        onCheckedChange={(v) => patchInconsistencyConfig({ showOnCard: v })}
                        aria-label="Afficher les incohérences sur les cartes"
                    />
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Sans réponse (j)
                        </span>
                        <input
                            type="number"
                            min={1}
                            max={90}
                            value={inconsistencyConfig.thresholds.noAnswerDays}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                patchInconsistencyConfig({ thresholds: { noAnswerDays: n } });
                            }}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-[12.5px] tabular-nums"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Trou contact (j)
                        </span>
                        <input
                            type="number"
                            min={1}
                            max={365}
                            value={inconsistencyConfig.thresholds.contactGapDays}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                patchInconsistencyConfig({ thresholds: { contactGapDays: n } });
                            }}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-[12.5px] tabular-nums"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Prépa RDV (j ouvrés)
                        </span>
                        <input
                            type="number"
                            min={1}
                            max={60}
                            value={inconsistencyConfig.thresholds.rdvPrepDays}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                patchInconsistencyConfig({ thresholds: { rdvPrepDays: n } });
                            }}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-[12.5px] tabular-nums"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Nouveau stale (j ouvrés)
                        </span>
                        <input
                            type="number"
                            min={1}
                            max={60}
                            value={inconsistencyConfig.thresholds.nouveauStaleDays}
                            onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                patchInconsistencyConfig({ thresholds: { nouveauStaleDays: n } });
                            }}
                            className="w-full h-8 rounded-md border border-border bg-background px-2 text-[12.5px] tabular-nums"
                        />
                    </label>
                </div>

                <div className="space-y-1 max-h-[180px] overflow-y-auto -mx-1 px-1">
                    {RULE_DEFS.map((rule) => (
                        <div
                            key={rule.id}
                            className="flex items-start justify-between gap-2 py-1.5"
                            title={rule.description}
                        >
                            <div className="min-w-0">
                                <div className="text-[12.5px] font-medium text-foreground truncate">
                                    {rule.title}
                                </div>
                                <div className="text-[10px] text-muted-foreground capitalize">
                                    {rule.severity === "critical" ? "critique" : rule.severity === "warning" ? "alerte" : "info"}
                                </div>
                            </div>
                            <Switch
                                checked={!!inconsistencyConfig.enabled[rule.id]}
                                onCheckedChange={(v) =>
                                    patchInconsistencyConfig({ enabled: { [rule.id]: v } })
                                }
                                aria-label={`Activer ${rule.title}`}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div className="px-4 py-2.5 border-t border-border/60 flex items-center justify-between">
                <button
                    onClick={() => {
                        dispatch({ type: "SET_CARD_FIELDS", workspaceId: workspace.id, fields: DEFAULT_CARD_FIELDS });
                        dispatch({ type: "SET_COLUMN_WIDTH", workspaceId: workspace.id, width: DEFAULT_WIDTH });
                        dispatch({ type: "SET_CARD_SCALE", workspaceId: workspace.id, scale: DEFAULT_SCALE });
                        dispatch({ type: "SET_PANEL_INFO_LAYOUT", workspaceId: workspace.id, layout: "classic" });
                        dispatch({
                            type: "SET_INCONSISTENCY_CONFIG",
                            workspaceId: workspace.id,
                            config: defaultInconsistencyConfig(),
                        });
                        dispatch({
                            type: "SET_AGENCY_DETECTION_ENABLED",
                            workspaceId: workspace.id,
                            enabled: true,
                        });
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    Réinitialiser par défaut
                </button>
            </div>
        </div>
    );
};

const FieldRow = ({ field, index, isDragging, isOver, onToggle, onDelete, onGripDown }) => {
    const isExtra = field.key.startsWith("extra:");
    const isCf = field.key.startsWith("cf:");
    const isDeletable = isExtra || isCf;
    const [confirmDel, setConfirmDel] = useState(false);

    return (
        <div
            data-field-row
            className={`flex items-center justify-between px-4 py-2 transition-colors select-none ${
                isDragging ? "opacity-30 bg-secondary"
                : isOver ? "bg-primary/10 border-t-2 border-primary"
                : "hover:bg-secondary/60"
            }`}
        >
            {confirmDel ? (
                <div className="flex items-center gap-2 w-full text-[12px]">
                    <span className="text-rose-600 dark:text-rose-400 font-medium flex-1 truncate">
                        Supprimer « {field.label} » ?
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }}
                        className="px-2 py-0.5 rounded text-muted-foreground hover:bg-secondary transition-colors shrink-0">
                        Annuler
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(field.key); setConfirmDel(false); }}
                        className="px-2 py-0.5 rounded bg-rose-500 text-white hover:bg-rose-600 transition-colors shrink-0 font-medium">
                        Supprimer
                    </button>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {/* Poignée de drag — pointer down pour démarrer */}
                        <div
                            onPointerDown={(e) => onGripDown(e, index)}
                            className="cursor-grab active:cursor-grabbing touch-none shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                            title="Glisser pour réordonner"
                        >
                            <GripVertical size={13} />
                        </div>
                        {field.visible
                            ? <Eye size={13} className="text-primary shrink-0" />
                            : <EyeOff size={13} className="text-muted-foreground/50 shrink-0" />
                        }
                        <span className={`text-sm truncate ${field.visible ? "text-foreground" : "text-muted-foreground"}`}>
                            {field.label}
                        </span>
                        {isExtra && (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                                importé
                            </span>
                        )}
                        {isCf && (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                                coordonnée
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                        {isDeletable && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
                                title={isCf ? `Supprimer ${field.label} de tous les leads` : "Supprimer ce champ importé"}
                                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                        <Switch
                            checked={field.visible}
                            onCheckedChange={() => onToggle(field.key)}
                            aria-label={`Afficher ${field.label}`}
                            className="shrink-0"
                        />
                    </div>
                </>
            )}
        </div>
    );
};
