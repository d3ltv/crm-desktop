import React, { useState, useEffect, useMemo } from "react";
import { useCrm } from "@/context/CrmContext";
import { flushDesktopStorageNow } from "@/lib/desktopLocalStorage";
import { countContactsToday } from "@/lib/reliaBrain";

const LEGACY_GOAL_KEY = "crm_daily_goal";

function getColorScheme(ratio) {
    if (ratio >= 1) return { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "Objectif atteint !" };
    if (ratio >= 0.7) return { bar: "bg-yellow-400", text: "text-yellow-600 dark:text-yellow-400", label: "Bientôt !" };
    if (ratio >= 0.35) return { bar: "bg-orange-400", text: "text-orange-600 dark:text-orange-400", label: "En cours" };
    return { bar: "bg-muted-foreground/40", text: "text-muted-foreground", label: "En cours" };
}

export const DailyGoalWidget = ({ workspace, onEditGoal }) => {
    const { state } = useCrm();
    const goal = Math.max(1, state.settings?.dailyGoal || 20);
    const current = useMemo(() => countContactsToday(workspace), [workspace]);
    const ratio = goal > 0 ? Math.min(current / goal, 1) : 0;
    const pct = Math.round(ratio * 100);
    const { bar, text, label } = getColorScheme(ratio);

    return (
        <button
            type="button"
            onClick={onEditGoal}
            title={`Objectif quotidien — ${label}\nCliquez pour modifier`}
            className="flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1 rounded-xl hover:bg-secondary transition-colors group min-w-[64px] max-w-[96px] shrink-0"
            aria-label={`Objectif quotidien : ${current} sur ${goal} contacts`}
            data-testid="daily-goal-widget"
        >
            <div className="flex items-baseline gap-0.5 min-w-0">
                <span className={`text-[15px] font-bold tabular-nums leading-none ${text}`}>
                    {current}
                </span>
                <span className="text-[11px] text-muted-foreground font-medium leading-none tabular-nums">
                    /{goal}
                </span>
            </div>
            <div className="w-full h-[3px] rounded-full bg-secondary overflow-hidden mt-0.5">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${bar}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </button>
    );
};

export const DailyGoalEditor = ({ open, onClose }) => {
    const { state, dispatch } = useCrm();
    const [value, setValue] = useState("");

    useEffect(() => {
        if (open) setValue(String(state.settings?.dailyGoal || 20));
    }, [open, state.settings?.dailyGoal]);

    const handleSave = async () => {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n >= 1) {
            dispatch({ type: "SET_DAILY_GOAL", value: n });
            try {
                localStorage.setItem(LEGACY_GOAL_KEY, String(n));
            } catch {}
            await flushDesktopStorageNow();
            // Laisse React appliquer le state puis flush crm_state_v1.json
            setTimeout(() => window.__reliaFlush?.(), 80);
            window.dispatchEvent(new Event("crm_goal_updated"));
        }
        onClose();
    };

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-card border border-border rounded-2xl shadow-panel p-6 w-full max-w-sm space-y-4 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                    <Target size={16} className="text-primary shrink-0" />
                    <h3 className="font-semibold text-sm tracking-tight truncate">Objectif quotidien</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Nombre de prospects à contacter par jour. Sauvegardé avec Relia — conservé si vous quittez l&apos;app.
                    Le compteur se réinitialise chaque nuit.
                </p>
                <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                        Nombre de contacts visé
                    </label>
                    <input
                        type="number"
                        min="1"
                        max="999"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave();
                            if (e.key === "Escape") onClose();
                        }}
                        autoFocus
                        className="w-full h-10 px-3 rounded-lg border border-border bg-secondary/50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary tabular-nums"
                    />
                </div>
                <div className="flex gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 h-9 rounded-lg border border-border text-sm hover:bg-secondary transition-colors"
                    >
                        Annuler
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                        Enregistrer
                    </button>
                </div>
            </div>
        </div>
    );
};
