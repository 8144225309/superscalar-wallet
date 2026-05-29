#!/usr/bin/env bash
# Apply main-branch protection on this GitHub repo.
#
# Defaults to the upstream `8144225309/superscalar-wallet`. Pass --repo
# to target a fork. Requires `gh` CLI authenticated with admin rights
# on the target repo.
#
# Settings applied (matches the posture documented in REPO_GOVERNANCE.md):
#   - required status checks: build, test, eslint  (strict = up-to-date)
#   - required linear history (no merge commits)
#   - no force-push, no deletion
#   - require conversation resolution before merge
#   - admins NOT enforced (single-operator emergency bypass)
#   - no required PR reviews (solo dev; flip on if you add reviewers)

set -euo pipefail

REPO="${REPO:-8144225309/superscalar-wallet}"
BRANCH="${BRANCH:-main}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--repo OWNER/NAME] [--branch BRANCH]"
      echo "Defaults: --repo $REPO --branch $BRANCH"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build", "test", "eslint"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

echo "Applying protection to $REPO branch $BRANCH..."
gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input "$TMP" >/dev/null
echo "Done. Verifying..."
gh api "repos/$REPO/branches/$BRANCH/protection" \
  --jq '{
    checks: .required_status_checks.contexts,
    strict: .required_status_checks.strict,
    linear: .required_linear_history.enabled,
    no_force_push: (.allow_force_pushes.enabled | not),
    no_deletion: (.allow_deletions.enabled | not)
  }'
