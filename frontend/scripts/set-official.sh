#!/usr/bin/env bash
# Rollback / re-pointe : réécrit official.json vers une version déjà publiée (pas de rebuild).
#
# Usage (frontend/) :
#   bash scripts/set-official.sh 0.1.0 "Retour arrière"
#   yarn desktop:set-official 0.1.0 "Retour arrière"
#
# Lit l’archive + .sig depuis la release vX.Y.Z, écrit le pointeur sur tag `official`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

VERSION_RAW="${1:-}"
if [[ -z "$VERSION_RAW" ]]; then
  echo "Usage: $0 <version> [notes]"
  exit 1
fi
VERSION="${VERSION_RAW#v}"
TAG="v${VERSION}"
NOTES="${2:-Retour à Relia $VERSION}"
REPO="${RELIA_UPDATE_REPO:-d3ltv/crm-desktop}"
OFFICIAL_TAG="official"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI requis"
  exit 1
fi

echo "→ Lecture assets de $TAG…"
ASSETS_JSON="$(gh release view "$TAG" --repo "$REPO" --json assets)"
ASSET_NAME="$(node -e '
const j = JSON.parse(process.argv[1]);
const tar = (j.assets || []).find((a) => /\.app\.tar\.gz$/i.test(a.name) && !/\.sig$/i.test(a.name));
if (!tar) { console.error("Aucune archive .app.tar.gz sur " + process.argv[2]); process.exit(1); }
process.stdout.write(tar.name);
' "$ASSETS_JSON" "$TAG")"

SIG_NAME="${ASSET_NAME}.sig"
# parfois le .sig est nommé autrement
HAS_SIG="$(node -e '
const j = JSON.parse(process.argv[1]);
const name = process.argv[2];
const ok = (j.assets || []).some((a) => a.name === name);
process.stdout.write(ok ? "1" : "0");
' "$ASSETS_JSON" "$SIG_NAME")"

OUT_DIR="$ROOT/src-tauri/target/release/updater-publish"
mkdir -p "$OUT_DIR"
gh release download "$TAG" --repo "$REPO" -p "$ASSET_NAME" -D "$OUT_DIR" --clobber

if [[ "$HAS_SIG" == "1" ]]; then
  gh release download "$TAG" --repo "$REPO" -p "$SIG_NAME" -D "$OUT_DIR" --clobber
else
  echo "Signature $SIG_NAME introuvable sur $TAG"
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="darwin-aarch64" ;;
  x86_64) PLATFORM="darwin-x86_64" ;;
  *)
    # Déduire depuis le nom d’asset
    if [[ "$ASSET_NAME" == *aarch64* ]]; then PLATFORM="darwin-aarch64"
    elif [[ "$ASSET_NAME" == *x86_64* ]]; then PLATFORM="darwin-x86_64"
    else
      echo "Impossible de déduire la plateforme depuis $ASSET_NAME"
      exit 1
    fi
    ;;
esac

# Si l’asset cible une autre arch que la machine Console, respecter le nom
if [[ "$ASSET_NAME" == *darwin-aarch64* ]]; then PLATFORM="darwin-aarch64"; fi
if [[ "$ASSET_NAME" == *darwin-x86_64* ]]; then PLATFORM="darwin-x86_64"; fi

export RELIA_V="$VERSION"
export RELIA_NOTES="$NOTES"
export RELIA_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export RELIA_PLATFORM="$PLATFORM"
export RELIA_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET_NAME}"
export RELIA_SIG="$OUT_DIR/${SIG_NAME}"
export RELIA_OUT="$OUT_DIR/official.json"
export RELIA_REASON="rollback"
bash "$SCRIPTS/write-official-json.sh"

echo "→ Pointeur officiel → $VERSION (rollback)…"
if gh release view "$OFFICIAL_TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$OFFICIAL_TAG" "$OUT_DIR/official.json" --repo "$REPO" --clobber
  gh release edit "$OFFICIAL_TAG" --repo "$REPO" \
    --notes "Pointeur officiel → $VERSION (rollback). Ne pas supprimer." >/dev/null 2>&1 || true
else
  gh release create "$OFFICIAL_TAG" "$OUT_DIR/official.json" \
    --repo "$REPO" \
    --title "Relia official channel" \
    --notes "Pointeur officiel → $VERSION (rollback)." \
    --latest=false
fi

echo "OK — officiel = $VERSION"
echo "https://github.com/${REPO}/releases/download/${OFFICIAL_TAG}/official.json"
