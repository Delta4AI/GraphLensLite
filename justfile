# Deploy contract: help / deploy / status / logs / down
set shell := ["bash", "-euo", "pipefail", "-c"]

service := "graph-lens-lite"
branch := "main"

[private]
default: help

# list available recipes
help:
    @just --list --unsorted

# pull code, pin node, refresh unit, restart service
deploy: pull build unit
    sudo systemctl restart {{service}}

# show service status
status:
    systemctl status {{service}} --no-pager

# follow service logs
logs:
    journalctl -u {{service}} -f -n 100

# stop the service
[confirm]
down:
    sudo systemctl stop {{service}}

# disable and remove the service; code and .env are kept
[confirm]
uninstall:
    sudo systemctl disable --now {{service}}
    sudo rm -f /etc/systemd/system/{{service}}.service
    sudo systemctl daemon-reload

# fast-forward the current branch; asks before deploying a non-deploy branch
[private]
pull:
    #!/usr/bin/env bash
    set -euo pipefail
    current=$(git rev-parse --abbrev-ref HEAD)
    if [ "$current" != "{{branch}}" ]; then
        read -rp "WARNING: on branch '$current', not '{{branch}}'. Continue? [y/N] " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
    fi
    git pull --ff-only

# The server needs only node builtins and the committed src/, so there is no
# npm install here; CI guards that the vendored files in src/ stay in sync.
# Pin the node the unit runs: nvm's default is copied out of nvm's paths (-C
# skips the write when unchanged); a system node is symlinked so package
# upgrades flow through.
[private]
build:
    #!/usr/bin/env bash
    set -eo pipefail
    mkdir -p deploy/bin
    nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if [ -s "$nvm_sh" ]; then
        . "$nvm_sh" --no-use
        nvm use default --silent
        install -C -m755 "$(node -p process.execPath)" deploy/bin/node
    else
        node_bin=$(command -v node) || { echo "node not found on PATH and no nvm" >&2; exit 1; }
        ln -sfn "$node_bin" deploy/bin/node
    fi

# render the versioned unit for this user and checkout, install, enable
[private]
unit:
    sed -e "s|@USER@|$(id -un)|g" -e "s|@GROUP@|$(id -gn)|g" -e "s|@DIR@|{{justfile_directory()}}|g" deploy/{{service}}.service | sudo tee /etc/systemd/system/{{service}}.service >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable {{service}}
