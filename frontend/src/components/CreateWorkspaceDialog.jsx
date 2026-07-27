import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useCrm } from "@/context/CrmContext";
import { Check } from "lucide-react";

const TEMPLATES = [
    {
        id: "crm",
        emoji: "🎯",
        label: "Pipeline Prospects",
        description: "Suivi commercial classique : leads, contacts, devis, relances.",
        columns: ["Nouveau", "Contacté", "Relance", "Rendez-vous", "Gagné", "Perdu"],
        colors: ["bg-blue-500", "bg-amber-500", "bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-rose-500"],
        accent: "border-blue-500/40 bg-blue-500/5",
        badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
        id: "jobs",
        emoji: "💼",
        label: "Offres d'emploi",
        description: "Suivi de candidatures : entretiens, relances, propositions, réponses.",
        columns: ["Candidatures", "Entretien RH", "Technique", "Proposition", "Accepté 🎉", "Refusé"],
        colors: ["bg-blue-500", "bg-amber-500", "bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-rose-500"],
        accent: "border-violet-500/40 bg-violet-500/5",
        badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
        tags: ["Poste", "Salaire", "Remote", "Stack tech", "Recruteur"],
    },
];

export const CreateWorkspaceDialog = ({ open, onOpenChange }) => {
    const { dispatch } = useCrm();
    const [name, setName] = useState("");
    const [sector, setSector] = useState("");
    const [template, setTemplate] = useState("crm");

    const selectedTpl = TEMPLATES.find((t) => t.id === template);

    const create = () => {
        if (!name.trim()) return;
        dispatch({
            type: "CREATE_WORKSPACE",
            name: name.trim(),
            sector: sector.trim(),
            template,
        });
        setName("");
        setSector("");
        setTemplate("crm");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="create-workspace-dialog"
                className="sm:max-w-[520px] rounded-2xl border-border shadow-panel"
            >
                <DialogHeader>
                    <DialogTitle className="text-xl tracking-tight">
                        Créer un espace
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                        Choisissez un template pour adapter les colonnes et les champs à votre usage.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    {/* Sélecteur de template */}
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Type d'espace</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {TEMPLATES.map((tpl) => (
                                <button
                                    key={tpl.id}
                                    type="button"
                                    onClick={() => setTemplate(tpl.id)}
                                    className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                                        template === tpl.id
                                            ? `${tpl.accent} border-opacity-100`
                                            : "border-border hover:border-border/80 hover:bg-muted/30"
                                    }`}
                                >
                                    {/* Checkmark */}
                                    {template === tpl.id && (
                                        <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                            <Check size={11} strokeWidth={3} className="text-white" />
                                        </span>
                                    )}

                                    <div className="text-2xl mb-2">{tpl.emoji}</div>
                                    <div className="font-semibold text-[13.5px] text-foreground mb-1">{tpl.label}</div>
                                    <div className="text-[11.5px] text-muted-foreground leading-relaxed mb-3">{tpl.description}</div>

                                    {/* Preview colonnes */}
                                    <div className="flex flex-wrap gap-1">
                                        {tpl.columns.map((col, i) => (
                                            <span
                                                key={col}
                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white ${tpl.colors[i] || "bg-gray-400"}`}
                                                style={{ opacity: 0.9 }}
                                            >
                                                {col}
                                            </span>
                                        ))}
                                    </div>

                                    {/* Tags spéciaux pour jobs */}
                                    {tpl.tags && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {tpl.tags.map((tag) => (
                                                <span key={tag} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tpl.badge}`}>
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Nom */}
                    <div className="space-y-2">
                        <Label htmlFor="ws-name">
                            {template === "jobs" ? "Nom de la recherche d'emploi" : "Nom de l'espace"}
                        </Label>
                        <Input
                            id="ws-name"
                            data-testid="workspace-name-input"
                            placeholder={template === "jobs" ? "ex. Dev Frontend 2025, Stage…" : "ex. Avocats, BTP, SaaS…"}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && create()}
                            autoFocus
                        />
                    </div>

                    {/* Secteur / Info optionnelle */}
                    <div className="space-y-2">
                        <Label htmlFor="ws-sector">
                            {template === "jobs" ? "Description (optionnel)" : "Secteur (optionnel)"}
                        </Label>
                        <Input
                            id="ws-sector"
                            data-testid="workspace-sector-input"
                            placeholder={template === "jobs" ? "ex. Remote, Paris, 45k€…" : "Description courte"}
                            value={sector}
                            onChange={(e) => setSector(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && create()}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        data-testid="workspace-cancel-btn"
                        onClick={() => onOpenChange(false)}
                    >
                        Annuler
                    </Button>
                    <Button
                        data-testid="workspace-create-btn"
                        onClick={create}
                        disabled={!name.trim()}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        {selectedTpl?.emoji} Créer l'espace
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
