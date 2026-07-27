# Audit visuel — CRM Kanban

## Note finale

**6,5 / 10**

Le fond est bon : tokens CSS (Apple blue / Notion), dark mode, Lucide, modals glass soignés, polish kanban (snap, scrollbars, drop). Mais le produit se sent encore *assemblé* plutôt que *systématisé* : double feuille de styles, TopBar saturée, typo en tailles magiques, mélange emoji/Lucide, CTA incohérents, et trous mobile (sélecteur de vues absent).

| Critère | Note /10 | Commentaire |
|---------|----------|-------------|
| Identité & tokens | 7 | Variables solides, mais fuites `#FAFAFA`, emerald one-offs, gradient mort |
| Hiérarchie & densité | 5,5 | TopBar et headers de colonnes trop chargés |
| Cohérence composants | 5,5 | Boutons / rayons / avatars divergent selon l’écran |
| Responsive | 5 | Sidebar mobile OK ; vues & TopBar cassent sous `sm` |
| Feedback & polish | 7 | Hover cartes, drag, focus-visible, toasts : bons |
| Lisibilité / contraste | 6,5 | Dark mode correct ; charts et goal « Critique » trop alarmistes |

---

## 🔴 Priorité haute

### Sélecteur de vues invisible sur mobile
- **Zone** : responsive / navigation
- **Fichier** : `frontend/src/components/TopBar.jsx:196-197`
- **Problème** : Kanban / Liste / Table / Pipeline est en `hidden sm:flex` ; aucun contrôle de remplacement n’existe ailleurs.
- **Impact** : Sur téléphone, l’utilisateur reste bloqué sur la dernière vue sauvée (`crm_view`), souvent le Kanban.
- **Correction** : Ajouter un segmented control sous le titre, ou une entrée dans le menu hamburger / settings.

### TopBar saturée (boutons mal agencés)
- **Zone** : layout / densité
- **Fichier** : `frontend/src/components/TopBar.jsx:140-635`
- **Problème** : Une seule rangée `h-14` en grille 3 colonnes empile titre, vues, objectif quotidien, recherche + chips tags, notifs, thème (`w-11`), settings, undo/redo et CTA « Nouveau ».
- **Impact** : Entre ~768 et ~1100 px, le centre et la droite se marchent dessus : troncatures, wrap chaotique, boutons collés.
- **Correction** : Menu overflow « ⋯ » pour les actions secondaires ; recherche en pleine largeur sur une 2ᵉ rangée quand ouverte.

### Conflit `index.css` ↔ `App.css` sur les cartes
- **Zone** : cohérence visuelle
- **Fichier** : `frontend/src/index.css:241-276` vs `frontend/src/App.css:3-42`
- **Problème** : Les deux feuilles redéfinissent hover, drag (`opacity: 0.25` vs `0.4`, rotation différente), `.glass` et `.shadow-panel`. Les deux sont chargées (`index.js` + `App.js`).
- **Impact** : Ombres / feedback drag dépendent de l’ordre cascade — rendu « aléatoire » selon le navigateur.
- **Correction** : Une seule source de vérité (tokens dans `index.css`) ; supprimer les doublons d’`App.css`.

### `min-height: 40px` sur *tous* les boutons tactiles
- **Zone** : densité / interaction
- **Fichier** : `frontend/src/index.css:211-217`
- **Problème** : Sur pointeur coarse, chaque `button` / `[role="button"]` / `a` force `min-height: 40px`.
- **Impact** : Barres d’actions des cartes, pastilles `X`, grips de colonnes et icônes TopBar gonflent et cassent les layouts serrés (iPad, trackpad touch).
- **Correction** : Limiter la règle à une classe `.touch-target` sur les CTA chrome, pas sur les micro-contrôles.

---

## 🟠 Priorité moyenne

