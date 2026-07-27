/**
 * callRecordings.js — Enregistrements d'appel
 * Desktop (Tauri) → fichiers disque  |  Navigateur → IndexedDB
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/diskStorage";

const DB_NAME = "crm_call_recordings";
const DB_VERSION = 1;
const STORE_NAME = "recordings";
export const RECORDING_TTL_MS = 90 * 24 * 60 * 60 * 1000;

let _db = null;

function openDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("leadId", "leadId", { unique: false });
                store.createIndex("createdAt", "createdAt", { unique: false });
            }
        };
        req.onsuccess = (e) => {
            _db = e.target.result;
            resolve(_db);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

function promisify(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export function pickAudioMimeType() {
    // Sur WebKit / Tauri macOS, mp4/aac décode souvent mieux que webm timeslice.
    const isWebKit = typeof navigator !== "undefined"
        && /AppleWebKit/i.test(navigator.userAgent)
        && !/Chrome|Chromium|Edg\//i.test(navigator.userAgent);
    const candidates = isWebKit
        ? [
            "audio/mp4",
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
        ]
        : [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/mp4",
            "audio/ogg;codecs=opus",
        ];
    if (typeof MediaRecorder === "undefined") return "";
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

export function extensionForMime(mime = "") {
    if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
}

async function blobToBase64(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBlob(b64, mimeType) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || "audio/webm" });
}

function metaFromRec(rec, createdAt) {
    return {
        id: rec.id,
        leadId: rec.leadId,
        workspaceId: rec.workspaceId,
        mimeType: rec.mimeType || rec.blob?.type || "audio/webm",
        durationMs: rec.durationMs || 0,
        size: rec.size || rec.blob?.size || 0,
        peaks: Array.isArray(rec.peaks) ? rec.peaks : [],
        createdAt: createdAt || rec.createdAt || new Date().toISOString(),
        preserved: !!rec.preserved,
        downloadedAt: rec.downloadedAt || null,
    };
}

/**
 * @param {{
 *   id: string,
 *   leadId: string,
 *   workspaceId: string,
 *   blob: Blob,
 *   mimeType?: string,
 *   durationMs?: number,
 *   peaks?: number[],
 * }} rec
 */
export async function saveCallRecording(rec) {
    const createdAt = new Date().toISOString();
    const entry = {
        id: rec.id,
        leadId: rec.leadId,
        workspaceId: rec.workspaceId,
        blob: rec.blob,
        mimeType: rec.mimeType || rec.blob.type || "audio/webm",
        durationMs: rec.durationMs || 0,
        size: rec.blob.size || 0,
        peaks: Array.isArray(rec.peaks) ? rec.peaks : [],
        createdAt,
        preserved: false,
        downloadedAt: null,
    };

    if (isTauri()) {
        const dataBase64 = await blobToBase64(rec.blob);
        await invoke("crm_save_recording", {
            meta: metaFromRec(entry, createdAt),
            dataBase64,
        });
        return entry;
    }

    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await promisify(tx.objectStore(STORE_NAME).put(entry));
    return entry;
}

export async function getCallRecording(id) {
    if (!id) return null;
    try {
        if (isTauri()) {
            const payload = await invoke("crm_load_recording", { id });
            if (!payload?.meta) return null;
            const m = payload.meta;
            return {
                id: m.id,
                leadId: m.leadId,
                workspaceId: m.workspaceId,
                blob: base64ToBlob(payload.dataBase64, m.mimeType),
                mimeType: m.mimeType,
                durationMs: m.durationMs,
                size: m.size,
                peaks: m.peaks || [],
                createdAt: m.createdAt,
                preserved: m.preserved,
                downloadedAt: m.downloadedAt,
            };
        }
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, "readonly");
        return (await promisify(tx.objectStore(STORE_NAME).get(id))) || null;
    } catch {
        return null;
    }
}

