import { useEffect, useState } from 'react';
import { Card, Spinner, Table, Alert, Badge } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';

type CachedEntry = {
  lsp_peer_id: string;
  instance_id: string;
  cached_at_block: number;
  policy: Record<string, any>;
};

type Props = {
  instanceId: string;
};

const formatSats = (n?: number): string =>
  n == null ? '—' : n.toLocaleString();

const PROOF_TIER_NAME = ['CHANNEL', 'INVOICE', 'NONE'];

/* Phase C: render the persisted policy snapshot for this factory.
 * Polls factory-get-cached-policy with the instance_id filter. */
function FactoryPolicyView({ instanceId }: Props) {
  const [entry, setEntry] = useState<CachedEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    FactoriesService.getCachedPolicy(instanceId)
      .then((resp) => {
        if (cancelled) return;
        setEntry(resp.entries && resp.entries.length > 0 ? resp.entries[0] : null);
      })
      .catch((e: any) => {
        if (!cancelled) setErr(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [instanceId]);

  if (loading) {
    return (
      <Card className='mt-3'>
        <Card.Body className='text-center'>
          <Spinner animation='border' size='sm' className='me-2' />
          Loading policy…
        </Card.Body>
      </Card>
    );
  }

  if (err) {
    return (
      <Alert variant='warning' className='mt-3 py-2'>
        Could not load policy: {err}
      </Alert>
    );
  }

  if (!entry) {
    return (
      <Card className='mt-3'>
        <Card.Body>
          <Card.Title style={{ fontSize: '1rem' }}>Policy in force</Card.Title>
          <Card.Subtitle className='text-muted mb-2' style={{ fontSize: '0.85rem' }}>
            No policy on file
          </Card.Subtitle>
          <div style={{ fontSize: '0.88rem' }}>
            The plugin has no cached policy for this factory.  Either the LSP
            never advertised one (validator runs against canonical defaults), or
            the cache was cleared.  Run <code>factory-browse-host</code> on the
            LSP to refresh.
          </div>
        </Card.Body>
      </Card>
    );
  }

  const p = entry.policy;

  return (
    <Card className='mt-3' data-testid='factory-policy-view'>
      <Card.Body>
        <Card.Title style={{ fontSize: '1rem' }}>
          Policy in force
          <Badge bg='secondary' className='ms-2'>
            cached at block {entry.cached_at_block}
          </Badge>
        </Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
          The advertised policy from the LSP at browse time.  The validator
          checks every incoming FACTORY_PROPOSE against this snapshot.
        </Card.Subtitle>

        <Table size='sm' borderless>
          <tbody style={{ fontSize: '0.85rem' }}>
            <tr><td style={{ width: '40%', color: '#6c757d' }}>schema_version</td><td>{p.schema_version}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>leaf_arity / arity_mode</td><td>{p.leaf_arity} / {p.arity_mode}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>lifetime_blocks</td><td>{p.lifetime_blocks}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>dying_period_blocks</td><td>{p.dying_period_blocks}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>per_client_capacity_sat</td><td>{formatSats(p.per_client_capacity_sat)}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>lsp_fee_sat / ppm</td><td>{formatSats(p.lsp_fee_sat)} sat + {p.lsp_fee_ppm} ppm</td></tr>
            <tr><td style={{ color: '#6c757d' }}>htlc_min_sat / htlc_max_sat</td><td>{formatSats(p.htlc_min_sat)} … {formatSats(p.htlc_max_sat)}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>max_concurrent_htlcs_per_channel</td><td>{p.max_concurrent_htlcs_per_channel}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>max_in_flight_msat_per_channel</td><td>{formatSats(p.max_in_flight_msat_per_channel)} msat</td></tr>
            <tr><td style={{ color: '#6c757d' }}>min_final_cltv_expiry_delta</td><td>{p.min_final_cltv_expiry_delta} blocks</td></tr>
            <tr><td style={{ color: '#6c757d' }}>cltv_expiry_delta_forward</td><td>{p.cltv_expiry_delta_forward} blocks</td></tr>
            <tr><td style={{ color: '#6c757d' }}>capacity per join (min / max)</td><td>{formatSats(p.min_capacity_per_join_sat)} … {formatSats(p.max_capacity_per_join_sat)} sat</td></tr>
            <tr><td style={{ color: '#6c757d' }}>proof_tier_required</td><td>{PROOF_TIER_NAME[p.proof_tier_required] || p.proof_tier_required}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>rotation_interval_blocks</td><td>{p.rotation_interval_blocks}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>allow_tier_b_rollover</td><td>{p.allow_tier_b_rollover ? 'true' : 'false'}</td></tr>
            <tr><td style={{ color: '#6c757d' }}>state_replay_defense_window_blocks</td><td>{p.state_replay_defense_window_blocks}</td></tr>
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
}

export default FactoryPolicyView;
