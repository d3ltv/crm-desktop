# Relia — contexte pour l’IA Cursor

Fiche d’onboarding pour une **nouvelle conversation** sans historique.  
Lis ce fichier **avant** de modifier le code. Le README utilisateur (`README.md`) est court ; ici c’est le contexte produit / architecture / DA.

---

## 1. Qu’est-ce que Relia ?

| | |
|---|---|
| **Produit** | **Relia** (reliabilité + relances) |
| **Type** | CRM **desktop local-first** (prospection, relances, pipeline Kanban, CSV, vocaux) |
| **Stack UI** | React 19 + CRA/craco + Tailwind + shadcn/Radix + Lucide |
| **Shell natif** | **Tauri 2** (Rust) — FS, notifs macOS, recordings |
| **Langue UI** | **Français** partout (toasts, labels, empty states) |
| **Identifiant technique** | `local.crm.desktop` — **NE JAMAIS CHANGER** (sinon perte des données utilisateur) |

### Sibling web (ne pas confondre)

| Repo | Rôle |
|------|------|
| **`crm-desktop`** (ce dossier) | Relia desktop — **pas d’auth**, **pas de sync Mongo**, persistence disque |
| **`crmnew-main`** (`../crmnew-main`) | App **web** — FastAPI + MongoDB + JWT + `AuthContext` |

Les deux partagent une famille UI Kanban, mais les `CrmContext` ont **divergé**. Ne pas « aligner » naïvement les deux repos. Le `backend/` de Relia est un **héritage mort** : ne pas le démarrer pour faire tourner Relia.

---

## 2. Architecture (en 30 secondes)

```
React (CrmContext)  =  toute la logique métier
        ↕ invoke
Tauri / Rust        =  lecture/écriture disque + notifs + fichiers audio
```

- **Pas d’API HTTP métier** dans Relia (pas de `api.js` / axios vers un serveur CRM).
- Router ultra-simple : `state.currentId` → `WorkspacePage`, sinon `WorkspacesPage` (pas de routes React Router métier).

### Données sur disque (macOS)

```
~/Library/Application Support/local.crm.desktop/
  crm_state_v1.json          # SOURCE DE VÉRITÉ métier
  crm_state_v1_backup.json   # backup roulant avant chaque save
  crm_prefs.json             # prefs UI (vue, densité, notifs lues…)
  crm_usage_v1.json          # mémoire d’usage locale (nourrit l’algo de conseils)
  recordings/                # vocaux (.json + .bin)
  backups/                   # snapshots périodiques (~10 min, keep 12)
```

| Contenu | Fichier |
|---------|---------|
| Workspaces, leads, colonnes, notes, RDV, thème, dailyGoal… | `crm_state_v1.json` |
| Clés type `crm_view`, densités, sidebar UI, profils import… | `crm_prefs.json` via shim localStorage |
| Interactions / apprentissage algo conseils (local only) | `crm_usage_v1.json` |

**Règle d’or :** l’état métier CRM **ne va jamais** dans le localStorage / prefs. Uniquement via `diskSaveState` → `crm_state_v1.json`.

Au boot (`index.js`) : `installDesktopStorage()` remplace `window.localStorage` par une mémoire sync → `crm_prefs.json`, puis hydrate le state depuis le disque.

`yarn start` seul = React dans le navigateur (fallback LS / IndexedDB) — **ce n’est pas** l’app desktop. Pour Relia : `yarn desktop`.

---

## 3. Où travailler

