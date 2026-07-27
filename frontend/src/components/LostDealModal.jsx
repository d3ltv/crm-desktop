import React, { useEffect, useState } from "react";
import { X, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/context/CrmContext";
import { DEFAULT_LOST_REASONS } from "@/lib/pipelineRoles";
import { cn } from "@/lib/utils";

/**
 * Modal rapide (QCM) à l'entrée en colonne Perdu — une touche = enregistré.
 */
export const LostDealModal = ({ open, lead, workspace, onClose }) => {
    const { dispatch } = useCrm();
    const [other, setOther] = useState("");
    const [pickingOther, setPickingOther] = useState(false);

    useEffect(() => {
        if (open) {
            setOther("");
            setPickingOther(false);
        }
    }, [open, lead?.id]);

    useEffect(() => {
        const onKey = (e) => {
            if (!open) return;
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open || !lead) return null;

    const save = (reasonId, label) => {
        dispatch({
            type: "SET_LOST_REASON",
            workspaceId: workspace.id,
            leadId: lead.id,
            reasonId,
            reasonLabel: label,
        });
        onClose();
    };

    const skip = () => onClose();

    return (
        <>
            <div
                className="fixed inset-0 z-[60] bg-foreground/20 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={skip}
                data-testid="lost-deal-backdrop"
            />
            <div
                className="fixed z-[70] left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[92vw] sm:w-[420px] bg-card rounded-2xl shadow-panel border border-border float-in overflow-hidden"
                data-testid="lost-deal-modal"
            >
                <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-rose-500/15 flex items-center justify-center shrink-0">
                            <ThumbsDown size={18} className="text-rose-600 dark:text-rose-400" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base font-semibold tracking-tight">Deal perdu</h3>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {lead.company}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={skip}
                        aria-label="Fermer"
                        className="w-9 h-9 rounded-full hover:bg-secondary text-muted-foreground shrink-0 flex items-center justify-center"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="px-5 pb-4 space-y-3">
                    <p className="text-[13px] text-muted-foreground">
                        Pourquoi ? Un clic suffit — pour les stats, sans rester bloqué.
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                        {DEFAULT_LOST_REASONS.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                data-testid={`lost-reason-${r.id}`}
                                onClick={() => {
                                    if (r.id === "other") {
                                        setPickingOther(true);
                                        return;
                                    }
                                    save(r.id, r.label);
                                }}
                                className={cn(
                                    "h-10 px-3 rounded-xl text-left text-[13px] font-medium border transition-colors",
                                    "border-border hover:border-rose-500/40 hover:bg-rose-500/8 hover:text-rose-700 dark:hover:text-rose-300"
                                )}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    {pickingOther && (
                        <div className="flex gap-2 pt-1">
                            <input
                                autoFocus
                                value={other}
                                onChange={(e) => setOther(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && other.trim()) {
                                        save("other", other.trim());
                                    }
                                }}
                                placeholder="Précisez en quelques mots…"
                                className="flex-1 h-10 rounded-xl border border-border bg-background px-3 text-[13px]"
                                data-testid="lost-reason-other-input"
                            />
                            <Button
                                type="button"
                                disabled={!other.trim()}
                                onClick={() => save("other", other.trim())}
                                className="h-10 rounded-full"
                                data-testid="lost-reason-other-save"
                            >
                                OK
                            </Button>
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-border/60 flex justify-end bg-secondary/30">
                    <Button variant="ghost" onClick={skip} className="h-9 rounded-full text-sm">
                        Passer
                    </Button>
                </div>
            </div>
        </>
    );
};
