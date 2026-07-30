//! whisper.cpp natif (Metal) — binaire + modèle **embarqués** dans l'app
//! (`Contents/Resources/whisper/`).
//!
//! Fallback optionnel : variables d'env / app data (dev). Pas de dépendance SSD.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::Manager;

const MODEL_NAME: &str = "ggml-large-v3-q5_0.bin";

const FR_PROMPT: &str =
    "Appel commercial en français. Bonjour, allô, rendez-vous, RDV, \
     mettre un rendez-vous, demain à 8 heures 15, vendredi prochain, \
     s'il vous plaît, téléphone, email, prospect.";

static TRANSCRIBE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    pub available: bool,
    pub engine: String,
    pub cli_path: Option<String>,
    pub model_path: Option<String>,
    pub model_name: String,
    pub detail: String,
    pub bundled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperResult {
    pub text: String,
    pub segments: Vec<WhisperSegment>,
    pub engine: String,
    pub model_path: String,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir)
}

fn resource_whisper_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok()?;
    let candidates = [
        res.join("whisper"),
        res.join("resources/whisper"),
        res.join("_up_/resources/whisper"),
    ];
    candidates.into_iter().find(|p| p.is_dir())
}

fn candidate_cli_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("RELIA_WHISPER_CLI") {
        let t = p.trim();
        if !t.is_empty() {
            out.push(PathBuf::from(t));
        }
    }
    // 1) Bundle app (priorité)
    if let Some(dir) = resource_whisper_dir(app) {
        out.push(dir.join("whisper-cli"));
        out.push(dir.join("bin/whisper-cli"));
    }
    if let Ok(res) = app.path().resource_dir() {
        out.push(res.join("whisper-cli"));
        out.push(res.join("whisper/whisper-cli"));
    }
    // 2) Dev / data locale
    if let Ok(dir) = data_dir(app) {
        out.push(dir.join("whisper/bin/whisper-cli"));
        out.push(dir.join("whisper/whisper-cli"));
    }
    out
}

fn candidate_model_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("RELIA_WHISPER_MODEL") {
        let t = p.trim();
        if !t.is_empty() {
            out.push(PathBuf::from(t));
        }
    }
    if let Some(dir) = resource_whisper_dir(app) {
        out.push(dir.join(MODEL_NAME));
        out.push(dir.join("models").join(MODEL_NAME));
    }
    if let Ok(res) = app.path().resource_dir() {
        out.push(res.join(MODEL_NAME));
        out.push(res.join("whisper").join(MODEL_NAME));
        out.push(res.join("models").join(MODEL_NAME));
    }
    if let Ok(dir) = data_dir(app) {
        out.push(dir.join("whisper/models").join(MODEL_NAME));
        out.push(dir.join("whisper").join(MODEL_NAME));
    }
    out
}

fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|p| p.is_file()).cloned()
}

fn model_looks_valid(path: &Path) -> bool {
    fs::metadata(path)
        .map(|m| m.len() > 500_000_000) // large-v3-q5 ~1.1 Go
        .unwrap_or(false)
}

fn is_under_resources(app: &tauri::AppHandle, path: &Path) -> bool {
    let Ok(res) = app.path().resource_dir() else {
        return false;
    };
    path.starts_with(&res)
}

pub fn resolve_status(app: &tauri::AppHandle) -> WhisperStatus {
    let cli = first_existing(&candidate_cli_paths(app));
    let model = first_existing(&candidate_model_paths(app)).filter(|p| model_looks_valid(p));
    let bundled = match (&cli, &model) {
        (Some(c), Some(m)) => is_under_resources(app, c) && is_under_resources(app, m),
        _ => false,
    };
    let available = cli.is_some() && model.is_some();
    let detail = match (&cli, &model, bundled) {
        (Some(_), Some(_), true) => "whisper.cpp Metal embarqué (large-v3-q5)".into(),
        (Some(_), Some(_), false) => "whisper.cpp Metal prêt (externe)".into(),
        (None, Some(_), _) => "Binaire whisper-cli manquant dans l'app".into(),
        (Some(_), None, _) => format!("Modèle {MODEL_NAME} manquant dans l'app"),
        (None, None, _) => "whisper.cpp non embarqué dans cette build".into(),
    };
    WhisperStatus {
        available,
        engine: "whisper.cpp".into(),
        cli_path: cli.map(|p| p.to_string_lossy().into_owned()),
        model_path: model.map(|p| p.to_string_lossy().into_owned()),
        model_name: MODEL_NAME.into(),
        detail,
        bundled,
    }
}

fn write_wav_f32_mono(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let n = samples.len() as u32;
    let data_bytes = n.saturating_mul(2); // i16 PCM
    let mut f = fs::File::create(path).map_err(|e| format!("create wav: {e}"))?;
    f.write_all(b"RIFF").map_err(|e| e.to_string())?;
    f.write_all(&(36u32 + data_bytes).to_le_bytes())
        .map_err(|e| e.to_string())?;
    f.write_all(b"WAVE").map_err(|e| e.to_string())?;
    f.write_all(b"fmt ").map_err(|e| e.to_string())?;
    f.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    let byte_rate = sample_rate * 2;
    f.write_all(&byte_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&2u16.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(b"data").map_err(|e| e.to_string())?;
    f.write_all(&data_bytes.to_le_bytes()).map_err(|e| e.to_string())?;
    for &s in samples {
        let clipped = s.clamp(-1.0, 1.0);
        let i = (clipped * 32767.0).round() as i16;
        f.write_all(&i.to_le_bytes()).map_err(|e| e.to_string())?;
    }
    f.sync_all().ok();
    Ok(())
}

fn decode_pcm_f32_base64(pcm_base64: &str) -> Result<Vec<f32>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pcm_base64.trim())
        .map_err(|e| format!("base64 pcm: {e}"))?;
    if bytes.len() < 4 || bytes.len() % 4 != 0 {
        return Err("PCM invalide (Float32 LE attendu)".into());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(out)
}

