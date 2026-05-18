/**
 * SuperScalar wallet SQLite service.
 *
 * Owns the wallet's protocol-coordination + policy storage per
 * wallet/docs/WALLET_SQLITE_SCHEMA.md.
 *
 * Single SQLite file at <app-data>/soupwallet/wallet.db (resolved per OS).
 * WAL mode; single writer (this process); reads from the frontend go
 * through this service, not direct DB access.
 *
 * Tables owned:
 *   - factories                (user's role per factory, display label)
 *   - lsp_join_queue           (LSP-side lobby)
 *   - outgoing_joins           (client-side outgoing JOIN_REQUEST tracking)
 *   - iid_counter              (HSM-derived instance_id counter)
 *   - factory_policy_snapshots (TLV-encoded policy from JOIN time)
 *   - lsp_operator_prefs       (per-factory + global, JSON-valued)
 *   - client_signing_prefs     (per-factory auto-sign rules)
 *   - peer_notes               (user-authored)
 *   - peer_reputation          (scoring)
 *   - custom_join_rules        (user-configurable filters)
 *   - discovery_history        (browsed LSPs)
 *   - fiat_rate_cache
 *   - wallet_settings          (catch-all KV)
 *
 * NOT in this DB:
 *   - Crypto state (channels, tree TXs, revocation secrets) — those live
 *     in libsuperscalar's SQLite, owned by the lib team, accessed from
 *     the C plugin only.
 *   - In-flight ceremony round state (nonces, partial sigs, participant
 *     phases) — libsuperscalar SQLite.
 *   - UI ephemeral state (theme, last screen) — wallet TS localStorage.
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { logger } from '../shared/logger.js';

/* ------------------------------------------------------------------ */
/* Schema version                                                      */
/* ------------------------------------------------------------------ */

export const SUPERSCALAR_WALLET_DB_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Path resolution                                                     */
/* ------------------------------------------------------------------ */

function resolveDefaultDbPath(): string {
  const env = process.env.SUPERSCALAR_WALLET_DB_PATH;
  if (env) return env;

  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'soupwallet', 'wallet.db');
    case 'win32':
      return join(
        process.env.APPDATA || join(home, 'AppData', 'Roaming'),
        'soupwallet',
        'wallet.db'
      );
    default:
      return join(
        process.env.XDG_CONFIG_HOME || join(home, '.config'),
        'soupwallet',
        'wallet.db'
      );
  }
}

/* ------------------------------------------------------------------ */
/* Schema (DDL)                                                        */
/* ------------------------------------------------------------------ */

