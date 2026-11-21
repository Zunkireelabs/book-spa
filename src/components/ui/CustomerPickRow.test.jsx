// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../services/api', () => ({ fetchCustomersLightweight: vi.fn(async () => ({ data: [] })), fetchRecentCustomerIds: vi.fn(async () => ({ data: ['c2', 'c1'] })) }));
import CustomerPickRow from './CustomerPickRow';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);
const rows = () => Array.from(document.querySelectorAll('[data-pick-none]')).map((r) => r.getAttribute('aria-label'));
const customers = [{ id: 'c1', full_name: 'Sita Rai', phone: '9841221840' }, { id: 'c2', full_name: 'Ram Thapa', phone: '9800000000' }];

describe('CustomerPickRow closed row', () => {
  it('empty + required: solid border, primary text; invalid shows the reason', () => {
    const { rerender } = render(<CustomerPickRow customers={customers} onPick={() => {}} />);
    expect(screen.getByRole('button').className).not.toContain('border-dashed');
    expect(screen.getByText(/Pick a customer/).className).toContain('text-text-primary');
    rerender(<CustomerPickRow invalid customers={customers} onPick={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Pick a customer or Walk-in');
  });
  it('walk-in reads "Walk-in · No customer profile"', () => {
    render(<CustomerPickRow kind="walkin" customers={customers} onPick={() => {}} />);
    expect(screen.getByText('Walk-in')).toBeTruthy();
    expect(screen.getByText('No customer profile')).toBeTruthy();
  });
  it('existing shows name and phone', () => {
    render(<CustomerPickRow kind="existing" name="Sita Rai" phone="+9779841221840" customers={customers} onPick={() => {}} />);
    expect(screen.getByText('Sita Rai')).toBeTruthy();
    expect(screen.getByText('+977 984-122-1840')).toBeTruthy();
  });
});

describe('CustomerPickRow list', () => {
  it('order is New customer, Walk-in, then Recent customers (latest booked first); picking reports the choice', async () => {
    const onPick = vi.fn();
    render(<CustomerPickRow branchId="b" customers={customers} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByLabelText('Sita Rai');
    expect(screen.getByText('Recent customers')).toBeTruthy();
    const labels = rows();
    expect(labels).toEqual(['New customer', 'Walk-in', 'Ram Thapa', 'Sita Rai']);
    fireEvent.click(screen.getByLabelText('Walk-in'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'walkin' });
  });
  it('search narrows by name or phone; New customer carries the typed text', () => {
    const onPick = vi.fn();
    render(<CustomerPickRow customers={customers} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: '98412' } });
    expect(rows()).toEqual(['New customer', 'Walk-in', 'Sita Rai']);
    fireEvent.click(screen.getByLabelText('New customer'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'new', seed: '98412' });
  });
  it('picking a customer reports it as existing', async () => {
    const onPick = vi.fn();
    render(<CustomerPickRow branchId="b" customers={customers} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByLabelText('Ram Thapa');
    fireEvent.click(screen.getByLabelText('Ram Thapa'));
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', customer: customers[1] });
  });
});
