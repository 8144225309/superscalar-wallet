import './ReviewProposal.scss';
import { useEffect, useState } from 'react';
import { Modal, Button, Spinner, Table } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';
import {
  ReviewProposalResponse,
  ValidationResult,
} from '../../../types/review-proposal.type';
import { ProofTier } from '../../../types/signing-prefs.type';

type Props = {
  instanceId: string;
  lspPeerId?: string;
  show: boolean;
  onClose: () => void;
};

const truncate = (s?: string, head = 8, tail = 4): string => {
  if (!s) return '—';
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const formatErr = (err: any, fallback: string): string => {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  try {
    const s = JSON.stringify(err);
    if (s && s !== '{}' && s !== 'null') return s;
  } catch { /* circular ref */ }
  return fallback;
};

const formatSats = (n?: number): string => {
  if (n == null) return '—';
  return n.toLocaleString();
};

const formatPct = (basisPointsX100?: number): string => {
  if (basisPointsX100 == null) return '—';
  return (basisPointsX100 / 100).toFixed(2) + '%';
};

const PROOF_TIER_NAME: Record<number, string> = {
  [ProofTier.CHANNEL]: 'CHANNEL',
  [ProofTier.INVOICE]: 'INVOICE',
  [ProofTier.NONE]: 'NONE',
};

type PolicyRow = {
  label: string;
  policyVal?: string | number | boolean;
  prefBound?: string;
  /** True when this field is the one the validator flagged. */
  flagged?: boolean;
};

function ReviewProposalModal({ instanceId, lspPeerId, show, onClose }: Props) {
  const [data, setData] = useState<ReviewProposalResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setIsLoading(true);
    setErr(null);
    setData(null);
    setActionMessage(null);
    FactoriesService.reviewProposal(instanceId, lspPeerId)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(formatErr(e,
            'Plugin RPC factory-review-proposal failed. ' +
            'Ensure superscalar-cln PR #63 is deployed.',
          ));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [show, instanceId, lspPeerId]);

  const handleApprove = async () => {
    if (!data) return;
    setActionInFlight(true);
    setActionMessage(null);
    try {
      /* Plugin RPC is a B3-follow-up; until it lands we surface the
       * gap honestly rather than silently no-op. */
      await FactoriesService.approveProposal(instanceId, data.lsp_peer_id);
      setActionMessage('Proposal approved. Plugin will proceed with signing.');
    } catch (e) {
      setActionMessage('Approve failed: ' + formatErr(e,
        'Plugin RPC factory-approve-proposal not yet wired (B4 follow-up task).',
      ));
    } finally {
      setActionInFlight(false);
    }
  };

  const handleRefuse = async () => {
    if (!data) return;
    setActionInFlight(true);
    setActionMessage(null);
    try {
      await FactoriesService.refuseProposal(instanceId, data.lsp_peer_id);
      setActionMessage('Proposal refused. The LSP will time out waiting for your signature.');
    } catch (e) {
      setActionMessage('Refuse failed: ' + formatErr(e,
        'Plugin RPC factory-refuse-proposal not yet wired (B4 follow-up task).',
      ));
    } finally {
      setActionInFlight(false);
    }
  };

  const validation = data?.validation;
  const validationCls = validation
    ? validation.result === ValidationResult.OK ? 'ok'
      : validation.result === ValidationResult.HARD_FAIL ? 'hard-fail'
      : 'soft-fail'
    : 'unknown';

  const buildPolicyRows = (): PolicyRow[] => {
    if (!data) return [];
    const p = data.advertised_policy || {};
    const u = data.user_prefs;
    const flaggedTlv = data.validation?.field_tlv;
    const row = (label: string, policyVal: any, prefBound: string, tlv?: number): PolicyRow => ({
      label, policyVal,
      prefBound,
      flagged: tlv != null && flaggedTlv === tlv,
    });
    return [
      row('htlc_min_sat', formatSats(p.htlc_min_sat),
          `≤ ${formatSats(u.max_htlc_min_sat)}`, 0x0801),
      row('htlc_max_sat', formatSats(p.htlc_max_sat),
          `≥ ${formatSats(u.min_htlc_max_sat)}`, 0x0802),
      row('max_concurrent_htlcs_per_channel', p.max_concurrent_htlcs_per_channel,
          `≥ ${u.min_max_concurrent_htlcs}`, 0x0803),
      row('max_in_flight_msat_per_channel', formatSats(p.max_in_flight_msat_per_channel) + ' msat',
          `≥ ${formatSats(u.min_max_in_flight_msat)} msat`, 0x0804),
      row('min_final_cltv_expiry_delta', p.min_final_cltv_expiry_delta,
          `≤ ${u.max_min_final_cltv_delta} blocks`, 0x0805),
      row('cltv_expiry_delta_forward', p.cltv_expiry_delta_forward,
          `≤ ${u.max_cltv_delta_forward} blocks`, 0x0806),
      row('min_capacity_per_join_sat', formatSats(p.min_capacity_per_join_sat),
          `≤ ${formatSats(u.max_min_capacity_per_join_sat)}`, 0x0807),
      row('max_capacity_per_join_sat', formatSats(p.max_capacity_per_join_sat),
          `≥ ${formatSats(u.min_max_capacity_per_join_sat)}`, 0x0808),
      row('proof_tier_required',
          p.proof_tier_required != null ? PROOF_TIER_NAME[p.proof_tier_required] : '—',
          u.require_strict_proof_tier ? `≤ ${PROOF_TIER_NAME[u.max_proof_tier]}` : 'any tier accepted',
          0x0809),
      row('rotation_interval_blocks', p.rotation_interval_blocks,
          `≥ ${u.min_rotation_interval_blocks} blocks`, 0x080A),
      row('allow_tier_b_rollover',
          p.allow_tier_b_rollover == null ? '—' : (p.allow_tier_b_rollover ? 'true' : 'false'),
          u.require_tier_b_rollover ? 'required' : 'optional', 0x080B),
      row('state_replay_defense_window_blocks', p.state_replay_defense_window_blocks,
          `≥ ${u.min_state_replay_defense_window_blocks} blocks`, 0x080C),
    ];
  };

  return (
    <Modal show={show} onHide={onClose} size='xl' className='review-proposal-modal' data-testid='review-proposal-modal'>
      <Modal.Header closeButton>
        <Modal.Title>Review factory proposal</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className='meta-line'>
          instance_id <span className='truncate'>{truncate(instanceId, 12, 8)}</span>
          {data?.lsp_peer_id && (
            <> · LSP <span className='truncate'>{truncate(data.lsp_peer_id, 12, 8)}</span></>
          )}
          {data?.received_at_block != null && <> · received at block {data.received_at_block}</>}
        </div>

        {isLoading && (
          <div className='text-center my-4'>
            <Spinner animation='border' size='sm' className='me-2' />
            Loading proposal review…
          </div>
        )}

        {err && (
          <div className='validation-banner unknown'>
            <strong>Could not load review:</strong> {err}
          </div>
        )}

        {data && validation && (
          <>
            <div className={`validation-banner ${validationCls}`} data-testid='validation-banner'>
              {validation.result === ValidationResult.OK && (
                <>
                  <span className='badge bg-success'>OK</span>
                  All joiner-enforceable thresholds satisfied. Safe to sign.
                </>
              )}
              {validation.result === ValidationResult.HARD_FAIL && (
                <>
                  <span className='badge bg-danger'>REFUSE</span>
                  Validator hard-failed on field <code>{validation.field_name || `tlv 0x${validation.field_tlv?.toString(16)}`}</code>.
                  {validation.reason && <div className='mt-1' style={{ fontSize: '0.85rem' }}>{validation.reason}</div>}
                </>
              )}
              {validation.result === ValidationResult.SOFT_FAIL && (
                <>
                  <span className='badge bg-warning text-dark'>WARN</span>
                  Soft warning on <code>{validation.field_name || `tlv 0x${validation.field_tlv?.toString(16)}`}</code> — you may still sign at your own risk.
                  {validation.reason && <div className='mt-1' style={{ fontSize: '0.85rem' }}>{validation.reason}</div>}
                </>
              )}
            </div>

            <div className='section-header'>Your stake</div>
            <div className='kv-row'>
              <span className='k'>Total factory funding</span>
              <span className='v'>{formatSats(data.proposed.funding_sats)} sat</span>
            </div>
            <div className='kv-row'>
              <span className='k'>Your allocation</span>
              <span className='v'>
                {formatSats(data.proposed.our_allocation_sats)} sat ({formatPct(data.proposed.our_allocation_pct_x100)})
              </span>
            </div>
            <div className='kv-row'>
              <span className='k'>Your participant index</span>
              <span className='v'>{data.proposed.our_pidx} of {data.proposed.n_participants}</span>
            </div>

            <div className='section-header'>All allocations</div>
            <Table size='sm' className='allocations-table' borderless>
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>pidx</th>
                  <th>node_id</th>
                  <th style={{ textAlign: 'right' }}>sats</th>
                  <th style={{ textAlign: 'right' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {data.proposed.all_allocations.map((a) => {
                  const isOurs = a.pidx === data.proposed.our_pidx;
                  const pct = data.proposed.funding_sats > 0
                    ? (a.allocation_sats / data.proposed.funding_sats) * 100
                    : 0;
                  return (
                    <tr key={a.pidx} className={isOurs ? 'ours' : ''}>
                      <td>{a.pidx}{isOurs && ' ←'}</td>
                      <td><code style={{ fontSize: '0.8rem' }}>{truncate(a.node_id, 10, 6)}</code></td>
                      <td style={{ textAlign: 'right' }}>{formatSats(a.allocation_sats)}</td>
                      <td style={{ textAlign: 'right' }}>{pct.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            <div className='section-header'>
              Advertised policy vs your prefs
              {!data.advertised_policy_known && (
                <span className='ms-2 badge bg-warning text-dark'>policy unknown</span>
              )}
            </div>
            {!data.advertised_policy_known ? (
              <div style={{ fontSize: '0.88rem', color: '#6c757d' }}>
                The wallet has not browsed this LSP&apos;s policy. The validator ran against canonical defaults.
                Browse the LSP first (Connect → Browse host) to load its advertised policy.
              </div>
            ) : (
              <div>
                {buildPolicyRows().map((r) => (
                  <div className='kv-row' key={r.label}>
                    <span className='k'>{r.label}</span>
                    <span className={`v ${r.flagged ? 'bad' : ''}`}>
                      {String(r.policyVal)} <span style={{ color: '#6c757d' }}>({r.prefBound})</span>
                      {r.flagged && <span className='ms-2 badge bg-danger'>flagged</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {actionMessage && (
              <div className='validation-banner unknown mt-3' style={{ fontSize: '0.85rem' }}>
                {actionMessage}
              </div>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant='outline-secondary' onClick={onClose} disabled={actionInFlight}>
          Close
        </Button>
        <Button
          variant='outline-danger'
          onClick={handleRefuse}
          disabled={!data || actionInFlight}
          data-testid='refuse-proposal'
        >
          Refuse
        </Button>
        <Button
          variant='primary'
          onClick={handleApprove}
          disabled={!data || actionInFlight || validation?.result === ValidationResult.HARD_FAIL}
          data-testid='approve-proposal'
        >
          {actionInFlight ? (
            <><Spinner animation='border' size='sm' className='me-2' />Working…</>
          ) : 'Approve & sign'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default ReviewProposalModal;
