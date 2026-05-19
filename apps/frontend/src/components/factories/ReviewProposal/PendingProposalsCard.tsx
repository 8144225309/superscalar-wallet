import { useMemo, useState } from 'react';
import { Card, Button, Badge } from 'react-bootstrap';
import { useSelector } from 'react-redux';
import { selectFactoryList } from '../../../store/factoriesSelectors';
import { Factory, FactoryCeremony } from '../../../types/factories.type';
import ReviewProposalModal from './ReviewProposalModal';

const truncate = (s: string, head = 8, tail = 4): string => {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const ceremonyBadge = (ceremony: string) => {
  switch (ceremony) {
    case FactoryCeremony.PROPOSED:
      return { bg: 'warning', text: 'dark', label: 'PENDING REVIEW' };
    case FactoryCeremony.NONCES_COLLECTED:
    case FactoryCeremony.PSIGS_COLLECTED:
      return { bg: 'info', text: 'dark', label: 'SIGNING' };
    case FactoryCeremony.COMPLETE:
      return { bg: 'success', text: 'light', label: 'REVIEWED' };
    case FactoryCeremony.FAILED:
    case FactoryCeremony.REVOKED:
      return { bg: 'danger', text: 'light', label: ceremony.toUpperCase() };
    default:
      return { bg: 'secondary', text: 'light', label: ceremony.toUpperCase() };
  }
};

function PendingProposalsCard() {
  const factoryList = useSelector(selectFactoryList);
  const [reviewing, setReviewing] = useState<string | null>(null);

  /* Show every client-side factory the plugin knows about. The modal
   * pulls full proposal data from the pending_proposals cache via
   * factory-review-proposal, which retains entries past PROPOSED so the
   * user can audit what was auto-signed. PENDING REVIEW is the
   * load-bearing case once Phase D's auto-sign=OFF gate lands. */
  const factories = useMemo<Factory[]>(() => {
    return (factoryList.factories || []).filter((f) => !f.is_lsp);
  }, [factoryList.factories]);

  if (factories.length === 0) return null;

  const pendingCount = factories.filter(
    (f) => f.ceremony === FactoryCeremony.PROPOSED,
  ).length;

  return (
    <>
      <Card className='mb-3' data-testid='pending-proposals-card'>
        <Card.Body>
          <Card.Title style={{ fontSize: '1rem' }}>
            Factory proposals
            {pendingCount > 0 && (
              <Badge bg='warning' text='dark' className='ms-2'>
                {pendingCount} pending review
              </Badge>
            )}
          </Card.Title>
          <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
            Factories you joined as a participant — review proposed terms or audit past sign-offs.
          </Card.Subtitle>
          <div className='proposed-list'>
            {factories.map((f) => {
              const badge = ceremonyBadge(f.ceremony);
              return (
                <div className='row-item' key={f.instance_id}>
                  <span className='iid'>{truncate(f.instance_id, 12, 8)}</span>
                  <span style={{ fontSize: '0.85rem', color: '#6c757d' }}>
                    <Badge bg={badge.bg} text={badge.text as any} className='me-2'>
                      {badge.label}
                    </Badge>
                    epoch {f.epoch} · {f.n_clients + 1} participants
                  </span>
                  <Button
                    size='sm'
                    variant='outline-primary'
                    onClick={() => setReviewing(f.instance_id)}
                    data-testid={`review-${f.instance_id.slice(0, 8)}`}
                  >
                    Review
                  </Button>
                </div>
              );
            })}
          </div>
        </Card.Body>
      </Card>

      {reviewing && (
        <ReviewProposalModal
          instanceId={reviewing}
          show={true}
          onClose={() => setReviewing(null)}
        />
      )}
    </>
  );
}

export default PendingProposalsCard;
