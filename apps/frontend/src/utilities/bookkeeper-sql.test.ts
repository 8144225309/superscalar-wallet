import { AccountEventsSQL, SatsFlowSQL, VolumeSQL } from './bookkeeper-sql';

describe('bookkeeper-sql', () => {
  describe('AccountEventsSQL', () => {
    it('is a single-statement SELECT terminated with a semicolon', () => {
      expect(typeof AccountEventsSQL).toBe('string');
      expect(AccountEventsSQL).toMatch(/^SELECT /i);
      expect(AccountEventsSQL.endsWith(';')).toBe(true);
    });

    it('joins bkpr_accountevents → peerchannels → nodes via the canonical chain', () => {
      expect(AccountEventsSQL).toContain('FROM bkpr_accountevents');
      expect(AccountEventsSQL).toContain('LEFT JOIN peerchannels ON upper(bkpr_accountevents.account)=hex(peerchannels.channel_id)');
      expect(AccountEventsSQL).toContain('LEFT JOIN nodes ON peerchannels.peer_id=nodes.nodeid');
    });

    it('selects required columns the AccountEvents components consume', () => {
      for (const col of [
        'peerchannels.short_channel_id',
        'nodes.alias',
        'bkpr_accountevents.credit_msat',
        'bkpr_accountevents.debit_msat',
        'bkpr_accountevents.account',
        'bkpr_accountevents.timestamp',
      ]) {
        expect(AccountEventsSQL).toContain(col);
      }
    });

    it('excludes onchain_fee + external account events', () => {
      expect(AccountEventsSQL).toContain("bkpr_accountevents.type != 'onchain_fee'");
      expect(AccountEventsSQL).toContain("bkpr_accountevents.account != 'external'");
    });
  });

  describe('SatsFlowSQL builder', () => {
    it('embeds both timestamps literally in BETWEEN clause', () => {
      const q = SatsFlowSQL(1700000000, 1800000000);
      expect(q).toContain('WHERE bkpr_income.timestamp BETWEEN 1700000000 AND 1800000000');
    });

    it('selects from bkpr_income with the expected projection', () => {
      const q = SatsFlowSQL(0, 1);
      expect(q).toContain('FROM bkpr_income');
      for (const col of ['account', 'tag', 'credit_msat', 'debit_msat', 'currency', 'timestamp', 'description', 'outpoint', 'txid', 'payment_id']) {
        expect(q).toContain(col);
      }
    });

    it('terminates with a semicolon (single-statement)', () => {
      const q = SatsFlowSQL(1, 2);
      expect(q.endsWith(';')).toBe(true);
    });
  });

  describe('VolumeSQL', () => {
    it('aggregates settled forwards by in/out channel + peer alias', () => {
      expect(VolumeSQL).toContain('FROM forwards f');
      expect(VolumeSQL).toContain("WHERE f.status = 'settled'");
      expect(VolumeSQL).toContain('GROUP BY f.in_channel');
      expect(VolumeSQL).toContain('SUM(f.fee_msat) AS total_fee_msat');
    });

    it('joins peer_in + peer_out + alias_in + alias_out via the four-step LEFT JOIN chain', () => {
      expect(VolumeSQL).toContain('LEFT JOIN peerchannels pc_in ON pc_in.short_channel_id = f.in_channel');
      expect(VolumeSQL).toContain('LEFT JOIN nodes n_in ON n_in.nodeid = pc_in.peer_id');
      expect(VolumeSQL).toContain('LEFT JOIN peerchannels pc_out ON pc_out.short_channel_id = f.out_channel');
      expect(VolumeSQL).toContain('LEFT JOIN nodes n_out ON n_out.nodeid = pc_out.peer_id');
    });
  });
});
