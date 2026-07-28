/**
 * Transcription locale via Whisper (transformers.js) — gratuit, offline après 1er téléchargement.
 *
 * Modèle : whisper-base (~75 Mo) — bien plus léger que small (~240 Mo).
 * Pour des notes d'appel FR courtes (tél., emails, RDV) avec language forcé,
 * le gain poids/vitesse vaut le léger écart de précision vs small.
 *
 * Anti-hallucination silence : gate RMS + params decode + nettoyage post-texte
 * (Whisper invente souvent « bruit de pause », « bla bla », sous-titres… sur le calme).
 */

import {
    decideEngineConfig,
    getDecodeParams,
    recordPerfSample,
    registerReleaseCallback,
    runExclusive,
} from "@/lib/whisperGovernor";

const MODEL_ID = "Xenova/whisper-base";
const TARGET_RATE = 16000;

/** RMS sous ce seuil ≈ silence / bruit de fond quasi nul (Float32 [-1,1]). */
const SILENCE_RMS = 0.012;
/** Si > cette part des échantillons sont « silencieux », on skippe la chunk. */
const SILENCE_SAMPLE_RATIO = 0.92;
const QUIET_SAMPLE_ABS = 0.02;

let pipelinePromise = null;

function report(onProgress, payload) {
    try {
        onProgress?.(payload);
    } catch {
        /* ignore */
    }
}

/** RMS + part d’échantillons quasi nuls. */
export function audioEnergyStats(audio) {
    if (!audio?.length) return { rms: 0, quietRatio: 1, durationSec: 0 };
    let sumSq = 0;
    let quiet = 0;
    const n = audio.length;
    for (let i = 0; i < n; i += 1) {
        const v = audio[i];
        sumSq += v * v;
        if (Math.abs(v) < QUIET_SAMPLE_ABS) quiet += 1;
    }
    return {
        rms: Math.sqrt(sumSq / n),
        quietRatio: quiet / n,
        durationSec: n / TARGET_RATE,
    };
}

/** True si l’audio est trop calme pour une vraie parole. */
export function isMostlySilent(audio) {
    const { rms, quietRatio, durationSec } = audioEnergyStats(audio);
    if (durationSec < 0.35) return true;
    if (rms < SILENCE_RMS) return true;
    if (quietRatio >= SILENCE_SAMPLE_RATIO && rms < SILENCE_RMS * 2.5) return true;
    return false;
}

/**
 * Phrases / motifs typiques inventés par Whisper FR sur silence ou jingle.
 * Ancré début→fin : pour une ligne ou un texte entier.
 */
const HALLUCINATION_FULL_RE = new RegExp(
    [
        "^\\s*(?:",
        "\\[?\\s*(?:musique|silence|applaudissements?|rires?|inaudible|bruit[s]?(?:\\s+de\\s+[\\wàâäéèêëïîôùûüç'-]+)?)\\s*\\]?",
        "|\\(?\\s*(?:musique|silence|bruit[s]?(?:\\s+de\\s+[\\wàâäéèêëïîôùûüç'-]+)?)\\s*\\)?",
        "|sous-titres?\\s+(?:réalisés?|faits?|créés?|par).+",
        "|merci\\s+d['’]avoir\\s+regardé.*",
        "|amara\\.org.*",
        "|♪+|🎵+",
        "|bla(?:\\s*[·.,_-]?\\s*bla){1,}\\.?",
        "|hum+(?:\\s+hum+){2,}",
        "|euh+(?:\\s+euh+){2,}",
        ")\\s*$",
    ].join(""),
    "i"
);

const HALLUCINATION_INLINE_RE = /\[?\s*(?:musique|silence|applaudissements?|rires?|inaudible|bruit[s]?\s+de\s+(?:pause|fond|salle|micro|ambiance))\s*\]?/gi;

