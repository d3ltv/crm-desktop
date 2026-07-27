# Spec visuelle Kanban — CRM  
**Objectif :** passer le board de ~6,5/10 à 10/10  
**Inspiration :** Stripe · Notion · Apple HIG · Google Material 3  
**Contrainte :** même praticité (drag, quick mode, notes, filtres, undo, multi-vues)  
**Statut :** proposition à valider — **aucun code dans ce document**

---

## 0. Brief produit (inchangé)

> Un Kanban commercial aussi calme qu’un document Notion, aussi précis qu’un dashboard Stripe, aussi tactile qu’une app Apple — où chaque carte n’a qu’une chose à dire, et où la couleur n’apparaît que quand le deal le mérite.

---

## 1. Design system — tokens cibles

### 1.1 Couleurs (rôles uniquement)

| Token | Light | Dark | Usage |
|-------|-------|------|--------|
| `background` | blanc pur / quasi blanc froid | charcoal ~8 % | fond app |
| `surface` | gris froid ~98 % | ~10 % | chrome, topbar |
| `surface-2` | gris ~96–97 % | ~12 % | fond colonne |
| `card` | blanc | ~18–22 % (plus clair que colonne) | carte lead |
| `foreground` | near-black | ~94 % | texte |
| `muted` | gris texte ~50 % | ~55 % | meta, compteurs |
| `primary` | systemBlue `#007AFF` | blue ~58 % L | **seule** action principale |
| `success` | emerald contenu | emerald désaturé | RDV bientôt / won |
| `warning` | amber | amber | rappel dû aujourd’hui |
| `destructive` | systemRed | systemRed | erreurs / delete |

**Interdit :** purple glow, accents emerald sur les CTA génériques, `#FAFAFA` hardcodé, multi-couleurs de boutons “primaires”.

### 1.2 Rayons

| Token | Valeur | Usage |
|-------|--------|--------|
| `radius-sm` | 8 px | chips, icon buttons |
| `radius-md` | 12 px | boutons, inputs, cartes |
| `radius-lg` | 16–20 px | colonnes, panels |
| `radius-xl` | 24 px | modals / sheets |

### 1.3 Ombres (3 niveaux max)

| Token | Usage |
|-------|--------|
| `shadow-none` | carte au repos (bordure 1 px `border` suffit) |
| `shadow-card-hover` | hover carte : lift 1 px + ombre très légère |
| `shadow-panel` | modals, popovers, panel détail |

### 1.4 Typographie (échelle fermée)

| Nom | Taille | Poids | Usage |
|-----|--------|-------|--------|
| `caption` | 11–12 | medium | labels, compteurs, kbd |
| `body` | 13 | regular | meta carte, menus |
| `body-strong` | 13–14 | semibold | titre carte, items liste |
| `title` | 15 | semibold | titre workspace TopBar |
| `display` | 22–28 | semibold | KPI (hors board) |

- Chiffres : toujours `tabular-nums`.  
- Plus de tailles magiques (`10`, `12.5`, `11.5`).  
- Labels uppercase : caption + tracking 0.06 + muted.

### 1.5 Iconographie

- **Lucide uniquement** dans l’UI produit (stroke 1.75).  
- Taille chrome : **16 px** dans TopBar ; **13–14 px** dans cartes.  
- Emoji : **uniquement** dans le picker d’icônes sidebar (choix utilisateur).

### 1.6 Espacements

Grille 4 : 4 / 8 / 12 / 16 / 20 / 24 / 32.  
Gap colonnes board : **16–20 px**.  
Padding carte : **12–14 px**.  
Hauteur TopBar rangée 1 : **56 px** (`h-14`).

### 1.7 Z-index (échelle documentée)

| Couche | z | Exemples |
|--------|---|---------|
| Board | 0 | colonnes, cartes |
| Chrome | 20 | TopBar sticky, sidebar |
| Panel | 40 | Lead detail side |
| Modal | 60 | Call / Meeting / Won |
| Overlay modal | 70 | focus sheet |
| Toast | 80 | sonner |
| System | 90 | CrashRecovery, StorageError |

