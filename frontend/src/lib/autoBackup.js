/**
 * autoBackup.js — Sauvegardes automatiques
 * - Navigateur : IndexedDB
 * - Relia (Tauri) : déjà couvert par crm_state_v1.json + backups/ sur disque → no-op IDB
 */

import { isTauri, diskSaveState } from "@/lib/diskStorage";

const DB_NAME    = "crm_backups";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let _db = null;

function openDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "ts" });
            }
        };
        req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror    = (e) => reject(e.target.error);
    });
}

function promisify(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
}

export async function saveBackup(state) {
    try {
        const { lastDeleted: _ld, ...persistent } = state;
        const serialized = JSON.stringify(persistent);

        // Desktop : forcer un flush disque (fichier principal déjà géré ailleurs,
        // mais on sécurise ici aussi en cas d'appel direct).
        if (isTauri()) {
            await diskSaveState(serialized);
            console.debug(`[Relia Backup] Flush disque — ${(serialized.length / 1024).toFixed(0)} KB`);
            return;
        }

        const db = await openDb();
        const ts = Date.now();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        await promisify(store.put({ ts, data: serialized, size: serialized.length }));
        const allKeys = await promisify(store.getAllKeys());
        allKeys.sort((a, b) => a - b);
        const toDelete = allKeys.slice(0, Math.max(0, allKeys.length - MAX_BACKUPS));
        for (const key of toDelete) {
            store.delete(key);
        }
        console.debug(
            `[Backup] Snapshot IndexedDB — ${(serialized.length / 1024).toFixed(0)} KB`
        );
    } catch (err) {
        console.warn("[Backup] Échec silencieux :", err);
    }
}

/**
 * Récupère tous les snapshots disponibles, du plus récent au plus ancien.
 * @returns {Promise<Array<{ ts: number, size: number, data: string }>>}
 */
export async function getAllBackups() {
    try {
        if (isTauri()) {
            const { diskLoadState, diskLoadBackup } = await import("@/lib/diskStorage");
            const out = [];
            const main = await diskLoadState();
            if (main) out.push({ ts: Date.now(), size: main.length, data: main });
            const bak = await diskLoadBackup();
            if (bak) out.push({ ts: Date.now() - 1, size: bak.length, data: bak });
            return out;
        }
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const all = await promisify(store.getAll());
        return all.sort((a, b) => b.ts - a.ts);
    } catch {
        return [];
    }
}

/**
 * Récupère uniquement le backup le plus récent.
 * @returns {Promise<{ ts: number, size: number, data: string } | null>}
 */
export async function getLatestBackup() {
    const all = await getAllBackups();
    return all[0] || null;
}

/**
 * Parse un snapshot sauvegardé et retourne l'état CRM.
 * @param {{ data: string }} snapshot
 * @returns {object | null}
 */
export function parseBackup(snapshot) {
    try {
        const parsed = JSON.parse(snapshot.data);
        if (!parsed || typeof parsed !== "object" || !parsed.workspaces) return null;
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Formate un timestamp en texte lisible.
 * @param {number} ts
 */
export function formatBackupDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);

    if (diffMin < 1)  return "il y a moins d'une minute";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffH < 24)   return `il y a ${diffH}h`;

    return d.toLocaleDateString("fr-FR", {
        day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
    });
}

// ── Timer interne — démarré une seule fois ───────────────────────────────────
let _timer = null;
let _getState = null; // fonction qui retourne l'état courant

/**
 * Démarre le backup automatique en arrière-plan.
 * @param {() => object} getStateFn — callback qui retourne l'état CRM courant
 */
export function startAutoBackup(getStateFn) {
    if (_timer) return; // déjà démarré
    _getState = getStateFn;

    // Premier backup immédiat (au démarrage de l'app, après le chargement)
    setTimeout(() => {
        const s = _getState?.();
        if (s && Object.keys(s.workspaces || {}).length > 0) saveBackup(s);
    }, 10_000); // 10s après le démarrage — laisse l'app s'initialiser

    _timer = setInterval(() => {
        const s = _getState?.();
        if (s && Object.keys(s.workspaces || {}).length > 0) {
            saveBackup(s);
        }
    }, BACKUP_INTERVAL_MS);
}

/** Arrête le backup automatique (cleanup à l'unmount). */
export function stopAutoBackup() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    _getState = null;
}
