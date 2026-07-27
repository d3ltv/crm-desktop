import React, { useEffect, useRef, useState, useCallback } from "react";

const DEFAULT_BARS = 64;

/**
 * Calcule des pics d'amplitude (0–1) depuis un AudioBuffer.
 */
export function peaksFromAudioBuffer(buffer, barCount = DEFAULT_BARS) {
    if (!buffer?.length) return [];
    const raw = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(raw.length / barCount));
    const peaks = [];
    for (let i = 0; i < barCount; i += 1) {
        const start = i * block;
        const end = Math.min(start + block, raw.length);
        let sum = 0;
        let peak = 0;
        for (let j = start; j < end; j += 1) {
            const v = Math.abs(raw[j]);
            sum += v;
            if (v > peak) peak = v;
        }
        const avg = sum / Math.max(1, end - start);
        peaks.push(Math.min(1, peak * 0.65 + avg * 1.4));
    }
    return peaks;
}

export async function peaksFromBlob(blob, barCount = DEFAULT_BARS) {
    if (!blob || typeof AudioContext === "undefined") return [];
    const ctx = new AudioContext();
    try {
        const ab = await blob.arrayBuffer();
        const buffer = await ctx.decodeAudioData(ab.slice(0));
        return peaksFromAudioBuffer(buffer, barCount);
    } catch (err) {
        console.warn("[Waveform] decode failed:", err);
        return [];
    } finally {
        await ctx.close().catch(() => {});
    }
}

function drawBars(canvas, peaks, {
    progress = null,
    live = false,
} = {}) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 280;
    const cssH = canvas.clientHeight || 36;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const n = peaks.length || 0;
    if (!n) return;

    const gap = 1.5;
    const barW = Math.max(1.5, (cssW - gap * (n - 1)) / n);
    const mid = cssH / 2;
    const maxH = cssH * 0.9;

    const stroke = getComputedStyle(canvas).getPropertyValue("--waveform-color").trim()
        || (live ? "#e11d48" : "#0f766e");
    const muted = getComputedStyle(canvas).getPropertyValue("--waveform-muted").trim()
        || "rgba(100,116,139,0.35)";

    for (let i = 0; i < n; i += 1) {
        const amp = Math.max(0.06, Math.min(1, peaks[i] || 0));
        const h = Math.max(3, amp * maxH);
        const x = i * (barW + gap);
        const y = mid - h / 2;
        const played = progress == null ? true : (i + 0.5) / n <= progress;
        ctx.fillStyle = played ? stroke : muted;
        ctx.beginPath();
        const r = Math.min(2, barW / 2);
        if (ctx.roundRect) ctx.roundRect(x, y, barW, h, r);
        else ctx.rect(x, y, barW, h);
        ctx.fill();
    }
}

/**
 * Forme d'onde live ou figée.
 * Seek : via onSeek(ratio) — le parent gère la durée (webm souvent Infinity).
 */
export function AudioWaveform({
    liveStream = null,
    peaks: peaksProp = null,
    blob = null,
    progress: progressProp = null,
    onSeek = null,
    barCount = DEFAULT_BARS,
    className = "",
    live = false,
    heightClass = "h-9",
}) {
    const canvasRef = useRef(null);
    const [peaks, setPeaks] = useState(peaksProp || []);
    const progress = progressProp ?? 0;

    useEffect(() => {
        if (peaksProp?.length) setPeaks(peaksProp);
    }, [peaksProp]);

    useEffect(() => {
        if (peaksProp?.length || !blob) return undefined;
        let cancelled = false;
        peaksFromBlob(blob, barCount).then((p) => {
            if (!cancelled && p.length) setPeaks(p);
        });
        return () => { cancelled = true; };
    }, [blob, barCount, peaksProp]);

    useEffect(() => {
        if (!liveStream || !live) return undefined;

        const history = Array(barCount).fill(0.06);
        let cancelled = false;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(liveStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let raf = 0;

        const tick = () => {
            if (cancelled) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            let peak = 0;
            for (let i = 0; i < data.length; i += 1) {
                const v = Math.abs(data[i] - 128) / 128;
                sum += v;
                if (v > peak) peak = v;
            }
            const level = Math.min(1, peak * 0.7 + (sum / data.length) * 1.8);
            history.push(level);
            if (history.length > barCount) history.shift();
            setPeaks([...history]);
            const canvas = canvasRef.current;
            if (canvas) drawBars(canvas, history, { live: true, progress: null });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            source.disconnect();
            analyser.disconnect();
            ctx.close().catch(() => {});
        };
    }, [liveStream, live, barCount]);

    useEffect(() => {
        if (live) return;
        const canvas = canvasRef.current;
        if (!canvas || !peaks.length) return;
        drawBars(canvas, peaks, { progress, live: false });
    }, [peaks, progress, live]);

    const handlePointer = (e) => {
        if (live || !onSeek) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width) return;
        const clientX = e.clientX ?? e.touches?.[0]?.clientX;
        if (clientX == null) return;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        if (!Number.isFinite(ratio)) return;
        onSeek(ratio);
    };

    return (
        <canvas
            ref={canvasRef}
            role={onSeek && !live ? "slider" : "img"}
            aria-label={live ? "Niveau micro en direct" : "Forme d'onde — cliquer pour naviguer"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            onClick={handlePointer}
            onPointerDown={onSeek && !live ? handlePointer : undefined}
            className={`w-full ${heightClass} block rounded-md ${onSeek && !live ? "cursor-pointer" : ""} ${className}`}
            style={{
                ["--waveform-color"]: live ? "#e11d48" : "hsl(var(--primary))",
                ["--waveform-muted"]: "hsl(var(--muted-foreground) / 0.28)",
            }}
        />
    );
}

/**
 * Échantillonne le niveau RMS d'un stream (peaks pendant l'enregistrement).
 */
export function startPeakSampler(stream, barCount = DEFAULT_BARS) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !stream) {
        return { stop: () => [] };
    }
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const samples = [];
    const interval = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
            const v = Math.abs(data[i] - 128) / 128;
            sum += v;
            if (v > peak) peak = v;
        }
        samples.push(Math.min(1, peak * 0.7 + (sum / data.length) * 1.8));
    }, 80);

    return {
        stop: () => {
            clearInterval(interval);
            source.disconnect();
            analyser.disconnect();
            ctx.close().catch(() => {});
            if (!samples.length) return Array(barCount).fill(0.06);
            const out = [];
            const block = samples.length / barCount;
            for (let i = 0; i < barCount; i += 1) {
                const start = Math.floor(i * block);
                const end = Math.floor((i + 1) * block) || start + 1;
                let max = 0;
                let sum = 0;
                let n = 0;
                for (let j = start; j < end && j < samples.length; j += 1) {
                    max = Math.max(max, samples[j]);
                    sum += samples[j];
                    n += 1;
                }
                out.push(n ? Math.min(1, max * 0.55 + (sum / n) * 0.7) : 0.06);
            }
            return out;
        },
    };
}

/** Durée utile pour seek / progress (webm → souvent Infinity côté navigateur). */
export function resolveAudioDurationSec(audioEl, durationMs = 0) {
    if (audioEl) {
        const d = audioEl.duration;
        if (Number.isFinite(d) && d > 0) return d;
        try {
            if (audioEl.seekable?.length > 0) {
                const end = audioEl.seekable.end(audioEl.seekable.length - 1);
                if (Number.isFinite(end) && end > 0) return end;
            }
        } catch { /* ignore */ }
    }
    if (Number.isFinite(durationMs) && durationMs > 0) return durationMs / 1000;
    return 0;
}
