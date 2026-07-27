import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { pickAudioMimeType, formatDuration } from "@/lib/callRecordings";
import { openProcessedMic, createCallRecorder } from "@/lib/audioCapture";
import { AudioWaveform, startPeakSampler } from "@/components/AudioWaveform";
import { CallAudioPlayer } from "@/components/CallAudioPlayer";

/**
 * Enregistreur micro compact pour CallNoteModal.
 * Expose le blob via onChange({ blob, mimeType, durationMs, peaks } | null).
 * onBusyChange(true) pendant l'enregistrement en cours.
 */
export function CallRecorderBar({ onChange, onBusyChange, disabled = false }) {
    const [status, setStatus] = useState("idle"); // idle | recording | ready | unsupported | denied
    const [elapsedMs, setElapsedMs] = useState(0);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewBlob, setPreviewBlob] = useState(null);
    const [liveStream, setLiveStream] = useState(null);
    const [peaks, setPeaks] = useState([]);

    const mediaRecorderRef = useRef(null);
    const captureCleanupRef = useRef(null);
    const chunksRef = useRef([]);
    const startedAtRef = useRef(0);
    const timerRef = useRef(null);
    const mimeRef = useRef("");
    const peakSamplerRef = useRef(null);
    const previewUrlRef = useRef(null);

    const cleanupStream = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        captureCleanupRef.current?.();
        captureCleanupRef.current = null;
        mediaRecorderRef.current = null;
        setLiveStream(null);
    };

    const clearPreview = () => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
        setPreviewBlob(null);
    };

    useEffect(() => () => {
        peakSamplerRef.current?.stop?.();
        peakSamplerRef.current = null;
        cleanupStream();
        clearPreview();
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
        clearPreview();
        chunksRef.current = [];
        setElapsedMs(0);
        setPeaks([]);
        setStatus("idle");
        onChange?.(null);
    };

    const start = async () => {
        if (disabled || status === "recording") return;
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            setStatus("unsupported");
            return;
        }

        try {
            clearPreview();
            setPeaks([]);
            onChange?.(null);
            const mimeType = pickAudioMimeType();
            mimeRef.current = mimeType;
            const { stream, cleanup } = await openProcessedMic();
            captureCleanupRef.current = cleanup;
            setLiveStream(stream);
            chunksRef.current = [];
            peakSamplerRef.current = startPeakSampler(stream, 64);

            const recorder = createCallRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                const type = mimeRef.current || recorder.mimeType || "audio/webm";
                const blob = new Blob(chunksRef.current, { type });
                const durationMs = Date.now() - startedAtRef.current;
                const finalPeaks = peakSamplerRef.current?.stop?.() || [];
                peakSamplerRef.current = null;
                cleanupStream();
                if (!blob.size) {
                    setStatus("idle");
                    setPeaks([]);
                    onChange?.(null);
                    return;
                }
                const url = URL.createObjectURL(blob);
                previewUrlRef.current = url;
                setPreviewUrl(url);
                setPreviewBlob(blob);
                setElapsedMs(durationMs);
                setPeaks(finalPeaks);
                setStatus("ready");
                onChange?.({ blob, mimeType: type, durationMs, peaks: finalPeaks });
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
            console.warn("[CallRecorder] mic error:", err);
            setStatus(err?.name === "NotAllowedError" ? "denied" : "unsupported");
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

    if (status === "unsupported") {
        return (
            <p className="text-[11px] text-muted-foreground">
                Audio non supporté sur ce navigateur
            </p>
        );
    }

    if (status === "denied") {
        return (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">
                    Micro refusé — autorise-le dans les réglages du navigateur
                </p>
                <button
                    type="button"
                    onClick={() => setStatus("idle")}
                    className="text-[11px] font-medium text-foreground shrink-0"
                >
                    OK
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-2" data-testid="call-recorder">
            {status === "idle" && (
                <button
                    type="button"
                    data-testid="call-recorder-start"
                    disabled={disabled}
                    onClick={start}
                    title="Micro local · auto-suppression à 90 j sauf téléchargement"
                    className="h-9 w-full rounded-xl border border-dashed border-border text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-secondary/50 inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                    <Mic size={14} strokeWidth={1.75} />
                    Enregistrer l&apos;appel
                </button>
            )}

            {status === "recording" && (
                <div className="rounded-xl border border-border bg-secondary/30 px-2.5 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            data-testid="call-recorder-stop"
                            onClick={stop}
                            className="h-8 px-3 rounded-lg bg-foreground text-background text-[12px] font-medium inline-flex items-center gap-1.5"
                        >
                            <Square size={11} fill="currentColor" />
                            Stop
                        </button>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium tabular-nums text-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
                            {formatDuration(elapsedMs)}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                            Haut-parleur recommandé
                        </span>
                    </div>
                    {liveStream && (
                        <AudioWaveform live liveStream={liveStream} barCount={48} heightClass="h-7" />
                    )}
                </div>
            )}

            {status === "ready" && previewUrl && (
                <div className="rounded-xl border border-border bg-secondary/30 px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">
                            Audio prêt
                        </span>
                        <button
                            type="button"
                            onClick={start}
                            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                        >
                            Refaire
                        </button>
                        <button
                            type="button"
                            data-testid="call-recorder-discard"
                            onClick={reset}
                            className="ml-auto h-7 w-7 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:bg-background hover:text-destructive"
                            aria-label="Supprimer l'enregistrement"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                    <CallAudioPlayer
                        src={previewUrl}
                        blob={previewBlob}
                        peaks={peaks}
                        durationMs={elapsedMs}
                        compact
                    />
                </div>
            )}
        </div>
    );
}
