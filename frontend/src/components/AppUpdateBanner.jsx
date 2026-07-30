/**
 * Bannière alignement Relia — upgrade ou retour arrière vers la version officielle.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RotateCcw, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    checkForAppUpdate,
    dismissUpdateVersion,
    downloadAndInstallAppUpdate,
    isUpdateInstallInFlight,
} from "@/lib/appUpdates";
import { isTauri } from "@/lib/diskStorage";

const AUTO_CHECK_DELAY_MS = 2_500;

export function AppUpdateBanner() {
    const [offer, setOffer] = useState(null);
    const [busy, setBusy] = useState(false);
    const [progressLabel, setProgressLabel] = useState("");
    const [error, setError] = useState("");
    const offeredRef = useRef(null);

    const runCheck = useCallback(async ({ force = false } = {}) => {
        if (!isTauri() || isUpdateInstallInFlight()) return;
        const result = await checkForAppUpdate({ force });
        if (!result) return;
        if (offeredRef.current === result.version && !force) return;
        offeredRef.current = result.version;
        setError("");
        setOffer(result);
    }, []);

    useEffect(() => {
        if (!isTauri()) return undefined;
        const t = window.setTimeout(() => {
            runCheck({ force: false });
        }, AUTO_CHECK_DELAY_MS);
        return () => window.clearTimeout(t);
    }, [runCheck]);

    const handleLater = () => {
        if (!offer || busy) return;
        dismissUpdateVersion(offer.version);
        setOffer(null);
    };

    const handleInstall = async () => {
        if (!offer || busy) return;
        setBusy(true);
        setError("");
        setProgressLabel("Téléchargement…");
        try {
            await downloadAndInstallAppUpdate(offer, ({ event }) => {
                if (event === "Started" || event === "Progress") {
                    setProgressLabel("Téléchargement et vérification…");
                } else if (event === "Finished") {
                    setProgressLabel("Installation…");
                }
            });
            setProgressLabel("");
            setOffer(null);
        } catch (err) {
            console.error("[Relia] align install:", err);
            setError(
                err?.message
                    ? String(err.message)
                    : "Impossible d’aligner cette version. Réessaie plus tard."
            );
            setProgressLabel("");
        } finally {
            setBusy(false);
        }
    };

    if (!offer || typeof document === "undefined") return null;

    const isRollback = offer.reason === "rollback";
    const title = isRollback
        ? "Retour à une version précédente"
        : "Mise à jour disponible";
    const Icon = isRollback ? RotateCcw : Download;

    return createPortal(
        <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            data-testid="app-update-banner"
            role="status"
            aria-live="polite"
        >
            <div
                className={cn(
                    "pointer-events-auto w-full max-w-[420px]",
                    "rounded-2xl border border-border/60 bg-card/95 backdrop-blur-md",
                    "shadow-lg shadow-foreground/8",
                    "animate-in fade-in slide-in-from-bottom-2 duration-200",
                    "px-4 py-3.5"
                )}
            >
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                            <Icon className="h-4 w-4" aria-hidden />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-foreground leading-snug">
                            {title}
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground leading-snug">
                            Officiel {offer.version}
                            {offer.currentVersion ? ` · tu as la ${offer.currentVersion}` : ""}
                            {" · "}tes données restent en place
                        </p>
                        {offer.notes ? (
                            <p className="mt-1.5 text-[12px] text-muted-foreground/90 line-clamp-3 whitespace-pre-wrap">
                                {offer.notes}
                            </p>
                        ) : null}
                        {progressLabel ? (
                            <p className="mt-1.5 text-[12px] tabular-nums text-primary">{progressLabel}</p>
                        ) : null}
                        {error ? (
                            <p className="mt-1.5 text-[12px] text-destructive">{error}</p>
                        ) : null}
                        <div className="mt-3 flex items-center gap-2">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={handleInstall}
                                className={cn(
                                    "inline-flex h-8 items-center justify-center rounded-full px-3.5",
                                    "bg-primary text-primary-foreground text-[12.5px] font-medium",
                                    "hover:opacity-90 disabled:opacity-60 transition-opacity"
                                )}
                            >
                                {busy ? "Installation…" : "Aligner"}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={handleLater}
                                className={cn(
                                    "inline-flex h-8 items-center justify-center rounded-full px-3",
                                    "text-[12.5px] text-muted-foreground hover:text-foreground",
                                    "disabled:opacity-50 transition-colors"
                                )}
                            >
                                Plus tard
                            </button>
                        </div>
                    </div>
                    {!busy ? (
                        <button
                            type="button"
                            onClick={handleLater}
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                            aria-label="Fermer"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    ) : null}
                </div>
            </div>
        </div>,
        document.body
    );
}