```
crm-desktop/
├── AGENTS.md                 ← ce fichier
├── README.md                 ← run / build / stockage (user)
├── SPEC_VISUELLE_KANBAN.md   ← DA Kanban détaillée
├── AUDIT_VISUEL.md           ← dette / anti-patterns
├── backend/                  ← LEGACY — ignorer pour Relia
└── frontend/
    ├── src/
    │   ├── index.js          # boot + shim storage
    │   ├── App.js            # ErrorBoundary + providers + 2 pages
    │   ├── index.css         # tokens light/dark (source de vérité CSS)
    │   ├── App.css           # compléments (attention doublons vs index.css)
    │   ├── context/
    │   │   ├── CrmContext.jsx          # state machine + persistence
    │   │   └── VoiceSessionContext.jsx # session micro globale
    │   ├── lib/
    │   │   ├── diskStorage.js          # bridge Tauri state
    │   │   ├── diskUsage.js            # bridge mémoire d’usage
    │   │   ├── usageMemory.js          # apprentissage local → reco
    │   │   ├── desktopLocalStorage.js  # shim LS → prefs (ACTIF)
    │   │   ├── diskPrefs.js            # legacy — NON branché
    │   │   ├── callRecordings.js
    │   │   ├── desktopNotifications.js
    │   │   ├── transcribeLocal.js      # Whisper local (Xenova)
    │   │   ├── csvUtils.js
    │   │   └── autoBackup.js           # no-op / flush sous Tauri
    │   ├── constants/columnPatterns.js # sémantique colonnes FR
    │   └── components/                 # UI (Kanban, TopBar, panels, voice…)
    └── src-tauri/                      # Rust, tauri.conf.json, icons
```

Alias import : `@/` → `src/` (craco).

### Fichiers critiques

| Fichier | Rôle |
|---------|------|
| `frontend/src/context/CrmContext.jsx` | Reducer CRM, undo, hydrate, save debounced |
| `frontend/src/lib/diskStorage.js` | `isTauri()`, load/save state |
| `frontend/src/lib/desktopLocalStorage.js` | Prefs ; strip des clés state métier |
| `frontend/src/components/WorkspacePage.jsx` | Shell board |
| `frontend/src/components/LeadCard.jsx` | Carte Quiet Board |
| `frontend/src/components/LeadDetailPanel.jsx` | Fiche lead |
| `frontend/src/components/TopBar.jsx` | Chrome principal |
| `frontend/src/index.css` | Design tokens |
| `frontend/src-tauri/tauri.conf.json` | productName Relia, identifier, fenêtre |
| `frontend/src-tauri/src/lib.rs` | Commandes FS |

---

## 4. Modèle d’état (résumé)

**Root** : `workspaces`, `order`, `sidebar`, `currentId`, `lastOpenedId`, `theme` (`light`|`dark`), `leadPanelMode`, `settings.dailyGoal`, `lastDeleted` (transient, non persisté).

**Workspace** : `name`, `sector`, `template` (`crm`|`jobs`), `columns` / `columnOrder`, `leads`, `cardFields`, `columnWidth`, `cardScale`, `pipelineRoles`, etc.

**Colonnes CRM défaut** : Nouveau → Contacté → Relance → Rendez-vous → Gagné → Perdu  
(détection sémantique via `constants/columnPatterns.js` — ne pas hardcoder des noms fragiles).

**Lead** (champs principaux) : `company`, `phone`, `website`, `email`, `contact`, `tags[]`, `notes[]`, `nextAction`, `lastContact`, `dealValue`, `statusHistory[]`, `archived`, champs custom / jobs selon template.

Save state : debounce **~500 ms**. Prefs shim : **~400 ms**.

Raccourcis : Cmd/Ctrl+Z undo · Shift+Z redo · Alt+1..9 switch workspace.

---

## 5. Direction artistique & UX

Références techniques : `SPEC_VISUELLE_KANBAN.md`, `AUDIT_VISUEL.md`, tokens `frontend/src/index.css`.  
Ce qui compte pour Relia n’est pas “faire joli” : c’est un **outil de prospection calme**, premium, et **sans friction**.

### Esprit

Relia doit se sentir comme une app **Apple HIG** : évidente, discrète, tactile, où chaque geste a un coût mental proche de zéro.  
Visuellement : **minimaliste**, beaucoup d’air, peu de bruit, la couleur n’apparaît que quand elle sert.

> Un Kanban aussi calme qu’un document Notion, aussi précis qu’un dashboard Stripe, aussi fluide qu’une app bancaire N26 — où chaque carte n’a qu’une chose à dire.