### 1.8 Touch

Classe `.touch-target` uniquement sur CTA chrome (min 40×40).  
**Pas** sur micro-contrôles (dismiss badge, grip, chips).

---

## 2. Shell — TopBar

### 2.1 Rangée 1 (toujours)

**Layout :** `grid [1fr | auto | 1fr]`, hauteur 56 px, fond `background/95` + blur léger, border-b hairline.

| Zone | Contenu | Règles |
|------|---------|--------|
| **Gauche** | Hamburger (mobile) · expand sidebar · **titre workspace** 15 semibold · (secteur caption muted, desktop) · **vues segmentées avec labels** | Vues : control `muted` rounded-lg, item actif = fond `card` + shadow-sm. **Toujours icône + libellé** (Kanban / Liste / Table / Pipeline) — jamais icon-only. Friction = 0. |
| **Centre** | Quick-mode pill (si actif) · DailyGoal | Goal : neutre tant que ratio &lt; 35 % (pas de rouge “Critique” le matin). Sur xs : goal optionnel / dans settings. |
| **Droite** | Recherche · Notifs · Champs cartes · ⋯ overflow · Settings · **Nouveau** | Max ~6 contrôles visibles. CTA Nouveau = `bg-primary` text white, label court « Nouveau ». |

**Overflow ⋯ contient :** Annuler · Rétablir · Thème (desktop).

### 2.2 Rangée 2 — recherche (si ouverte)

Pleine largeur sous la rangée 1 :

- Chips filtres (primary soft) + « Tout effacer ».  
- Input full-width, hauteur 36, `rounded-lg`, fond `secondary/70`.  
- Esc ferme ; Enter pin un filtre tag.

### 2.3 Rangée mobile — vues

Sous `sm` : segmented control pleine largeur (déjà en place) — icône + label dès `xs`.

### 2.4 Sensation cible

Rail calme type **Apple / Notion**. Aucun wrap chaotique entre 768 et 1100 px.

---

## 3. Colonnes Kanban

### 3.1 Conteneur colonne

- Fond : `surface-2` (pas de dégradé).  
- Radius : `radius-lg`.  
- Largeur : pilotée par `columnWidth` (existant).  
- Mobile : snap + ~88 vw (existant) — conserver.

### 3.2 Header (une seule ligne)

```
[ grip ]  ● Nom de colonne     12    [ ⋯ ]
```

| Élément | Spec |
|---------|------|
| Grip | Visible au hover groupe ; 12 px ; opacity faible |
| Pastille couleur | Cercle **8×8** ou barre **3×14** — **pas** de pill pleine colorée avec texte blanc |
| Nom | body-strong 13, truncate max ~180 px ; double-clic = rename |
| Compteur | caption muted tabular |
| Indicateurs discrets | Si tri actif : petite flèche primary. Si auto-followup : cloche 11 muted. **Pas** de badge « Actif » quick mode dans le header |
| Menu ⋯ | `ml-auto`, hit area 28–32 |

**Tout le reste** (quick mode, rappel auto, note à l’arrivée, tri, couleur, delete) → **menu uniquement**.

### 3.3 Zone liste / drop

- Padding horizontal 4–8.  
- Drop actif : fond `primary/4`, outline dashed `primary/40` inset.  
- Placeholder insertion : hauteur 3–4 px, primary soft, pulse unique (un seul `@keyframes`).

### 3.4 Footer colonne

Bouton « Ajouter » ghost / dashed discret, pleine largeur, caption — style Notion « New ».

---

## 4. Carte lead (cœur du 10/10)

### 4.1 Structure (ordre vertical fixe)

