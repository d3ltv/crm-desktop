import React, { useMemo, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { useCrm } from "@/context/CrmContext";
import { useNotifSeenMap, useRecoDayTick } from "@/hooks/useNotifSeenMap";
import {
    getAllUnreadNotifs,
    markAllNotifsRead,
    markNotifItemRead,
} from "@/lib/followupNotifs";
import { PENDING_LEAD_EVENT } from "@/lib/calendarEvents";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Cloche globale — recommandations prospection (pas les dues calendrier).
 */
export function GlobalNotifBell() {
    const { state, dispatch } = useCrm();
    const seenMap = useNotifSeenMap();
    const recoDayTick = useRecoDayTick();
    const [open, setOpen] = useState(false);

    const workspaces = useMemo(
        () => state.order.map((id) => state.workspaces[id]).filter(Boolean),
        [state.order, state.workspaces]
    );

    const goalOpts = useMemo(
        () => ({ dailyGoal: state.settings?.dailyGoal || 20 }),
        [state.settings?.dailyGoal]
    );

    const unreadNotifs = useMemo(
        () => getAllUnreadNotifs(workspaces, seenMap, goalOpts),
        [workspaces, seenMap, goalOpts, recoDayTick]
    );

    const unreadTotal = unreadNotifs.length;
    const overdueCount = unreadNotifs.filter((f) => f.overdue).length;

    const openLead = (item) => {
        markNotifItemRead({ ...item, _usageOutcome: "open" });
        setOpen(false);
        if (!item.lead || !item.workspaceId) return;
        const { workspaceId, lead } = item;
        try {
            sessionStorage.setItem(
                "crm_pending_lead",
                JSON.stringify({ workspaceId, leadId: lead.id, t: Date.now() })
            );
        } catch { /* ignore */ }
        dispatch({ type: "SELECT_WORKSPACE", id: workspaceId });
        try {
            window.dispatchEvent(
                new CustomEvent(PENDING_LEAD_EVENT, {
                    detail: { workspaceId, leadId: lead.id },
                })
            );
        } catch { /* ignore */ }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="home-notifications-btn"
                    aria-label="Conseils de prospection"
                    className="relative w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
                >
                    <Bell size={16} />
                    {unreadTotal > 0 && (
                        <span
                            data-testid="home-notif-badge"
                            className={`absolute top-1 right-1 min-w-[15px] h-3.5 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center text-white ${overdueCount > 0 ? "bg-rose-500" : "bg-primary"}`}
                        >
                            {unreadTotal > 99 ? "99+" : unreadTotal}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-80 p-0 rounded-xl overflow-hidden shadow-panel bg-popover border border-border"
                data-testid="home-notif-popover"
            >
                <div className="px-4 py-3 border-b border-border/60 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="font-semibold tracking-tight text-sm">Conseils</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                            {unreadTotal === 0
                                ? "Rien d'urgent — RDV dans le calendrier"
                                : overdueCount > 0
                                  ? `${overdueCount} oubli${overdueCount > 1 ? "s" : ""} · ${unreadTotal} conseil${unreadTotal > 1 ? "s" : ""}`
                                  : `${unreadTotal} recommandation${unreadTotal > 1 ? "s" : ""}`}
                        </div>
                    </div>
                    {unreadTotal > 0 && (
                        <button
                            type="button"
                            onClick={() => markAllNotifsRead(workspaces)}
                            title="Tout lire (tous les espaces)"
                            aria-label="Tout lire les notifications"
                            data-testid="home-notif-mark-read-btn"
                            className="shrink-0 h-8 px-2.5 rounded-full flex items-center gap-1 text-[11px] font-medium transition-colors text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10"
                        >
                            <CheckCheck size={14} strokeWidth={2} />
                            Tout lire
                        </button>
                    )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {unreadNotifs.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            Aucun conseil. Les échéances restent dans le calendrier.
                        </div>
                    )}
                    {unreadNotifs.map((item) => {
                        const { lead, overdue, label, title, key, workspaceName } = item;
                        return (
                            <div
                                key={key}
                                className="border-b border-border/40 last:border-0 flex items-stretch hover:bg-secondary/70 transition-colors"
                            >
                                <button
                                    type="button"
                                    data-testid={`home-notif-item-${lead?.id || "tip"}`}
                                    onClick={() => openLead(item)}
                                    disabled={!lead}
                                    className="flex-1 min-w-0 text-left px-4 py-3 flex gap-3 disabled:cursor-default"
                                >
                                    <span
                                        className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${
                                            overdue ? "bg-rose-500" : "bg-primary"
                                        }`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium truncate">
                                            {lead?.company || title || "Conseil"}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground truncate">
                                            {workspaceName ? `${workspaceName} · ` : ""}
                                            {title && lead?.company ? `${title} · ` : ""}
                                            {label}
                                        </div>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    title="Marquer comme lu"
                                    aria-label="Marquer comme lu"
                                    data-testid={`home-notif-dismiss-${lead?.id || key}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        markNotifItemRead({ ...item, _usageOutcome: "dismiss" });
                                    }}
                                    className="shrink-0 px-3 text-muted-foreground hover:text-foreground self-center"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
