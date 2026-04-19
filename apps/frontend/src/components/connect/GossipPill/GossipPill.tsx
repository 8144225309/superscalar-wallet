import { useEffect, useState } from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { HttpService } from '../../../services/http.service';

const GOSSIP_REFRESH_MS = 30_000;

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
};

const GossipPill = () => {
  const [state, setState] = useState<{ nodes: number; channels: number } | 'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const counts = await HttpService.fetchGossipCounts();
        if (!cancelled) setState(counts);
      } catch {
        if (!cancelled) setState('error');
      }
    };
    load();
    const interval = setInterval(load, GOSSIP_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const label =
    state === 'loading'
      ? 'Gossip: …'
      : state === 'error'
      ? 'Gossip: n/a'
      : `Gossip: ${formatCount(state.nodes)} nodes · ${formatCount(state.channels)} chans`;

  return (
    <OverlayTrigger
      placement='auto'
      overlay={
        <Tooltip>
          Live node + channel counts from the current CLN node's gossip.
          Vouch verification relies on this — low counts mean many hosts
          will show as unverifiable until gossip catches up.
        </Tooltip>
      }
    >
      <span
        className='gossip-pill fs-7 fw-semibold px-3 py-1 rounded-pill bg-secondary text-dark'
        data-testid='gossip-pill'
      >
        {label}
      </span>
    </OverlayTrigger>
  );
};

export default GossipPill;