```
┌──────────────────────────────────────────┐
│ [Avatar]  Entreprise                 ⋯   │  1. Identité
│           Contact (si visible)           │
│                                          │
│ ▌ RDV · mar. 24 · 14h30                  │  2. Statut (0 ou 1 bandeau)
│                                          │
│ 01 42…  ·  site  ·  #tag                 │  3. Meta (1 ligne max)
│                                          │
│ [ Contacté          ]   [📅] [↔]         │  4. Actions
│                                          │
│ Contacté il y a 2 h                      │  5. Footer timestamps (muted)
└──────────────────────────────────────────┘
```

### 4.2 Identité

- Avatar 28–32 : Clearbit → favicon → **initiale** dans cercle teinté (plus d’emoji random sur le board).  
- Titre : body-strong 14, truncate 1 ligne.  
- Contact : caption muted, 1 ligne ; **ne pas** redoubler dans les field rows si déjà sous le titre.  
- Menu ⋯ carte (option futur) : actions rares ; pour l’instant overflow peut rester absent si actions déjà en barre.

### 4.3 Bandeau statut (mutuellement exclusif, priorité)

1. RDV passé → rose soft + label  
2. RDV &lt; 24 h → emerald soft + border-left 3 px success  
3. Stale 3j+ → pastille unique top-right (pas + bandeau)  
4. Relance auto due → amber soft  
5. Sinon : rien

**Un seul** signal fort à la fois. Badges relance emoji → remplacer par Lucide canal + compteur `R3` si besoin.

### 4.4 Meta

Une seule rangée : phone · email/site · tags (max 2–3 visibles + « +N »).  
Séparateurs middot ou gaps 8. Copy-on-click conserve la praticité.

### 4.5 Action bar

| Contrôle | Traitement |
|----------|------------|
| **Contacté / Relancé** | CTA flex-1, `bg-primary/10` border `primary/25`, texte primary. Succès flash emerald 2 s. |
| **Rappel** | Icon button 32×32, CalendarClock, tooltip |
| **Déplacer** | Icon button 32×32, ArrowRightLeft, popover colonnes inchangé fonctionnellement |

Pas trois boutons texte côte à côte.

### 4.6 États interaction

| État | Rendu |
|------|--------|
| Repos | border 1 px, shadow none |
| Hover | translateY(-1px), shadow-card-hover |
| Dragging | opacity ~0.35, scale 0.97, légère rotation ≤ 0.5° |
| Quick focus | ring primary 2 px |

### 4.7 Contrat RDV (déjà aligné fonctionnellement)

Affichage carte : tout `isManualRdv` (meeting / `📅 RDV` / legacy) → même bandeau.  
Couleur footer nextAction meeting = success.

---

## 5. Modals (Call / Meeting / Won)

### 5.1 Famille commune

- Overlay : `foreground/20` + blur.  
- Sheet : max-width 420, `rounded-3xl`, `glass-strong`, shadow-panel.  
- Centrage : **une** technique (`left-1/2 top-1/2 -translate`).  
- z : overlay 60, sheet 70.

### 5.2 Anatomie

```
[ well 40×40 + icône Lucide ]   Titre
                                Sous-titre = entreprise (truncate)
                                                    [ X ]

Corps : 1 phrase d’aide + champs (gap 12)

Footer :
  [ Passer / Annuler ghost ]          [ Enregistrer primary ]
```

### 5.3 Spécificités

| Modal | Icône well | Primary |
|-------|------------|---------|
| Call note | Phone | Enregistrer |
| Meeting | CalendarCheck | Confirmer le RDV |
| Won | Trophy | Enregistrer la valeur |

Outcome Call (Joint / Pas de réponse) : segmented control, pas deux gros boutons concurrents du primary.

---

## 6. Panel détail lead

### 6.1 Hiérarchie

1. **Hero** : avatar + entreprise + statut colonne (select) + CTA Contacté / RDV. Fond card, padding 20–24.  
2. **Sections quiet** : Notes · Coordonnées · Tags · Deal · Relances · Historique — séparées par hairline ou fond `muted/30`, **sans** chacune une mini-carte shadow.

