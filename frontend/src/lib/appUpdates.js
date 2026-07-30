/**
 * appUpdates.js — Alignement Relia sur official.json (GitHub release `official`).
 *
 * Au démarrage : si version locale ≠ officielle → panneau Aligner (upgrade ou rollback).
 * L’install remplace Relia.app seulement — jamais Application Support / crm_state.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/diskStorage";
import { OFFICIAL_JSON_URL, normalizeVersion } from "@/lib/officialChannel";

const PREF_DISMISSED = "relia_update_dismissed_version";

let installInFlight = false;

function prefsGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function prefsSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* */
    }
}

function prefsRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        /* */
    }
}

export function isUpdateInstallInFlight() {
    return installInFlight;
}

export function dismissUpdateVersion(version) {
    if (!version) return;
    prefsSet(PREF_DISMISSED, normalizeVersion(version));
    if (isTauri()) {
        invoke("crm_align_clear").catch(() => {});
    }
}

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<null | {
 *   version: string,
 *   notes: string,
 *   date: string | null,
 *   currentVersion: string,
 *   reason: "update" | "rollback" | string,
 *   officialUrl: string,
 * }>}
 */
export async function checkForAppUpdate({ force = false } = {}) {
    if (!isTauri()) return null;
    // Dev (`yarn desktop`) : pas de check auto
    if (process.env.NODE_ENV === "development" && !force) return null;
    if (installInFlight) return null;

    let offer;
    try {
        offer = await invoke("crm_align_check");
    } catch (err) {
        console.warn("[Relia] align check:", err);
        return null;
    }

    if (!offer || !offer.version) return null;

    const remoteVersion = normalizeVersion(offer.version);
    const currentVersion = normalizeVersion(offer.currentVersion || "");

    if (!force && prefsGet(PREF_DISMISSED) === remoteVersion) {
        await invoke("crm_align_clear").catch(() => {});
        return null;
    }

    return {
        version: remoteVersion,
        notes: String(offer.notes || "").trim(),
        date: offer.date ? String(offer.date) : null,
        currentVersion,
        reason: offer.reason === "rollback" ? "rollback" : "update",
        officialUrl: OFFICIAL_JSON_URL,
    };
}

/**
 * Installe la version officielle en attente (après checkForAppUpdate), puis relance.
 *
 * @param {(p: { event: string, downloaded?: number, contentLength?: number | null }) => void} [onProgress]
 */
export async function downloadAndInstallAppUpdate(_offerOrUpdate, onProgress) {
    if (installInFlight) throw new Error("Installation déjà en cours");
    installInFlight = true;
    onProgress?.({ event: "Started", downloaded: 0, contentLength: null });

    try {
        onProgress?.({ event: "Progress", downloaded: 0, contentLength: null });
        await invoke("crm_align_install");
        onProgress?.({ event: "Finished", downloaded: 0, contentLength: null });
        prefsRemove(PREF_DISMISSED);

        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
    } finally {
        installInFlight = false;
    }
}

export { OFFICIAL_JSON_URL };
