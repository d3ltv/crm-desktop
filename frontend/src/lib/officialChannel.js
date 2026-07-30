/**
 * Canal de mise à jour Relia — contrat official.json (GitHub release `official`).
 * Shared Relia client + Relia Console.
 */

export const RELIA_UPDATE_REPO = "d3ltv/crm-desktop";
export const OFFICIAL_RELEASE_TAG = "official";

export const OFFICIAL_JSON_URL =
    `https://github.com/${RELIA_UPDATE_REPO}/releases/download/${OFFICIAL_RELEASE_TAG}/official.json`;

/** URL API GitHub (releases). */
export function githubApiBase(repo = RELIA_UPDATE_REPO) {
    return `https://api.github.com/repos/${repo}`;
}

/**
 * @param {unknown} raw
 * @returns {{
 *   version: string,
 *   notes: string,
 *   reason: "update" | "rollback" | string,
 *   pub_date: string | null,
 *   platforms: Record<string, { url: string, signature: string }>,
 * } | null}
 */
export function parseOfficialJson(raw) {
    if (!raw || typeof raw !== "object") return null;
    const version = String(raw.version || "").replace(/^v/i, "").trim();
    if (!version) return null;
    const platforms = raw.platforms && typeof raw.platforms === "object" ? raw.platforms : {};
    return {
        version,
        notes: String(raw.notes || "").trim(),
        reason: String(raw.reason || "update"),
        pub_date: raw.pub_date ? String(raw.pub_date) : null,
        platforms,
    };
}

/**
 * @param {string} [url]
 * @param {{ token?: string, cacheBust?: boolean }} [opts]
 */
export async function fetchOfficialJson(url = OFFICIAL_JSON_URL, opts = {}) {
    const u = opts.cacheBust ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
    const headers = {
        Accept: "application/octet-stream, application/json",
    };
    if (opts.token) {
        headers.Authorization = `Bearer ${opts.token}`;
        headers.Accept = "application/vnd.github+json";
    }
    const res = await fetch(u, { headers, cache: "no-store" });
    if (!res.ok) {
        throw new Error(`official.json HTTP ${res.status}`);
    }
    const data = await res.json();
    const parsed = parseOfficialJson(data);
    if (!parsed) throw new Error("official.json invalide");
    return parsed;
}

export function normalizeVersion(v) {
    return String(v || "").replace(/^v/i, "").trim();
}

export function compareSemver(a, b) {
    const pa = normalizeVersion(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = normalizeVersion(b).split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da > db) return 1;
        if (da < db) return -1;
    }
    return 0;
}

/** Plus haute version semver parmi une liste. */
export function maxSemver(...versions) {
    const list = versions.map(normalizeVersion).filter(Boolean);
    if (!list.length) return "0.0.0";
    return list.reduce((best, cur) => (compareSemver(cur, best) > 0 ? cur : best));
}

/**
 * @param {string} version
 * @param {"patch" | "minor" | "major"} kind
 */
export function bumpSemver(version, kind) {
    const parts = normalizeVersion(version || "0.0.0")
        .split(".")
        .map((n) => parseInt(n, 10) || 0);
    const maj = parts[0] || 0;
    const min = parts[1] || 0;
    const pat = parts[2] || 0;
    if (kind === "major") return `${maj + 1}.0.0`;
    if (kind === "minor") return `${maj}.${min + 1}.0`;
    return `${maj}.${min}.${pat + 1}`;
}

export function alignReason(localVersion, officialVersion, declaredReason) {
    if (declaredReason === "rollback") return "rollback";
    const cmp = compareSemver(officialVersion, localVersion);
    if (cmp < 0) return "rollback";
    return "update";
}
