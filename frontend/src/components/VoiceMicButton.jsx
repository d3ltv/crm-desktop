import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { pickAudioMimeType, formatDuration } from "@/lib/callRecordings";
import { openProcessedMic, createCallRecorder } from "@/lib/audioCapture";
import { startPeakSampler } from "@/components/AudioWaveform";
import { cn } from "@/lib/utils";

/**
 * Bouton micro compact (calendrier) — contrôles inline, pas de dock global
 * (le dock persistant est réservé à la session fiche prospect).
 */
export function VoiceMicButton({
    onChange,
    onBusyChange,
    disabled = false,
    className = "",
}) {
    const [status, setStatus] = useState("idle"); // idle | recording | ready | denied
    const [elapsedMs, setElapsedMs] = useState(0);

    const mediaRecorderRef = useRef(null);
    const captureCleanupRef = useRef(null);
    const chunksRef = useRef([]);
    const startedAtRef = useRef(0);
    const timerRef = useRef(null);
    const mimeRef = useRef("");
    const peakSamplerRef = useRef(null);

    const cleanupStream = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        captureCleanupRef.current?.();
        captureCleanupRef.current = null;
        mediaRecorderRef.current = null;
    };

    useEffect(() => () => {
        peakSamplerRef.current?.stop?.();
        peakSamplerRef.current = null;
        cleanupStream();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        onBusyChange?.(status === "recording");
        return () => onBusyChange?.(false);
    }, [status, onBusyChange]);

    const reset = () => {
        peakSamplerRef.current?.stop?.();
        peakSamplerRef.current = null;
        cleanupStream();
        chunksRef.current = [];
        setElapsedMs(0);
        setStatus("idle");
        onChange?.(null);
    };

    const start = async () => {
        if (disabled || status === "recording") return;
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            return;
        }
        try {
            onChange?.(null);
            const mimeType = pickAudioMimeType();
            mimeRef.current = mimeType;
            const { stream, cleanup } = await openProcessedMic();
            captureCleanupRef.current = cleanup;
            chunksRef.current = [];
            peakSamplerRef.current = startPeakSampler(stream, 48);

            const recorder = createCallRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data?.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                const type = mimeRef.current || recorder.mimeType || "audio/webm";
                const blob = new Blob(chunksRef.current, { type });
                const durationMs = Date.now() - startedAtRef.current;
                const peaks = peakSamplerRef.current?.stop?.() || [];
                peakSamplerRef.current = null;
                cleanupStream();
                if (!blob.size) {
                    setStatus("idle");
                    onChange?.(null);
                    return;
                }
                setElapsedMs(durationMs);
                setStatus("ready");
                onChange?.({ blob, mimeType: type, durationMs, peaks });
            };

            startedAtRef.current = Date.now();
            setElapsedMs(0);
            setStatus("recording");
            recorder.start();
            timerRef.current = setInterval(() => {
                setElapsedMs(Date.now() - startedAtRef.current);
            }, 250);
        } catch (err) {
            peakSamplerRef.current?.stop?.();
            peakSamplerRef.current = null;
            cleanupStream();
            setStatus(err?.name === "NotAllowedError" ? "denied" : "idle");
        }
    };

    const stop = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === "inactive") {
            peakSamplerRef.current?.stop?.();
            peakSamplerRef.current = null;
            cleanupStream();
            setStatus("idle");
            return;
        }
        recorder.stop();
    };

    if (status === "denied") {
        return (
            <button
                type="button"
                onClick={() => setStatus("idle")}
                className={cn(
                    "h-7 px-2 rounded-lg text-[10px] text-muted-foreground hover:bg-secondary",
                    className
                )}
                title="Micro refusé — cliquer pour réessayer"
            >
                Micro refusé
            </button>
        );
    }

    if (status === "ready") {
        return (
            <span className={cn("inline-flex items-center gap-0.5", className)}>
                <span
                    className="h-7 px-2 rounded-lg bg-primary/10 text-primary text-[11px] font-medium tabular-nums inline-flex items-center gap-1"
                    title="Appel prêt"
                >
                    <Mic size={12} strokeWidth={2.25} />
                    {formatDuration(elapsedMs)}
                </span>
                <button
                    type="button"
                    onClick={reset}
                    className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-destructive"
                    aria-label="Supprimer l'appel"
                    title="Supprimer"
                >
                    <Trash2 size={12} />
                </button>
            </span>
        );
    }

    if (status === "recording") {
        return (
            <button
                type="button"
                onClick={stop}
                data-testid="voice-mic-stop"
                className={cn(
                    "h-7 px-2 rounded-lg bg-foreground text-background text-[11px] font-medium tabular-nums inline-flex items-center gap-1.5",
                    className
                )}
                title="Arrêter l'enregistrement"
            >
                <Square size={10} fill="currentColor" />
                {formatDuration(elapsedMs)}
            </button>
        );
    }

    return (
        <button
            type="button"
            data-testid="voice-mic-start"
            disabled={disabled}
            onClick={start}
            className={cn(
                "h-7 w-7 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50",
                className
            )}
            aria-label="Enregistrer un appel"
            title="Enregistrer un appel"
        >
            <Mic size={14} strokeWidth={1.75} />
        </button>
    );
}