### ThemeToggle plus grand que ses voisins
- **Zone** : alignement / cohérence
- **Fichier** : `ThemeToggle.jsx:19` vs `TopBar.jsx:338-360`
- **Problème** : Toggle thème en `w-11 h-11` à côté d’icônes `w-9 h-9`.
- **Impact** : Le cluster droit de la TopBar paraît irrégulier ; le thème domine visuellement.
- **Correction** : Uniformiser à `w-9 h-9` / icône 16 px dans le contexte TopBar.

### CTA primaires sans style unique
- **Zone** : cohérence
- **Fichier** : `WorkspacesPage.jsx:333`, `TopBar.jsx:630`, modals (souvent `bg-primary` / `bg-emerald-500` / `rounded-full`)
- **Problème** : Les actions principales mélangent `bg-foreground` vs `bg-primary`, `rounded-lg` vs `rounded-full`, bleu système vs emerald.
- **Impact** : Aucune « signature » visuelle du bouton principal — l’œil ne sait pas où cliquer en premier.
- **Correction** : Un seul `PrimaryButton` (token + rayon) ; variantes success/destructive seulement quand sémantiques.

### Mélange emoji + Lucide sur les mêmes surfaces
- **Zone** : identité
- **Fichier** : `LeadCard.jsx:499-508`, `CreateWorkspaceDialog.jsx:18-36`, `WonDealModal.jsx`, `CallNoteModal.jsx:107-108`, `LeadAvatar.jsx`
- **Problème** : Badges relance, templates, titres de modals et avatars utilisent des emoji à côté d’icônes Lucide soignées.
- **Impact** : Look hybride « app système / stickers » ; moins professionnel, hiérarchie brouillée.
- **Correction** : Lucide partout dans le produit ; emoji réservés au picker d’icônes sidebar (choix explicite).

### Échelle typographique absente (`text-[10px]` → `text-[13.5px]`)
- **Zone** : typographie
- **Fichier** : répandu (`LeadCard`, `KanbanColumn`, `WorkspacesPage`, `TopBar`, `ImportProfilesManager`…)
- **Problème** : Dizaines de tailles pixel one-shot, parfois fractionnaires (`12.5`, `11.5`, `10.5`).
- **Impact** : Labels, compteurs et corps ne s’alignent pas optiquement d’une vue à l’autre.
- **Correction** : Ramp Tailwind courte (`caption` 11–12, `body` 13–14, `title` 15–16, `display` 22–28) et bannir les magiques.

### Header de colonne Kanban trop dense
- **Zone** : densité / boutons
- **Fichier** : `KanbanColumn.jsx:331-448`
- **Problème** : Grip + pill nom (`max-w-[160px]`) + compteur + chip tri + badge quick + cloche + menu ⋯ sur une ligne.
- **Impact** : Noms longs tronqués ; en mode tri/quick, pile de pastilles illisible.
- **Correction** : Ligne 1 = nom + count + menu ; tri / quick / cloche dans le menu ou une sous-ligne fine.

### Barre d’actions LeadCard trop serrée
- **Zone** : densité / boutons
- **Fichier** : `LeadCard.jsx:620-664`
- **Problème** : Trois contrôles `h-8` pleine largeur (Contacté / Rappel / Déplacer) dans une carte ~300 px (pire si `cardScale < 1`).
- **Impact** : Labels tronqués, boutons collés, zone tactile confuse.
- **Correction** : Un CTA principal + icônes secondaires avec tooltip, ou un seul overflow « ⋯ ».

### Objectif quotidien « Critique » dès 0 %
- **Zone** : couleur / feedback
- **Fichier** : `DailyGoalWidget.jsx:51-55, 74-98`
- **Problème** : Sous 35 % de progression → barre rose + label « Critique ». Un matin à 0/20 est déjà en alarme.
- **Impact** : Le centre de la TopBar crie l’échec avant même d’avoir commencé la journée.
- **Correction** : Neutre / muted jusqu’à midi ou premier palier ; puis amber → green. Réserver le rose à la fin de journée sous objectif.

