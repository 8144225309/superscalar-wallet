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

function PendingProposalsCard() {
  const factoryList = useSelector(selectFactoryList);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const proposed = useMemo<Factory[]>(() => {
    return (factoryList.factories || []).filter(
      (f) => !f.is_lsp && f.ceremony === FactoryCeremony.PROPOSED,
    );
  }, [factoryList.factories]);

  if (proposed.length === 0) return null;

  return (
    <>
      <Card className='mb-3' data-testid='pending-proposals-card'>
        <Card.Body>
          <Card.Title style={{ fontSize: '1rem' }}>
            Pending review
            <Badge bg='warning' text='dark' className='ms-2'>{proposed.length}</Badge>
          </Card.Title>
          <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
            Factory proposals from LSPs awaiting your approval before signing.
          </Card.Subtitle>
          <div className='proposed-list'>
            {proposed.map((f) => (
              <div className='row-item' key={f.instance_id}>
                <span className='iid'>{truncate(f.instance_id, 12, 8)}</span>
                <span style={{ fontSize: '0.85rem', color: '#6c757d' }}>
                  epoch {f.epoch} · {f.n_clients} participants
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
            ))}
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
