/**
 * Transcription locale via Whisper (transformers.js) — offline après 1er téléchargement.
 *
 * Modèle : whisper-small quantisé (~244 Mo).
 *
 * Pipeline (qualité FR cold call) :
 *  1. Une passe continue Whisper (pas de découpe VAD mid-phrase)
 *  2. Diarisation Speaker 1/2 seulement sur longues pauses (≥ 0,85 s)
 *  3. Fusion des blocs même locuteur + polish FR métier (RDV, vendredi…)
 *
 * Les appels très longs (> ~2 min) sont découpés en fenêtres larges avec
 * contexte lexical reporté — jamais en micro-tours sur 400 ms de silence.
 */

import {
    decideEngineConfig,
    getDecodeParams,
    recordPerfSample,
    registerReleaseCallback,
    runExclusive,
} from "@/lib/whisperGovernor";
import {
    diarizeWhisperResult,
    finalizeSpeakerTranscript,
    lastSpeakerFromTranscript,
    SPEAKER_LINE_RE,
} from "@/lib/speakerDiarize";
import { isNativeWhisperReady, transcribeNativeMono16k } from "@/lib/whisperNative";

export { stripSpeakerLabels, lastSpeakerFromTranscript } from "@/lib/speakerDiarize";

const MODEL_ID = "Xenova/whisper-small";
const TARGET_RATE = 16000;

/**
 * Une seule passe Whisper tant que l'audio tient dans cette durée.
 * Au-delà : fenêtres larges (mémoire), pas des tours VAD.
 */
const SINGLE_PASS_MAX_SEC = 120;
const WINDOW_SEC = 90;
const WINDOW_OVERLAP_SEC = 4;

/** Biais lexical — phrases types cold call FR (réduit « dévou » / « DV »). */
const FR_CALL_PROMPT =
    "Appel commercial en français. Bonjour, allô, rendez-vous, RDV, "
    + "mettre un rendez-vous, demain à 8 heures 15, vendredi prochain à 13 heures 40, "
    + "s'il vous plaît, téléphone, email, prospect, semaine prochaine.";

/** RMS sous ce seuil ≈ silence / bruit de fond quasi nul (Float32 [-1,1]). */
const SILENCE_RMS = 0.012;
const SILENCE_SAMPLE_RATIO = 0.92;
const QUIET_SAMPLE_ABS = 0.02;

let pipelinePromise = null;
let loadedModelId = null;

function report(onProgress, payload) {
    try {
        onProgress?.(payload);
    } catch {
        /* ignore */
    }
}

function yieldToUi(ms = 24) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
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

export function isMostlySilent(audio) {
    const { rms, quietRatio, durationSec } = audioEnergyStats(audio);
    if (durationSec < 0.35) return true;
    if (rms < SILENCE_RMS) return true;
    if (quietRatio >= SILENCE_SAMPLE_RATIO && rms < SILENCE_RMS * 2.5) return true;
    return false;
}

/**
 * Découpe l'audio sur de **vraies** pauses (fenêtres longues uniquement).
 * Ne sert plus à inventer des tours Speaker toutes les 400 ms.
 * @param {Float32Array} audio
 * @returns {{ samples: Float32Array, startSec: number, endSec: number }[]}
 */