### Inspirations (ce qu’on emprunte)

| Référence | Ce qu’on prend |
|-----------|----------------|
| **Apple** (Reminders, Notes, HIG) | Hiérarchie claire, un CTA principal, animations sobres, zero cognitive load, labels lisibles, “ça marche comme on s’y attend” |
| **Notion** | Calme, densités maîtrisées, board qui respire, UI qui s’efface derrière le contenu |
| **Stripe** | Précision, typo nette, états / données lisibles sans dashboard criard |
| **N26** | Produit financier : confiance, surfaces propres, peu d’éléments, actions évidentes |
| **Linear** | Rails de board sobres, cartes nettes, chrome léger |
| **Cursor / VS Code Dark+** | Mode nuit : charbon neutre, plat, accents rares (pas de néon) |

On **n’imite pas** leur branding : on reprend leur **discipline visuelle et UX**.

### Friction = ennemi n°1

Sur **toutes** les features (import CSV, fiche lead, notes, vocaux, relances, vues, settings…) :

1. **Le moins de clics / champs / étapes possible** pour arriver au résultat.
2. **L’action principale doit sauter aux yeux** ; le reste va en overflow (`⋯`), menus, ou progressive disclosure.
3. **Defaults intelligents** : mapping auto, colonnes sémantiques, suggestions — l’utilisateur ne configure que l’exception.
4. **Feedback immédiat** mais discret (toast court, état local) — jamais un tunnel de modals.
5. **Une carte = un brief d’appel**, pas un dump de données ; le détail vit dans le panel.
6. **Toujours icône + libellé** sur les vues / actions importantes (jamais icon-only opaque).
7. Si une UI demande de “réfléchir pour comprendre”, elle est **mal conçue** — simplifier.

Logique très **Apple** : l’interface sert la tâche (appeler, noter, relancer, avancer le deal), pas l’inverse.

### Codes couleurs

**Un seul primary.** Les autres couleurs = rôles (succès / alerte / danger), jamais des “deuxièmes CTA”.

**Light (Quiet Board)** — fond gris froid, surfaces blanches, primary Apple blue :

| Rôle | Approx. | Usage |
|------|---------|--------|
| Background | gris froid ~`#F1F3F5` | fond app |
| Surface / card | blanc `#FFFFFF` | chrome, cartes |
| Foreground | near-black | texte |
| Muted | gris ~46 % | meta, compteurs |
| **Primary** | **`#007AFF`** (systemBlue) | **seul** CTA principal / focus |
| Success | vert contenu | won / positif |
| Warning | ambre | rappel dû |
| Destructive | rouge système | delete / erreur |

Cartes au repos : **plates** (bordure fine, pas d’ombre lourde). Glass / blur : **TopBar seulement**.

**Dark** — charbon type Cursor, pas de teinte violette :

| Rôle | Approx. |
|------|---------|
| Background | `#121212` |
| Surface | `#171717` |
| Card | `#1c1c1c` |
| Texte | `#e0e0e0` |
| Muted | `#888` |
| Primary | `#3794ff` |
| Warning | `#e2b340` |
| Destructive | `#f14c4c` |
| Border | `#2b2b2b` |

### Visuel concret (board)

- Colonnes **transparentes** ; seules les **cartes** portent le blanc / surface.
- Peu d’ornement : pas de purple glow, pas de gradients “AI”, pas de multi-primaries, pas de TopBar saturée.
- Icônes **Lucide** uniquement (stroke léger) ; emoji réservés au picker sidebar.
- Typo sobre, échelle courte (caption → body → title) ; beaucoup de `tabular-nums` sur les chiffres.
- Daily goal : reste **neutre** tant que le ratio est bas — pas de rouge “Critique” le matin.

### Interdits (anti-patterns)

