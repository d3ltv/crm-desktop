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
import { AttachCallLeadDialog } from "@/components/AttachCallLeadDialog";
import { openLeadFromCalendar } from "@/lib/calendarEvents";
import { applySafeTranscriptFields, offerDetectedAppointment } from "@/lib/transcriptSideEffects";
import { transcribeAudioBlob, transcribeMono16k, isTranscribeSupported, warmupWhisper } from "@/lib/transcribeLocal";
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

        // Fige le target avant save (appel libre → lead choisi)
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

        let noteText = "📞 Joint · Note d'appel";
        let transcriptText = "";
        let appointment = null;

        if (transcribe && isTranscribeSupported()) {
            try {
                setBusyLabel("Transcription…");
                const partials = [...partialTranscriptsRef.current];
                let transcript = "";

                // Suite de la pré-transcription : ne traiter que la fin restante
                const pcm = pcmBufferRef.current;
                if (pcm || partials.length > 0) {
                    let tailText = "";
                    if (pcm) {
                        // Attendre une pré-transcription en cours
                        let wait = 0;
                        while (preTranscribeBusyRef.current && wait < 120_000) {
                            await new Promise((r) => setTimeout(r, 200));
                            wait += 200;
                        }
                        const rem = await pcm.takeRemaining();
                        try { pcm.stop(); } catch { /* */ }
                        pcmBufferRef.current = null;
                        if (preTranscribeTimerRef.current) {
                            clearInterval(preTranscribeTimerRef.current);
                            preTranscribeTimerRef.current = null;
                        }
                        if (rem?.length) {
                            setBusyLabel(
                                partials.length
                                    ? "Fin de transcription…"
                                    : "Transcription…"
                            );
                            await new Promise((r) => setTimeout(r, 40));
                            tailText = await transcribeMono16k(rem, {
                                onProgress: (p) => {
                                    if (p?.message) setBusyLabel(p.message);
                                },
                            });
                        }
                    }
                    transcript = [...partials, tailText].filter(Boolean).join("\n\n").trim();
                }

                // Fallback : blob complet (appels courts / PCM indisponible)
                if (!transcript) {
                    transcript = await transcribeAudioBlob(pending.blob, {
                        onProgress: (p) => {
                            if (p?.message) setBusyLabel(p.message);
                        },
                    });
                }

                partialTranscriptsRef.current = [];

                if (transcript) {
                    transcriptText = transcript;
                    const lead = state.workspaces?.[workspaceId]?.leads?.[leadId];
                    const ws = state.workspaces?.[workspaceId];
                    const side = applySafeTranscriptFields(dispatch, {
                        workspaceId,
                        leadId,
                        lead,
                        text: transcript,
                        isJobs: ws?.template === "jobs",
                    });
                    appointment = side?.appointment || null;
                } else {
                    toast.message("Transcription vide", {
                        description: "Audio sauvegardé sans texte.",
                    });
                }
            } catch (err) {
                console.warn("[VoiceSession] transcribe failed:", err);
                toast.error("Transcription impossible", {
                    description: "L'audio est quand même enregistré.",
                });
            }
        } else {
            stopPcmCapture();
        }

        const now = new Date().toISOString();
        dispatch({
            type: "ADD_NOTE",
            workspaceId,
            leadId,
            text: noteText,
            recordingId,
            ...(transcriptText ? { transcript: transcriptText } : {}),
        });
        dispatch({
            type: "UPDATE_LEAD",
            workspaceId,
            leadId,
            patch: { lastContact: now },
        });

        if (appointment) {
            offerDetectedAppointment(dispatch, {
                workspaceId,
                leadId,
                appointment,
            });
        } else if (transcribe && transcriptText) {
            toast.success("Appel transcrit et enregistré");
        } else {
            toast.success("Appel enregistré");
        }

        openLeadFromCalendar(dispatch, workspaceId, leadId);

        setSaving(false);
        setBusyLabel("");
        reset();
    }, [pending, target, saving, dispatch, state.workspaces, reset, stopPcmCapture]);

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
        start,
        stop,
        discard,
        save,
        openTarget,
        isActiveFor,
        formatDuration,
    }), [
        status, elapsedMs, liveStream, pending, target, saving, busyLabel, needsAttach,
        start, stop, discard, save, openTarget, isActiveFor,
    ]);

    const dockOpen = status === "recording" || status === "ready";
    const attachWorkspace = target?.workspaceId
        ? state.workspaces?.[target.workspaceId]
        : state.workspaces?.[state.currentId];

    return (
        <VoiceSessionContext.Provider value={value}>
            {children}
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
