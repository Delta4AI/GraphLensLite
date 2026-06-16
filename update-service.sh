#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SERVICE_NAME="graph-lens-lite"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
    echo "WARNING: on branch '${branch}', not 'main'."
    read -rp "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

git pull
npm install

sudo systemctl restart "$SERVICE_NAME"
echo "Updated and restarted ${SERVICE_NAME}."
