#!/bin/sh
# ╔═══════════════════════════════════════════════════════════════╗
# ║  pre-commit: biome check on staged JS/TS/JSON files           ║
# ║  Bypass:  SKIP_BIOME=1 git commit ...  or --no-verify        ║
# ╚═══════════════════════════════════════════════════════════════╝
set -eu

if [ "${SKIP_BIOME:-0}" = "1" ]; then
  echo "[pre-commit] SKIP_BIOME=1 — biome check skipped"
  exit 0
fi

STAGED=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json)$' \
  | grep -v '^dist/' \
  | grep -v '^node_modules/' \
  | grep -v 'package-lock\.json$' \
  || true)

if [ -z "$STAGED" ]; then
  echo "[pre-commit] no code files staged — skip biome"
  exit 0
fi

echo "[pre-commit] checking staged files with biome:"
echo "$STAGED" | sed 's/^/  - /'

REPO_ROOT=$(git rev-parse --show-toplevel)

# Ищем локальный biome (dev-machine с node)
find_local_biome() {
  for p in \
    "$REPO_ROOT/node_modules/.bin/biome" \
    "$REPO_ROOT/node_modules/@biomejs/cli-linux-x64/biome" \
    "$REPO_ROOT/node_modules/@biomejs/cli-linux-arm64/biome" \
    "$REPO_ROOT/node_modules/@biomejs/cli-darwin-x64/biome" \
    "$REPO_ROOT/node_modules/@biomejs/cli-darwin-arm64/biome"; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}

BIOME_BIN=$(find_local_biome || true)

if [ -n "$BIOME_BIN" ]; then
  cd "$REPO_ROOT"
  if "$BIOME_BIN" check --files-ignore-unknown=true $STAGED; then
    echo "[pre-commit] ✓ biome passed"
    exit 0
  else
    echo ""
    echo "[pre-commit] ❌ biome FAILED. Auto-fix with:"
    echo "    $BIOME_BIN check --write $STAGED && git add -u"
    echo "  Or bypass:  SKIP_BIOME=1 git commit ..."
    exit 1
  fi
fi

# Fallback: no biome available → warn only, don't block
echo "[pre-commit] ⚠  no local biome binary found (node_modules missing)"
echo "[pre-commit]    Install with:  npm ci --include=dev"
echo "[pre-commit]    Proceeding without check (permissive fallback)."
echo "[pre-commit]    To make this a hard error, add local biome and re-commit."
exit 0
