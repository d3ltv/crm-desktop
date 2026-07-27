/**
 * Capture micro avec chaîne type « voix / appel » :
 * high-pass → présence légère → pré-gain → double compresseur → makeup → limiter.
 * Réglages modérés pour éviter la saturation.
 */

import { pickAudioMimeType } from "@/lib/callRecordings";

export const CAPTURE_BITRATE = 160_000;

/**
 * Ouvre le micro et renvoie un MediaStream déjà traité.
 * @returns {Promise<{
 *   stream: MediaStream,
 *   rawStream: MediaStream,
 *   cleanup: () => void,
 * }>}
 */
export async function openProcessedMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia unavailable");
    }

    const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
        },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        return {
            stream: rawStream,
            rawStream,
            cleanup: () => {
                rawStream.getTracks().forEach((t) => t.stop());
            },
        };
    }

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
    }

    const source = ctx.createMediaStreamSource(rawStream);

    // Coupe les basses parasites
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 90;
    highpass.Q.value = 0.7;

    // Présence vocale douce
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2800;
    presence.Q.value = 1.0;
    presence.gain.value = 0.8;

    // Pré-gain léger
    const preGain = ctx.createGain();
    preGain.gain.value = 1.1;

    // Leveling doux
    const leveler = ctx.createDynamicsCompressor();
    leveler.threshold.value = -28;
    leveler.knee.value = 20;
    leveler.ratio.value = 2.5;
    leveler.attack.value = 0.015;
    leveler.release.value = 0.3;

    // Compression voix modérée
    const voiceComp = ctx.createDynamicsCompressor();
    voiceComp.threshold.value = -18;
    voiceComp.knee.value = 12;
    voiceComp.ratio.value = 4;
    voiceComp.attack.value = 0.004;
    voiceComp.release.value = 0.15;

    // Makeup après compression — modéré pour limiter la sat (ASR + écoute)
    const makeup = ctx.createGain();
    makeup.gain.value = 1.2;

    // Limiter plus tôt (headroom)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    // Ceiling final — marge avant 0 dBFS
    const ceiling = ctx.createGain();
    ceiling.gain.value = 0.9;

    const dest = ctx.createMediaStreamDestination();

    source
        .connect(highpass)
        .connect(presence)
        .connect(preGain)
        .connect(leveler)
        .connect(voiceComp)
        .connect(makeup)
        .connect(limiter)
        .connect(ceiling)
        .connect(dest);

    const nodes = [source, highpass, presence, preGain, leveler, voiceComp, makeup, limiter, ceiling];

    const cleanup = () => {
        for (const n of nodes) {
            try { n.disconnect(); } catch { /* already disconnected */ }
        }
        rawStream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
    };

    return {
        stream: dest.stream,
        rawStream,
        cleanup,
    };
}

/**
 * Crée un MediaRecorder sur un stream traité, bitrate plus élevé si supporté.
 * @param {MediaStream} stream
 * @param {{ mimeType?: string }} [opts]
 */
export function createCallRecorder(stream, opts = {}) {
    const mimeType = opts.mimeType || pickAudioMimeType();
    const base = mimeType ? { mimeType } : {};
    try {
        return new MediaRecorder(stream, {
            ...base,
            audioBitsPerSecond: CAPTURE_BITRATE,
        });
    } catch {
        try {
            return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        } catch {
            return new MediaRecorder(stream);
        }
    }
}
