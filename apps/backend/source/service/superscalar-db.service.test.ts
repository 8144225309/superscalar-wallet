/**
 * Tests for SuperScalarDbService.
 *
 * Uses a temp dir for isolation; resets singleton between tests.
 *
 * Run: cd wallet/apps/backend && node --test --experimental-strip-types
 *      source/service/superscalar-db.service.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import {
  SuperScalarDbService,
  SUPERSCALAR_WALLET_DB_SCHEMA_VERSION,
  FactoryRole,
  JoinStatus,
  OutgoingJoinStatus,
} from './superscalar-db.service.js';

function freshService(): { svc: SuperScalarDbService; cleanup: () => void } {
  SuperScalarDbService.resetInstanceForTest();
  const dir = mkdtempSync(join(tmpdir(), 'ssdb-test-'));
  const dbPath = join(dir, 'wallet.db');
  const svc = SuperScalarDbService.getInstance(dbPath);
  return {
    svc,
    cleanup: () => {
      SuperScalarDbService.resetInstanceForTest();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fakeIid(seed: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.fill(seed);
  return buf;
}

function fakePubkey(seed: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.fill(seed);
  return buf;
}

test('schema is at expected version after init', () => {
  const { svc, cleanup } = freshService();
  try {
    assert.equal(svc.currentSchemaVersion(), SUPERSCALAR_WALLET_DB_SCHEMA_VERSION);
  } finally {
    cleanup();
  }
});

test('factories: upsert and retrieve', () => {
  const { svc, cleanup } = freshService();
  try {
    const iid = fakeIid(0x10);
    svc.upsertFactory({
      factory_instance_id: iid,
      my_role: FactoryRole.LSP,
      display_label: 'my hosted factory',
      created_at_block: 100,
      joined_at_block: null,
      state: 1,
      archived: 0,
    });
    const row = svc.getFactory(iid);
    assert.ok(row);
    assert.equal(row!.my_role, FactoryRole.LSP);
    assert.equal(row!.display_label, 'my hosted factory');
    assert.equal(row!.created_at_block, 100);
    assert.equal(row!.archived, 0);
  } finally {
    cleanup();
  }
});

test('factories: list by role excludes archived by default', () => {
  const { svc, cleanup } = freshService();
  try {
    svc.upsertFactory({
      factory_instance_id: fakeIid(0x20),
      my_role: FactoryRole.LSP,
      display_label: 'a',
      created_at_block: 100,
      joined_at_block: null,
      state: 1,
      archived: 0,
    });
    svc.upsertFactory({
      factory_instance_id: fakeIid(0x21),
      my_role: FactoryRole.LSP,
      display_label: 'b (archived)',
      created_at_block: 90,
      joined_at_block: null,
      state: 9,
      archived: 1,
    });
    svc.upsertFactory({
      factory_instance_id: fakeIid(0x22),
      my_role: FactoryRole.CLIENT,
      display_label: 'c',
      created_at_block: 80,
      joined_at_block: 95,
      state: 1,
      archived: 0,
    });
    const lspFactories = svc.listFactoriesByRole(FactoryRole.LSP);
    assert.equal(lspFactories.length, 1);
    assert.equal(lspFactories[0].display_label, 'a');

    const allLsp = svc.listFactoriesByRole(FactoryRole.LSP, true);
    assert.equal(allLsp.length, 2);
  } finally {
    cleanup();
  }
});

test('lsp_join_queue: upsert + filter by status + count', () => {
  const { svc, cleanup } = freshService();
  try {
    const iid = fakeIid(0x30);
    svc.upsertJoinQueueEntry({
      factory_instance_id: iid,
      client_pubkey: fakePubkey(0x40),
      request_id: 12345n,
      contribution_sats: 50000n,
      received_at_block: 200,
      accepted_at_block: 201,
      decided_at_block: 201,
      last_seen_block: 205,
      status: JoinStatus.ACCEPTED,
      reason: null,
    });
    svc.upsertJoinQueueEntry({
      factory_instance_id: iid,
      client_pubkey: fakePubkey(0x41),
      request_id: 12346n,
      contribution_sats: 50000n,
      received_at_block: 210,
      accepted_at_block: null,
      decided_at_block: null,
      last_seen_block: 210,
      status: JoinStatus.PENDING,
      reason: null,
    });
    svc.upsertJoinQueueEntry({
      factory_instance_id: iid,
      client_pubkey: fakePubkey(0x42),
      request_id: 12347n,
      contribution_sats: 25000n,
      received_at_block: 215,
      accepted_at_block: null,
      decided_at_block: 220,
      last_seen_block: 215,
      status: JoinStatus.REJECTED,
      reason: 'banlist',
    });

    const accepted = svc.listJoinQueueByStatus(iid, JoinStatus.ACCEPTED);
    assert.equal(accepted.length, 1);
    assert.equal(svc.countJoinQueueByStatus(iid, JoinStatus.ACCEPTED), 1);
    assert.equal(svc.countJoinQueueByStatus(iid, JoinStatus.PENDING), 1);
    assert.equal(svc.countJoinQueueByStatus(iid, JoinStatus.REJECTED), 1);
  } finally {
    cleanup();
  }
});

test('outgoing_joins: upsert and list by status', () => {
  const { svc, cleanup } = freshService();
  try {
    const iid = fakeIid(0x50);
    svc.upsertOutgoingJoin({
      factory_instance_id: iid,
      lsp_pubkey: fakePubkey(0x60),
      request_id: 9999n,
      contribution_sats: 10000n,
      sent_at_block: 300,
      expected_signing_block: 305,
      updated_at_block: 302,
      status: OutgoingJoinStatus.ACCEPTED,
      reason: null,
    });
    const accepted = svc.listOutgoingJoinsByStatus(OutgoingJoinStatus.ACCEPTED);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].request_id, 9999n);
  } finally {
    cleanup();
  }
});

test('iid_counter: starts at 0, increments atomically', () => {
  const { svc, cleanup } = freshService();
  try {
    assert.equal(svc.getIidCounter(), 0);
    assert.equal(svc.incrementIidCounter(), 1);
    assert.equal(svc.incrementIidCounter(), 2);
    assert.equal(svc.incrementIidCounter(), 3);
    assert.equal(svc.getIidCounter(), 3);
  } finally {
    cleanup();
  }
});

test('factory_policy_snapshots: save + retrieve + replace', () => {
  const { svc, cleanup } = freshService();
  try {
    const iid = fakeIid(0x70);
    const tlv1 = Buffer.from('aabbccdd', 'hex');
    svc.saveFactoryPolicySnapshot({
      factory_instance_id: iid,
      policy_schema_version: 1,
      policy_tlv: tlv1,
      captured_at_block: 400,
    });
    let row = svc.getFactoryPolicySnapshot(iid);
    assert.ok(row);
    assert.deepEqual(row!.policy_tlv, tlv1);

    const tlv2 = Buffer.from('ffeeddcc', 'hex');
    svc.saveFactoryPolicySnapshot({
      factory_instance_id: iid,
      policy_schema_version: 1,
      policy_tlv: tlv2,
      captured_at_block: 410,
    });
    row = svc.getFactoryPolicySnapshot(iid);
    assert.deepEqual(row!.policy_tlv, tlv2);
    assert.equal(row!.captured_at_block, 410);
  } finally {
    cleanup();
  }
});

test('lsp_operator_prefs: per-factory takes precedence over global', () => {
  const { svc, cleanup } = freshService();
  try {
    const iid = fakeIid(0x80);
    svc.setLspOperatorPref(null, 'auto_rotate_cadence_blocks', 4320);
    assert.equal(
      svc.getLspOperatorPref<number>(iid, 'auto_rotate_cadence_blocks'),
      4320
    );

    svc.setLspOperatorPref(iid, 'auto_rotate_cadence_blocks', 1440);
    assert.equal(
      svc.getLspOperatorPref<number>(iid, 'auto_rotate_cadence_blocks'),
      1440
    );

    const otherIid = fakeIid(0x81);
    assert.equal(
      svc.getLspOperatorPref<number>(otherIid, 'auto_rotate_cadence_blocks'),
      4320
    );
  } finally {
    cleanup();
  }
});

test('lsp_operator_prefs: complex JSON values round-trip', () => {
  const { svc, cleanup } = freshService();
  try {
    const banlist = ['03aa00...', '02bb00...'];
    svc.setLspOperatorPref(null, 'banlist_entries', banlist);
    const out = svc.getLspOperatorPref<string[]>(null, 'banlist_entries');
    assert.deepEqual(out, banlist);
  } finally {
    cleanup();
  }
});

test('client_signing_prefs: per-factory only, no fallback', () => {
  const { svc, cleanup } = freshService();
  try {
    const iid = fakeIid(0x90);
    svc.setClientSigningPref(iid, 'auto_sign_scheduled_rotations', true);
    assert.equal(
      svc.getClientSigningPref<boolean>(iid, 'auto_sign_scheduled_rotations'),
      true
    );
    /* Different factory should NOT inherit. */
    const other = fakeIid(0x91);
    assert.equal(
      svc.getClientSigningPref<boolean>(other, 'auto_sign_scheduled_rotations'),
      null
    );
  } finally {
    cleanup();
  }
});

test('wallet_settings: KV round-trip with mixed types', () => {
  const { svc, cleanup } = freshService();
  try {
    svc.setSetting('wallet_role', 'both');
    svc.setSetting('default_browse_lsps', ['lsp1', 'lsp2']);
    svc.setSetting('auto_join_friend_factories', false);

    assert.equal(svc.getSetting<string>('wallet_role'), 'both');
    assert.deepEqual(svc.getSetting<string[]>('default_browse_lsps'), ['lsp1', 'lsp2']);
    assert.equal(svc.getSetting<boolean>('auto_join_friend_factories'), false);
    assert.equal(svc.getSetting('nonexistent_key'), null);
  } finally {
    cleanup();
  }
});

test('singleton: same instance returned across getInstance calls', () => {
  const { svc, cleanup } = freshService();
  try {
    const a = SuperScalarDbService.getInstance();
    const b = SuperScalarDbService.getInstance();
    assert.strictEqual(a, b);
    assert.strictEqual(a, svc);
  } finally {
    cleanup();
  }
});
