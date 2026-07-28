/**
 * Rellia (export) — assistant proactif (export-only).
 * Panneau gauche + highlights discrets, déclenchés par interaction.
 * Une fois par fonctionnalité (seenFeatures).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    BarChart3,
    Bell,
    CalendarClock,
    ChevronRight,
    Download,
    Globe,
    LayoutGrid,
    Mic,
    PlusSquare,
    Sparkles,
    Tag,
    Target,
    Upload,
    X,
    Keyboard,
} from "lucide-react";
import { isRelia2Export, PRODUCT_DISPLAY_NAME } from "@/lib/reliaVariant";
import {
    isContactedColumn,
    isLostColumn,
    isMeetingColumn,
    isNouveauColumn,
    isPropositionColumn,
    isRappelColumn,
    isWonColumn,
} from "@/constants/columnPatterns";
import {
    hydrateUsageMemory,
    isRelia2FeatureSeen,
    isRelia2FeatureTourCompleted,
    markRelia2FeatureSeen,
    markRelia2FeatureTourCompleted,
} from "@/lib/usageMemory";
import { cn } from "@/lib/utils";

const PAD = 6;
const KEY_FEATURES = [
    "notifications",
    "notes",
    "website",
    "leadPanel",
    "moveColumn",
    "callNote",
    "calendar",
    "voice",
    "tags",
    "csvImport",
    "csvExport",
    "newLead",
    "dailyGoal",
    "shortcuts",
    "stats",
    "kanban",
];

function queryTarget(selector) {
    if (!selector) return null;
    try {
        // Prefer first *existing* match across comma-separated selectors (order matters)
        const parts = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length > 1) {
            for (const part of parts) {
                const el = document.querySelector(part);
                if (el) return el;
            }
            return null;
        }
        return document.querySelector(selector);
    } catch {
        return null;
    }
}

function rectOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return {
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
    };
}

function closestMatch(target, selectors) {
    if (!target || !(target instanceof Element)) return false;
    return selectors.some((sel) => {
        try {
            return !!target.closest(sel);
        } catch {
            return false;
        }
    });
}

const FEATURES = [
    {
        id: "notifications",
        label: "Notifications",
        icon: Bell,
        selector: '[data-testid="notif-popover"], [data-testid="home-notif-popover"], [data-testid="topbar-notifications-btn"], [data-testid="home-notifications-btn"]',
        shape: "circle",
        title: "Notifications intelligentes",
        body: "La cloche regroupe les relances dues, les pistes du jour et les alertes utiles — pas les simples dates du calendrier.",
        tip: "Clique une notif pour ouvrir le lead concerné. « Tout lire » quand c’est traité.",
        contextTitle: "Notifs : à quoi ça sert",
    },
    {
        id: "notes",
        label: "Notes",
        icon: Sparkles,
        selector: '[data-testid="lead-note-input"], [data-testid="lead-add-note-btn"]',
        shape: "rect",
        title: "Notes qui détectent automatiquement",
        body: "Dès que tu écris, Relia peut détecter RDV, noms, téléphones, emails et relances.",
        tip: "Regarde le bloc « Détecté — sera appliqué » sous le champ, puis valide avec Ajouter (ou Cmd/Ctrl+Entrée).",
        contextTitle: "Notes : détection automatique",
    },
    {
        id: "website",
        label: "Site web",
        icon: Globe,
        selector: '[data-testid="lead-brief-website"], [data-testid="lead-website-input"]',
        shape: "rect",
        title: "Site web mis en avant",
        body: `Sur ${PRODUCT_DISPLAY_NAME}, le site du prospect remplace la mise en avant des annonces / offres d’emploi.`,
        tip: "Ouvre le site avant d’appeler — c’est souvent le meilleur brief.",
        contextTitle: `Site web : priorité ${PRODUCT_DISPLAY_NAME}`,
    },
    {
        id: "leadPanel",
        label: "Fiche lead",
        icon: LayoutGrid,
        selector: '[data-testid="lead-detail-panel"], [data-testid="lead-brief-strip"]',
        shape: "rect",
        title: "Fiche prospect",
        body: "Une carte ouverte = tout le contexte pour appeler : brief, contact, notes, calendrier, vocal.",
        tip: "En haut : Informations pertinentes. En bas : actions (noter, planifier, enregistrer).",
        contextTitle: "Fiche lead : le brief d’appel",
        details: [
            `Site web mis en avant (${PRODUCT_DISPLAY_NAME})`,
            "Notes avec détection auto (RDV, noms, tél.)",
            "Vocal qui survit si tu fermes la fiche",
        ],
    },
    {
        id: "moveColumn",
        label: "Déplacer un lead",
        icon: LayoutGrid,
        selector: '[data-testid="call-note-modal"], [data-testid="kanban-board"]',
        shape: "rect",
        title: "Glisser entre colonnes",
        body: "Chaque colonne a un sens. Déplacer un prospect déclenche souvent la bonne action suivante.",
        tip: "Nouveau → Contacté ouvre la note d’appel. Relance / RDV / Gagné / Perdu suivent le pipeline.",
        contextTitle: "Déplacement : ce que tu peux faire maintenant",
        details: [
            "Nouveau → Contacté : note d’appel (Joint / NRP)",
            "Vers Relance : planifie un rappel",
            "Vers Rendez-vous : note l’heure / le lieu",
            "Gagné / Perdu : clôture (+ valeur ou motif)",
            "Pendant un vocal : le micro continue en dock flottant",
        ],
    },
    {
        id: "callNote",
        label: "Note d’appel",
        icon: Mic,
        selector: '[data-testid="call-note-modal"], [data-testid="call-note-voice"]',
        shape: "rect",
        title: "Note après contact",
        body: "Après un premier contact, Relia te demande le résultat : Joint ou Pas de réponse, plus la suite.",
        tip: "Lance le micro ici. Si tu fermes la note, l’appel continue en bas — tu ne perds pas le take.",
        contextTitle: "Note d’appel : après un déplacement",
        details: [
            "Joint / NRP en un clic",
            "Micro → dock flottant si tu fermes",
            "Détection RDV / tél. / noms dans le texte",
            "Rappel ou relance auto suggérés",
        ],
    },
    {
        id: "calendar",
        label: "Calendrier",
        icon: CalendarClock,
        selector: '[data-testid="topbar-calendar-btn"], [data-testid="lead-next-action-card"], [data-testid="lead-edit-next-action"], [data-testid="topbar-calendar-dialog"]',
        shape: "rect",
        title: "Rappels et RDV",
        body: "Planifie depuis la fiche, retrouve tout dans le calendrier TopBar.",
        tip: "Relia évite le dimanche et peut suggérer des relances selon l’activité.",
        contextTitle: "Calendrier : prochaine action",
        details: [
            "Rappel depuis la fiche lead",
            "Vue globale TopBar",
            "Badge des échéances du jour",
        ],
    },
    {
        id: "voice",
        label: "Vocal",
        icon: Mic,
        selector: '[data-testid="voice-call-section"], [data-testid="voice-section-start"], [data-testid="voice-mic-start"], [data-testid="voice-floating-dock"], [data-testid="call-note-voice"]',
        shape: "circle",
        title: "Appels et transcription locale",
        body: "Enregistre l’appel depuis la fiche ou la note d’appel. Whisper local transcrit sans cloud.",
        tip: "Ferme la fiche ou la note : le dock flottant garde le micro. Sur les longs appels, Relia pré-transcrit dès ~10 min.",
        contextTitle: "Vocal : ne coupe jamais tout seul",
        details: [
            "Dock flottant en bas d’écran",
            "Survit à la fermeture fiche / note",
            "Pré-transcription sur appels longs (~10 min)",
            "Copie rapide de la transcription",
        ],
    },
    {
        id: "tags",
        label: "Tags",
        icon: Tag,
        selector: '[data-testid="lead-tag-input"], [data-testid="lead-add-tag-btn"]',
        shape: "rect",
        title: "Tags rapides",
        body: "Classe vite (chaud, NRP, collab…) puis filtre depuis la recherche TopBar.",
        tip: "Peu de tags utiles > catalogue trop large.",
        contextTitle: "Tags : classement rapide",
    },
    {
        id: "csvImport",
        label: "Import CSV",
        icon: Upload,
        selector: '[data-testid="settings-import-btn"], [data-testid="csv-dropzone"], [data-testid="csv-import-modal"], [data-testid="topbar-settings-btn"]',
        shape: "rect",
        title: "Import CSV",
        body: "Importe une liste : mapping auto + scan qualité (annonces fermées, coordonnées manquantes…).",
        tip: "Mode rapide = moins de friction. Mode avancé = contrôle du mapping.",
        contextTitle: "Import : démarrer vite",
    },
    {
        id: "csvExport",
        label: "Export CSV",
        icon: Download,
        selector: '[data-testid="settings-export-btn"]',
        shape: "rect",
        title: "Export CSV",
        body: "Exporte les leads depuis Réglages (UTF-8 BOM, Excel-friendly).",
        tip: "Pour un backup complet, utilise aussi les sauvegardes locales de Relia.",
        contextTitle: "Export : récupérer tes leads",
    },
    {
        id: "newLead",
        label: "Nouveau lead",
        icon: PlusSquare,
        selector: '[data-testid="topbar-new-lead-btn"]',
        shape: "circle",
        title: "Ajout manuel",
        body: "Le + en haut crée un lead à la volée, sans CSV.",
        tip: "Idéal après un appel entrant ou une reco LinkedIn.",
        contextTitle: "Ajout rapide de lead",
    },
    {
        id: "dailyGoal",
        label: "Objectif du jour",
        icon: Target,
        selector: '[data-testid="daily-goal-widget"], [data-testid="settings-daily-goal-btn"]',
        shape: "rect",
        title: "Objectif quotidien",
        body: "Suit ton rythme de prospection sans rouge agressif dès le matin.",
        tip: "Ajuste la cible dans Réglages pour coller à ton volume cold call.",
        contextTitle: "Objectif quotidien",
    },
    {
        id: "shortcuts",
        label: "Raccourcis",
        icon: Keyboard,
        selector: '[data-testid="settings-shortcuts-btn"], [data-testid="keyboard-shortcuts-dialog"], [data-testid="topbar-settings-btn"]',
        shape: "rect",
        title: "Raccourcis clavier",
        body: "Annuler, changer d’espace, mode rapide… tout est listé au même endroit.",
        tip: "Réglages (engrenage) → Raccourcis clavier. Essaye ⌘⇧A (appel) et ⌘⇧E (mode rapide).",
        contextTitle: "Clavier : moins de friction",
        details: [
            "⌘⇧A (ou ⌥A) : appel libre → rattacher un prospect",
            "⌘⇧E : mode rapide (⌃⌥Espace souvent pris par macOS)",
            "⌘N / ⌘F : nouveau lead / recherche",
            "⌘⇧N / ⌥R : note / relance sur la fiche",
        ],
    },
    {
        id: "stats",
        label: "Stats",
        icon: BarChart3,
        selector: '[data-testid="stats-dashboard"], [data-testid="sidebar-home-btn"]',
        shape: "rect",
        title: "Dashboard stats",
        body: "Conversion, délais, activité téléphonique, vigilance — pour voir où le pipeline freine.",
        tip: "Depuis l’accueil (maison), scroll jusqu’aux stats. Clique une alerte pour ouvrir les leads.",
        contextTitle: "Stats : lire le pipeline",
    },
    {
        id: "kanban",
        label: "Kanban",
        icon: LayoutGrid,
        selector: '[data-testid="kanban-board"]',
        shape: "rect",
        title: "Pipeline Kanban",
        body: "Glisse les cartes entre colonnes pour avancer un deal. Chaque carte = un brief d’appel.",
        tip: "Les colonnes sont sémantiques (Nouveau, Relance, RDV…) même si tu les renommes.",
        contextTitle: "Kanban : ton pipeline",
    },
];

/** Conseils contextuels selon la colonne d’arrivée (noms FR sémantiques). */
function buildMoveAdvice(fromName = "", toName = "") {
    const to = String(toName || "");
    const from = String(fromName || "");
    if (isContactedColumn(to)) {
        return {
            headline: "Prochaine étape : noter l’appel",
            tip: "Joint ou Pas de réponse, puis micro ou texte. Fermer la note ne coupe pas le vocal.",
            actions: [
                { label: "Joint / NRP", hint: "Choisir le résultat" },
                { label: "Micro", hint: "Dock flottant si tu fermes" },
                { label: "Relance", hint: "Suggérée après NRP" },
            ],
        };
    }
    if (isRappelColumn(to) || /relance/i.test(to)) {
        return {
            headline: "Prochaine étape : planifier le rappel",
            tip: "Ouvre la fiche → prochaine action / calendrier. Relia évite le dimanche.",
            actions: [
                { label: "Rappel", hint: "Date + heure" },
                { label: "Note", hint: "Pourquoi relancer" },
                { label: "Vocal", hint: "Si tu rappelles maintenant" },
            ],
        };
    }
    if (isMeetingColumn(to)) {
        return {
            headline: "Prochaine étape : figer le RDV",
            tip: "Ajoute date / heure dans la fiche ou via une note (« RDV mardi 14h »).",
            actions: [
                { label: "Calendrier", hint: "Créneau visible TopBar" },
                { label: "Note RDV", hint: "Détection auto du texte" },
                { label: "Brief", hint: "Site web avant le call" },
            ],
        };
    }
    if (isPropositionColumn(to)) {
        return {
            headline: "Prochaine étape : suivre l’offre",
            tip: "Note le montant / le devis et un rappel de suivi.",
            actions: [
                { label: "Valeur", hint: "Deal value sur la fiche" },
                { label: "Relance devis", hint: "Rappel calendrier" },
                { label: "Note", hint: "Points négociés" },
            ],
        };
    }
    if (isWonColumn(to)) {
        return {
            headline: "Deal gagné — clôture propre",
            tip: "Renseigne la valeur si besoin, archive le contexte dans une note courte.",
            actions: [
                { label: "Valeur", hint: "Montant gagné" },
                { label: "Note finale", hint: "Ce qui a convaincu" },
            ],
        };
    }
    if (isLostColumn(to)) {
        return {
            headline: "Deal perdu — garder le motif",
            tip: "Une note « motif » aide les stats et les prochaines campagnes.",
            actions: [
                { label: "Motif", hint: "Prix / timing / concurrent" },
                { label: "Tags", hint: "Pour filtrer plus tard" },
            ],
        };
    }
    if (isNouveauColumn(to)) {
        return {
            headline: "Remis en entrée de pipeline",
            tip: "Prêt à rappeler. Ouvre la fiche pour le brief (site web) avant d’appeler.",
            actions: [
                { label: "Brief", hint: "Site + contact" },
                { label: "Appeler", hint: "Puis glisser vers Contacté" },
            ],
        };
    }
    return {
        headline: from && to ? `Déplacé vers « ${to} »` : "Prospect déplacé",
        tip: "Ouvre la fiche pour noter, planifier un rappel, ou lancer un vocal.",
        actions: [
            { label: "Fiche", hint: "Brief d’appel" },
            { label: "Note", hint: "Contexte immédiat" },
            { label: "Vocal", hint: "Dock si tu fermes" },
        ],
    };
}

