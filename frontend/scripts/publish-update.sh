#!/usr/bin/env bash
# Publie une build Relia signée sur GitHub + pose le pointeur official.json.
#
# - Tag versionné vX.Y.Z : archive .app.tar.gz + .sig + copie official.json
# - Tag mutable `official` : official.json uniquement (ce que Relia lit au démarrage)
#
# Prérequis : clé .updater-keys/relia.key, gh auth (ou GH_TOKEN), version bumpée.
# Usage (frontend/) : yarn desktop:publish-update "Notes"
# Env : RELIA_UPDATE_REPO, GH_TOKEN, TAURI_SIGNING_PRIVATE_KEY_PATH

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$ROOT/src-tauri/.updater-keys/relia.key}"
if [[ ! -f "$KEY_PATH" ]]; then
  echo "Clé manquante : $KEY_PATH"
  echo "Génère-la une fois : yarn tauri signer generate -w src-tauri/.updater-keys/relia.key"
  exit 1
fi

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
if [[ -n "${RELIA_SET_VERSION:-}" ]]; then
  VERSION="${RELIA_SET_VERSION#v}"
  echo "→ Bump version → $VERSION"
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
if [[ -z "$VERSION" || "$VERSION" == "undefined" ]]; then
  echo "Version introuvable dans tauri.conf.json"
  exit 1
fi

NOTES="${1:-Mise à jour Relia $VERSION}"
TAG="v${VERSION}"
REPO="${RELIA_UPDATE_REPO:-d3ltv/crm-desktop}"
OFFICIAL_TAG="official"

export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

echo "→ Build Relia $VERSION (artefacts updater)…"
DISABLE_ESLINT_PLUGIN=true CI=false yarn tauri build \
  --config src-tauri/tauri.updater-artifacts.conf.json

MAC_DIR="$ROOT/src-tauri/target/release/bundle/macos"
TAR="$(ls -1 "$MAC_DIR"/*.app.tar.gz 2>/dev/null | head -1 || true)"
SIG="${TAR}.sig"

if [[ -z "${TAR}" || ! -f "$TAR" || ! -f "$SIG" ]]; then
  echo "Artefacts updater introuvables dans $MAC_DIR"
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="darwin-aarch64" ;;
  x86_64) PLATFORM="darwin-x86_64" ;;
  *)
    echo "Arch non supportée : $ARCH"
    exit 1
    ;;
esac

OUT_DIR="$ROOT/src-tauri/target/release/updater-publish"
mkdir -p "$OUT_DIR"
ASSET_NAME="Relia_${VERSION}_${PLATFORM}.app.tar.gz"
cp "$TAR" "$OUT_DIR/$ASSET_NAME"
cp "$SIG" "$OUT_DIR/${ASSET_NAME}.sig"

export RELIA_V="$VERSION"
export RELIA_NOTES="$NOTES"
export RELIA_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export RELIA_PLATFORM="$PLATFORM"
export RELIA_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET_NAME}"
export RELIA_SIG="$OUT_DIR/${ASSET_NAME}.sig"
export RELIA_OUT="$OUT_DIR/official.json"
export RELIA_REASON="update"
bash "$SCRIPTS/write-official-json.sh"

ensure_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh CLI absent. Fichiers prêts dans $OUT_DIR — upload manuel requis."
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

echo "→ Release versionnée $TAG…"
upload_or_create "$TAG" "Relia $VERSION" \
  "$OUT_DIR/$ASSET_NAME" \
  "$OUT_DIR/${ASSET_NAME}.sig" \
  "$OUT_DIR/official.json"

echo "→ Pointeur officiel ($OFFICIAL_TAG)…"
# Release mutable : pas de latest GitHub — tag fixe `official`
if gh release view "$OFFICIAL_TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$OFFICIAL_TAG" "$OUT_DIR/official.json" --repo "$REPO" --clobber
  gh release edit "$OFFICIAL_TAG" --repo "$REPO" \
    --title "Relia official channel" \
    --notes "Pointeur officiel → $VERSION. Ne pas supprimer." >/dev/null 2>&1 || true
else
  gh release create "$OFFICIAL_TAG" "$OUT_DIR/official.json" \
    --repo "$REPO" \
    --title "Relia official channel" \
    --notes "Pointeur officiel → $VERSION. Ne pas supprimer." \
    --latest=false
fi

echo ""
echo "OK — Relia $VERSION publiée et posée comme officielle."
echo "Endpoint clients : https://github.com/${REPO}/releases/download/${OFFICIAL_TAG}/official.json"
echo "Rappel : identifier local.crm.desktop inchangé → data clients préservées."
