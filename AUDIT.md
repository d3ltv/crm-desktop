# Audit du code — CRM Kanban

## 🔴 Priorité critique (bugs actifs, comportement cassé)

### Restauration de backup : la pile undo n’est pas vidée
- **Fichier** : `frontend/src/context/CrmContext.jsx:1807-1815` (aussi `App.js:15-17` via `RESTORE_SNAPSHOT`)
- **Problème** : `importBackup` et la restauration crash appellent `RESTORE_SNAPSHOT` / `rawDispatch` sans vider `undoStackRef` / `redoStackRef`.
- **Impact** : Après restauration d’un backup, Cmd+Z peut réappliquer l’état *pré-restauration* et écraser les données tout juste récupérées.

### Contrat RDV cassé entre MeetingModal et le reste de l’app
- **Fichier** : `frontend/src/components/MeetingModal.jsx:54-68`
- **Problème** : Le modal enregistre `label: "RDV — …"` (ou un label libre) avec `meeting: true`, alors que board, colonnes, cartes, contexte et détail exigent `label.startsWith("📅 RDV")` (`WorkspacePage.jsx:124`, `KanbanBoard.jsx:127`, `KanbanColumn.jsx:221`, `LeadCard.jsx:217`, `CrmContext.jsx:667`, `LeadDetailPanel.jsx:826`).
- **Impact** : Un RDV saisi via le modal n’est pas reconnu comme RDV : le modal peut se rouvrir, le tri urgent ignore la carte, et un déplacement vers une colonne auto-followup peut écraser le rendez-vous.

### CallNoteModal déplace un lead avec RDV détecté vers la colonne rappel
- **Fichier** : `frontend/src/components/CallNoteModal.jsx:126-140`
- **Problème** : Dès qu’un `appointment` est détecté, `shouldMove` envoie le lead vers `autoFollowupColumn` (colonne de rappel), pas vers une colonne rendez-vous.
- **Impact** : Une note qui mentionne un RDV range le lead dans la mauvaise colonne et empêche l’ouverture du MeetingModal via `onAutoMoved`.

### `isContactedColumn` matche trop large (`includes("contact")`)
- **Fichier** : `frontend/src/constants/columnPatterns.js:21-26, 68-70`
- **Problème** : Le motif `"contact"` fait matcher « À contacter », « Non contacté », « recontacter », etc. Ces colonnes sont ensuite traitées comme « déjà contactées » (stale, auto-move `LOG_CONTACT`, `promptNoteOnEnter`, timestamps).
- **Impact** : Un lead dans « À contacter » peut être marqué stale, ne plus être déplacé correctement, ou déclencher des prompts/automations de colonne contactée à tort.

### `MOVE_LEAD` diverge de `MOVE_LEAD_ORDERED` (écrasement RDV + ordre)
- **Fichier** : `frontend/src/context/CrmContext.jsx:653-717` vs `831-873` (appelant `LeadDetailPanel.jsx:360-367`)
- **Problème** : Le changement de statut depuis le panneau utilise `MOVE_LEAD`, qui n’a pas la garde `📅 RDV`, écrase `nextAction` si la cible a `autoFollowup`, et ne met pas à jour `leadOrder`.
- **Impact** : Changer le statut depuis le détail peut détruire un RDV (y compris ceux avec seulement `meeting: true`) et désynchroniser l’ordre des cartes par rapport au drag-and-drop.

### Dates calendaires dérivées via UTC (`toISOString().slice(0, 10)`)
- **Fichier** : `frontend/src/context/CrmContext.jsx:171-174` ; aussi `frontend/src/lib/statsUtils.js:346-366, 394-404` ; `CallNoteModal.jsx:174`
- **Problème** : `isoToDate` et plusieurs agrégations stats convertissent une date locale en clé jour via UTC. Exemple : `2026-07-23 01:30` (CEST) → `2026-07-22`.
- **Impact** : Rappels, champs date et buckets stats « par jour » peuvent être décalés d’un jour pour un usage macOS en fuseau Europe/Paris.

