/**
 * Classement des contacts détectés (notes / import) pour la mise en avant.
 */

import { detectPersonNames } from "@/lib/noteParser";

function norm(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function hasTitle(name) {
    return /^(m\.|mme|mlle|monsieur|madame|mademoiselle)\b/i.test(String(name || "").trim());
}

export function scoreContactName(name, ctx = {}) {
    if (!name || !String(name).trim()) return -1;
    let score = 10;
    if (hasTitle(name)) score += 35;
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) score += 20;
    if (parts.length >= 3) score += 8;

    const freq = ctx.frequency || 1;
    score += Math.min(40, (freq - 1) * 18);

    if (ctx.source === "lead") score += 100;
    else if (ctx.source === "import") score += 25;
    else score += 15;

    const total = Math.max(1, ctx.totalNotes || 1);
    const idx = ctx.lastNoteIndex ?? -1;
    if (idx >= 0) {
        score += Math.max(0, 30 - idx * 3);
        score += Math.round((1 - idx / total) * 15);
    }

    if (ctx.leadContact && norm(ctx.leadContact) === norm(name)) {
        score += 120;
    }

    return score;
}

export function rankContactNames(entries, opts = {}) {
    const byNorm = new Map();
    for (const e of entries || []) {
        const name = (e.name || "").trim();
        if (!name) continue;
        const key = norm(name);
        const prev = byNorm.get(key);
        if (!prev) {
            byNorm.set(key, { ...e, name, frequency: e.frequency || 1 });
        } else {
            prev.frequency = (prev.frequency || 1) + (e.frequency || 1);
            if ((e.lastNoteIndex ?? 999) < (prev.lastNoteIndex ?? 999)) {
                prev.lastNoteIndex = e.lastNoteIndex;
                prev.name = name;
            }
            if (e.source === "lead") prev.source = "lead";
            else if (e.source === "import" && prev.source !== "lead") prev.source = "import";
        }
    }

    return [...byNorm.values()]
        .map((e) => ({
            ...e,
            score: scoreContactName(e.name, {
                leadContact: opts.leadContact,
                frequency: e.frequency,
                lastNoteIndex: e.lastNoteIndex,
                totalNotes: opts.totalNotes,
                source: e.source,
            }),
        }))
        .sort((a, b) => b.score - a.score);
}

export function collectRankedContacts(lead, importContacts = []) {
    const notes = lead?.notes || [];
    const entries = [];

    if (lead?.contact) {
        entries.push({ name: lead.contact, source: "lead", frequency: 1, lastNoteIndex: 0 });
    }
    for (const c of importContacts || []) {
        if (c) entries.push({ name: c, source: "import", frequency: 1, lastNoteIndex: 99 });
    }

    notes.forEach((n, idx) => {
        const text = n?.text || "";
        if (!text.trim()) return;
        for (const p of detectPersonNames(text)) {
            entries.push({ name: p, source: "note", frequency: 1, lastNoteIndex: idx });
        }
    });

    for (const cf of lead?.customFields || []) {
        if (!cf?.value) continue;
        if (!/contact|interlocuteur|personne|nom/i.test(cf.label || "")) continue;
        entries.push({ name: cf.value, source: "note", frequency: 1, lastNoteIndex: 50 });
    }

    return rankContactNames(entries, {
        leadContact: lead?.contact,
        totalNotes: notes.length || 1,
    });
}
