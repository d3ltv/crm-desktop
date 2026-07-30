#!/usr/bin/env bash
# Écrit official.json (pointeur de version Relia) à partir d’env vars.
# Utilisé par publish-update.sh et set-official.sh.
set -euo pipefail

: "${RELIA_V:?}"
: "${RELIA_NOTES:?}"
: "${RELIA_DATE:?}"
: "${RELIA_PLATFORM:?}"
: "${RELIA_URL:?}"
: "${RELIA_SIG:?}"
: "${RELIA_OUT:?}"
: "${RELIA_REASON:=update}"

node -e '
const fs = require("fs");
const signature = fs.readFileSync(process.env.RELIA_SIG, "utf8").trim();
const official = {
  version: process.env.RELIA_V.replace(/^v/i, ""),
  notes: process.env.RELIA_NOTES,
  reason: process.env.RELIA_REASON || "update",
  pub_date: process.env.RELIA_DATE,
  platforms: {
    [process.env.RELIA_PLATFORM]: {
      signature,
      url: process.env.RELIA_URL,
    },
  },
};
fs.writeFileSync(process.env.RELIA_OUT, JSON.stringify(official, null, 2) + "\n");
console.log("→ official.json écrit (" + official.version + ", " + official.reason + ")");
'
