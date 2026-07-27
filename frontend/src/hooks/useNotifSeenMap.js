/**
 * Hook : re-render quand l'état « notifs lues » change,
 * et quand le brief quotidien / le jour calendaire change (8h, minuit…).
 */
import { useEffect, useState } from "react";
import { NOTIF_SEEN_EVENT, loadNotifSeenMap } from "@/lib/followupNotifs";
import { toLocalDateKey } from "@/lib/dateUtils";
import { DAILY_RECO_REFRESH_EVENT } from "@/lib/desktopNotifications";
import { CALENDAR_SEEN_EVENT, loadCalendarSeenMap } from "@/lib/calendarEvents";

export function useNotifSeenMap() {
    const [seenMap, setSeenMap] = useState(loadNotifSeenMap);
    /** Invalide les useMemo de conseils quand le jour ou le brief 8h change. */
    const [recoTick, setRecoTick] = useState(() => `${toLocalDateKey(new Date())}:0`);

    useEffect(() => {
        const refreshSeen = () => setSeenMap(loadNotifSeenMap());
        const bumpReco = () => {
            setRecoTick(`${toLocalDateKey(new Date())}:${Date.now()}`);
            refreshSeen();
        };
        const onStorage = () => {
            refreshSeen();
            setRecoTick(`${toLocalDateKey(new Date())}:${Date.now()}`);
        };

        window.addEventListener(NOTIF_SEEN_EVENT, refreshSeen);
        window.addEventListener(DAILY_RECO_REFRESH_EVENT, bumpReco);
        window.addEventListener("storage", onStorage);

        // Filet : passage de jour si l’app reste ouverte
        const id = setInterval(() => {
            const k = toLocalDateKey(new Date());
            setRecoTick((prev) => (prev.startsWith(`${k}:`) ? prev : `${k}:${Date.now()}`));
        }, 30_000);

        return () => {
            window.removeEventListener(NOTIF_SEEN_EVENT, refreshSeen);
            window.removeEventListener(DAILY_RECO_REFRESH_EVENT, bumpReco);
            window.removeEventListener("storage", onStorage);
            clearInterval(id);
        };
    }, []);

    // recoTick volontairement lu pour forcer le re-render des parents
    void recoTick;

    return seenMap;
}

/** Clé jour + tick — à passer en dep des useMemo de recommandations. */
export function useRecoDayTick() {
    const [tick, setTick] = useState(() => `${toLocalDateKey(new Date())}:0`);

    useEffect(() => {
        const bump = () => setTick(`${toLocalDateKey(new Date())}:${Date.now()}`);
        window.addEventListener(DAILY_RECO_REFRESH_EVENT, bump);
        const id = setInterval(() => {
            const k = toLocalDateKey(new Date());
            setTick((prev) => (prev.startsWith(`${k}:`) ? prev : `${k}:${Date.now()}`));
        }, 30_000);
        return () => {
            window.removeEventListener(DAILY_RECO_REFRESH_EVENT, bump);
            clearInterval(id);
        };
    }, []);

    return tick;
}

/** Lu / non-lu des échéances calendrier (badge, Tout lire). */
export function useCalendarSeenMap() {
    const [seenMap, setSeenMap] = useState(loadCalendarSeenMap);

    useEffect(() => {
        const refresh = () => setSeenMap(loadCalendarSeenMap());
        window.addEventListener(CALENDAR_SEEN_EVENT, refresh);
        window.addEventListener("storage", refresh);
        return () => {
            window.removeEventListener(CALENDAR_SEEN_EVENT, refresh);
            window.removeEventListener("storage", refresh);
        };
    }, []);

    return seenMap;
}
