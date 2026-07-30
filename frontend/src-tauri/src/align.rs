//! Alignement Relia sur la version officielle (upgrade ou rollback).
//! Remplace uniquement le bundle app — jamais app_data_dir / crm_state.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct PendingAlign(pub Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignOffer {
    pub version: String,
    pub current_version: String,
    pub notes: String,
    pub reason: String,
    pub date: Option<String>,
}

fn normalize_ver(v: &str) -> String {
    v.trim().trim_start_matches('v').trim_start_matches('V').to_string()
}

fn reason_for(current: &str, remote: &str, body: &str) -> String {
    let body_l = body.to_lowercase();
    if body_l.contains("rollback") || body_l.contains("retour") {
        return "rollback".into();
    }
    // Compare loosely on dotted nums
    let parse = |s: &str| -> Vec<u64> {
        normalize_ver(s)
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let a = parse(current);
    let b = parse(remote);
    let len = a.len().max(b.len());
    for i in 0..len {
        let da = a.get(i).copied().unwrap_or(0);
        let db = b.get(i).copied().unwrap_or(0);
        if db < da {
            return "rollback".into();
        }
        if db > da {
            return "update".into();
        }
    }
    "update".into()
}

/// Vérifie official.json (endpoint updater) en autorisant le downgrade.
/// Stocke le handle d’install pour `crm_align_install`.
#[tauri::command]
pub async fn crm_align_check(
    app: AppHandle,
    pending: State<'_, PendingAlign>,
) -> Result<Option<AlignOffer>, String> {
    let updater = app
        .updater_builder()
        .version_comparator(|current, remote| remote.version != current)
        .build()
        .map_err(|e| format!("updater build: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("updater check: {e}"))?;

    let Some(update) = update else {
        let _ = pending.0.lock().map(|mut g| g.take());
        return Ok(None);
    };

    let current = normalize_ver(&update.current_version);
    let remote = normalize_ver(&update.version);
    if current == remote {
        let _ = pending.0.lock().map(|mut g| g.take());
        return Ok(None);
    }

    let notes = update.body.clone().unwrap_or_default();
    let reason = reason_for(&current, &remote, &notes);
    // Prefer reason from raw JSON if present
    let reason = update
        .raw_json
        .get("reason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(reason);

    let date = update.date.map(|d| d.to_string());
    let offer = AlignOffer {
        version: remote,
        current_version: current,
        notes,
        reason,
        date,
    };

    *pending
        .0
        .lock()
        .map_err(|_| "pending lock".to_string())? = Some(update);

    Ok(Some(offer))
}

/// Télécharge, vérifie la signature, installe. Le front appelle ensuite relaunch.
#[tauri::command]
pub async fn crm_align_install(pending: State<'_, PendingAlign>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|_| "pending lock".to_string())?
        .take()
        .ok_or_else(|| "Aucune mise à jour en attente — relance un check.".to_string())?;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| format!("install: {e}"))?;

    Ok(())
}

/// Annule une offre en attente (dismiss).
#[tauri::command]
pub fn crm_align_clear(pending: State<'_, PendingAlign>) -> Result<(), String> {
    *pending
        .0
        .lock()
        .map_err(|_| "pending lock".to_string())? = None;
    Ok(())
}
