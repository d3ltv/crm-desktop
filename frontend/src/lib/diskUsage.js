/**
 * diskUsage.js — Journal d’usage local (apprentissage reco).
 * Fichier : ~/Library/Application Support/local.crm.desktop/crm_usage_v1.json
 * Hors métier CRM (≠ crm_state_v1.json).
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/diskStorage";

export async function diskLoadUsage() {
    if (!isTauri()) return null;
    try {
        return await invoke("crm_load_usage");
    } catch (err) {
        console.warn("[Relia Usage] load:", err);
        return null;
    }
}

export async function diskSaveUsage(serialized) {
    if (!isTauri()) return false;
    try {
        await invoke("crm_save_usage", { payload: serialized });
        return true;
    } catch (err) {
        console.warn("[Relia Usage] save:", err);
        return false;
    }
}
