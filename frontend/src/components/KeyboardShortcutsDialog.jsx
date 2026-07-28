import React, { useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

function isMacPlatform() {
    if (typeof navigator === "undefined") return true;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
}

function Kbd({ children }) {
    return (
        <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground tabular-nums shadow-sm">
            {children}
        </kbd>
    );
}

function ShortcutRow({ keys, label, join = "+" }) {
    return (
        <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[13px] text-foreground/90 leading-snug">{label}</span>
            <span className="flex items-center gap-1 shrink-0">
                {keys.map((k, i) => (
                    <React.Fragment key={`${k}-${i}`}>
                        {i > 0 && (
                            <span className="text-[10px] text-muted-foreground px-0.5">
                                {join}
                            </span>
                        )}
                        <Kbd>{k}</Kbd>
                    </React.Fragment>
                ))}
            </span>
        </div>
    );
}

function ShortcutSection({ title, rows }) {
    return (
        <section className="space-y-0.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1">
                {title}
            </h3>
            <div className="rounded-xl border border-border bg-card/60 px-3 py-1 divide-y divide-border/60">
                {rows.map((row) => (
                    <ShortcutRow
                        key={row.label}
                        keys={row.keys}
                        label={row.label}
                        join={row.join || "+"}
                    />
                ))}
            </div>
        </section>
    );
}

/**
 * Liste des raccourcis Relia — accessible depuis Réglages.
 */
export function KeyboardShortcutsDialog({ open, onOpenChange }) {
    const mac = useMemo(() => isMacPlatform(), []);
    const mod = mac ? "⌘" : "Ctrl";
    const alt = mac ? "⌥" : "Alt";
    const ctrl = mac ? "⌃" : "Ctrl";

    const sections = useMemo(
        () => [
            {
                title: "Partout",
                rows: [
                    { keys: [mod, "Z"], label: "Annuler" },
                    { keys: [mod, "⇧", "Z"], label: "Rétablir" },
                    { keys: [mod, "N"], label: "Nouveau prospect" },
                    { keys: [mod, "F"], label: "Ouvrir / fermer la recherche (aussi ⌘K)" },
                    { keys: [alt, "1…9"], label: "Changer d’espace de travail" },
                    { keys: [mod, ":"], label: "Afficher / masquer la barre latérale" },
                    { keys: [alt, "H"], label: "Retour à l’accueil (tous les espaces)" },
                    { keys: [mod, "."], label: "Fermer la fiche / fenêtre" },
                    { keys: ["Esc"], label: "Fermer la fiche / fenêtre" },
                ],
            },
            {
                title: "Appel & vocal",
                rows: [
                    { keys: [alt, "A"], label: "Démarrer / arrêter un appel libre" },
                    { keys: [mod, "⇧", "A"], label: "Appel libre (secours si ⌥A ne répond pas)" },
                    { keys: [ctrl, alt, "C"], label: "Ouvrir le calendrier" },
                    { keys: [mod, "⇧", "C"], label: "Calendrier (secours)" },
                ],
            },
            {
                title: "Fiche prospect",
                rows: [
                    { keys: ["Espace"], label: "Ouvrir / fermer le prospect focusé" },
                    { keys: [mod, "⇧", "N"], label: "Écrire une note" },
                    { keys: [alt, "R"], label: "Planifier une relance" },
                    { keys: [mod, "↵"], label: "Enregistrer (note, note d’appel, RDV)" },
                ],
            },
            {
                title: "Board & mode rapide",
                rows: [
                    { keys: [mod, "⇧", "E"], label: "Activer / quitter le mode rapide" },
                    { keys: [ctrl, alt, "Espace"], label: "Mode rapide (peut être pris par macOS)" },
                    { keys: [mod, "1…6"], label: "Aller à la colonne 1 à 6" },
                    { keys: ["→"], label: "Mode rapide : traiter le prospect" },
                    { keys: ["↑", "↓"], join: "/", label: "Mode rapide : prospect préc. / suiv." },
                ],
            },
        ],
        [mod, alt, ctrl]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="rounded-2xl max-w-[420px] max-h-[min(90dvh,640px)] overflow-y-auto gap-4 p-5"
                data-testid="keyboard-shortcuts-dialog"
            >
                <DialogHeader className="text-left space-y-1 pr-6">
                    <DialogTitle className="text-[17px] tracking-tight">
                        Raccourcis clavier
                    </DialogTitle>
                    <DialogDescription className="text-[13px] leading-snug">
                        Gagnez du temps sans quitter le clavier
                        {mac ? " — touches adaptées à votre Mac." : "."}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {sections.map((section) => (
                        <ShortcutSection
                            key={section.title}
                            title={section.title}
                            rows={section.rows}
                        />
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