- Look “template IA” : purple/indigo, glow, fond crème + serif terracotta
- UI chargée, cards partout, badges en pagaille, stats dans chaque coin
- Forcer des étapes inutiles, modals empilés, settings avant l’action
- CTA verts / oranges “parce que ça attire l’œil” — le bleu primary suffit

---

## 6. Features desktop spécifiques

| Feature | Où | Notes |
|---------|-----|--------|
| Persistence disque | `diskStorage.js` + Rust | Write atomique `.tmp` → rename |
| Prefs | `desktopLocalStorage.js` | Remplace LS sous Tauri |
| Mémoire d’usage | `usageMemory.js` + `crm_usage_v1.json` | Apprend des gestes → conseille mieux |
| Vocaux | `callRecordings.js`, Voice* components | TTL **90 jours** ; pas toucher aux fichiers hors commandes Rust |
| Transcription | `transcribeLocal.js` | Whisper **local** `@xenova/transformers` · `whisper-base` (~75 Mo) · offline après 1er DL |
| Notifs OS | `desktopNotifications.js` | Follow-ups ; cooldown ~30 min / item |
| Auto history | Rust | Snapshots périodiques dans `backups/` |
| **Mises à jour** | `appUpdates.js` + `align.rs` + Relia Console | Pointeur `official.json` (release GitHub `official`) ; alignement au démarrage (upgrade **ou** rollback) ; data hors bundle |

Fenêtre : 1440×900, min 1024×680 (`tauri.conf.json`).

### Canal officiel (Console → GitHub → Relia)

**Logique :** Relia Console pose la version officielle. GitHub stocke les archives. Chaque Relia, **au démarrage**, lit le pointeur et propose d’**aligner** si `local ≠ officiel`.

| Élément | Tag GitHub | Contenu |
|---------|------------|---------|
| Archive immuable | `vX.Y.Z` | `Relia_…app.tar.gz` + `.sig` (+ copie `official.json`) |
| Pointeur mutable | `official` | `official.json` seul — **ne pas supprimer** |

Endpoint clients :

`https://github.com/d3ltv/crm-desktop/releases/download/official/official.json`

**Relia Console** (`identifier: local.relia.console` — data séparées du CRM) :

```bash
cd frontend
yarn desktop:console          # dev
yarn desktop:build:console    # Relia Console.app
```

Dans la Console : coller un PAT GitHub (Releases) → **Publier** (build + upload + pointeur) ou **Rollback** (réécrit seulement le pointeur, pas de rebuild).

CLI équivalent :

```bash
yarn desktop:publish-update "Notes FR"
yarn desktop:set-official 0.1.0 "Retour arrière"
```

Clé de signature : `frontend/src-tauri/.updater-keys/relia.key` (gitignored, backup local). L’updater remplace **seulement** `Relia.app` — jamais `crm_state_v1.json` / recordings. **Ne jamais changer** `identifier: local.crm.desktop` sur Relia client.

---

## 7. Commandes

```bash
cd frontend
yarn install
yarn desktop          # ← MODE DEV (à utiliser pendant les mods)
yarn desktop:build    # build Relia.app (quand tu veux installer)
yarn start            # React seul dans le navigateur ≠ Relia desktop
```

Package manager : **yarn** (v1).

### Mode DEV vs Applications

| Situation | Que faire |
|-----------|-----------|
| Tu modifies / tu testes | **`yarn desktop`** — fenêtre Tauri dev, hot reload |
| Tu veux Relia « installée » à jour | `yarn desktop:build` + copie vers Applications (ci-dessous) |

**Règle :** pendant le travail, **ne pas** ouvrir Relia depuis Applications / le Dock.  
C’est une build figée. Ferme-la (Cmd+Q) et utilise uniquement la fenêtre lancée par `yarn desktop`.

`yarn start` seul = navigateur (pas de FS Tauri) — **ce n’est pas** Relia desktop.

### Build → Applications (quand tu « ship » une version)

Éditer le code **ne met PAS à jour** Relia dans le Dock / Applications.  
Après `yarn desktop:build` :

```bash
rm -rf /Applications/Relia.app
cp -R src-tauri/target/release/bundle/macos/Relia.app /Applications/Relia.app
```