### Réimport CSV toujours en append, sans rapprochement avec les leads existants
- **Fichier** : `frontend/src/components/CsvImportModal.jsx:987-1014` + `CrmContext.jsx` (`BULK_ADD_LEADS`)
- **Problème** : La déduplication ne porte que sur les lignes du fichier. Chaque import crée de nouveaux IDs dans la première colonne.
- **Impact** : Réimporter le même export double le pipeline, gonfle le stockage local et pollue les stats.

### `lastOpenedId` lu mais jamais écrit
- **Fichier** : `frontend/src/components/WorkspacesPage.jsx:264` ; `CrmContext.jsx:398-399` (`SELECT_WORKSPACE` ne pose que `currentId`)
- **Problème** : Le badge / tri « Récent » s’appuie sur `state.lastOpenedId`, qui n’existe nulle part dans le reducer.
- **Impact** : L’espace « récent » est toujours le dernier de `order` (souvent le plus récemment créé), pas le dernier ouvert.

### LeadAvatar saute le fallback favicon après échec Clearbit
- **Fichier** : `frontend/src/components/LeadAvatar.jsx:45-49`
- **Problème** : `domain` n’est calculé que si `!logoFailed && !logoUrl`. Après `onError` sur Clearbit, `logoFailed` est vrai → `domain` reste `null` → emoji direct.
- **Impact** : Les logos Clearbit cassés n’utilisent jamais Google Favicon, pourtant prévu dans la chaîne de repli.

### Regex téléphone exclut les numéros 01 (Paris)
- **Fichier** : `frontend/src/lib/noteParser.js:17-22`
- **Problème** : Le motif utilise `0(?:[2-9])`, donc exclut explicitement le 01. Le commentaire du fichier prétend couvrir les fixes nationaux courants.
- **Impact** : Un numéro parisien dans une note n’est jamais proposé en autofill.

### `PHONE_RE.test()` global sans reset entre customFields
- **Fichier** : `frontend/src/lib/noteParser.js:108-112`
- **Problème** : Dans le `forEach` des customFields, `.test()` avance `lastIndex` ; le reset n’a lieu qu’après la boucle.
- **Impact** : Un second téléphone déjà présent peut ne pas être détecté → suggestion en doublon dans les champs.

### Suppression / undo toast : `leadOrder` incohérent
- **Fichier** : `frontend/src/context/CrmContext.jsx:1024-1045` ; toast dans `LeadDetailPanel.jsx:520-530`
- **Problème** : `DELETE_LEAD` retire le lead de `leads` mais pas de `leadOrder`. `RESTORE_LAST_DELETED` réinjecte le lead sans réparer l’ordre.
- **Impact** : Après « Annuler » du toast, la carte réapparaît souvent en fin de colonne, contrairement à un undo Cmd+Z (snapshot complet).

### `ADD_COLUMN` n’initialise pas `promptNoteOnEnter`
- **Fichier** : `frontend/src/context/CrmContext.jsx:537-548` vs `138-145` (`makeWorkspace`)
- **Problème** : Les colonnes créées à la main n’ont pas `promptNoteOnEnter: shouldPromptNote(name)`, contrairement aux templates.
- **Impact** : Une colonne « Contacté » ajoutée manuellement n’ouvre pas le modal de note tant que l’option n’est pas cochée à la main.

### Restauration depuis backup localStorage corrompu : migrations incomplètes
- **Fichier** : `frontend/src/context/CrmContext.jsx:228-236` vs `218-222`
- **Problème** : Le chemin de secours (parse de `BACKUP_KEY`) retourne l’objet brut sans appliquer les défauts `columnWidth` / `cardScale`.
- **Impact** : Après corruption du state principal, l’UI peut charger avec largeur/échelle de cartes absentes ou incorrectes.

