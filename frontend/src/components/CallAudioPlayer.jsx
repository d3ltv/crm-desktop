import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { AudioWaveform } from "@/components/AudioWaveform";
import { formatDuration } from "@/lib/callRecordings";

/**
 * Lecteur compact 1 ligne : play · onde cliquable · temps · (download / delete)
 *
 * Lecture via Web Audio (AudioBuffer) quand un blob est fourni → seek fiable
 * même sur les enregistrements MediaRecorder (.webm) où HTMLAudio échoue.
 */
export function CallAudioPlayer({
    src,
    blob = null,
    peaks = null,
    durationMs = 0,
    onDownload = null,
    downloadLabel = "Télécharger",
    onDelete = null,
    deleteLabel = "Supprimer l'appel",
    className = "",
    compact = false,
}) {
    const audioCtxRef = useRef(null);
    const bufferRef = useRef(null);
    const sourceRef = useRef(null);
    const htmlAudioRef = useRef(null);
    const startedAtRef = useRef(0); // ctx.currentTime when playback started
    const offsetRef = useRef(0); // seconds into buffer when started
    const rafRef = useRef(0);
    const playingRef = useRef(false);

    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentSec, setCurrentSec] = useState(0);
    const [totalSec, setTotalSec] = useState(durationMs > 0 ? durationMs / 1000 : 0);
    const [decoding, setDecoding] = useState(!!blob);

    const stopSource = useCallback(() => {
        try {
            sourceRef.current?.stop?.();
        } catch { /* already stopped */ }
        sourceRef.current = null;
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        }
    }, []);

    const tick = useCallback(() => {
        if (!playingRef.current) return;
        const ctx = audioCtxRef.current;
        const buf = bufferRef.current;
        if (ctx && buf) {
            const t = offsetRef.current + (ctx.currentTime - startedAtRef.current);
            const dur = buf.duration || totalSec;
            if (t >= dur) {
                playingRef.current = false;
                setPlaying(false);
                setProgress(0);
                setCurrentSec(0);
                offsetRef.current = 0;
                stopSource();
                return;
            }
            setCurrentSec(t);
            setProgress(dur > 0 ? t / dur : 0);
        } else {
            const el = htmlAudioRef.current;
            if (el) {
                const dur = Number.isFinite(el.duration) && el.duration > 0
                    ? el.duration
                    : totalSec;
                setCurrentSec(el.currentTime || 0);
                setProgress(dur > 0 ? (el.currentTime || 0) / dur : 0);
            }
        }
        rafRef.current = requestAnimationFrame(tick);
    }, [stopSource, totalSec]);

    // Decode blob → AudioBuffer (seek fiable)
    useEffect(() => {
        if (!blob) {
            setDecoding(false);
            if (durationMs > 0) setTotalSec(durationMs / 1000);
            return undefined;
        }

        let cancelled = false;
        setDecoding(true);
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = audioCtxRef.current || new AudioCtx();
        audioCtxRef.current = ctx;

        (async () => {
            try {
                const ab = await blob.arrayBuffer();
                const buffer = await ctx.decodeAudioData(ab.slice(0));
                if (cancelled) return;
                bufferRef.current = buffer;
                setTotalSec(buffer.duration || (durationMs / 1000) || 0);
            } catch (err) {
                console.warn("[CallAudioPlayer] decode failed, fallback HTML:", err);
                bufferRef.current = null;
                if (durationMs > 0) setTotalSec(durationMs / 1000);
            } finally {
                if (!cancelled) setDecoding(false);
            }
        })();

        return () => {
            cancelled = true;
            playingRef.current = false;
            stopSource();
        };
    }, [blob, durationMs, stopSource]);

    useEffect(() => () => {
        playingRef.current = false;
        stopSource();
        audioCtxRef.current?.close?.().catch(() => {});
        audioCtxRef.current = null;
    }, [stopSource]);

    const startAt = async (offsetSec) => {
        const ctx = audioCtxRef.current;
        const buffer = bufferRef.current;

        // Web Audio path
        if (ctx && buffer) {
            if (ctx.state === "suspended") await ctx.resume();
            stopSource();
            const srcNode = ctx.createBufferSource();
            srcNode.buffer = buffer;
            srcNode.connect(ctx.destination);
            const dur = buffer.duration;
            const off = Math.min(Math.max(0, offsetSec), Math.max(0, dur - 0.01));
            offsetRef.current = off;
            startedAtRef.current = ctx.currentTime;
            srcNode.onended = () => {
                if (sourceRef.current !== srcNode) return;
                // fin naturelle uniquement si on a dépassé la durée
                const t = offsetRef.current + (ctx.currentTime - startedAtRef.current);
                if (t >= dur - 0.05) {
                    playingRef.current = false;
                    setPlaying(false);
                    setProgress(0);
                    setCurrentSec(0);
                    offsetRef.current = 0;
                    sourceRef.current = null;
                }
            };
            srcNode.start(0, off);
            sourceRef.current = srcNode;
            playingRef.current = true;
            setPlaying(true);
            setCurrentSec(off);
            setProgress(dur > 0 ? off / dur : 0);
            rafRef.current = requestAnimationFrame(tick);
            return;
        }

        // Fallback HTML audio
        const el = htmlAudioRef.current;
        if (!el) return;
        const dur = Number.isFinite(el.duration) && el.duration > 0
            ? el.duration
            : (durationMs / 1000) || 0;
        if (dur > 0 && Number.isFinite(offsetSec)) {
            try { el.currentTime = Math.min(dur, Math.max(0, offsetSec)); } catch { /* */ }
        }
        await el.play();
        playingRef.current = true;
        setPlaying(true);
        rafRef.current = requestAnimationFrame(tick);
    };

    const togglePlay = async () => {
        if (playingRef.current) {
            // pause
            if (bufferRef.current && audioCtxRef.current) {
                const ctx = audioCtxRef.current;
                offsetRef.current += ctx.currentTime - startedAtRef.current;
                stopSource();
            } else {
                htmlAudioRef.current?.pause();
                stopSource();
            }
            playingRef.current = false;
            setPlaying(false);
            return;
        }
        await startAt(offsetRef.current || currentSec || 0);
    };

    const handleSeek = async (ratio) => {
        const dur = (bufferRef.current?.duration)
            || totalSec
            || (durationMs > 0 ? durationMs / 1000 : 0);
        if (!(dur > 0) || !Number.isFinite(ratio)) return;
        const t = Math.min(dur, Math.max(0, ratio * dur));
        setProgress(ratio);
        setCurrentSec(t);
        offsetRef.current = t;

        if (playingRef.current) {
            await startAt(t);
        } else if (htmlAudioRef.current && !bufferRef.current) {
            try { htmlAudioRef.current.currentTime = t; } catch { /* */ }
        }
    };

    const hasPeaks = Array.isArray(peaks) && peaks.length > 0;

    return (
        <div className={`flex items-center gap-2 min-w-0 ${className}`}>
            {/* Fallback HTML — utilisé seulement si le decode Web Audio échoue */}
            {src && (
                <audio
                    ref={htmlAudioRef}
                    src={src}
                    preload="auto"
                    className="hidden"
                    onEnded={() => {
                        if (bufferRef.current) return;
                        playingRef.current = false;
                        setPlaying(false);
                        setProgress(0);
                        setCurrentSec(0);
                        offsetRef.current = 0;
                    }}
                />
            )}

            <button
                type="button"
                onClick={togglePlay}
                disabled={decoding && !src}
                className="h-8 w-8 rounded-full shrink-0 inline-flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                aria-label={playing ? "Pause" : "Lecture"}
                data-testid="call-audio-play"
            >
                {decoding ? (
                    <Loader2 size={13} className="animate-spin" />
                ) : playing ? (
                    <Pause size={13} fill="currentColor" />
                ) : (
                    <Play size={13} fill="currentColor" className="ml-0.5" />
                )}
            </button>

            <div className="flex-1 min-w-0 rounded-md bg-muted/40 px-1.5 py-0.5">
                <AudioWaveform
                    peaks={hasPeaks ? peaks : null}
                    blob={hasPeaks ? null : blob}
                    progress={progress}
                    onSeek={handleSeek}
                    barCount={compact ? 40 : 56}
                    heightClass="h-8"
                />
            </div>

            <span className="text-[10px] tabular-nums text-muted-foreground shrink-0 min-w-[4.25rem] text-right">
                {formatDuration(currentSec * 1000)}
                {totalSec > 0 ? ` / ${formatDuration(totalSec * 1000)}` : ""}
            </span>

            {onDownload && (
                <button
                    type="button"
                    onClick={onDownload}
                    className="h-7 w-7 rounded-full shrink-0 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title={downloadLabel}
                    aria-label={downloadLabel}
                    data-testid="call-audio-download"
                >
                    <Download size={13} />
                </button>
            )}
            {onDelete && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete();
                    }}
                    className="h-7 w-7 rounded-full shrink-0 inline-flex items-center justify-center text-destructive hover:bg-destructive/10"
                    title={deleteLabel}
                    aria-label={deleteLabel}
                    data-testid="call-audio-delete"
                >
                    <Trash2 size={13} strokeWidth={2} />
                </button>
            )}
        </div>
    );
}
