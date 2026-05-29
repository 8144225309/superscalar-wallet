# Backup and recovery — what this wallet covers, what it doesn't

This wallet is a UI/RPC frontend for a Core Lightning (CLN) node. It
does NOT hold the seed that controls your bitcoin. Your node's
`hsm_secret` is the seed. Backing up the wallet UI without backing up
`hsm_secret` is meaningless for fund recovery.

## What "Export Config" backs up

`Settings → Export Config` downloads a JSON file containing only UI
state held by the wallet itself:

- Display unit (sats / BTC)
- Fiat currency choice
- Light/dark theme
- Show-fiat-beside-sats preference
- Any future wallet-side UI preference

What it deliberately does NOT export:

- The password hash (kept server-side; restoring would let anyone with
  the export file log into your wallet)
- `singleSignOn` mode flag (deployment concern, not portable)
- Transient runtime fields (`isLoading`, `error`)

The export envelope is plain JSON and safe to commit to a private
config repo, store in a password manager attachment, or sync to
encrypted cloud backup. There are no secrets in it.

## What "Import Config" does

`Settings → Import Config` reads a previously-exported JSON file and
applies the UI preferences. Your password and any node-side state are
unaffected — you stay logged in (or, if config.json is fresh, you can
log in with your current password).

If the file's `version` is newer than your wallet build supports,
import is rejected with a clear error.

## The real seed: CLN's `hsm_secret`

The seed that derives every key your node uses (channel funding,
on-chain wallet, factory MuSig keys, routing node signing) lives at:

```
$LIGHTNING_DIR/<network>/hsm_secret
```

Typical paths:
- mainnet: `~/.lightning/bitcoin/hsm_secret`
- testnet4: `~/.lightning/testnet4/hsm_secret`
- signet: `~/.lightning/signet/hsm_secret`
- regtest: `~/.lightning/regtest/hsm_secret`

`hsm_secret` is a 32-byte file. Lose it without backup and you lose
your funds on cooperative-close-only protocols; you lose access to
factory funds entirely unless cooperative close succeeds before you
need a unilateral exit.

### Backing up `hsm_secret`

CLN's recommended workflow:

```sh
# Stop the node first to avoid copying a torn write
sudo systemctl stop lightningd
cp ~/.lightning/bitcoin/hsm_secret /secure/backup/location/hsm_secret-$(date +%F)
sudo systemctl start lightningd
```

Then verify the backup by running CLN's `hsmtool` against it:

```sh
lightning-hsmtool getemergencyrecover \
  ~/.lightning/bitcoin/hsm_secret > emergency-recover.txt
```

Store the resulting emergency-recovery blob alongside the raw
`hsm_secret`. It contains the channel state needed for emergency
on-chain recovery if the lightningd database is corrupted.

### Channel state backup (separate from seed)

`hsm_secret` is necessary but not sufficient for channel recovery. The
channel database (`lightningd.sqlite3` and the factory plugin's
`ss_db.sqlite3` / `wallet_db.sqlite3`) hold per-channel revocation
state. CLN has built-in backup hooks; see the upstream `cln-backup`
plugin and Blockstream's recovery documentation for the canonical
workflow.

This wallet does NOT manage that backup. Use the node operator's
standard backup procedure — the wallet UI restoring from an export
won't help if the underlying node lost channel state.

## Disaster scenarios

| Lost | Recovery path |
|---|---|
| Wallet UI config | Re-import from `Export Config` JSON, or just re-set preferences |
| Wallet password | Reset via `Reset Password` in Settings (requires current login) or wipe `password` field from `config.json` server-side |
| `hsm_secret` only | Funds in unilateral-only channels are lost; cooperative closes still possible if counterparty cooperates; node identity changes |
| `hsm_secret` + channel DB | Total loss for active channels; on-chain funds recoverable from emergency-recover blob if backed up |
| Counterparty refuses cooperative close on SuperScalar factory | After breach window (epoch expiry), unilateral exit per `factory_burn_tx` posture |

## What's NOT here yet

- One-click "backup everything" that snapshots `hsm_secret`, channel
  DB, and wallet config in one go. This is a CLN-ecosystem concern;
  follow `cln-backup` development.
- Encrypted-at-rest config export (the file is plain JSON today; if
  you want it encrypted, gpg-encrypt the downloaded file yourself).
- Remote/automatic backup of channel state. Run `cln-backup` or a
  similar plugin if you need this.