### « CA » / « deals closés » agrègent tout `dealValue`
- **Fichier** : `frontend/src/lib/statsUtils.js:113-124` ; labels `StatsDashboard.jsx:940-952` ; `SET_DEAL_VALUE` pose `dealClosedAt` pour toute valeur non nulle (`CrmContext.jsx:1378-1391`)
- **Problème** : `totalRevenue` somme tous les leads valorisés, toutes colonnes confondues ; l’UI parle de « Chiffre d’affaires » et « Moyenne des deals closés ».
- **Impact** : Les KPI affichent un CA gonflé par des deals encore en pipeline (voire en « Perdu »).


## 🟠 Priorité haute (incohérences, fragilités probables)

### README / backend décrivent une app cloud-auth inexistante
- **Fichier** : `README.md:71-99` vs `frontend/src/App.js` + `frontend/src/context/CrmContext.jsx` ; `backend/server.py`
- **Problème** : Le README documente `AuthContext`, `api.js`, AuthPage, JWT et sync Mongo. Aucun de ces modules n’existe côté React ; l’app est 100 % localStorage/IndexedDB. Le backend FastAPI n’est branché à rien.
- **Impact** : Suivre le README fait démarrer Mongo/auth inutiles ; le vrai modèle de données (local-only) n’est pas documenté.

### Trois formats de RDV coexistent selon le point d’entrée
- **Fichier** : `MeetingModal.jsx:62-68` ; `CallNoteModal.jsx:184-189` ; `LeadDetailPanel.jsx:423-428`
- **Problème** : MeetingModal → `meeting: true` sans préfixe `📅 RDV` ; parse note / détail → `📅 RDV détecté · …` souvent sans `meeting`.
- **Impact** : Urgence, tri, protection anti-écrasement et réouverture de modals dépendent du chemin utilisé pour créer le RDV.

### `columnColors` et `columnPatterns` se contredisent sur « à contacter »
- **Fichier** : `frontend/src/lib/columnColors.js:137-146` vs `frontend/src/constants/columnPatterns.js:21-70`
- **Problème** : Les couleurs classent « à contacter » comme bleu / nouveau ; les patterns le classent comme contacté via `includes("contact")`. Le fichier patterns se dit « source unique de vérité » mais les règles couleurs sont dupliquées ailleurs.
- **Impact** : Couleur, automations et stats peuvent classer la même colonne dans deux rôles différents.

### Filtres tags actifs uniquement en vue Kanban
- **Fichier** : `frontend/src/components/WorkspacePage.jsx:286-305` ; application dans `KanbanBoard.jsx:70-111`
- **Problème** : `activeFilters` est passé à `KanbanBoard` seulement ; List / Table / Pipeline ne reçoivent que `filter` texte.
- **Impact** : Les pastilles de filtre restent visibles alors que List/Table/Pipeline ignorent les tags — résultats trompeurs au changement de vue.

### Aperçu template Jobs ≠ colonnes réellement créées
- **Fichier** : `CreateWorkspaceDialog.jsx:32` vs `CrmContext.jsx:102-108`
- **Problème** : Le dialogue montre « Candidatures », « Technique », « Proposition » ; `makeWorkspace("jobs")` crée « Candidatures envoyées », « Entretien Technique », « Proposition reçue ».
- **Impact** : L’utilisateur ne retrouve pas les noms promis à la création.

### Double écriture localStorage (state + copie backup) à chaque save
- **Fichier** : `frontend/src/context/CrmContext.jsx:258-276`
- **Problème** : Avant chaque écriture de `crm_state_v1`, l’ancien blob est recopié dans `crm_state_v1_backup` — usage ~2× du quota (~5 Mo typique).
- **Impact** : `QuotaExceeded` arrive plus tôt ; sauvegarde principale échoue alors qu’il reste encore de la place pour un seul snapshot.

