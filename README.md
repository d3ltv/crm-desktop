# Relia

CRM desktop local (prospection, relances, pipeline) — encapsulé avec **Tauri 2**.

**Relia** = *reliabilité* + *relances* : un nom court, clair, agréable.

> **Pour Cursor / nouvelle conversation :** lire [`AGENTS.md`](./AGENTS.md) (architecture, DA Quiet Board, stockage, pièges). La règle projet `.cursor/rules/relia-context.mdc` rappelle l’essentiel à chaque session.

## Lancer en dev

```bash
cd frontend
yarn install
yarn desktop
```

## Installer dans Applications

```bash
cd frontend
yarn desktop:build
# puis copier Relia.app vers /Applications
```

## Stockage — 100 % disque (desktop)

Identifiant technique inchangé (`local.crm.desktop`) pour ne pas perdre tes données.

```
~/Library/Application Support/local.crm.desktop/
  crm_state_v1.json          # leads, colonnes, RDV, dates, notes, tags…
  crm_state_v1_backup.json   # backup roulant
  crm_prefs.json             # vues, sidebar, objectifs, notifs lues…
  recordings/                # vocaux d'appels
  backups/                   # snapshots périodiques
```

Sur Relia, le `localStorage` navigateur est **remplacé** par une mémoire sync → `crm_prefs.json`.  
L’état métier ne passe **plus** par le localStorage : uniquement `crm_state_v1.json`.

## CSV

- Import : modal CSV (rapide / avancé), profils d’import, mapping auto
- Export : TopBar → export CSV UTF-8 BOM (Excel-friendly)
- Backup JSON : import / export depuis la page Espaces
