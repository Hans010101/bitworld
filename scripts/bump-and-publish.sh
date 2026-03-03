#!/usr/bin/env bash
set -euo pipefail

# bump-and-publish.sh — One-command version bump, build, publish, and cleanup.
#
# Usage:
#   ./scripts/bump-and-publish.sh patch          # 0.1.1 → 0.1.2
#   ./scripts/bump-and-publish.sh minor          # 0.1.1 → 0.2.0
#   ./scripts/bump-and-publish.sh major          # 0.1.1 → 1.0.0
#   ./scripts/bump-and-publish.sh 2.0.0          # set explicit version
#   ./scripts/bump-and-publish.sh patch --dry-run # everything except npm publish
#
# Steps:
#   1. Bump version (cli/package.json + cli/src/index.ts)
#   2. Build for npm (token check, typecheck, esbuild, publishable package.json)
#   3. Preview (npm pack --dry-run)
#   4. Publish to npm (unless --dry-run)
#   5. Restore dev package.json
#   6. Commit and tag

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$REPO_ROOT/cli"

# ── Parse args ────────────────────────────────────────────────────────────────

dry_run=false
bump_type=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    *) bump_type="$arg" ;;
  esac
done

if [ -z "$bump_type" ]; then
  echo "Usage: $0 <patch|minor|major|X.Y.Z> [--dry-run]"
  exit 1
fi

# ── Preflight checks ─────────────────────────────────────────────────────────

if [ "$dry_run" = false ]; then
  if ! npm whoami &>/dev/null; then
    echo "Error: Not logged in to npm. Run 'npm login' first."
    exit 1
  fi
fi

# Check for uncommitted changes (version bump and build will create changes)
if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "Error: Working tree has uncommitted changes. Commit or stash them first."
  exit 1
fi

# ── Step 1: Version bump ─────────────────────────────────────────────────────

echo ""
echo "==> Step 1/6: Bumping version..."
"$REPO_ROOT/scripts/version-bump.sh" "$bump_type"

# Read the new version
NEW_VERSION=$(node -e "console.log(require('$CLI_DIR/package.json').version)")

# ── Step 2: Build ─────────────────────────────────────────────────────────────

echo ""
echo "==> Step 2/6: Building for npm..."
"$REPO_ROOT/scripts/build-npm.sh"

# ── Step 3: Preview ───────────────────────────────────────────────────────────

echo ""
echo "==> Step 3/6: Preview..."
cd "$CLI_DIR"
npm pack --dry-run
cd "$REPO_ROOT"

# ── Step 4: Publish ───────────────────────────────────────────────────────────

if [ "$dry_run" = true ]; then
  echo ""
  echo "==> Step 4/6: Skipping publish (--dry-run)"
else
  echo ""
  echo "==> Step 4/6: Publishing to npm..."
  cd "$CLI_DIR"
  npm publish --access public
  cd "$REPO_ROOT"
  echo "  ✓ Published paperclipai@$NEW_VERSION"
fi

# ── Step 5: Restore dev package.json ──────────────────────────────────────────

echo ""
echo "==> Step 5/6: Restoring dev package.json..."
mv "$CLI_DIR/package.dev.json" "$CLI_DIR/package.json"
echo "  ✓ Restored workspace:* dependencies"

# ── Step 6: Commit and tag ────────────────────────────────────────────────────

echo ""
echo "==> Step 6/6: Committing and tagging..."
cd "$REPO_ROOT"
git add cli/package.json cli/src/index.ts
git commit -m "chore: bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"
echo "  ✓ Committed and tagged v$NEW_VERSION"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
if [ "$dry_run" = true ]; then
  echo "Dry run complete for v$NEW_VERSION."
  echo "  - Version bumped, built, and previewed"
  echo "  - Dev package.json restored"
  echo "  - Commit and tag created (locally)"
  echo ""
  echo "To actually publish, run:"
  echo "  cd cli && npm publish --access public"
else
  echo "Published paperclipai@$NEW_VERSION"
  echo ""
  echo "To push:"
  echo "  git push && git push origin v$NEW_VERSION"
fi