### Undo/dispatch exécute le reducer deux fois (`uid()` divergent)
- **Fichier** : `frontend/src/context/CrmContext.jsx:1607-1620, 1659-1672`
- **Problème** : Pour construire `{before, after}`, le reducer tourne une première fois, puis `rawDispatch` le rejoue. Les actions qui appellent `uid()` (`ADD_LEAD`, `BULK_ADD_LEADS`, notes…) génèrent des IDs différents entre snapshot redo et état live.
- **Impact** : Après import/création, Redo peut restaurer des IDs fantômes ; sélections / liens internes peuvent pointer vers des leads inexistants.

### Transaction IndexedDB invalidée par `await` intermédiaire
- **Fichier** : `frontend/src/lib/autoBackup.js:58-72`
- **Problème** : `saveBackup` fait `await put` puis `await getAllKeys` sur la même transaction ; une transaction IDB se commit dès que le microtask yield.
- **Impact** : Rotation des backups peut échouer silencieusement (`TransactionInactiveError` avalée) → rétention > 10 snapshots ou pas de rotation.

### `beforeunload` lance un `saveBackup` async non garanti
- **Fichier** : `frontend/src/context/CrmContext.jsx:1722-1732`
- **Problème** : Le commentaire parle de backup « synchrone » IndexedDB, mais `saveBackup` est async et n’est pas attendu ; le navigateur coupe souvent le handler.
- **Impact** : Le filet IndexedDB à la fermeture d’onglet est aléatoire (le `saveState` localStorage synchrone, lui, est OK).

### Memo `LeadCard` ignore `columnOrder` / `columns`
- **Fichier** : `frontend/src/components/LeadCard.jsx:720-726`
- **Problème** : Le comparateur custom ne regarde pas `workspace.columnOrder` ni `workspace.columns`.
- **Impact** : Après réordonnancement de colonnes sans mutation du lead, le popover « déplacer » peut afficher un ordre obsolète jusqu’à un autre re-render.

### Modals colonne : un seul lead traité si plusieurs bougent
- **Fichier** : `frontend/src/components/WorkspacePage.jsx:92-128`
- **Problème** : La boucle écrase `setCallNoteLeadId` / `setWonLeadId` / `setMeetingLeadId` à chaque lead déplacé.
- **Impact** : En déplacement multi-cartes (ou batch futur), seuls les prompts du dernier lead s’affichent.

### Import backup sans confirmation destructive
- **Fichier** : `frontend/src/components/WorkspacesPage.jsx:249-260` ; `CrmContext.jsx:1807-1815`
- **Problème** : Choisir un fichier JSON remplace immédiatement tout l’état, sans dialogue (contrairement à CrashRecovery).
- **Impact** : Un mauvais fichier ou un clic accidentel efface le CRM local courant (récupérable seulement via undo fragile / IndexedDB).

### Fuite potentielle du listener scroll (TableView)
- **Fichier** : `frontend/src/components/TableView.jsx:35-39, 82-85`
- **Problème** : `attachScroll` retourne une fonction de cleanup, mais le callback ref l’ignore ; quand `attachScroll` change d’identité, d’anciens listeners peuvent rester.
- **Impact** : Handlers scroll empilés → travail inutile et `setRange` multiples sur de grandes tables.


## 🟡 Priorité moyenne (code mort, artefacts)

### Composant `EmptyState` jamais monté
- **Fichier** : `frontend/src/components/EmptyState.jsx:1-30`
- **Problème** : Aucun import sous `frontend/src` ; WorkspacePage gère son propre empty state inline.
- **Impact** : Fichier mort à maintenir sans effet runtime.

### Virtualisation ListView construite mais non utilisée
- **Fichier** : `frontend/src/components/ListView.jsx:27-71, 85-175`
- **Problème** : `useVirtualList` calcule `range` / `flatLeads`, mais le rendu itère encore tous les `colLeads` ; `range` n’est jamais lu.
- **Impact** : Coût scroll inutile ; grosses listes restent O(n) en DOM.

