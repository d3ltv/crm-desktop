/**
 * whisperGovernor.js — Gouverneur de ressources Whisper (organe « souffle »).
 *
 * Décide quand Whisper peut consommer (threads, préchauffage) et quand il doit
 * se reposer (libération RAM après inactivité). 100 % local, zéro télémétrie.
 *
 * Réalités mesurées (et non supposées) :
 * - Sous Tauri/WKWebView, `crossOriginIsolated` est faux → multi-thread WASM
 *   indisponible ET connu pour faire exploser la RAM sur macOS/iOS. On ne force
 *   jamais plusieurs threads sans SharedArrayBuffer réel.
 * - `navigator.deviceMemory` / `performance.memory` = Chrome-only. On ne s'y fie
 *   pas : on mesure la vitesse réelle (facteur temps-réel) et on s'adapte.
 * - Le pipeline transformers.js garde de gros buffers : `dispose()` après repos
 *   est le vrai levier RAM, pas un réglage magique.
 */

const IDLE_RELEASE_MS = 5 * 60 * 1000;
/** Sous ce facteur temps-réel (durée audio / durée calcul), la machine peine. */
const SLOW_RTF = 0.9;
const PERF_SAMPLES_MAX = 8;

const state = {
    /** Références actives qui interdisent la mise au repos (ex. session vocale). */
    holds: new Set(),
    /** File d'inférence : une seule à la fois (les décodes parallèles doublent la RAM). */
    queueTail: Promise.resolve(),
    queueDepth: 0,
    lastJobEndedAt: 0,
    idleTimer: null,
    /** Callback fourni par transcribeLocal pour libérer le pipeline. */
    releaseCallback: null,
    /** Facteurs temps-réel observés (adaptation locale, pas de deviceMemory). */
    rtfSamples: [],
    engineDecided: null,
};

/**
 * Threads WASM — décidé UNE fois, avant la création du pipeline (après, sans effet).
 * Multi-thread seulement si SharedArrayBuffer est réellement disponible.
 */
export function decideEngineConfig() {
    if (state.engineDecided) return state.engineDecided;
    const cores = Math.max(1, navigator?.hardwareConcurrency || 1);
    const isolated = typeof self !== "undefined" && self.crossOriginIsolated === true;
    // deviceMemory : simple indice quand présent (Chrome), jamais bloquant.
    const memHint = navigator?.deviceMemory;
    const roomy = memHint == null || memHint >= 8;

    const numThreads = isolated && cores >= 8 && roomy
        ? Math.min(4, Math.floor(cores / 2))
        : 1;

    state.engineDecided = { numThreads, cores, isolated };
    return state.engineDecided;
}

/** Params de décodage adaptés à la vitesse réellement observée. */
export function getDecodeParams() {
    const slow = medianRtf() != null && medianRtf() < SLOW_RTF;
    return slow
        // Chunks plus courts = pics mémoire plus bas (surtout whisper-small)
        ? { chunk_length_s: 16, stride_length_s: 3 }
        : { chunk_length_s: 22, stride_length_s: 4 };
}

function medianRtf() {
    const s = state.rtfSamples;
    if (s.length < 2) return null;
    const sorted = [...s].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Enregistre une mesure de perf (durée audio vs durée de calcul). */
export function recordPerfSample(audioSec, wallMs) {
    if (!(audioSec > 0) || !(wallMs > 0)) return;
    state.rtfSamples.push(audioSec / (wallMs / 1000));
    if (state.rtfSamples.length > PERF_SAMPLES_MAX) state.rtfSamples.shift();
}

/**
 * Sérialise les inférences. `label` sert uniquement au debug.
 * @template T
 * @param {() => Promise<T>} job
 * @returns {Promise<T>}
 */
export function runExclusive(job) {
    state.queueDepth += 1;
    cancelIdleTimer();
    const run = state.queueTail.then(job);
    // La file avance même si un job échoue
    state.queueTail = run.catch(() => {}).then(() => {
        state.queueDepth -= 1;
        state.lastJobEndedAt = Date.now();
        if (state.queueDepth <= 0) scheduleIdleRelease();
    });
    return run;
}

/** Empêche la mise au repos tant que la référence est tenue (session vocale…). */
export function holdAlive(ref) {
    state.holds.add(ref);
    cancelIdleTimer();
}

export function releaseHold(ref) {
    state.holds.delete(ref);
    if (state.queueDepth <= 0) scheduleIdleRelease();
}

/** transcribeLocal enregistre ici comment libérer son pipeline. */
export function registerReleaseCallback(cb) {
    state.releaseCallback = typeof cb === "function" ? cb : null;
}

function cancelIdleTimer() {
    if (state.idleTimer) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
    }
}

function scheduleIdleRelease() {
    cancelIdleTimer();
    if (!state.releaseCallback) return;
    state.idleTimer = setTimeout(() => {
        state.idleTimer = null;
        if (state.holds.size > 0 || state.queueDepth > 0) return;
        try {
            state.releaseCallback?.();
        } catch { /* ignore */ }
    }, IDLE_RELEASE_MS);
}

/** Libération immédiate (ex. avertissement mémoire, import massif). */
export function releaseNow() {
    cancelIdleTimer();
    if (state.queueDepth > 0) return false;
    try {
        state.releaseCallback?.();
        return true;
    } catch {
        return false;
    }
}

/** État lisible (debug / cerveau). */
export function getGovernorStatus() {
    return {
        queueDepth: state.queueDepth,
        holds: state.holds.size,
        engine: state.engineDecided,
        medianRtf: medianRtf(),
        lastJobEndedAt: state.lastJobEndedAt || null,
    };
}
