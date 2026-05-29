# Wallet CONFORMANCE

This file records deliberate deviations the wallet UI makes from the
bLIP-56 draft spec and from the broader SuperScalar protocol design.
Companion to the plugin's own `superscalar-cln/CONFORMANCE.md`, which
records protocol-level deviations.

A "deviation" here means the wallet does something different from
what the spec or design doc says, with rationale, where the difference
is observable to a user or a peer wallet.

## Format

```
### <topic> — <one-line summary>
- **Spec says:** what the spec / design says
- **We do:** what the wallet UI does
- **Why:** rationale, links to issues / PRs / discussions
- **Compat:** what breaks (or doesn't) for peers / operators
- **Path to convergence:** when/how we'd unwind this
```

## Active deviations

### Wire-type ODD 33001, not EVEN 32800

- **Spec says:** bLIP-56 PR #56 reserves EVEN 32800-32812 for factory
  ceremony messages.
- **We do:** plugin uses ODD 33001 range. Wallet doesn't parse wire
  itself but the user-visible message-type fields in tooltips and
  diagnostics quote 33001.
- **Why:** [[project-wire-type-deviation]] — bLIP-56 PR hasn't
  finalized; switching to 32800 will be a hard fork. Holding off until
  the spec lands.
- **Compat:** only matters when peering with a node tracking the spec
  draft literally. SuperScalar fleet runs the ODD range uniformly.
- **Path to convergence:** when bLIP-56 PR #56 merges, plugin flips
  to EVEN; wallet text adjusts in the same PR.

### Auth: SHA256 unsalted password hash in `config.json`

- **Spec says:** N/A — auth is a wallet UI concern, not in protocol scope.
- **We do:** frontend SHA256-hashes the password, server stores the
  hash in `config.json`. No per-install salt.
- **Why:** inherited from upstream cln-application. Brute-force
  protection comes from the rate limiter (R7.1) rather than the
  hashing scheme.
- **Compat:** N/A — single-operator, no interop concern.
- **Path to convergence:** R7.x follow-up will switch to bcrypt /
  argon2 with per-install salt + config-migration. Tracked in
  [MAINNET_AUTH.md](MAINNET_AUTH.md) "What's deliberately NOT here."

### CSP: `style-src 'self' 'unsafe-inline'`

- **Spec says:** OWASP CSP guidance recommends avoiding `'unsafe-inline'`
  on style-src.
- **We do:** allow inline styles because react-perfect-scrollbar
  (used across Channels / AccountEvents / FactoryList / ConnectList)
  injects `<style>` tags at runtime.
- **Why:** task #158 found CSP-strict browsers blocked the scrollbar
  on Dashboard. Replacing the scrollbar dep is a larger refactor.
- **Compat:** XSS surface remains low — script-src is still `'self'`.
- **Path to convergence:** swap react-perfect-scrollbar for a
  CSS-only solution and drop `'unsafe-inline'`. Tracked in
  [SECURITY_HEADERS.md](SECURITY_HEADERS.md) audit notes.

### Audit log: append-only file, no signature chain

- **Spec says:** N/A — wallet-side concern.
- **We do:** plain JSONL append at `$APP_AUDIT_LOG_FILE`. No
  per-entry signing or hash-chain.
- **Why:** simplicity. Threat model is "operator wants to know who
  did what when," not "defend against compromised root on the wallet
  host."
- **Compat:** N/A.
- **Path to convergence:** add hash-chain or per-entry signing if the
  threat model expands. Documented in [AUDIT_LOG.md](AUDIT_LOG.md).

### Glossary terms are wallet-bundled, not protocol-defined

- **Spec says:** bLIP-56 doesn't standardize human-readable term names.
- **We do:** [Glossary.tsx](../apps/frontend/src/components/modals/Glossary/Glossary.tsx)
  ships 15 fixed terms (factory, MuSig2, epoch, etc.) with our
  preferred phrasing.
- **Why:** UI consistency; the spec uses domain jargon that doesn't
  always map to friendly UI labels.
- **Compat:** N/A — text-only.
- **Path to convergence:** if bLIP-56 finalizes user-facing terms in
  a non-normative section, align glossary to match.

## Tracking-only (not deviations, just noted for context)

### TS policy validator is a mirror, not the source of truth

The plugin's C validator is authoritative for joiner_enforceable_hard.
The wallet's `validatePolicy()` ([policy-validator.ts](../apps/frontend/src/utilities/policy-validator.ts))
exists for pre-flight UX, external-wallet usage, and tests. Disagreement
between the two is a bug in the mirror.

### Wire type ID 33001 carries V2 PROPOSE payload (post-Phase C v2)

V2 carries the full factory policy on the wire. Wallets that haven't
upgraded see only the V1 subset. Plugin handles both. Documented in
[SUPERSCALAR_STACK.md](SUPERSCALAR_STACK.md) §"Phase C v2 carry."

## How to add an entry

1. Discover the deviation (something the wallet ships that the spec /
   design doc doesn't sanction).
2. Add a `###` section using the format above.
3. Link to the relevant memory entry / PR / discussion in the **Why**.
4. Update `MAINNET_AUTH.md`, `OPERATOR_RUNBOOK.md`, or other docs that
   touch the same area with a cross-reference.

Companion files:
- [MAINNET_AUTH.md](MAINNET_AUTH.md) — auth posture
- [SEED_BACKUP.md](SEED_BACKUP.md) — scope boundary vs. CLN's hsm_secret
- [SECURITY_HEADERS.md](SECURITY_HEADERS.md) — CSP, HSTS, etc.
- [AUDIT_LOG.md](AUDIT_LOG.md) — audit log format and queries
- [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) — install / ops
- [SUPERSCALAR_STACK.md](SUPERSCALAR_STACK.md) — repo / role map
- [REPO_GOVERNANCE.md](REPO_GOVERNANCE.md) — branch protection / release
- [RELEASING.md](RELEASING.md) — release process
