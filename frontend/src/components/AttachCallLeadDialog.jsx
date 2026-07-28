import React, { useEffect, useMemo, useRef, useState } from "react";
import { Phone, Search, Trash2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/callRecordings";
import { cn } from "@/lib/utils";

/**
 * Après un appel libre (⌥A) : rattacher le take à un prospect, sinon le supprimer.
 */
export function AttachCallLeadDialog({
    open,
    onOpenChange,
    workspace,
    durationMs = 0,
    saving = false,
    onAttach,
    onDiscard,
}) {
    const [query, setQuery] = useState("");
    const inputRef = useRef(null);

    useEffect(() => {
        if (!open) {
            setQuery("");
            return undefined;
        }
        const t = window.setTimeout(() => inputRef.current?.focus(), 80);
        return () => clearTimeout(t);
    }, [open]);

    const leads = useMemo(() => {
        if (!workspace?.leads) return [];
        const q = query.trim().toLowerCase();
        const list = Object.values(workspace.leads)
            .filter((l) => !l.archived)
            .map((l) => ({
                ...l,
                colName: workspace.columns?.[l.columnId]?.name || "",
            }));
        list.sort((a, b) =>
            String(a.company || a.contact || "").localeCompare(
                String(b.company || b.contact || ""),
                "fr",
                { sensitivity: "base" }
            )
        );
        if (!q) return list.slice(0, 40);
        return list
            .filter((l) => {
                const hay = [
                    l.company,
                    l.contact,
                    l.phone,
                    l.email,
                    l.colName,
                    ...(l.tags || []),
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return hay.includes(q);
            })
            .slice(0, 40);
    }, [workspace, query]);

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!v && !saving) onOpenChange?.(false);
            }}
        >
            <DialogContent
                className="rounded-2xl max-w-[420px] gap-3 p-5"
                data-testid="attach-call-lead-dialog"
                onEscapeKeyDown={(e) => {
                    if (saving) {
                        e.preventDefault();
                        return;
                    }
                    e.preventDefault();
                    onDiscard?.();
                }}
            >
                <DialogHeader className="text-left space-y-1 pr-6">
                    <DialogTitle className="text-[17px] tracking-tight flex items-center gap-2">
                        <Phone size={16} className="text-primary" strokeWidth={1.75} />
                        Rattacher l&apos;appel
                    </DialogTitle>
                    <DialogDescription className="text-[13px] leading-snug">
                        Choisissez un prospect. Sinon l&apos;enregistrement sera
                        supprimé ({formatDuration(durationMs)}).
                    </DialogDescription>
                </DialogHeader>

                <div className="relative">
                    <Search
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Rechercher un prospect…"
                        className="pl-9 h-10 rounded-xl"
                        data-testid="attach-call-search"
                        disabled={saving}
                    />
                </div>

                <div
                    className="max-h-[280px] overflow-y-auto rounded-xl border border-border divide-y divide-border/70"
                    data-testid="attach-call-lead-list"
                >
                    {leads.length === 0 ? (
                        <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                            Aucun prospect trouvé
                        </p>
                    ) : (
                        leads.map((lead) => (
                            <button
                                key={lead.id}
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                    onAttach?.({
                                        leadId: lead.id,
                                        leadLabel:
                                            lead.company || lead.contact || "Prospect",
                                    })
                                }
                                className={cn(
                                    "w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors",
                                    "disabled:opacity-50"
                                )}
                                data-testid={`attach-call-lead-${lead.id}`}
                            >
                                <p className="text-[13px] font-medium truncate">
                                    {lead.company || lead.contact || "Sans nom"}
                                </p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                    {[lead.colName, lead.contact, lead.phone]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                            </button>
                        ))
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => onDiscard?.()}
                        className="text-destructive hover:text-destructive gap-1.5"
                        data-testid="attach-call-discard"
                    >
                        <Trash2 size={14} />
                        Supprimer
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                        Esc = supprimer
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
