/**
 * API GitHub Releases pour Relia Console (PAT local, jamais committer).
 */
import {
    RELIA_UPDATE_REPO,
    githubApiBase,
    fetchOfficialJson,
    OFFICIAL_JSON_URL,
    normalizeVersion,
} from "@/lib/officialChannel";

const PREF_TOKEN = "relia_console_github_token";

export function loadGithubToken() {
    try {
        return localStorage.getItem(PREF_TOKEN) || "";
    } catch {
        return "";
    }
}

export function saveGithubToken(token) {
    try {
        if (!token) localStorage.removeItem(PREF_TOKEN);
        else localStorage.setItem(PREF_TOKEN, String(token).trim());
    } catch {
        /* */
    }
}

function authHeaders(token) {
    return {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

export async function fetchOfficialStatus(token) {
    try {
        return await fetchOfficialJson(OFFICIAL_JSON_URL, {
            token: token || undefined,
            cacheBust: true,
        });
    } catch {
        // Essai via API asset si le download public échoue
        if (!token) throw new Error("Impossible de lire official.json (repo privé ? colle un PAT).");
        const api = `${githubApiBase()}/releases/tags/official`;
        const res = await fetch(api, { headers: authHeaders(token) });
        if (!res.ok) throw new Error(`Release official introuvable (${res.status})`);
        const release = await res.json();
        const asset = (release.assets || []).find((a) => a.name === "official.json");
        if (!asset) throw new Error("Asset official.json manquant sur la release official");
        const assetRes = await fetch(asset.url, {
            headers: {
                ...authHeaders(token),
                Accept: "application/octet-stream",
            },
        });
        if (!assetRes.ok) throw new Error(`Download official.json HTTP ${assetRes.status}`);
        const data = await assetRes.json();
        const { parseOfficialJson } = await import("@/lib/officialChannel");
        const parsed = parseOfficialJson(data);
        if (!parsed) throw new Error("official.json invalide");
        return parsed;
    }
}

/**
 * Liste les releases versionnées vX.Y.Z (pour rollback).
 * @returns {Promise<Array<{ tag: string, version: string, name: string, publishedAt: string | null }>>}
 */
export async function listVersionReleases(token) {
    if (!token) throw new Error("PAT GitHub requis");
    const res = await fetch(`${githubApiBase()}/releases?per_page=40`, {
        headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(`Liste releases HTTP ${res.status}`);
    const list = await res.json();
    return (list || [])
        .filter((r) => /^v\d+\.\d+/i.test(r.tag_name || "") && !(r.tag_name || "").includes("official"))
        .map((r) => ({
            tag: r.tag_name,
            version: normalizeVersion(r.tag_name),
            name: r.name || r.tag_name,
            publishedAt: r.published_at || null,
        }));
}

export { RELIA_UPDATE_REPO, OFFICIAL_JSON_URL };