### KPI en `#FAFAFA` hors tokens
- **Zone** : couleur / cohérence
- **Fichier** : `WorkspacesPage.jsx:81` ; patterns similaires Stats (`StatsDashboard.jsx`)
- **Problème** : Fond hardcodé `bg-[#FAFAFA]` / `dark:bg-white/[0.04]` au lieu de `--muted` / `--surface`.
- **Impact** : Dérive visuelle vs le reste du thème ; risque de clash borders.
- **Correction** : `bg-muted` ou utilitaire `surface`.

### Charts stats en encre fixe, tokens `chart-*` non branchés
- **Zone** : contraste / dark mode
- **Fichier** : `StatsDashboard.jsx` (hue fixe ~`220 10% 28%`) ; `tailwind.config.js:57-63` (`chart.1–5` déclarés mais vides côté CSS)
- **Problème** : Traits/barres en slate fixe ; les variables chart Tailwind ne sont pas définies dans `:root`.
- **Impact** : En dark mode, graphiques peu contrastés ; système de design incomplet.
- **Correction** : Définir `--chart-1…5` et les consommer dans le dashboard.

### Filtres / avatars incohérents entre vues
- **Zone** : cohérence
- **Fichier** : `ListView.jsx:111`, `PipelineView.jsx:106` vs `LeadAvatar.jsx`
- **Problème** : Liste / Pipeline affichent un emoji brut ; le Kanban passe par logo → favicon → emoji.
- **Impact** : Le même lead change de visage selon la vue.
- **Correction** : Réutiliser `LeadAvatar` partout.

### Suppression workspace visible seulement au hover
- **Zone** : interaction / tactile
- **Fichier** : `WorkspacesPage.jsx:221-228`
- **Problème** : Bouton delete en `opacity-0 group-hover:opacity-100`.
- **Impact** : Sur tactile, la suppression est invisible / difficile à découvrir.
- **Correction** : Toujours visible sur `pointer: coarse`, ou menu ⋯ permanent sur la carte.

### Panel détail : toutes les sections au même poids
- **Zone** : hiérarchie
- **Fichier** : `LeadDetailPanel.jsx` (blocs `rounded-xl border p-4 shadow-sm` empilés)
- **Problème** : Contact, notes, tags, deal, extras, relances, historique partagent le même chrome carte.
- **Impact** : Scroll long sans zone primaire ; fatigue visuelle.
- **Correction** : Un bloc héro (identité + actions) ; le reste en sections muted / séparateurs.

### Footer import CSV qui wrap en pile désordonnée
- **Zone** : layout / boutons
- **Fichier** : `CsvImportModal.jsx:1274-1320`
- **Problème** : Retour / Annuler / Sauver profil / CTA primaire en `flex-wrap` sans groupes stables.
- **Impact** : Sur dialog étroit, les boutons se réorganisent sans logique gauche/droite.
- **Correction** : Footer sticky : secondaires à gauche, primaire à droite ; texte CTA tronqué.

### Marque « Mon CRM » vs « CRM »
- **Zone** : identité
- **Fichier** : `WorkspacesPage.jsx:284` vs `Sidebar.jsx:426`
- **Problème** : Deux libellés produit selon l’écran.
- **Impact** : Continuité de marque faible.
- **Correction** : Une constante `APP_NAME` partout.

### Échelle z-index ad hoc
- **Zone** : layout / superposition
- **Fichier** : CrashRecovery `z-[9999]`, StorageError `z-[9998]`, modals `60–70`, panel `40–50`, goal editor `50`
- **Problème** : Pas d’échelle documentée.
- **Impact** : Bannières système peuvent masquer TopBar / modals de façon imprévisible.
- **Correction** : Échelle courte : chrome → panel → modal → toast → system.

### EmptyState : puits d’icône transparent
- **Zone** : hiérarchie
- **Fichier** : `EmptyState.jsx:17` + `index.css` (`.surface-2 { background: transparent }`)
- **Problème** : L’icône est dans un carré « surface-2 » sans fond.
- **Impact** : Empty states (si réutilisés) paraissent inachevés.
- **Correction** : `bg-muted` pour le well.

