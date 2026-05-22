import { useSelector } from 'react-redux';
import {
  selectFiatConfig,
  selectFiatUnit,
  selectShowFiatBesideSats,
} from '../../../store/rootSelectors';
import { FIAT_CURRENCIES, Units } from '../../../utilities/constants';
import { formatFiatValue } from '../../../utilities/data-formatters';

/* Session 6b (Tier-2 polish): decorate any sats number with an optional
 * fiat suffix. Always renders the sats number; only renders the fiat
 * suffix when:
 *   - The user has toggled "Show fiat next to sats" on (default off),
 *   - And the fiatConfig has a non-zero rate loaded.
 *
 * Reuses the existing fiat infrastructure (Coingecko fetch via the
 * backend, fiatConfig in Redux) — no new external calls. Default off
 * preserves the "no outbound HTTP unless the user explicitly opts in"
 * stance per user direction. */

type Props = {
  value: number | bigint | string;  /* the sats amount */
  fromUnit?: Units;                  /* default Units.SATS */
  className?: string;
  noFiatClassName?: string;          /* applied to the wrapper when fiat is hidden */
  fiatClassName?: string;            /* applied to the ≈ suffix */
};

function SatsWithFiat({
  value,
  fromUnit,
  className,
  noFiatClassName,
  fiatClassName,
}: Props) {
  const showFiat = useSelector(selectShowFiatBesideSats);
  const fiatUnit = useSelector(selectFiatUnit);
  const fiatConfig = useSelector(selectFiatConfig);

  const n = typeof value === 'string' ? Number(value) : Number(value);
  const sats = Number.isFinite(n) ? n.toLocaleString() : '0';

  const showSuffix = showFiat && (fiatConfig.rate ?? 0) > 0;

  const currencySymbol =
    FIAT_CURRENCIES.find((c) => c.currency === fiatUnit)?.symbol;

  const symbolStr =
    currencySymbol && typeof currencySymbol === 'object' && 'prefix' in currencySymbol
      ? '' /* font-awesome icon prefix; skip plain-text emission */
      : '';

  return (
    <span className={(showSuffix ? className : noFiatClassName) || className}>
      {sats}
      {showSuffix && (
        <span className={'text-muted ms-1 ' + (fiatClassName || '')}>
          ≈ {symbolStr}
          {formatFiatValue(n, (fiatConfig.rate ?? 0), fromUnit || Units.SATS)} {fiatUnit}
        </span>
      )}
    </span>
  );
}

export default SatsWithFiat;
