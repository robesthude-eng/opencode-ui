# Dev scripts

## `pre-commit.sh` — biome check on staged files

Ensures no lint/style issues are committed. Install once:

```bash
cp scripts/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

Or symlink so future updates auto-apply:

```bash
ln -sf ../../scripts/pre-commit.sh .git/hooks/pre-commit
```

### How it works

On every `git commit`, the hook:
1. Collects staged `.ts/.tsx/.js/.jsx/.mjs/.cjs/.json` files (excluding
   `dist/`, `node_modules/`, `package-lock.json`).
2. Runs `biome check --files-ignore-unknown=true <staged>` against a
   local install (searches `node_modules/.bin/biome` and the native
   platform-specific binaries under `@biomejs/cli-*`).
3. Blocks the commit if biome finds any issue. Prints the exact
   command to auto-fix.

### Bypass

- One-off:  `SKIP_BIOME=1 git commit ...`
- Universal:  `git commit --no-verify`

### If biome is not installed locally

The hook prints a warning and lets the commit through (permissive
fallback). To enforce checking install deps:

```bash
npm ci --include=dev
```