export function segmentBySilence(audio, opts = {}) {
    if (!audio?.length) return [];
    const frameMs = opts.frameMs ?? 30;
    // Pause longue = coupure OK. 900 ms ≈ vrai silence d'échange, pas une réflexion.
    const silenceGapMs = opts.silenceGapMs ?? 900;
    const minSpeechMs = opts.minSpeechMs ?? 400;
    const maxSpeechSec = opts.maxSpeechSec ?? WINDOW_SEC;
    const silenceRms = opts.silenceRms ?? 0.016;
    const padMs = opts.padMs ?? 120;

    const frameSamples = Math.max(1, Math.round((frameMs / 1000) * TARGET_RATE));
    const gapFrames = Math.max(1, Math.round(silenceGapMs / frameMs));
    const minSpeechFrames = Math.max(1, Math.round(minSpeechMs / frameMs));
    const maxSpeechSamples = Math.round(maxSpeechSec * TARGET_RATE);
    const padSamples = Math.round((padMs / 1000) * TARGET_RATE);

    /** @type {boolean[]} */
    const voiced = [];
    for (let i = 0; i < audio.length; i += frameSamples) {
        const end = Math.min(audio.length, i + frameSamples);
        let sumSq = 0;
        for (let j = i; j < end; j += 1) sumSq += audio[j] * audio[j];
        const rms = Math.sqrt(sumSq / Math.max(1, end - i));
        voiced.push(rms >= silenceRms);
    }

    /** @type {{ startF: number, endF: number }[]} */
    const raw = [];
    let i = 0;
    while (i < voiced.length) {
        while (i < voiced.length && !voiced[i]) i += 1;
        if (i >= voiced.length) break;
        const startF = i;
        let endF = i;
        let silentRun = 0;
        while (i < voiced.length) {
            if (voiced[i]) {
                silentRun = 0;
                endF = i;
                i += 1;
            } else {
                silentRun += 1;
                i += 1;
                if (silentRun >= gapFrames) break;
            }
        }
        if (endF - startF + 1 >= minSpeechFrames) {
            raw.push({ startF, endF: endF + 1 });
        }
    }

    if (!raw.length) {
        return [{ samples: audio, startSec: 0, endSec: audio.length / TARGET_RATE }];
    }

    /** @type {{ samples: Float32Array, startSec: number, endSec: number }[]} */
    const out = [];
    for (const seg of raw) {
        let a = Math.max(0, seg.startF * frameSamples - padSamples);
        let b = Math.min(audio.length, seg.endF * frameSamples + padSamples);
        while (b - a > maxSpeechSamples) {
            const mid = a + maxSpeechSamples;
            out.push({
                samples: audio.subarray(a, mid),
                startSec: a / TARGET_RATE,
                endSec: mid / TARGET_RATE,
            });
            a = mid;
        }
        if (b - a >= Math.round(0.25 * TARGET_RATE)) {
            out.push({
                samples: audio.subarray(a, b),
                startSec: a / TARGET_RATE,
                endSec: b / TARGET_RATE,
            });
        }
    }
    return out.length ? out : [{ samples: audio, startSec: 0, endSec: audio.length / TARGET_RATE }];
}

/**
 * Fenêtres fixes pour audio très long (mémoire), avec léger chevauchement.
 * @param {Float32Array} audio
 */
function splitFixedWindows(audio) {
    const win = Math.round(WINDOW_SEC * TARGET_RATE);
    const step = Math.round((WINDOW_SEC - WINDOW_OVERLAP_SEC) * TARGET_RATE);
    /** @type {{ samples: Float32Array, startSec: number, endSec: number }[]} */
    const out = [];
    for (let a = 0; a < audio.length; a += step) {
        const b = Math.min(audio.length, a + win);
        if (b - a < Math.round(0.4 * TARGET_RATE)) break;
        out.push({
            samples: audio.subarray(a, b),
            startSec: a / TARGET_RATE,
            endSec: b / TARGET_RATE,
        });
        if (b >= audio.length) break;
    }
    return out.length ? out : [{ samples: audio, startSec: 0, endSec: audio.length / TARGET_RATE }];
}

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
 * Corrections FR métier typiques Whisper sur cold calls.
 * Appliqué sur le texte **final** (pas chunk par chunk) pour coller les mots coupés.
 * @param {string} raw
 */