### Helpers morts dans LeadCard
- **Fichier** : `frontend/src/components/LeadCard.jsx:95-108, 284-325`
- **Problème** : `LinkBtn`, `DataRow`, `LinksRow` sont définis et jamais utilisés dans le rendu.
- **Impact** : Bruit de lecture, risque de « réparer » du code déjà abandonné.

### Imports inutilisés dans CrmContext
- **Fichier** : `frontend/src/context/CrmContext.jsx:16-18`
- **Problème** : `isNouveauColumn`, `isWonColumn`, `isMeetingColumn` sont importés ; seul `isContactedColumn` est utilisé.
- **Impact** : Dette lint / confusion sur les dépendances réelles du reducer.

### `formatRelative` exporté jamais consommé
- **Fichier** : `frontend/src/lib/dateUtils.js:13-26`
- **Problème** : Aucun autre fichier n’importe cette fonction.
- **Impact** : API morte à côté de helpers réellement utilisés.

### Registre testIds auth orphelin
- **Fichier** : `frontend/src/constants/testIds/auth.js` (+ `index.js`)
- **Problème** : Constantes LOGIN/REGISTER pour une UI d’auth absente ; aucun composant ne les référence.
- **Impact** : Artefact de l’ancienne architecture documentée dans le README.

### React Query monté sans aucune query
- **Fichier** : `frontend/src/index.js:35-49`
- **Problème** : `QueryClientProvider` enveloppe l’app ; aucun `useQuery` / `useMutation` dans le code applicatif.
- **Impact** : Couche data-fetching fantôme, bundle et indirection inutiles.

### Dépendances npm jamais importées
- **Fichier** : `frontend/package.json:34-57` (ex. `axios`, `dayjs`, `lodash`, `date-fns`, `recharts`, `react-router-dom`, `swr`)
- **Problème** : Aucun `import` de ces packages sous `frontend/src` (les graphiques stats sont custom ; pas de router).
- **Impact** : Install/build plus lourds ; fausse impression d’architecture charting/routing/HTTP.

### ~30 composants `ui/` shadcn jamais référencés hors du dossier ui
- **Fichier** : `frontend/src/components/ui/` (ex. `accordion`, `carousel`, `menubar`, `pagination`, `toast`, `drawer`, …)
- **Problème** : Générés / scaffoldés mais non utilisés par les composants métier (qui importent un sous-ensemble : dialog, button, input, popover, etc.).
- **Impact** : Surface de code large sans valeur runtime actuelle.

### Backend Models / API non consommés
- **Fichier** : `backend/server.py:75-85` (et fichier entier vs frontend)
- **Problème** : `WorkspaceIn` / `WorkspaceOut` définis mais inutilisés ; aucun client frontend n’appelle `/api`.
- **Impact** : Code serveur orphelin ; double vérité « local vs Mongo » non tranchée dans le repo.

### Variable `contacts` calculée puis ignorée
- **Fichier** : `frontend/src/components/WorkspacesPage.jsx:42-51`
- **Problème** : `wsStats` calcule `contacts` sans l’afficher ni le retourner aux KPI.
- **Impact** : Calcul mort à chaque rendu de la page espaces.


## 🔵 Priorité basse (lisibilité, maintenabilité)

### `CrmContext.jsx` monolithique (~1840 lignes)
- **Fichier** : `frontend/src/context/CrmContext.jsx:1-1840`
- **Problème** : Persistence, migrations, undo, sidebar, followups, import/export et toutes les mutations cohabitent dans un seul module.
- **Impact** : Toute évolution (ex. unifier `MOVE_LEAD`) touche un fichier critique sans frontières claires — risque élevé de régression.

