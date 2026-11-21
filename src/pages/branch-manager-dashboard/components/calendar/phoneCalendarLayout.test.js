import { describe, it, expect } from 'vitest';
import {
  phoneColumnCount, phoneColumnWidth, clampPhoneZoom, phoneCardPlan, startNoMeridiem, assignPhoneLanes, coupleName,
} from './phoneCalendarLayout';

const bk = (id, s, e) => ({ id, startTime: s, endTime: e });

describe('phone columns', () => {
  it('3 columns at 360-430, 2 below 344, more on small tablets', () => {
    expect(phoneColumnCount(430)).toBe(3);
    expect(phoneColumnCount(390)).toBe(3);
    expect(phoneColumnCount(360)).toBe(3);
    expect(phoneColumnCount(344)).toBe(3);
    expect(phoneColumnCount(343)).toBe(2);
    expect(phoneColumnCount(320)).toBe(2);
    expect(phoneColumnCount(700)).toBe(6);
  });
  it('columns fill the screen exactly', () => {
    expect(phoneColumnWidth(390) * 3).toBeCloseTo(346);
    expect(phoneColumnWidth(320)).toBe(138);
  });
  it('never fewer than 2 even on a tiny screen', () => { expect(phoneColumnCount(200)).toBe(2); });
});

describe('phone zoom', () => {
  it('floors at 1', () => {
    expect(clampPhoneZoom(0.65)).toBe(1);
    expect(clampPhoneZoom(1.5)).toBe(1.5);
    expect(clampPhoneZoom(NaN)).toBe(1);
  });
});

describe('card plan', () => {
  it('one line under 44, full from 44, service from 62', () => {
    expect(phoneCardPlan(30)).toEqual({ mode: 'one', showService: false });
    expect(phoneCardPlan(43.9).mode).toBe('one');
    expect(phoneCardPlan(44)).toEqual({ mode: 'full', showService: false });
    expect(phoneCardPlan(61).showService).toBe(false);
    expect(phoneCardPlan(62).showService).toBe(true);
  });
  it('strips am/pm on the one-line start', () => {
    expect(startNoMeridiem('1:15pm')).toBe('1:15');
    expect(startNoMeridiem('1:15 PM')).toBe('1:15');
    expect(startNoMeridiem('13:15')).toBe('13:15');
  });
});

describe('lanes', () => {
  it('a lone booking is one lane', () => {
    const r = assignPhoneLanes([bk('a', '10:00', '11:00')]);
    expect(r.lanes).toBe(1);
    expect(r.placed).toHaveLength(1);
    expect(r.hidden).toHaveLength(0);
  });
  it('two overlapping bookings take lanes 0 and 1', () => {
    const r = assignPhoneLanes([bk('a', '12:00', '14:00'), bk('b', '12:15', '13:15')]);
    expect(r.placed.map((p) => p.lane)).toEqual([0, 1]);
    expect(r.lanes).toBe(2);
  });
  it('a third overlapping booking collapses into hidden', () => {
    const r = assignPhoneLanes([bk('a', '10:00', '11:00'), bk('b', '10:15', '11:00'), bk('c', '10:30', '11:00')]);
    expect(r.hidden.map((b) => b.id)).toEqual(['c']);
    expect(r.placed).toHaveLength(2);
  });
  it('a freed lane is reused', () => {
    const r = assignPhoneLanes([bk('a', '10:00', '11:00'), bk('b', '10:15', '10:45'), bk('c', '10:50', '11:30')]);
    expect(r.hidden).toHaveLength(0);
    expect(r.placed.find((p) => p.booking.id === 'c').lane).toBe(1);
  });
  it('minMinutes makes touching short cards overlap', () => {
    const r = assignPhoneLanes([bk('a', '10:00', '10:10'), bk('b', '10:10', '10:20')], 20);
    expect(r.placed.map((p) => p.lane)).toEqual([0, 1]);
  });
});

describe('coupleName', () => {
  it('joins both names', () => { expect(coupleName('Hema', 'Ram D.')).toBe('Hema & Ram D.'); });
  it('plain name without a companion', () => { expect(coupleName('Hema', null)).toBe('Hema'); });
});

import { shortName, avatarColor, oneLineShowsIcon, ONE_LINE_ICON_MIN } from './phoneCalendarLayout';
describe('shortName', () => {
  it('first name + last initial', () => {
    expect(shortName('Nisha Shrestha')).toBe('Nisha S.');
    expect(shortName('  Sami   Rai ')).toBe('Sami R.');
    expect(shortName('Mary Ann Lee')).toBe('Mary L.');
  });
  it('single word and empty stay as is', () => {
    expect(shortName('Puja')).toBe('Puja');
    expect(shortName('Room 2')).toBe('Room 2');
    expect(shortName('')).toBe('');
    expect(shortName(null)).toBe('');
  });
});
describe('avatarColor', () => {
  it('is stable per id', () => { expect(avatarColor('abc')).toBe(avatarColor('abc')); });
});

describe('one-line icon', () => {
  it('only from 130px wide', () => {
    expect(ONE_LINE_ICON_MIN).toBe(130);
    expect(oneLineShowsIcon(115)).toBe(false);
    expect(oneLineShowsIcon(129.9)).toBe(false);
    expect(oneLineShowsIcon(130)).toBe(true);
  });
});
