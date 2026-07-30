#!/usr/bin/env bash
# Prépare resources/whisper + icônes pour la build Rellia (large-v3-q5 embarqué).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/whisper"
ICONS_SRC="$ROOT/src-tauri/icons-whisper"
ICONS_DEST="$ROOT/src-tauri/icons"
SSD_BIN="/Volumes/disque dur externe 1/Rellia-whisper/bin"
SSD_MODEL="/Volumes/disque dur externe 1/Rellia-whisper/models/ggml-large-v3-q5_0.bin"

mkdir -p "$DEST"

if [[ ! -x "$SSD_BIN/whisper-cli" ]]; then
  echo "Manque whisper-cli : $SSD_BIN/whisper-cli" >&2
  exit 1
fi
if [[ ! -f "$SSD_MODEL" ]]; then
  echo "Manque modèle : $SSD_MODEL" >&2
  exit 1
fi

echo "→ Copie CLI + dylibs…"
rsync -a --delete \
  --exclude '.DS_Store' \
  "$SSD_BIN/" "$DEST/"

echo "→ Copie modèle large-v3-q5 (~1 Go)…"
rsync -a "$SSD_MODEL" "$DEST/ggml-large-v3-q5_0.bin"

if command -v install_name_tool >/dev/null 2>&1; then
  install_name_tool -add_rpath "@loader_path" "$DEST/whisper-cli" 2>/dev/null || true
fi

chmod +x "$DEST/whisper-cli"

# Icône distincte (ondes) — Tauri lit bundle.icon → icons/
if [[ -f "$ICONS_SRC/icon.icns" ]]; then
  echo "→ Applique icons-whisper → icons/ (logo ondes vocales)…"
  rsync -a \
    --exclude 'icon-source.png' \
    --exclude '_*.png' \
    --exclude '.gitkeep' \
    "$ICONS_SRC/" "$ICONS_DEST/"
fi

ls -lh "$DEST/whisper-cli" "$DEST/ggml-large-v3-q5_0.bin" "$ICONS_DEST/icon.icns"
echo "OK resources + icônes prêtes"