### 6.2 Modes side / modal

Conserver les deux modes settings ; même anatomie interne. Side : width ~400–440, shadow-panel.

---

## 7. Autres vues (cohérence)

| Vue | Règle |
|-----|--------|
| Liste / Pipeline | Réutiliser **LeadAvatar** (pas emoji brut) |
| Table | Même typo caption/body ; row height stable |
| Filtres tags | Appliquer aussi List/Table/Pipeline (cohérence produit ; hors purement “peau” mais requis pour sensation 10/10) |

---

## 8. Motion — budget strict

| ID | Déclencheur | Animation |
|----|-------------|-----------|
| M1 | Hover carte | translateY(-1) + shadow, 150 ms ease-out |
| M2 | Placeholder drop | height + opacity, 120 ms |
| M3 | Ouverture modal | opacity + scale 0.98→1, 200 ms |

Interdit : bounce, confettis, glow pulse sauf `.pulse-dot` overdue (discret).

---

## 9. Dark mode — checklist

- [ ] Carte plus claire que fond colonne  
- [ ] Pas de `bg-white/30` drop zone → `primary/10`  
- [ ] Charts stats : tokens `chart-1…5` (contraste OK)  
- [ ] Ring color pickers : `ring-offset-background`  
- [ ] Ombres carte dark : noires, pas de rim blanc excessif  

---

## 10. Accessibilité & praticité (non négociable)

- Focus-visible ring 2 px primary (existant — conserver).  
- Tooltips sur tous les icon-only.  
- Delete workspace : visible sur coarse pointer (pas hover-only).  
- Cmd+Z / Esc / Enter inchangés.  
- Quick mode raccourcis inchangés.  
- Aucune feature retirée : import, scale carte, champs visibles, auto-followup, etc.

---

## 11. Critères d’acceptation « 10/10 »

Le board est **validé** si un observateur externe dit :

1. « On dirait un produit Stripe/Notion, pas un side-project. »  
2. « Je vois immédiatement quoi faire sur une carte. »  
3. « La TopBar ne me stresse pas. »  
4. « Light et dark sont aussi soignés l’un que l’autre. »  
5. « Je n’ai rien perdu en vitesse de travail. »

Mesures proxy :

- ≤ **1** CTA plein par carte  
- ≤ **6** contrôles dans la TopBar rangée 1 (hors titre/vues)  
- Header colonne : **≤ 4** éléments interactifs visibles  
- **0** emoji dans le chrome produit  
- **1** ombre hover carte (une seule définition CSS)

---

## 12. Ordre d’implémentation recommandé

| Phase | Scope | Impact ressenti |
|-------|--------|-----------------|
| **A** | Tokens + purge tailles magiques + Lucide-only chrome | Cohérence immédiate |
| **B** | Carte lead (anatomie §4) | Wow principal |
| **C** | Header colonne (§3) | Board “aéré” |
| **D** | TopBar polish (§2) si écart restant | Shell premium |
| **E** | Modals + panel (§5–6) | Finitions Awwwards |
| **F** | Motion M1–M3 + dark pass | Sensation produit fini |

---

## 13. Hors scope (volontairement)

- Refonte marketing / landing  
- Illustrations custom / 3D  
- Changement d’architecture state  
- Auth / sync cloud  

---

## 14. Validation

Merci de valider ou annoter :

- [ ] Direction globale (tokens + brief) OK  
- [ ] Anatomie carte §4 OK  
- [ ] Header colonne sans pill pleine OK  
- [ ] TopBar overflow + search row OK  
- [ ] Avatar = initiale (plus emoji board) OK / à discuter  

**Une fois validé**, l’implémentation peut suivre phase A → F sans ambiguïté.

---

## 15. Solution appliquée — Quiet Board + cartes compactes (2026-07)

