import { useEffect, useState } from 'react';
import { Alert, Button, Badge } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';
import ReviewProposalModal from './ReviewProposalModal';

/**
 * Held Proposals Banner — client-side sticky review prompt (D.5).
 *
 * What it renders
 *   A sticky Alert that surfaces any FACTORY_PROPOSE wire message
 *   the plugin is HOLDING for the operator's approve/refuse decision
 *   (`auto_sign_on_validator_pass=false`). Counterpart to
 *   JoinQueueBanner (the LSP-side sticky banner). Click → opens
 *   ReviewProposalModal for the oldest held proposal.
 *
 * Key state
 *   - `held`: array of HeldProposal rows (poll every 5s)
 *   - `selected`: the row currently open in the modal
 *
 * Side effects
 *   - Plugin RPCs:
 *     wallet-list-held-proposals (poll)
 *     factory-approve-proposal / factory-refuse-proposal (modal)
 *
 * Props contract
 *   None — mounts wherever the client UI needs the sticky review
 *   prompt (typically above the factories list).
 */


type HeldProposal = {
  instance_id: string;
  lsp_peer_id: string;
  funding_sats: number;
  n_participants: number;
  our_pidx: number;
  received_at_block: number;
  validator_result: number;
};

const POLL_INTERVAL_MS = 5_000;

const truncate = (s: string, head = 10, tail = 6): string => {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const formatSats = (n: number): string => n.toLocaleString();

/* D.5 sticky review banner.
 *
 * Polls client-list-held-proposals every 5s. When the plugin is holding
 * one or more FACTORY_PROPOSE messages (auto_sign_on_validator_pass=OFF
 * caught them), surface a sticky warning at the top of the page with a
 * Review button per entry. Click → opens the B4 ReviewProposalModal,
 * which now uses the load-bearing factory-approve/refuse-proposal RPCs
 * (D.6) to release or drop the held proposal. */
function HeldProposalsBanner() {
  const [held, setHeld] = useState<HeldProposal[]>([]);
  const [reviewingIid, setReviewingIid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      FactoriesService.listHeldProposals()
        .then((resp) => {
          if (!cancelled) setHeld(resp.held || []);
        })
        .catch(() => {
          /* Silent — banner just stays empty if the RPC fails (older
           * plugin without D.5 support, or transient connectivity). */
        });
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (held.length === 0) return null;

  return (
    <>
      <Alert variant='warning' className='mb-3' data-testid='held-proposals-banner'>
        <Alert.Heading style={{ fontSize: '1rem' }}>
          ⚠ {held.length} factory proposal{held.length !== 1 ? 's' : ''} awaiting your approval
        </Alert.Heading>
        <div style={{ fontSize: '0.88rem' }}>
          Auto-sign is OFF, so the plugin is holding{' '}
          {held.length === 1 ? 'this proposal' : `these ${held.length} proposals`} until
          you Approve or Refuse. The LSP will time out and proceed without you if
          you don&apos;t respond before their deadline.
        </div>
        <hr />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {held.map((h) => (
            <div
              key={h.instance_id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <code>{truncate(h.instance_id, 12, 8)}</code>
                <span className='ms-2 text-muted'>
                  funding {formatSats(h.funding_sats)} sat
                </span>
                <span className='ms-2 text-muted'>
                  · pidx {h.our_pidx} of {h.n_participants}
                </span>
                <Badge bg='warning' text='dark' className='ms-2'>PENDING REVIEW</Badge>
              </div>
              <Button
                size='sm'
                variant='primary'
                onClick={() => setReviewingIid(h.instance_id)}
                data-testid={`review-held-${h.instance_id.slice(0, 8)}`}
              >
                Review
              </Button>
            </div>
          ))}
        </div>
      </Alert>

      {reviewingIid && (
        <ReviewProposalModal
          instanceId={reviewingIid}
          show={true}
          onClose={() => setReviewingIid(null)}
        />
      )}
    </>
  );
}

export default HeldProposalsBanner;
