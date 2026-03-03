#!/usr/bin/env bash
set -euo pipefail

# version-bump.sh — Bump the version of the paperclipai CLI package.
#
# Usage:
#   ./scripts/version-bump.sh patch    # 0.1.0 → 0.1.1
#   ./scripts/version-bump.sh minor    # 0.1.0 → 0.2.0
#   ./scripts/version-bump.sh major    # 0.1.0 → 1.0.0
#   ./scripts/version-bump.sh 1.2.3    # set explicit version
#
# Updates version in:
#   - cli/package.json (source of truth)
#   - cli/src/index.ts (commander .version())

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_PKG="$REPO_ROOT/cli/package.json"
CLI_INDEX="$REPO_ROOT/cli/src/index.ts"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <patch|minor|major|X.Y.Z>"
  exit 1
fi

BUMP_TYPE="$1"

# Read current version
CURRENT=$(node -e "console.log(require('$CLI_PKG').version)")

# Calculate new version
case "$BUMP_TYPE" in
  patch|minor|major)
    IFS='.' read -r major minor patch <<< "$CURRENT"
    case "$BUMP_TYPE" in
      patch) patch=$((patch + 1)) ;;
      minor) minor=$((minor + 1)); patch=0 ;;
      major) major=$((major + 1)); minor=0; patch=0 ;;
    esac
    NEW_VERSION="$major.$minor.$patch"
    ;;
  *)
    # Validate explicit version format
    if ! echo "$BUMP_TYPE" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      echo "Error: Invalid version format '$BUMP_TYPE'. Expected X.Y.Z"
      exit 1
    fi
    NEW_VERSION="$BUMP_TYPE"
    ;;
esac

echo "Bumping version: $CURRENT → $NEW_VERSION"

# Update cli/package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$CLI_PKG', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$CLI_PKG', JSON.stringify(pkg, null, 2) + '\n');
"
echo "  ✓ Updated cli/package.json"

# Update cli/src/index.ts — the .version("X.Y.Z") call
sed -i '' "s/\.version(\"$CURRENT\")/\.version(\"$NEW_VERSION\")/" "$CLI_INDEX"
echo "  ✓ Updated cli/src/index.ts"

echo ""
echo "Version bumped to $NEW_VERSION"
echo "Run ./scripts/build-npm.sh to build, then commit and tag:"
echo "  git add cli/package.json cli/src/index.ts"
echo "  git commit -m \"chore: bump version to $NEW_VERSION\""
echo "  git tag v$NEW_VERSION"