> Correctif post-capture : le chrome était calme, les **cartes** restaient un dump CSV.

### 15.1 Diagnostic (capture)

1. Cartes = mur de liens bleus + champs longs → illisible à 100+ leads  
2. Colonnes « blocs gris » trop proches du fond → peu de contraste  
3. « + Nouveau lead » dans RDV / Proposition → faux signal métier  

### 15.2 Règles carte (board)

```
┌─────────────────────────────────────┐
│ [■] Entreprise              [badge] │  identité
│     sous-titre (1 highlight max)    │
│     RDV · …                         │  0–1 signal
│  01… · Ballan · CDI    [🔗][📍][in] │  meta + icônes liens
│  [Contacté]  [📅] [↔]               │  hover only
│  21/07 23:37                        │  1 ligne footer
└─────────────────────────────────────┘
```

| Règle | Détail |
|-------|--------|
| Liens | Jamais d’URL / label long en bleu : **icône 24×24** + tooltip |
| Texte long | > ~48 car. ou label type description → **hors carte** (panel) |
| Highlight | **1 seul** sous-titre, sans ★ ni « Label · » |
| Meta | Tél · chips courts (max 3) · tags max 2 |
| Actions | Hover / focus / tactile (déjà) |
| Empty colonne | « Nouveau lead » **uniquement** si colonne type Nouveau ; sinon vide calme |

### 15.3 Colonnes

- Fond colonne : **transparent** (pas de well lait)  
- Header inchangé (pastille + nom + count)  
- Cartes blanches = seule surface opaque du board  

## 16. Besoin réel — vente vidéo recrutement (annonces scrapées)

### Contexte produit

L’utilisateur importe des **annonces d’emploi scrapées (CSV)** dans le CRM.  
Objectif commercial : vendre une **vidéo de recrutement** à l’entreprise qui a publié l’annonce.  
La douleur vendue = le recrutement en cours ; la preuve = l’annonce sous les yeux.

Donc chaque carte board doit répondre en 1 seconde à :

1. **Qui** recrute ? (entreprise)  
2. **Quel poste** ? (intitulé annonce — cœur du pitch)  
3. **Où / quel contrat** ? (ville, CDI…)  
4. **Comment joindre / vérifier** ? (tél + liens source / recherche)  

Pas un dump CSV. Pas une carte « nom seul ». Un **brief d’appel**.

### Anatomie carte « brief recrutement »

```
┌──────────────────────────────────────────┐
│ [■] Entreprise                    badge  │
│     Poste (intitulé) — 2 lignes max      │  ← toujours visible, fort
│     📍 Ville · CDI                       │
│     ☎ 02…          [HW][Maps][in][🔍]   │  liens = icônes, toujours visibles
│     RDV · …                              │  si pertinent
│     [Relancé] [📅] [↔]                   │  hover
│     21/07 23:37                          │
└──────────────────────────────────────────┘
```

| Élément | Règle |
|---------|--------|
| Poste | Champ highlight / labels Poste·Intitulé·Titre·Job — **jamais** masqué |
| Lieu + contrat | Chips explicites (Localisation, Contrat, Type…) |
| Description annonce | **Hors carte** (panel) — trop long pour le board |
| Liens | Icônes **toujours visibles** (pas seulement hover) — source annonce + Maps + LinkedIn |
| Tél | Ligne dédiée, cliquable |

## 17. Fiche lead (grande) — layout 3 zones

**Zone A (fixe)** : Identité header · Brief annonce (poste/lieu/contrat/tél/liens) · Prochaine action / RDV unique  
**Zone B** : sections réordonnables (drag) + masquer → `workspace.panelSections`  
**Zone C** : menu **Données cachées** (restaurer)  

Défaut ordre : imported → contact → notes → relances → tags → deal → history  
Bouton **+** FieldGroup / highlight « Afficher sur la carte Kanban » conservés.
