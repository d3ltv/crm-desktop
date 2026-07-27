/**
 * CsvImportModal.jsx — Import CSV avec deux modes : Rapide et Avancé
 *
 * Mode Rapide  : upload → détection auto → récapitulatif → import en 2 clics
 * Mode Avancé : upload → éditeur visuel (tableau éditable, mapping colonnes,
 *               suppression lignes, recherche/filtre) → récapitulatif → import
 */
import React, { useRef, useState, useMemo, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    FileUp, Upload, ArrowLeft, CheckCircle2,
    Zap, Settings2, Trash2, Search, X,
    ChevronDown, ChevronUp, BookMarked, Sparkles, Star, Loader2,
} from "lucide-react";
import { parseCsv, autoDetectMapping, rowsToLeads, translateHeader, normalizeHeader, findHeaderIndex, CRM_RESERVED_HEADERS, resolveColumnIdByName } from "@/lib/csvUtils";
import {
    findBestProfile, applyProfile, saveProfile, touchProfile,
    updateProfileMapping, getProfile,
} from "@/lib/importProfiles";
import { isAgencyDetectionEnabled } from "@/lib/agencyDetection";
import {
    scanImportLeads,
    applyImportQualityActions,
    AGENCY_IMPORT_TAG,
} from "@/lib/importQualityScan";
import { ImportProfilesManager } from "./ImportProfilesManager";
import { useCrm } from "@/context/CrmContext";
import { toast } from "sonner";

const EMPTY_QUALITY = {
    agencyCount: 0,
    closedAdCount: 0,
    noContactCount: 0,
    agencyIndexes: [],
    closedAdIndexes: [],
    noContactIndexes: [],
};

// ── Constantes ────────────────────────────────────────────────────────────────
const NONE  = "__none__";   // ignorer la colonne
const EXTRA = "__extra__";  // garder comme champ extra

// Champs CRM principaux disponibles comme cibles de mapping
const CRM_FIELDS = [
    { key: "company",      label: "Entreprise",         required: true },
    { key: "contact",      label: "Contact" },
    { key: "phone",        label: "Téléphone" },
    { key: "email",        label: "Email" },
    { key: "website",      label: "Site web" },
    { key: "status",       label: "Colonne / Statut" },
    { key: "tags",         label: "Tags" },
    { key: "notes",        label: "Notes" },
    { key: "next_action",  label: "Prochaine action" },
    { key: "last_contact", label: "Dernier contact" },
    { key: "deal_value",   label: "Valeur du deal" },
    { key: "logo_url",     label: "Logo (URL)" },
    { key: "crm_meta",     label: "Métadonnées CRM" },
];

const CRM_LABEL = Object.fromEntries(CRM_FIELDS.map((f) => [f.key, f.label]));

/** Estime le nombre net de leads après doublons fichier + skipExisting */
function estimateNetImport({
    headers, rows, colMapping, nameHeader,
    dupStrategy, dupDominant, skipExisting, workspace,
}) {
    const summary = computeSummary(headers, rows, colMapping, nameHeader);
    let afterDups = rows.length;
    if (dupStrategy !== "ignore" && Object.keys(summary.duplicateGroups).length > 0) {
        afterDups = applyDuplicateResolution(
            rows, headers, summary.duplicateGroups, dupStrategy, dupDominant, colMapping, nameHeader
        ).length;
    }
    const removedDups = rows.length - afterDups;

    let skippedExisting = 0;
    if (skipExisting && workspace?.leads && afterDups > 0) {
        // Approximation rapide : simuler sur les lignes résolues via company/email mapping
        const legacy = buildLegacyMapping(colMapping);
        const preview = rowsToLeads(
            headers,
            dupStrategy !== "ignore" && Object.keys(summary.duplicateGroups).length > 0
                ? applyDuplicateResolution(rows, headers, summary.duplicateGroups, dupStrategy, dupDominant, colMapping, nameHeader)
                : rows,
            legacy,
            colMapping,
            nameHeader
        );
        const companies = new Set();
        const emails = new Set();
        Object.values(workspace.leads).forEach((l) => {
            const c = normalizeHeader(l.company || "");
            const e = normalizeHeader(l.email || "");
            if (c) companies.add(c);
            if (e) emails.add(e);
        });
        for (const lead of preview) {
            const c = normalizeHeader(lead.company || "");
            const e = normalizeHeader(lead.email || "");
            if ((c && companies.has(c)) || (e && emails.has(e))) {
                skippedExisting++;
                continue;
            }
            if (c) companies.add(c);
            if (e) emails.add(e);
        }
    }

    const net = Math.max(0, afterDups - skippedExisting);
    return {
        ...summary,
        groupCount: Object.keys(summary.duplicateGroups).length,
        removedDups,
        afterDups,
        skippedExisting,
        net,
    };
}

/**
 * Brouillons leads après résolution doublons + skipExisting (même pipeline que doImport).
 * @returns {object[]}
 */
function buildImportPreviewLeads({
    headers, rows, colMapping, nameHeader,
    dupStrategy, dupDominant, skipExisting, workspace,
}) {
    if (!headers?.length) return [];
    const summary = computeSummary(headers, rows, colMapping, nameHeader);
    let resolvedRows = rows;
    if (dupStrategy !== "ignore" && Object.keys(summary.duplicateGroups).length > 0) {
        resolvedRows = applyDuplicateResolution(
            rows, headers, summary.duplicateGroups, dupStrategy, dupDominant, colMapping, nameHeader
        );
    }
    const legacy = buildLegacyMapping(colMapping);
    let leads = rowsToLeads(headers, resolvedRows, legacy, colMapping, nameHeader)
        .map(({ _incomplete: _i, ...rest }) => rest);

    if (skipExisting && workspace?.leads) {
        const companies = new Set();
        const emails = new Set();
        Object.values(workspace.leads).forEach((l) => {
            const c = normalizeHeader(l.company || "");
            const e = normalizeHeader(l.email || "");
            if (c) companies.add(c);
            if (e) emails.add(e);
        });
        const kept = [];
        for (const lead of leads) {
            const c = normalizeHeader(lead.company || "");
            const e = normalizeHeader(lead.email || "");
            if ((c && companies.has(c)) || (e && emails.has(e))) continue;
            if (c) companies.add(c);
            if (e) emails.add(e);
            kept.push(lead);
        }
        leads = kept;
    }
    return leads;
}

