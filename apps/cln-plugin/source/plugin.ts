#!/usr/bin/env node
/**
 * soupwallet CLN plugin.
 *
 * Owns the wallet SQLite (via SuperScalarDbService). Exposes JSON-RPC
 * methods that the C plugin (superscalar-cln) calls during ceremony
 * coordination — replacing the older CLN-datastore-based storage of
 * server/client coordination state.
 *
 * Protocol: standard CLN plugin protocol (JSON-RPC over stdin/stdout).
 *   - CLN sends `getmanifest` → we reply with our rpcmethods + options
 *   - CLN sends `init` → we open the SQLite and reply
 *   - CLN sends our RPC methods on demand → we reply with results
 *
 * Stdout is RESERVED for the protocol. All logs go to stderr.
 */

import {
  SuperScalarDbService,
  FactoryRole,
  JoinStatus,
  OutgoingJoinStatus,
  type FactoryRow,
  type LspJoinQueueRow,
  type OutgoingJoinRow,
} from './superscalar-db.service.js';

/* CLN plugin context: stdout is reserved for the plugin JSON-RPC
 * protocol. All logs go to stderr. */
const logger = {
  info: (m: string) => process.stderr.write(`[soupwallet-plugin] ${m}\n`),
  warn: (m: string) => process.stderr.write(`[soupwallet-plugin WARN] ${m}\n`),
  error: (m: string) => process.stderr.write(`[soupwallet-plugin ERROR] ${m}\n`),
};

/* ------------------------------------------------------------------ */
/* JSON-RPC types                                                      */
/* ------------------------------------------------------------------ */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcReply = JsonRpcSuccess | JsonRpcError;

/* ------------------------------------------------------------------ */
/* Plugin state                                                        */
/* ------------------------------------------------------------------ */

let db: SuperScalarDbService | null = null;

function getDb(): SuperScalarDbService {
  if (!db) {
    throw new Error('SuperScalarDbService not initialized; init() must run first');
  }
  return db;
}

/* ------------------------------------------------------------------ */
/* RPC method handlers                                                 */
/*                                                                     */
/* Each method takes a params object (or array) and returns the result */
/* payload. Throws on error; the protocol layer converts to JSON-RPC   */
/* error responses.                                                    */
/* ------------------------------------------------------------------ */

interface RpcMethodSpec {
  name: string;
  description: string;
  usage: string;
  handler: (params: Record<string, unknown>) => unknown;
}

function bufferFromHex(hex: unknown, fieldName: string, expectedLen?: number): Buffer {
  if (typeof hex !== 'string') {
    throw new Error(`${fieldName} must be a hex string`);
  }
  if (expectedLen !== undefined && hex.length !== expectedLen * 2) {
    throw new Error(`${fieldName} must be ${expectedLen}-byte hex (${expectedLen * 2} chars)`);
  }
  return Buffer.from(hex, 'hex');
}

function requireBigInt(v: unknown, fieldName: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') return BigInt(v);
  throw new Error(`${fieldName} must be a number or numeric string`);
}

function requireNumber(v: unknown, fieldName: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v, 10);
  throw new Error(`${fieldName} must be a number`);
}

