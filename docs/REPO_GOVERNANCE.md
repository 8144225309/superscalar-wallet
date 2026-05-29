# Repository governance

Mainnet posture for the soupwallet repo. Documents who can change
what, and how changes are gated before reaching `main`.

## Main-branch protection

`main` on `8144225309/superscalar-wallet` is protected. The rules
applied via `scripts/apply-branch-protection.sh`:

| Setting | Value | Why |
|---|---|---|
| Required status checks | `build`, `test`, `eslint` | Match the three CI jobs in `.github/workflows/`. If a job is added or renamed, update the script. |
| `strict` | true | PR branch must be up-to-date with `main` before merge — prevents rebase-skew breakage. |
| Linear history | required | No merge commits on `main`. PRs squash or rebase. Keeps `git log` readable. |
| Force-push | disallowed | Rewriting shared history is destructive; PRs that need a rewrite open a new PR. |
| Deletion | disallowed | `main` should not be deletable by accident or by a compromised token. |
| Conversation resolution | required | Open review comments must be marked resolved before merge. |
| Admin enforcement | OFF | Single-operator project; owner needs occasional bypass for emergency fix. Re-enable if/when a co-maintainer joins. |
| Required PR reviews | none | Solo dev today. Set `required_pull_request_reviews: { required_approving_review_count: 1 }` when a reviewer is added. |

## Re-applying

```sh
./scripts/apply-branch-protection.sh
# or against a fork
./scripts/apply-branch-protection.sh --repo myorg/myfork --branch main
```

Requires `gh` authenticated with admin rights on the target repo.

## Why this is in the repo

GitHub branch-protection lives in repo settings, not in code, so it
can be silently changed without leaving a trace in `git log`. Keeping
the canonical posture as a script + doc means:

- The rules can be re-applied if someone toggles them in the UI
- Forks inherit the same posture by running one command
- A diff to either file shows intent, even if the live setting drifts

## What's NOT here

- `CODEOWNERS` — single-operator repo, no owner mapping needed
- Required signed commits — gpg/ssh signing is a personal-key concern,
  not gated at the repo level today
- Tag protection — `v*` tags are not protected; consider adding a
  protected tag rule when release tagging is automated (R7.7)
