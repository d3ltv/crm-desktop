import React, { useState, useMemo, useEffect, useRef } from "react";
import {
    findCompanyDomain,
    logoCandidateUrls,
    isAggregatorLogoUrl,
} from "@/lib/logoUtils";

const AVATAR_HUES = [
    "bg-blue-500/12 text-blue-700 dark:text-blue-300",
    "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    "bg-teal-500/12 text-teal-700 dark:text-teal-300",
    "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    "bg-amber-500/12 text-amber-800 dark:text-amber-300",
    "bg-rose-500/12 text-rose-700 dark:text-rose-300",
    "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
];

function hashId(id = "") {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return h;
}

function initialsFromLead(lead) {
    const raw = (lead?.company || lead?.contact || "?").trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return raw.slice(0, 2).toUpperCase() || "?";
}

/**
 * Logo entreprise → domaine parent → favicon → initiale.
 * Sur les cartes Kanban : charge l'image seulement à l'entrée viewport (moins de RAM/réseau).
 * @param {{ lead: object, size?: string, card?: boolean, panel?: boolean, bgClass?: string }} props
 */
export const LeadAvatar = ({ lead, size, card = false, panel = false, bgClass }) => {
    const [step, setStep] = useState(0);
    const [inView, setInView] = useState(!card);
    const rootRef = useRef(null);

    const domain = useMemo(
        () => findCompanyDomain(lead),
        [lead.website, lead.email, lead.extra, lead.customFields]
    );

    const candidates = useMemo(() => {
        if (domain) return logoCandidateUrls(domain);
        if (lead.logoUrl && !isAggregatorLogoUrl(lead.logoUrl)) {
            const clearbit = String(lead.logoUrl).match(/logo\.clearbit\.com\/([^/?#]+)/i);
            if (clearbit?.[1]) {
                let d = clearbit[1];
                try { d = decodeURIComponent(d); } catch { /* keep raw */ }
                return logoCandidateUrls(d);
            }
            return [lead.logoUrl];
        }
        return [];
    }, [domain, lead.logoUrl]);

    const candidatesKey = candidates.join("|");

    useEffect(() => {
        setStep(0);
    }, [candidatesKey]);

    useEffect(() => {
        if (!card || inView) return;
        const el = rootRef.current;
        if (!el || typeof IntersectionObserver === "undefined") {
            setInView(true);
            return;
        }
        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setInView(true);
                    io.disconnect();
                }
            },
            { rootMargin: "100px" }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [card, inView]);

    const currentUrl = inView ? (candidates[step] || null) : null;
    const hue = AVATAR_HUES[hashId(lead.id) % AVATAR_HUES.length];
    const well = bgClass || hue;

    const dims = panel
        ? { box: "w-11 h-11 rounded-xl", img: "w-7 h-7", fav: "w-5 h-5", initial: "text-[13px]" }
        : card
            ? { box: "w-7 h-7 rounded-md", img: "w-4 h-4", fav: "w-3.5 h-3.5", initial: "text-[10px]" }
            : { box: "w-8 h-8 rounded-md", img: "w-5 h-5", fav: "w-4.5 h-4.5", initial: "text-[11px]" };

    const isFavicon = currentUrl && /favicons|duckduckgo/i.test(currentUrl);
    const imgClass = isFavicon ? dims.fav : dims.img;
    const initialSize = size || dims.initial;
    const boxShell = panel
        ? `${dims.box} border border-border/60 shadow-sm bg-white dark:bg-white/10`
        : `${dims.box} bg-white dark:bg-white/10`;

    if (currentUrl) {
        return (
            <span
                ref={rootRef}
                className={`shrink-0 select-none flex items-center justify-center overflow-hidden ${boxShell}`}
                aria-hidden
            >
                <img
                    key={currentUrl}
                    src={currentUrl}
                    alt=""
                    className={`${imgClass} object-contain`}
                    onError={() => setStep((s) => s + 1)}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                />
            </span>
        );
    }

    return (
        <span
            ref={rootRef}
            className={`shrink-0 select-none flex items-center justify-center font-semibold ${dims.box} ${panel ? "border border-border/50 shadow-sm" : ""} ${well} ${initialSize}`}
            aria-hidden
        >
            {initialsFromLead(lead)}
        </span>
    );
};