---

## 🟡 Priorité basse

### Double séparateur dans le menu settings
- **Fichier** : `TopBar.jsx:535-536`
- **Problème** : Deux `DropdownMenuSeparator` consécutifs → trou vide.
- **Correction** : N’en garder qu’un.

### Aide mode rapide = lettre « i » custom
- **Fichier** : `TopBar.jsx:225-226`
- **Problème** : Pastille 20×20 avec un « i » texte au lieu de Lucide `Info`.
- **Correction** : Icône Lucide alignée sur le reste.

### `ColorPickerRow` : ring offset sans fond
- **Fichier** : `ColorPickerRow.jsx:22`
- **Problème** : `ring-offset-2` sans `ring-offset-background` → halo sale en dark.
- **Correction** : Ajouter `ring-offset-background`.

### Deux `@keyframes placeholderPulse` divergents
- **Fichier** : `index.css:294-297` vs `App.css:45-48`
- **Problème** : Animations d’insertion drag différentes selon cascade.
- **Correction** : Un seul keyframes.

### KPI workspaces `22px` vs Stats `28px`
- **Fichier** : `WorkspacesPage.jsx:85` vs `StatsDashboard.jsx`
- **Problème** : Même famille de tuiles, poids typo différent.
- **Correction** : Composant `KpiTile` unique.

### Onboarding benefits sans wrap mobile
- **Fichier** : `WorkspacesPage.jsx:443-447`
- **Problème** : Rangée `flex gap-6` horizontale fixe.
- **Impact** : Sur ~360 px, compression / overflow.
- **Correction** : `flex-col sm:flex-row` ou wrap.

### Centrage modal : transform Tailwind + inline
- **Fichier** : `MeetingModal.jsx:83-84` (pattern similaire CallNote)
- **Problème** : `-translate-x-1/2` et `style={{ transform: translate(-50%, -50%) }}` se battent.
- **Correction** : Une seule stratégie de centrage.

### Zone drop colonne `bg-white/30`
- **Fichier** : `KanbanColumn.jsx` (état drop)
- **Problème** : Wash blanc faible en dark / sur colonnes teintées.
- **Correction** : `bg-primary/10` + `border-primary/40`.

### Token `--bg-gradient` violet inutilisé
- **Fichier** : `index.css:64-75, 112-113`
- **Problème** : Gradient light avec touche purple défini puis `body` reste plat ; dark l’annule.
- **Impact** : Signal de design contradictoire (Apple blue + reste purple).
- **Correction** : Supprimer le token mort, ou l’appliquer volontairement une seule fois.

### Contact dupliqué possible sur la carte
- **Fichier** : `LeadCard.jsx:538-540` (+ ordre des `cardFields`)
- **Problème** : `contact` sous le titre *et* potentiellement dans les field rows.
- **Impact** : Double ligne grise sur cartes denses.
- **Correction** : Exclure du body si déjà rendu en header.

### Import CSV / profils : micro-UI trop dense
- **Fichier** : `CsvImportModal.jsx`, `ImportProfilesManager.jsx` (`text-[10px]` / boutons `h-7`)
- **Problème** : Outil puissance dense dès l’ouverture.
- **Correction** : Progressive disclosure + captions ≥ 12 px.

### Pipeline KPI : 3ᵉ tuile seule sur mobile
- **Fichier** : `PipelineView.jsx:43-63`
- **Problème** : `grid-cols-2` laisse la 3ᵉ métrique orpheline.
- **Correction** : `grid-cols-1` xs, ou span full-width pour la 3ᵉ.

---

## ✅ Ce qui fonctionne déjà bien

- **Tokens HSL** (`--primary` systemBlue, surfaces, dark) : bonne base produit.
- **Kanban** : snap colonnes, scrollbars fines, placeholder d’insertion, hover lift des cartes.
- **Famille de modals** (appel / RDV / deal) : structure header / body / footer + glass cohérente.
- **Focus-visible** et selection stylés dans `index.css`.
- **Safe-area** notch + sheet mobile sidebar : intention mobile réelle.
- **Config carte** (largeur, échelle, champs visibles) : rare et utile.
- **Stats** : densité assumée, tabs soulignés, sobriété globale (hors hue chart).

