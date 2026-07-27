import React, { useEffect, useRef, useState } from "react";
import { Trophy, X, Euro } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCrm } from "@/context/CrmContext";

/**
 * Modal contextuelle qui s'ouvre quand un lead passe dans la colonne "Gagné".
 * Permet de saisir la valeur du deal, ou de passer sans saisir.
 */
export const WonDealModal = ({ open, lead, workspace, onClose }) => {
    const { dispatch } = useCrm();
    const [value, setValue] = useState("");
    const inputRef = useRef(null);

    useEffect(() => {
        if (open) {
            setValue(lead?.dealValue != null ? String(lead.dealValue) : "");
            // Autofocus après l'animation
            const t = setTimeout(() => inputRef.current?.focus(), 80);
            return () => clearTimeout(t);
        }
    }, [open, lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onKey = (e) => {
            if (!open) return;
            if (e.key === "Escape") onClose();
            // Enter seul ou Cmd+Enter pour sauvegarder
            if (e.key === "Enter") save();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, value]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!open || !lead) return null;

    const parsed = value.trim() === "" ? null : parseFloat(value.replace(/[^0-9.,]/g, "").replace(",", "."));

    const save = () => {
        dispatch({
            type: "SET_DEAL_VALUE",
            workspaceId: workspace.id,
            leadId: lead.id,
            value: parsed != null && !isNaN(parsed) ? parsed : null,
        });
        onClose();
    };

    const skip = () => {
        onClose();
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[60] bg-foreground/20 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={skip}
            />

            {/* Modal */}
            <div className="fixed z-[70] left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[92vw] sm:w-[420px] bg-card rounded-2xl shadow-panel border border-border float-in overflow-hidden">
                {/* Header */}
                <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                            <Trophy size={18} className="text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold tracking-tight">Deal gagné 🎉</h3>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">
                                {lead.company}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={skip}
                        aria-label="Fermer"
                        className="w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground shrink-0 flex items-center justify-center"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 pb-4 space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Enregistrez la valeur de ce deal pour suivre votre chiffre d'affaires et analyser vos prix de closing.
                    </p>

                    <div className="relative">
                        <Euro
                            size={15}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <Input
                            ref={inputRef}
                            type="text"
                            inputMode="decimal"
                            placeholder="ex. 2500"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && save()}
                            className="pl-9 h-12 text-lg font-semibold tracking-tight"
                            data-testid="won-deal-value-input"
                        />
                    </div>

                    {parsed != null && !isNaN(parsed) && (
                        <p className="text-xs text-muted-foreground text-center">
                            {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parsed)}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-2 bg-secondary/30">
                    <Button variant="ghost" onClick={skip} className="h-10 rounded-full text-sm">
                        Passer
                    </Button>
                    <Button
                        onClick={save}
                        data-testid="won-deal-save-btn"
                        className="h-10 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium"
                    >
                        <Trophy size={14} className="mr-1.5" />
                        Enregistrer
                    </Button>
                </div>
            </div>
        </>
    );
};
