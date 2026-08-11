#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: must run as root (use sudo)." >&2
    exit 1
fi

WORKING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="graph-lens-lite"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
RUN_USER="${SUDO_USER:-$(stat -c '%U' "$WORKING_DIR")}"
RUN_GROUP="$(id -gn "$RUN_USER")"

# Resolve npm/node from the service user's environment (handles nvm).
resolve_bin() {
    local bin="$1"
    sudo -u "$RUN_USER" bash -lc "command -v ${bin}" 2>/dev/null \
        || sudo -u "$RUN_USER" bash -c \
            "export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" >/dev/null 2>&1; command -v ${bin}" 2>/dev/null \
        || true
}

NPM_BIN="$(resolve_bin npm)"
NODE_BIN="$(resolve_bin node)"
if [ -z "$NPM_BIN" ] || [ -z "$NODE_BIN" ]; then
    echo "ERROR: could not locate npm/node for user '${RUN_USER}'." >&2
    echo "Ensure node is installed and on that user's login PATH (e.g. via nvm)." >&2
    exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"
echo "Using npm: ${NPM_BIN}"
echo "Using node dir: ${NODE_DIR}"

read -r -d '' UNIT <<EOF || true
[Unit]
Description=Graph Lens Lite Ingest Service
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${WORKING_DIR}
ExecStart=${NPM_BIN} run serve:api
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

NoNewPrivileges=true
ProtectSystem=full
# No ReadWritePaths: the service holds its graph in memory and never writes to
# disk, so granting write over the whole checkout only widens what a
# compromise of it could reach.
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

if [ -f "$UNIT_PATH" ] \
    && [ "$(cat "$UNIT_PATH")" = "$UNIT" ] \
    && systemctl is-enabled --quiet "$SERVICE_NAME"; then
    echo -e "\033[0;32m[OK] ${SERVICE_NAME} already installed and enabled.\033[0m"
    exit 0
fi

echo "Writing ${UNIT_PATH}"
printf '%s\n' "$UNIT" > "$UNIT_PATH"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "Installed ${SERVICE_NAME}."
echo "  Status:  systemctl status ${SERVICE_NAME}"
echo "  Logs:    journalctl -u ${SERVICE_NAME} -f"
echo "  Restart: systemctl restart ${SERVICE_NAME}"
echo "  Remove:  systemctl disable --now ${SERVICE_NAME} && rm ${UNIT_PATH} && systemctl daemon-reload"
echo "Note: re-run this script after upgrading node (e.g. nvm install) to repin paths."
