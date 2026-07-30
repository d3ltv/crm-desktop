#!/usr/bin/env bash
# Publie Rellia (pas Relia perso) sur GitHub + pointeur official.json.
#
# Modes :
#   1) Depuis une .app déjà prête (SSD) — défaut si RELIA_APP_PATH pointe vers une app :
#        RELIA_APP_PATH="/Volumes/disque dur externe 1/Rellia.app" yarn desktop:publish-update
#   2) Build source Rellia (whisper SSD + variant relia2) :
#        RELIA_PUBLISH_MODE=build yarn desktop:publish-update
#
# Relia perso (yarn desktop / Relia.app) n’utilise PAS ce canal.
# Env : GH_TOKEN, RELIA_SET_VERSION, RELIA_UPDATE_REPO, TAURI_SIGNING_PRIVATE_KEY_PATH

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$ROOT/src-tauri/.updater-keys/relia.key}"
if [[ ! -f "$KEY_PATH" ]]; then
  echo "Clé manquante : $KEY_PATH"
  exit 1
fi

PRODUCT_NAME="Rellia"
DEFAULT_APP="/Volumes/disque dur externe 1/Rellia.app"
APP_PATH="${RELIA_APP_PATH:-$DEFAULT_APP}"
PUBLISH_MODE="${RELIA_PUBLISH_MODE:-}"

# Auto : si une .app existe au chemin SSD → mode app, sinon build
if [[ -z "$PUBLISH_MODE" ]]; then
  if [[ -d "$APP_PATH" ]]; then
    PUBLISH_MODE="app"
  else
    PUBLISH_MODE="build"
  fi
fi

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
if [[ -n "${RELIA_SET_VERSION:-}" ]]; then
  VERSION="${RELIA_SET_VERSION#v}"
  echo "→ Version canal → $VERSION"
  # Ne bump que la conf console affichage ; le binaire .app garde sa version interne
  # sauf en mode build où on aligne les manifests source.
  if [[ "$PUBLISH_MODE" == "build" ]]; then
    export RELIA_SET_VERSION="$VERSION"
    node -e '
const fs = require("fs");
const v = process.env.RELIA_SET_VERSION.replace(/^v/i, "");
for (const file of ["src-tauri/tauri.conf.json", "package.json", "src-tauri/tauri.console.conf.json"]) {
  if (!fs.existsSync(file)) continue;
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  j.version = v;
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
}
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
fs.writeFileSync(
  "src-tauri/Cargo.toml",
  cargo.replace(/^version = "[^"]+"/m, "version = \"" + v + "\"")
);
'
  fi
fi

NOTES="${1:-Mise à jour Rellia $VERSION}"
TAG="v${VERSION}"
REPO="${RELIA_UPDATE_REPO:-d3ltv/crm-desktop}"
OFFICIAL_TAG="official"

export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="darwin-aarch64" ;;
  x86_64) PLATFORM="darwin-x86_64" ;;
  *) echo "Arch non supportée : $ARCH"; exit 1 ;;
esac

OUT_DIR="$ROOT/src-tauri/target/release/updater-publish"
mkdir -p "$OUT_DIR"
ASSET_NAME="${PRODUCT_NAME}_${VERSION}_${PLATFORM}.app.tar.gz"
TAR_OUT="$OUT_DIR/$ASSET_NAME"
SIG_OUT="${TAR_OUT}.sig"

