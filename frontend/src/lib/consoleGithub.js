/**
 * API GitHub Releases pour Relia Console (PAT local, jamais committer).
 */
import {
    RELIA_UPDATE_REPO,
    githubApiBase,
    fetchOfficialJson,
    OFFICIAL_JSON_URL,
    normalizeVersion,
    compareSemver,
    maxSemver,
    bumpSemver,
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
        // Pas encore de canal : normal avant la 1ʳᵉ publish
        if (!token) return null;

        const api = `${githubApiBase()}/releases/tags/official`;
        const res = await fetch(api, { headers: authHeaders(token) });
        if (res.status === 404) return null;
        if (res.status === 401 || res.status === 403) {
            throw new Error("PAT refusé (401/403). Vérifie le token et les droits Releases.");
        }
        if (!res.ok) {
            throw new Error(`Lecture release official : HTTP ${res.status}`);
        }

        const release = await res.json();
        const asset = (release.assets || []).find((a) => a.name === "official.json");
        if (!asset) return null;

        const assetRes = await fetch(asset.url, {
            headers: {
                ...authHeaders(token),
                Accept: "application/octet-stream",
            },
        });
        if (assetRes.status === 404) return null;
        if (!assetRes.ok) {
            throw new Error(`Download official.json HTTP ${assetRes.status}`);
        }
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

/**
 * Tags GitHub semver (v0.1.0, …) — source de vérité pour le sélecteur.
 * @returns {Promise<Array<{ tag: string, version: string }>>}
 */
export async function listSemverTags(token) {
    if (!token) return [];
    const res = await fetch(`${githubApiBase()}/tags?per_page=100`, {
        headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(`Liste tags HTTP ${res.status}`);
    const list = await res.json();
    const out = [];
    const seen = new Set();
    for (const t of list || []) {
        const name = String(t.name || "");
        if (!/^v?\d+\.\d+/i.test(name)) continue;
        if (/official/i.test(name)) continue;
        const version = normalizeVersion(name);
        if (!version || seen.has(version)) continue;
        seen.add(version);
        out.push({ tag: name.startsWith("v") ? name : `v${version}`, version });
    }
    out.sort((a, b) => compareSemver(b.version, a.version));
    return out;
}

/**
 * Options du sélecteur « version à publier » (suggestions + tags GitHub).
 * @param {{
 *   officialVersion?: string | null,
 *   releaseVersions?: string[],
 *   tagVersions?: string[],
 * }} input
 * @returns {{
 *   suggestions: Array<{ version: string, label: string }>,
 *   existing: Array<{ version: string, label: string, published: boolean }>,
 *   defaultVersion: string,
 * }}
 */
export function buildPublishVersionChoices({
    officialVersion = null,
    releaseVersions = [],
    tagVersions = [],
} = {}) {
    const published = new Set(
        (releaseVersions || []).map(normalizeVersion).filter(Boolean)
    );
    const allKnown = [
        ...new Set(
            [
                officialVersion,
                ...(releaseVersions || []),
                ...(tagVersions || []),
            ]
                .map(normalizeVersion)
                .filter(Boolean)
        ),
    ].sort((a, b) => compareSemver(b, a));

    const base = maxSemver(...allKnown);
    const suggestions = [];

    if (!allKnown.length) {
        suggestions.push({
            version: "0.1.0",
            label: "v0.1.0 — première publication",
        });
    } else {
        const patch = bumpSemver(base, "patch");
        const minor = bumpSemver(base, "minor");
        const major = bumpSemver(base, "major");
        suggestions.push(
            { version: patch, label: `v${patch} — patch (après ${base})` },
            { version: minor, label: `v${minor} — mineure` },
            { version: major, label: `v${major} — majeure` }
        );
    }

    const existing = allKnown.map((version) => ({
        version,
        label: published.has(version)
            ? `v${version} — release GitHub (réécrit si republie)`
            : `v${version} — tag GitHub`,
        published: published.has(version),
    }));

    const defaultVersion = suggestions[0]?.version || allKnown[0] || "0.1.0";

    return { suggestions, existing, defaultVersion };
}

export { RELIA_UPDATE_REPO, OFFICIAL_JSON_URL };
