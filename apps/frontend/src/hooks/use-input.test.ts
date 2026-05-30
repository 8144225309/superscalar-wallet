import { renderHook, act } from '@testing-library/react';
import useInput from './use-input';
import { InputType } from '../utilities/constants';

/* Helper: build a synthetic change event with the typed value. */
function changeEvent(value: string) {
  return { target: { value } } as React.ChangeEvent<HTMLInputElement>;
}

const nonEmpty = (v: string) => v.trim() !== '';

describe('useInput', () => {
  it('starts with empty value, valid=false-by-predicate, no error', () => {
    const { result } = renderHook(() => useInput(nonEmpty));
    expect(result.current.value).toBe('');
    expect(result.current.isValid).toBe(false);
    /* hasError requires both invalid AND touched */
    expect(result.current.hasError).toBe(false);
  });

  it('valueChangeHandler updates value and isValid via predicate', () => {
    const { result } = renderHook(() => useInput(nonEmpty));
    act(() => result.current.valueChangeHandler(changeEvent('hello')));
    expect(result.current.value).toBe('hello');
    expect(result.current.isValid).toBe(true);
    expect(result.current.hasError).toBe(false);
  });

  it('hasError fires only AFTER blur if invalid', () => {
    const { result } = renderHook(() => useInput(nonEmpty));
    act(() => result.current.valueChangeHandler(changeEvent('')));
    /* invalid but not touched yet */
    expect(result.current.hasError).toBe(false);
    act(() => result.current.inputBlurHandler());
    /* invalid + touched → hasError */
    expect(result.current.hasError).toBe(true);
  });

  it('hasError clears when value becomes valid', () => {
    const { result } = renderHook(() => useInput(nonEmpty));
    act(() => result.current.inputBlurHandler());
    act(() => result.current.valueChangeHandler(changeEvent('')));
    expect(result.current.hasError).toBe(true);
    act(() => result.current.valueChangeHandler(changeEvent('valid')));
    expect(result.current.hasError).toBe(false);
  });

  it('reset clears value and touched flag', () => {
    const { result } = renderHook(() => useInput(nonEmpty));
    act(() => result.current.valueChangeHandler(changeEvent('something')));
    act(() => result.current.inputBlurHandler());
    expect(result.current.value).toBe('something');
    act(() => result.current.reset());
    expect(result.current.value).toBe('');
    expect(result.current.hasError).toBe(false);
  });

  it('InputType.LOWERCASE normalizes the entered value', () => {
    const { result } = renderHook(() => useInput(nonEmpty, InputType.LOWERCASE));
    act(() => result.current.valueChangeHandler(changeEvent('HELLO')));
    expect(result.current.value).toBe('hello');
  });

  it('InputType.UPPERCASE normalizes the entered value', () => {
    const { result } = renderHook(() => useInput(nonEmpty, InputType.UPPERCASE));
    act(() => result.current.valueChangeHandler(changeEvent('hello')));
    expect(result.current.value).toBe('HELLO');
  });

  it('default InputType.ORIGINAL preserves case', () => {
    const { result } = renderHook(() => useInput(nonEmpty));
    act(() => result.current.valueChangeHandler(changeEvent('MiXeD')));
    expect(result.current.value).toBe('MiXeD');
  });

  it('custom predicate fires with each value', () => {
    const isFiveDigits = (v: string) => /^\d{5}$/.test(v);
    const { result } = renderHook(() => useInput(isFiveDigits));
    act(() => result.current.valueChangeHandler(changeEvent('123')));
    expect(result.current.isValid).toBe(false);
    act(() => result.current.valueChangeHandler(changeEvent('12345')));
    expect(result.current.isValid).toBe(true);
    act(() => result.current.valueChangeHandler(changeEvent('abcde')));
    expect(result.current.isValid).toBe(false);
  });
});