if [[ "$PUBLISH_MODE" == "app" ]]; then
  if [[ ! -d "$APP_PATH" ]]; then
    echo "Rellia.app introuvable : $APP_PATH"
    echo "Branche le SSD ou passe RELIA_PUBLISH_MODE=build"
    exit 1
  fi
  echo "→ Package depuis l’app : $APP_PATH"
  # Lire version Info.plist si pas de RELIA_SET_VERSION
  if [[ -z "${RELIA_SET_VERSION:-}" ]]; then
    PLIST_V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
    if [[ -n "$PLIST_V" ]]; then
      VERSION="${PLIST_V#v}"
      TAG="v${VERSION}"
      ASSET_NAME="${PRODUCT_NAME}_${VERSION}_${PLATFORM}.app.tar.gz"
      TAR_OUT="$OUT_DIR/$ASSET_NAME"
      SIG_OUT="${TAR_OUT}.sig"
      NOTES="${1:-Mise à jour Rellia $VERSION}"
    fi
  fi
  APP_DIR="$(cd "$(dirname "$APP_PATH")" && pwd)"
  APP_BASE="$(basename "$APP_PATH")"
  rm -f "$TAR_OUT" "$SIG_OUT"
  # Archive = contenu attendu par l’updater Tauri (le .app à la racine du tar)
  tar -czf "$TAR_OUT" -C "$APP_DIR" "$APP_BASE"
  yarn tauri signer sign -f "$KEY_PATH" "$TAR_OUT"
  if [[ ! -f "$SIG_OUT" ]]; then
    # tauri signer écrit souvent FILE.sig à côté
    if [[ -f "${TAR_OUT}.sig" ]]; then
      true
    else
      echo "Signature .sig introuvable après sign"
      ls -la "$OUT_DIR"
      exit 1
    fi
  fi
else
  echo "→ Build source Rellia (whisper SSD + updater)…"
  bash "$SCRIPTS/stage-whisper-resources.sh"
  DISABLE_ESLINT_PLUGIN=true CI=false REACT_APP_RELIA_VARIANT=relia2 \
    yarn tauri build \
      --config src-tauri/tauri.rellia-connect.conf.json \
      --config src-tauri/tauri.updater-artifacts.conf.json

  MAC_DIR="$ROOT/src-tauri/target/release/bundle/macos"
  BUILT_TAR="$(ls -1 "$MAC_DIR"/*.app.tar.gz 2>/dev/null | head -1 || true)"
  if [[ -z "$BUILT_TAR" || ! -f "$BUILT_TAR" ]]; then
    echo "Artefact updater introuvable dans $MAC_DIR"
    exit 1
  fi
  cp "$BUILT_TAR" "$TAR_OUT"
  cp "${BUILT_TAR}.sig" "$SIG_OUT"
fi

if [[ ! -f "$SIG_OUT" ]]; then
  echo "Manque $SIG_OUT"
  exit 1
fi

export RELIA_V="$VERSION"
export RELIA_NOTES="$NOTES"
export RELIA_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export RELIA_PLATFORM="$PLATFORM"
export RELIA_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET_NAME}"
export RELIA_SIG="$SIG_OUT"
export RELIA_OUT="$OUT_DIR/official.json"
export RELIA_REASON="update"
bash "$SCRIPTS/write-official-json.sh"

ensure_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh CLI absent. Fichiers prêts dans $OUT_DIR"
    exit 0
  fi
}

upload_or_create() {
  local tag="$1"
  local title="$2"
  shift 2
  if gh release view "$tag" --repo "$REPO" >/dev/null 2>&1; then
    gh release upload "$tag" "$@" --repo "$REPO" --clobber
    gh release edit "$tag" --repo "$REPO" --notes "$NOTES" >/dev/null 2>&1 || true
  else
    gh release create "$tag" "$@" --repo "$REPO" --title "$title" --notes "$NOTES"
  fi
}

ensure_gh

echo "→ Release versionnée $TAG (Rellia)…"
upload_or_create "$TAG" "Rellia $VERSION" \
  "$TAR_OUT" \
  "$SIG_OUT" \
  "$OUT_DIR/official.json"

echo "→ Pointeur officiel…"
if gh release view "$OFFICIAL_TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$OFFICIAL_TAG" "$OUT_DIR/official.json" --repo "$REPO" --clobber
  gh release edit "$OFFICIAL_TAG" --repo "$REPO" \
    --title "Rellia official channel" \
    --notes "Pointeur officiel Rellia → $VERSION. Ne pas supprimer." >/dev/null 2>&1 || true
else
  gh release create "$OFFICIAL_TAG" "$OUT_DIR/official.json" \
    --repo "$REPO" \
    --title "Rellia official channel" \
    --notes "Pointeur officiel Rellia → $VERSION." \
    --latest=false
fi

echo ""
echo "OK — Rellia $VERSION officielle (mode=$PUBLISH_MODE)."
echo "App source : ${APP_PATH:-build}"
echo "Endpoint : https://github.com/${REPO}/releases/download/${OFFICIAL_TAG}/official.json"
echo "Note : Relia perso n’est pas sur ce canal."
