/**
 * Personnalisation : données à ignorer dans les suggestions
 * (téléphone / nom / email du propriétaire — la transcription reste intacte).
 */
import React, { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import {
    getOwnerIdentity,
    saveOwnerIdentity,
} from "@/lib/ownerIdentity";

const DISPLAY_NAME_KEY = "crm_display_name";

function prefillFromGreeting(identity) {
    if (identity.firstName || identity.lastName) return identity;
    try {
        const name = (localStorage.getItem(DISPLAY_NAME_KEY) || "").trim();
        if (!name) return identity;
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
            return { ...identity, firstName: parts[0] };
        }
        return {
            ...identity,
            firstName: parts[0],
            lastName: parts.slice(1).join(" "),
        };
    } catch {
        return identity;
    }
}

/**
 * @param {{ open: boolean, onClose: () => void, firstVisit?: boolean }} props
 */
export function OwnerIdentityDialog({ open, onClose, firstVisit = false }) {
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        const id = prefillFromGreeting(getOwnerIdentity());
        setPhone(id.phone || "");
        setEmail(id.email || "");
        setFirstName(id.firstName || "");
        setLastName(id.lastName || "");
    }, [open]);

    if (!open) return null;

    const persist = async (markDone) => {
        setSaving(true);
        try {
            await saveOwnerIdentity(
                { phone, email, firstName, lastName },
                { markSetupDone: markDone }
            );
            // Aligne le prénom d’accueil si vide
            try {
                const current = localStorage.getItem(DISPLAY_NAME_KEY);
                if (!current && firstName.trim()) {
                    const label = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
                    localStorage.setItem(DISPLAY_NAME_KEY, label.slice(0, 40));
                }
            } catch { /* ignore */ }
            if (markDone) {
                toast.success("Coordonnées enregistrées", {
                    description: "Elles ne seront plus proposées sur les fiches.",
                });
            }
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const handleSave = () => persist(true);
    const handleSkip = () => persist(true);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget && !firstVisit) onClose();
            }}
            data-testid="owner-identity-dialog"
        >
            <div className="bg-card border border-border rounded-2xl shadow-panel p-6 w-full max-w-md space-y-4 overflow-hidden">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <UserRound size={18} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-semibold text-[15px] tracking-tight text-foreground">
                            {firstVisit ? "Vos coordonnées" : "Données à ignorer"}
                        </h3>
                        <p className="text-[12.5px] text-muted-foreground leading-relaxed mt-1">
                            Relia peut les entendre dans un appel et les transcrire — c’est voulu.
                            Indiquez-les ici pour qu’elles ne soient{" "}
                            <span className="text-foreground/80">jamais proposées</span>{" "}
                            comme données à ajouter sur les fiches.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1.5 sm:col-span-1">
                        <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                            Prénom
                        </label>
                        <input
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="ex. Marie"
                            autoFocus={firstVisit}
                            data-testid="owner-identity-firstname"
                            className="w-full h-10 px-3 rounded-lg border border-border bg-secondary/50 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                            Nom
                        </label>
                        <input
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="ex. Dupont"
                            data-testid="owner-identity-lastname"
                            className="w-full h-10 px-3 rounded-lg border border-border bg-secondary/50 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                            Téléphone
                        </label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="06 12 34 56 78"
                            data-testid="owner-identity-phone"
                            className="w-full h-10 px-3 rounded-lg border border-border bg-secondary/50 text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                            E-mail
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="vous@entreprise.fr"
                            data-testid="owner-identity-email"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleSave();
                                if (e.key === "Escape" && !firstVisit) onClose();
                            }}
                            className="w-full h-10 px-3 rounded-lg border border-border bg-secondary/50 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                </div>

                <div className="flex gap-2 pt-1">
                    {firstVisit ? (
                        <button
                            type="button"
                            onClick={handleSkip}
                            disabled={saving}
                            className="flex-1 h-9 rounded-lg border border-border text-[13px] hover:bg-secondary transition-colors disabled:opacity-50"
                            data-testid="owner-identity-skip"
                        >
                            Plus tard
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="flex-1 h-9 rounded-lg border border-border text-[13px] hover:bg-secondary transition-colors disabled:opacity-50"
                        >
                            Annuler
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        data-testid="owner-identity-save"
                    >
                        Enregistrer
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OwnerIdentityDialog;
