/**
 * desktopLocalStorage.js
 * Sur Relia (Tauri) : remplace localStorage par une mémoire sync → fichier disque.
 * Aucune donnée métier ne dépend du localStorage navigateur.
 */

import { invoke } from "@tauri-apps/api/core";

const PREFS_FILE_KEY = "__relia_prefs__";

function isTauri() {
    return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

let mem = Object.create(null);
let persistTimer = null;
let installed = false;

async function flushToDisk() {
    if (!isTauri()) return;
    try {
        await invoke("crm_save_prefs", { payload: JSON.stringify(mem) });
    } catch (err) {
        console.error("[Relia] Écriture prefs disque échouée:", err);
    }
}

function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        flushToDisk();
    }, 400);
}

export async function installDesktopStorage() {
    if (!isTauri() || installed) return;
    installed = true;

    try {
        const raw = await invoke("crm_load_prefs");
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                mem = { ...parsed };
                delete mem[PREFS_FILE_KEY];
                // L'état métier ne doit PAS vivre dans prefs (fichier dédié crm_state_v1.json)
                delete mem.crm_state_v1;
                delete mem.crm_state_v1_backup;
            }
        }
    } catch (err) {
        console.warn("[Relia] Lecture prefs disque:", err);
    }

    const api = {
        getItem(key) {
            if (key == null) return null;
            const v = mem[String(key)];
            return v === undefined ? null : String(v);
        },
        setItem(key, value) {
            mem[String(key)] = String(value);
            schedulePersist();
        },
        removeItem(key) {
            delete mem[String(key)];
            schedulePersist();
        },
        clear() {
            mem = Object.create(null);
            schedulePersist();
        },
        key(index) {
            const keys = Object.keys(mem);
            return keys[index] ?? null;
        },
        get length() {
            return Object.keys(mem).length;
        },
    };

    try {
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            enumerable: true,
            value: api,
        });
    } catch {
        // Fallback si le navigateur bloque la redéfinition
        const proto = window.localStorage;
        ["getItem", "setItem", "removeItem", "clear", "key"].forEach((m) => {
            try {
                proto[m] = api[m].bind(api);
            } catch {}
        });
    }

    window.addEventListener("beforeunload", () => {
        if (persistTimer) {
            clearTimeout(persistTimer);
            persistTimer = null;
        }
        // best-effort sync flush via keepalive not available — fire and forget
        flushToDisk();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushToDisk();
    });

    // Première sync
    await flushToDisk();
    console.info("[Relia] Stockage prefs → disque (pas de localStorage navigateur).");
}

export function flushDesktopStorageNow() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    return flushToDisk();
}
