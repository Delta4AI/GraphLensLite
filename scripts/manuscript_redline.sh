#!/usr/bin/env bash
# Builds the co-author redline: latexdiff of the manuscript on `main` against
# HEAD (the release branch), not against the previous release commit, so it
# shows every change since the last published version.
#
#   scripts/manuscript_redline.sh [out-dir]   # default: current directory
#
# Writes GLL-manuscript-redline-main-vs-<HEAD sha>.pdf. Needs latexdiff + latexmk.
set -euo pipefail

BASE=${REDLINE_BASE:-main}
OUT=$(realpath "${1:-.}")
REPO=$(git rev-parse --show-toplevel)
SHA=$(git -C "$REPO" rev-parse --short HEAD)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/old" "$WORK/new" "$OUT"
git -C "$REPO" archive "$BASE" manuscript | tar -x -C "$WORK/old"
git -C "$REPO" archive HEAD manuscript | tar -x -C "$WORK/new"

# Build HEAD first: diff.tex reuses its main.bbl for the bibliography.
(cd "$WORK/new/manuscript" && latexmk -pdf -interaction=nonstopmode -halt-on-error main >build.log 2>&1) \
  || { tail -20 "$WORK/new/manuscript/build.log"; echo "HEAD manuscript does not build" >&2; exit 1; }

cd "$WORK/new/manuscript"
latexdiff --flatten --append-safecmd=path ../../old/manuscript/main.tex main.tex >diff.tex 2>latexdiff.err \
  || { cat latexdiff.err >&2; exit 1; }
latexmk -pdf -interaction=nonstopmode -halt-on-error diff >diff-build.log 2>&1 \
  || { tail -20 diff-build.log; echo "redline does not build" >&2; exit 1; }

PDF="$OUT/GLL-manuscript-redline-$BASE-vs-$SHA.pdf"
cp diff.pdf "$PDF"
echo "$PDF"
