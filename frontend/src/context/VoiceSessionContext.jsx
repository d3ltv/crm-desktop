import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { formatDuration, pickAudioMimeType, saveCallRecording, deleteCallRecording } from "@/lib/callRecordings";
import { openProcessedMic, createCallRecorder } from "@/lib/audioCapture";
import { startPeakSampler } from "@/components/AudioWaveform";
import { VoiceFloatingDock } from "@/components/VoiceFloatingDock";
import { TranscribeProgressPill } from "@/components/TranscribeProgressPill";
import { AttachCallLeadDialog } from "@/components/AttachCallLeadDialog";
import { openLeadFromCalendar } from "@/lib/calendarEvents";
import { applySafeTranscriptFields, offerDetectedAppointment } from "@/lib/transcriptSideEffects";
import { transcribeAudioBlob, transcribeMono16k, isTranscribeSupported, warmupWhisper, lastSpeakerFromTranscript } from "@/lib/transcribeLocal";
import { holdAlive, releaseHold } from "@/lib/whisperGovernor";
import { createLivePcmBuffer } from "@/lib/livePcmCapture";
import {
    RELIA_EVENTS,
    isTypingTarget,
} from "@/lib/reliaShortcuts";
import { useCrm } from "@/context/CrmContext";
import { toast } from "sonner";

const VoiceSessionContext = createContext(null);

/** Pré-transcription par tranches pour les appels longs (charge CPU étalée). */
const PRE_TRANSCRIBE_CHUNK_MS = 10 * 60 * 1000;
const PRE_TRANSCRIBE_POLL_MS = 20_000;

