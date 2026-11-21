// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../hooks/useServicePickerData', () => ({ default: () => ({ counts: [], categoryOrder: {}, tiers: {} }) }));
import ServicePickRow from './ServicePickRow';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);
const svcs = [{ id: 'a', name: 'Lash Tint', duration_minutes: 30, price_npr: 1500 }];

describe('ServicePickRow empty look (ZNLY-322)', () => {
  it('required: solid border, primary text', () => {
    render(<ServicePickRow required services={svcs} value="" onChange={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.className).not.toContain('border-dashed');
    expect(screen.getByText(/Pick a service/).className).toContain('text-text-primary');
  });
  it('optional: dashed border, secondary text', () => {
    render(<ServicePickRow services={svcs} value="" onChange={() => {}} />);
    expect(screen.getByRole('button').className).toContain('border-dashed');
    expect(screen.getByText(/Pick a service/).className).toContain('text-text-secondary');
  });
  it('invalid + empty: red ring and the reason line; picked: none', () => {
    const { rerender } = render(<ServicePickRow required invalid services={svcs} value="" onChange={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Pick a service');
    expect(screen.getByRole('button').className).toContain('border-error');
    rerender(<ServicePickRow required invalid services={svcs} value="a" onChange={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