---

## Plan d’amélioration global

### 1. Contrat design unique (1–2 jours)
1. Fusionner / élaguer `App.css` : plus de doublons shadow, drag, glass, keyframes.
2. Documenter une **échelle z-index** et une **échelle type** dans `tailwind.config.js`.
3. Définir `--chart-1…5` et `--surface` utilisés partout (bannir `#FAFAFA`).

### 2. Kit de composants chrome (3–5 jours)
Créer et généraliser :
- `IconButton` (taille unique `w-9`)
- `PrimaryButton` / `SecondaryButton` / `DangerButton`
- `KpiTile`
- `StatusPill` (sans emoji canal → Lucide Phone/Mail/…)
- `SectionCard` (panel détail : variante `hero` | `quiet`)

### 3. Respiration TopBar & board (2–3 jours)
- TopBar 2 rangées sur `< lg` : rangée 1 identité + overflow ; rangée 2 recherche / goal / vues.
- Vues toujours accessibles sur mobile.
- Headers colonnes allégés ; action bar carte → 1 CTA + overflow.

### 4. Politique icônes & marque (1 jour)
- Lucide = UI produit ; emoji = picker seulement.
- Une string `APP_NAME`.
- Harmoniser avatars via `LeadAvatar` dans List / Table / Pipeline.

### 5. Feedback émotionnel (0,5 jour)
- Goal quotidien : neutre → progress → succès (pas d’alarme matinale).
- Charts : contrast dark OK.
- Touch targets : classe dédiée, pas blanket CSS.

---

## Corrections spécifiques prioritaires (checklist)

| # | Action | Fichier(s) | Effort |
|---|--------|------------|--------|
| 1 | Exposer le switcher de vues sur mobile | `TopBar.jsx` | S |
| 2 | Overflow menu TopBar + search full-width | `TopBar.jsx` | M |
| 3 | Supprimer doublons styles cartes dans `App.css` | `App.css`, `index.css` | S |
| 4 | Restreindre `min-height: 40px` à `.touch-target` | `index.css` | S |
| 5 | Aligner ThemeToggle sur `w-9` | `ThemeToggle.jsx` | S |
| 6 | Unifier Primary CTA (`bg-primary` ou `bg-foreground`, un rayon) | pages + modals | M |
| 7 | Remplacer emoji canaux/badges par Lucide | `LeadCard.jsx`, modals | M |
| 8 | Ramp typo Tailwind + purge `text-[Npx]` critiques | config + composants hot | L |
| 9 | Alléger header colonne + action bar carte | `KanbanColumn`, `LeadCard` | M |
| 10 | Soften DailyGoal couleurs matinales | `DailyGoalWidget.jsx` | S |
| 11 | `bg-muted` à la place de `#FAFAFA` | `WorkspacesPage`, Stats | S |
| 12 | Brancher tokens chart + contraste dark | `index.css`, `StatsDashboard` | M |
| 13 | `LeadAvatar` dans List / Pipeline | `ListView`, `PipelineView` | S |
| 14 | Delete workspace always-visible on touch | `WorkspacesPage` | S |
| 15 | Footer CSV groupé L/R | `CsvImportModal` | S |

*(S = < 1 h, M = demi-journée, L = journée+)*

---

## Cible visuelle recommandée

Passer de **6,5 → ~8 / 10** sans redesign total, en visant :

> **Une app Notion-like claire** : un bleu primaire, un rayon, une taille d’icône, une TopBar qui respire, des cartes avec *une* action évidente, Lucide partout, dark mode sans hardcodes.

Les gros gains ne sont pas de nouveaux gradients ou animations : c’est **moins de boutons visibles à la fois**, **une seule feuille de styles**, et **la même composante réutilisée** d’un écran à l’autre.
