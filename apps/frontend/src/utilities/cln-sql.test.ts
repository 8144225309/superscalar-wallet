import {
  ListPeerChannelsSQL,
  ListOffersSQL,
  ListOffersSQLWithoutDesc,
  listLightningTransactionsSQL,
  listBTCTransactionsSQL,
} from './cln-sql';

describe('cln-sql', () => {
  describe('ListPeerChannelsSQL', () => {
    it('is a string constant — single-statement SELECT', () => {
      expect(typeof ListPeerChannelsSQL).toBe('string');
      expect(ListPeerChannelsSQL).toMatch(/^SELECT /i);
      expect(ListPeerChannelsSQL.endsWith(';')).toBe(true);
    });

    it('joins peerchannels to nodes via peer_id ← nodeid', () => {
      expect(ListPeerChannelsSQL).toContain('peerchannels pc');
      expect(ListPeerChannelsSQL).toContain('LEFT JOIN nodes n ON pc.peer_id = n.nodeid');
    });

    it('selects the columns components rely on (state, scid, balances, opener)', () => {
      for (const col of [
        'pc.state',
        'pc.short_channel_id',
        'pc.to_us_msat',
        'pc.total_msat',
        'pc.opener',
        'n.alias as node_alias',
      ]) {
        expect(ListPeerChannelsSQL).toContain(col);
      }
    });
  });

  describe('ListOffersSQL builder', () => {
    it('embeds limit + offset literally — paginated query shape', () => {
      const q = ListOffersSQL(50, 100);
      expect(q).toContain('LIMIT 50 OFFSET 100');
      expect(q).toContain('FROM offers');
      expect(q).toContain('ORDER BY offer_id');
    });

    it('without-description variant returns empty description column', () => {
      const q = ListOffersSQLWithoutDesc(10, 0);
      expect(q).toContain("'' as description");
      expect(q).not.toContain('COALESCE(description');
    });
  });

  describe('listLightningTransactionsSQL', () => {
    it('returns a query containing the paginated_hashes CTE', () => {
      const q = listLightningTransactionsSQL(20, 40);
      expect(q).toContain('WITH unique_payment_hashes');
      expect(q).toContain('paginated_hashes');
      expect(q).toContain('LIMIT 20 OFFSET 40');
    });

    it('emits a UNION ALL between INVOICE rows and PAYMENT rows', () => {
      const q = listLightningTransactionsSQL(5, 0);
      expect(q).toContain("'INVOICE' as type");
      expect(q).toContain("'PAYMENT' as type");
      expect(q).toContain('UNION ALL');
    });

    it('excludes expired invoices and orders by sort_time DESC', () => {
      const q = listLightningTransactionsSQL(5, 0);
      expect(q).toContain("WHERE i.status != 'expired'");
      expect(q).toContain('ORDER BY sort_time DESC');
    });
  });

  describe('listBTCTransactionsSQL', () => {
    it('embeds limit + offset and filters to wallet deposit/withdrawal', () => {
      const q = listBTCTransactionsSQL(30, 60);
      expect(q).toContain('LIMIT 30 OFFSET 60');
      expect(q).toContain("e.account = 'wallet'");
      expect(q).toContain("e.tag = 'deposit'");
      expect(q).toContain("e.tag = 'withdrawal'");
    });
  });
});
