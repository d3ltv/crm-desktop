/**
 * diskStorage.js — Persistence fichier disque via Tauri (desktop).
 *
 * Fichiers (macOS) :
 *   ~/Library/Application Support/local.crm.desktop/crm_state_v1.json
 *   ~/Library/Application Support/local.crm.desktop/crm_state_v1_backup.json
 *   ~/Library/Application Support/local.crm.desktop/backups/crm_state_*.json
 *
 * Hors Tauri (navigateur) → no-op ; le CrmContext garde localStorage.
 */

import { invoke } from "@tauri-apps/api/core";

export function isTauri() {
    return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function diskLoadState() {
    if (!isTauri()) return null;
    return invoke("crm_load_state");
}

export async function diskLoadBackup() {
    if (!isTauri()) return null;
    return invoke("crm_load_backup");
}

export async function diskSaveState(serialized) {
    if (!isTauri()) return false;
    await invoke("crm_save_state", { payload: serialized });
    return true;
}

export async function diskDataDir() {
    if (!isTauri()) return null;
    return invoke("crm_data_dir");
}
