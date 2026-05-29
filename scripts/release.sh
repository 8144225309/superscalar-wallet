#!/usr/bin/env bash
# Cut a new tagged release of soupwallet.
#
# Steps:
#   1. Verify you're on main with a clean working tree
#   2. Verify CI is green on origin/main
#   3. Bump version in root + apps/backend + apps/frontend package.json
#   4. Commit the bump
#   5. Tag with the new version (annotated tag, ${VERSION})
#   6. Push commit + tag
#   7. Open a GitHub release with the changelog snippet
#
# Usage:
#   ./scripts/release.sh 26.05            # calver
#   ./scripts/release.sh 0.3.0            # semver
#   ./scripts/release.sh 26.05 --dry-run  # print steps, change nothing
#
# Requires: gh CLI authenticated, jq, git, npm.
#
# This script is deliberately conservative. It refuses to operate from
# a dirty tree, a non-main branch, or against red CI. Override at your
# own risk with --force.

set -euo pipefail

DRY_RUN=0
FORCE=0
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *) VERSION="$1"; shift ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> [--dry-run] [--force]" >&2
  exit 2
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Version must look like calver (26.05) or semver (0.3.0[-rc1])" >&2
  exit 2
fi

TAG="v$VERSION"

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY-RUN: $*"
  else
    eval "$@"
  fi
}

# Step 1: clean tree + on main
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]] && [[ $FORCE -eq 0 ]]; then
  echo "Not on main (current: $BRANCH). Use --force to override." >&2
  exit 1
fi
if ! git diff-index --quiet HEAD --; then
  echo "Working tree dirty. Commit or stash first." >&2
  exit 1
fi

# Step 2: CI green
if [[ $FORCE -eq 0 ]]; then
  echo "Checking origin/main CI status..."
  STATUS=$(gh run list --branch main --limit 3 --json conclusion,name --jq '[.[] | .conclusion] | unique')
  if echo "$STATUS" | grep -q '"failure"\|"cancelled"'; then
    echo "Recent CI runs on main are not all green: $STATUS" >&2
    echo "Use --force to release anyway." >&2
    exit 1
  fi
fi

# Step 3: bump versions
echo "Bumping versions to $VERSION..."
for PKG in package.json apps/backend/package.json apps/frontend/package.json; do
  if [[ ! -f "$PKG" ]]; then
    echo "Missing $PKG" >&2
    exit 1
  fi
  run "jq --arg v '$VERSION' '.version = \$v' '$PKG' > '$PKG.tmp' && mv '$PKG.tmp' '$PKG'"
done

# Step 4 + 5: commit + tag
run "git add package.json apps/backend/package.json apps/frontend/package.json"
run "git commit -m 'chore(release): $TAG'"
run "git tag -a '$TAG' -m 'Release $TAG'"

# Step 6: push
run "git push origin main"
run "git push origin '$TAG'"

# Step 7: GitHub release
echo
echo "Tag $TAG pushed. To open the GitHub release with auto-generated notes:"
echo "  gh release create $TAG --generate-notes"
echo
echo "Or, with a hand-written changelog snippet from CHANGELOG.md:"
echo "  gh release create $TAG --notes-file <(awk '/## \\[$VERSION\\]/,/^## \\[/' CHANGELOG.md | sed '\$d')"
