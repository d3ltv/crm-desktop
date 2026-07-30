/**
 * Export Markdown des transcriptions d'appels — pour analyse externe (Claude).
 *
 * Source de vérité = notes CRM avec `transcript` (pas un fichier miroir).
 * Supprimer un vocal / sa note retire automatiquement la transcription
 * du prochain export.
 */

/** Nombre max d'appels exportés (les plus récents). */
export const DEFAULT_TRANSCRIPT_EXPORT_LIMIT = 40;

const CALL_OUTCOME_RE = /^(?:📞\s*Joint|📵\s*Pas de réponse)/iu;

/**
 * Collecte les notes d'appel qui ont une vraie transcription.
 * @param {object[]} workspaces
 * @param {{ limit?: number }} [opts]
 * @returns {{
 *   id: string,
 *   at: string,
 *   transcript: string,
 *   noteText: string,
 *   company: string,
 *   contact: string,
 *   phone: string,
 *   columnName: string,
 *   workspaceName: string,
 *   workspaceId: string,
 *   leadId: string,
 *   outcome: 'joint'|'nrp'|'autre'|null,
 * }[]}
 */
export function collectCallTranscripts(workspaces = [], { limit = DEFAULT_TRANSCRIPT_EXPORT_LIMIT } = {}) {
    const out = [];
    for (const ws of workspaces || []) {
        if (!ws?.leads) continue;
        const cols = ws.columns || {};
        for (const lead of Object.values(ws.leads)) {
            if (!lead?.id || lead.archived) continue;
            for (const note of lead.notes || []) {
                const transcript = String(note?.transcript || "").trim();
                if (!transcript) continue;
                // Prefère les notes liées à un vocal ; accepte aussi un transcript collé
                const text = String(note?.text || "").trim();
                let outcome = null;
                if (/^📞\s*Joint/iu.test(text)) outcome = "joint";
                else if (/^📵\s*Pas de réponse/iu.test(text)) outcome = "nrp";
                else if (CALL_OUTCOME_RE.test(text)) outcome = "autre";

                out.push({
                    id: note.id || `${lead.id}-${note.at || out.length}`,
                    at: note.at || lead.lastContact || lead.createdAt || "",
                    transcript,
                    noteText: text,
                    company: String(lead.company || "").trim() || "Sans nom",
                    contact: String(lead.contact || "").trim(),
                    phone: String(lead.phone || "").trim(),
                    columnName: cols[lead.columnId]?.name || "",
                    workspaceName: String(ws.name || "").trim() || "Espace",
                    workspaceId: ws.id,
                    leadId: lead.id,
                    outcome,
                });
            }
        }
    }

    out.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    const n = Math.max(1, Math.floor(Number(limit) || DEFAULT_TRANSCRIPT_EXPORT_LIMIT));
    return out.slice(0, n);
}

