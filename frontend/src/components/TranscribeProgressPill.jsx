/**
 * Pastille flottante — progression transcription Whisper (non bloquante).
 * Affichage fin, calme ; le reste de l'UI reste cliquable.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * @param {{
 *   open?: boolean,
 *   percent?: number,
 *   label?: string,
 *   detail?: string,
 * }} props
 */
export function TranscribeProgressPill({
    open = false,
    percent = 0,
    label = "Transcription",
    detail = "",
}) {
    const [displayPct, setDisplayPct] = useState(0);
    const targetPct = Math.max(0, Math.min(100, Number(percent) || 0));

    // Lissage visuel vers la cible (évite les sauts brusques)
    useEffect(() => {
        if (!open) {
            setDisplayPct(0);
            return undefined;
        }
        const id = window.setInterval(() => {
            setDisplayPct((prev) => {
                if (prev >= targetPct) return targetPct;
                if (targetPct < prev) return targetPct;
                const step = Math.max(0.35, (targetPct - prev) * 0.16);
                return Math.min(targetPct, prev + step);
            });
        }, 40);
        return () => window.clearInterval(id);
    }, [open, targetPct]);

    if (!open || typeof document === "undefined") return null;

    const shown = Math.round(displayPct);

    return createPortal(
        <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[88] flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            data-testid="transcribe-progress-pill"
            aria-live="polite"
            aria-busy="true"
        >
            <div
                className={cn(
                    "pointer-events-none flex flex-col gap-1.5",
                    "min-w-[200px] max-w-[min(320px,90vw)] px-3.5 py-2.5",
                    "rounded-2xl border border-border/60 bg-card/95 backdrop-blur-md",
                    "shadow-lg shadow-foreground/8",
                    "animate-in fade-in slide-in-from-bottom-2 duration-200"
                )}
            >
                <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[12px] font-medium text-foreground tracking-tight truncate">
                            {label}
                        </p>
                        {detail ? (
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {detail}
                            </p>
                        ) : null}
                    </div>
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground shrink-0">
                        {shown}%
                    </span>
                </div>
                <div
                    className="h-[3px] w-full rounded-full bg-secondary overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={shown}
                >
                    <div
                        className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                        style={{ width: `${shown}%` }}
                    />
                </div>
            </div>
        </div>,
        document.body
    );
}

export default TranscribeProgressPill;
