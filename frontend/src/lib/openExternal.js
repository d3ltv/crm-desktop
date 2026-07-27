/**
 * openExternal.js — Ouvre http(s) / mailto / tel hors du webview Relia.
 *
 * Sous Tauri, `target="_blank"` ne lance pas Safari : il faut `open` OS.
 * Hors Tauri (navigateur), comportement lien classique.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/diskStorage";

const EXTERNAL_RE = /^(https?:|mailto:|tel:)/i;

export function isExternalHref(href) {
    return !!href && EXTERNAL_RE.test(String(href).trim());
}

/**
 * @param {string} url
 */
export async function openExternal(url) {
    const href = String(url || "").trim();
    if (!href || !isExternalHref(href)) return;

    if (isTauri()) {
        try {
            await invoke("crm_open_url", { url: href });
            return;
        } catch (err) {
            console.warn("[Relia] openExternal:", err);
        }
    }

    try {
        window.open(href, "_blank", "noopener,noreferrer");
    } catch {
        window.location.href = href;
    }
}

/**
 * Intercepte les clics sur <a href="http…|mailto:|tel:"> dans toute l’app.
 */
export function installExternalLinkHandler() {
    if (typeof document === "undefined") return;
    if (window.__reliaExternalLinksInstalled) return;
    window.__reliaExternalLinksInstalled = true;

    document.addEventListener(
        "click",
        (e) => {
            if (e.defaultPrevented) return;
            if (e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

            const a = e.target?.closest?.("a[href]");
            if (!a) return;
            const href = a.getAttribute("href");
            if (!isExternalHref(href)) return;

            // Sous Tauri : ouvrir via l’OS, sans bloquer le reste du DOM
            if (!isTauri()) return;

            e.preventDefault();
            openExternal(href);
        },
        true
    );
}
