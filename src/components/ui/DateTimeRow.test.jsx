// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../pages/branch-manager-dashboard/components/calendar/MiniMonthCalendar', () => ({
  default: ({ onDateSelect }) => <button type="button" onClick={() => onDateSelect('2026-12-05')}>pick-5-dec</button>,
}));

import DateTimeRow from './DateTimeRow';
import { parseTimeInput, buildTimeOptions, formatDateChip } from '../../utils/timeInput';
import { parsePhone } from './CountryCodeSelect';
import { phoneToSave } from '../../utils/phone';
import { formatClockTime } from '../../utils/clockTime';

afterEach(cleanup);
beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });

const Harness = ({ d = '2026-11-20', t = '10:30', spy }) => {
  const [date, setDate] = useState(d);
  const [time, setTime] = useState(t);
  spy.current = { date, time };
  return <DateTimeRow date={date} time={time} onDateChange={setDate} onTimeChange={setTime} branchHours={{ openTime: '09:00:00', closeTime: '21:00:00' }} />;
};

describe('time helpers', () => {
  it('parses typed times', () => {
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('9:30pm')).toBe('21:30');
    expect(parseTimeInput('12am')).toBe('00:00');
    expect(parseTimeInput('21:15')).toBe('21:15');
    expect(parseTimeInput('9:')).toBeNull();
    expect(parseTimeInput('25')).toBeNull();
    expect(parseTimeInput('13pm')).toBeNull();
  });
  it('formats and lists', () => {
    expect(formatClockTime('10:30', false)).toBe('10:30am');
    expect(formatClockTime('00:05', false)).toBe('12:05am');
    expect(formatClockTime('21:00', false)).toBe('9:00pm');
    const o = buildTimeOptions({ openTime: '09:00:00', closeTime: '10:00:00' }, '09:10');
    expect(o).toEqual(['09:00', '09:10', '09:15', '09:30', '09:45', '10:00']);
    expect(formatDateChip('2026-11-20')).toBe('Fri 20 Nov');
    expect(formatDateChip('')).toBe('Pick a date');
  });
});

describe('DateTimeRow', () => {
  it('shows the date chip and the 12h time', () => {
    const spy = { current: null };
    render(<Harness spy={spy} />);
    expect(screen.getByLabelText('Date').textContent).toBe('Fri 20 Nov');
    expect(screen.getByLabelText('Time').value).toBe('10:30am');
  });
  it('typing commits once valid; blur restores the formatted time', () => {
    const spy = { current: null };
    render(<Harness spy={spy} />);
    const input = screen.getByLabelText('Time');
    fireEvent.change(input, { target: { value: '2pm' } });
    expect(spy.current.time).toBe('14:00');
    fireEvent.change(input, { target: { value: '2:' } });
    expect(spy.current.time).toBe('');
    expect(input.value).toBe('2:');
    fireEvent.blur(input);
    expect(input.value).toBe('');
  });
  it('picks a time from the list and a date from the calendar', () => {
    const spy = { current: null };
    render(<Harness spy={spy} />);
    fireEvent.focus(screen.getByLabelText('Time'));
    fireEvent.click(screen.getByText('11:15am'));
    expect(spy.current.time).toBe('11:15');
    expect(screen.getByLabelText('Time').value).toBe('11:15am');
    fireEvent.click(screen.getByLabelText('Date'));
    fireEvent.click(screen.getByText('pick-5-dec'));
    expect(spy.current.date).toBe('2026-12-05');
    expect(screen.getByLabelText('Date').textContent).toBe('Sat 5 Dec');
  });
  it('re-syncs the text when the time changes from outside', () => {
    const { rerender } = render(<DateTimeRow date="2026-11-20" time="10:30" onDateChange={() => {}} onTimeChange={() => {}} />);
    rerender(<DateTimeRow date="2026-11-20" time="16:45" onDateChange={() => {}} onTimeChange={() => {}} />);
    expect(screen.getByLabelText('Time').value).toBe('4:45pm');
  });
});

describe('edit-details phone round trip', () => {
  const split = (stored) => { const { dial, national } = parsePhone(stored); return { dial, national, initialDial: dial, initialNational: national, original: stored }; };
  it('an untouched number is saved exactly as stored', () => {
    ['9841234567', '+9779841234567', '+977 984-123-4567', '+15551234567', '+12425551234'].forEach((n) => {
      expect(phoneToSave(split(n))).toBe(n);
    });
    expect(phoneToSave(split(''))).toBeNull();
  });
  it('an edited number is saved as dial + digits, like New booking', () => {
    expect(phoneToSave({ ...split('9841234567'), national: '9801112223' })).toBe('+9779801112223');
    expect(phoneToSave({ ...split('9841234567'), dial: '+91' })).toBe('+919841234567');
    expect(phoneToSave({ ...split('+15551234567'), national: '' })).toBeNull();
  });
  it('splits stored numbers for the field', () => {
    expect(parsePhone('+9779841234567')).toEqual({ dial: '+977', national: '9841234567' });
    expect(parsePhone('+12425551234')).toEqual({ dial: '+1242', national: '5551234' });
  });
});