const SCHEMA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at INTEGER NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS factories (
     factory_instance_id   BLOB PRIMARY KEY,
     my_role               INTEGER NOT NULL,
     display_label         TEXT,
     created_at_block      INTEGER NOT NULL,
     joined_at_block       INTEGER,
     state                 INTEGER NOT NULL,
     last_seen_at          INTEGER NOT NULL,
     archived              INTEGER NOT NULL DEFAULT 0
   );`,
  `CREATE INDEX IF NOT EXISTS idx_factories_role_state
     ON factories(my_role, state);`,

  `CREATE TABLE IF NOT EXISTS lsp_join_queue (
     factory_instance_id   BLOB NOT NULL,
     client_pubkey         BLOB NOT NULL,
     request_id            INTEGER NOT NULL,
     contribution_sats     INTEGER NOT NULL,
     received_at_block     INTEGER NOT NULL,
     accepted_at_block     INTEGER,
     decided_at_block      INTEGER,
     last_seen_block       INTEGER,
     status                INTEGER NOT NULL,
     reason                TEXT,
     PRIMARY KEY (factory_instance_id, client_pubkey)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_lsp_join_queue_status
     ON lsp_join_queue(factory_instance_id, status);`,

  `CREATE TABLE IF NOT EXISTS outgoing_joins (
     factory_instance_id    BLOB NOT NULL,
     lsp_pubkey             BLOB NOT NULL,
     request_id             INTEGER NOT NULL,
     contribution_sats      INTEGER NOT NULL,
     sent_at_block          INTEGER NOT NULL,
     expected_signing_block INTEGER,
     updated_at_block       INTEGER NOT NULL,
     status                 INTEGER NOT NULL,
     reason                 TEXT,
     PRIMARY KEY (factory_instance_id, lsp_pubkey)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_outgoing_joins_status
     ON outgoing_joins(status, updated_at_block);`,

  `CREATE TABLE IF NOT EXISTS iid_counter (
     id           INTEGER PRIMARY KEY CHECK (id = 0),
     counter      INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   );`,
  `INSERT OR IGNORE INTO iid_counter (id, counter, updated_at)
     VALUES (0, 0, strftime('%s','now'));`,

  `CREATE TABLE IF NOT EXISTS factory_policy_snapshots (
     factory_instance_id   BLOB PRIMARY KEY,
     policy_schema_version INTEGER NOT NULL,
     policy_tlv            BLOB NOT NULL,
     captured_at_block     INTEGER NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS lsp_operator_prefs (
     factory_instance_id   BLOB,
     pref_key              TEXT NOT NULL,
     pref_value            TEXT NOT NULL,
     updated_at            INTEGER NOT NULL,
     PRIMARY KEY (factory_instance_id, pref_key)
   );`,

  `CREATE TABLE IF NOT EXISTS client_signing_prefs (
     factory_instance_id   BLOB NOT NULL,
     pref_key              TEXT NOT NULL,
     pref_value            TEXT NOT NULL,
     updated_at            INTEGER NOT NULL,
     PRIMARY KEY (factory_instance_id, pref_key)
   );`,

  `CREATE TABLE IF NOT EXISTS peer_notes (
     peer_pubkey   BLOB PRIMARY KEY,
     label         TEXT,
     body          TEXT,
     created_at    INTEGER NOT NULL,
     updated_at    INTEGER NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS peer_reputation (
     peer_pubkey      BLOB PRIMARY KEY,
     score            INTEGER NOT NULL,
     n_observations   INTEGER NOT NULL,
     last_observed_at INTEGER NOT NULL,
     source           TEXT
   );`,
  `CREATE INDEX IF NOT EXISTS idx_peer_reputation_score
     ON peer_reputation(score DESC);`,

  `CREATE TABLE IF NOT EXISTS custom_join_rules (
     rule_id     INTEGER PRIMARY KEY AUTOINCREMENT,
     role        INTEGER NOT NULL,
     rule_type   TEXT NOT NULL,
     rule_value  TEXT NOT NULL,
     enabled     INTEGER NOT NULL DEFAULT 1,
     created_at  INTEGER NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS discovery_history (
     lsp_pubkey       BLOB NOT NULL,
     factory_count    INTEGER NOT NULL,
     browsed_at_block INTEGER NOT NULL,
     snapshot_tlv     BLOB,
     PRIMARY KEY (lsp_pubkey, browsed_at_block)
   );`,

  `CREATE TABLE IF NOT EXISTS fiat_rate_cache (
     currency          TEXT PRIMARY KEY,
     rate_sat_per_unit INTEGER NOT NULL,
     fetched_at        INTEGER NOT NULL,
     source            TEXT
   );`,

  `CREATE TABLE IF NOT EXISTS wallet_settings (
     setting_key      TEXT PRIMARY KEY,
     setting_value    TEXT NOT NULL,
     updated_at       INTEGER NOT NULL
   );`,
];

/* ------------------------------------------------------------------ */
/* Status enums (mirror values used by the plugin)                     */
/* ------------------------------------------------------------------ */

export enum FactoryRole {
  CLIENT = 0,
  LSP = 1,
}

export enum JoinStatus {
  PENDING = 0,
  ACCEPTED = 1,
  REJECTED = 2,
  CANCELLED = 3,
  DEPARTED = 4,
}

export enum OutgoingJoinStatus {
  SENT = 0,
  QUEUED = 1,
  ACCEPTED = 2,
  REJECTED = 3,
  CANCELLED = 4,
  SIGNED = 5,
}

export enum CustomRuleRole {
  CLIENT = 0,
  LSP = 1,
}

/* ------------------------------------------------------------------ */
/* Row types                                                           */
/* ------------------------------------------------------------------ */

export interface FactoryRow {
  factory_instance_id: Buffer;
  my_role: FactoryRole;
  display_label: string | null;
  created_at_block: number;
  joined_at_block: number | null;
  state: number;
  last_seen_at: number;
  archived: 0 | 1;
}

export interface LspJoinQueueRow {
  factory_instance_id: Buffer;
  client_pubkey: Buffer;
  request_id: bigint;
  contribution_sats: bigint;
  received_at_block: number;
  accepted_at_block: number | null;
  decided_at_block: number | null;
  last_seen_block: number | null;
  status: JoinStatus;
  reason: string | null;
}

export interface OutgoingJoinRow {
  factory_instance_id: Buffer;
  lsp_pubkey: Buffer;
  request_id: bigint;
  contribution_sats: bigint;
  sent_at_block: number;
  expected_signing_block: number | null;
  updated_at_block: number;
  status: OutgoingJoinStatus;
  reason: string | null;
}

export interface FactoryPolicySnapshotRow {
  factory_instance_id: Buffer;
  policy_schema_version: number;
  policy_tlv: Buffer;
  captured_at_block: number;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class SuperScalarDbService {
  private static instance: SuperScalarDbService | null = null;
  private db: Database.Database;
  private readonly dbPath: string;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.ensureParentDirectoryExists();
    this.db = new Database(dbPath);
    /* Use BigInt for all INTEGER columns coming out of the DB. Necessary
     * because request_id and contribution_sats are u64 in the protocol;
     * default-mode better-sqlite3 silently coerces to Number and loses
     * precision past 2^53. Callers reading small known-safe fields
     * (state enums, block heights, counts) get explicit Number()
     * conversions in the service methods. */
    this.db.defaultSafeIntegers(true);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.applyMigrations();
    logger.info(
      `SuperScalar wallet DB initialized at ${dbPath} (schema v${this.currentSchemaVersion()})`
    );
  }

  public static getInstance(dbPath?: string): SuperScalarDbService {
    if (!this.instance) {
      this.instance = new SuperScalarDbService(dbPath || resolveDefaultDbPath());
    }
    return this.instance;
  }

  public static resetInstanceForTest(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }

  private ensureParentDirectoryExists(): void {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Migrations                                                        */
  /* ---------------------------------------------------------------- */

  private applyMigrations(): void {
    const stmts = SCHEMA_DDL;
    this.db.transaction(() => {
      for (const ddl of stmts) {
        this.db.exec(ddl);
      }
      const row = this.db
        .prepare('SELECT MAX(version) AS v FROM schema_version')
        .get() as { v: bigint | null };
      const currentVersion = row.v === null ? 0 : Number(row.v);
      if (currentVersion < SUPERSCALAR_WALLET_DB_SCHEMA_VERSION) {
        this.db
          .prepare(
            'INSERT INTO schema_version (version, applied_at) VALUES (?, strftime(\'%s\',\'now\'))'
          )
          .run(SUPERSCALAR_WALLET_DB_SCHEMA_VERSION);
      }
    })();
  }

  public currentSchemaVersion(): number {
    const row = this.db
      .prepare('SELECT MAX(version) AS v FROM schema_version')
      .get() as { v: bigint | null };
    return row.v === null ? 0 : Number(row.v);
  }

  /* ---------------------------------------------------------------- */
  /* factories                                                         */
  /* ---------------------------------------------------------------- */

  public upsertFactory(row: Omit<FactoryRow, 'last_seen_at'>): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO factories
          (factory_instance_id, my_role, display_label, created_at_block,
           joined_at_block, state, last_seen_at, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(factory_instance_id) DO UPDATE SET
           my_role = excluded.my_role,
           display_label = excluded.display_label,
           created_at_block = excluded.created_at_block,
           joined_at_block = excluded.joined_at_block,
           state = excluded.state,
           last_seen_at = excluded.last_seen_at,
           archived = excluded.archived`
      )
      .run(
        row.factory_instance_id,
        row.my_role,
        row.display_label,
        row.created_at_block,
        row.joined_at_block,
        row.state,
        now,
        row.archived
      );
  }

  private mapFactoryRow(raw: Record<string, unknown>): FactoryRow {
    return {
      factory_instance_id: raw.factory_instance_id as Buffer,
      my_role: Number(raw.my_role) as FactoryRole,
      display_label: (raw.display_label as string | null) ?? null,
      created_at_block: Number(raw.created_at_block),
      joined_at_block:
        raw.joined_at_block === null ? null : Number(raw.joined_at_block),
      state: Number(raw.state),
      last_seen_at: Number(raw.last_seen_at),
      archived: Number(raw.archived) as 0 | 1,
    };
  }

  public getFactory(factoryInstanceId: Buffer): FactoryRow | null {
    const row = this.db
      .prepare('SELECT * FROM factories WHERE factory_instance_id = ?')
      .get(factoryInstanceId) as Record<string, unknown> | undefined;
    return row ? this.mapFactoryRow(row) : null;
  }

  public listFactoriesByRole(role: FactoryRole, includeArchived = false): FactoryRow[] {
    const sql = includeArchived
      ? 'SELECT * FROM factories WHERE my_role = ? ORDER BY created_at_block DESC'
      : 'SELECT * FROM factories WHERE my_role = ? AND archived = 0 ORDER BY created_at_block DESC';
    const rows = this.db.prepare(sql).all(role) as Record<string, unknown>[];
    return rows.map((r) => this.mapFactoryRow(r));
  }

  /* ---------------------------------------------------------------- */
  /* lsp_join_queue                                                    */
  /* ---------------------------------------------------------------- */

  public upsertJoinQueueEntry(row: LspJoinQueueRow): void {
    this.db
      .prepare(
        `INSERT INTO lsp_join_queue
           (factory_instance_id, client_pubkey, request_id,
            contribution_sats, received_at_block, accepted_at_block,
            decided_at_block, last_seen_block, status, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(factory_instance_id, client_pubkey) DO UPDATE SET
           request_id = excluded.request_id,
           contribution_sats = excluded.contribution_sats,
           received_at_block = excluded.received_at_block,
           accepted_at_block = excluded.accepted_at_block,
           decided_at_block = excluded.decided_at_block,
           last_seen_block = excluded.last_seen_block,
           status = excluded.status,
           reason = excluded.reason`
      )
      .run(
        row.factory_instance_id,
        row.client_pubkey,
        row.request_id,
        row.contribution_sats,
        row.received_at_block,
        row.accepted_at_block,
        row.decided_at_block,
        row.last_seen_block,
        row.status,
        row.reason
      );
  }

  private mapJoinQueueRow(raw: Record<string, unknown>): LspJoinQueueRow {
    return {
      factory_instance_id: raw.factory_instance_id as Buffer,
      client_pubkey: raw.client_pubkey as Buffer,
      request_id: raw.request_id as bigint,
      contribution_sats: raw.contribution_sats as bigint,
      received_at_block: Number(raw.received_at_block),
      accepted_at_block:
        raw.accepted_at_block === null ? null : Number(raw.accepted_at_block),
      decided_at_block:
        raw.decided_at_block === null ? null : Number(raw.decided_at_block),
      last_seen_block:
        raw.last_seen_block === null ? null : Number(raw.last_seen_block),
      status: Number(raw.status) as JoinStatus,
      reason: (raw.reason as string | null) ?? null,
    };
  }

  public listJoinQueueByStatus(
    factoryInstanceId: Buffer,
    status: JoinStatus
  ): LspJoinQueueRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM lsp_join_queue
         WHERE factory_instance_id = ? AND status = ?
         ORDER BY received_at_block ASC`
      )
      .all(factoryInstanceId, status) as Record<string, unknown>[];
    return rows.map((r) => this.mapJoinQueueRow(r));
  }

  public countJoinQueueByStatus(factoryInstanceId: Buffer, status: JoinStatus): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM lsp_join_queue
         WHERE factory_instance_id = ? AND status = ?`
      )
      .get(factoryInstanceId, status) as { n: bigint };
    return Number(row.n);
  }

  /* ---------------------------------------------------------------- */
  /* outgoing_joins                                                    */
  /* ---------------------------------------------------------------- */

  public upsertOutgoingJoin(row: OutgoingJoinRow): void {
    this.db
      .prepare(
        `INSERT INTO outgoing_joins
           (factory_instance_id, lsp_pubkey, request_id, contribution_sats,
            sent_at_block, expected_signing_block, updated_at_block, status, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(factory_instance_id, lsp_pubkey) DO UPDATE SET
           request_id = excluded.request_id,
           contribution_sats = excluded.contribution_sats,
           sent_at_block = excluded.sent_at_block,
           expected_signing_block = excluded.expected_signing_block,
           updated_at_block = excluded.updated_at_block,
           status = excluded.status,
           reason = excluded.reason`
      )
      .run(
        row.factory_instance_id,
        row.lsp_pubkey,
        row.request_id,
        row.contribution_sats,
        row.sent_at_block,
        row.expected_signing_block,
        row.updated_at_block,
        row.status,
        row.reason
      );
  }

  private mapOutgoingJoinRow(raw: Record<string, unknown>): OutgoingJoinRow {
    return {
      factory_instance_id: raw.factory_instance_id as Buffer,
      lsp_pubkey: raw.lsp_pubkey as Buffer,
      request_id: raw.request_id as bigint,
      contribution_sats: raw.contribution_sats as bigint,
      sent_at_block: Number(raw.sent_at_block),
      expected_signing_block:
        raw.expected_signing_block === null ? null : Number(raw.expected_signing_block),
      updated_at_block: Number(raw.updated_at_block),
      status: Number(raw.status) as OutgoingJoinStatus,
      reason: (raw.reason as string | null) ?? null,
    };
  }

  public listOutgoingJoinsByStatus(status: OutgoingJoinStatus): OutgoingJoinRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM outgoing_joins WHERE status = ? ORDER BY updated_at_block DESC'
      )
      .all(status) as Record<string, unknown>[];
    return rows.map((r) => this.mapOutgoingJoinRow(r));
  }

  /* ---------------------------------------------------------------- */
  /* iid_counter                                                       */
  /* ---------------------------------------------------------------- */

  public getIidCounter(): number {
    const row = this.db.prepare('SELECT counter FROM iid_counter WHERE id = 0').get() as
      | { counter: bigint }
      | undefined;
    return row ? Number(row.counter) : 0;
  }

  /**
   * Atomically increments and returns the new counter value.
   * The plugin calls this when it needs the next instance_id derivation seed.
   * Counter is u32; safe as Number.
   */
  public incrementIidCounter(): number {
    return this.db.transaction((): number => {
      const row = this.db
        .prepare('SELECT counter FROM iid_counter WHERE id = 0')
        .get() as { counter: bigint };
      const current = row ? Number(row.counter) : 0;
      const next = current + 1;
      this.db
        .prepare(
          'UPDATE iid_counter SET counter = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = 0'
        )
        .run(next);
      return next;
    })();
  }

  /* ---------------------------------------------------------------- */
  /* factory_policy_snapshots                                          */
  /* ---------------------------------------------------------------- */

  public saveFactoryPolicySnapshot(row: FactoryPolicySnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO factory_policy_snapshots
           (factory_instance_id, policy_schema_version, policy_tlv, captured_at_block)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(factory_instance_id) DO UPDATE SET
           policy_schema_version = excluded.policy_schema_version,
           policy_tlv = excluded.policy_tlv,
           captured_at_block = excluded.captured_at_block`
      )
      .run(
        row.factory_instance_id,
        row.policy_schema_version,
        row.policy_tlv,
        row.captured_at_block
      );
  }

  public getFactoryPolicySnapshot(
    factoryInstanceId: Buffer
  ): FactoryPolicySnapshotRow | null {
    const row = this.db
      .prepare('SELECT * FROM factory_policy_snapshots WHERE factory_instance_id = ?')
      .get(factoryInstanceId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      factory_instance_id: row.factory_instance_id as Buffer,
      policy_schema_version: Number(row.policy_schema_version),
      policy_tlv: row.policy_tlv as Buffer,
      captured_at_block: Number(row.captured_at_block),
    };
  }

  /* ---------------------------------------------------------------- */
  /* lsp_operator_prefs                                                */
  /*                                                                   */
  /* factory_instance_id == null means global default; non-null is     */
  /* per-factory override. Lookups try per-factory first, then fall    */
  /* back to global.                                                   */
  /* ---------------------------------------------------------------- */

  public setLspOperatorPref(
    factoryInstanceId: Buffer | null,
    prefKey: string,
    prefValue: unknown
  ): void {
    const json = JSON.stringify(prefValue);
    this.db
      .prepare(
        `INSERT INTO lsp_operator_prefs
           (factory_instance_id, pref_key, pref_value, updated_at)
         VALUES (?, ?, ?, strftime('%s','now'))
         ON CONFLICT(factory_instance_id, pref_key) DO UPDATE SET
           pref_value = excluded.pref_value,
           updated_at = excluded.updated_at`
      )
      .run(factoryInstanceId, prefKey, json);
  }

  public getLspOperatorPref<T = unknown>(
    factoryInstanceId: Buffer | null,
    prefKey: string
  ): T | null {
    /* Per-factory takes precedence; fall back to global. */
    if (factoryInstanceId) {
      const r = this.db
        .prepare(
          'SELECT pref_value FROM lsp_operator_prefs WHERE factory_instance_id = ? AND pref_key = ?'
        )
        .get(factoryInstanceId, prefKey) as { pref_value: string } | undefined;
      if (r) return JSON.parse(r.pref_value) as T;
    }
    const g = this.db
      .prepare(
        'SELECT pref_value FROM lsp_operator_prefs WHERE factory_instance_id IS NULL AND pref_key = ?'
      )
      .get(prefKey) as { pref_value: string } | undefined;
    return g ? (JSON.parse(g.pref_value) as T) : null;
  }

  /* ---------------------------------------------------------------- */
  /* client_signing_prefs                                              */
  /* ---------------------------------------------------------------- */

  public setClientSigningPref(
    factoryInstanceId: Buffer,
    prefKey: string,
    prefValue: unknown
  ): void {
    const json = JSON.stringify(prefValue);
    this.db
      .prepare(
        `INSERT INTO client_signing_prefs
           (factory_instance_id, pref_key, pref_value, updated_at)
         VALUES (?, ?, ?, strftime('%s','now'))
         ON CONFLICT(factory_instance_id, pref_key) DO UPDATE SET
           pref_value = excluded.pref_value,
           updated_at = excluded.updated_at`
      )
      .run(factoryInstanceId, prefKey, json);
  }

  public getClientSigningPref<T = unknown>(
    factoryInstanceId: Buffer,
    prefKey: string
  ): T | null {
    const row = this.db
      .prepare(
        'SELECT pref_value FROM client_signing_prefs WHERE factory_instance_id = ? AND pref_key = ?'
      )
      .get(factoryInstanceId, prefKey) as { pref_value: string } | undefined;
    return row ? (JSON.parse(row.pref_value) as T) : null;
  }

  /* ---------------------------------------------------------------- */
  /* wallet_settings (KV)                                              */
  /* ---------------------------------------------------------------- */

  public setSetting(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.db
      .prepare(
        `INSERT INTO wallet_settings (setting_key, setting_value, updated_at)
         VALUES (?, ?, strftime('%s','now'))
         ON CONFLICT(setting_key) DO UPDATE SET
           setting_value = excluded.setting_value,
           updated_at = excluded.updated_at`
      )
      .run(key, json);
  }

  public getSetting<T = unknown>(key: string): T | null {
    const row = this.db
      .prepare('SELECT setting_value FROM wallet_settings WHERE setting_key = ?')
      .get(key) as { setting_value: string } | undefined;
    return row ? (JSON.parse(row.setting_value) as T) : null;
  }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  public close(): void {
    this.db.close();
  }

  public path(): string {
    return this.dbPath;
  }
}
