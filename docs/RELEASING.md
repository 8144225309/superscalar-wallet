# Releasing

Cutting a tagged release of soupwallet.

## Versioning scheme

The fork inherits **calver** (`YY.MM`, e.g. `26.05`) from upstream
`cln-application`. The release script also accepts semver
(`0.3.0[-rc1]`) so a future switch is one decision, not a tooling
rewrite.

Current scheme: **calver**. Pick the version as `YY.MM` for the month
you're cutting, suffix `.NN` if there's more than one in the same month
(`26.05.1`, `26.05.2`).

## Process

1. **Update CHANGELOG.md** — add a new `## [VERSION] - YYYY-MM-DD`
   section at the top with hand-written notes. The "Unreleased"
   section's accumulated bullets fold into it.
2. **Land final commits to main** — including the CHANGELOG update.
   Wait for CI green on `main`.
3. **Run the release script:**
   ```
   ./scripts/release.sh 26.05
   ```
   The script:
   - refuses to run from a non-main branch or a dirty tree
   - checks CI green on origin/main
   - bumps version in `package.json`, `apps/backend/package.json`,
     `apps/frontend/package.json`
   - commits `chore(release): vXX.XX`
   - tags `vXX.XX` (annotated)
   - pushes commit + tag

4. **Open GitHub release:**
   ```
   gh release create v26.05 \
     --notes-file <(awk '/## \[26.05\]/,/^## \[/' CHANGELOG.md | sed '$d')
   ```
   Or with auto-generated notes if you skipped the changelog step:
   ```
   gh release create v26.05 --generate-notes
   ```

## Dry-run

Before running for real:

```
./scripts/release.sh 26.05 --dry-run
```

prints each step without executing.

## Hotfix

For an urgent fix that can't wait for the next monthly cut:

1. Branch from the existing tag: `git checkout -b hotfix/26.05.1 v26.05`
2. Land the fix.
3. CI green.
4. `./scripts/release.sh 26.05.1` from that branch (uses `--force` if
   you want to skip the "must be on main" check, but the safer move
   is to PR the fix to main first, merge, and tag from main).

## What "released" means

- A GitHub tag `vXX.XX` exists pointing at the commit
- A GitHub release object is published with hand-curated or
  auto-generated notes
- Branch protection on main ensures the tagged commit went through CI

## What's NOT here

- Docker image publish — separate workflow when needed
- npm publish — the wallet isn't currently published to npm. The
  three `package.json` files have `"private": true`.
- Automated release-PR workflow (release-please etc.) — current cadence
  doesn't justify the tooling complexity.
