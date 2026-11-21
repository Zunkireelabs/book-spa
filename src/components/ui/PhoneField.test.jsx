// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import PhoneField, { phoneFieldProblem, phoneFieldValue, usePhoneState } from './PhoneField';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

const Harness = ({ original, walkInHint, start = {} }) => {
  const [v, setV] = useState({ dial: '+977', national: '', ...start });
  return <PhoneField {...v} original={original} walkInHint={walkInHint} onChange={setV} label="Phone" id="p" />;
};

describe('PhoneField', () => {
  it('is a numeric, digits-only input at 16px on a phone', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Phone');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.className).toContain('text-base');
    fireEvent.change(input, { target: { value: '98-41 abc234567' } });
    expect(input.value).toBe('9841234567');
  });
  it('shows the reason under the field for an invalid number, with the Walk-in hint only when asked', () => {
    const { unmount } = render(<Harness start={{ national: '12345' }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/isn't valid for/);
    expect(screen.getByRole('alert').textContent).not.toMatch(/Walk-in/);
    unmount();
    render(<Harness start={{ national: '12345' }} walkInHint />);
    expect(screen.getByRole('alert').textContent).toMatch(/Use Walk-in if the customer has no number/);
  });
  it('shows nothing for a valid or empty number', () => {
    render(<Harness start={{ national: '9841234567' }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('an untouched stored number is never re-checked and is saved exactly as stored; a changed one is validated', () => {
    const odd = '12345';
    expect(phoneFieldProblem({ dial: '+977', national: '12345', original: odd })).toBe('');
    expect(phoneFieldValue({ dial: '+977', national: '12345', original: odd })).toBe('12345');
    expect(phoneFieldProblem({ dial: '+977', national: '123456', original: odd })).not.toBe('');
    expect(phoneFieldValue({ dial: '+977', national: '9841234567', original: '+9779841234567' })).toBe('+9779841234567');
    expect(phoneFieldValue({ dial: '+91', national: '9876543210', original: '+9779841234567' })).toBe('+919876543210');
    expect(phoneFieldValue({ dial: '+977', national: '', original: '' })).toBeNull();
  });
  it('splits a stored value into country code + number (usePhoneState)', () => {
    let st;
    const Probe = () => { st = usePhoneState('+9779841234567'); return null; };
    render(<Probe />);
    expect(st.dial).toBe('+977');
    expect(st.national).toBe('9841234567');
    expect(st.value).toBe('+9779841234567');
    expect(st.problem).toBe('');
    act(() => st.onChange({ dial: '+91', national: '123' }));
    expect(st.problem).not.toBe('');
    act(() => st.reset(''));
    expect(st.value).toBeNull();
  });
  it('renderInput swaps the input (typeahead) but keeps the picker, digits rule and message', () => {
    const seen = vi.fn();
    render(<PhoneField dial="+977" national="123" onChange={seen} renderInput={(r) => <input data-testid="ta" value={r.value} onChange={(e) => r.onValueChange(e.target.value)} className={r.className} />} />);
    fireEvent.change(screen.getByTestId('ta'), { target: { value: '9a8' } });
    expect(seen).toHaveBeenCalledWith({ dial: '+977', national: '98' });
    expect(screen.getByRole('alert')).toBeTruthy();
  });
  it("kind='business' checks length only, so a landline passes where a person's number would not", () => {
    expect(phoneFieldProblem({ dial: '+977', national: '2345678901' })).not.toBe('');
    expect(phoneFieldProblem({ dial: '+977', national: '2345678901', kind: 'business' })).toBe('');
    expect(phoneFieldProblem({ dial: '+977', national: '123', kind: 'business' })).not.toBe('');
  });
});
