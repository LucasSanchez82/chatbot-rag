#!/usr/bin/env bash
set -euo pipefail
QDRANT_VERSION="${QDRANT_VERSION:-v1.15.0}"

mkdir -p /app/bin /app/data
cd /app/bin

if [ ! -f qdrant ]; then
  curl -L -o qdrant.tar.gz \
    "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-gnu.tar.gz"
  tar -xzf qdrant.tar.gz
  chmod +x qdrant
fi


./qdrant
