/**
 * CrashRecovery.jsx — Détection silencieuse de crash + proposition de restauration
 *
 * Ce composant s'affiche UNIQUEMENT si quelque chose d'anormal est détecté :
 *   1. L'ErrorBoundary de App.js a capturé une erreur React
 *   2. Le localStorage est corrompu / vide alors qu'un backup IndexedDB existe
 *   3. L'état chargé est vide (0 workspaces) alors qu'un backup récent existe
 *
 * Dans les autres cas il est totalement invisible — aucun toast, aucune UI.
 * La restauration ne se fait QU'après confirmation explicite de l'utilisateur.
 */

import React, { useEffect, useState } from "react";
import {
    getLatestBackup,
    parseBackup,
    formatBackupDate,
    getAllBackups,
} from "@/lib/autoBackup";
import { ShieldAlert, RotateCcw, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Seuil : si le backup a moins de 7 jours et contient au moins 1 workspace,
// on propose la restauration.
const MAX_BACKUP_AGE_MS = 7 * 24 * 3600 * 1000;

/**
 * Vérifie si la situation actuelle justifie une proposition de récupération.
 * Retourne le backup candidat ou null.
 */
async function detectAnomalyAndGetBackup(currentWorkspaceCount) {
    const backup = await getLatestBackup();
    if (!backup) return null;

    // Backup trop vieux — on ne propose pas
    if (Date.now() - backup.ts > MAX_BACKUP_AGE_MS) return null;

    const parsed = parseBackup(backup);
    if (!parsed) return null;

    const backupWsCount = Object.keys(parsed.workspaces || {}).length;
    if (backupWsCount === 0) return null;

    // Anomalie : l'app n'a aucun workspace mais le backup en a
    if (currentWorkspaceCount === 0 && backupWsCount > 0) return backup;

    // Anomalie : l'app a nettement moins de workspaces que le backup
    // (ex. crash pendant une suppression partielle)
    if (currentWorkspaceCount < backupWsCount / 2 && backupWsCount >= 2) return backup;

    return null;
}

/**
 * Props :
 *   - crashError : Error | null  — erreur capturée par l'ErrorBoundary
 *   - currentWorkspaceCount : number — nombre de workspaces chargés
 *   - onRestore : (parsedState) => void — appelé après confirmation
 *   - onDismiss : () => void — appelé quand l'utilisateur refuse
 */
export const CrashRecovery = ({
    crashError = null,
    currentWorkspaceCount = 0,
    onRestore,
    onDismiss,
}) => {
    const [backup, setBackup]           = useState(null);
    const [parsed, setParsed]           = useState(null);
    const [allBackups, setAllBackups]   = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [dismissed, setDismissed]     = useState(false);
    const [confirming, setConfirming]   = useState(false);

    useEffect(() => {
        // Chercher un backup pertinent au montage
        const run = async () => {
            // Si crash React explicite → toujours chercher
            if (crashError) {
                const b = await getLatestBackup();
                if (b) {
                    const p = parseBackup(b);
                    if (p && Object.keys(p.workspaces || {}).length > 0) {
                        setBackup(b);
                        setParsed(p);
                        const all = await getAllBackups();
                        setAllBackups(all);
                    }
                }
                return;
            }

            // Pas de crash explicite — vérifier anomalie silencieuse
            const b = await detectAnomalyAndGetBackup(currentWorkspaceCount);
            if (b) {
                const p = parseBackup(b);
                setBackup(b);
                setParsed(p);
                const all = await getAllBackups();
                setAllBackups(all);
            }
        };
        run();
    }, [crashError, currentWorkspaceCount]); // eslint-disable-line react-hooks/exhaustive-deps

    // Rien à afficher : pas de backup pertinent ou l'utilisateur a refusé
    if (!backup || !parsed || dismissed) return null;

    const wsCount  = Object.keys(parsed.workspaces || {}).length;
    const leadCount = Object.values(parsed.workspaces || {})
        .reduce((s, ws) => s + Object.keys(ws.leads || {}).length, 0);

    const handleRestore = () => {
        onRestore?.(parsed);
        setDismissed(true);
    };

    const handleDismiss = () => {
        setDismissed(true);
        onDismiss?.();
    };

    const handleSelectBackup = async (b) => {
        const p = parseBackup(b);
        if (p) {
            setBackup(b);
            setParsed(p);
            setShowHistory(false);
        }
    };

    return (
        // Bandeau discret en haut de l'écran — pas un overlay bloquant
        <div
            role="alert"
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-lg px-4"
        >
            <div className="bg-card border border-amber-400/40 rounded-2xl shadow-2xl overflow-hidden">
                {/* En-tête */}
                <div className="flex items-start gap-3 p-4">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <ShieldAlert size={18} className="text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[14px] text-foreground">
                            {crashError
                                ? "L'application a rencontré une erreur"
                                : "Données manquantes détectées"}
                        </p>
                        <p className="text-[12.5px] text-muted-foreground mt-0.5 leading-relaxed">
                            Un backup du{" "}
                            <span className="font-medium text-foreground">
                                {formatBackupDate(backup.ts)}
                            </span>{" "}
                            contient{" "}
                            <span className="font-medium text-foreground">
                                {wsCount} espace{wsCount > 1 ? "s" : ""}
                            </span>{" "}
                            et{" "}
                            <span className="font-medium text-foreground">
                                {leadCount} lead{leadCount > 1 ? "s" : ""}
                            </span>
                            . Voulez-vous le restaurer ?
                        </p>
                    </div>
                    <button
                        onClick={handleDismiss}
                        aria-label="Ignorer"
                        className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Boutons */}
                <div className="flex items-center gap-2 px-4 pb-4">
                    {!confirming ? (
                        <>
                            <Button
                                onClick={() => setConfirming(true)}
                                className="h-9 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[13px] gap-1.5"
                            >
                                <RotateCcw size={13} />
                                Restaurer ce backup
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={handleDismiss}
                                className="h-9 rounded-full text-[13px] text-muted-foreground"
                            >
                                Ignorer
                            </Button>
                            {allBackups.length > 1 && (
                                <button
                                    onClick={() => setShowHistory((v) => !v)}
                                    className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {allBackups.length - 1} autre{allBackups.length > 2 ? "s" : ""}
                                    {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                            )}
                        </>
                    ) : (
                        // Confirmation explicite — on ne restaure pas d'un simple clic
                        <div className="flex-1 space-y-2">
                            <p className="text-[12.5px] text-foreground font-medium">
                                Confirmer la restauration ? L'état actuel sera remplacé.
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleRestore}
                                    className="h-9 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[13px]"
                                >
                                    Oui, restaurer
                                </Button>
                                <Button
                                    variant="ghost"
                                    onClick={() => setConfirming(false)}
                                    className="h-9 rounded-full text-[13px]"
                                >
                                    Annuler
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Historique des backups (optionnel, caché par défaut) */}
                {showHistory && allBackups.length > 1 && (
                    <div className="border-t border-border/60 px-4 py-3 space-y-1 bg-muted/30">
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
                            Backups disponibles
                        </p>
                        {allBackups.map((b) => {
                            const p = parseBackup(b);
                            const wsN = Object.keys(p?.workspaces || {}).length;
                            const lN = Object.values(p?.workspaces || {})
                                .reduce((s, ws) => s + Object.keys(ws.leads || {}).length, 0);
                            const isSelected = b.ts === backup.ts;
                            return (
                                <button
                                    key={b.ts}
                                    onClick={() => handleSelectBackup(b)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[12px] transition-colors ${
                                        isSelected
                                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                                            : "hover:bg-muted text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    <span>{formatBackupDate(b.ts)}</span>
                                    <span className="opacity-60">
                                        {wsN} espace{wsN > 1 ? "s" : ""} · {lN} lead{lN > 1 ? "s" : ""}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
