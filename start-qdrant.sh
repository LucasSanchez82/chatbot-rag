#!/usr/bin/env bash
set -euo pipefail

QDRANT_VERSION="${QDRANT_VERSION:-v1.15.4}"

APP_DIR="${APP_DIR:-$PWD}"
BIN_DIR="$APP_DIR/bin"
DATA_DIR="$APP_DIR/data"
echo "App dir: $APP_DIR"
echo "Bin dir: $BIN_DIR"
echo "Data dir: $DATA_DIR"
echo "App Home : $APP_HOME"
mkdir -p "$BIN_DIR" "$DATA_DIR"
cd "$BIN_DIR"

if [ ! -x qdrant ]; then
  echo "Téléchargement de Qdrant $QDRANT_VERSION…"
  curl -fsSL -o qdrant.tar.gz \
    "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-gnu.tar.gz"
  tar -xzf qdrant.tar.gz
  chmod +x qdrant
fi

# Qdrant doit écouter sur 0.0.0.0:8080 côté Clever Cloud
export QDRANT__SERVICE__HOST="${QDRANT__SERVICE__HOST:-0.0.0.0}"
export QDRANT__SERVICE__HTTP_PORT="${QDRANT__SERVICE__HTTP_PORT:-8080}"

# Stockage dans un dossier local du projet (écrivable)
export QDRANT__STORAGE__STORAGE_PATH="${QDRANT__STORAGE__STORAGE_PATH:-$DATA_DIR/storage}"
export QDRANT__STORAGE__SNAPSHOTS_PATH="${QDRANT__STORAGE__SNAPSHOTS_PATH:-$DATA_DIR/snapshots}"

mkdir -p "$QDRANT__STORAGE__STORAGE_PATH" "$QDRANT__STORAGE__SNAPSHOTS_PATH"

echo "Lancement de Qdrant…"
exec ./qdrant
