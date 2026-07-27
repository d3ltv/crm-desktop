import React, { useEffect, useState } from "react";
import { Loader2, Type } from "lucide-react";
import {
    getCallRecording,
    downloadCallRecording,
    scheduleDeferredRecordingDelete,
    cancelDeferredRecordingDelete,
    daysUntilPurge,
} from "@/lib/callRecordings";
import { CallAudioPlayer } from "@/components/CallAudioPlayer";
import { transcribeAudioBlob, isTranscribeSupported } from "@/lib/transcribeLocal";
import { applySafeTranscriptFields, offerDetectedAppointment } from "@/lib/transcriptSideEffects";
import { useCrm } from "@/context/CrmContext";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Lecteur d'un enregistrement d'appel.
 * Le transcript s'affiche ici (sous l'audio), jamais dans la section Notes.
 */

function extractVoiceTranscript(noteText, transcriptField) {
    const fromField = String(transcriptField || "").trim();
    if (fromField) return fromField;
    const raw = String(noteText || "").trim();
    if (!raw) return "";
    const stripped = raw.replace(/^\s*📞\s*Joint\s*·\s*/i, "").trim();
    if (!stripped || /^note (?:vocale|d['']appel)$/i.test(stripped)) return "";
    return stripped;
}

export function CallRecordingPlayer({
    recordingId,
    leadLabel = "appel",
    workspaceId = null,
    leadId = null,
    noteId = null,
    noteText = "",
    transcript: transcriptProp = "",
}) {
    const { state, dispatch } = useCrm();
    const [rec, setRec] = useState(null);
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [gone, setGone] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [progressMsg, setProgressMsg] = useState("");
    const [transcriptExpanded, setTranscriptExpanded] = useState(false);
    const [localTranscript, setLocalTranscript] = useState(() =>
        extractVoiceTranscript(noteText, transcriptProp)
    );

    useEffect(() => {
        setLocalTranscript(extractVoiceTranscript(noteText, transcriptProp));
    }, [noteText, transcriptProp]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl = null;

        // Undo après delete : annule la purge disque différée de cet audio
        if (recordingId) cancelDeferredRecordingDelete(recordingId);

        (async () => {
            setLoading(true);
            setMissing(false);
            setGone(false);
            const data = await getCallRecording(recordingId);
            if (cancelled) return;
            if (!data?.blob) {
                setRec(null);
                setUrl(null);
                setMissing(true);
                setLoading(false);
                return;
            }
            objectUrl = URL.createObjectURL(data.blob);
            setRec(data);
            setUrl(objectUrl);
            setLoading(false);
        })();

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [recordingId]);

    const handleDownload = async () => {
        try {
            const safe = String(leadLabel || "appel")
                .replace(/[^\w\-àâäéèêëïîôùûüç\s]+/gi, "")
                .trim()
                .replace(/\s+/g, "-")
                .slice(0, 40) || "appel";
            const stamp = (rec?.createdAt || "").slice(0, 10);
            const updated = await downloadCallRecording(
                recordingId,
                `${safe}-${stamp || "audio"}`
            );
            if (updated) setRec(updated);
            toast.success("Audio téléchargé", {
                description: "Conservé dans le CRM",
            });
        } catch (err) {
            console.warn(err);
            toast.error("Téléchargement impossible");
        }
    };

    const removeNoteFromState = () => {
        if (!workspaceId || !leadId) return;
        dispatch({
            type: "DELETE_NOTE",
            workspaceId,
            leadId,
            noteId: noteId || undefined,
            recordingId: recordingId || undefined,
        });
    };

    const performDelete = async () => {
        setConfirmOpen(false);
        setGone(true);
        removeNoteFromState();
        // Différer la suppression disque (~45s) pour laisser Cmd+Z restaurer l'audio
        if (recordingId) scheduleDeferredRecordingDelete(recordingId);
        toast.success("Appel retiré", {
            description: "Cmd+Z pour annuler",
        });
    };

    const handleTranscribe = async () => {
        if (!rec?.blob || transcribing || !workspaceId || !leadId) return;
        if (!isTranscribeSupported()) {
            toast.error("Transcription non supportée ici");
            return;
        }
        setTranscribing(true);
        setProgressMsg("Préparation…");
        try {
            const transcript = await transcribeAudioBlob(rec.blob, {
                onProgress: (p) => {
                    if (p?.message) setProgressMsg(p.message);
                },
            });
            if (!transcript) {
                toast.message("Aucun texte détecté");
                setTranscribing(false);
                setProgressMsg("");
                return;
            }

            setLocalTranscript(transcript);

            if (noteId) {
                dispatch({
                    type: "UPDATE_NOTE",
                    workspaceId,
                    leadId,
                    noteId,
                    patch: {
                        text: "📞 Joint · Note d'appel",
                        transcript,
                    },
                });
            }

            const ws = state.workspaces?.[workspaceId];
            const lead = ws?.leads?.[leadId];
            if (lead) {
                const side = applySafeTranscriptFields(dispatch, {
                    workspaceId,
                    leadId,
                    lead,
                    text: transcript,
                    isJobs: ws?.template === "jobs",
                });
                if (side?.appointment) {
                    toast.success("Appel transcrit");
                    offerDetectedAppointment(dispatch, {
                        workspaceId,
                        leadId,
                        appointment: side.appointment,
                    });
                } else {
                    toast.success("Appel transcrit");
                }
            } else {
                toast.success("Appel transcrit");
            }
        } catch (err) {
            console.warn(err);
            toast.error("Transcription impossible", {
                description: String(err?.message || err).slice(0, 120),
            });
        } finally {
            setTranscribing(false);
            setProgressMsg("");
        }
    };

    const confirmDialog = (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent className="rounded-2xl max-w-sm" data-testid="call-delete-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer cet appel ?</AlertDialogTitle>
                    <AlertDialogDescription>
                        L&apos;enregistrement et sa transcription seront retirés de la fiche.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={performDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        Supprimer
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );

    if (gone) return confirmDialog;

    if (loading) {
        return (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                Chargement audio…
            </div>
        );
    }

    if (missing || !url) {
        return (
            <>
                <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground/80 italic">
                        Enregistrement expiré ou introuvable
                    </p>
                    {workspaceId && leadId && (
                        <button
                            type="button"
                            onClick={() => setConfirmOpen(true)}
                            className="text-[10px] font-medium text-muted-foreground hover:text-destructive"
                        >
                            Retirer
                        </button>
                    )}
                </div>
                {confirmDialog}
            </>
        );
    }

    const daysLeft = daysUntilPurge(rec);
    const transcript = localTranscript;
    const alreadyText = !!transcript;

    return (
        <>
            <div
                className="mt-2 rounded-lg border border-border/50 bg-background/70 p-2 space-y-1.5"
                data-testid={`call-recording-${recordingId}`}
            >
                <CallAudioPlayer
                    src={url}
                    blob={rec.blob}
                    peaks={rec.peaks}
                    durationMs={rec.durationMs || 0}
                    onDownload={handleDownload}
                    downloadLabel="Télécharger"
                    onDelete={() => setConfirmOpen(true)}
                    deleteLabel="Supprimer l'appel"
                />
                {transcript && (() => {
                    const lines = transcript.split(/\n/).filter((l, i, arr) => l.trim() || i < arr.length - 1);
                    const collapsed = !transcriptExpanded && (lines.length > 3 || transcript.length > 180);
                    const preview = collapsed
                        ? (lines.slice(0, 3).join("\n").slice(0, 180) + (transcript.length > 180 || lines.length > 3 ? "…" : ""))
                        : transcript;
                    return (
                        <div className="space-y-0.5 px-0.5 pt-0.5">
                            <p
                                className="text-[12px] text-foreground/90 leading-relaxed whitespace-pre-wrap"
                                data-testid={`voice-transcript-${recordingId}`}
                            >
                                {preview}
                            </p>
                            {collapsed && (
                                <button
                                    type="button"
                                    onClick={() => setTranscriptExpanded(true)}
                                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Voir plus
                                </button>
                            )}
                            {transcriptExpanded && (lines.length > 3 || transcript.length > 180) && (
                                <button
                                    type="button"
                                    onClick={() => setTranscriptExpanded(false)}
                                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Voir moins
                                </button>
                            )}
                        </div>
                    );
                })()}
                <div className="flex items-center justify-between gap-2 px-0.5">
                    {(rec.preserved || daysLeft != null) ? (
                        <p className="text-[10px] text-muted-foreground/70 tabular-nums">
                            {rec.preserved
                                ? "Conservé"
                                : daysLeft <= 0
                                    ? "Expire bientôt"
                                    : `${daysLeft}j restant`}
                        </p>
                    ) : (
                        <span />
                    )}
                    {workspaceId && leadId && isTranscribeSupported() && (
                        <button
                            type="button"
                            onClick={handleTranscribe}
                            disabled={transcribing}
                            className="text-[10px] font-medium text-muted-foreground hover:text-primary inline-flex items-center gap-1 disabled:opacity-60 transition-colors"
                            data-testid={`voice-transcribe-${recordingId}`}
                        >
                            {transcribing ? (
                                <>
                                    <Loader2 size={10} className="animate-spin" />
                                    {progressMsg || "Transcription…"}
                                </>
                            ) : (
                                <>
                                    <Type size={10} strokeWidth={2} />
                                    {alreadyText ? "Retranscrire" : "Transcrire"}
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
            {confirmDialog}
        </>
    );
}
