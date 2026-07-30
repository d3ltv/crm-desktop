/**
 * Bridge Relia ↔ whisper.cpp natif (Metal) via Tauri.
 * Build « Rellia » large-v3 : binaire + modèle embarqués dans Resources.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/diskStorage";

/** @type {null | { available: boolean, detail?: string, modelPath?: string, cliPath?: string }} */
let cachedStatus = null;
let statusAt = 0;

export function float32ToBase64(audio) {
    if (!audio?.length) return "";
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export async function getNativeWhisperStatus(force = false) {
    if (!isTauri()) {
        return { available: false, engine: "none", detail: "Hors Tauri" };
    }
    const now = Date.now();
    if (!force && cachedStatus && now - statusAt < 15_000) return cachedStatus;
    try {
        const s = await invoke("crm_whisper_status");
        cachedStatus = s;
        statusAt = now;
        return s;
    } catch (err) {
        cachedStatus = { available: false, engine: "whisper.cpp", detail: String(err) };
        statusAt = now;
        return cachedStatus;
    }
}

export async function isNativeWhisperReady() {
    const s = await getNativeWhisperStatus();
    return Boolean(s?.available);
}

/**
 * @param {Float32Array} audio mono 16 kHz
 * @param {{ language?: string }} [opts]
 * @returns {Promise<{ text: string, chunks: { text: string, timestamp: [number, number] }[], engine: string }|null>}
 */
export async function transcribeNativeMono16k(audio, opts = {}) {
    if (!isTauri() || !audio?.length) return null;
    const ready = await isNativeWhisperReady();
    if (!ready) return null;

    const pcmBase64 = float32ToBase64(audio);
    const result = await invoke("crm_whisper_transcribe", {
        pcmBase64,
        sampleRate: 16000,
        language: opts.language || "fr",
    });

    const segments = Array.isArray(result?.segments) ? result.segments : [];
    const chunks = segments.map((s) => ({
        text: String(s.text || ""),
        timestamp: [Number(s.start) || 0, Number(s.end) || 0],
    }));

    return {
        text: String(result?.text || ""),
        chunks,
        engine: String(result?.engine || "whisper.cpp"),
        modelPath: result?.modelPath || null,
    };
}
