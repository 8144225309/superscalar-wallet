import './GossipPill.scss';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { HttpService } from '../../../services/http.service';
import { selectActiveProfileId } from '../../../store/nodesSelectors';

const GOSSIP_REFRESH_MS = 30_000;

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
};

const GossipPill = () => {
  const activeProfileId = useSelector(selectActiveProfileId);
  const [state, setState] = useState<{ nodes: number; channels: number } | 'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    // Reset to loading whenever the active node changes so stale counts
    // from the previous node don't linger while the new one is queried.
    setState('loading');
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
  }, [activeProfileId]);

  const label =
    state === 'loading'
      ? 'Gossip: …'
      : state === 'error'
      ? 'Gossip: n/a'
      : `Gossip: ${formatCount(state.nodes)} nodes · ${formatCount(state.channels)} chans`;

  return (
    <span
      className='gossip-pill fs-7 fw-semibold px-3 py-1 rounded-pill'
      data-testid='gossip-pill'
    >
      {label}
    </span>
  );
};

export default GossipPill;
