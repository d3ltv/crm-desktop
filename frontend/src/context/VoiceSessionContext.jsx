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
import { openLeadFromCalendar } from "@/lib/calendarEvents";
import { applySafeTranscriptFields, offerDetectedAppointment } from "@/lib/transcriptSideEffects";
import { transcribeAudioBlob, isTranscribeSupported } from "@/lib/transcribeLocal";
import { useCrm } from "@/context/CrmContext";
import { toast } from "sonner";

const VoiceSessionContext = createContext(null);

export function VoiceSessionProvider({ children }) {
    const { state, dispatch } = useCrm();

    const [status, setStatus] = useState("idle"); // idle | recording | ready
    const [elapsedMs, setElapsedMs] = useState(0);
    const [liveStream, setLiveStream] = useState(null);
    const [pending, setPending] = useState(null);
    const [target, setTarget] = useState(null);
    const [saving, setSaving] = useState(false);
    const [busyLabel, setBusyLabel] = useState("");

    const mediaRecorderRef = useRef(null);
    const captureCleanupRef = useRef(null);
    const chunksRef = useRef([]);
    const startedAtRef = useRef(0);
    const timerRef = useRef(null);
    const mimeRef = useRef("");
    const peakSamplerRef = useRef(null);
    /** Incrémenté pour annuler l'auto-save si discard avant le délai. */
    const autoSaveGenRef = useRef(0);

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
        cleanupStream();
    }, [cleanupStream]);

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

    const reset = useCallback(() => {
        peakSamplerRef.current?.stop?.();
        peakSamplerRef.current = null;
        cleanupStream();
        chunksRef.current = [];
        setPending(null);
        setElapsedMs(0);
        setStatus("idle");
        setBusyLabel("");
        setSaving(false);
        setTarget(null);
    }, [cleanupStream]);

    const discard = useCallback(() => {
        autoSaveGenRef.current += 1;
        reset();
    }, [reset]);

    const start = useCallback(async ({ workspaceId, leadId, leadLabel }) => {
        if (status === "recording" || saving) return;
        if (status === "ready") {
            toast.message("Appel en attente", {
                description: "Transcription en cours — patientez ou jetez le take.",
            });
            return;
        }
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            toast.error("Micro non disponible");
            return;
        }
        try {
            setPending(null);
            setTarget({
                workspaceId,
                leadId,
                leadLabel: leadLabel || "Prospect",
            });
            const mimeType = pickAudioMimeType();
            mimeRef.current = mimeType;
            const { stream, cleanup } = await openProcessedMic();
            captureCleanupRef.current = cleanup;
            setLiveStream(stream);
            chunksRef.current = [];
            peakSamplerRef.current = startPeakSampler(stream, 48);

            const recorder = createCallRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data?.size) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                const sampled = peakSamplerRef.current?.stop?.() || [];
                peakSamplerRef.current = null;
                const durationMs = Math.max(0, Date.now() - startedAtRef.current);
                cleanupStream();
                const blob = new Blob(chunksRef.current, {
                    type: mimeRef.current || chunksRef.current[0]?.type || "audio/webm",
                });
                chunksRef.current = [];
                if (!blob.size) {
                    setStatus("idle");
                    setTarget(null);
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
            };

            startedAtRef.current = Date.now();
            setElapsedMs(0);
            setStatus("recording");
            // Sans timeslice : conteneur WebM/MP4 plus fiable pour decodeAudioData / Whisper
            recorder.start();
            timerRef.current = setInterval(() => {
                setElapsedMs(Date.now() - startedAtRef.current);
            }, 200);
        } catch (err) {
            peakSamplerRef.current?.stop?.();
            peakSamplerRef.current = null;
            cleanupStream();
            setStatus("idle");
            setTarget(null);
            toast.error(
                err?.name === "NotAllowedError"
                    ? "Micro refusé — autorisez-le dans Réglages système"
                    : "Impossible de démarrer le micro"
            );
        }
    }, [status, saving, cleanupStream]);

    const stop = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === "inactive") {
            peakSamplerRef.current?.stop?.();
            peakSamplerRef.current = null;
            cleanupStream();
            setStatus("idle");
            setTarget(null);
            return;
        }
        recorder.stop();
    }, [cleanupStream]);

    const save = useCallback(async ({ transcribe = false } = {}) => {
        if (!pending?.blob || !target || saving) return;
        setSaving(true);
        let recordingId = null;
        try {
            recordingId = `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            await saveCallRecording({
                id: recordingId,
                leadId: target.leadId,
                workspaceId: target.workspaceId,
                blob: pending.blob,
                mimeType: pending.mimeType,
                durationMs: pending.durationMs,
                peaks: pending.peaks,
            });
        } catch (err) {
            console.warn("[VoiceSession] save failed:", err);
            toast.error("Audio non sauvegardé");
            // Empêche la boucle auto-save (status resterait "ready")
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
                const transcript = await transcribeAudioBlob(pending.blob, {
                    onProgress: (p) => {
                        if (p?.message) setBusyLabel(p.message);
                    },
                });
                if (transcript) {
                    transcriptText = transcript;
                    const lead = state.workspaces?.[target.workspaceId]?.leads?.[target.leadId];
                    const ws = state.workspaces?.[target.workspaceId];
                    const side = applySafeTranscriptFields(dispatch, {
                        workspaceId: target.workspaceId,
                        leadId: target.leadId,
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
        }

        // Note + lastContact — sans LOG_CONTACT (pas de move forcé vers Contacté)
        // Le transcript vit dans note.transcript (affiché sous le vocal), pas dans Notes.
        const now = new Date().toISOString();
        dispatch({
            type: "ADD_NOTE",
            workspaceId: target.workspaceId,
            leadId: target.leadId,
            text: noteText,
            recordingId,
            ...(transcriptText ? { transcript: transcriptText } : {}),
        });
        dispatch({
            type: "UPDATE_LEAD",
            workspaceId: target.workspaceId,
            leadId: target.leadId,
            patch: { lastContact: now },
        });

        if (appointment) {
            offerDetectedAppointment(dispatch, {
                workspaceId: target.workspaceId,
                leadId: target.leadId,
                appointment,
            });
        } else if (transcribe && transcriptText) {
            toast.success("Appel transcrit et enregistré");
        } else {
            toast.success("Appel enregistré");
        }

        setSaving(false);
        setBusyLabel("");
        reset();
    }, [pending, target, saving, dispatch, state.workspaces, reset]);

    // T3 — Stop → transcription + sauve auto (sans clic supplémentaire)
    useEffect(() => {
        if (status !== "ready" || !pending?.blob || !target || saving) return undefined;
        const gen = autoSaveGenRef.current;
        const t = window.setTimeout(() => {
            if (autoSaveGenRef.current !== gen) return;
            save({ transcribe: isTranscribeSupported() });
        }, 120);
        return () => window.clearTimeout(t);
    }, [status, pending, target, saving, save]);

    const openTarget = useCallback(() => {
        if (!target) return;
        openLeadFromCalendar(dispatch, target.workspaceId, target.leadId);
    }, [target, dispatch]);

    const isActiveFor = useCallback((leadId) => (
        !!target && target.leadId === leadId && (status === "recording" || status === "ready")
    ), [target, status]);

    const value = useMemo(() => ({
        status,
        elapsedMs,
        liveStream,
        pending,
        target,
        saving,
        busyLabel,
        start,
        stop,
        discard,
        save,
        openTarget,
        isActiveFor,
        formatDuration,
    }), [
        status, elapsedMs, liveStream, pending, target, saving, busyLabel,
        start, stop, discard, save, openTarget, isActiveFor,
    ]);

    const dockOpen = status === "recording" || status === "ready";

    return (
        <VoiceSessionContext.Provider value={value}>
            {children}
            <VoiceFloatingDock
                open={dockOpen}
                mode={status === "ready" ? "ready" : "recording"}
                elapsedMs={elapsedMs || pending?.durationMs || 0}
                liveStream={liveStream}
                label={target?.leadLabel || "Appel"}
                saving={saving}
                busyLabel={busyLabel}
                onStop={stop}
                onDiscard={discard}
                onOpenLead={openTarget}
            />
        </VoiceSessionContext.Provider>
    );
}

export function useVoiceSession() {
    const ctx = useContext(VoiceSessionContext);
    if (!ctx) throw new Error("useVoiceSession must be used within VoiceSessionProvider");
    return ctx;
}
