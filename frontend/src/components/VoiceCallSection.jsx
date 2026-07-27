import React from "react";
import { Loader2, Mic } from "lucide-react";
import { CallRecordingPlayer } from "@/components/CallRecordingPlayer";
import { useVoiceSession } from "@/context/VoiceSessionContext";
import { cn } from "@/lib/utils";

/**
 * Section Appel — UI légère ; l'enregistrement vit dans le dock global (persistant hors fiche).
 */
export function VoiceCallSection({
    saving = false,
    disabled = false,
    recent = [],
    leadLabel = "appel",
    workspaceId,
    leadId,
}) {
    const voice = useVoiceSession();
    const activeHere = voice.isActiveFor(leadId);
    const recordingElsewhere =
        voice.status !== "idle"
        && voice.target
        && voice.target.leadId !== leadId;

    const start = () => {
        if (disabled || saving || voice.status === "recording" || voice.status === "ready") return;
        voice.start({ workspaceId, leadId, leadLabel });
    };

    return (
        <div className="space-y-3" data-testid="voice-call-section">
            <div
                className={cn(
                    "rounded-xl border border-border/50 bg-muted/20 px-3 py-3",
                    activeHere && "border-primary/25 bg-primary/[0.03]"
                )}
            >
                {recordingElsewhere ? (
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-[13px] font-medium text-foreground truncate min-w-0">
                            Appel en cours · {voice.target?.leadLabel}
                        </p>
                        <button
                            type="button"
                            onClick={voice.openTarget}
                            className="h-8 px-3 rounded-full text-[11px] font-medium bg-secondary text-foreground shrink-0"
                        >
                            Revenir
                        </button>
                    </div>
                ) : activeHere && voice.status === "recording" ? (
                    <div className="flex items-center gap-3">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="absolute inset-0 rounded-full bg-destructive/40 animate-ping" />
                            <span className="relative h-2.5 w-2.5 rounded-full bg-destructive" />
                        </span>
                        <p className="text-[13px] font-medium tabular-nums text-foreground min-w-0 flex-1">
                            {voice.formatDuration(voice.elapsedMs)}
                        </p>
                        <button
                            type="button"
                            onClick={voice.stop}
                            className="h-8 px-3 rounded-full text-[11px] font-medium bg-foreground text-background shrink-0"
                        >
                            Arrêter
                        </button>
                    </div>
                ) : activeHere && voice.status === "ready" ? (
                    <div className="flex items-center gap-3">
                        <p className="text-[13px] font-medium text-foreground min-w-0 flex-1 truncate">
                            {voice.busyLabel || voice.saving
                                ? (voice.busyLabel || "Enregistrement…")
                                : `Prêt · ${voice.formatDuration(voice.pending?.durationMs || voice.elapsedMs)}`}
                        </p>
                        {(voice.saving || voice.busyLabel) && (
                            <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />
                        )}
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <p className="text-[13px] font-medium text-foreground min-w-0 flex-1">
                            Note d&apos;appel
                        </p>
                        <button
                            type="button"
                            data-testid="voice-section-start"
                            disabled={disabled || saving || voice.status === "recording"}
                            onClick={start}
                            className={cn(
                                "h-9 pl-2.5 pr-3.5 rounded-full shrink-0 inline-flex items-center justify-center gap-2",
                                "border border-border bg-background text-foreground",
                                "hover:bg-secondary hover:border-foreground/20",
                                "text-[12px] font-medium transition-colors disabled:opacity-40"
                            )}
                            aria-label="Démarrer l'enregistrement d'appel"
                            title="Démarrer l'enregistrement d'appel"
                        >
                            <Mic size={14} strokeWidth={2} className="text-primary" />
                            Enregistrer un appel
                        </button>
                    </div>
                )}
            </div>

            {recent.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-0.5">
                        Récents
                    </p>
                    <div className="space-y-1.5">
                        {recent.map((n) => (
                            <div
                                key={n.id}
                                className="rounded-xl border border-border/40 bg-background/50 px-2.5 py-2 space-y-1"
                            >
                                <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
                                    {n.at
                                        ? new Date(n.at).toLocaleString("fr-FR", {
                                            day: "numeric",
                                            month: "short",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })
                                        : "—"}
                                </span>
                                <CallRecordingPlayer
                                    recordingId={n.recordingId}
                                    leadLabel={leadLabel}
                                    workspaceId={workspaceId}
                                    leadId={leadId}
                                    noteId={n.id}
                                    noteText={n.text}
                                    transcript={n.transcript}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
