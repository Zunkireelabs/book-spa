// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import Tooltip from './Tooltip';

afterEach(cleanup);

describe('popover layering (ZNLY-325): one token per role', () => {
  it('Tooltip uses z-popover (below toasts), no raw z value', () => {
    render(<Tooltip label="Hint"><button>x</button></Tooltip>);
    fireEvent.focus(screen.getByText('x'));
    return new Promise((r) => setTimeout(r, 120)).then(() => {
      const tip = screen.getByRole('tooltip');
      expect(tip.className).toContain('z-popover');
      expect(tip.className).not.toMatch(/z-notification|z-\[/);
    });
  });
  it.each(['PaymentModal.jsx', 'CheckoutProducts.jsx', 'PaymentMethodSelector.jsx'])('%s portalled menus use z-popover, not z-notification, for their lists', (f) => {
    const src = readFileSync(`${process.cwd()}/src/components/ui/${f}`, 'utf8');
    expect(src).toContain('z-popover');
    // PaymentModal keeps its full-screen QR overlay on the notification layer; the menus/lists must not.
    expect(src).not.toMatch(/className="z-notification bg-white border/);
    if (f !== 'PaymentModal.jsx') expect(src).not.toContain('z-notification');
  });
});
