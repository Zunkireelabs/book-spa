// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ErrorGuide from './GuideCard';
import { describeError } from '../../utils/errorGuide';

afterEach(cleanup);

describe('ErrorGuide', () => {
  it('fix card: bold lead, buttons call onAction with the descriptor, Why? opens the detail', () => {
    const onAction = vi.fn();
    render(<ErrorGuide card={describeError({ code: 'DISCOUNT_LIMIT_EXCEEDED' }, { limitPercent: 50 })} onAction={onAction} />);
    expect(screen.getByText('Your discount limit is 50%.').tagName).toBe('B');
    fireEvent.click(screen.getByText('Set to 50%'));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ intent: 'set-discount-percent', value: 50 }));
    expect(screen.queryByText(/sends nothing/)).toBeNull();
    fireEvent.click(screen.getByText(/Why\?/));
    expect(screen.getByText(/sends nothing/)).toBeTruthy();
  });
  it('system card: calm text, Try again, ref line, no ✦', () => {
    const { container } = render(<ErrorGuide card={describeError({ code: 'XX1' })} />);
    expect(screen.getByText(/couldn't be saved/)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(container.querySelector('[data-error-ref]').textContent).toMatch(/^Ref: [A-Z0-9]{4}-[A-Z0-9]{2}$/);
    expect(container.textContent).not.toContain('✦');
  });
  it('lost connection: Show on calendar, no Try again', () => {
    render(<ErrorGuide card={describeError(new TypeError('Failed to fetch'))} />);
    expect(screen.getByText('Connection lost.')).toBeTruthy();
    expect(screen.getByText('Show on calendar')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
