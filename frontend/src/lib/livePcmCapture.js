/**
 * Buffer PCM live pendant un appel — pour pré-transcription par tranches
 * (évite de tout Whisper d’un coup sur un long enregistrement).
 */

const TARGET_RATE = 16000;

/**
 * @param {MediaStream} stream
 * @returns {{
 *   durationMs: () => number,
 *   takeNextChunkMs: (minDurationMs: number) => Promise<Float32Array|null>,
 *   takeRemaining: () => Promise<Float32Array|null>,
 *   stop: () => void,
 * }}
 */
export function createLivePcmBuffer(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !stream) {
        return {
            durationMs: () => 0,
            takeNextChunkMs: async () => null,
            takeRemaining: async () => null,
            stop: () => {},
        };
    }

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
    }

    const source = ctx.createMediaStreamSource(stream);
    // Buffer taille modérée — latence OK pour capture, pas pour lecture temps réel
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0;

    /** @type {Float32Array[]} */
    let parts = [];
    let samples = 0;
    let stopped = false;

    processor.onaudioprocess = (e) => {
        if (stopped) return;
        const input = e.inputBuffer.getChannelData(0);
        // Copie : le buffer AudioContext est réutilisé
        parts.push(new Float32Array(input));
        samples += input.length;
    };

    source.connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);

    const nativeRate = () => ctx.sampleRate || 48000;

    const flattenFrom = (startSample, endSample) => {
        if (endSample <= startSample || samples === 0) return null;
        const len = endSample - startSample;
        const out = new Float32Array(len);
        let cursor = 0;
        let written = 0;
        for (const part of parts) {
            const partEnd = cursor + part.length;
            if (partEnd <= startSample) {
                cursor = partEnd;
                continue;
            }
            if (cursor >= endSample) break;
            const from = Math.max(0, startSample - cursor);
            const to = Math.min(part.length, endSample - cursor);
            if (to > from) {
                out.set(part.subarray(from, to), written);
                written += to - from;
            }
            cursor = partEnd;
        }
        return written ? out.subarray(0, written) : null;
    };

    const dropBefore = (sampleIndex) => {
        if (sampleIndex <= 0) return;
        let cursor = 0;
        const kept = [];
        let keptSamples = 0;
        for (const part of parts) {
            const partEnd = cursor + part.length;
            if (partEnd <= sampleIndex) {
                cursor = partEnd;
                continue;
            }
            if (cursor >= sampleIndex) {
                kept.push(part);
                keptSamples += part.length;
            } else {
                const from = sampleIndex - cursor;
                const slice = part.subarray(from);
                if (slice.length) {
                    kept.push(new Float32Array(slice));
                    keptSamples += slice.length;
                }
            }
            cursor = partEnd;
        }
        parts = kept;
        samples = keptSamples;
    };

    const resampleTo16k = async (mono) => {
        if (!mono?.length) return null;
        const fromRate = nativeRate();
        if (Math.abs(fromRate - TARGET_RATE) < 1) return mono;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineCtx) {
            const ratio = fromRate / TARGET_RATE;
            const newLen = Math.max(1, Math.round(mono.length / ratio));
            const out = new Float32Array(newLen);
            for (let i = 0; i < newLen; i += 1) {
                const src = i * ratio;
                const i0 = Math.floor(src);
                const i1 = Math.min(mono.length - 1, i0 + 1);
                const t = src - i0;
                out[i] = mono[i0] * (1 - t) + mono[i1] * t;
            }
            return out;
        }

        const frames = Math.max(1, Math.ceil((mono.length / fromRate) * TARGET_RATE));
        const offline = new OfflineCtx(1, frames, TARGET_RATE);
        const buffer = offline.createBuffer(1, mono.length, fromRate);
        buffer.copyToChannel(mono, 0);
        const srcNode = offline.createBufferSource();
        srcNode.buffer = buffer;
        srcNode.connect(offline.destination);
        srcNode.start(0);
        const rendered = await offline.startRendering();
        const out = new Float32Array(rendered.length);
        out.set(rendered.getChannelData(0));
        return out;
    };

    return {
        durationMs: () => (samples / nativeRate()) * 1000,
        /**
         * Prend les prochaines `minDurationMs` de PCM (depuis le début du buffer restant),
         * les retire du buffer, renvoie mono 16 kHz.
         */
        takeNextChunkMs: async (minDurationMs) => {
            const need = Math.floor((minDurationMs / 1000) * nativeRate());
            if (samples < need) return null;
            const slice = flattenFrom(0, need);
            dropBefore(need);
            return resampleTo16k(slice);
        },
        takeRemaining: async () => {
            if (samples < nativeRate() * 0.4) return null; // < 0.4 s : ignore
            const slice = flattenFrom(0, samples);
            dropBefore(samples);
            return resampleTo16k(slice);
        },
        stop: () => {
            stopped = true;
            try { processor.disconnect(); } catch { /* */ }
            try { source.disconnect(); } catch { /* */ }
            try { silent.disconnect(); } catch { /* */ }
            parts = [];
            samples = 0;
            ctx.close().catch(() => {});
        },
    };
}