function makeNoteId() {
    return `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function VoiceSessionProvider({ children }) {
    const { state, dispatch } = useCrm();

    const [status, setStatus] = useState("idle"); // idle | recording | ready
    const [elapsedMs, setElapsedMs] = useState(0);
    const [liveStream, setLiveStream] = useState(null);
    const [pending, setPending] = useState(null);
    const [target, setTarget] = useState(null);
    const [saving, setSaving] = useState(false);
    const [busyLabel, setBusyLabel] = useState("");
    const [attachOpen, setAttachOpen] = useState(false);
    /** @type {[{ percent: number, label: string, detail: string }|null, Function]} */
    const [transcribeJob, setTranscribeJob] = useState(null);
    const transcribeJobGenRef = useRef(0);

    const mediaRecorderRef = useRef(null);
    const captureCleanupRef = useRef(null);
    const chunksRef = useRef([]);
    const startedAtRef = useRef(0);
    const timerRef = useRef(null);
    const mimeRef = useRef("");
    const peakSamplerRef = useRef(null);
    /** Incrémenté pour annuler l'auto-save si discard avant le délai. */
    const autoSaveGenRef = useRef(0);
    const statusRef = useRef(status);
    const targetRef = useRef(target);
    const pcmBufferRef = useRef(null);
    const partialTranscriptsRef = useRef([]);
    const preTranscribeBusyRef = useRef(false);
    const preTranscribeTimerRef = useRef(null);
    statusRef.current = status;
    targetRef.current = target;

    const stopPcmCapture = useCallback(() => {
        if (preTranscribeTimerRef.current) {
            clearInterval(preTranscribeTimerRef.current);
            preTranscribeTimerRef.current = null;
        }
        try {
            pcmBufferRef.current?.stop?.();
        } catch { /* ignore */ }
        pcmBufferRef.current = null;
        partialTranscriptsRef.current = [];
        preTranscribeBusyRef.current = false;
    }, []);

    const runPreTranscribeChunk = useCallback(async () => {
        if (preTranscribeBusyRef.current) return;
        if (statusRef.current !== "recording") return;
        if (!isTranscribeSupported()) return;
        const pcm = pcmBufferRef.current;
        if (!pcm) return;

        const chunk = await pcm.takeNextChunkMs(PRE_TRANSCRIBE_CHUNK_MS);
        if (!chunk?.length) return;

        preTranscribeBusyRef.current = true;
        setBusyLabel("Pré-transcription…");
        try {
            // Laisse respirer le thread UI avant Whisper
            await new Promise((r) => setTimeout(r, 80));
            const text = await transcribeMono16k(chunk, {
                onProgress: (p) => {
                    if (p?.message) setBusyLabel(p.message);
                },
                startSpeaker: lastSpeakerFromTranscript(
                    partialTranscriptsRef.current[partialTranscriptsRef.current.length - 1] || ""
                ),
            });
            if (text && statusRef.current === "recording") {
                partialTranscriptsRef.current.push(text);
            }
        } catch (err) {
            console.warn("[VoiceSession] pre-transcribe failed:", err);
            // Remettre le chunk serait trop coûteux — le final retombera sur le blob si besoin
        } finally {
            preTranscribeBusyRef.current = false;
            if (statusRef.current === "recording") setBusyLabel("");
        }
    }, []);

    const cleanupStream = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        captureCleanupRef.current?.();
        captureCleanupRef.current = null;
        mediaRecorderRef.current = null;
        setLiveStream(null);
    }, []);

    useEffect(() => () => {
        peakSamplerRef.current?.stop?.();
        peakSamplerRef.current = null;
        stopPcmCapture();
        cleanupStream();
    }, [cleanupStream, stopPcmCapture]);

    // Empêche la fermeture / reload pendant un take non sauvé
    useEffect(() => {
        if (status !== "recording" && status !== "ready") return undefined;
        const onBeforeUnload = (e) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [status]);

    // Session vocale active → Whisper ne se met pas au repos (RAM gardée chaude)
    useEffect(() => {
        if (status !== "recording" && status !== "ready") return undefined;
        holdAlive("voice-session");
        return () => releaseHold("voice-session");
    }, [status]);

    const reset = useCallback(() => {
        peakSamplerRef.current?.stop?.();
        peakSamplerRef.current = null;
        stopPcmCapture();
        cleanupStream();
        chunksRef.current = [];
        setPending(null);
        setElapsedMs(0);
        setStatus("idle");
        setBusyLabel("");
        setSaving(false);
        setTarget(null);
        setAttachOpen(false);
    }, [cleanupStream, stopPcmCapture]);

    const discard = useCallback(() => {
        autoSaveGenRef.current += 1;
        const wasFree = !!targetRef.current?.free;
        reset();
        if (wasFree) {
            toast.message("Appel supprimé", {
                description: "Aucun prospect rattaché.",
                duration: 2400,
            });
        }
    }, [reset]);

    const start = useCallback(async ({ workspaceId, leadId, leadLabel, free = false } = {}) => {
        if (status === "recording" || saving) return;
        if (status === "ready") {
            if (target?.free && !target?.leadId) {
                setAttachOpen(true);
                return;
            }
            toast.message("Appel en attente", {
                description: "Transcription en cours — patientez ou jetez le take.",
            });
            return;
        }
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            toast.error("Micro non disponible");
            return;
        }

        const wsId = workspaceId || state.currentId;
        if (!wsId) {
            toast.error("Ouvrez un espace d’abord");
            return;
        }
        if (!free && !leadId) {
            toast.error("Prospect manquant");
            return;
        }

        try {
            setPending(null);
            setAttachOpen(false);
            setTarget({
                workspaceId: wsId,
                leadId: free ? null : leadId,
                leadLabel: free
                    ? "Appel en cours"
                    : (leadLabel || "Prospect"),
                free: !!free,
            });
            const mimeType = pickAudioMimeType();
            mimeRef.current = mimeType;
            const { stream, cleanup } = await openProcessedMic();
            captureCleanupRef.current = cleanup;
            setLiveStream(stream);
            chunksRef.current = [];
            peakSamplerRef.current = startPeakSampler(stream, 48);

            // Capture PCM pour pré-transcription des appels longs
            try {
                stopPcmCapture();
                pcmBufferRef.current = createLivePcmBuffer(stream);
                partialTranscriptsRef.current = [];
                if (isTranscribeSupported()) {
                    preTranscribeTimerRef.current = setInterval(() => {
                        void runPreTranscribeChunk();
                    }, PRE_TRANSCRIBE_POLL_MS);
                }
            } catch (pcmErr) {
                console.warn("[VoiceSession] pcm capture unavailable:", pcmErr);
            }

            const recorder = createCallRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data?.size) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                if (preTranscribeTimerRef.current) {
                    clearInterval(preTranscribeTimerRef.current);
                    preTranscribeTimerRef.current = null;
                }
                const sampled = peakSamplerRef.current?.stop?.() || [];
                peakSamplerRef.current = null;
                const durationMs = Math.max(0, Date.now() - startedAtRef.current);
                cleanupStream();
                const blob = new Blob(chunksRef.current, {
                    type: mimeRef.current || chunksRef.current[0]?.type || "audio/webm",
                });
                chunksRef.current = [];
                if (!blob.size) {
                    stopPcmCapture();
                    setStatus("idle");
                    setTarget(null);
                    setAttachOpen(false);
                    return;
                }
                setElapsedMs(durationMs);
                setPending({
                    blob,
                    mimeType: blob.type || mimeRef.current || "audio/webm",
                    durationMs,
                    peaks: sampled,
                });
                setStatus("ready");
                // Appel libre : obliger le rattachement
                setTarget((prev) => {
                    if (prev?.free && !prev?.leadId) {
                        window.setTimeout(() => setAttachOpen(true), 60);
                    }
                    return prev;
                });
            };

            startedAtRef.current = Date.now();
            setElapsedMs(0);
            setStatus("recording");
            // Préchauffe le modèle pendant l'appel : transcription instantanée au stop
            void warmupWhisper();
            // Sans timeslice : conteneur WebM/MP4 plus fiable pour decodeAudioData / Whisper
            recorder.start();
            timerRef.current = setInterval(() => {
                setElapsedMs(Date.now() - startedAtRef.current);
            }, 200);
        } catch (err) {
            peakSamplerRef.current?.stop?.();
            peakSamplerRef.current = null;
            stopPcmCapture();
            cleanupStream();
            setStatus("idle");
            setTarget(null);
            setAttachOpen(false);
            toast.error(
                err?.name === "NotAllowedError"
                    ? "Micro refusé — autorisez-le dans Réglages système"
                    : "Impossible de démarrer le micro"
            );
        }
    }, [status, saving, cleanupStream, state.currentId, target?.free, target?.leadId, stopPcmCapture, runPreTranscribeChunk]);

    const stop = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === "inactive") {
            peakSamplerRef.current?.stop?.();
            peakSamplerRef.current = null;
            cleanupStream();
            setStatus("idle");
            setTarget(null);
            setAttachOpen(false);
            return;
        }
        recorder.stop();
    }, [cleanupStream]);

    const applyTranscriptToLead = useCallback((workspaceId, leadId, noteId, transcript) => {
        if (!transcript) return;
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
        const ws = state.workspaces?.[workspaceId];
        const lead = ws?.leads?.[leadId];
        if (!lead) return;
        const side = applySafeTranscriptFields(dispatch, {
            workspaceId,
            leadId,
            lead: { ...lead, notes: [{ id: noteId, transcript, text: "📞 Joint · Note d'appel" }, ...(lead.notes || [])] },
            text: transcript,
            isJobs: ws?.template === "jobs",
        });
        if (side?.appointment) {
            offerDetectedAppointment(dispatch, {
                workspaceId,
                leadId,
                appointment: side.appointment,
                workspace: ws,
            });
        }
    }, [dispatch, state.workspaces]);

    /**
     * Transcription hors UI bloquante — pastille de progression + CRM libre.
     */
    const runBackgroundTranscribe = useCallback(async ({
        blob = null,
        pcmSlices = null,
        workspaceId,
        leadId,
        noteId,
        leadLabel = "Prospect",
    }) => {
        if (!workspaceId || !leadId || !noteId) return;
        if (!isTranscribeSupported()) return;
        if (!blob && !(pcmSlices?.length)) return;

        const gen = ++transcribeJobGenRef.current;
        setTranscribeJob({
            percent: 1,
            label: "Transcription",
            detail: leadLabel,
        });

        const onProgress = (p) => {
            if (transcribeJobGenRef.current !== gen) return;
            const pct = typeof p?.progress === "number" ? p.progress : null;
            setTranscribeJob((prev) => ({
                percent: pct != null ? pct : (prev?.percent || 2),
                label: p?.message || "Transcription",
                detail: leadLabel,
            }));
        };

        try {
            let transcript = "";
            if (pcmSlices?.length) {
                const parts = [];
                let speaker = 1;
                for (let i = 0; i < pcmSlices.length; i += 1) {
                    if (transcribeJobGenRef.current !== gen) return;
                    const slice = pcmSlices[i];
                    if (!slice) continue;
                    onProgress({
                        message: pcmSlices.length > 1
                            ? `Transcription ${i + 1}/${pcmSlices.length}…`
                            : "Transcription…",
                        progress: Math.round((i / Math.max(1, pcmSlices.length)) * 100),
                    });
                    const text = await transcribeMono16k(slice, {
                        onProgress,
                        startSpeaker: speaker,
                    });
                    if (text) {
                        parts.push(text);
                        speaker = lastSpeakerFromTranscript(text);
                    }
                }
                transcript = parts.filter(Boolean).join("\n\n").trim();
            } else if (blob) {
                transcript = await transcribeAudioBlob(blob, { onProgress });
            }

            if (transcribeJobGenRef.current !== gen) return;

            if (transcript) {
                applyTranscriptToLead(workspaceId, leadId, noteId, transcript);
                toast.success("Appel transcrit", {
                    description: leadLabel,
                });
            } else {
                toast.message("Transcription vide", {
                    description: "Audio sauvegardé sans texte.",
                });
            }
        } catch (err) {
            console.warn("[VoiceSession] background transcribe failed:", err);
            if (transcribeJobGenRef.current === gen) {
                toast.error("Transcription impossible", {
                    description: "L'audio est quand même enregistré.",
                });
            }
        } finally {
            if (transcribeJobGenRef.current === gen) {
                setTranscribeJob({ percent: 100, label: "Terminé", detail: leadLabel });
                window.setTimeout(() => {
                    if (transcribeJobGenRef.current === gen) setTranscribeJob(null);
                }, 480);
            }
        }
    }, [applyTranscriptToLead]);

    const save = useCallback(async ({
        transcribe = false,
        leadId: leadIdOverride,
        leadLabel: leadLabelOverride,
        workspaceId: workspaceIdOverride,
    } = {}) => {
        if (!pending?.blob || saving) return;

        const workspaceId = workspaceIdOverride || target?.workspaceId;
        const leadId = leadIdOverride || target?.leadId;
        if (!workspaceId || !leadId) {
            setAttachOpen(true);
            return;
        }

        const leadLabel = leadLabelOverride
            || target?.leadLabel
            || state.workspaces?.[workspaceId]?.leads?.[leadId]?.company
            || "Prospect";

        setTarget({
            workspaceId,
            leadId,
            leadLabel,
            free: false,
        });
        setAttachOpen(false);
        setSaving(true);

        let recordingId = null;
        try {
            recordingId = `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            await saveCallRecording({
                id: recordingId,
                leadId,
                workspaceId,
                blob: pending.blob,
                mimeType: pending.mimeType,
                durationMs: pending.durationMs,
                peaks: pending.peaks,
            });
        } catch (err) {
            console.warn("[VoiceSession] save failed:", err);
            toast.error("Audio non sauvegardé");
            autoSaveGenRef.current += 1;
            if (recordingId) deleteCallRecording(recordingId).catch(() => {});
            setSaving(false);
            setBusyLabel("");
            setStatus("idle");
            setPending(null);
            setTarget(null);
            return;
        }

        // Snapshot pour transcription arrière-plan (avant reset / stop PCM)
        const blobSnapshot = pending.blob;
        const partials = [...partialTranscriptsRef.current];
        let remPcm = null;
        const pcm = pcmBufferRef.current;
        if (pcm) {
            try {
                let wait = 0;
                while (preTranscribeBusyRef.current && wait < 8_000) {
                    await new Promise((r) => setTimeout(r, 100));
                    wait += 100;
                }
                remPcm = await pcm.takeRemaining();
            } catch { /* ignore */ }
        }
        stopPcmCapture();

        const noteId = makeNoteId();
        const now = new Date().toISOString();
        dispatch({
            type: "ADD_NOTE",
            id: noteId,
            workspaceId,
            leadId,
            text: "📞 Joint · Note d'appel",
            recordingId,
        });
        dispatch({
            type: "UPDATE_LEAD",
            workspaceId,
            leadId,
            patch: { lastContact: now },
        });

        toast.success(
            transcribe && isTranscribeSupported()
                ? "Appel enregistré — transcription en cours"
                : "Appel enregistré"
        );
        openLeadFromCalendar(dispatch, workspaceId, leadId);

        // Libère le CRM immédiatement
        setSaving(false);
        setBusyLabel("");
        reset();

        if (transcribe && isTranscribeSupported()) {
            void (async () => {
                const gen = ++transcribeJobGenRef.current;
                setTranscribeJob({
                    percent: 1,
                    label: "Transcription",
                    detail: leadLabel,
                });
                const onProgress = (p) => {
                    if (transcribeJobGenRef.current !== gen) return;
                    setTranscribeJob({
                        percent: typeof p?.progress === "number" ? p.progress : 2,
                        label: p?.message || "Transcription",
                        detail: leadLabel,
                    });
                };
                try {
                    let transcript = "";
                    if (partials.length || remPcm?.length) {
                        let tailText = "";
                        if (remPcm?.length) {
                            tailText = await transcribeMono16k(remPcm, {
                                onProgress,
                                startSpeaker: lastSpeakerFromTranscript(
                                    partials[partials.length - 1] || ""
                                ),
                            });
                        }
                        transcript = [...partials, tailText].filter(Boolean).join("\n\n").trim();
                    }
                    if (!transcript && blobSnapshot) {
                        transcript = await transcribeAudioBlob(blobSnapshot, { onProgress });
                    }
                    if (transcribeJobGenRef.current !== gen) return;
                    if (transcript) {
                        applyTranscriptToLead(workspaceId, leadId, noteId, transcript);
                        toast.success("Appel transcrit", { description: leadLabel });
                    } else {
                        toast.message("Transcription vide", {
                            description: "Audio sauvegardé sans texte.",
                        });
                    }
                } catch (err) {
                    console.warn("[VoiceSession] bg transcribe:", err);
                    if (transcribeJobGenRef.current === gen) {
                        toast.error("Transcription impossible", {
                            description: "L'audio est quand même enregistré.",
                        });
                    }
                } finally {
                    if (transcribeJobGenRef.current === gen) {
                        setTranscribeJob({ percent: 100, label: "Terminé", detail: leadLabel });
                        window.setTimeout(() => {
                            if (transcribeJobGenRef.current === gen) setTranscribeJob(null);
                        }, 480);
                    }
                }
            })();
        }
    }, [
        pending, target, saving, dispatch, state.workspaces, reset, stopPcmCapture,
        applyTranscriptToLead,
    ]);

    // Stop → transcription + sauve auto — uniquement si un lead est déjà connu
    useEffect(() => {
        if (status !== "ready" || !pending?.blob || !target || saving) return undefined;
        if (target.free && !target.leadId) return undefined;
        if (!target.leadId) return undefined;
        const gen = autoSaveGenRef.current;
        const t = window.setTimeout(() => {
            if (autoSaveGenRef.current !== gen) return;
            save({ transcribe: isTranscribeSupported() });
        }, 120);
        return () => window.clearTimeout(t);
    }, [status, pending, target, saving, save]);

    const openTarget = useCallback(() => {
        if (!target) return;
        if (target.free && !target.leadId) {
            setAttachOpen(true);
            return;
        }
        if (target.leadId) {
            openLeadFromCalendar(dispatch, target.workspaceId, target.leadId);
        }
    }, [target, dispatch]);

    const isActiveFor = useCallback((leadId) => (
        !!target && target.leadId === leadId && (status === "recording" || status === "ready")
    ), [target, status]);

    const needsAttach = !!(
        status === "ready"
        && pending
        && target?.free
        && !target?.leadId
        && !saving
    );

    // Appel libre — déclenché par le hub raccourcis (⌥A / ⌘⇧A)
    useEffect(() => {
        const onToggle = () => {
            if (isTypingTarget()) return;
            const st = statusRef.current;
            const tg = targetRef.current;
            if (st === "recording") {
                stop();
                return;
            }
            if (st === "ready" && tg?.free && !tg?.leadId) {
                setAttachOpen(true);
                return;
            }
            if (st === "idle") {
                void start({ free: true, workspaceId: state.currentId });
            }
        };
        window.addEventListener(RELIA_EVENTS.TOGGLE_FREE_CALL, onToggle);
        return () => window.removeEventListener(RELIA_EVENTS.TOGGLE_FREE_CALL, onToggle);
    }, [start, stop, state.currentId]);

    const value = useMemo(() => ({
        status,
        elapsedMs,
        liveStream,
        pending,
        target,
        saving,
        busyLabel,
        needsAttach,
        transcribeJob,
        start,
        stop,
        discard,
        save,
        openTarget,
        isActiveFor,
        runBackgroundTranscribe,
        formatDuration,
    }), [
        status, elapsedMs, liveStream, pending, target, saving, busyLabel, needsAttach,
        transcribeJob, start, stop, discard, save, openTarget, isActiveFor, runBackgroundTranscribe,
    ]);

    const dockOpen = status === "recording" || status === "ready";
    const attachWorkspace = target?.workspaceId
        ? state.workspaces?.[target.workspaceId]
        : state.workspaces?.[state.currentId];

    return (
        <VoiceSessionContext.Provider value={value}>
            {children}
            <TranscribeProgressPill
                open={!!transcribeJob}
                percent={transcribeJob?.percent || 0}
                label={transcribeJob?.label || "Transcription"}
                detail={transcribeJob?.detail || ""}
            />
            <VoiceFloatingDock
                open={dockOpen && !attachOpen}
                mode={status === "ready" ? "ready" : "recording"}
                elapsedMs={elapsedMs || pending?.durationMs || 0}
                liveStream={liveStream}
                label={
                    needsAttach
                        ? "Choisir un prospect…"
                        : (target?.leadLabel || "Appel")
                }
                saving={saving}
                busyLabel={busyLabel}
                needsAttach={needsAttach}
                onStop={stop}
                onDiscard={discard}
                onOpenLead={openTarget}
                onAttachPrompt={() => setAttachOpen(true)}
            />
            <AttachCallLeadDialog
                open={attachOpen && needsAttach}
                onOpenChange={(v) => {
                    if (v) return;
                    if (saving) return;
                    if (!needsAttach) return;
                    discard();
                }}
                workspace={attachWorkspace}
                durationMs={pending?.durationMs || elapsedMs || 0}
                saving={saving}
                onAttach={({ leadId, leadLabel }) => {
                    save({
                        transcribe: isTranscribeSupported(),
                        leadId,
                        leadLabel,
                        workspaceId: target?.workspaceId || state.currentId,
                    });
                }}
                onDiscard={discard}
            />
        </VoiceSessionContext.Provider>
    );
}

export function useVoiceSession() {
    const ctx = useContext(VoiceSessionContext);
    if (!ctx) throw new Error("useVoiceSession must be used within VoiceSessionProvider");
    return ctx;
}
