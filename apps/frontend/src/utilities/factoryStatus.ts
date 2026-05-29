import { Factory, FactoryLifecycle, FactoryCeremony } from '../types/factories.type';

/* Polish #2.3: single source of truth for "what does this factory's status
 * look like?" across FactoryList, FactoryDetail, LspOperatorConsole, and
 * JoinFactoryModal.
 *
 * Previously every render site re-derived its own (bg / label / glyph)
 * triple from `factory.lifecycle` + `factory.ceremony`, with subtle
 * differences:
 *   - FactoryList showed "Active"/"Signed"/"Failed"/"Aborted"/<ceremony>
 *   - FactoryDetail showed raw `factory.lifecycle`
 *   - JoinFactoryModal showed raw `f.lifecycle`
 *   - LspOperatorConsole tracked queue-row status, not factory status,
 *     but reused similar badge variants
 *
 * Now every status indicator imports this and gets the same look + label
 * + tooltip, including the colorblind-redundant glyph from R1.3. */

export type FactoryStatusKey =
  | 'active'
  | 'signed'
  | 'pending'
  | 'rotating'
  | 'failed'
  | 'aborted'
  | 'expired'
  | 'closed'
  | 'unknown';

export type FactoryStatusInfo = {
  /** Bootstrap variant suffix (bg-{variant}). */
  bg: 'success' | 'primary' | 'warning' | 'danger' | 'secondary' | 'info';
  /** One-word user-facing label for the badge text. */
  label: string;
  /** Single-character shape glyph for colorblind redundancy (per R1.3). */
  glyph: string;
  /** Longer tooltip explanation suitable for an OverlayTrigger. */
  tooltip: string;
  /** Canonical key — useful for testids and switch statements. */
  key: FactoryStatusKey;
};

const INFO: Record<FactoryStatusKey, Omit<FactoryStatusInfo, 'key'>> = {
  active: {
    bg: 'success',
    label: 'Active',
    glyph: '●',
    tooltip: 'Factory is active: channels are open, payments can flow. The ceremony completed and on-chain funding confirmed.',
  },
  signed: {
    bg: 'primary',
    label: 'Signed',
    glyph: '◆',
    tooltip: 'Ceremony completed and the distribution tree is signed. Funding TX is broadcast or about to be; not yet active until channels open.',
  },
  pending: {
    bg: 'secondary',
    label: 'Pending',
    glyph: '○',
    tooltip: 'Factory exists but the MuSig2 ceremony has not yet started or is still in flight.',
  },
  rotating: {
    bg: 'warning',
    label: 'Rotating',
    glyph: '◐',
    tooltip: 'A rotation ceremony is currently in progress. Wait for it to complete before triggering another action.',
  },
  failed: {
    bg: 'danger',
    label: 'Failed',
    glyph: '✕',
    tooltip: 'The MuSig2 ceremony aborted. The factory never reached signed state and there is no on-chain footprint.',
  },
  aborted: {
    bg: 'secondary',
    label: 'Aborted',
    glyph: '⊘',
    tooltip: 'Factory was aborted (operator refused, deadline passed, or peer disconnected). Can be Discarded.',
  },
  expired: {
    bg: 'danger',
    label: 'Expired',
    glyph: '⏰',
    tooltip: 'Factory passed its Decker-Wattenhofer timelock budget. Only force-close paths remain.',
  },
  closed: {
    bg: 'secondary',
    label: 'Closed',
    glyph: '✓',
    tooltip: 'Factory has been closed (cooperatively, unilaterally, externally, or via breach response). Held for breach-watch + accounting.',
  },
  unknown: {
    bg: 'secondary',
    label: 'Unknown',
    glyph: '?',
    tooltip: 'Status could not be classified from the current lifecycle + ceremony values.',
  },
};

const CLOSED_LIFECYCLES = new Set<string>([
  FactoryLifecycle.CLOSED_EXTERNALLY,
  FactoryLifecycle.CLOSED_COOPERATIVE,
  FactoryLifecycle.CLOSED_UNILATERAL,
  FactoryLifecycle.CLOSED_BREACHED,
]);

/* Classify a factory into one of the FactoryStatusKey buckets.
 * Order matters — ACTIVE / EXPIRED / CLOSED short-circuit before
 * the ceremony-based checks. */
export function factoryStatusKey(f: Pick<Factory, 'lifecycle' | 'ceremony' | 'rotation_in_progress'>): FactoryStatusKey {
  if (f.lifecycle === FactoryLifecycle.ACTIVE) {
    return f.rotation_in_progress ? 'rotating' : 'active';
  }
  if (f.lifecycle === FactoryLifecycle.EXPIRED) return 'expired';
  if (CLOSED_LIFECYCLES.has(f.lifecycle)) return 'closed';
  if (f.lifecycle === FactoryLifecycle.ABORTED) return 'aborted';
  if (f.lifecycle === FactoryLifecycle.FAILED) return 'failed';
  if (f.ceremony === FactoryCeremony.FAILED) return 'failed';
  if (f.ceremony === FactoryCeremony.COMPLETE) return 'signed';
  if (f.lifecycle === FactoryLifecycle.SIGNED) return 'signed';
  if (f.lifecycle === FactoryLifecycle.DYING) return 'closed';
  return 'pending';
}

export function factoryStatus(f: Pick<Factory, 'lifecycle' | 'ceremony' | 'rotation_in_progress'>): FactoryStatusInfo {
  const key = factoryStatusKey(f);
  return { ...INFO[key], key };
}
