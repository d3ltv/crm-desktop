use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

mod align;
mod whisper_native;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir)
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("crm_state_v1.json"))
}

fn backup_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("crm_state_v1_backup.json"))
}

fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("crm_prefs.json"))
}

fn usage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("crm_usage_v1.json"))
}

fn history_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| format!("create backups dir: {e}"))?;
    Ok(dir)
}

fn recordings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("recordings");
    fs::create_dir_all(&dir).map_err(|e| format!("create recordings dir: {e}"))?;
    Ok(dir)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_atomic(path: &PathBuf, payload: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(payload).map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

fn write_atomic_str(path: &PathBuf, payload: &str) -> Result<(), String> {
    write_atomic(path, payload.as_bytes())
}

fn maybe_write_history(app: &tauri::AppHandle, payload: &str) {
    let Ok(dir) = history_dir(app) else { return };
    let Ok(root) = data_dir(app) else { return };
    let marker = root.join(".last_history_ts");
    let now = now_secs();
    let last = fs::read_to_string(&marker)
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);
    if now.saturating_sub(last) < 600 {
        return;
    }
    let path = dir.join(format!("crm_state_{now}.json"));
    if fs::write(&path, payload.as_bytes()).is_ok() {
        let _ = fs::write(&marker, now.to_string());
        prune_history(&dir, 12);
    }
}

fn prune_history(dir: &PathBuf, keep: usize) {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.path()
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("crm_state_") && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| {
        std::cmp::Reverse(
            e.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH),
        )
    });
    for old in entries.into_iter().skip(keep) {
        let _ = fs::remove_file(old.path());
    }
}

#[tauri::command]
fn crm_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn crm_load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read state: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(raw))
}

#[tauri::command]
fn crm_load_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = backup_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read backup: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(raw))
}

#[tauri::command]
fn crm_save_state(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    let path = state_path(&app)?;
    let backup = backup_path(&app)?;
    if path.exists() {
        let _ = fs::copy(&path, &backup);
    }
    write_atomic_str(&path, &payload)?;
    maybe_write_history(&app, &payload);
    Ok(())
}

#[tauri::command]
fn crm_load_prefs(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = prefs_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read prefs: {e}"))?;
    Ok(Some(raw))
}

#[tauri::command]
fn crm_save_prefs(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    write_atomic_str(&prefs_path(&app)?, &payload)
}

#[tauri::command]
fn crm_load_usage(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = usage_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read usage: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(raw))
}

#[tauri::command]
fn crm_save_usage(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    write_atomic_str(&usage_path(&app)?, &payload)
}

#[derive(Debug, Serialize, Deserialize)]
struct RecordingMeta {
    id: String,
    #[serde(rename = "leadId")]
    lead_id: String,
    #[serde(rename = "workspaceId")]
    workspace_id: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    #[serde(rename = "durationMs")]
    duration_ms: u64,
    size: u64,
    peaks: Vec<f64>,
    #[serde(rename = "createdAt")]
    created_at: String,
    preserved: bool,
    #[serde(rename = "downloadedAt")]
    downloaded_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct RecordingPayload {
    meta: RecordingMeta,
    #[serde(rename = "dataBase64")]
    data_base64: String,
}

#[tauri::command]
fn crm_save_recording(
    app: tauri::AppHandle,
    meta: RecordingMeta,
    data_base64: String,
) -> Result<(), String> {
    let dir = recordings_dir(&app)?;
    let id = meta.id.clone();
    let meta_json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("base64: {e}"))?;
    write_atomic(&dir.join(format!("{id}.json")), meta_json.as_bytes())?;
    write_atomic(&dir.join(format!("{id}.bin")), &bytes)?;
    Ok(())
}

#[tauri::command]
fn crm_load_recording(app: tauri::AppHandle, id: String) -> Result<Option<RecordingPayload>, String> {
    let dir = recordings_dir(&app)?;
    let meta_path = dir.join(format!("{id}.json"));
    let bin_path = dir.join(format!("{id}.bin"));
    if !meta_path.exists() || !bin_path.exists() {
        return Ok(None);
    }
    let meta_raw = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let meta: RecordingMeta = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;
    let bytes = fs::read(&bin_path).map_err(|e| e.to_string())?;
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(RecordingPayload { meta, data_base64 }))
}