/** Stepper visuel compact */
const ImportStepper = ({ step, fileLoaded }) => {
    const steps = [
        { id: "upload", label: "Fichier" },
        { id: "edit", label: "Préparer" },
        { id: "confirm", label: "Importer" },
    ];
    const active =
        step === "upload" ? 0
        : step === "advanced-edit" ? 1
        : 2; // quick-summary | advanced-summary
    return (
        <div className="flex items-center gap-1.5 mb-1">
            {steps.map((s, i) => {
                const done = i < active || (i === 0 && fileLoaded && active === 0);
                const current = i === active;
                return (
                    <div key={s.id} className="flex items-center gap-1.5">
                        {i > 0 && <div className={`w-6 h-px ${i <= active ? "bg-primary/50" : "bg-border"}`} />}
                        <div className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            current ? "bg-muted text-foreground"
                            : done ? "text-muted-foreground"
                            : "text-muted-foreground/40"
                        }`}>
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                                current ? "bg-foreground text-background"
                                : done ? "bg-muted text-muted-foreground"
                                : "bg-muted text-muted-foreground/40"
                            }`}>
                                {done && !current ? "✓" : i + 1}
                            </span>
                            {s.label}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

/** Chips de mapping — style neutre */
const MappingChips = ({ headers, colMapping, nameHeader, max = 8 }) => {
    const chips = headers.filter(Boolean).map((h) => {
        const target = colMapping[h] ?? EXTRA;
        if (target === NONE) return null;
        const label = target === EXTRA
            ? (translateHeader(h) !== h ? translateHeader(h) : "Extra")
            : (CRM_LABEL[target] || target);
        const isName = h === nameHeader || target === "company";
        return { h, target, label, isName };
    }).filter(Boolean);

    const shown = chips.slice(0, max);
    const rest = chips.length - shown.length;

    return (
        <div className="flex flex-wrap gap-1.5">
            {shown.map(({ h, label, isName }) => (
                <span
                    key={h}
                    title={`${h} → ${label}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border border-border bg-muted/40 text-foreground"
                >
                    {isName && <Star size={8} className="text-muted-foreground fill-muted-foreground/40" />}
                    <span className="text-muted-foreground max-w-[80px] truncate">{h}</span>
                    <span className="text-muted-foreground/40">→</span>
                    <span className="font-medium">{label}</span>
                </span>
            ))}
            {rest > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px]">
                    +{rest}
                </span>
            )}
        </div>
    );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Construit le mapping { fieldKey → csvHeader } depuis colMapping { csvHeader → fieldKey } */
function buildLegacyMapping(colMapping) {
    const m = {};
    Object.entries(colMapping).forEach(([header, target]) => {
        if (target && target !== NONE && target !== EXTRA) m[target] = header;
    });
    return m;
}

/** Détecte et construit le colMapping initial depuis les headers ET les données */
function buildInitialMapping(headers, rows = []) {
    const detected = autoDetectMapping(headers, rows);
    const inverted = {};
    Object.entries(detected).forEach(([field, header]) => { inverted[header] = field; });
    const map = {};
    headers.forEach((h) => {
        if (!h) return;
        if (inverted[h]) {
            map[h] = inverted[h];
            return;
        }
        // Colonnes d'un export CRM natif → mapper automatiquement
        const nh = normalizeHeader(h);
        const reserved = CRM_RESERVED_HEADERS.find((k) => normalizeHeader(k) === nh);
        if (reserved && !Object.values(map).includes(reserved) && !Object.values(inverted).includes(reserved)) {
            map[h] = reserved;
            return;
        }
        // Alias FR courants
        if (nh === "statut" && !Object.values(map).includes("status")) {
            map[h] = "status";
            return;
        }
        map[h] = EXTRA;
    });
    return map;
}

/** Calcule le récapitulatif d'un import */
function computeSummary(headers, rows, colMapping, nameHeader = null) {
    const mapped   = headers.filter((h) => h && colMapping[h] !== NONE && colMapping[h] !== EXTRA);
    const extra    = headers.filter((h) => h && colMapping[h] === EXTRA);
    const ignored  = headers.filter((h) => h && colMapping[h] === NONE);
    // Pas de nom si : aucune colonne mappée sur "company" ET pas de nameHeader épinglé
    const noCompany = !nameHeader && !Object.values(colMapping).includes("company");

    // Détection de doublons sur la colonne "company" — retourne les groupes
    const companyHeader = Object.entries(colMapping).find(([, v]) => v === "company")?.[0];
    const companyIdx    = companyHeader != null ? findHeaderIndex(headers, companyHeader) : -1;
    let duplicates = 0;
    // Map : clé normalisée → [{ rowIdx, row }]
    const duplicateGroups = {}; // { normalizedName: [{ rowIdx, row }] }
    if (companyIdx >= 0) {
        const seen = {}; // normalizedName → first rowIdx
        rows.forEach((r, rowIdx) => {
            // Casse / accents / séparateurs ignorés pour détecter les doublons
            const v = normalizeHeader(r[companyIdx] || "");
            if (!v) return;
            if (seen[v] !== undefined) {
                // Ajouter au groupe
                if (!duplicateGroups[v]) {
                    duplicateGroups[v] = [{ rowIdx: seen[v], row: rows[seen[v]] }];
                }
                duplicateGroups[v].push({ rowIdx, row: r });
                duplicates++;
            } else {
                seen[v] = rowIdx;
            }
        });
    }

    // Valeurs manquantes dans les colonnes mappées CRM
    let missingValues = 0;
    mapped.forEach((h) => {
        const idx = headers.indexOf(h);
        rows.forEach((r) => { if (!(r[idx] || "").trim()) missingValues++; });
    });

    return { mapped, extra, ignored, noCompany, duplicates, duplicateGroups, missingValues };
}

/**
 * Applique la résolution de doublons sur les lignes.
 * @param {string[][]} rows
 * @param {string[]} headers
 * @param {Object} duplicateGroups
 * @param {"ignore"|"keep_first"|"keep_last"|"merge"} strategy
 * @param {string|null} dominantHeader — pour merge : variante du nom d'entreprise à conserver
 * @param {object} [colMapping] — pour identifier la colonne entreprise
 * @returns {string[][]}
 */
function applyDuplicateResolution(rows, headers, duplicateGroups, strategy, dominantHeader, colMapping = {}, nameHeader = null) {
    if (!Object.keys(duplicateGroups).length || strategy === "ignore") return rows;

    const rowsToRemove = new Set();
    const mergedRows   = {};

    const companyHeader = Object.entries(colMapping).find(([, v]) => v === "company")?.[0] || null;
    const companyIdx = companyHeader != null ? findHeaderIndex(headers, companyHeader) : -1;
    const nameIdx = nameHeader ? findHeaderIndex(headers, nameHeader) : -1;

    /** Valeurs uniques (casse/accents ignorés), jointes par virgule */
    const mergeValues = (values) => {
        const seen = new Set();
        const out = [];
        for (const raw of values) {
            const t = (raw || "").trim();
            if (!t) continue;
            const key = normalizeHeader(t);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(t);
        }
        return out.join(", ");
    };

    Object.values(duplicateGroups).forEach((group) => {
        if (strategy === "keep_first") {
            group.slice(1).forEach(({ rowIdx }) => rowsToRemove.add(rowIdx));
            return;
        }
        if (strategy === "keep_last") {
            group.slice(0, -1).forEach(({ rowIdx }) => rowsToRemove.add(rowIdx));
            return;
        }
        if (strategy !== "merge") return;

        // Survivant : 1ʳᵉ ligne, ou celle avec la variante de nom choisie
        let survivorEntry = group[0];
        if (dominantHeader && companyIdx >= 0) {
            // dominantHeader ici = texte exact du nom d'entreprise à garder (optionnel)
            const match = group.find(({ row }) => (row[companyIdx] || "").trim() === dominantHeader);
            if (match) survivorEntry = match;
        }
        const survivorIdx = survivorEntry.rowIdx;

        const merged = headers.map((h, colIdx) => {
            // Nom d'entreprise / nom épinglé : une seule valeur
            if (colIdx === companyIdx || colIdx === nameIdx) {
                return (survivorEntry.row[colIdx] || "").trim();
            }
            // Autres colonnes : fusionner les valeurs distinctes avec ", "
            return mergeValues(group.map(({ row }) => row[colIdx]));
        });

        mergedRows[survivorIdx] = merged;
        group.forEach(({ rowIdx }) => {
            if (rowIdx !== survivorIdx) rowsToRemove.add(rowIdx);
        });
    });

    return rows
        .map((row, idx) => (mergedRows[idx] ? mergedRows[idx] : row))
        .filter((_, idx) => !rowsToRemove.has(idx));
}

// ── Sous-composant : Résolution de doublons (sobre) ───────────────────────────
const DuplicateResolutionPanel = ({
    duplicates,
    duplicateGroups,
    headers,
    colMapping,
    strategy,
    onStrategyChange,
    survivingCount,
}) => {
    const groupEntries = Object.entries(duplicateGroups).slice(0, 2);
    const groupCount = Object.keys(duplicateGroups).length;
    const companyHeader = Object.entries(colMapping).find(([, v]) => v === "company")?.[0];
    const companyIdx = companyHeader != null ? findHeaderIndex(headers, companyHeader) : 0;

    const options = [
        { value: "ignore",     label: "Tout garder",      desc: "Importer chaque ligne" },
        { value: "keep_first", label: "Garder le 1ᵉʳ",    desc: "Une seule ligne (la première)" },
        { value: "keep_last",  label: "Garder le dernier", desc: "Une seule ligne (la dernière)" },
        { value: "merge",      label: "Fusionner",        desc: "1 ligne · données jointes par virgule" },
    ];

    return (
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                    Doublons
                    <span className="font-normal text-muted-foreground">
                        {" "}· {groupCount} groupe{groupCount > 1 ? "s" : ""} · {duplicates} ligne{duplicates > 1 ? "s" : ""} en trop
                    </span>
                </p>
                {strategy !== "ignore" && survivingCount != null && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                        → {survivingCount} ligne{survivingCount > 1 ? "s" : ""}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
                {options.map((opt) => {
                    const selected = strategy === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => onStrategyChange(opt.value)}
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                                selected
                                    ? "border-foreground/25 bg-muted"
                                    : "border-border bg-background hover:bg-muted/40"
                            }`}
                        >
                            <span className="text-[12px] font-medium block">{opt.label}</span>
                            <span className="text-[11px] text-muted-foreground leading-snug">{opt.desc}</span>
                        </button>
                    );
                })}
            </div>

            {strategy === "merge" && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Le nom d'entreprise est conservé tel quel. Les autres champs concatènent
                    les valeurs distinctes séparées par une virgule.
                </p>
            )}

            {groupEntries.length > 0 && strategy !== "ignore" && (
                <div className="space-y-1 border-t border-border/60 pt-2">
                    {groupEntries.map(([name, group]) => (
                        <p key={name} className="text-[11.5px] text-muted-foreground truncate">
                            <span className="text-foreground font-medium">
                                {group[0].row[companyIdx] || name}
                            </span>
                            {" "}· {group.length} lignes
                            {strategy === "merge" && " → 1 fusionnée"}
                            {strategy === "keep_first" && " → 1ʳᵉ"}
                            {strategy === "keep_last" && " → dernière"}
                        </p>
                    ))}
                    {groupCount > 2 && (
                        <p className="text-[11px] text-muted-foreground/70">
                            … et {groupCount - 2} autre{groupCount - 2 > 1 ? "s" : ""}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Sous-composant : Zone de dépôt de fichier ─────────────────────────────────
const DropZone = ({ onFile }) => {
    const fileRef  = useRef(null);
    const [drag, setDrag] = useState(false);

    const handle = useCallback((file) => {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".csv")) {
            toast.error("Fichier non supporté", { description: "Veuillez fournir un fichier .csv" });
            return;
        }
        onFile(file);
    }, [onFile]);

    return (
        <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
            className={`block rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-primary/[0.02]"
            }`}
            data-testid="csv-dropzone"
        >
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                data-testid="csv-file-input"
                onChange={(e) => handle(e.target.files?.[0])} />
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
                <FileUp size={22} />
            </div>
            <p className="text-base font-medium">Glissez votre fichier CSV ici</p>
            <p className="text-sm text-muted-foreground mt-1">ou</p>
            <Button type="button" onClick={(e) => { e.preventDefault(); fileRef.current?.click(); }}
                variant="secondary" className="mt-3 rounded-full h-10"
                data-testid="csv-choose-file-btn">
                <Upload size={15} className="mr-1.5" />Choisir un fichier
            </Button>
        </label>
    );
};

// ── Sous-composant : Récapitulatif (sobre) ────────────────────────────────────
const Summary = ({
    fileName, rowCount, summary, headers, colMapping, nameHeader,
    dupStrategy, onDupStrategyChange,
    skipExisting, onSkipExistingChange, existingLeadCount,
    netEstimate, onEditMapping,
    qualityScan = EMPTY_QUALITY,
    agencyDetectionOn = true,
    tagAgencies = false,
    onTagAgenciesChange,
    excludeClosedAds = false,
    onExcludeClosedAdsChange,
}) => {
    const { mapped, extra, ignored, noCompany, duplicates, duplicateGroups, missingValues } = summary;
    const net = netEstimate?.net ?? rowCount;
    const removedDups = netEstimate?.removedDups ?? 0;
    const skippedExisting = netEstimate?.skippedExisting ?? 0;
    const hasQuality =
        qualityScan.agencyCount > 0
        || qualityScan.closedAdCount > 0
        || qualityScan.noContactCount > 0;

    return (
        <div className="space-y-5">
            <div className="flex items-end justify-between gap-4 pb-4 border-b border-border">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Prêt à importer</p>
                    <p className="text-[12px] text-muted-foreground truncate mt-0.5" title={fileName}>{fileName}</p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-3xl font-semibold tabular-nums tracking-tight leading-none">{net}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">lead{net !== 1 ? "s" : ""}</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                <span>{rowCount} ligne{rowCount > 1 ? "s" : ""} fichier</span>
                {removedDups > 0 && <span>− {removedDups} doublon{removedDups > 1 ? "s" : ""}</span>}
                {skippedExisting > 0 && <span>− {skippedExisting} déjà présent{skippedExisting > 1 ? "s" : ""}</span>}
                {excludeClosedAds && qualityScan.closedAdCount > 0 && (
                    <span>− {qualityScan.closedAdCount} annonce{qualityScan.closedAdCount > 1 ? "s" : ""} fermée{qualityScan.closedAdCount > 1 ? "s" : ""}</span>
                )}
                <span className="text-border">·</span>
                <span>{mapped.length} mappé{mapped.length > 1 ? "s" : ""}</span>
                {extra.length > 0 && <span>{extra.length} extra</span>}
                {ignored.length > 0 && <span>{ignored.length} ignoré{ignored.length > 1 ? "s" : ""}</span>}
            </div>

            {missingValues > 0 && (
                <p className="text-[11px] text-muted-foreground -mt-3">
                    {missingValues} cellule{missingValues > 1 ? "s" : ""} vide{missingValues > 1 ? "s" : ""} dans les champs mappés
                </p>
            )}

            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-foreground">Colonnes</span>
                    {onEditMapping && (
                        <button type="button" onClick={onEditMapping}
                            className="text-[12px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                            Modifier
                        </button>
                    )}
                </div>
                <MappingChips headers={headers} colMapping={colMapping} nameHeader={nameHeader} />
            </div>

            {nameHeader && (
                <p className="text-[12px] text-muted-foreground">
                    Nom du lead : <span className="text-foreground font-medium">« {nameHeader} »</span>
                </p>
            )}

            {noCompany && (
                <p className="text-[12px] text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                    Aucun nom défini — mappez une colonne sur <span className="font-medium text-foreground">Entreprise</span> ou épinglez-en une avec ⭐.
                </p>
            )}

            {existingLeadCount > 0 && (
                <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/30 transition-colors">
                    <input
                        type="checkbox"
                        checked={skipExisting}
                        onChange={(e) => onSkipExistingChange?.(e.target.checked)}
                        className="mt-0.5 rounded border-border"
                    />
                    <span>
                        <span className="font-medium text-foreground">Ignorer les leads déjà présents</span>
                        <span className="block text-[12px] text-muted-foreground mt-0.5">
                            Même entreprise ou e-mail ({existingLeadCount} dans l'espace)
                            {skipExisting && skippedExisting > 0 ? ` · ≈ ${skippedExisting} concerné${skippedExisting > 1 ? "s" : ""}` : ""}.
                        </span>
                    </span>
                </label>
            )}

            {duplicates > 0 && (
                <DuplicateResolutionPanel
                    duplicates={duplicates}
                    duplicateGroups={duplicateGroups}
                    headers={headers}
                    colMapping={colMapping}
                    strategy={dupStrategy}
                    onStrategyChange={onDupStrategyChange}
                    survivingCount={netEstimate?.afterDups}
                />
            )}

            {hasQuality && (
                <div className="space-y-2.5 rounded-lg border border-border px-3 py-2.5" data-testid="csv-quality-scan">
                    <p className="text-[12px] font-medium text-foreground">Qualité</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        {qualityScan.agencyCount > 0 && (
                            <span data-testid="csv-quality-agency">
                                {qualityScan.agencyCount} suspect{qualityScan.agencyCount > 1 ? "s" : ""} cabinet
                            </span>
                        )}
                        {qualityScan.closedAdCount > 0 && (
                            <span data-testid="csv-quality-closed">
                                {qualityScan.closedAdCount} annonce{qualityScan.closedAdCount > 1 ? "s" : ""} fermée{qualityScan.closedAdCount > 1 ? "s" : ""}
                            </span>
                        )}
                        {qualityScan.noContactCount > 0 && (
                            <span data-testid="csv-quality-nocontact">
                                {qualityScan.noContactCount} sans tél/email
                            </span>
                        )}
                    </div>

                    {agencyDetectionOn && qualityScan.agencyCount > 0 && (
                        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tagAgencies}
                                onChange={(e) => onTagAgenciesChange?.(e.target.checked)}
                                className="mt-0.5 rounded border-border"
                                data-testid="csv-tag-agencies"
                            />
                            <span>
                                <span className="font-medium text-foreground">
                                    Taguer automatiquement les cabinets
                                </span>
                                <span className="block text-[12px] text-muted-foreground mt-0.5">
                                    Ajoute le tag « {AGENCY_IMPORT_TAG} » (filtre TopBar).
                                </span>
                            </span>
                        </label>
                    )}

                    {qualityScan.closedAdCount > 0 && (
                        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={excludeClosedAds}
                                onChange={(e) => onExcludeClosedAdsChange?.(e.target.checked)}
                                className="mt-0.5 rounded border-border"
                                data-testid="csv-exclude-closed"
                            />
                            <span>
                                <span className="font-medium text-foreground">
                                    Exclure les annonces fermées de l&apos;import
                                </span>
                                <span className="block text-[12px] text-muted-foreground mt-0.5">
                                    Statut importé fermé / pourvu / expiré.
                                </span>
                            </span>
                        </label>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Sous-composant : Sélecteur de mapping pour une colonne ───────────────────
const MappingSelect = ({ header, value, usedFields, onChange, index }) => {
    const translated = translateHeader(header);
    const translatedLabel = translated !== header ? translated : undefined;
    const isAutoMapped = value !== NONE && value !== EXTRA;
    const isIgnored    = value === NONE;

    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger
                data-testid={`csv-col-map-${index}`}
                className={`h-8 text-[12px] min-w-[150px] ${
                    isAutoMapped ? "border-emerald-500/40 bg-emerald-500/5"
                    : isIgnored  ? "border-border/40 bg-secondary/30 opacity-60"
                    : "border-amber-500/40 bg-amber-500/5"
                }`}
            >
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Champs CRM
                </div>
                {CRM_FIELDS.map((f) => {
                    // On n'affiche jamais "utilisé" en grisé — si on choisit un champ déjà
                    // mappé ailleurs, le swap se fait automatiquement dans onMappingChange
                    const alreadyHere = value === f.key;
                    return (
                        <SelectItem key={f.key} value={f.key}>
                            {f.key === "company" && <Star size={10} className="inline mr-1 text-amber-400 fill-amber-400" />}
                            {f.label}
                            {f.required && !alreadyHere && (
                                <span className="ml-1 text-muted-foreground text-[10px]">
                                    {usedFields.has(f.key) ? "(remplace)" : "*"}
                                </span>
                            )}
                            {alreadyHere && <span className="ml-1 text-[10px] text-emerald-600">✓</span>}
                        </SelectItem>
                    );
                })}
                <div className="h-px bg-border my-1" />
                <SelectItem value={EXTRA}>
                    {translatedLabel ? `Extra « ${translatedLabel} »` : "Garder comme extra"}
                </SelectItem>
                <SelectItem value={NONE}>— Ignorer —</SelectItem>
            </SelectContent>
        </Select>
    );
};

// ── Sous-composant : Éditeur avancé (layout colonnes + aperçu) ───────────────
const AdvancedEditor = ({ headers, rows, colMapping, nameHeader, onHeadersChange, onRowsChange, onMappingChange, onNameHeaderChange }) => {
    const [search, setSearch] = useState("");
    const [colFilter, setColFilter] = useState("all");
    const [editingHeader, setEditingHeader] = useState(null);
    const [headerDraft, setHeaderDraft] = useState("");
    const [selectedCol, setSelectedCol] = useState(null); // index colonne focus
    const tableRef = useRef(null);
    const lastCrmRef = useRef({});

    const colEntries = useMemo(() => (
        headers.map((h, i) => ({ h, i })).filter(({ h }) => {
            if (!h) return false;
            const target = colMapping[h] ?? EXTRA;
            if (colFilter === "mapped")  return target !== NONE && target !== EXTRA;
            if (colFilter === "extra")   return target === EXTRA;
            if (colFilter === "ignored") return target === NONE;
            return true;
        })
    ), [headers, colMapping, colFilter]);

    const filteredRows = useMemo(() => {
        const q = normalizeHeader(search);
        if (!q) return rows.map((r, i) => ({ r, origIdx: i }));
        return rows
            .map((r, i) => ({ r, origIdx: i }))
            .filter(({ r }) => r.some((cell) => normalizeHeader(cell || "").includes(q)));
    }, [rows, search]);

    const usedFields = useMemo(() => {
        const s = new Set();
        Object.values(colMapping).forEach((v) => { if (v !== NONE && v !== EXTRA) s.add(v); });
        return s;
    }, [colMapping]);

    /** Première valeur non vide d'une colonne (aperçu) */
    const sampleOf = useCallback((colIdx) => {
        for (const r of rows) {
            const v = (r[colIdx] || "").trim();
            if (v) return v;
        }
        return "";
    }, [rows]);

    const onMappingChangeWithSwap = useCallback((header, newValue) => {
        const updated = { ...colMapping };
        if (newValue !== NONE && newValue !== EXTRA) {
            lastCrmRef.current[header] = newValue;
            Object.keys(updated).forEach((k) => {
                if (k !== header && updated[k] === newValue) {
                    updated[k] = EXTRA;
                    toast.message(`« ${k} » repassé en Extra`, {
                        description: `${CRM_LABEL[newValue] || newValue} est maintenant sur « ${header} ».`,
                        duration: 2500,
                    });
                }
            });
        } else if (colMapping[header] && colMapping[header] !== NONE && colMapping[header] !== EXTRA) {
            lastCrmRef.current[header] = colMapping[header];
        }
        updated[header] = newValue;
        onMappingChange(updated);
    }, [colMapping, onMappingChange]);

    const toggleInclude = useCallback((header, include) => {
        if (include) onMappingChangeWithSwap(header, lastCrmRef.current[header] || EXTRA);
        else {
            const cur = colMapping[header] ?? EXTRA;
            if (cur !== NONE && cur !== EXTRA) lastCrmRef.current[header] = cur;
            onMappingChangeWithSwap(header, NONE);
        }
    }, [colMapping, onMappingChangeWithSwap]);

    const deleteRow = useCallback((origIdx) => {
        onRowsChange(rows.filter((_, i) => i !== origIdx));
    }, [rows, onRowsChange]);

    const editCell = useCallback((origIdx, colIdx, value) => {
        onRowsChange(rows.map((r, i) => {
            if (i !== origIdx) return r;
            const copy = [...r];
            copy[colIdx] = value;
            return copy;
        }));
    }, [rows, onRowsChange]);

    const commitHeaderRename = useCallback((colIdx) => {
        const newName = headerDraft.trim();
        if (!newName || newName === headers[colIdx]) { setEditingHeader(null); return; }
        const oldName = headers[colIdx];
        const newHeaders = headers.map((h, i) => i === colIdx ? newName : h);
        const newMapping = { ...colMapping };
        if (oldName && newMapping[oldName] !== undefined) {
            newMapping[newName] = newMapping[oldName];
            delete newMapping[oldName];
            if (lastCrmRef.current[oldName]) {
                lastCrmRef.current[newName] = lastCrmRef.current[oldName];
                delete lastCrmRef.current[oldName];
            }
        }
        if (nameHeader === oldName) onNameHeaderChange(newName);
        onHeadersChange(newHeaders, newMapping);
        setEditingHeader(null);
    }, [headerDraft, headers, colMapping, onHeadersChange, nameHeader, onNameHeaderChange]);

    const mappedCount = headers.filter((h) => h && colMapping[h] !== NONE && colMapping[h] !== EXTRA).length;
    const extraCount = headers.filter((h) => h && colMapping[h] === EXTRA).length;
    const ignoredCount = headers.filter((h) => h && colMapping[h] === NONE).length;

    return (
        <div className="flex flex-col gap-3 h-full min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Filtrer les lignes…"
                        className="pl-7 h-8 text-[12px] rounded-lg"
                    />
                </div>
                <div className="flex rounded-lg border border-border overflow-hidden text-[11px]">
                    {[
                        { id: "all", label: `Tout (${headers.filter(Boolean).length})` },
                        { id: "mapped", label: `CRM (${mappedCount})` },
                        { id: "extra", label: `Extra (${extraCount})` },
                        { id: "ignored", label: `Off (${ignoredCount})` },
                    ].map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setColFilter(f.id)}
                            className={`px-2.5 h-8 transition-colors ${
                                colFilter === f.id
                                    ? "bg-primary/15 text-primary font-medium"
                                    : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {filteredRows.length} ligne{filteredRows.length !== 1 ? "s" : ""}
                    {search ? ` / ${rows.length}` : ""}
                </span>
            </div>

            {/* Split : mapping | table */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
                {/* Liste colonnes */}
                <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-0 max-h-[40vh] lg:max-h-none">
                    <div className="px-3 py-2 border-b border-border/60 shrink-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Colonnes
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            Choisissez le champ CRM · ⭐ = nom du lead
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {colEntries.map(({ h, i }) => {
                            const target = colMapping[h] ?? EXTRA;
                            const isIgnored = target === NONE;
                            const isName = h === nameHeader;
                            const sample = sampleOf(i);
                            const selected = selectedCol === i;
                            return (
                                <div
                                    key={i}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedCol(i)}
                                    onKeyDown={(e) => { if (e.key === "Enter") setSelectedCol(i); }}
                                    className={`rounded-lg border p-2 space-y-1.5 transition-all cursor-pointer ${
                                        selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                                        : isName ? "border-amber-400/50 bg-amber-400/5"
                                        : isIgnored ? "border-border/50 opacity-50"
                                        : "border-border bg-background hover:border-border/80"
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="checkbox"
                                            checked={!isIgnored}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => toggleInclude(h, e.target.checked)}
                                            className="w-3.5 h-3.5 rounded accent-primary shrink-0"
                                            title={isIgnored ? "Inclure" : "Ignorer"}
                                        />
                                        {editingHeader === i ? (
                                            <input
                                                autoFocus
                                                value={headerDraft}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => setHeaderDraft(e.target.value)}
                                                onBlur={() => commitHeaderRename(i)}
                                                onKeyDown={(e) => {
                                                    e.stopPropagation();
                                                    if (e.key === "Enter") commitHeaderRename(i);
                                                    if (e.key === "Escape") setEditingHeader(null);
                                                }}
                                                className="flex-1 min-w-0 h-6 px-1.5 text-[11px] font-semibold bg-background border border-primary rounded outline-none"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); setEditingHeader(i); setHeaderDraft(h); }}
                                                className="flex-1 min-w-0 text-left text-[11px] font-semibold truncate hover:text-primary"
                                                title="Renommer"
                                            >
                                                {h}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); onNameHeaderChange(isName ? null : h); }}
                                            title={isName ? "Retirer comme nom" : "Nom du lead"}
                                            className={`shrink-0 w-5 h-5 rounded flex items-center justify-center ${
                                                isName ? "text-amber-400" : "text-muted-foreground/25 hover:text-amber-400"
                                            }`}
                                        >
                                            <Star size={11} className={isName ? "fill-amber-400" : ""} />
                                        </button>
                                    </div>
                                    {sample && !isIgnored && (
                                        <p className="text-[10px] text-muted-foreground truncate pl-5" title={sample}>
                                            ex. {sample}
                                        </p>
                                    )}
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <MappingSelect
                                            header={h} value={target} usedFields={usedFields} index={i}
                                            onChange={(v) => onMappingChangeWithSwap(h, v)}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                        {colEntries.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-6">Aucune colonne dans ce filtre.</p>
                        )}
                    </div>
                </div>

                {/* Tableau */}
                <div ref={tableRef} className="rounded-xl border border-border overflow-auto min-h-0 bg-card">
                    {filteredRows.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            {search ? "Aucun résultat." : "Aucune donnée."}
                        </div>
                    ) : (
                        <table className="w-full text-[12px] border-collapse min-w-max">
                            <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                                <tr>
                                    <th className="w-8 px-2 py-2 text-center text-muted-foreground/50 font-normal border-b border-border/60 text-[10px]">#</th>
                                    {colEntries.map(({ h, i }) => {
                                        const target = colMapping[h] ?? EXTRA;
                                        const isIgnored = target === NONE;
                                        const isMapped = target !== NONE && target !== EXTRA;
                                        const crmLabel = CRM_LABEL[target];
                                        const isName = h === nameHeader;
                                        const selected = selectedCol === i;
                                        return (
                                            <th
                                                key={i}
                                                onClick={() => setSelectedCol(i)}
                                                className={`px-2 py-2 text-left border-b font-normal align-bottom cursor-pointer transition-colors ${
                                                    selected ? "bg-primary/10 border-primary/30" : "border-border/60"
                                                } ${isIgnored ? "opacity-40" : ""}`}
                                                style={{ minWidth: "110px", maxWidth: "200px" }}
                                            >
                                                <div className="flex flex-col gap-0.5 min-w-0">
                                                    <span className="text-[11px] font-semibold truncate" title={h}>{h}</span>
                                                    <span className={`text-[10px] font-medium ${
                                                        isName ? "text-amber-500"
                                                        : isMapped ? "text-emerald-600 dark:text-emerald-400"
                                                        : isIgnored ? "text-muted-foreground/40"
                                                        : "text-amber-500"
                                                    }`}>
                                                        {isName ? `⭐ Nom${isMapped && crmLabel ? ` · ${crmLabel}` : ""}`
                                                            : isMapped ? `→ ${crmLabel}`
                                                            : isIgnored ? "Ignoré"
                                                            : "Extra"}
                                                    </span>
                                                </div>
                                            </th>
                                        );
                                    })}
                                    <th className="w-8 px-1 py-2 border-b border-border/60" />
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map(({ r, origIdx }, rowI) => (
                                    <tr key={origIdx}
                                        className={`group border-t border-border/40 hover:bg-muted/30 ${rowI % 2 ? "bg-muted/10" : ""}`}>
                                        <td className="px-2 py-1.5 text-center text-muted-foreground/40 text-[10px] tabular-nums">
                                            {origIdx + 1}
                                        </td>
                                        {colEntries.map(({ h, i }) => (
                                            <td key={i}
                                                className={`px-1 py-1 ${colMapping[h] === NONE ? "opacity-30" : ""} ${selectedCol === i ? "bg-primary/5" : ""}`}
                                                style={{ maxWidth: "200px" }}>
                                                <input
                                                    value={r[i] ?? ""}
                                                    onChange={(e) => editCell(origIdx, i, e.target.value)}
                                                    onFocus={() => setSelectedCol(i)}
                                                    className="w-full h-7 px-2 bg-transparent rounded hover:bg-background focus:bg-background border border-transparent hover:border-border focus:border-primary outline-none text-[12px] truncate"
                                                    title={r[i] || ""}
                                                />
                                            </td>
                                        ))}
                                        <td className="px-1 py-1 text-center">
                                            <button type="button" onClick={() => deleteRow(origIdx)}
                                                title="Supprimer la ligne"
                                                className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Trash2 size={11} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── Bouton sauvegarde / mise à jour de profil ─────────────────────────────────
const SaveProfileButton = ({ onSaveNew, onUpdate, appliedProfileName, appliedProfileId }) => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");

    const commitNew = () => {
        if (!name.trim()) return;
        onSaveNew(name.trim());
        setOpen(false);
        setName("");
    };

    if (open) {
        return (
            <div className="flex items-center gap-1.5">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitNew(); if (e.key === "Escape") { setOpen(false); setName(""); } }}
                    placeholder="Nom du nouveau profil…"
                    className="h-9 px-2.5 w-40 text-[12px] bg-background border border-border rounded-lg outline-none focus:border-primary" />
                <button onClick={commitNew}
                    className="h-9 px-2.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors flex items-center gap-1">
                    <BookMarked size={12} />Créer
                </button>
                <button onClick={() => { setOpen(false); setName(""); }}
                    className="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                    <X size={13} />
                </button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {appliedProfileId && onUpdate && (
                <Button variant="outline" onClick={onUpdate}
                    className="h-9 rounded-lg text-[12px] gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10">
                    <BookMarked size={13} />
                    Mettre à jour{appliedProfileName ? ` « ${appliedProfileName} »` : ""}
                </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(true)}
                className="h-9 rounded-lg text-[12px] gap-1.5 border-border">
                <BookMarked size={13} />
                {appliedProfileId ? "Enregistrer comme nouveau" : "Sauvegarder comme profil"}
            </Button>
        </div>
    );
};

// ── Composant principal ───────────────────────────────────────────────────────
export const CsvImportModal = ({ open, onOpenChange, workspaceId }) => {
    const { state, dispatch, batchDispatch } = useCrm();
    const workspace = state.workspaces[workspaceId];

    // step: "upload" | "quick-summary" | "advanced-edit" | "advanced-summary"
    const [step, setStep]           = useState("upload");
    const [fileName, setFileName]   = useState("");
    const [headers, setHeaders]     = useState([]);
    const [rows, setRows]           = useState([]);
    const [colMapping, setColMapping] = useState({});

    // ── Profils d'import ──────────────────────────────────────────────────────
    // matchedProfile : { profile, score, isAuto, isSuggested, newHeaders } | null
    const [matchedProfile,    setMatchedProfile]    = useState(null);
    // appliedProfileId : id du profil appliqué (pour le touch en fin d'import)
    const [appliedProfileId,  setAppliedProfileId]  = useState(null);
    // showProfiles : afficher le panneau de gestion des profils
    const [showProfiles,      setShowProfiles]      = useState(false);

    // ── Résolution de doublons ────────────────────────────────────────────────
    // "ignore" | "keep_first" | "keep_last" | "merge"
    // Défaut keep_first : évite de polluer le pipeline avec des lignes CSV en double
    const [dupStrategy,   setDupStrategy]   = useState("keep_first");
    // colonne dominante pour la fusion (header name ou null)
    const [dupDominant,   setDupDominant]   = useState(null);
    // Ignorer les leads déjà présents dans le workspace (company / email)
    const [skipExisting,  setSkipExisting]  = useState(true);

    // ── Scan qualité pré-import ───────────────────────────────────────────────
    const agencyDetectionOn = isAgencyDetectionEnabled(workspace);
    const [tagAgencies, setTagAgencies] = useState(true);
    const [excludeClosedAds, setExcludeClosedAds] = useState(false);

    // ── Colonne "nom du lead" épinglée via l'étoile ───────────────────────────
    // Indépendante du colMapping — n'importe quelle colonne peut être le nom,
    // même une colonne Extra. null = utiliser la colonne mappée sur "company".
    const [nameHeader, setNameHeader] = useState(null);
    const [importing, setImporting] = useState(false);

    const reset = () => {
        setStep("upload"); setFileName(""); setHeaders([]); setRows([]); setColMapping({});
        setMatchedProfile(null); setAppliedProfileId(null); setShowProfiles(false);
        setDupStrategy("keep_first"); setDupDominant(null);
        setSkipExisting(true);
        setTagAgencies(isAgencyDetectionEnabled(workspace));
        setExcludeClosedAds(false);
        setNameHeader(null);
        setImporting(false);
    };

    const handleClose = (v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 250);
    };

    // Lecture du fichier — commun aux deux modes
    const handleFile = useCallback(async (file) => {
        try {
            const text = await file.text();
            const { headers: h, rows: r } = parseCsv(text);
            if (!h.length || !r.length) { toast.error("CSV vide ou illisible"); return; }

            // ── Détection de profil ──────────────────────────────────────────
            const match = findBestProfile(h);
            setMatchedProfile(match);

            let initMapping;
            if (match) {
                // Profil trouvé (auto ou suggéré) → appliquer + auto-détecter le reste
                initMapping = applyProfile(h, match.profile, r);
                setAppliedProfileId(match.profile.id);
            } else {
                // Aucun profil → détection automatique par nom/données
                initMapping = buildInitialMapping(h, r);
                setAppliedProfileId(null);
            }

            setFileName(file.name);
            setHeaders(h);
            setRows(r);
            setColMapping(initMapping);
            // Rester sur upload — l'utilisateur choisit le mode
        } catch (err) {
            toast.error("Erreur de lecture", { description: String(err) });
        }
    }, []);

    // Lance l'import effectif (commun aux deux modes)
    const doImport = useCallback((finalHeaders, finalRows, finalColMapping) => {
        if (importing) return;
        setImporting(true);
        try {
        // Appliquer la résolution de doublons si nécessaire
        const currentSummary = computeSummary(finalHeaders, finalRows, finalColMapping, nameHeader);
        let resolvedRows = finalRows;
        if (dupStrategy !== "ignore" && Object.keys(currentSummary.duplicateGroups).length > 0) {
            resolvedRows = applyDuplicateResolution(
                finalRows, finalHeaders, currentSummary.duplicateGroups, dupStrategy, dupDominant, finalColMapping, nameHeader
            );
        }

        const legacyMapping = buildLegacyMapping(finalColMapping);
        const leads = rowsToLeads(finalHeaders, resolvedRows, legacyMapping, finalColMapping, nameHeader);
        const incomplete = leads.filter((l) => l._incomplete).length;
        let cleanLeads = leads.map(({ _incomplete: _i, ...rest }) => rest);

        // Statuts exportés sans colonne correspondante dans le workspace
        let unknownStatusCount = 0;
        if (workspace) {
            for (const lead of cleanLeads) {
                if (lead._statusName && !resolveColumnIdByName(workspace, lead._statusName)) {
                    unknownStatusCount++;
                }
            }
        }

        // Filtrer les leads déjà présents dans le workspace (company / email)
        let skippedExisting = 0;
        if (skipExisting && workspace?.leads) {
            const companies = new Set();
            const emails = new Set();
            Object.values(workspace.leads).forEach((l) => {
                const c = normalizeHeader(l.company || "");
                const e = normalizeHeader(l.email || "");
                if (c) companies.add(c);
                if (e) emails.add(e);
            });
            const kept = [];
            for (const lead of cleanLeads) {
                const c = normalizeHeader(lead.company || "");
                const e = normalizeHeader(lead.email || "");
                if ((c && companies.has(c)) || (e && emails.has(e))) {
                    skippedExisting++;
                    continue;
                }
                if (c) companies.add(c);
                if (e) emails.add(e);
                kept.push(lead);
            }
            cleanLeads = kept;
        }

        const agencyOn = isAgencyDetectionEnabled(workspace);
        const qualityResult = applyImportQualityActions(cleanLeads, {
            agencyEnabled: agencyOn,
            tagAgencies: agencyOn && tagAgencies,
            excludeClosedAds,
        });
        cleanLeads = qualityResult.leads;

        const removedCount = finalRows.length - resolvedRows.length;

        // Grouper tous les leads en chunks puis les envoyer comme UNE SEULE action undo
        // via batchDispatch — un import = une seule entrée dans le undo stack.
        const CHUNK = 100;
        const actions = [];
        for (let i = 0; i < cleanLeads.length; i += CHUNK) {
            actions.push({ type: "BULK_ADD_LEADS", workspaceId, leads: cleanLeads.slice(i, i + CHUNK) });
        }
        if (actions.length > 0) {
            batchDispatch(actions);
        }

        // Marquer le profil comme utilisé
        if (appliedProfileId) touchProfile(appliedProfileId);

        const importedCount = cleanLeads.length;
        toast.success(
            importedCount === 0
                ? "Aucun nouveau lead à importer"
                : `${importedCount} lead${importedCount > 1 ? "s" : ""} importé${importedCount > 1 ? "s" : ""}`,
            {
                description: [
                    incomplete > 0 ? `${incomplete} sans nom d'entreprise.` : null,
                    removedCount > 0 ? `${removedCount} doublon${removedCount > 1 ? "s" : ""} ${dupStrategy === "merge" ? "fusionné" : "supprimé"}${removedCount > 1 ? "s" : ""} dans le fichier.` : null,
                    skippedExisting > 0 ? `${skippedExisting} déjà présent${skippedExisting > 1 ? "s" : ""} dans l'espace (ignoré${skippedExisting > 1 ? "s" : ""}).` : null,
                    qualityResult.excludedClosed > 0
                        ? `${qualityResult.excludedClosed} annonce${qualityResult.excludedClosed > 1 ? "s" : ""} fermée${qualityResult.excludedClosed > 1 ? "s" : ""} exclue${qualityResult.excludedClosed > 1 ? "s" : ""}.`
                        : null,
                    qualityResult.taggedAgency > 0
                        ? `${qualityResult.taggedAgency} tagué${qualityResult.taggedAgency > 1 ? "s" : ""} « ${AGENCY_IMPORT_TAG} ».`
                        : null,
                    unknownStatusCount > 0 ? `${unknownStatusCount} placé${unknownStatusCount > 1 ? "s" : ""} en 1ʳᵉ colonne (statut CSV inconnu dans ce pipeline).` : null,
                ].filter(Boolean).join(" ") || undefined,
            }
        );
        handleClose(false);
        } catch (err) {
            console.error("[CSV Import]", err);
            toast.error("Échec de l'import", {
                description: err?.message || String(err),
            });
            setImporting(false);
        }
    }, [importing, batchDispatch, workspaceId, workspace, appliedProfileId, dupStrategy, dupDominant, nameHeader, skipExisting, tagAgencies, excludeClosedAds]); // eslint-disable-line react-hooks/exhaustive-deps

    // Récapitulatif courant (recalculé à chaque changement)
    const summary = useMemo(
        () => (headers.length ? computeSummary(headers, rows, colMapping, nameHeader) : null),
        [headers, rows, colMapping, nameHeader]
    );

    const netEstimate = useMemo(() => {
        if (!headers.length) return null;
        return estimateNetImport({
            headers, rows, colMapping, nameHeader,
            dupStrategy, dupDominant, skipExisting, workspace,
        });
    }, [headers, rows, colMapping, nameHeader, dupStrategy, dupDominant, skipExisting, workspace]);

    const qualityScan = useMemo(() => {
        if (!headers.length) return EMPTY_QUALITY;
        const preview = buildImportPreviewLeads({
            headers, rows, colMapping, nameHeader,
            dupStrategy, dupDominant, skipExisting, workspace,
        });
        return scanImportLeads(preview, { agencyEnabled: agencyDetectionOn });
    }, [headers, rows, colMapping, nameHeader, dupStrategy, dupDominant, skipExisting, workspace, agencyDetectionOn]);

    const displayNetEstimate = useMemo(() => {
        if (!netEstimate) return null;
        const closedExcluded = excludeClosedAds ? (qualityScan.closedAdCount || 0) : 0;
        return {
            ...netEstimate,
            net: Math.max(0, (netEstimate.net || 0) - closedExcluded),
        };
    }, [netEstimate, excludeClosedAds, qualityScan.closedAdCount]);

    const fileLoaded = headers.length > 0;

    // Titre et description selon l'étape
    const stepMeta = {
        "upload":           { title: "Importer un CSV", desc: fileLoaded ? `${fileName} — ${rows.length} lignes détectées` : "Déposez un fichier ou choisissez-en un." },
        "quick-summary":    { title: "Confirmer l'import rapide", desc: `${fileName} — ${rows.length} lignes` },
        "advanced-edit":    { title: "Éditeur de données", desc: `${fileName} — ${rows.length} lignes · Modifiez, corrigez, puis passez au récapitulatif.` },
        "advanced-summary": { title: "Récapitulatif final", desc: `${fileName} — ${rows.length} lignes` },
    };
    const { title, desc } = stepMeta[step] ?? stepMeta["upload"];

    // Largeur de la dialog selon l'étape
    const isEditor = step === "advanced-edit";

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent
                data-testid="csv-import-modal"
                className={`rounded-2xl shadow-panel flex flex-col transition-all duration-200 ${
                    isEditor
                        ? "sm:max-w-[95vw] max-h-[92vh] h-[92vh]"
                        : "sm:max-w-[660px] max-h-[90vh]"
                }`}
                style={isEditor ? { width: "95vw" } : undefined}
            >
                <DialogHeader className="shrink-0 space-y-2">
                    <ImportStepper step={step} fileLoaded={fileLoaded} />
                    <DialogTitle className="text-xl tracking-tight">{title}</DialogTitle>
                    <DialogDescription>{desc}</DialogDescription>
                </DialogHeader>

                {/* ════════════════════════════════════════
                    ÉTAPE : UPLOAD
                ════════════════════════════════════════ */}
                {step === "upload" && (
                    <div className="flex-1 overflow-y-auto py-2 space-y-4">
                        {!fileLoaded ? (
                            <DropZone onFile={handleFile} />
                        ) : (
                            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                    <CheckCircle2 size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{fileName}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {rows.length} ligne{rows.length > 1 ? "s" : ""} · {headers.filter(Boolean).length} colonne{headers.filter(Boolean).length > 1 ? "s" : ""}
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg text-[12px] shrink-0"
                                    onClick={() => {
                                        setFileName(""); setHeaders([]); setRows([]); setColMapping({});
                                        setMatchedProfile(null); setAppliedProfileId(null); setNameHeader(null);
                                    }}
                                >
                                    Changer
                                </Button>
                            </div>
                        )}

                        {fileLoaded && (
                            <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Mapping détecté
                                </p>
                                <MappingChips headers={headers} colMapping={colMapping} nameHeader={nameHeader} />
                            </div>
                        )}

                        {/* ── Bandeau profil reconnu ── */}
                        {fileLoaded && matchedProfile && (
                            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
                                matchedProfile.isAuto
                                    ? "border-emerald-500/40 bg-emerald-500/5"
                                    : "border-amber-400/40 bg-amber-400/5"
                            }`}>
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                    matchedProfile.isAuto ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                    : "bg-amber-400/15 text-amber-600 dark:text-amber-400"
                                }`}>
                                    {matchedProfile.isAuto ? <Sparkles size={15} /> : <BookMarked size={15} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${
                                        matchedProfile.isAuto
                                            ? "text-emerald-700 dark:text-emerald-400"
                                            : "text-amber-700 dark:text-amber-400"
                                    }`}>
                                        {matchedProfile.isAuto
                                            ? `Profil « ${matchedProfile.profile.name} » appliqué automatiquement`
                                            : `Profil « ${matchedProfile.profile.name} » suggéré (${Math.round(matchedProfile.score * 100)}% de correspondance)`}
                                    </p>
                                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                                        {matchedProfile.isAuto
                                            ? "Le mapping a été configuré automatiquement. Vérifiez si besoin dans l'éditeur."
                                            : matchedProfile.newHeaders.length > 0
                                                ? `${matchedProfile.newHeaders.length} nouvelle${matchedProfile.newHeaders.length > 1 ? "s" : ""} colonne${matchedProfile.newHeaders.length > 1 ? "s" : ""} à compléter : ${matchedProfile.newHeaders.slice(0, 3).join(", ")}${matchedProfile.newHeaders.length > 3 ? "…" : ""}`
                                                : "Le mapping est prêt, vérifiez avant d'importer."
                                        }
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        setMatchedProfile(null);
                                        setColMapping(buildInitialMapping(headers, rows));
                                        setAppliedProfileId(null);
                                    }}
                                    title="Ignorer ce profil et utiliser la détection automatique"
                                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                    <X size={12} />
                                </button>
                            </div>
                        )}

                        {/* Choix du mode — apparaît dès qu'un fichier est chargé */}
                        {fileLoaded && (
                            <div className="space-y-3">
                                <p className="text-sm text-muted-foreground text-center">
                                    Choisissez votre mode d'import
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {/* Import rapide */}
                                    <button
                                        data-testid="csv-quick-import-btn"
                                        onClick={() => setStep("quick-summary")}
                                        className="group rounded-2xl border-2 border-primary bg-primary/5 hover:bg-primary/10 p-5 text-left transition-colors flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                                                <Zap size={18} />
                                            </div>
                                            <span className="font-semibold text-[15px] text-foreground">Import rapide</span>
                                        </div>
                                        <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                                            Vérifiez le récap (doublons, colonnes) puis importez en un clic.
                                        </p>
                                    </button>

                                    {/* Mode avancé */}
                                    <button
                                        data-testid="csv-advanced-btn"
                                        onClick={() => setStep("advanced-edit")}
                                        className="group rounded-2xl border-2 border-border hover:border-foreground/30 bg-card p-5 text-left transition-colors flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-9 h-9 rounded-xl bg-secondary text-foreground flex items-center justify-center">
                                                <Settings2 size={18} />
                                            </div>
                                            <span className="font-semibold text-[15px] text-foreground">Modifier avant l'import</span>
                                        </div>
                                        <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                                            Corrigez cellules, mapping et lignes — sans ouvrir Excel.
                                        </p>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Panneau profils (toujours accessible, replié par défaut) ── */}
                        <div className="border-t border-border/50 pt-3">
                            <button
                                onClick={() => setShowProfiles((v) => !v)}
                                className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors w-full">
                                <BookMarked size={13} />
                                <span className="font-medium">Profils d'import enregistrés</span>
                                {showProfiles ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
                            </button>
                            {showProfiles && (
                                <div className="mt-3">
                                    <ImportProfilesManager
                                        currentHeaders={headers}
                                        currentColMapping={colMapping}
                                        canSave={fileLoaded}
                                        onApply={(profile) => {
                                            const applied = applyProfile(headers, profile, rows);
                                            setColMapping(applied);
                                            setAppliedProfileId(profile.id);
                                            setMatchedProfile({
                                                profile, score: 1,
                                                isAuto: false, isSuggested: true, newHeaders: [],
                                            });
                                            setShowProfiles(false);
                                            toast.success(`Profil « ${profile.name} » appliqué`);
                                        }}
                                        onSaveCurrent={(name) => {
                                            const saved = saveProfile({ name, headers, colMapping });
                                            setAppliedProfileId(saved.id);
                                            toast.success(`Profil « ${name} » enregistré`);
                                        }}
                                        onUpdateProfile={(id) => {
                                            const updated = updateProfileMapping(id, { headers, colMapping });
                                            if (updated) {
                                                setAppliedProfileId(updated.id);
                                                toast.success(`Profil « ${updated.name} » mis à jour`);
                                            }
                                        }}
                                        appliedProfileId={appliedProfileId}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ════════════════════════════════════════
                    ÉTAPE : RÉCAPITULATIF RAPIDE
                ════════════════════════════════════════ */}
                {step === "quick-summary" && summary && (
                    <div className="flex-1 overflow-y-auto py-2">
                        <Summary
                            fileName={fileName}
                            rowCount={rows.length}
                            summary={summary}
                            headers={headers}
                            colMapping={colMapping}
                            nameHeader={nameHeader}
                            dupStrategy={dupStrategy}
                            dupDominant={dupDominant}
                            onDupStrategyChange={setDupStrategy}
                            onDupDominantChange={setDupDominant}
                            skipExisting={skipExisting}
                            onSkipExistingChange={setSkipExisting}
                            existingLeadCount={Object.keys(workspace?.leads || {}).length}
                            netEstimate={displayNetEstimate}
                            onEditMapping={() => setStep("advanced-edit")}
                            qualityScan={qualityScan}
                            agencyDetectionOn={agencyDetectionOn}
                            tagAgencies={tagAgencies}
                            onTagAgenciesChange={setTagAgencies}
                            excludeClosedAds={excludeClosedAds}
                            onExcludeClosedAdsChange={setExcludeClosedAds}
                        />
                    </div>
                )}

                {/* ════════════════════════════════════════
                    ÉTAPE : ÉDITEUR AVANCÉ
                ════════════════════════════════════════ */}
                {step === "advanced-edit" && (
                    <div className="flex-1 min-h-0 overflow-hidden py-1">
                        <AdvancedEditor
                            headers={headers}
                            rows={rows}
                            colMapping={colMapping}
                            nameHeader={nameHeader}
                            onHeadersChange={(newHeaders, newMapping) => {
                                setHeaders(newHeaders);
                                setColMapping(newMapping);
                            }}
                            onRowsChange={setRows}
                            onMappingChange={setColMapping}
                            onNameHeaderChange={setNameHeader}
                        />
                    </div>
                )}

                {/* ════════════════════════════════════════
                    ÉTAPE : RÉCAPITULATIF AVANCÉ
                ════════════════════════════════════════ */}
                {step === "advanced-summary" && summary && (
                    <div className="flex-1 overflow-y-auto py-2">
                        <Summary
                            fileName={fileName}
                            rowCount={rows.length}
                            summary={summary}
                            headers={headers}
                            colMapping={colMapping}
                            nameHeader={nameHeader}
                            dupStrategy={dupStrategy}
                            dupDominant={dupDominant}
                            onDupStrategyChange={setDupStrategy}
                            onDupDominantChange={setDupDominant}
                            skipExisting={skipExisting}
                            onSkipExistingChange={setSkipExisting}
                            existingLeadCount={Object.keys(workspace?.leads || {}).length}
                            netEstimate={displayNetEstimate}
                            onEditMapping={() => setStep("advanced-edit")}
                            qualityScan={qualityScan}
                            agencyDetectionOn={agencyDetectionOn}
                            tagAgencies={tagAgencies}
                            onTagAgenciesChange={setTagAgencies}
                            excludeClosedAds={excludeClosedAds}
                            onExcludeClosedAdsChange={setExcludeClosedAds}
                        />
                    </div>
                )}

                {/* ════════════════════════════════════════
                    FOOTER
                ════════════════════════════════════════ */}
                <DialogFooter className="shrink-0 pt-2 border-t border-border/60 flex-wrap gap-2">

                    {/* Retour */}
                    {step !== "upload" && (
                        <Button variant="ghost" data-testid="csv-back-btn"
                            onClick={() => {
                                if (step === "quick-summary")    setStep("upload");
                                if (step === "advanced-edit")    setStep("upload");
                                if (step === "advanced-summary") setStep("advanced-edit");
                            }}>
                            <ArrowLeft size={15} className="mr-1.5" />Retour
                        </Button>
                    )}

                    {/* Annuler */}
                    <Button variant="ghost" onClick={() => handleClose(false)} data-testid="csv-cancel-btn">
                        Annuler
                    </Button>

                    {/* Bouton sauvegarder / mettre à jour profil */}
                    {(step === "quick-summary" || step === "advanced-summary" || step === "advanced-edit") && (
                        <SaveProfileButton
                            appliedProfileId={appliedProfileId}
                            appliedProfileName={appliedProfileId ? getProfile(appliedProfileId)?.name : null}
                            onUpdate={() => {
                                if (!appliedProfileId) return;
                                const updated = updateProfileMapping(appliedProfileId, { headers, colMapping });
                                if (updated) toast.success(`Profil « ${updated.name} » mis à jour`);
                            }}
                            onSaveNew={(name) => {
                                const saved = saveProfile({ name, headers, colMapping });
                                setAppliedProfileId(saved.id);
                                toast.success(`Profil « ${name} » enregistré`);
                            }}
                        />
                    )}

                    {/* CTA principal selon l'étape */}
                    {step === "upload" && fileLoaded && (
                        <Button onClick={() => setStep("quick-summary")}
                            data-testid="csv-quick-confirm-btn"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5">
                            <Zap size={14} />
                            Continuer →
                        </Button>
                    )}

                    {step === "quick-summary" && (
                        <Button data-testid="csv-confirm-btn"
                            disabled={importing || (displayNetEstimate?.net === 0)}
                            onClick={() => doImport(headers, rows, colMapping)}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {importing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <CheckCircle2 size={14} className="mr-1.5" />}
                            {importing
                                ? "Import…"
                                : `Importer ${displayNetEstimate?.net ?? rows.length} lead${(displayNetEstimate?.net ?? rows.length) !== 1 ? "s" : ""}`}
                        </Button>
                    )}

                    {step === "advanced-edit" && (
                        <Button data-testid="csv-advanced-next-btn"
                            onClick={() => setStep("advanced-summary")}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            Récapitulatif →
                        </Button>
                    )}

                    {step === "advanced-summary" && (
                        <Button data-testid="csv-confirm-btn"
                            disabled={importing || (displayNetEstimate?.net === 0)}
                            onClick={() => doImport(headers, rows, colMapping)}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {importing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <CheckCircle2 size={14} className="mr-1.5" />}
                            {importing
                                ? "Import…"
                                : `Importer ${displayNetEstimate?.net ?? rows.length} lead${(displayNetEstimate?.net ?? rows.length) !== 1 ? "s" : ""}`}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
