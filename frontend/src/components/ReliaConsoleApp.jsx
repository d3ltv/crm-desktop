/**
 * Relia Console — cockpit publish / rollback (GitHub official.json).
 * Identifier local.relia.console → data séparées du CRM.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, RotateCcw, KeyRound, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/diskStorage";
import {
    loadGithubToken,
    saveGithubToken,
    fetchOfficialStatus,
    listVersionReleases,
    listSemverTags,
    buildPublishVersionChoices,
    RELIA_UPDATE_REPO,
    OFFICIAL_JSON_URL,
} from "@/lib/consoleGithub";

const DEFAULT_RELLIA_APP = "/Volumes/disque dur externe 1/Rellia.app";
const PREF_APP_PATH = "relia_console_rellia_app_path";

function loadAppPath() {
    try {
        return localStorage.getItem(PREF_APP_PATH) || DEFAULT_RELLIA_APP;
    } catch {
        return DEFAULT_RELLIA_APP;
    }
}

export function ReliaConsoleApp() {
    const [token, setToken] = useState(() => loadGithubToken());
    const [tokenDraft, setTokenDraft] = useState(() => loadGithubToken());
    const [official, setOfficial] = useState(null);
    const [releases, setReleases] = useState([]);
    const [tags, setTags] = useState([]);
    const [notes, setNotes] = useState("");
    const [versionBump, setVersionBump] = useState("");
    const [rollbackVersion, setRollbackVersion] = useState("");
    const [appPath, setAppPath] = useState(() => loadAppPath());
    const [publishMode, setPublishMode] = useState("app");
    const [log, setLog] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [loadingMeta, setLoadingMeta] = useState(false);

    const publishChoices = useMemo(
        () =>
            buildPublishVersionChoices({
                officialVersion: official?.version || null,
                releaseVersions: releases.map((r) => r.version),
                tagVersions: tags.map((t) => t.version),
            }),
        [official, releases, tags]
    );

    const refresh = useCallback(async () => {
        setLoadingMeta(true);
        setError("");
        try {
            const off = await fetchOfficialStatus(token || undefined);
            setOfficial(off);

            let nextReleases = [];
            let nextTags = [];
            if (token) {
                try {
                    nextReleases = await listVersionReleases(token);
                    setReleases(nextReleases);
                    if (nextReleases[0]) {
                        setRollbackVersion((prev) => prev || nextReleases[0].version);
                    }
                } catch (listErr) {
                    setReleases([]);
                    console.warn("[Console] list releases:", listErr);
                }
                try {
                    nextTags = await listSemverTags(token);
                    setTags(nextTags);
                } catch (tagErr) {
                    setTags([]);
                    console.warn("[Console] list tags:", tagErr);
                }
            } else {
                setReleases([]);
                setTags([]);
            }

            const choices = buildPublishVersionChoices({
                officialVersion: off?.version || null,
                releaseVersions: nextReleases.map((r) => r.version),
                tagVersions: nextTags.map((t) => t.version),
            });
            setVersionBump((prev) => {
                const stillValid =
                    prev &&
                    (choices.suggestions.some((s) => s.version === prev) ||
                        choices.existing.some((e) => e.version === prev));
                return stillValid ? prev : choices.defaultVersion;
            });
        } catch (err) {
            setOfficial(null);
            setError(err?.message ? String(err.message) : "Erreur lecture canal officiel");
        } finally {
            setLoadingMeta(false);
        }
    }, [token]);

    useEffect(() => {
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const saveToken = () => {
        const t = tokenDraft.trim();
        saveGithubToken(t);
        setToken(t);
        setLog(t ? "PAT enregistré localement (prefs Console)." : "PAT effacé.");
    };

    const runScript = async (script, args, setVersion) => {
        if (!isTauri()) {
            setError("Relia Console doit tourner en app desktop (yarn desktop:console).");
            return;
        }
        try {
            localStorage.setItem(PREF_APP_PATH, appPath.trim());
        } catch {
            /* */
        }
        setBusy(true);
        setError("");
        setLog(`→ ${script}…`);
        try {
            const out = await invoke("crm_console_run_script", {
                script,
                args,
                githubToken: token || null,
                setVersion: setVersion || null,
                appPath: publishMode === "app" ? appPath.trim() : null,
                publishMode: script === "publish-update.sh" ? publishMode : null,
            });
            setLog(String(out || "OK"));
            await refresh();
        } catch (err) {
            const msg = typeof err === "string" ? err : err?.message || String(err);
            setError(msg);
            setLog(msg);
        } finally {
            setBusy(false);
        }
    };

    const handlePublish = () => {
        if (!versionBump) {
            setError("Choisis une version dans la liste.");
            return;
        }
        const n = notes.trim() || `Mise à jour Rellia ${versionBump}`.trim();
        runScript("publish-update.sh", [n], versionBump);
    };

    const handleRollback = () => {
        const v = rollbackVersion.trim();
        if (!v) {
            setError("Choisis une version à restaurer.");
            return;
        }
        const n = notes.trim() || `Retour à Rellia ${v}`;
        runScript("set-official.sh", [v, n], null);
    };

    const selectedIsExisting = publishChoices.existing.some(
        (e) => e.version === versionBump && e.published
    );

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border/60 px-6 py-5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
                    Relia Console
                </p>
                <h1 className="mt-1 text-[22px] font-semibold tracking-tight">
                    Canal officiel Rellia
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground max-w-xl leading-relaxed">
                    Publie la build <span className="text-foreground">Rellia</span> (partageable),
                    pas ta Relia perso. Les clients Rellia s’alignent au démarrage. Repo{" "}
                    <span className="tabular-nums text-foreground/80">{RELIA_UPDATE_REPO}</span>.
                </p>
            </header>

            <main className="mx-auto max-w-xl px-6 py-6 flex flex-col gap-6">
                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <KeyRound className="h-4 w-4 text-primary" />
                        GitHub PAT
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        Droits Releases sur le repo. Stocké uniquement dans les prefs Console
                        (<code className="text-[11px]">local.relia.console</code>).
                    </p>
                    <input
                        type="password"
                        autoComplete="off"
                        value={tokenDraft}
                        onChange={(e) => setTokenDraft(e.target.value)}
                        placeholder="ghp_…"
                        className="mt-3 w-full h-9 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                        type="button"
                        onClick={saveToken}
                        className="mt-2 h-8 rounded-full px-3.5 text-[12.5px] font-medium bg-secondary text-secondary-foreground hover:opacity-90"
                    >
                        Enregistrer
                    </button>
                </section>

                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-medium">Version officielle</p>
                        <button
                            type="button"
                            disabled={loadingMeta || busy}
                            onClick={refresh}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", loadingMeta && "animate-spin")} />
                            Actualiser
                        </button>
                    </div>
                    {official ? (
                        <div className="mt-2">
                            <p className="text-[28px] font-semibold tabular-nums tracking-tight">
                                {official.version}
                            </p>
                            <p className="mt-1 text-[12px] text-muted-foreground">
                                {official.reason === "rollback" ? "Rollback · " : ""}
                                {official.notes || "—"}
                            </p>
                        </div>
                    ) : (
                        <div className="mt-2 space-y-1">
                            <p className="text-[15px] font-medium text-foreground">
                                Pas encore de canal officiel
                            </p>
                            <p className="text-[13px] text-muted-foreground leading-relaxed">
                                Choisis une version dans la liste puis{" "}
                                <span className="text-foreground">Publier sur GitHub</span> — ça
                                créera la release <code className="text-[11px]">official</code>.
                            </p>
                        </div>
                    )}
                    <p className="mt-3 text-[11px] text-muted-foreground break-all">
                        {OFFICIAL_JSON_URL}
                    </p>
                </section>

                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <label className="text-[13px] font-medium">Notes (affichées dans Relia)</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Correctifs calendrier…"
                        className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                    />
                </section>

                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <Download className="h-4 w-4 text-primary" />
                        Publier Rellia
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        Source = ton <span className="text-foreground">Rellia.app</span> sur le SSD
                        (ou rebuild whisper). Ta Relia perso n’est pas touchée.
                    </p>

                    <label className="mt-3 block text-[12px] text-muted-foreground">
                        Source
                    </label>
                    <select
                        value={publishMode}
                        onChange={(e) => setPublishMode(e.target.value)}
                        className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
                    >
                        <option value="app">Rellia.app sur le SSD (recommandé)</option>
                        <option value="build">Rebuild depuis le code (whisper SSD)</option>
                    </select>

                    {publishMode === "app" ? (
                        <>
                            <label className="mt-3 block text-[12px] text-muted-foreground">
                                Chemin Rellia.app
                            </label>
                            <input
                                value={appPath}
                                onChange={(e) => setAppPath(e.target.value)}
                                className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
                            />
                        </>
                    ) : null}

                    <label className="mt-3 block text-[12px] text-muted-foreground">
                        Version à publier
                    </label>
                    <select
                        value={versionBump}
                        onChange={(e) => setVersionBump(e.target.value)}
                        className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                    >
                        <optgroup label="Nouvelle version">
                            {publishChoices.suggestions.map((s) => (
                                <option key={`s-${s.version}`} value={s.version}>
                                    {s.label}
                                </option>
                            ))}
                        </optgroup>
                        {publishChoices.existing.length > 0 ? (
                            <optgroup label="Tags / releases GitHub">
                                {publishChoices.existing.map((e) => (
                                    <option key={`e-${e.version}`} value={e.version}>
                                        {e.label}
                                    </option>
                                ))}
                            </optgroup>
                        ) : null}
                    </select>
                    {selectedIsExisting ? (
                        <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">
                            Cette version existe déjà sur GitHub : republier écrasera ses assets.
                        </p>
                    ) : null}
                    {!token ? (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                            Enregistre un PAT pour charger les tags GitHub dans la liste.
                        </p>
                    ) : null}
                    <button
                        type="button"
                        disabled={busy || !versionBump}
                        onClick={handlePublish}
                        className={cn(
                            "mt-3 inline-flex h-9 items-center justify-center rounded-full px-4",
                            "bg-primary text-primary-foreground text-[13px] font-medium",
                            "hover:opacity-90 disabled:opacity-50"
                        )}
                    >
                        {busy ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                En cours…
                            </>
                        ) : (
                            `Publier Rellia v${versionBump || "…"}`
                        )}
                    </button>
                </section>

                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <RotateCcw className="h-4 w-4 text-primary" />
                        Rollback (sans rebuild)
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        Repointe official.json vers une archive déjà uploadée.
                    </p>
                    <select
                        value={rollbackVersion}
                        onChange={(e) => setRollbackVersion(e.target.value)}
                        className="mt-3 w-full h-9 rounded-xl border border-border bg-background px-3 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                    >
                        <option value="">— choisir une release —</option>
                        {releases.map((r) => (
                            <option key={r.tag} value={r.version}>
                                {r.tag}
                                {official?.version === r.version ? " (officiel)" : ""}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        disabled={busy || !rollbackVersion || !token}
                        onClick={handleRollback}
                        className={cn(
                            "mt-3 inline-flex h-9 items-center justify-center rounded-full px-4",
                            "border border-border text-[13px] font-medium",
                            "hover:bg-secondary disabled:opacity-50"
                        )}
                    >
                        Repasser en officiel
                    </button>
                </section>

                {error ? (
                    <p className="text-[12.5px] text-destructive whitespace-pre-wrap">{error}</p>
                ) : null}
                {log ? (
                    <pre className="text-[11px] leading-relaxed text-muted-foreground bg-muted/40 rounded-xl p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                        {log}
                    </pre>
                ) : null}
            </main>
        </div>
    );
}