export function polishFrenchCallTranscript(raw) {
    let t = String(raw || "");
    if (!t.trim()) return "";

    // —— RDV mal entendu : dévou / dvou / Dévou / DV / Dvou / en dévou…
    t = t.replace(/\bm[eè]t+r(?:e|ai|ais|ez|ai)?\s+en\s+d[eéèê]?\s*[vV](?:ou|oue|oux|ou)?\b/gi, "mettre un rendez-vous");
    t = t.replace(/\bm[eè]ttr(?:ai|ais|ez|e)\s+en\s+d[eéèê]?\s*[vV](?:ou|oue)?\b/gi, "mettrai un rendez-vous");
    t = t.replace(/\bje\s+vais\s+mettre\s+en\s+d[eéèê]?\s*[vV]\w*\b/gi, "je vais mettre un rendez-vous");
    t = t.replace(/\bmettre\s+en\s+d[eéèê]?\s*[vV]\w*\b/gi, "mettre un rendez-vous");
    t = t.replace(/\bmettrai\s+en\s+d[eéèê]?\s*[vV]\w*\b/gi, "mettrai un rendez-vous");
    t = t.replace(/\bm[eè]terai\s+en\s+d[eéèê]?\s*[vV]\w*\b/gi, "mettrai un rendez-vous");
    t = t.replace(/\ben\s+d[eéèê]?vou[exs]?\b/gi, "un rendez-vous");
    t = t.replace(/\ben\s+dvou\b/gi, "un rendez-vous");
    t = t.replace(/\ben\s+DV(?:ou)?\b/g, "un rendez-vous");
    t = t.replace(/\bun\s+d[eéèê]?vou\b/gi, "un rendez-vous");
    t = t.replace(/\bd[eéèê]?vou\b/gi, "rendez-vous");
    t = t.replace(/\bmettre\s+en\s+RDV\b/gi, "mettre un rendez-vous");
    t = t.replace(/\bmettrai\s+en\s+RDV\b/gi, "mettrai un rendez-vous");
    t = t.replace(/\bmettre\s+un\s+RDV\b/gi, "mettre un rendez-vous");
    t = t.replace(/\bmettrai\s+un\s+RDV\b/gi, "mettrai un rendez-vous");
    // « de mettre en dévou » / fragment mid-phrase
    t = t.replace(/\bde\s+mettre\s+en\s+(?:d[eéèê]?\s*[vV]\w*|RDV|DV)\b/gi, "de mettre un rendez-vous");
    t = t.replace(/\bmettre\s+en\s+Dévou\b/gi, "mettre un rendez-vous");

    // —— Dates / jours (ex. « vendre une petite prochaine »)
    t = t.replace(/\bvendre\s+(?:une\s+)?petite\s+prochaine\b/gi, "vendredi de la semaine prochaine");
    t = t.replace(/\bvendre\s+(?:de\s+la\s+)?semaine\s+prochaine\b/gi, "vendredi de la semaine prochaine");
    t = t.replace(/\bvendre\s+une\s+prochaine\b/gi, "vendredi prochain");
    t = t.replace(/\bpetite\s+prochaine\b/gi, "semaine prochaine");
    t = t.replace(/\bvendre\s+prochain\b/gi, "vendredi prochain");
    t = t.replace(/\bvendre\s+di\b/gi, "vendredi");

    // —— Heures orales
    t = t.replace(/\b(\d{1,2})\s*h\s*(\d{2})\b/gi, "$1h$2");
    t = t.replace(/\bà\s+(\d{1,2})\s+heures?\s+(\d{1,2})\b/gi, "à $1h$2");

    // —— Orthographe orale fréquente
    t = t.replace(/\bc['’]étais\b/gi, "c'était");
    t = t.replace(/\bc['’]etais\b/gi, "c'était");
    t = t.replace(/\bje\s+m[eè]terai\b/gi, "je mettrai");
    t = t.replace(/\bsur\s+le\s+paix\b/gi, "s'il vous plaît");
    t = t.replace(/\bsur\s+le\s+pass\b/gi, "s'il vous plaît");
    t = t.replace(/\bsur\s+le\s+pla[iî]t\b/gi, "s'il vous plaît");
    t = t.replace(/\bpertinent\s+de\s+mettre\b/gi, "pertinent de mettre");

    return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * Polish en préservant les lignes Speaker N.
 * @param {string} text
 */
export function polishDiarizedTranscript(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const blocks = raw.split(/\n\n+/).map((piece) => {
        const m = piece.match(SPEAKER_LINE_RE);
        if (m) {
            const body = polishFrenchCallTranscript(piece.replace(SPEAKER_LINE_RE, ""));
            return body ? `Speaker ${m[1]}: ${body}` : "";
        }
        return polishFrenchCallTranscript(piece);
    }).filter(Boolean);
    return finalizeSpeakerTranscript(blocks.join("\n\n"));
}

/**
 * Nettoie les artefacts Whisper (répétitions, « bruit de pause », bla-bla…).
 * @param {string} raw
 * @param {{ polish?: boolean }} [opts] — polish=false pour chunks (polish final ensuite)
 * @returns {string}
 */
export function sanitizeWhisperTranscript(raw, opts = {}) {
    const doPolish = opts.polish !== false;
    let text = String(raw || "").replace(/\u00a0/g, " ").trim();
    if (!text) return "";

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

    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const kept = [];
    for (const line of lines) {
        if (HALLUCINATION_FULL_RE.test(line)) continue;
        if (/^[\s.…,;:!?\-–—'"«»]+$/.test(line)) continue;
        kept.push(line);
    }
    text = kept.join("\n").trim();
    if (!text) return "";

    text = text.replace(HALLUCINATION_INLINE_RE, " ").replace(/\s{2,}/g, " ").trim();

    text = text.replace(
        /\b([\wÀ-ÿ][\wÀ-ÿ''-]{0,30})\b(?:\s+\1\b){3,}/gi,
        "$1"
    );

    text = text.replace(
        /\b((?:[\wÀ-ÿ][\wÀ-ÿ''-]{0,24}\s+){1,5}[\wÀ-ÿ][\wÀ-ÿ''-]{0,24})\b(?:\s+\1\b){2,}/gi,
        "$1"
    );

    text = text.replace(/\bbla(?:\s*bla)+\b/gi, "");
    text = text.replace(/\b(?:bla){3,}\b/gi, "");
    text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return "";

    if (HALLUCINATION_FULL_RE.test(text)) return "";

    if (doPolish) text = polishFrenchCallTranscript(text);
    return text.trim();
}

/**
 * Décode un Blob audio → Float32Array mono 16 kHz (format Whisper).
 */
export async function decodeAudioToMono16k(blob) {
    if (!blob) throw new Error("Audio manquant");
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext indisponible");

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
        return await resampleOffline(mono, decoded.sampleRate, TARGET_RATE);
    } catch (primaryErr) {
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

async function resampleOffline(mono, fromRate, toRate) {
    if (!mono?.length) return mono;
    if (Math.abs(fromRate - toRate) < 1) return mono;

    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) {
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
    if (pipelinePromise && loadedModelId !== MODEL_ID) {
        await releasePipeline();
    }
    if (!pipelinePromise) {
        loadedModelId = MODEL_ID;
        pipelinePromise = (async () => {
            const { pipeline, env } = await import("@xenova/transformers");
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            try {
                if (env.backends?.onnx?.wasm) {
                    env.backends.onnx.wasm.numThreads = decideEngineConfig().numThreads;
                }
            } catch {
                /* ignore */
            }

            report(onProgress, {
                status: "loading",
                message: "Téléchargement du modèle (1re fois, ~240 Mo)…",
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
            loadedModelId = null;
            throw err;
        });
    }
    return pipelinePromise;
}

async function releasePipeline() {
    const p = pipelinePromise;
    pipelinePromise = null;
    loadedModelId = null;
    if (!p) return;
    try {
        const transcriber = await p;
        await transcriber?.dispose?.();
    } catch { /* ignore */ }
}

registerReleaseCallback(() => {
    void releasePipeline();
});

export function warmupWhisper(onProgress) {
    if (!isTranscribeSupported()) return Promise.resolve(null);
    // Préfère le natif : juste un probe de statut (pas de DL WASM)
    return isNativeWhisperReady()
        .then((ok) => {
            if (ok) {
                report(onProgress, {
                    status: "done",
                    message: "whisper.cpp Metal prêt",
                    progress: 100,
                });
                return "native";
            }
            return getTranscriber(onProgress);
        })
        .catch(() => getTranscriber(onProgress).catch(() => null));
}

function buildPrompt(prevTail) {
    const base = FR_CALL_PROMPT;
    const tail = String(prevTail || "").replace(SPEAKER_LINE_RE, "").trim();
    if (!tail) return base;
    const clipped = tail.slice(-180).replace(/\s+/g, " ").trim();
    return `${base} Suite : ${clipped}`;
}

/**
 * Passe whisper.cpp natif (Metal) si CLI + modèle SSD présents.
 * @returns {Promise<string|null>} null = fallback WASM
 */
async function runNativePass(audio, { onProgress, startSpeaker = 1 } = {}) {
    try {
        if (!(await isNativeWhisperReady())) return null;
        report(onProgress, {
            status: "transcribing",
            message: "Transcription embarquée (large-v3)…",
            progress: 8,
        });
        const started = performance.now();
        const native = await transcribeNativeMono16k(audio, { language: "fr" });
        if (!native) return null;
        recordPerfSample(audio.length / TARGET_RATE, performance.now() - started);

        if (Array.isArray(native.chunks) && native.chunks.length >= 2) {
            const { text } = diarizeWhisperResult(
                { text: native.text, chunks: native.chunks },
                {
                    startSpeaker,
                    sanitize: (s) => sanitizeWhisperTranscript(s, { polish: false }),
                    gapSec: 0.85,
                }
            );
            return polishDiarizedTranscript(text);
        }

        const plain = sanitizeWhisperTranscript(String(native.text || ""), { polish: true });
        return plain
            ? polishDiarizedTranscript(`Speaker ${Math.max(1, Number(startSpeaker) || 1)}: ${plain}`)
            : "";
    } catch (err) {
        console.warn("[transcribe] whisper.cpp natif indisponible, fallback WASM:", err);
        return null;
    }
}

/**
 * @param {Float32Array} audio
 * @param {{ onProgress?: Function, withTimestamps?: boolean, startSpeaker?: number, promptExtra?: string }} [opts]
 */
async function runWhisperPass(audio, {
    onProgress,
    withTimestamps = true,
    startSpeaker = 1,
    promptExtra = "",
} = {}) {
    if (!audio?.length) return "";
    if (isMostlySilent(audio)) return "";

    const nativeText = await runNativePass(audio, { onProgress, startSpeaker });
    if (nativeText != null) return nativeText;

    return runExclusive(async () => {
        const transcriber = await getTranscriber(onProgress);
        await yieldToUi(16);

        const started = performance.now();
        const result = await transcriber(audio, {
            language: "french",
            task: "transcribe",
            ...getDecodeParams(),
            return_timestamps: withTimestamps,
            // @ts-ignore — supporté par generate Whisper
            initial_prompt: buildPrompt(promptExtra),
            temperature: 0,
            no_repeat_ngram_size: 3,
            compression_ratio_threshold: 2.4,
            logprob_threshold: -0.8,
            no_speech_threshold: 0.55,
            // Continuité lexicale sur les sous-fenêtres internes Whisper (22 s)
            condition_on_previous_text: true,
        });
        recordPerfSample(audio.length / TARGET_RATE, performance.now() - started);

        if (withTimestamps) {
            const { text } = diarizeWhisperResult(result, {
                startSpeaker,
                // Pas de polish chunk-par-chunk (casse « mettre en » + « DV »)
                sanitize: (s) => sanitizeWhisperTranscript(s, { polish: false }),
                gapSec: 0.85,
            });
            return polishDiarizedTranscript(text);
        }

        const plain = sanitizeWhisperTranscript(String(result?.text || ""), { polish: true });
        return plain
            ? polishDiarizedTranscript(`Speaker ${Math.max(1, Number(startSpeaker) || 1)}: ${plain}`)
            : "";
    });
}

/**
 * @param {Float32Array} audio mono 16 kHz
 * @param {{ onProgress?: (p: object) => void, startSpeaker?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function transcribeMono16k(audio, { onProgress, startSpeaker = 1 } = {}) {
    if (!audio?.length) return "";

    if (isMostlySilent(audio)) {
        report(onProgress, {
            status: "done",
            message: "Silence — pas de transcription",
            progress: 100,
        });
        return "";
    }

    const durationSec = audio.length / TARGET_RATE;
    const speaker0 = Math.max(1, Math.min(2, Number(startSpeaker) || 1));

    // Cas normal (cold call ~30–90 s) : UNE passe continue — qualité max.
    if (durationSec <= SINGLE_PASS_MAX_SEC) {
        report(onProgress, {
            status: "transcribing",
            message: "Transcription en cours…",
            progress: 2,
        });
        await yieldToUi(20);
        const text = await runWhisperPass(audio, {
            onProgress,
            withTimestamps: true,
            startSpeaker: speaker0,
        });
        report(onProgress, { status: "done", message: "Terminé", progress: 100 });
        return text || "";
    }

    // Très long : fenêtres larges + prompt de suite (pas de flip Speaker sur micro-silence).
    const windows = splitFixedWindows(audio);
    const n = windows.length;
    let speaker = speaker0;
    const parts = [];
    let prevTail = "";

    report(onProgress, {
        status: "transcribing",
        message: `Transcription 1/${n}…`,
        progress: 2,
    });
    await yieldToUi(20);

    for (let i = 0; i < n; i += 1) {
        const base = Math.round((i / n) * 100);
        const mid = Math.round(((i + 0.55) / n) * 100);
        report(onProgress, {
            status: "transcribing",
            message: `Transcription ${i + 1}/${n}…`,
            progress: Math.max(2, Math.min(96, base)),
        });

        let softTimer = null;
        if (typeof window !== "undefined") {
            softTimer = window.setTimeout(() => {
                report(onProgress, {
                    status: "transcribing",
                    message: `Transcription ${i + 1}/${n}…`,
                    progress: Math.max(2, Math.min(96, mid)),
                });
            }, 450);
        }

        try {
            const piece = await runWhisperPass(windows[i].samples, {
                onProgress: i === 0 ? onProgress : undefined,
                withTimestamps: true,
                startSpeaker: speaker,
                promptExtra: prevTail,
            });
            if (piece) {
                parts.push(piece);
                speaker = lastSpeakerFromTranscript(piece) || speaker;
                prevTail = piece.replace(SPEAKER_LINE_RE, "").slice(-200);
            }
        } finally {
            if (softTimer) window.clearTimeout(softTimer);
        }

        report(onProgress, {
            status: "transcribing",
            message: `Transcription ${Math.min(i + 2, n)}/${n}…`,
            progress: Math.round(((i + 1) / n) * 100),
        });
        await yieldToUi(40);
    }

    const text = polishDiarizedTranscript(parts.filter(Boolean).join("\n\n").trim());
    report(onProgress, { status: "done", message: "Terminé", progress: 100 });
    return text;
}

/**
 * @param {Blob} blob
 * @param {{ onProgress?: (p: object) => void, startSpeaker?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function transcribeAudioBlob(blob, { onProgress, startSpeaker = 1 } = {}) {
    report(onProgress, { status: "decoding", message: "Lecture de l'audio…", progress: 1 });
    await yieldToUi(16);
    const audio = await decodeAudioToMono16k(blob);
    if (!audio?.length) throw new Error("Audio vide");
    report(onProgress, { status: "decoding", message: "Audio prêt…", progress: 4 });
    await yieldToUi(16);
    return transcribeMono16k(audio, { onProgress, startSpeaker });
}

export function isTranscribeSupported() {
    return typeof window !== "undefined"
        && !!(window.AudioContext || window.webkitAudioContext);
}