/**
 * Nettoie les artefacts Whisper (répétitions, « bruit de pause », bla-bla…).
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeWhisperTranscript(raw) {
    let text = String(raw || "").replace(/\u00a0/g, " ").trim();
    if (!text) return "";

    // Détection de boucle AVANT collapse (sinon « merci×20 » devient « merci »)
    const wordsForLoop = text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^\p{L}\p{N}']+/u)
        .filter((w) => w.length > 1);
    if (wordsForLoop.length >= 8) {
        const counts = Object.create(null);
        let max = 0;
        for (const w of wordsForLoop) {
            counts[w] = (counts[w] || 0) + 1;
            if (counts[w] > max) max = counts[w];
        }
        if (max / wordsForLoop.length >= 0.4) return "";
    }

    // Lignes entièrement hallucinées
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const kept = [];
    for (const line of lines) {
        if (HALLUCINATION_FULL_RE.test(line)) continue;
        if (/^[\s.…,;:!?\-–—'"«»]+$/.test(line)) continue;
        kept.push(line);
    }
    text = kept.join("\n").trim();
    if (!text) return "";

    // Tags inline au milieu d’une vraie phrase
    text = text.replace(HALLUCINATION_INLINE_RE, " ").replace(/\s{2,}/g, " ").trim();

    // Même mot 4+ fois d’affilée → 1
    text = text.replace(
        /\b([\wÀ-ÿ][\wÀ-ÿ''-]{0,30})\b(?:\s+\1\b){3,}/gi,
        "$1"
    );

    // Même expression (2–6 mots) répétée 3+ fois → 1
    text = text.replace(
        /\b((?:[\wÀ-ÿ][\wÀ-ÿ''-]{0,24}\s+){1,5}[\wÀ-ÿ][\wÀ-ÿ''-]{0,24})\b(?:\s+\1\b){2,}/gi,
        "$1"
    );

    text = text.replace(/\bbla(?:\s*bla)+\b/gi, "");
    text = text.replace(/\b(?:bla){3,}\b/gi, "");
    text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return "";

    if (HALLUCINATION_FULL_RE.test(text)) return "";

    return text.trim();
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
                    // Multi-thread seulement si SharedArrayBuffer réel (jamais sous WKWebView) —
                    // sinon 1 thread : le multi-thread WASM fait exploser la RAM sur macOS/iOS.
                    env.backends.onnx.wasm.numThreads = decideEngineConfig().numThreads;
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

/** Libère le pipeline (gros buffers WASM) — rechargé depuis le cache navigateur au besoin. */
async function releasePipeline() {
    const p = pipelinePromise;
    pipelinePromise = null;
    if (!p) return;
    try {
        const transcriber = await p;
        await transcriber?.dispose?.();
    } catch { /* ignore */ }
}

registerReleaseCallback(() => {
    void releasePipeline();
});

/**
 * Préchauffe le modèle (à appeler quand une transcription est probable,
 * ex. début d'enregistrement) : la transcription finale démarre sans latence.
 */
export function warmupWhisper(onProgress) {
    if (!isTranscribeSupported()) return Promise.resolve(null);
    return getTranscriber(onProgress).catch(() => null);
}

/**
 * @param {Float32Array} audio mono 16 kHz
 * @param {{ onProgress?: (p: object) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function transcribeMono16k(audio, { onProgress } = {}) {
    if (!audio?.length) return "";

    if (isMostlySilent(audio)) {
        report(onProgress, {
            status: "done",
            message: "Silence — pas de transcription",
            progress: 100,
        });
        return "";
    }

    // File unique : deux décodes en parallèle doubleraient les pics RAM
    return runExclusive(async () => {
        const transcriber = await getTranscriber(onProgress);
        report(onProgress, { status: "transcribing", message: "Transcription en cours…" });

        const started = performance.now();
        const result = await transcriber(audio, {
            language: "french",
            task: "transcribe",
            ...getDecodeParams(),
            return_timestamps: false,
            // Réduit les boucles / inventions sur silence (si supporté par le generate)
            temperature: 0,
            no_repeat_ngram_size: 3,
            compression_ratio_threshold: 2.4,
            logprob_threshold: -1.0,
            no_speech_threshold: 0.6,
            condition_on_previous_text: false,
        });
        recordPerfSample(audio.length / TARGET_RATE, performance.now() - started);

        const text = sanitizeWhisperTranscript(String(result?.text || ""));
        report(onProgress, { status: "done", message: "Terminé", progress: 100 });
        return text;
    });
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
    return transcribeMono16k(audio, { onProgress });
}

export function isTranscribeSupported() {
    return typeof window !== "undefined"
        && !!(window.AudioContext || window.webkitAudioContext);
}
