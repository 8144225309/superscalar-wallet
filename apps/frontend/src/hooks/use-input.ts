import { useState } from 'react';
import { InputType } from '../utilities/constants';

/**
 * use-input — form-field state + validation hook.
 *
 * What it provides
 *   The single source of truth for every controlled Form.Control in
 *   the wallet UI. Tracks:
 *   - `value`:        current input value (normalized per InputType)
 *   - `isValid`:      result of the caller's validateValue predicate
 *   - `hasError`:     true when invalid AND blurred at least once
 *   - `inputChangeHandler`: onChange callback
 *   - `inputBlurHandler`:   onBlur callback (flips isTouched)
 *   - `reset`:        clears value + isTouched
 *
 * Why the "isTouched" gate
 *   Surfacing "invalid" while the user is still typing is hostile —
 *   the field hasn't been completed yet. hasError combines the
 *   predicate with isTouched so the red ring only appears on blur.
 *
 * Normalization
 *   `InputType.LOWERCASE` / `UPPERCASE` normalize the typed value
 *   before storing. The default `ORIGINAL` passes through verbatim.
 *
 * Args
 *   - `validateValue: (s: string) => boolean` — predicate run on every
 *     keystroke (and reflected in isValid)
 *   - `inputType?: InputType` — normalization, default ORIGINAL
 *
 * Test coverage
 *   use-input.test.ts (R8.19) pins the 9-case contract: tracking,
 *   isValid, hasError gating, reset, case normalization, custom
 *   predicates.
 */
const useInput = (validateValue, inputType: InputType = InputType.ORIGINAL) => {
  const [enteredValue, setEnteredValue] = useState('');
  const [isTouched, setIsTouched] = useState(false);

  const normalizeValue = (value: string) => {
    switch (inputType) {
      case 'lowercase':
        return value.toLowerCase();
      case 'uppercase':
        return value.toUpperCase();
      default:
        return value;
    }
  };

  const valueIsValid = validateValue(enteredValue);
  const hasError = !valueIsValid && isTouched;

  const valueChangeHandler = (event) => {
    event.target.value = normalizeValue(event.target.value);
    setEnteredValue(event.target.value);
  };

  const inputBlurHandler = () => {
    setIsTouched(true);
  };

  const reset = () => {
    setEnteredValue('');
    setIsTouched(false);
  };

  return {
    value: enteredValue,
    isValid: valueIsValid,
    hasError,
    valueChangeHandler,
    inputBlurHandler,
    reset
  };
};

export default useInput;
