/**
 * Transcription locale via Whisper (transformers.js) — gratuit, offline après 1er téléchargement.
 *
 * Modèle : whisper-base (~75 Mo) — bien plus léger que small (~240 Mo).
 * Pour des notes d'appel FR courtes (tél., emails, RDV) avec language forcé,
 * le gain poids/vitesse vaut le léger écart de précision vs small.
 */

const MODEL_ID = "Xenova/whisper-base";
const TARGET_RATE = 16000;

let pipelinePromise = null;

function report(onProgress, payload) {
    try {
        onProgress?.(payload);
    } catch {
        /* ignore */
    }
}

/**
 * Décode un Blob audio → Float32Array mono 16 kHz (format Whisper).
 * Préfère un AudioContext@16kHz pour laisser le navigateur ré-échantillonner
 * (meilleure fidélité que l'interpolation linéaire manuelle).
 */
export async function decodeAudioToMono16k(blob) {
    if (!blob) throw new Error("Audio manquant");
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext indisponible");

    // Tentative 1 : decode directement à 16 kHz (chemin Xenova / meilleur resample natif)
    let ctx = null;
    try {
        ctx = new AudioCtx({ sampleRate: TARGET_RATE });
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const ab = await blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab.slice(0));
        const mono = mixToMono(decoded);
        if (Math.abs(decoded.sampleRate - TARGET_RATE) < 1) {
            return mono;
        }
        // Certains navigateurs ignorent sampleRate à la création — OfflineAudioContext
        return await resampleOffline(mono, decoded.sampleRate, TARGET_RATE);
    } catch (primaryErr) {
        // Tentative 2 : decode au rate natif + OfflineAudioContext
        try {
            await ctx?.close?.().catch(() => {});
            ctx = new AudioCtx();
            if (ctx.state === "suspended") await ctx.resume().catch(() => {});
            const ab = await blob.arrayBuffer();
            const decoded = await ctx.decodeAudioData(ab.slice(0));
            const mono = mixToMono(decoded);
            if (Math.abs(decoded.sampleRate - TARGET_RATE) < 1) return mono;
            return await resampleOffline(mono, decoded.sampleRate, TARGET_RATE);
        } catch (fallbackErr) {
            console.warn("[transcribe] decode failed:", primaryErr, fallbackErr);
            throw fallbackErr || primaryErr;
        }
    } finally {
        await ctx?.close?.().catch(() => {});
    }
}

function mixToMono(decoded) {
    const channels = decoded.numberOfChannels;
    const len = decoded.length;
    const mono = new Float32Array(len);
    if (channels === 1) {
        mono.set(decoded.getChannelData(0));
        return mono;
    }
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.getChannelData(1);
    for (let i = 0; i < len; i += 1) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    return mono;
}

/** Rééchantillonnage via OfflineAudioContext (filtre navigateur, pas linéaire). */
async function resampleOffline(mono, fromRate, toRate) {
    if (!mono?.length) return mono;
    if (Math.abs(fromRate - toRate) < 1) return mono;

    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) {
        // Dernier recours : interpolation linéaire
        return linearResample(mono, fromRate, toRate);
    }

    const duration = mono.length / fromRate;
    const frames = Math.max(1, Math.ceil(duration * toRate));
    const offline = new OfflineCtx(1, frames, toRate);
    const buffer = offline.createBuffer(1, mono.length, fromRate);
    buffer.copyToChannel(mono, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const out = new Float32Array(rendered.length);
    out.set(rendered.getChannelData(0));
    return out;
}

function linearResample(mono, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const newLen = Math.max(1, Math.round(mono.length / ratio));
    const resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i += 1) {
        const src = i * ratio;
        const i0 = Math.floor(src);
        const i1 = Math.min(mono.length - 1, i0 + 1);
        const t = src - i0;
        resampled[i] = mono[i0] * (1 - t) + mono[i1] * t;
    }
    return resampled;
}

async function getTranscriber(onProgress) {
    if (!pipelinePromise) {
        pipelinePromise = (async () => {
            const { pipeline, env } = await import("@xenova/transformers");
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            try {
                if (env.backends?.onnx?.wasm) {
                    env.backends.onnx.wasm.numThreads = 1;
                }
            } catch {
                /* ignore */
            }

            report(onProgress, {
                status: "loading",
                message: "Téléchargement du modèle (1re fois, ~75 Mo)…",
                progress: 0,
            });

            return pipeline("automatic-speech-recognition", MODEL_ID, {
                quantized: true,
                progress_callback: (p) => {
                    if (!p) return;
                    const pct = typeof p.progress === "number" ? Math.round(p.progress) : null;
                    report(onProgress, {
                        status: "loading",
                        message: p.status === "done"
                            ? "Modèle prêt"
                            : pct != null
                                ? `Modèle ${pct}%…`
                                : "Préparation…",
                        progress: pct,
                    });
                },
            });
        })().catch((err) => {
            pipelinePromise = null;
            throw err;
        });
    }
    return pipelinePromise;
}

/**
 * @param {Blob} blob
 * @param {{ onProgress?: (p: object) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function transcribeAudioBlob(blob, { onProgress } = {}) {
    report(onProgress, { status: "decoding", message: "Lecture de l'audio…" });
    const audio = await decodeAudioToMono16k(blob);
    if (!audio?.length) throw new Error("Audio vide");

    const transcriber = await getTranscriber(onProgress);
    report(onProgress, { status: "transcribing", message: "Transcription en cours…" });

    const result = await transcriber(audio, {
        language: "french",
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
    });

    const text = String(result?.text || "").trim();
    report(onProgress, { status: "done", message: "Terminé", progress: 100 });
    return text;
}

export function isTranscribeSupported() {
    return typeof window !== "undefined"
        && !!(window.AudioContext || window.webkitAudioContext);
}
