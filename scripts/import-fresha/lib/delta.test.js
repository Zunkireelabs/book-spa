import { describe, it, expect } from 'vitest';
import { prepareCustomers, prepareProducts } from './delta.js';
import { uuid5 } from './parse.js';

const cl = (id, name, mobile, added = '2026-01-01') => ({ 'Client ID': id, 'Full Name': name, 'First Name': name.split(' ')[0], 'Last Name': name.split(' ')[1] || '', 'Mobile Number': mobile, Added: added, Blocked: 'No', Tags: '' });

describe('prepareCustomers', () => {
  const ns = 'org-1';
  it('skips clients already in the org and never lists them for insert', () => {
    const existing = new Set([uuid5('org-1|client:1')]);
    const p = prepareCustomers([cl('1', 'Asha Rai', '9801234567'), cl('2', 'Maya Gurung', '9809999999')], { ns, existingIds: existing });
    expect(p.existing).toBe(1); expect(p.items.map((i) => i.name)).toEqual(['Maya Gurung']);
  });
  it('a new client sharing an EXISTING customer\'s phone becomes shared-mobile (existing keeps the phone)', () => {
    const p = prepareCustomers([cl('2', 'Maya Gurung', '9801234567')], { ns, ownedPhones: new Set(['+9779801234567']) });
    expect(p.items[0].shared).toBe(true); expect(p.sharedMobile).toHaveLength(1);
  });
  it('among new clients the one added first keeps the shared phone', () => {
    const p = prepareCustomers([cl('3', 'Late One', '9801234567', '2026-05-01'), cl('2', 'Early One', '9801234567', '2026-02-01')], { ns });
    expect(p.items.find((i) => i.name === 'Early One').shared).toBe(false); expect(p.items.find((i) => i.name === 'Late One').shared).toBe(true);
  });
  it('lists no-phone, unreadable phone, blocked and nameless rows', () => {
    const p = prepareCustomers([cl('4', 'No Phone', ''), cl('5', 'Bad Phone', '123'), { ...cl('6', 'Blocked One', '9800000001'), Blocked: 'Yes' }, cl('7', '', '')], { ns });
    expect(p.noPhone).toEqual(['No Phone', 'Bad Phone']); expect(p.badPhone).toHaveLength(1); expect(p.blocked).toEqual(['Blocked One']); expect(p.noName).toBe(1);
  });
  it('ids are org-scoped and stable', () => {
    const a = prepareCustomers([cl('1', 'A B', '')], { ns: 'o1' }).items[0].id, b = prepareCustomers([cl('1', 'A B', '')], { ns: 'o2' }).items[0].id;
    expect(a).not.toBe(b); expect(a).toBe(prepareCustomers([cl('1', 'A B', '')], { ns: 'o1' }).items[0].id);
  });
});

describe('prepareProducts', () => {
  const pr = (name, price, stock) => ({ 'Product name': name, 'Full price': price, Category: 'X', "Sami's brow and lashes": stock, 'Total Stock': stock });
  it('numbers duplicate names, clamps negative stock, treats infinity as untracked, refuses a missing price', () => {
    const p = prepareProducts([pr('Gel', '100', '5'), pr('Gel', '120', '-2'), pr('Oil', '50', '∞')]);
    expect(p.items.map((i) => i.name)).toEqual(['Gel', 'Gel (2)', 'Oil']);
    expect(p.items[1].qty).toBe(0); expect(p.neg).toEqual(['Gel (2)']); expect(p.items[2].inf).toBe(true);
    expect(() => prepareProducts([pr('Free', '', '1')])).toThrow(/no Full price/);
  });
});
