/**
 * ImportProfilesManager.jsx — Gestion complète des profils d'import CSV
 *
 * Affiche la liste des profils avec : nom, date d'utilisation, nbre d'imports,
 * aperçu du mapping, actions (renommer, supprimer).
 * Permet de créer un nouveau profil ou d'appliquer un existant.
 */
import React, { useState, useCallback } from "react";
import {
    BookMarked, Pencil, Trash2, ChevronDown, ChevronUp,
    Check, X, Plus, Clock, Hash, Layers, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    loadProfiles, renameProfile, deleteProfile, duplicateProfile,
    formatProfileDate, mappingLabel, scoreProfile,
} from "@/lib/importProfiles";
import { toast } from "sonner";

// ── Aperçu du mapping d'un profil ─────────────────────────────────────────────
const ProfilePreview = ({ profile }) => {
    const entries = Object.entries(profile.colMapping || {})
        .filter(([, v]) => v !== "__none__")
        .slice(0, 10);

    return (
        <div className="mt-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-1">
            {entries.map(([header, target]) => (
                <div key={header} className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground truncate flex-1 min-w-0">{header}</span>
                    <span className="text-muted-foreground/40 shrink-0">→</span>
                    <span className={`shrink-0 font-medium ${
                        target === "__extra__" ? "text-amber-500"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}>
                        {mappingLabel(target)}
                    </span>
                </div>
            ))}
            {Object.keys(profile.colMapping || {}).length > 10 && (
                <p className="text-[10px] text-muted-foreground/50 pt-0.5">
                    +{Object.keys(profile.colMapping).length - 10} autres colonnes…
                </p>
            )}
        </div>
    );
};

// ── Carte d'un profil ──────────────────────────────────────────────────────────
const ProfileCard = ({ profile, onApply, onDelete, onRename, onDuplicate, onUpdateFromCurrent, matchScore, canUpdate }) => {
    const [expanded,     setExpanded]     = useState(false);
    const [editing,      setEditing]      = useState(false);
    const [nameDraft,    setNameDraft]    = useState(profile.name);
    const [confirmDel,   setConfirmDel]   = useState(false);

    const commitRename = () => {
        const trimmed = nameDraft.trim();
        if (trimmed && trimmed !== profile.name) onRename(profile.id, trimmed);
        setEditing(false);
    };

    const scorePct = matchScore != null ? Math.round(matchScore * 100) : null;
    const scoreColor = scorePct >= 90 ? "text-emerald-600 dark:text-emerald-400"
        : scorePct >= 60 ? "text-amber-500"
        : "text-muted-foreground/50";

    return (
        <div className={`rounded-xl border bg-card transition-colors ${
            matchScore >= 0.9  ? "border-emerald-500/40 bg-emerald-500/[0.02]"
            : matchScore >= 0.6 ? "border-amber-400/40 bg-amber-400/[0.02]"
            : "border-border"
        }`}>
            <div className="px-3 py-3 flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <BookMarked size={14} />
                </div>

                <div className="flex-1 min-w-0">
                    {editing ? (
                        <div className="flex items-center gap-1.5">
                            <input
                                autoFocus
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter")  commitRename();
                                    if (e.key === "Escape") { setEditing(false); setNameDraft(profile.name); }
                                }}
                                className="flex-1 h-7 px-2 text-sm font-semibold bg-background border border-primary rounded outline-none"
                            />
                            <button onClick={commitRename} className="text-emerald-500 hover:text-emerald-600">
                                <Check size={13} />
                            </button>
                            <button onClick={() => { setEditing(false); setNameDraft(profile.name); }}
                                className="text-muted-foreground hover:text-foreground">
                                <X size={13} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-foreground truncate">{profile.name}</span>
                            {scorePct != null && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted ${scoreColor}`}>
                                    {scorePct}%
                                </span>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Layers size={10} />
                            {Object.keys(profile.colMapping || {}).length} colonne{Object.keys(profile.colMapping || {}).length > 1 ? "s" : ""}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Hash size={10} />
                            {profile.useCount || 0} import{(profile.useCount || 0) > 1 ? "s" : ""}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock size={10} />
                            {formatProfileDate(profile.lastUsedAt)}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setExpanded((v) => !v)}
                        title={expanded ? "Masquer l'aperçu" : "Voir le mapping"}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button onClick={() => onDuplicate?.(profile.id)}
                        title="Dupliquer"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <Copy size={12} />
                    </button>
                    <button onClick={() => setEditing(true)}
                        title="Renommer"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <Pencil size={12} />
                    </button>
                    {confirmDel ? (
                        <>
                            <button onClick={() => onDelete(profile.id)}
                                className="h-7 px-2 rounded-lg text-[11px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
                                Suppr.
                            </button>
                            <button onClick={() => setConfirmDel(false)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary">
                                <X size={12} />
                            </button>
                        </>
                    ) : (
                        <button onClick={() => setConfirmDel(true)}
                            title="Supprimer"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="px-3 pb-3">
                    <ProfilePreview profile={profile} />
                </div>
            )}

            <div className="px-3 pb-3 pt-0 flex flex-col gap-1.5">
                {onApply && (
                    <Button onClick={() => onApply(profile)} size="sm"
                        className={`w-full h-8 rounded-lg text-[12px] ${
                            scorePct >= 90
                                ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                : "bg-primary hover:bg-primary/90 text-primary-foreground"
                        }`}>
                        {scorePct >= 90 ? "✓ Appliquer ce profil" : "Appliquer ce profil"}
                    </Button>
                )}
                {canUpdate && onUpdateFromCurrent && (
                    <Button variant="outline" size="sm" onClick={() => onUpdateFromCurrent(profile.id)}
                        className="w-full h-8 rounded-lg text-[12px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                        Enregistrer le mapping actuel dessus
                    </Button>
                )}
            </div>
        </div>
    );
};

// ── Composant principal ────────────────────────────────────────────────────────
/**
 * @param {object}   props
 * @param {string[]} props.currentHeaders   — headers du CSV en cours d'édition
 * @param {object}   props.currentColMapping — mapping actuel
 * @param {Function} props.onApply(profile)  — appelé quand l'utilisateur choisit un profil
 * @param {Function} props.onSaveCurrent(name) — appelé pour sauvegarder le mapping courant
 * @param {boolean}  props.canSave           — true si un mapping est actif
 */
export const ImportProfilesManager = ({
    currentHeaders = [],
    currentColMapping = {},
    onApply,
    onSaveCurrent,
    onUpdateProfile,
    appliedProfileId = null,
    canSave = false,
}) => {
    const [profiles,    setProfiles]    = useState(() => loadProfiles());
    const [saveMode,    setSaveMode]    = useState(false);
    const [saveName,    setSaveName]    = useState("");

    const refresh = () => setProfiles(loadProfiles());

    const handleDelete = useCallback((id) => {
        deleteProfile(id);
        refresh();
    }, []);

    const handleRename = useCallback((id, newName) => {
        renameProfile(id, newName);
        refresh();
    }, []);

    const handleDuplicate = useCallback((id) => {
        const copy = duplicateProfile(id);
        refresh();
        return copy;
    }, []);

    const handleSave = () => {
        if (!saveName.trim()) return;
        onSaveCurrent(saveName.trim());
        setSaveMode(false);
        setSaveName("");
        refresh();
    };

    // Scores de matching pour chaque profil avec le CSV courant
    const scores = currentHeaders.length
        ? Object.fromEntries(profiles.map((p) => [p.id, scoreProfile(currentHeaders, p).score]))
        : {};

    // Trier : meilleur score en premier, puis par date d'utilisation
    const sorted = [...profiles].sort((a, b) => {
        const sa = scores[a.id] ?? 0;
        const sb = scores[b.id] ?? 0;
        if (sb !== sa) return sb - sa;
        return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
    });

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <BookMarked size={14} className="text-primary" />
                    Profils d'import
                    {profiles.length > 0 && (
                        <span className="text-[11px] text-muted-foreground font-normal">
                            ({profiles.length})
                        </span>
                    )}
                </h3>

                {canSave && (
                    <div>
                        {saveMode ? (
                            <div className="flex items-center gap-1.5">
                                <input
                                    autoFocus
                                    value={saveName}
                                    onChange={(e) => setSaveName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter")  handleSave();
                                        if (e.key === "Escape") { setSaveMode(false); setSaveName(""); }
                                    }}
                                    placeholder="Nom du profil…"
                                    className="h-7 px-2 w-40 text-[12px] bg-background border border-border rounded-lg outline-none focus:border-primary"
                                />
                                <button onClick={handleSave}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90">
                                    <Check size={12} />
                                </button>
                                <button onClick={() => { setSaveMode(false); setSaveName(""); }}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary">
                                    <X size={12} />
                                </button>
                            </div>
                        ) : (
                            <Button variant="outline" size="sm" onClick={() => { setSaveMode(true); setSaveName(""); }}
                                className="h-7 rounded-lg text-[12px] gap-1.5">
                                <Plus size={11} />
                                Nouveau profil
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {sorted.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-5 text-center">
                    <BookMarked size={20} className="mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">Aucun profil enregistré.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                        Après avoir configuré un mapping, enregistrez-le pour le réutiliser.
                    </p>
                </div>
            ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-0.5">
                    {sorted.map((p) => (
                        <ProfileCard
                            key={p.id}
                            profile={p}
                            matchScore={scores[p.id]}
                            onApply={onApply}
                            onDelete={handleDelete}
                            onRename={handleRename}
                            onDuplicate={(id) => {
                                const copy = handleDuplicate(id);
                                if (copy) toast.success(`Profil « ${copy.name} » créé`);
                            }}
                            canUpdate={canSave}
                            onUpdateFromCurrent={onUpdateProfile
                                ? (id) => { onUpdateProfile(id); refresh(); }
                                : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
