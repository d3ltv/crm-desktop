/**
 * Séparation Speaker 1 / Speaker 2 à partir des chunks Whisper (timestamps).
 * Heuristique locale : une **vraie** pause (≥ ~0.85 s) ≈ changement de locuteur.
 * Les micro-pauses de réflexion ne doivent PAS inventer un 2ᵉ tour.
 */

/** Ligne « Speaker N: … » (export + affichage). */
export const SPEAKER_LINE_RE = /^\s*Speaker\s*(\d+)\s*:\s*/i;

/**
 * Retire les préfixes Speaker / Interlocuteur — pour parseNote / infos pertinentes.
 */
export function stripSpeakerLabels(text) {
    return String(text || "")
        .replace(/^\s*Speaker\s*\d+\s*:\s*/gim, "")
        .replace(/^\s*Interlocuteur\s*\d+\s*:\s*/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Dernier numéro de speaker dans un texte déjà diarisé. */
export function lastSpeakerFromTranscript(text) {
    let last = 0;
    const re = /^\s*Speaker\s*(\d+)\s*:/gim;
    let m;
    while ((m = re.exec(String(text || ""))) !== null) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) last = n;
    }
    return last >= 1 ? last : 1;
}

/**
 * Fusionne les blocs Speaker N consécutifs du même N.
 * Si un seul locuteur dans tout le texte → un seul bloc fluide
 * (évite les coupures mid-phrase type « Speaker 1 — de mettre… »).
 * @param {string} text
 */
export function finalizeSpeakerTranscript(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";

    /** @type {{ speaker: number|null, body: string }[]} */
    const blocks = [];
    const pieces = raw.split(/\n\n+/);
    for (const piece of pieces) {
        const m = piece.match(SPEAKER_LINE_RE);
        if (m) {
            blocks.push({
                speaker: Number(m[1]) || 1,
                body: piece.replace(SPEAKER_LINE_RE, "").trim(),
            });
        } else if (piece.trim()) {
            blocks.push({ speaker: null, body: piece.trim() });
        }
    }
    if (!blocks.length) return raw;

    /** @type {{ speaker: number|null, body: string }[]} */
    const merged = [];
    for (const b of blocks) {
        if (!b.body) continue;
        const prev = merged[merged.length - 1];
        if (prev && prev.speaker != null && prev.speaker === b.speaker) {
            prev.body = `${prev.body} ${b.body}`.replace(/\s{2,}/g, " ").trim();
        } else {
            merged.push({ ...b });
        }
    }

    const speakers = new Set(
        merged.map((b) => b.speaker).filter((s) => s === 1 || s === 2)
    );

    if (speakers.size <= 1) {
        const body = merged.map((b) => b.body).join(" ").replace(/\s{2,}/g, " ").trim();
        const sp = speakers.size === 1 ? [...speakers][0] : 1;
        return body ? `Speaker ${sp}: ${body}` : "";
    }

    return merged
        .map((b) => (b.speaker != null ? `Speaker ${b.speaker}: ${b.body}` : b.body))
        .join("\n\n")
        .trim();
}

/**
 * @param {{ text?: string, timestamp?: [number|null, number|null] }[]} chunks
 * @param {{ startSpeaker?: number, gapSec?: number, sanitize?: (s: string) => string }} [opts]
 * @returns {{ text: string, lastSpeaker: number }}
 */
export function formatChunksWithSpeakers(chunks, opts = {}) {
    const gapSec = opts.gapSec ?? 0.85;
    const sanitize = opts.sanitize || ((s) => String(s || "").trim());
    let speaker = Math.max(1, Math.min(2, Number(opts.startSpeaker) || 1));
    /** @type {{ speaker: number, parts: string[] }[]} */
    const turns = [];
    let current = { speaker, parts: [] };
    let lastEnd = null;

    const list = Array.isArray(chunks) ? chunks : [];
    for (const chunk of list) {
        const raw = sanitize(chunk?.text || "");
        if (!raw) continue;
        const ts = chunk?.timestamp;
        const start = Array.isArray(ts) && Number.isFinite(ts[0]) ? ts[0] : null;
        const end = Array.isArray(ts) && Number.isFinite(ts[1]) ? ts[1] : null;

        if (
            lastEnd != null
            && start != null
            && start - lastEnd >= gapSec
            && current.parts.length > 0
        ) {
            turns.push(current);
            speaker = speaker === 1 ? 2 : 1;
            current = { speaker, parts: [] };
        }

        current.parts.push(raw);
        if (end != null) lastEnd = end;
        else if (start != null) lastEnd = start;
    }

    if (current.parts.length) turns.push(current);

    if (!turns.length) {
        return { text: "", lastSpeaker: Math.max(1, Number(opts.startSpeaker) || 1) };
    }

    /** @type {{ speaker: number, parts: string[] }[]} */
    const merged = [];
    for (const t of turns) {
        const prev = merged[merged.length - 1];
        if (prev && prev.speaker === t.speaker) {
            prev.parts.push(...t.parts);
        } else {
            merged.push({ speaker: t.speaker, parts: [...t.parts] });
        }
    }

    const lines = merged.map((t) => {
        const body = t.parts.join(" ").replace(/\s{2,}/g, " ").trim();
        return `Speaker ${t.speaker}: ${body}`;
    });

    const text = finalizeSpeakerTranscript(lines.join("\n\n").trim());
    return {
        text,
        lastSpeaker: lastSpeakerFromTranscript(text),
    };
}

/**
 * @param {{ text?: string, chunks?: object[] }|null} result
 * @param {{ startSpeaker?: number, sanitize?: (s: string) => string, gapSec?: number }} [opts]
 */
export function diarizeWhisperResult(result, opts = {}) {
    const sanitize = opts.sanitize || ((s) => String(s || "").trim());
    const chunks = result?.chunks;
    if (Array.isArray(chunks) && chunks.length >= 2) {
        const { text, lastSpeaker } = formatChunksWithSpeakers(chunks, {
            startSpeaker: opts.startSpeaker,
            sanitize,
            gapSec: opts.gapSec ?? 0.85,
        });
        if (text) {
            return { text, lastSpeaker, diarized: true };
        }
    }

    const flat = sanitize(result?.text || "");
    const text = flat
        ? finalizeSpeakerTranscript(`Speaker ${Math.max(1, Number(opts.startSpeaker) || 1)}: ${flat}`)
        : "";
    return {
        text,
        lastSpeaker: lastSpeakerFromTranscript(text) || 1,
        diarized: false,
    };
}
