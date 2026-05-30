import './GossipPill.scss';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { HttpService } from '../../../services/http.service';
import { selectActiveProfileId } from '../../../store/nodesSelectors';

/**
 * Gossip Pill — live status pill on /connect.
 *
 * What it renders
 *   A small pill that tells the user how big their gossip view is:
 *   N nodes / M channels. Formatted as compact "1.2k" / "1M" using
 *   the local formatCount helper.
 *
 *   Why it's there: when discovery seems "thin" (few LSPs in the
 *   discovered list), the user wants to know whether the wallet's
 *   own node sees enough of the network to find them. A pill saying
 *   "12k nodes / 50k channels" reassures them the discovery is
 *   real; "5 nodes / 0 channels" tells them their CLN is still
 *   syncing.
 *
 * Side effects
 *   - HttpService.fetchGossipCounts() every 30s (GOSSIP_REFRESH_MS)
 *
 * Props contract
 *   None — reads activeProfileId from Redux and the gossip counts
 *   from the backend on a poll.
 */
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
