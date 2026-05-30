import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { formatFiatValue } from '../../../utilities/data-formatters';
import { FIAT_CURRENCIES, Units } from '../../../utilities/constants';
import { CurrencySVG } from '../../../svgs/Currency';
import { useSelector } from 'react-redux';
import { selectFiatUnit } from '../../../store/rootSelectors';

/**
 * Fiat Box — sibling-mode fiat display.
 *
 * What it renders
 *   The fiat-conversion display used alongside CurrencyBox in every
 *   balance card. Looks up the user's selected fiat currency
 *   (selectFiatUnit), finds its FIAT_CURRENCIES symbol entry, and
 *   renders the converted value via formatFiatValue + CurrencySVG.
 *
 *   When the fiat rate isn't loaded yet (fiatConfig.rate = 0), parent
 *   renders this in a hidden state.
 *
 * Why a separate component from SatsWithFiat
 *   SatsWithFiat renders sats + an INLINE fiat suffix on the same span;
 *   it's for compact inline display (peer rows, tooltip values).
 *   FiatBox is the BIG, sibling-positioned fiat display under a count-up
 *   for the balance hero cards.
 *
 * Props contract
 *   - `value: number` — value in sats
 *   - `rootUnit: Units` — input unit (sats / btc)
 *   - other layout props (className, etc.)
 */
const FiatBox = props => {
  const fiatUnit = useSelector(selectFiatUnit);
  const fiatSymbol = FIAT_CURRENCIES.find((fiat => fiat.currency === fiatUnit))?.symbol;

  return (
    <span
      className={'d-flex align-items-center justify-content-start fiat-box-span ' + props.className}
      data-testid="fiat-box"
    >
      {props.symbol || (fiatSymbol?.prefix.startsWith('fa') && fiatSymbol.iconName) ? (
        <FontAwesomeIcon icon={props.symbol || fiatSymbol} className={'fa-' + (props.iconSize || 'sm')} />
      ) : (
        <CurrencySVG className="svg-currency" fiat={props.fiatUnit || 'USD'}></CurrencySVG>
      )}
      <span className="ms-2px pt-2px">
        {formatFiatValue(+props.value || 0, +props.rate, props.fromUnit || Units.SATS)}
      </span>
    </span>
  );
};

export default FiatBox;
