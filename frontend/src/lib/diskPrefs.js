/**
 * diskPrefs.js — Miroir disque des préférences localStorage (vue, calendrier, notifs lues…).
 * Leads / RDV / dates restent dans crm_state_v1.json.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/diskStorage";

const PREF_PREFIXES = [
    "crm_",
    "sidebar_",
    "column_sort",
    "import_profiles",
];

function shouldPersistKey(key) {
    if (!key) return false;
    return PREF_PREFIXES.some((p) => key.startsWith(p) || key === p);
}

export async function hydratePrefsFromDisk() {
    if (!isTauri()) return;
    try {
        const raw = await invoke("crm_load_prefs");
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (!prefs || typeof prefs !== "object") return;
        for (const [k, v] of Object.entries(prefs)) {
            if (typeof v === "string") {
                try {
                    localStorage.setItem(k, v);
                } catch {}
            }
        }
        console.info("[CRM] Préférences restaurées depuis le disque.");
    } catch (err) {
        console.warn("[CRM] hydrate prefs:", err);
    }
}

export async function persistPrefsToDisk() {
    if (!isTauri()) return;
    try {
        const dump = {};
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (!shouldPersistKey(k)) continue;
            dump[k] = localStorage.getItem(k);
        }
        await invoke("crm_save_prefs", { payload: JSON.stringify(dump) });
    } catch (err) {
        console.warn("[CRM] save prefs:", err);
    }
}

let _prefsTimer = null;
export function persistPrefsDebounced() {
    if (!isTauri()) return;
    if (_prefsTimer) clearTimeout(_prefsTimer);
    _prefsTimer = setTimeout(() => {
        _prefsTimer = null;
        persistPrefsToDisk();
    }, 800);
}

export function startPrefsSync() {
    if (!isTauri()) return () => {};
    const onStorage = () => persistPrefsDebounced();
    window.addEventListener("storage", onStorage);
    // Patch setItem pour capturer les écritures same-tab
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
        orig(key, value);
        if (shouldPersistKey(key)) persistPrefsDebounced();
    };
    const interval = setInterval(() => persistPrefsToDisk(), 60_000);
    const onHide = () => {
        if (document.visibilityState === "hidden") persistPrefsToDisk();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", persistPrefsToDisk);
    return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("beforeunload", persistPrefsToDisk);
        window.removeEventListener("storage", onStorage);
        localStorage.setItem = orig;
    };
}