function formatFrDateTime(iso) {
    if (!iso) return "date inconnue";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "date inconnue";
    return d.toLocaleString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function outcomeLabel(outcome) {
    if (outcome === "joint") return "Joint";
    if (outcome === "nrp") return "Pas de réponse";
    return null;
}

/**
 * Prompt d'analyse optimisé pour Claude — livrables concrets, peu de blabla.
 * @param {number} count
 */
export function buildClaudeColdCallPrompt(count) {
    const n = Math.max(0, Number(count) || 0);
    return `# Analyse de mes cold calls — brief pour Claude

Tu es un coach en prospection B2B exigeant, précis et actionnable. Tu analyses **${n} transcription${n > 1 ? "s" : ""}** de cold calls (Relia). Les appels sont ordonnés du plus récent au plus ancien.

## Objectif
Me donner une **visibilité nette** sur ma prospection pour ajuster mon tir : ce qui marche, ce qui frotte, quoi changer dès demain.

## Contraintes
- Réponds en **français**.
- Base-toi **uniquement** sur les transcriptions et métadonnées ci-dessous (pas d'invention de répliques).
- Les tours de parole sont préfixés **Speaker 1** / **Speaker 2** (séparation locale par pauses — pas une ID biométrique). Ne force pas qui est le commercial vs le prospect si ce n'est pas clair ; utilise les labels tels quels.
- Si une info manque, dis-le brièvement — ne comble pas avec du générique « best practices ».
- Sois **direct** : phrases courtes, priorités numérotées, zéro motivational filler.
- Distingue clairement : **faits observés** vs **hypothèses**.

## Livrables (dans cet ordre)

### 1. Tableau récapitulatif des appels
Un tableau Markdown avec une ligne par appel :
| # | Date | Prospect | Issue (Joint / NRP / ?) | Objectif perçu de l'appel | Signal fort | Friction / objection | Prochaine meilleure action |

### 2. Scripts & structures que j'utilise
- Décris la **structure type** de mon pitch (accroche → qualif → offre → close / suite).
- Extrais **2 à 4 scripts / formulations récurrentes** (citations courtes entre guillemets).
- Pour chacun : **garder / améliorer / abandonner**, avec une version réécrite si « améliorer ».

### 3. Ce qui est améliorable (priorisé)
Liste de **max 7** leviers, du plus impactant au moins :
1. Problème observé (avec # d'appel ou citation)
2. Pourquoi ça coûte des deals / des jointures
3. Formulation ou geste de remplacement (prêt à dire)

### 4. Lexique & patterns langagiers
- **Top mots / expressions** que j'utilise trop (filler, faiblesse, jargon).
- Mots / angles qui semblent **corrélés aux joints** (si l'échantillon le permet).
- Questions que je pose trop tard, ou jamais.

### 5. Synthèse « ajuster mon tir »
En **5 puces max** : ce que je dois faire sur mes **prochains 10 appels** (comportements mesurables, pas des intentions vagues).

### 6. Zones d'ombre
Ce que ces transcriptions **ne permettent pas** de conclure (échantillon, NRP sans contenu, etc.).

---
## Transcriptions
`;
}

/**
 * Corps Markdown : un bloc par appel.
 * @param {ReturnType<typeof collectCallTranscripts>} calls
 */
export function formatTranscriptsMarkdown(calls = []) {
    if (!calls.length) {
        return "_Aucune transcription d'appel disponible pour le moment._\n";
    }

    return calls.map((c, i) => {
        const lines = [
            `### Appel ${i + 1} — ${c.company}`,
            "",
            `- **Date :** ${formatFrDateTime(c.at)}`,
            `- **Espace :** ${c.workspaceName}`,
        ];
        if (c.columnName) lines.push(`- **Étape pipeline :** ${c.columnName}`);
        if (c.contact) lines.push(`- **Contact :** ${c.contact}`);
        if (c.phone) lines.push(`- **Téléphone :** ${c.phone}`);
        const oc = outcomeLabel(c.outcome);
        if (oc) lines.push(`- **Issue notée :** ${oc}`);
        if (c.noteText && !CALL_OUTCOME_RE.test(c.noteText)) {
            lines.push(`- **Note :** ${c.noteText.slice(0, 160)}`);
        }
        lines.push("", "#### Transcription", "", c.transcript.trim(), "", "---", "");
        return lines.join("\n");
    }).join("\n");
}

/**
 * Fichier .md complet (prompt + transcriptions).
 * @param {object[]} workspaces
 * @param {{ limit?: number }} [opts]
 * @returns {{ markdown: string, count: number, filename: string }}
 */
export function buildCallTranscriptsMarkdown(workspaces, opts = {}) {
    const calls = collectCallTranscripts(workspaces, opts);
    const prompt = buildClaudeColdCallPrompt(calls.length);
    const body = formatTranscriptsMarkdown(calls);
    const stamp = new Date().toISOString().slice(0, 10);
    const markdown = `${prompt}\n${body}`;
    return {
        markdown,
        count: calls.length,
        filename: `relia-cold-calls-${calls.length}x-${stamp}.md`,
    };
}

/**
 * Déclenche le téléchargement du .md dans le navigateur / WKWebView.
 * @param {string} markdown
 * @param {string} filename
 */
export function downloadMarkdownFile(markdown, filename) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "relia-cold-calls.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * Collecte + télécharge. Retourne le compteur pour le toast UI.
 * @param {object[]} workspaces
 * @param {{ limit?: number }} [opts]
 */
export function exportCallTranscriptsMarkdown(workspaces, opts = {}) {
    const { markdown, count, filename } = buildCallTranscriptsMarkdown(workspaces, opts);
    if (count === 0) {
        return { ok: false, count: 0, filename: null };
    }
    downloadMarkdownFile(markdown, filename);
    return { ok: true, count, filename };
}