fn parse_whisper_json(raw: &str) -> Result<(String, Vec<WhisperSegment>), String> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("json whisper: {e}"))?;
    let mut segments = Vec::new();
    if let Some(arr) = v.get("transcription").and_then(|x| x.as_array()) {
        for item in arr {
            let text = item
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if text.is_empty() {
                continue;
            }
            let start = item
                .get("offsets")
                .and_then(|o| o.get("from"))
                .and_then(|x| x.as_f64())
                .map(|ms| ms / 1000.0)
                .unwrap_or(0.0);
            let end = item
                .get("offsets")
                .and_then(|o| o.get("to"))
                .and_then(|x| x.as_f64())
                .map(|ms| ms / 1000.0)
                .unwrap_or(start);
            segments.push(WhisperSegment { start, end, text });
        }
    }
    if segments.is_empty() {
        if let Some(arr) = v.get("segments").and_then(|x| x.as_array()) {
            for item in arr {
                let text = item
                    .get("text")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if text.is_empty() {
                    continue;
                }
                let start = item.get("start").and_then(|x| x.as_f64()).unwrap_or(0.0);
                let end = item.get("end").and_then(|x| x.as_f64()).unwrap_or(start);
                segments.push(WhisperSegment { start, end, text });
            }
        }
    }

    let text = if !segments.is_empty() {
        segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        v.get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    Ok((text, segments))
}

fn tmp_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("whisper/tmp");
    fs::create_dir_all(&dir).map_err(|e| format!("tmp: {e}"))?;
    Ok(dir)
}

pub fn transcribe_pcm_base64(
    app: &tauri::AppHandle,
    pcm_base64: String,
    sample_rate: Option<u32>,
    language: Option<String>,
) -> Result<WhisperResult, String> {
    let _guard = TRANSCRIBE_LOCK
        .lock()
        .map_err(|_| "transcription déjà en cours".to_string())?;

    let status = resolve_status(app);
    let cli = status
        .cli_path
        .clone()
        .ok_or_else(|| status.detail.clone())?;
    let model = status
        .model_path
        .clone()
        .ok_or_else(|| status.detail.clone())?;

    let samples = decode_pcm_f32_base64(&pcm_base64)?;
    if samples.is_empty() {
        return Err("audio vide".into());
    }
    let sr = sample_rate.unwrap_or(16_000).max(8_000);
    let lang = language
        .unwrap_or_else(|| "fr".into())
        .trim()
        .to_lowercase();
    let lang = if lang.is_empty() { "fr".into() } else { lang };

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = tmp_dir(app)?;
    let wav_path = dir.join(format!("relia_{stamp}.wav"));
    let out_prefix = dir.join(format!("relia_{stamp}_out"));
    write_wav_f32_mono(&wav_path, &samples, sr)?;

    let cli_path = PathBuf::from(&cli);
    let cli_dir = cli_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    // cwd = dossier du binaire → charge les .dylib via @rpath/@loader_path
    let output = Command::new(&cli)
        .current_dir(&cli_dir)
        .env("DYLD_LIBRARY_PATH", &cli_dir)
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(&wav_path)
        .arg("-l")
        .arg(&lang)
        .arg("-t")
        .arg("4")
        .arg("-np")
        .arg("-oj")
        .arg("-of")
        .arg(&out_prefix)
        .arg("--prompt")
        .arg(FR_PROMPT)
        .output()
        .map_err(|e| format!("whisper-cli: {e}"))?;

    let _ = fs::remove_file(&wav_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let _ = fs::remove_file(out_prefix.with_extension("json"));
        return Err(format!(
            "whisper-cli exit {}: {}\n{}",
            output.status.code().unwrap_or(-1),
            stderr.trim(),
            stdout.trim()
        ));
    }

    let json_path = out_prefix.with_extension("json");
    let raw = fs::read_to_string(&json_path).map_err(|e| format!("read json: {e}"))?;
    let _ = fs::remove_file(&json_path);
    let _ = fs::remove_file(out_prefix.with_extension("txt"));

    let (text, segments) = parse_whisper_json(&raw)?;
    Ok(WhisperResult {
        text,
        segments,
        engine: "whisper.cpp".into(),
        model_path: model,
    })
}

#[tauri::command]
pub fn crm_whisper_status(app: tauri::AppHandle) -> Result<WhisperStatus, String> {
    Ok(resolve_status(&app))
}

#[tauri::command]
pub fn crm_whisper_transcribe(
    app: tauri::AppHandle,
    pcm_base64: String,
    sample_rate: Option<u32>,
    language: Option<String>,
) -> Result<WhisperResult, String> {
    transcribe_pcm_base64(&app, pcm_base64, sample_rate, language)
}
