// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PaymentMethodSelector from './PaymentMethodSelector';
import { DEFAULT_PAYMENT_METHODS } from '../../services/paymentMethods';

const VIEWPORT_W = 1280;
const FLYOUT_W = 128;

// jsdom has no layout, so fake the geometry: every element reports a row pinned to
// the right edge, like Method inside the right-aligned SidePanel.
const rightEdgeRect = { top: 200, bottom: 230, left: 1000, right: VIEWPORT_W - 20, width: 260, height: 30, x: 1000, y: 200 };

beforeEach(() => {
  window.innerWidth = VIEWPORT_W;
  window.innerHeight = 800;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rightEdgeRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flyout = () => document.body.querySelector('.fixed.z-popover');

const openCard = (onChange = () => {}) => {
  render(<PaymentMethodSelector value="" onChange={onChange} paymentMethods={DEFAULT_PAYMENT_METHODS} />);
  fireEvent.click(screen.getByText('Select...'));
  fireEvent.click(screen.getByText('Card'));
};

describe('PaymentMethodSelector flyout placement', () => {
  it('a right-edge row opens the flyout fully inside the viewport, to the left', () => {
    openCard();
    const el = flyout();
    expect(el).not.toBeNull();
    const left = parseFloat(el.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + FLYOUT_W).toBeLessThanOrEqual(VIEWPORT_W);
    expect(left + FLYOUT_W).toBeLessThanOrEqual(rightEdgeRect.left); // flipped, not overlapping the row
    expect(screen.getByText('Mastercard')).toBeTruthy();
    expect(screen.getByText('Visa')).toBeTruthy();
  });

  it('picking a sub-method calls onChange with it and closes both menus', () => {
    const onChange = vi.fn();
    openCard(onChange);
    fireEvent.click(screen.getByText('Visa'));
    expect(onChange).toHaveBeenCalledWith('Visa');
    expect(flyout()).toBeNull();
    expect(screen.queryByText('Cash')).toBeNull();
  });

  it('still opens to the right when there is room', () => {
    Element.prototype.getBoundingClientRect.mockReturnValue({ ...rightEdgeRect, left: 100, right: 300 });
    openCard();
    expect(parseFloat(flyout().style.left)).toBe(304);
  });

  it('closes the flyout when the viewport resizes', () => {
    openCard();
    expect(flyout()).not.toBeNull();
    fireEvent(window, new Event('resize'));
    expect(flyout()).toBeNull();
  });
});
