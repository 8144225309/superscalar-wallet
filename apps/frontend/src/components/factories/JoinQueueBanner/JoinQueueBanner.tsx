import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectFactoryList } from '../../../store/factoriesSelectors';
import { Factory } from '../../../types/factories.type';
import { FactoriesService } from '../../../services/http.service';

/**
 * Join Queue Banner — LSP-side sticky banner.
 *
 * What it renders
 *   A small Alert pinned at the top of /factories whenever any LSP
 *   factory has pending (status=0) join requests. Click → navigate
 *   to LspOperatorConsole's pending view scoped to the first factory
 *   with queued joins. Counterpart to HeldProposalsBanner (the
 *   client-side sticky review banner).
 *
 * Key state
 *   - `perFactory`: Record<iid, queuedCount>, polled every 7s
 *
 * Side effects
 *   - Plugin RPC: wallet-count-join-queue-by-status (per factory)
 *
 * Props contract
 *   None — reads LSP factories from Redux and renders unconditionally
 *   above the factories listing.
 */


/* Session 2 slice C: sticky banner on /factories that surfaces
 * pending join requests across all factories where this node is LSP.
 * Mirrors HeldProposalsBanner (which is for the CLIENT role's pending
 * review queue). When count > 0, clicking the banner navigates to the
 * first factory with pending joins so the operator can act. */

function JoinQueueBanner() {
  const factoryList = useSelector(selectFactoryList);
  const navigate = useNavigate();
  const [perFactory, setPerFactory] = useState<Record<string, number>>({});

  const lspFactories = useMemo<Factory[]>(
    () => (factoryList.factories || []).filter((f) => f.is_lsp),
    [factoryList.factories],
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const out: Record<string, number> = {};
      for (const f of lspFactories) {
        try {
          const r: { count?: number } = await FactoriesService.countJoinQueueByStatus(f.instance_id, 0);
          out[f.instance_id] = Number(r?.count ?? 0);
        } catch {
          out[f.instance_id] = 0;
        }
      }
      if (!cancelled) setPerFactory(out);
    };
    refresh();
    const id = setInterval(refresh, 7000);
    return () => { cancelled = true; clearInterval(id); };
  }, [lspFactories]);

  const total = Object.values(perFactory).reduce((a, b) => a + b, 0);
  const firstPendingIid = Object.entries(perFactory).find((e) => e[1] > 0)?.[0];

  if (total === 0) return null;

  const handleClick = () => {
    if (firstPendingIid) {
      navigate(`/factories/${firstPendingIid}`);
    }
  };

  return (
    <Alert
      variant='warning'
      className='mb-3 d-flex justify-content-between align-items-center'
      style={{ cursor: 'pointer' }}
      onClick={handleClick}
      data-testid='join-queue-banner'
    >
      <span>
        <strong>{total}</strong> pending join request{total === 1 ? '' : 's'} across{' '}
        {Object.values(perFactory).filter((n) => n > 0).length} factor{Object.values(perFactory).filter((n) => n > 0).length === 1 ? 'y' : 'ies'} you host
      </span>
      <span className='text-muted' style={{ fontSize: '0.85rem' }}>Click to review ›</span>
    </Alert>
  );
}

export default JoinQueueBanner;
