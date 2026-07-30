/**
 * Helpers post-transcription : champs sûrs auto, RDV seulement sur confirmation.
 */

import { parseNote, detectAppointment, diffWithLead } from "@/lib/noteParser";
import { makeRdvNextAction } from "@/lib/nextActionUtils";
import { toLocalDateKey } from "@/lib/dateUtils";
import { allocateMainDupeLabels } from "@/lib/customFields";
import { resolvePipelineColumnId } from "@/lib/pipelineRoles";
import { toast } from "sonner";

/**
 * Remplit téléphone / email / contact vides + extras en customFields.
 * Ne planifie PAS de RDV (voir offerDetectedAppointment).
 * @returns {{ appointment: object|null, diff: object|null }}
 */
export function applySafeTranscriptFields(dispatch, { workspaceId, leadId, lead, text, isJobs = false }) {
    if (!text?.trim() || !lead) return { appointment: null, diff: null };

    const detected = parseNote(text);
    const diff = diffWithLead(detected, lead);
    const patch = {};
    if (diff.newPhone) patch.phone = diff.newPhone;
    if (diff.newEmail) patch.email = diff.newEmail;
    if (diff.newContact) patch.contact = diff.newContact;

    if (Object.keys(patch).length) {
        dispatch({ type: "UPDATE_LEAD", workspaceId, leadId, patch });
    }

    const phoneLabels = allocateMainDupeLabels(
        lead.customFields,
        "Téléphone",
        (diff.extraPhones || []).length
    );
    (diff.extraPhones || []).forEach((phone, i) => {
        dispatch({
            type: "ADD_CUSTOM_FIELD",
            workspaceId,
            leadId,
            label: phoneLabels[i] || `Téléphone ${i + 2}`,
            value: phone,
            pinned: false,
            isMainDuplicate: true,
        });
    });

    const emailLabels = allocateMainDupeLabels(
        lead.customFields,
        "Email",
        (diff.extraEmails || []).length
    );
    (diff.extraEmails || []).forEach((email, i) => {
        dispatch({
            type: "ADD_CUSTOM_FIELD",
            workspaceId,
            leadId,
            label: emailLabels[i] || `Email ${i + 2}`,
            value: email,
            pinned: false,
            isMainDuplicate: true,
        });
    });

    const contactBase = isJobs ? "Contact RH" : "Contact";
    const contactLabels = allocateMainDupeLabels(
        lead.customFields,
        contactBase,
        (diff.extraContacts || []).length
    );
    (diff.extraContacts || []).forEach((person, i) => {
        dispatch({
            type: "ADD_CUSTOM_FIELD",
            workspaceId,
            leadId,
            label: contactLabels[i] || `${contactBase} ${i + 2}`,
            value: person,
            pinned: false,
            highlight: true,
            isMainDuplicate: true,
        });
    });

    if (diff.newAddress) {
        dispatch({
            type: "ADD_CUSTOM_FIELD",
            workspaceId,
            leadId,
            label: "Adresse",
            value: diff.newAddress,
            pinned: false,
        });
    }

    const appointment = detectAppointment(text);
    return { appointment, diff };
}

/**
 * Propose un RDV détecté sans l'écrire tout de suite (évite faux positifs Whisper).
 * Sur confirm « Planifier » : nextAction + déplacement vers colonne Rendez-vous
 * (même logique que CallNoteModal).
 */
export function offerDetectedAppointment(dispatch, { workspaceId, leadId, appointment, workspace }) {
    if (!appointment?.iso) return;

    toast.message(`Date détectée · ${appointment.label}`, {
        description: "Appliquer au calendrier ?",
        duration: 10000,
        action: {
            label: "Planifier",
            onClick: () => {
                dispatch({
                    type: "UPDATE_LEAD",
                    workspaceId,
                    leadId,
                    patch: {
                        nextAction: makeRdvNextAction({
                            date: toLocalDateKey(appointment.iso),
                            dueAt: appointment.iso,
                            label: appointment.label,
                        }),
                        autoFollowup: null,
                    },
                });

                const ws = workspace;
                const meetingColumnId = ws ? resolvePipelineColumnId(ws, "rdv") : null;
                const lead = ws?.leads?.[leadId];
                if (meetingColumnId && lead && lead.columnId !== meetingColumnId) {
                    dispatch({
                        type: "MOVE_LEAD_ORDERED",
                        workspaceId,
                        leadId,
                        toColumnId: meetingColumnId,
                        toIndex: null,
                    });
                }

                toast.success("RDV planifié", { description: appointment.label });
            },
        },
    });
}