### Normalisation de texte / en-têtes CSV réimplémentée plusieurs fois
- **Fichier** : `frontend/src/lib/csvUtils.js` ; `importProfiles.js` ; `noteParser.js`
- **Problème** : Strip d’accents / normalisation de clés dupliqués avec de petites divergences (underscores, etc.).
- **Impact** : Un fix de mapping dans un fichier ne se propage pas ; comportements d’import subtillement différents.

### `aggregateStats` moyenne des moyennes de durées
- **Fichier** : `frontend/src/lib/statsUtils.js:192-195`
- **Problème** : L’agrégat multi-workspaces fait la moyenne d’averages par workspace, non une moyenne pondérée.
- **Impact** : Un petit workspace fausse la durée moyenne globale affichée.

### `ADD_NOTE` met toujours à jour `lastContact`
- **Fichier** : `frontend/src/context/CrmContext.jsx:1050-1068` (ex. no-answer via `CallNoteModal.jsx:117-123`)
- **Problème** : Même « 📵 Pas de réponse » pousse `lastContact` comme un contact réussi.
- **Impact** : Activité / « dernier contact » mélangent joints et échecs d’appel.

### Copy DailyGoal « reset 00:01 » vs logique date
- **Fichier** : `frontend/src/components/DailyGoalWidget.jsx:131-132` vs `32-47`
- **Problème** : L’UI annonce un reset à 00:01 ; le comptage est purement basé sur la date des `statusHistory`, sans timer.
- **Impact** : Texte trompeur (comportement réel OK au changement de jour calendaire).

### `stopAutoBackup` ne annule pas le `setTimeout` initial 10 s
- **Fichier** : `frontend/src/lib/autoBackup.js:157-177`
- **Problème** : Seul l’intervalle est clear ; le timeout de démarrage n’a pas d’id stocké.
- **Impact** : En StrictMode / remount rapide, un backup fantôme peut encore partir après unstop.


## ❓ À vérifier (doutes non confirmés)

### Boucle de streak d’appels potentiellement fragile aux frontières de jour
- **Fichier** : `frontend/src/lib/statsUtils.js:392-415`
- **Problème** : Le chemin « aujourd’hui vide → regarder hier → `continue` » est difficile à raisonner ; combiné aux clés UTC, le badge streak peut être faux.
- **Impact** : Badge de régularité incorrect.
- **Raison du doute** : Pas de fixture timezone/midnight exécutée ; la logique pourrait être correcte pour le cas nominal diurne.

### Mapping CSV `contact` vs colonnes « nom / last_name »
- **Fichier** : `frontend/src/lib/csvUtils.js:133-148, 374-381`
- **Problème** : Les hints `contact` incluent `"nom"` / `"last_name"` alors qu’une logique de prénom/nom existe aussi — un CSV FR pourrait mapper le nom de famille dans `contact` et laisser d’autres colonnes ambiguës.
- **Impact** : Champ contact mal rempli à l’import.
- **Raison du doute** : Dépend fortement du fichier source ; non reproduit sur un jeu d’exemples ici.


## 📊 Synthèse

- **Nombre total de problèmes par catégorie**
  - Bug / comportement incorrect : **15**
  - Incohérence : **5**
  - Fragilité : **8**
  - Code mort ou artefact : **11**
  - Lisibilité / maintenabilité : **6**
  - À vérifier : **2**
  - **Total confirmés (hors À vérifier) : 45**

- **Les 3 problèmes à corriger en premier**
  1. **Vider undo/redo à chaque restauration complète** — seul bug qui peut *détruire* des données locales après une récupération réussie.
  2. **Unifier le contrat RDV (`📅 RDV` + `meeting`) et aligner `MOVE_LEAD` / CallNoteModal** — cascade de comportements cassés dès qu’on planifie un rendez-vous.
  3. **Resserrer `isContactedColumn` (et l’aligner avec `columnColors`)** — faux positifs qui faussent stale, auto-moves et prompts sur des colonnes « à contacter ».
