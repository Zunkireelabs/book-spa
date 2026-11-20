import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DayMoneyRows from './DayMoneyRows';

const fmt = (n) => `NPR ${n}`;
const sources = { product: 500, voucher: 200 };
const base = { isClosed: true, byMode: { Cash: 1000, Khalti: 300 }, refunds: 0, sources, atClose: { byMode: { Cash: 1000, Khalti: 300 }, refunds: 0, closedAt: '2026-11-19T12:00:00Z' } };
const html = (d) => renderToStaticMarkup(<DayMoneyRows data={d} fmt={fmt} lab="l" val="v" />);
const idx = (h, s) => h.indexOf(s);
const bands = (h) => (h.match(/bg-primary\/5/g) || []).length;

describe('DayMoneyRows order (ZNLY-280)', () => {
  it('closed, nothing after close: quiet line, no Now, one band on cash at close', () => {
    const h = html({ ...base, afterClose: { amount: 0, cash: 0 } });
    expect(h).toContain('Nothing collected after close · drawer unchanged');
    expect(h).not.toContain('data-section="now"');
    expect(h).not.toContain('data-section="after-close"');
    expect(bands(h)).toBe(1);
    expect(h.slice(idx(h, 'bg-primary/5') - 120)).toContain('Cash expected at close');
  });
  it('closed, money after close: After close + Now, band moves to the drawer now', () => {
    const h = html({ ...base, byMode: { Cash: 3000, Khalti: 300 }, afterClose: { amount: 2000, cash: 2000 } });
    expect(h).toContain('data-section="after-close"');
    expect(h).toContain('data-section="now"');
    expect(bands(h)).toBe(1);
    const b = idx(h, 'bg-primary/5');
    expect(b).toBeGreaterThan(idx(h, 'Cash in the drawer now') - 300);
    expect(idx(h, 'Cash expected at close')).toBeLessThan(idx(h, 'data-section="after-close"'));
  });
  it('source lines sit after the methods and before the totals divider, indented (closed)', () => {
    const h = html({ ...base, afterClose: { amount: 0, cash: 0 } });
    expect(idx(h, 'data-method-row="Khalti"')).toBeLessThan(idx(h, 'data-source-line="product"'));
    expect(idx(h, 'data-source-line="voucher"')).toBeLessThan(idx(h, 'border-t border-border'));
    expect(h).toContain('pl-6');
  });
  it('open day: sources between the methods and the cash band', () => {
    const h = html({ isClosed: false, byMode: { Cash: 1000 }, refunds: 0, sources });
    expect(idx(h, 'data-method-row="Cash"')).toBeLessThan(idx(h, 'data-source-line="product"'));
    expect(idx(h, 'data-source-line="voucher"')).toBeLessThan(idx(h, 'data-cash-expected'));
  });
});
