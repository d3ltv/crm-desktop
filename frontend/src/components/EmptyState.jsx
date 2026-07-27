import React from "react";

export const EmptyState = ({
    icon: Icon,
    title,
    description,
    action,
    testId = "empty-state",
    compact = false,
}) => {
    return (
        <div
            data-testid={testId}
            className={`flex flex-col items-center justify-center text-center ${compact ? "py-8" : "py-16"}`}
        >
            {Icon && (
                <div className="w-14 h-14 rounded-2xl surface-2 flex items-center justify-center mb-4 text-muted-foreground">
                    <Icon size={22} strokeWidth={1.6} />
                </div>
            )}
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            {description && (
                <p className="text-sm text-muted-foreground max-w-sm mt-1.5">
                    {description}
                </p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
};
