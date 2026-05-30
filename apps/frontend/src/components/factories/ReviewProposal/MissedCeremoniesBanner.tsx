import { useEffect, useState, useCallback } from 'react';
import { Alert, Button, Badge } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';

/**
 * Missed Ceremonies Banner — client-side sign-queue surface.
 *
 * What it renders
 *   A sticky Alert at the bottom of /factories that surfaces sign-queue
 *   events the client missed: MISSED (state 2), REFUSED (state 3),
 *   EXPIRED (state 4). Each entry shows the iid, LSP peer, deadline
 *   block, observed block, and a Dismiss button.
 *
 *   Renders nothing when there are zero un-dismissed events.
 *
 * Why this exists
 *   When a client wallet is offline during a ceremony, the LSP keeps
 *   the request enqueued; the plugin records the state transition in
 *   its sign-queue when the deadline passes. Surfacing missed/refused/
 *   expired events here gives the user an audit trail of what they
 *   missed and why — without re-attempting the ceremony.
 *
 * Key state
 *   - `events`: filtered list (dismissed=false)
 *   - Polled every 7s via wallet-list-sign-queue
 *
 * Side effects
 *   - Plugin RPCs:
 *     wallet-list-sign-queue (refresh)
 *     wallet-dismiss-sign-queue-event (Dismiss button)
 *
 * Props contract
 *   None — fully self-contained banner.
 */
type SignQueueEvent = {
  instance_id: string;
  lsp_peer_id: string;
  state: number;  // 2=MISSED, 3=REFUSED, 4=EXPIRED
  deadline_block: number;
  observed_at_block: number;
  dismissed: boolean;
};

const STATE_LABEL: Record<number, string> = {
  2: 'MISSED',
  3: 'REFUSED',
  4: 'EXPIRED',
};

const STATE_VERB: Record<number, string> = {
  2: 'missed (LSP proceeded without you)',
  3: 'refused (you declined this proposal earlier)',
  4: 'expired (ceremony aborted before quorum)',
};

const POLL_INTERVAL_MS = 10_000;

const truncate = (s: string, head = 10, tail = 6): string => {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

/* D follow-up: missed-ceremony banner.
 *
 * The plugin keeps a 32-slot ring of SIGN_QUEUE_RESPONSE entries with
 * non-AWAITING state. The wallet polls every 10s and surfaces them as
 * dismissible alerts. Click Dismiss → plugin marks the entry dismissed
 * (no longer surfaced). */
function MissedCeremoniesBanner() {
  const [events, setEvents] = useState<SignQueueEvent[]>([]);

  const poll = useCallback(() => {
    FactoriesService.listRecentSignQueueEvents()
      .then((resp) => setEvents(resp.events || []))
      .catch(() => { /* silent — older plugin without this RPC */ });
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const handleDismiss = async (iid: string) => {
    try {
      await FactoriesService.dismissSignQueueEvent(iid);
      poll();
    } catch { /* ignore */ }
  };

  const undismissed = events.filter((e) => !e.dismissed);
  if (undismissed.length === 0) return null;

  return (
    <Alert variant='info' className='mb-3' data-testid='missed-ceremonies-banner'>
      <Alert.Heading style={{ fontSize: '1rem' }}>
        ℹ {undismissed.length} factor{undismissed.length !== 1 ? 'ies' : 'y'} you weren&apos;t able to sign
      </Alert.Heading>
      <div style={{ fontSize: '0.88rem' }}>
        Your LSP{undismissed.length !== 1 ? 's' : ''} reported{' '}
        {undismissed.length !== 1 ? 'these ceremonies' : 'this ceremony'} as completed
        without your signature.
      </div>
      <hr />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {undismissed.map((e) => (
          <div
            key={e.instance_id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '0.85rem',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <code>{truncate(e.instance_id, 12, 8)}</code>
              <Badge
                bg={e.state === 2 ? 'warning' : e.state === 3 ? 'secondary' : 'danger'}
                text='dark'
                className='ms-2'
              >
                {STATE_LABEL[e.state] || `STATE ${e.state}`}
              </Badge>
              <span className='ms-2 text-muted'>
                {STATE_VERB[e.state] || ''}
              </span>
              {e.deadline_block > 0 && (
                <span className='ms-2 text-muted'>
                  · deadline block {e.deadline_block}
                </span>
              )}
            </div>
            <Button
              size='sm'
              variant='outline-secondary'
              onClick={() => handleDismiss(e.instance_id)}
              data-testid={`dismiss-${e.instance_id.slice(0, 8)}`}
            >
              Dismiss
            </Button>
          </div>
        ))}
      </div>
    </Alert>
  );
}

export default MissedCeremoniesBanner;
