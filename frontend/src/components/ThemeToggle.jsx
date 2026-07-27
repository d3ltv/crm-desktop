import React from "react";
import { Sun, Moon } from "lucide-react";
import { useCrm } from "@/context/CrmContext";

export const ThemeToggle = ({ railMode = false }) => {
    const { state, dispatch } = useCrm();
    const isDark = state.theme === "dark";
    return (
        <button
            data-testid="theme-toggle-btn"
            aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
            title={isDark ? "Mode clair" : "Mode sombre"}
            onClick={() =>
                dispatch({ type: "SET_THEME", theme: isDark ? "light" : "dark" })
            }
            className={
                railMode
                    ? "w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors touch-target"
                    : "inline-flex items-center justify-center w-9 h-9 rounded-full text-foreground/70 hover:text-foreground hover:bg-secondary transition-colors touch-target"
            }
        >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
    );
};
