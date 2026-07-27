/**
 * StorageErrorBanner.jsx — Alerte persistante de dépassement de quota localStorage
 *
 * S'affiche dès que saveState() retourne false (QuotaExceededError ou mode privé).
 * Ce n'est PAS un toast : le bandeau reste visible jusqu'à ce que le problème soit résolu.
 *
 * Ce que l'utilisateur peut faire :
 *   1. Exporter un backup JSON (préserve tout)
 *   2. Lire les instructions pour libérer de l'espace (supprimer des leads anciens)
 *
 * Ce composant ne modifie aucune donnée.
 */

import React, { useState } from "react";
import { AlertTriangle, Download, X, ChevronDown, ChevronUp } from "lucide-react";
import { useCrm } from "@/context/CrmContext";

export const StorageErrorBanner = () => {
    const { storageError, exportBackup } = useCrm();
    const [expanded, setExpanded] = useState(false);

    if (!storageError) return null;

    return (
        <div
            role="alert"
            aria-live="assertive"
            className="sticky top-0 z-[9998] w-full bg-destructive text-destructive-foreground shadow-lg"
        >
            {/* Ligne principale */}
            <div className="flex items-center gap-3 px-4 py-2.5">
                <AlertTriangle size={16} className="shrink-0" aria-hidden />

                <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold">
                        Stockage plein — vos dernières modifications ne sont pas sauvegardées
                    </span>
                    <span className="hidden sm:inline text-sm opacity-80 ml-2">
                        Exportez un backup puis libérez de l'espace.
                    </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={exportBackup}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-sm font-medium transition-colors"
                        aria-label="Exporter un backup JSON"
                    >
                        <Download size={13} />
                        <span className="hidden sm:inline">Exporter backup</span>
                        <span className="sm:hidden">Backup</span>
                    </button>

                    <button
                        onClick={() => setExpanded((v) => !v)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium transition-colors"
                        aria-expanded={expanded}
                        aria-label={expanded ? "Masquer les détails" : "Voir comment libérer de l'espace"}
                    >
                        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        <span className="hidden sm:inline">
                            {expanded ? "Masquer" : "Comment libérer ?"}
                        </span>
                    </button>
                </div>
            </div>

            {/* Panneau expandable — instructions */}
            {expanded && (
                <div className="px-4 pb-3 pt-0 border-t border-white/20">
                    <p className="text-sm font-semibold mb-1.5 mt-2">
                        Comment libérer de l'espace :
                    </p>
                    <ol className="text-sm opacity-90 space-y-1 list-decimal list-inside">
                        <li>
                            <strong>Exportez d'abord un backup JSON</strong> via le bouton ci-dessus
                            — vos données sont sauvegardées hors du navigateur.
                        </li>
                        <li>
                            Supprimez les leads dans les colonnes <em>Perdu</em> ou <em>Gagné</em>{" "}
                            qui ne sont plus utiles au suivi quotidien.
                        </li>
                        <li>
                            Si le problème persiste, utilisez{" "}
                            <strong>Paramètres → Supprimer l'espace</strong> sur les workspaces
                            archivés ou inactifs.
                        </li>
                    </ol>
                    <p className="text-xs opacity-70 mt-2">
                        Note : un backup IndexedDB a été créé automatiquement en mémoire du
                        navigateur. Il sera proposé en restauration si vous rechargez la page.
                    </p>
                </div>
            )}
        </div>
    );
};
