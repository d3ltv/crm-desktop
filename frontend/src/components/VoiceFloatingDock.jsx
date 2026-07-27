import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Square, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { formatDuration } from "@/lib/callRecordings";
import { AudioWaveform } from "@/components/AudioWaveform";
import { cn } from "@/lib/utils";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Dock appel flottant — reste visible même si la fiche prospect est fermée.
 * mode: recording | ready
 *
 * Esc : ne coupe PAS l'enregistrement (ferme la fiche si le panneau écoute Esc).
 * En mode prêt (avant auto-save) : Esc / poubelle demande confirmation.
 */
export function VoiceFloatingDock({
    open = false,
    mode = "recording",
    elapsedMs = 0,
    liveStream = null,
    onStop,
    onDiscard,
    onOpenLead,
    label = "Appel",
    saving = false,
    busyLabel = "",
    className = "",
}) {
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const pipelineRunning = saving || !!busyLabel;

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key !== "Escape") return;
            if (mode === "recording") return;
            if (pipelineRunning) return;
            e.preventDefault();
            e.stopPropagation();
            setConfirmDiscard(true);
        };
        window.addEventListener("keydown", onKey, false);
        return () => window.removeEventListener("keydown", onKey, false);
    }, [open, mode, pipelineRunning]);

    useEffect(() => {
        if (!open) {
            document.body.removeAttribute("data-voice-dock");
            setConfirmDiscard(false);
            return undefined;
        }
        document.body.setAttribute("data-voice-dock", mode);
        return () => document.body.removeAttribute("data-voice-dock");
    }, [open, mode]);

    if (!open || typeof document === "undefined") return null;

    const isReady = mode === "ready";

    return createPortal(
        <>
            <div
                className={cn(
                    "pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
                    className
                )}
                data-testid="voice-floating-dock"
            >
                <div
                    role="status"
                    aria-live="polite"
                    className={cn(
                        "pointer-events-auto flex items-center gap-2.5",
                        "min-h-12 pl-2.5 pr-3 py-1.5 max-w-[min(520px,94vw)]",
                        "rounded-full border border-border/70 bg-card/95 backdrop-blur-md",
                        "shadow-lg shadow-foreground/10",
                        "animate-in fade-in slide-in-from-bottom-3 duration-200"
                    )}
                >
                    {isReady ? (
                        pipelineRunning ? (
                            <span className="h-9 w-9 shrink-0 rounded-full bg-secondary inline-flex items-center justify-center">
                                <Loader2 size={14} className="animate-spin text-muted-foreground" />
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setConfirmDiscard(true)}
                                className="h-9 w-9 shrink-0 rounded-full bg-secondary text-muted-foreground hover:text-destructive inline-flex items-center justify-center"
                                aria-label="Annuler"
                                title="Annuler"
                            >
                                <Trash2 size={14} strokeWidth={1.75} />
                            </button>
                        )
                    ) : (
                        <button
                            type="button"
                            data-testid="voice-dock-stop"
                            onClick={onStop}
                            className="relative h-9 w-9 shrink-0 rounded-full bg-destructive text-destructive-foreground inline-flex items-center justify-center active:scale-[0.96] transition-transform"
                            aria-label="Arrêter l'enregistrement"
                            title="Arrêter"
                        >
                            <span className="absolute inset-0 rounded-full bg-destructive/30 animate-ping opacity-30" />
                            <Square size={12} fill="currentColor" className="relative" />
                        </button>
                    )}

                    <div
                        className="flex-1 min-w-[72px] max-w-[140px] h-7 flex items-center"
                        style={{
                            "--waveform-color": "hsl(var(--primary))",
                            "--waveform-muted": "hsl(var(--muted-foreground) / 0.28)",
                        }}
                    >
                        {!isReady && liveStream ? (
                            <AudioWaveform
                                live
                                liveStream={liveStream}
                                barCount={22}
                                heightClass="h-7 w-full"
                            />
                        ) : (
                            <div className="flex items-end gap-[2px] h-5 w-full opacity-35" aria-hidden>
                                {Array.from({ length: 18 }).map((_, i) => (
                                    <span
                                        key={i}
                                        className="w-[2.5px] rounded-full bg-foreground/70"
                                        style={{ height: `${4 + (i % 5) * 2.5}px` }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="shrink-0 text-right leading-tight min-w-[52px]">
                        <p className="text-[12px] font-medium tabular-nums tracking-tight text-foreground">
                            {formatDuration(elapsedMs)}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-medium truncate max-w-[88px]">
                            {busyLabel || (isReady ? (pipelineRunning ? "…" : "Prêt") : label)}
                        </p>
                    </div>

                    {onOpenLead && (
                        <button
                            type="button"
                            onClick={onOpenLead}
                            disabled={pipelineRunning}
                            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground inline-flex items-center justify-center disabled:opacity-50"
                            aria-label="Ouvrir le prospect"
                            title="Revenir au prospect"
                        >
                            <ExternalLink size={13} strokeWidth={1.75} />
                        </button>
                    )}

                    {isReady && (
                        <span className="h-8 px-2.5 shrink-0 rounded-full bg-primary/10 text-primary text-[11px] font-medium inline-flex items-center gap-1.5">
                            {pipelineRunning ? (
                                <>
                                    <Loader2 size={12} className="animate-spin" />
                                    {busyLabel || "Transcription…"}
                                </>
                            ) : (
                                "Transcription…"
                            )}
                        </span>
                    )}
                </div>
            </div>

            <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
                <AlertDialogContent className="rounded-2xl max-w-sm z-[100]" data-testid="call-discard-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Annuler cet appel ?</AlertDialogTitle>
                        <AlertDialogDescription>
                            L&apos;enregistrement sera jeté sans être sauvegardé.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Continuer</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setConfirmDiscard(false);
                                onDiscard?.();
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Jeter
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>,
        document.body
    );
}
