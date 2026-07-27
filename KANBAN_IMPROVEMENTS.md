# Améliorations de la vue Kanban

Rapport de travail — suivi des tâches d'amélioration UX/UI du board Kanban.
Mise à jour au fur et à mesure des implémentations.

---

## ✅ Fait

> Dernière mise à jour : implémentation P1.1, P1.2 + bonus P4.15

### P1.1 — Drag & drop avec feedback visuel pendant le déplacement
- **Problème :** Aucun aperçu stylisé pendant le glissement, aucun placeholder dans la colonne de destination, pas d'indication de la position d'insertion précise.
- **Solution implémentée :**
  - Placeholder visuel animé (pointillés pulsants) qui apparaît entre les cartes pendant le drag
  - La colonne de destination "ouvre" un espace à la bonne position d'insertion
  - Le drop zone de la colonne est renforcé visuellement (fond + bordure claire)
  - Custom drag image semi-transparente remplace le ghost natif du navigateur

### P1.2 — Réordonnancement des cards dans une colonne
- **Problème :** Impossible de repositionner une carte dans la même colonne (monter/descendre).
- **Solution implémentée :**
  - Ajout de l'action `REORDER_LEADS` dans le reducer CrmContext
  - Chaque workspace stocke maintenant un `leadOrder` (tableau d'IDs ordonné par colonne)
  - Le drag dans la même colonne déplace la carte à la position de drop précise
  - Rétrocompatibilité : les workspaces existants génèrent l'ordre depuis l'ordre actuel

### Bouton "Déplacer" sur chaque carte ✅
- Nouveau composant `MoveColumnButton` dans `LeadCard.jsx`
- Popover avec liste dynamique de toutes les colonnes sauf la courante
- Chaque colonne affiche son point de couleur + nom + chevron
- Un clic dispatch `MOVE_LEAD_ORDERED` et affiche un toast de confirmation
- Si une colonne est ajoutée ou supprimée, la liste se met à jour automatiquement (lit `workspace.columnOrder` en direct)

---

## 🔲 À faire

### P1.3 — Quick-action bar invisible sur mobile/tactile
- **Problème :** La barre d'actions (Contacté aujourd'hui / Rappel) utilise `[@media(hover:hover)]:opacity-0` — invisible sur tous les appareils tactiles.
- **Solution prévue :** Afficher la barre en permanence sur touch devices, masquer uniquement sur hover:hover (desktop). Utiliser une detection CSS media query `(hover: none)` pour toujours afficher.

### P1.4 — Scroll horizontal sans indicateur
- **Problème :** Sur desktop avec beaucoup de colonnes, aucun indicateur visuel que d'autres colonnes existent hors-écran.
- **Solution prévue :** Ajouter des ombres en fondu sur les bords gauche/droit du board pour signaler le scroll, + flèches de navigation optionnelles.

---

## 🔲 Backlog (Priorités 2-4)

### P2.5 — Animations floatIn / card-in non appliquées
- Les keyframes existent dans index.css (`.float-in`, `.card-in`, `.stagger`) mais aucun composant ne les utilise.
- À faire : appliquer `.card-in` sur chaque LeadCard au montage, `.float-in` sur les colonnes.

### P2.6 — Transition au drop trop abrupte
- La carte "pop" instantanément lors du drop. Ajouter une animation de slide/fade à l'insertion.

### P2.7 — Feedback `column-drop-active` trop timide
- Le fond `hsl(primary/0.06)` + outline dashed est quasiment imperceptible.
- Renforcer le contraste, animer l'outline, "ouvrir" visuellement la zone de drop.

### P2.8 — Scrollbar de colonne toujours visible
- La scrollbar 6px est permanente. La masquer au repos, afficher uniquement au hover/scroll.

### P3.9 — Densité variable et incohérente des cartes
- Une carte vide fait ~80px, une carte complète dépasse 250px. Casser le rythme visuel.
- Solution : cap `line-clamp-1` sur la note en vue card, champs extra en tooltip.

### P3.10 — Badge followup qui déborde sur la carte du dessus
- Le badge `-top-1.5 -right-1.5` peut se superposer avec la carte précédente sur colonne dense.
- Solution : intégrer le badge dans le flux de la carte plutôt qu'en `position: absolute`.

### P3.11 — Pas de valeur totale des deals par colonne
- Le header affiche le nombre de leads mais pas la somme des `dealValue`.
- Solution : ajouter `Σ deals` en petit dans le header de colonne.

### P3.12 — Largeur de colonne fixe à 300px
- Impossible d'élargir une colonne. Truncate agressif sur URLs/emails.
- Solution : handle de resize sur le bord droit de chaque colonne.

### P4.13 — Pas de raccourcis clavier
- Aucun raccourci : N pour nouveau lead, Esc pour fermer, etc.
- Solution : hook global `useKeyboard` avec une liste de raccourcis documentés.

### P4.14 — Aucun état de chargement / skeleton
- Pas de skeletons animés pendant le chargement initial.
- Solution : composant `KanbanSkeleton` avec 3 colonnes et ~4 cartes fantômes.

### P4.15 — Rename de colonne déclenché au premier clic ✅ (corrigé en même temps que P1.1/P1.2)
- Supprimé le handler `onClick` sur le titre de colonne. Seul `onDoubleClick` déclenche le rename.
- Le menu "Renommer" dans le dropdown fonctionne toujours normalement.

### P4.16 — Bouton "Ajouter un lead" non sticky en bas de colonne
- Le bouton disparaît quand la colonne est pleine (faut scroller).
- Solution : le bouton est déjà en bas du flex container, vérifier qu'il ne scroll pas avec les cards.

---

## Notes techniques

- **Fichiers principaux modifiés :** `KanbanBoard.jsx`, `KanbanColumn.jsx`, `CrmContext.jsx`
- **CSS kanban :** `src/index.css` — classes `.lead-card`, `.column-drop-active`, `.kanban-col-scroll`
- **Drag & drop :** API HTML5 native (dataTransfer). Pas de librairie externe.
- **State management :** Reducer + localStorage. Pas de server sync.