export async function listCallRecordingsForLead(leadId) {
    if (!leadId) return [];
    try {
        if (isTauri()) {
            const list = await invoke("crm_list_recordings", { leadId });
            return (list || []).map((m) => ({
                id: m.id,
                leadId: m.leadId,
                workspaceId: m.workspaceId,
                mimeType: m.mimeType,
                durationMs: m.durationMs,
                size: m.size,
                peaks: m.peaks || [],
                createdAt: m.createdAt,
                preserved: m.preserved,
                downloadedAt: m.downloadedAt,
                blob: null,
            }));
        }
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, "readonly");
        const idx = tx.objectStore(STORE_NAME).index("leadId");
        const all = await promisify(idx.getAll(leadId));
        return (all || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    } catch {
        return [];
    }
}

export async function deleteCallRecording(id) {
    if (!id) return;
    if (isTauri()) {
        await invoke("crm_delete_recording", { id });
        return;
    }
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await promisify(tx.objectStore(STORE_NAME).delete(id));
}

/** Suppressions disque différées — laisse Cmd+Z restaurer la note + l'audio. */
const pendingDeferredDeletes = new Map();

export function cancelDeferredRecordingDelete(id) {
    if (!id) return;
    const t = pendingDeferredDeletes.get(id);
    if (t == null) return;
    window.clearTimeout(t);
    pendingDeferredDeletes.delete(id);
}

export function scheduleDeferredRecordingDelete(id, delayMs = 45_000) {
    if (!id) return;
    cancelDeferredRecordingDelete(id);
    const t = window.setTimeout(() => {
        pendingDeferredDeletes.delete(id);
        deleteCallRecording(id).catch(() => {});
    }, delayMs);
    pendingDeferredDeletes.set(id, t);
}

export async function markRecordingPreserved(id) {
    const rec = await getCallRecording(id);
    if (!rec) return null;
    const updated = {
        ...rec,
        preserved: true,
        downloadedAt: new Date().toISOString(),
    };
    if (isTauri()) {
        await invoke("crm_update_recording_meta", {
            meta: metaFromRec(updated, updated.createdAt),
        });
        return updated;
    }
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await promisify(tx.objectStore(STORE_NAME).put(updated));
    return updated;
}

export async function purgeExpiredCallRecordings() {
    try {
        if (isTauri()) {
            const all = await invoke("crm_list_recordings", { leadId: null });
            const cutoff = Date.now() - RECORDING_TTL_MS;
            let removed = 0;
            for (const rec of all || []) {
                if (rec.preserved) continue;
                const ts = Date.parse(rec.createdAt || "");
                if (!Number.isFinite(ts) || ts >= cutoff) continue;
                await invoke("crm_delete_recording", { id: rec.id });
                removed += 1;
            }
            return removed;
        }
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const all = await promisify(store.getAll());
        const cutoff = Date.now() - RECORDING_TTL_MS;
        let removed = 0;
        for (const rec of all || []) {
            if (rec.preserved) continue;
            const ts = Date.parse(rec.createdAt || "");
            if (!Number.isFinite(ts) || ts >= cutoff) continue;
            store.delete(rec.id);
            removed += 1;
        }
        return removed;
    } catch (err) {
        console.warn("[CallRecordings] purge failed:", err);
        return 0;
    }
}

export async function downloadCallRecording(id, filenameBase = "appel") {
    const rec = await getCallRecording(id);
    if (!rec?.blob) throw new Error("Enregistrement introuvable");

    const ext = extensionForMime(rec.mimeType);
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameBase}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);

    return markRecordingPreserved(id);
}

export function formatDuration(ms = 0) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function daysUntilPurge(rec) {
    if (!rec || rec.preserved) return null;
    const ts = Date.parse(rec.createdAt || "");
    if (!Number.isFinite(ts)) return null;
    const left = RECORDING_TTL_MS - (Date.now() - ts);
    return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}
