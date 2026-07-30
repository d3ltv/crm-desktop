/**
 * Relia Console — cockpit publish / rollback (GitHub official.json).
 * Identifier local.relia.console → data séparées du CRM.
 */
import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, RotateCcw, KeyRound, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/diskStorage";
import {
    loadGithubToken,
    saveGithubToken,
    fetchOfficialStatus,
    listVersionReleases,
    RELIA_UPDATE_REPO,
    OFFICIAL_JSON_URL,
} from "@/lib/consoleGithub";

export function ReliaConsoleApp() {
    const [token, setToken] = useState(() => loadGithubToken());
    const [tokenDraft, setTokenDraft] = useState(() => loadGithubToken());
    const [official, setOfficial] = useState(null);
    const [releases, setReleases] = useState([]);
    const [notes, setNotes] = useState("");
    const [versionBump, setVersionBump] = useState("");
    const [rollbackVersion, setRollbackVersion] = useState("");
    const [log, setLog] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [loadingMeta, setLoadingMeta] = useState(false);

    const refresh = useCallback(async () => {
        setLoadingMeta(true);
        setError("");
        try {
            const off = await fetchOfficialStatus(token || undefined);
            setOfficial(off);
            if (!versionBump) setVersionBump(off.version || "");
            if (token) {
                const list = await listVersionReleases(token);
                setReleases(list);
                if (!rollbackVersion && list[0]) setRollbackVersion(list[0].version);
            }
        } catch (err) {
            setOfficial(null);
            setError(err?.message ? String(err.message) : "Erreur lecture canal officiel");
        } finally {
            setLoadingMeta(false);
        }
    }, [token, versionBump, rollbackVersion]);

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
        setBusy(true);
        setError("");
        setLog(`→ ${script}…`);
        try {
            const out = await invoke("crm_console_run_script", {
                script,
                args,
                githubToken: token || null,
                setVersion: setVersion || null,
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
        const n = notes.trim() || `Mise à jour Relia ${versionBump || ""}`.trim();
        runScript("publish-update.sh", [n], versionBump.trim() || null);
    };

    const handleRollback = () => {
        const v = rollbackVersion.trim();
        if (!v) {
            setError("Choisis une version à restaurer.");
            return;
        }
        const n = notes.trim() || `Retour à Relia ${v}`;
        runScript("set-official.sh", [v, n], null);
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border/60 px-6 py-5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
                    Relia Console
                </p>
                <h1 className="mt-1 text-[22px] font-semibold tracking-tight">
                    Canal officiel
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground max-w-xl leading-relaxed">
                    Publie une build ou repointe vers une ancienne version. Les clients Relia
                    s’alignent au démarrage. Repo{" "}
                    <span className="tabular-nums text-foreground/80">{RELIA_UPDATE_REPO}</span>.
                </p>
            </header>

            <main className="mx-auto max-w-xl px-6 py-6 flex flex-col gap-6">
                {/* Token */}
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

                {/* Status */}
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
                            <p className="text-[12px] text-muted-foreground mt-1">
                                {official.reason === "rollback" ? "Rollback · " : ""}
                                {official.notes || "—"}
                            </p>
                        </div>
                    ) : (
                        <p className="mt-2 text-[13px] text-muted-foreground">
                            Aucun pointeur (crée-le en publiant une première version).
                        </p>
                    )}
                    <p className="mt-3 text-[11px] text-muted-foreground break-all">
                        {OFFICIAL_JSON_URL}
                    </p>
                </section>

                {/* Notes */}
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

                {/* Publish */}
                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <Download className="h-4 w-4 text-primary" />
                        Publier la version du jour
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        Build local signé → GitHub tag vX.Y.Z → pointeur official. Peut prendre
                        plusieurs minutes.
                    </p>
                    <label className="mt-3 block text-[12px] text-muted-foreground">
                        Version à publier
                    </label>
                    <input
                        value={versionBump}
                        onChange={(e) => setVersionBump(e.target.value)}
                        placeholder="0.1.1"
                        className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                        type="button"
                        disabled={busy || !versionBump.trim()}
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
                            "Publier sur GitHub"
                        )}
                    </button>
                </section>

                {/* Rollback */}
                <section className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <RotateCcw className="h-4 w-4 text-primary" />
                        Rollback (sans rebuild)
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        Repointe official.json vers une archive déjà uploadée. Les Relia verront
                        « Retour à une version précédente » au prochain démarrage.
                    </p>
                    <select
                        value={rollbackVersion}
                        onChange={(e) => setRollbackVersion(e.target.value)}
                        className="mt-3 w-full h-9 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
                    >
                        <option value="">— choisir —</option>
                        {releases.map((r) => (
                            <option key={r.tag} value={r.version}>
                                {r.version}
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
