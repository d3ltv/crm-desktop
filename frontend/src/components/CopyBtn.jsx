import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

/** Bouton copier — même pattern que les cartes Kanban. */
export function CopyBtn({ value, className = "" }) {
    const [copied, setCopied] = useState(false);
    if (!value) return null;

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(String(value).trim()).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Copier"
            className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors shrink-0 ${
                copied ? "text-emerald-500" : "text-muted-foreground/50 hover:text-muted-foreground"
            } ${className}`}
        >
            {copied ? <Check size={10} strokeWidth={2.5} /> : <Copy size={10} strokeWidth={1.75} />}
        </button>
    );
}