#[tauri::command]
fn crm_list_recordings(
    app: tauri::AppHandle,
    lead_id: Option<String>,
) -> Result<Vec<RecordingMeta>, String> {
    let dir = recordings_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let meta: RecordingMeta = match serde_json::from_str(&raw) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if let Some(ref lid) = lead_id {
            if &meta.lead_id != lid {
                continue;
            }
        }
        out.push(meta);
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
fn crm_delete_recording(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = recordings_dir(&app)?;
    let _ = fs::remove_file(dir.join(format!("{id}.json")));
    let _ = fs::remove_file(dir.join(format!("{id}.bin")));
    Ok(())
}

#[tauri::command]
fn crm_update_recording_meta(app: tauri::AppHandle, meta: RecordingMeta) -> Result<(), String> {
    let dir = recordings_dir(&app)?;
    let id = meta.id.clone();
    let meta_json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{id}.json")), meta_json.as_bytes())
}

/// Ouvre une URL / mailto / tel dans l’app système (Safari, Mail, Téléphone…).
/// Nécessaire sous Tauri : le webview ne gère pas `target=_blank` comme un navigateur.
#[tauri::command]
fn crm_open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("url vide".into());
    }
    let ok = trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("mailto:")
        || trimmed.starts_with("tel:");
    if !ok {
        return Err("schéma non autorisé".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("open: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("start: {e}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("xdg-open: {e}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("plateforme non supportée".into())
}

/// Relia Console : lance publish-update.sh ou set-official.sh (GH_TOKEN injecté).
#[tauri::command]
fn crm_console_run_script(
    script: String,
    args: Vec<String>,
    github_token: Option<String>,
    set_version: Option<String>,
) -> Result<String, String> {
    let allowed = ["publish-update.sh", "set-official.sh"];
    if !allowed.contains(&script.as_str()) {
        return Err(format!("script non autorisé: {script}"));
    }

    let resource = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let candidates = [
        PathBuf::from("scripts").join(&script),
        PathBuf::from("../scripts").join(&script),
        PathBuf::from("frontend/scripts").join(&script),
    ];
    let mut script_path = None;
    for c in &candidates {
        if c.is_file() {
            script_path = Some(c.clone());
            break;
        }
    }
    if script_path.is_none() {
        if let Some(dir) = resource {
            let p = dir.join("scripts").join(&script);
            if p.is_file() {
                script_path = Some(p);
            }
        }
    }
    let script_path = script_path.ok_or_else(|| {
        format!("Script introuvable: {script} (lance la Console depuis frontend/)")
    })?;

    let work_dir = script_path
        .parent()
        .and_then(|scripts| scripts.parent())
        .ok_or_else(|| "work dir".to_string())?
        .to_path_buf();

    let key_path = work_dir.join("src-tauri/.updater-keys/relia.key");

    let mut cmd = std::process::Command::new("bash");
    cmd.arg(&script_path);
    for a in &args {
        cmd.arg(a);
    }
    cmd.current_dir(&work_dir);
    if let Some(token) = github_token.filter(|t| !t.trim().is_empty()) {
        cmd.env("GH_TOKEN", token.trim());
        cmd.env("GITHUB_TOKEN", token.trim());
    }
    if let Some(ver) = set_version.filter(|v| !v.trim().is_empty()) {
        cmd.env("RELIA_SET_VERSION", ver.trim().trim_start_matches('v'));
    }
    if key_path.is_file() {
        cmd.env(
            "TAURI_SIGNING_PRIVATE_KEY_PATH",
            key_path.to_string_lossy().as_ref(),
        );
    }

    let output = cmd
        .output()
        .map_err(|e| format!("spawn {script}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "Échec {script} (code {:?})\n{stderr}\n{stdout}",
            output.status.code()
        ));
    }
    Ok(if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(align::PendingAlign(std::sync::Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Updater = remplace Relia.app seulement. Les data restent dans app_data_dir
            // (crm_state_v1.json, recordings/, …) — ne jamais changer identifier.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let _ = data_dir(app.handle());
            let _ = recordings_dir(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crm_data_dir,
            crm_load_state,
            crm_load_backup,
            crm_save_state,
            crm_load_prefs,
            crm_save_prefs,
            crm_load_usage,
            crm_save_usage,
            crm_save_recording,
            crm_load_recording,
            crm_list_recordings,
            crm_delete_recording,
            crm_update_recording_meta,
            crm_open_url,
            align::crm_align_check,
            align::crm_align_install,
            align::crm_align_clear,
            crm_console_run_script,
            whisper_native::crm_whisper_status,
            whisper_native::crm_whisper_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
