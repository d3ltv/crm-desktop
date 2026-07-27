/**
 * Planification calendrier + avance Kanban (Nouveau → Contacté → Relance → RDV…).
 */

import { isManualRdv } from "@/lib/nextActionUtils";
import {
    isEarlyPipelineColumn,
    isWonColumn,
    isLostColumn,
    isPropositionColumn,
    isMeetingColumn,
} from "@/constants/columnPatterns";
import { resolvePipelineColumnId } from "@/lib/pipelineRoles";

/**
 * Enregistre nextAction et avance le lead dans la bonne colonne si pertinent.
 * @returns {{ moved: boolean, toColumnId: string|null, toColumnName: string|null }}
 */
export function scheduleLeadNextAction(dispatch, {
    workspace,
    leadId,
    nextAction,
    move = true,
}) {
    if (!workspace || !leadId) return { moved: false, toColumnId: null, toColumnName: null };

    dispatch({
        type: "SET_NEXT_ACTION",
        workspaceId: workspace.id,
        leadId,
        nextAction,
    });

    if (!move || !nextAction) {
        return { moved: false, toColumnId: null, toColumnName: null };
    }

    const lead = workspace.leads?.[leadId];
    if (!lead) return { moved: false, toColumnId: null, toColumnName: null };

    const currentName = workspace.columns?.[lead.columnId]?.name || "";
    // Ne pas reculer un lead déjà en proposition / gagné / perdu
    if (isWonColumn(currentName) || isLostColumn(currentName) || isPropositionColumn(currentName)) {
        return { moved: false, toColumnId: null, toColumnName: null };
    }
    if (!isEarlyPipelineColumn(currentName) && !isMeetingColumn(currentName)) {
        return { moved: false, toColumnId: null, toColumnName: null };
    }

    const targetId = isManualRdv(nextAction)
        ? resolvePipelineColumnId(workspace, "rdv")
        : resolvePipelineColumnId(workspace, "relance");

    if (!targetId || targetId === lead.columnId) {
        return { moved: false, toColumnId: null, toColumnName: null };
    }

    // Si on planifie un rappel et qu'on est déjà en RDV, ne pas rétrograder
    if (!isManualRdv(nextAction) && isMeetingColumn(currentName)) {
        return { moved: false, toColumnId: null, toColumnName: null };
    }

    dispatch({
        type: "MOVE_LEAD",
        workspaceId: workspace.id,
        leadId,
        toColumnId: targetId,
    });

    return {
        moved: true,
        toColumnId: targetId,
        toColumnName: workspace.columns[targetId]?.name || null,
    };
}

/** Efface nextAction (+ auto-followup si lié). */
export function clearLeadSchedule(dispatch, { workspaceId, leadId, dismissFollowup = true }) {
    dispatch({
        type: "SET_NEXT_ACTION",
        workspaceId,
        leadId,
        nextAction: null,
    });
    if (dismissFollowup) {
        dispatch({
            type: "DISMISS_FOLLOWUP",
            workspaceId,
            leadId,
        });
    }
}