const RPC_METHODS: RpcMethodSpec[] = [
  /* ---- IID counter ---- */
  {
    name: 'wallet-get-iid-counter',
    description: 'Read the current iid_counter value (no increment).',
    usage: '',
    handler: () => ({ counter: getDb().getIidCounter() }),
  },
  {
    name: 'wallet-increment-iid-counter',
    description: 'Atomically increment iid_counter and return the new value.',
    usage: '',
    handler: () => ({ counter: getDb().incrementIidCounter() }),
  },
  {
    name: 'wallet-set-iid-counter',
    description: 'Set iid_counter to a specific value (for migration / restore from backup).',
    usage: 'counter',
    handler: (params) => {
      const v = requireNumber(params.counter, 'counter');
      if (v < 0 || v > 0xFFFFFFFF) {
        throw new Error('counter must be a u32 (0..2^32-1)');
      }
      getDb().setIidCounter(v);
      return { ok: true };
    },
  },

  /* ---- Factory list ---- */
  {
    name: 'wallet-upsert-factory',
    description: 'Insert or update a factory record (user-perspective).',
    usage: 'factory_instance_id_hex my_role display_label created_at_block joined_at_block? state archived?',
    handler: (params) => {
      const factory_instance_id = bufferFromHex(
        params.factory_instance_id_hex,
        'factory_instance_id_hex',
        32
      );
      const my_role = requireNumber(params.my_role, 'my_role') as FactoryRole;
      const display_label = (params.display_label as string | null) ?? null;
      const created_at_block = requireNumber(params.created_at_block, 'created_at_block');
      const joined_at_block =
        params.joined_at_block === undefined || params.joined_at_block === null
          ? null
          : requireNumber(params.joined_at_block, 'joined_at_block');
      const state = requireNumber(params.state, 'state');
      const archived = (requireNumber(params.archived ?? 0, 'archived')) as 0 | 1;
      getDb().upsertFactory({
        factory_instance_id,
        my_role,
        display_label,
        created_at_block,
        joined_at_block,
        state,
        archived,
      });
      return { ok: true };
    },
  },
  {
    name: 'wallet-get-factory',
    description: 'Get a factory by instance_id (hex).',
    usage: 'factory_instance_id_hex',
    handler: (params) => {
      const iid = bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const row = getDb().getFactory(iid);
      return row ? factoryRowToWire(row) : null;
    },
  },
  {
    name: 'wallet-list-factories-by-role',
    description: 'List factories where the user has the given role.',
    usage: 'role include_archived?',
    handler: (params) => {
      const role = requireNumber(params.role, 'role') as FactoryRole;
      const includeArchived = !!params.include_archived;
      const rows = getDb().listFactoriesByRole(role, includeArchived);
      return { factories: rows.map(factoryRowToWire) };
    },
  },

  /* ---- LSP-side join queue ---- */
  {
    name: 'wallet-upsert-join-queue-entry',
    description: 'Upsert an entry in the LSP-side join queue for a factory.',
    usage: 'factory_instance_id_hex client_pubkey_hex request_id contribution_sats received_at_block status reason?',
    handler: (params) => {
      const row: LspJoinQueueRow = {
        factory_instance_id: bufferFromHex(
          params.factory_instance_id_hex,
          'factory_instance_id_hex',
          32
        ),
        client_pubkey: bufferFromHex(params.client_pubkey_hex, 'client_pubkey_hex', 33),
        request_id: requireBigInt(params.request_id, 'request_id'),
        contribution_sats: requireBigInt(params.contribution_sats, 'contribution_sats'),
        received_at_block: requireNumber(params.received_at_block, 'received_at_block'),
        accepted_at_block:
          params.accepted_at_block === undefined || params.accepted_at_block === null
            ? null
            : requireNumber(params.accepted_at_block, 'accepted_at_block'),
        decided_at_block:
          params.decided_at_block === undefined || params.decided_at_block === null
            ? null
            : requireNumber(params.decided_at_block, 'decided_at_block'),
        last_seen_block:
          params.last_seen_block === undefined || params.last_seen_block === null
            ? null
            : requireNumber(params.last_seen_block, 'last_seen_block'),
        status: requireNumber(params.status, 'status') as JoinStatus,
        reason: (params.reason as string | null) ?? null,
      };
      getDb().upsertJoinQueueEntry(row);
      return { ok: true };
    },
  },
  {
    name: 'wallet-list-join-queue-by-status',
    description: 'List entries in the LSP-side join queue filtered by status.',
    usage: 'factory_instance_id_hex status',
    handler: (params) => {
      const iid = bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const status = requireNumber(params.status, 'status') as JoinStatus;
      const rows = getDb().listJoinQueueByStatus(iid, status);
      return { entries: rows.map(joinQueueRowToWire) };
    },
  },
  {
    name: 'wallet-count-join-queue-by-status',
    description: 'Count entries in the LSP-side join queue filtered by status.',
    usage: 'factory_instance_id_hex status',
    handler: (params) => {
      const iid = bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const status = requireNumber(params.status, 'status') as JoinStatus;
      return { count: getDb().countJoinQueueByStatus(iid, status) };
    },
  },

  /* ---- Client-side outgoing joins ---- */
  {
    name: 'wallet-upsert-outgoing-join',
    description: 'Upsert a client-side outgoing JOIN_REQUEST record.',
    usage: 'factory_instance_id_hex lsp_pubkey_hex request_id contribution_sats sent_at_block expected_signing_block? updated_at_block status reason?',
    handler: (params) => {
      const row: OutgoingJoinRow = {
        factory_instance_id: bufferFromHex(
          params.factory_instance_id_hex,
          'factory_instance_id_hex',
          32
        ),
        lsp_pubkey: bufferFromHex(params.lsp_pubkey_hex, 'lsp_pubkey_hex', 33),
        request_id: requireBigInt(params.request_id, 'request_id'),
        contribution_sats: requireBigInt(params.contribution_sats, 'contribution_sats'),
        sent_at_block: requireNumber(params.sent_at_block, 'sent_at_block'),
        expected_signing_block:
          params.expected_signing_block === undefined || params.expected_signing_block === null
            ? null
            : requireNumber(params.expected_signing_block, 'expected_signing_block'),
        updated_at_block: requireNumber(params.updated_at_block, 'updated_at_block'),
        status: requireNumber(params.status, 'status') as OutgoingJoinStatus,
        reason: (params.reason as string | null) ?? null,
      };
      getDb().upsertOutgoingJoin(row);
      return { ok: true };
    },
  },
  {
    name: 'wallet-list-outgoing-joins-by-status',
    description: 'List client-side outgoing joins filtered by status.',
    usage: 'status',
    handler: (params) => {
      const status = requireNumber(params.status, 'status') as OutgoingJoinStatus;
      const rows = getDb().listOutgoingJoinsByStatus(status);
      return { entries: rows.map(outgoingJoinRowToWire) };
    },
  },

  /* ---- Factory policy snapshots ---- */
  {
    name: 'wallet-save-factory-policy-snapshot',
    description: 'Persist the agreed policy snapshot for a factory at JOIN time.',
    usage: 'factory_instance_id_hex policy_schema_version policy_tlv_hex captured_at_block',
    handler: (params) => {
      getDb().saveFactoryPolicySnapshot({
        factory_instance_id: bufferFromHex(
          params.factory_instance_id_hex,
          'factory_instance_id_hex',
          32
        ),
        policy_schema_version: requireNumber(
          params.policy_schema_version,
          'policy_schema_version'
        ),
        policy_tlv: bufferFromHex(params.policy_tlv_hex, 'policy_tlv_hex'),
        captured_at_block: requireNumber(params.captured_at_block, 'captured_at_block'),
      });
      return { ok: true };
    },
  },
  {
    name: 'wallet-get-factory-policy-snapshot',
    description: 'Get the agreed policy snapshot for a factory.',
    usage: 'factory_instance_id_hex',
    handler: (params) => {
      const iid = bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const row = getDb().getFactoryPolicySnapshot(iid);
      if (!row) return null;
      return {
        factory_instance_id_hex: row.factory_instance_id.toString('hex'),
        policy_schema_version: row.policy_schema_version,
        policy_tlv_hex: row.policy_tlv.toString('hex'),
        captured_at_block: row.captured_at_block,
      };
    },
  },

  /* ---- Operator preferences ---- */
  {
    name: 'wallet-set-operator-pref',
    description: 'Set an LSP operator preference (per-factory or global).',
    usage: 'factory_instance_id_hex_or_null pref_key pref_value (JSON)',
    handler: (params) => {
      const iid =
        params.factory_instance_id_hex === null ||
        params.factory_instance_id_hex === undefined
          ? null
          : bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const key = String(params.pref_key);
      getDb().setLspOperatorPref(iid, key, params.pref_value);
      return { ok: true };
    },
  },
  {
    name: 'wallet-get-operator-pref',
    description: 'Get an LSP operator preference (per-factory falling back to global).',
    usage: 'factory_instance_id_hex_or_null pref_key',
    handler: (params) => {
      const iid =
        params.factory_instance_id_hex === null ||
        params.factory_instance_id_hex === undefined
          ? null
          : bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const key = String(params.pref_key);
      return { value: getDb().getLspOperatorPref(iid, key) };
    },
  },

  /* ---- Client signing preferences ---- */
  {
    name: 'wallet-set-signing-pref',
    description: 'Set a client signing preference for a specific factory.',
    usage: 'factory_instance_id_hex pref_key pref_value (JSON)',
    handler: (params) => {
      const iid = bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const key = String(params.pref_key);
      getDb().setClientSigningPref(iid, key, params.pref_value);
      return { ok: true };
    },
  },
  {
    name: 'wallet-get-signing-pref',
    description: 'Get a client signing preference for a specific factory.',
    usage: 'factory_instance_id_hex pref_key',
    handler: (params) => {
      const iid = bufferFromHex(params.factory_instance_id_hex, 'factory_instance_id_hex', 32);
      const key = String(params.pref_key);
      return { value: getDb().getClientSigningPref(iid, key) };
    },
  },

  /* ---- Wallet settings (KV) ---- */
  {
    name: 'wallet-set-setting',
    description: 'Set a wallet-global setting.',
    usage: 'setting_key setting_value (JSON)',
    handler: (params) => {
      getDb().setSetting(String(params.setting_key), params.setting_value);
      return { ok: true };
    },
  },
  {
    name: 'wallet-get-setting',
    description: 'Get a wallet-global setting.',
    usage: 'setting_key',
    handler: (params) => ({ value: getDb().getSetting(String(params.setting_key)) }),
  },

  /* ---- Health ---- */
  {
    name: 'wallet-status',
    description: 'Plugin health-check: returns DB path and schema version.',
    usage: '',
    handler: () => ({
      schema_version: getDb().currentSchemaVersion(),
      db_path: getDb().path(),
      ready: true,
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Row → wire serializers                                              */
/* ------------------------------------------------------------------ */

function factoryRowToWire(row: FactoryRow): Record<string, unknown> {
  return {
    factory_instance_id_hex: row.factory_instance_id.toString('hex'),
    my_role: row.my_role,
    display_label: row.display_label,
    created_at_block: row.created_at_block,
    joined_at_block: row.joined_at_block,
    state: row.state,
    last_seen_at: row.last_seen_at,
    archived: row.archived,
  };
}

function joinQueueRowToWire(row: LspJoinQueueRow): Record<string, unknown> {
  return {
    factory_instance_id_hex: row.factory_instance_id.toString('hex'),
    client_pubkey_hex: row.client_pubkey.toString('hex'),
    request_id: row.request_id.toString(),
    contribution_sats: row.contribution_sats.toString(),
    received_at_block: row.received_at_block,
    accepted_at_block: row.accepted_at_block,
    decided_at_block: row.decided_at_block,
    last_seen_block: row.last_seen_block,
    status: row.status,
    reason: row.reason,
  };
}

function outgoingJoinRowToWire(row: OutgoingJoinRow): Record<string, unknown> {
  return {
    factory_instance_id_hex: row.factory_instance_id.toString('hex'),
    lsp_pubkey_hex: row.lsp_pubkey.toString('hex'),
    request_id: row.request_id.toString(),
    contribution_sats: row.contribution_sats.toString(),
    sent_at_block: row.sent_at_block,
    expected_signing_block: row.expected_signing_block,
    updated_at_block: row.updated_at_block,
    status: row.status,
    reason: row.reason,
  };
}

/* ------------------------------------------------------------------ */
/* Built-in handlers (getmanifest, init)                              */
/* ------------------------------------------------------------------ */

function handleGetManifest(): unknown {
  return {
    options: [
      {
        name: 'soupwallet-db-path',
        type: 'string',
        default: '',
        description:
          'Override path for the wallet SQLite (empty = use OS-conventional location).',
      },
    ],
    rpcmethods: RPC_METHODS.map((m) => ({
      name: m.name,
      description: m.description,
      usage: m.usage,
    })),
    subscriptions: [],
    hooks: [],
    features: {},
    dynamic: true,
  };
}

function handleInit(params: Record<string, unknown>): unknown {
  const options = (params.options ?? {}) as Record<string, unknown>;
  const dbPathOption = options['soupwallet-db-path'] as string | undefined;
  const dbPath = dbPathOption && dbPathOption.length > 0 ? dbPathOption : undefined;

  db = SuperScalarDbService.getInstance(dbPath);
  logger.info(
    `init: wallet.db ready at ${db.path()} (schema v${db.currentSchemaVersion()})`
  );
  return {};
}

/* ------------------------------------------------------------------ */
/* JSON-RPC dispatch over stdin/stdout                                 */
/* ------------------------------------------------------------------ */

function handleRequest(req: JsonRpcRequest): JsonRpcReply | null {
  const id = req.id ?? null;
  try {
    let result: unknown;
    if (req.method === 'getmanifest') {
      result = handleGetManifest();
    } else if (req.method === 'init') {
      result = handleInit((req.params as Record<string, unknown>) ?? {});
    } else {
      const method = RPC_METHODS.find((m) => m.name === req.method);
      if (!method) {
        if (id === null) return null; // Notification; ignore unknown methods.
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
      }
      const params =
        typeof req.params === 'object' && req.params !== null && !Array.isArray(req.params)
          ? (req.params as Record<string, unknown>)
          : {};
      result = method.handler(params);
    }
    if (id === null) return null;
    return { jsonrpc: '2.0', id, result };
  } catch (e) {
    if (id === null) return null;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: msg },
    };
  }
}

function writeReply(reply: JsonRpcReply): void {
  /* CLN plugin protocol: terminate each message with \n\n. */
  process.stdout.write(JSON.stringify(reply) + '\n\n');
}

let inputBuffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  inputBuffer += chunk;
  /* Messages may be newline-delimited or \n\n-delimited; we look for
   * complete JSON-RPC objects by attempting to parse incremental
   * top-level chunks. CLN sends one JSON object per message followed
   * by \n\n in v25+. */
  let nl: number;
  while ((nl = inputBuffer.indexOf('\n\n')) !== -1) {
    const raw = inputBuffer.slice(0, nl).trim();
    inputBuffer = inputBuffer.slice(nl + 2);
    if (raw.length === 0) continue;
    try {
      const req = JSON.parse(raw) as JsonRpcRequest;
      const reply = handleRequest(req);
      if (reply !== null) writeReply(reply);
    } catch (e) {
      logger.error(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
});

process.stdin.on('end', () => {
  logger.info('stdin closed; exiting');
  if (db) db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM; exiting');
  if (db) db.close();
  process.exit(0);
});

logger.info('soupwallet-plugin started; awaiting getmanifest/init');
