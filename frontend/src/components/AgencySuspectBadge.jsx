import React from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CHIP_CLS =
    "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";

const PERCENT_CLS =
    "inline-flex items-center shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold tabular-nums bg-orange-500/12 text-orange-700/90 border border-orange-500/20 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-400/25";

/**
 * Signal visuel « cabinet / agence » — palette orange (distinct du rose process).
 * @param {{ score: number, label?: string, variant?: "chip" | "line" | "compact" | "percent", className?: string }} props
 */
export function AgencySuspectBadge({ score, label, variant = "chip", className }) {
    const title = label || `Suspect à ${score}% d'être un cabinet de recrutement`;

    if (variant === "line") {
        return (
            <div
                className={cn(
                    "mt-1 text-[11px] font-medium leading-snug text-orange-700/90 dark:text-orange-300/90",
                    className
                )}
                title={title}
                data-testid="agency-suspect-line"
            >
                {title}
            </div>
        );
    }

    if (variant === "compact") {
        return (
            <span className={cn(CHIP_CLS, className)} title={title} data-testid="agency-suspect-badge">
                <Building2 size={9} strokeWidth={2.5} className="shrink-0" />
            </span>
        );
    }

    // Badge léger « 40% » — à côté du nom (calendrier, en-têtes)
    if (variant === "percent") {
        return (
            <span className={cn(PERCENT_CLS, className)} title={title} data-testid="agency-suspect-badge">
                {score}%
            </span>
        );
    }

    return (
        <span className={cn(CHIP_CLS, className)} title={title} data-testid="agency-suspect-badge">
            <Building2 size={9} strokeWidth={2.5} className="shrink-0" />
            <span>Cabinet</span>
            <span className="tabular-nums opacity-80">{score}%</span>
        </span>
    );
}

export const AGENCY_NAME_CLS = "text-orange-700 dark:text-orange-300";