export function Relia2FeatureTour() {
    const [ready, setReady] = useState(false);
    const [listening, setListening] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const [selectedFeature, setSelectedFeature] = useState(null);
    const [targetRect, setTargetRect] = useState(null);
    const [seenTick, setSeenTick] = useState(0);
    const [moveHint, setMoveHint] = useState(null);
    const [catalogOpen, setCatalogOpen] = useState(false);
    const rafRef = useRef(0);
    const noteArmedRef = useRef(true);

    const featureMap = useMemo(
        () => Object.fromEntries(FEATURES.map((f) => [f.id, f])),
        []
    );
    const selected = selectedFeature ? featureMap[selectedFeature] : null;

    const totalSeen = useMemo(
        () => FEATURES.filter((f) => isRelia2FeatureSeen(f.id)).length,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [seenTick, panelOpen, selectedFeature]
    );

    const bumpSeen = useCallback(() => setSeenTick((n) => n + 1), []);

    useEffect(() => {
        if (!isRelia2Export) return undefined;
        let cancelled = false;
        (async () => {
            await hydrateUsageMemory();
            if (cancelled) return;
            setReady(true);
            // Pas d’ouverture auto : on écoute les clics / 1ère note
            if (!isRelia2FeatureTourCompleted()) {
                setListening(true);
            } else {
                // Tour marqué completed, mais des features individuelles peuvent encore manquer
                const anyUnseen = KEY_FEATURES.some((id) => !isRelia2FeatureSeen(id));
                setListening(anyUnseen);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const openFeature = useCallback((featureId, { force = false } = {}) => {
        const feature = featureMap[featureId];
        if (!feature) return;
        const already = isRelia2FeatureSeen(featureId);
        // Auto : une seule fois. force = navigation manuelle dans le catalogue.
        if (!force && already) return;
        setSelectedFeature(featureId);
        setPanelOpen(true);
        setCatalogOpen(false);
        if (!already) {
            markRelia2FeatureSeen(featureId);
            bumpSeen();
        }
        const allSeen = KEY_FEATURES.every((id) => isRelia2FeatureSeen(id));
        if (allSeen && !isRelia2FeatureTourCompleted()) {
            markRelia2FeatureTourCompleted();
        }
    }, [featureMap, bumpSeen]);

    const dismissPanel = useCallback(() => {
        setPanelOpen(false);
        setCatalogOpen(false);
    }, []);

    // Esc ferme le guidage immédiatement
    useEffect(() => {
        if (!panelOpen) return undefined;
        const onKey = (e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            dismissPanel();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [panelOpen, dismissPanel]);

    // Highlight tracking
    useEffect(() => {
        if (!panelOpen || !selected) {
            setTargetRect(null);
            return undefined;
        }
        const tick = () => setTargetRect(rectOf(queryTarget(selected.selector)));
        tick();
        const iv = setInterval(tick, 350);
        const onScroll = () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(tick);
        };
        window.addEventListener("resize", onScroll);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            clearInterval(iv);
            window.removeEventListener("resize", onScroll);
            window.removeEventListener("scroll", onScroll, true);
            cancelAnimationFrame(rafRef.current);
        };
    }, [panelOpen, selected]);

    // Triggers document + drag de colonne
    useEffect(() => {
        if (!listening) return undefined;

        const onLeadMoved = (e) => {
            const d = e?.detail || {};
            const fromName = d.fromName || "…";
            const toName = d.toName || "…";
            const advice = buildMoveAdvice(fromName, toName);
            setMoveHint({
                fromName,
                toName,
                headline: advice.headline,
                tip: advice.tip,
                actions: advice.actions,
            });
            // Une seule fois par feature — jamais de force sur trigger auto
            window.setTimeout(() => openFeature("moveColumn"), 80);
            window.setTimeout(() => {
                if (queryTarget('[data-testid="call-note-modal"]')) {
                    openFeature("callNote");
                }
            }, 450);
        };

        const onDocClick = (e) => {
            const t = e.target;
            if (!(t instanceof Element)) return;
            // Ignorer clics dans le panneau assistant
            if (t.closest('[data-testid="relia2-guide-panel"]')) return;

            if (closestMatch(t, [
                '[data-testid="topbar-notifications-btn"]',
                '[data-testid="home-notifications-btn"]',
            ])) {
                window.setTimeout(() => openFeature("notifications"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="call-note-voice-start"]',
                '[data-testid="voice-section-start"]',
                '[data-testid="voice-mic-start"]',
                '[data-testid="voice-floating-dock"]',
            ])) {
                window.setTimeout(() => openFeature("voice"), 140);
                return;
            }

            if (closestMatch(t, ['[data-testid="call-note-modal"]', '[data-testid="call-note-voice"]'])) {
                window.setTimeout(() => openFeature("callNote"), 120);
                return;
            }

            if (closestMatch(t, ['[data-testid^="lead-card-"]'])) {
                window.setTimeout(() => openFeature("leadPanel"), 220);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="lead-brief-website"]',
                '[data-testid="lead-website-input"]',
            ])) {
                window.setTimeout(() => openFeature("website"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="topbar-calendar-btn"]',
                '[data-testid="lead-edit-next-action"]',
                '[data-testid="lead-next-action-card"]',
            ])) {
                window.setTimeout(() => openFeature("calendar"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="voice-call-section"]',
            ])) {
                window.setTimeout(() => openFeature("voice"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="lead-tag-input"]',
                '[data-testid="lead-add-tag-btn"]',
            ])) {
                window.setTimeout(() => openFeature("tags"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="settings-import-btn"]',
                '[data-testid="csv-dropzone"]',
                '[data-testid="csv-choose-file-btn"]',
            ])) {
                window.setTimeout(() => openFeature("csvImport"), 140);
                return;
            }

            if (closestMatch(t, ['[data-testid="topbar-settings-btn"]'])) {
                window.setTimeout(() => openFeature("csvImport"), 180);
                return;
            }

            if (closestMatch(t, ['[data-testid="settings-export-btn"]'])) {
                window.setTimeout(() => openFeature("csvExport"), 140);
                return;
            }

            if (closestMatch(t, ['[data-testid="topbar-new-lead-btn"]'])) {
                window.setTimeout(() => openFeature("newLead"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="daily-goal-widget"]',
                '[data-testid="settings-daily-goal-btn"]',
            ])) {
                window.setTimeout(() => openFeature("dailyGoal"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="settings-shortcuts-btn"]',
                '[data-testid="keyboard-shortcuts-dialog"]',
            ])) {
                window.setTimeout(() => openFeature("shortcuts"), 140);
                return;
            }

            if (closestMatch(t, [
                '[data-testid="sidebar-home-btn"]',
                '[data-testid="stats-dashboard"]',
            ])) {
                window.setTimeout(() => openFeature("stats"), 180);
                return;
            }

            if (closestMatch(t, ['[data-testid="kanban-board"]'])) {
                if (!t.closest('[data-testid^="lead-card-"]')) {
                    window.setTimeout(() => openFeature("kanban"), 120);
                }
            }
        };

        const onInput = (e) => {
            const target = e.target;
            if (!(target instanceof HTMLTextAreaElement)) return;
            if (target.getAttribute("data-testid") !== "lead-note-input") return;
            if (!noteArmedRef.current) return;
            if (!String(target.value || "").trim()) return;
            if (isRelia2FeatureSeen("notes")) {
                noteArmedRef.current = false;
                return;
            }
            noteArmedRef.current = false;
            openFeature("notes");
        };

        window.addEventListener("relia:lead-moved", onLeadMoved);
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("input", onInput, true);
        return () => {
            window.removeEventListener("relia:lead-moved", onLeadMoved);
            document.removeEventListener("click", onDocClick, true);
            document.removeEventListener("input", onInput, true);
        };
    }, [listening, openFeature]);

    if (!isRelia2Export || !ready || !listening) return null;
    if (!panelOpen || !selected) return null;

    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const hole = targetRect;
    const isCircle = selected.shape === "circle" && hole;
    const circleR = hole ? Math.max(hole.width, hole.height) / 2 + 2 : 0;

    const overlay = (
        <div
            className="fixed inset-0 z-[10000] pointer-events-none"
            data-testid="relia2-feature-tour"
            aria-live="polite"
        >
            {/* Highlight discret — voile léger + contour */}
            <svg className="absolute inset-0 w-full h-full" width={vw} height={vh}>
                <defs>
                    <mask id="relia2-guide-mask">
                        <rect x="0" y="0" width={vw} height={vh} fill="white" />
                        {hole && isCircle && (
                            <circle cx={hole.cx} cy={hole.cy} r={circleR} fill="black" />
                        )}
                        {hole && !isCircle && (
                            <rect
                                x={hole.left}
                                y={hole.top}
                                width={hole.width}
                                height={hole.height}
                                rx="10"
                                ry="10"
                                fill="black"
                            />
                        )}
                    </mask>
                </defs>
                <rect
                    x="0"
                    y="0"
                    width={vw}
                    height={vh}
                    fill="rgba(15, 15, 18, 0.28)"
                    mask="url(#relia2-guide-mask)"
                />
                {hole && isCircle && (
                    <circle
                        cx={hole.cx}
                        cy={hole.cy}
                        r={circleR}
                        fill="none"
                        stroke="hsl(211 100% 50%)"
                        strokeWidth="2.5"
                        strokeOpacity="1"
                    />
                )}
                {hole && !isCircle && (
                    <rect
                        x={hole.left}
                        y={hole.top}
                        width={hole.width}
                        height={hole.height}
                        rx="10"
                        ry="10"
                        fill="none"
                        stroke="hsl(211 100% 50%)"
                        strokeWidth="2.5"
                        strokeOpacity="1"
                    />
                )}
            </svg>

            <div
                data-testid="relia2-guide-panel"
                className={cn(
                    "pointer-events-auto fixed left-3 top-16 z-[10001] w-[300px]",
                    "max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-card text-card-foreground shadow-xl",
                    "flex flex-col max-h-[min(420px,calc(100vh-96px))]"
                )}
                role="dialog"
                aria-label={`Assistant ${PRODUCT_DISPLAY_NAME}`}
            >
                {/* Header sticky — fermeture immédiate */}
                <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 pt-3 pb-2 border-b border-border/60">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary min-w-0">
                        <Sparkles size={12} className="shrink-0" />
                        <span className="truncate">Astuce · une seule fois</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={dismissPanel}
                            className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90"
                            data-testid="relia2-guide-dismiss"
                        >
                            Compris
                        </button>
                        <button
                            type="button"
                            onClick={dismissPanel}
                            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Fermer"
                            title="Fermer (Esc)"
                            data-testid="relia2-guide-close"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto px-3.5 py-3 space-y-2.5">
                    <div className="space-y-1.5">
                        <h3 className="text-[14px] font-semibold leading-snug tracking-tight">
                            {selected.contextTitle || selected.title}
                        </h3>
                        <p className="text-[12px] text-muted-foreground leading-snug">
                            {selectedFeature === "moveColumn" && moveHint?.headline
                                ? moveHint.headline
                                : selected.body}
                        </p>
                        {selectedFeature === "moveColumn" && moveHint && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-2">
                                    <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[38%]">
                                        {moveHint.fromName}
                                    </span>
                                    <ChevronRight size={14} className="text-primary shrink-0" />
                                    <span className="text-[12px] font-semibold text-primary truncate">
                                        {moveHint.toName}
                                    </span>
                                </div>
                                {Array.isArray(moveHint.actions) && moveHint.actions.length > 0 && (
                                    <div className="grid grid-cols-1 gap-1">
                                        {moveHint.actions.slice(0, 3).map((action) => (
                                            <div
                                                key={action.label}
                                                className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] font-medium leading-tight truncate">
                                                        {action.label}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground leading-tight truncate">
                                                        {action.hint}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {(selectedFeature === "moveColumn" && moveHint?.tip
                            ? moveHint.tip
                            : selected.tip) && (
                            <p className="text-[11px] text-foreground/90 leading-snug rounded-lg bg-primary/8 border border-primary/15 px-2.5 py-1.5">
                                {selectedFeature === "moveColumn" && moveHint?.tip
                                    ? moveHint.tip
                                    : selected.tip}
                            </p>
                        )}
                        {selectedFeature !== "moveColumn"
                            && Array.isArray(selected.details)
                            && selected.details.length > 0 && (
                            <ul className="space-y-1 pt-0.5">
                                {selected.details.slice(0, 4).map((line) => (
                                    <li
                                        key={line}
                                        className="flex items-start gap-2 text-[11px] leading-snug text-foreground/90"
                                    >
                                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                        <span>{line}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Catalogue replié par défaut — évite de scroller pour fermer */}
                    <div className="rounded-xl border border-border/70 bg-muted/10 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setCatalogOpen((v) => !v)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/40"
                            data-testid="relia2-guide-catalog-toggle"
                        >
                            <span className="text-[11px] font-medium">
                                Autres aides ({totalSeen}/{FEATURES.length})
                            </span>
                            <ChevronRight
                                size={14}
                                className={cn(
                                    "text-muted-foreground transition-transform",
                                    catalogOpen && "rotate-90"
                                )}
                            />
                        </button>
                        {catalogOpen && (
                            <div className="border-t border-border/60 p-1.5 space-y-0.5 max-h-[160px] overflow-y-auto">
                                {FEATURES.map((feature) => {
                                    const Icon = feature.icon;
                                    const seen = isRelia2FeatureSeen(feature.id);
                                    return (
                                        <button
                                            key={feature.id}
                                            type="button"
                                            onClick={() => openFeature(feature.id, { force: true })}
                                            className={cn(
                                                "flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-left",
                                                selectedFeature === feature.id
                                                    ? "bg-primary/10"
                                                    : "hover:bg-muted/50"
                                            )}
                                        >
                                            <Icon
                                                size={13}
                                                className={seen ? "text-emerald-600" : "text-primary"}
                                            />
                                            <span className="text-[11px] font-medium flex-1 truncate">
                                                {feature.label}
                                            </span>
                                            {seen && (
                                                <span className="text-[9px] text-emerald-600">vu</span>
                                            )}
                                        </button>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => {
                                        KEY_FEATURES.forEach((id) => {
                                            if (!isRelia2FeatureSeen(id)) markRelia2FeatureSeen(id);
                                        });
                                        markRelia2FeatureTourCompleted();
                                        bumpSeen();
                                        setListening(false);
                                        dismissPanel();
                                    }}
                                    className="w-full mt-1 h-8 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                    data-testid="relia2-tour-skip-all"
                                >
                                    Ne plus afficher d’astuces
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}

export default Relia2FeatureTour;