Puis **quitter Relia complètement (Cmd+Q)** et relancer depuis Applications.  
Sinon l’utilisateur croit que « aucune modif n’est effective ».

Bundle frais aussi ici :  
`frontend/src-tauri/target/release/bundle/macos/Relia.app`

---

## 8. Pièges (à lire avant de « corriger »)

1. **Ne jamais changer** `identifier: local.crm.desktop`.
2. **Ne jamais** écrire le state métier dans LS / `crm_prefs.json`.
3. **`diskPrefs.js` est orphelin** — le chemin actif est `desktopLocalStorage.js`.
4. **`backend/` n’est pas utilisé** par Relia — ne pas « réparer » la sync Mongo sans demande explicite.
5. **Ne pas sync aveugle** avec `crmnew-main` : storage / auth / voice sont desktop-only.
6. Sous Tauri, `localStorage.setItem("crm_state_v1")` part dans le **shim prefs**, pas le fichier state — restore crash peut être incohérent ; préférer `RESTORE_SNAPSHOT` + `diskSaveState` / import backup.
7. `yarn start` ≠ Relia desktop (pas d’invoke FS natif).
8. UI et messages utilisateur en **français**.
9. **Fermer/rouvrir Relia.app sans rebuild** = anciennes sources. Toujours rebuild + réinstaller (§7) **ou** travailler en `yarn desktop`.
10. Workspace Cursor ouvert sur `crmnew-main` alors que Relia = `crm-desktop` → mods au mauvais endroit.
11. Tester Applications **pendant** que tu codes en dev → confusion : ferme Applications, garde `yarn desktop`.
12. **Mises à jour** : pointeur `official.json` (release `official`) + Relia Console. Ne jamais changer `identifier` Relia. L’alignement ne touche pas `Application Support`. Rollback = re-pointeur, pas de rebuild.

---

## 9. Comment travailler dans une nouvelle conv

1. Confirmer que le workspace ouvert est **`crm-desktop`**, pas `crmnew-main`.
2. Lire ce fichier + `.cursor/rules/relia-context.mdc`.
3. Pour itérer : lancer **`yarn desktop`** et **ne pas** ouvrir Relia depuis Applications.
4. Pour un changement UI/UX : viser le **minimum de friction** (esprit Apple) + DA minimaliste + tokens `index.css` / SPEC.
5. Pour un changement data : passer par `dispatch` dans `CrmContext` + vérifier la persistence disque.
6. Pour le natif (FS, notifs, recordings) : Tauri commands dans `src-tauri`, bridge dans `src/lib/`.
7. Pour publier / rollback une version : **Relia Console** (`yarn desktop:console`) ou `desktop:publish-update` / `desktop:set-official`.
8. **Quand tu veux shipper** vers l’app installée : `yarn desktop:build` + copie vers `/Applications/Relia.app` + Cmd+Q / relancer (§7).

En cas de doute DA : ouvrir `SPEC_VISUELLE_KANBAN.md` plutôt que d’inventer un nouveau look.

---

## 10. Multi-plateforme (Windows / Linux)

Tauri 2 **peut** cibler Windows et Linux. Relia est **validé et packagé pour macOS** aujourd’hui (`bundle.targets: ["app"]`, notifs macOS).

| Zone | macOS | Windows / Linux |
|------|-------|-----------------|
| Shell Tauri + React | OK | OK (rebuild + cibles bundle) |
| Persistence disque | OK | OK (chemins OS via API Tauri) |
| Micro / Whisper | OK (préférer `audio/mp4` sous WKWebView) | OK (webm souvent mieux sous Chromium) |
| Notifs desktop | OK | À retester (permissions OS) |
| Distribution | Relia.app | Exigerait `msi`/`deb` + CI |

**Verdict :** faisable sans réécrire le métier CRM. Effort = packager, QA micro/Whisper/notifs, matrice de support. Ne pas activer Win/Linux sans campagne de tests.
