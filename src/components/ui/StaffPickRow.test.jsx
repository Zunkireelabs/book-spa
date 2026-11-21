// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import StaffPickRow from './StaffPickRow';

const mm = (matches) => (q) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
beforeEach(() => { window.matchMedia = mm(false); });
afterEach(cleanup);
const K = { id: 'k', name: 'Kebisha S.' };
const S = { id: 's', name: 'Sami Rai' };
const T = { id: 't', name: 'Tara Gurung' };
const base = { statusLine: 'Free 1:45–2:15pm', pill: 'free', renderPicker: () => <p>LIST</p> };

describe('StaffPickRow ZNLY-318 states', () => {
  it('shows ASSIGNED when the shown person is the saved assignment, no hint', () => {
    render(<StaffPickRow {...base} people={[K]} assignedIds={['k']} assignedNames={['Kebisha S.']} />);
    expect(screen.getByText('Assigned')).toBeTruthy();
    expect(screen.queryByText(/^Was /)).toBeNull();
  });
  it('shows "Was <name>" and no ASSIGNED when the pick differs from the saved one', () => {
    render(<StaffPickRow {...base} people={[S]} assignedIds={['k']} assignedNames={['Kebisha S.']} />);
    expect(screen.getByText('Was Kebisha S.')).toBeTruthy();
    expect(screen.queryByText('Assigned')).toBeNull();
  });
  it('no saved assignment: neither tag nor hint', () => {
    render(<StaffPickRow {...base} people={[S]} />);
    expect(screen.queryByText('Assigned')).toBeNull();
    expect(screen.queryByText(/^Was /)).toBeNull();
  });
  it('couple 2 of 2: "A, B" and "… · 2 of 2"', () => {
    render(<StaffPickRow {...base} people={[S, T]} max={2} />);
    expect(screen.getByText('Sami Rai, Tara Gurung')).toBeTruthy();
    expect(screen.getByText('Free 1:45–2:15pm · 2 of 2')).toBeTruthy();
  });
  it('couple 1 of 2: amber "1 of 2 · pick one more", no Free pill', () => {
    const { container } = render(<StaffPickRow {...base} people={[S]} max={2} />);
    expect(screen.getByText('1 of 2 · pick one more')).toBeTruthy();
    expect(screen.queryByText('Free')).toBeNull();
    expect(container.querySelector('button').className).toContain('border-amber-300');
  });
  it('single pick keeps the old props working', () => {
    render(<StaffPickRow {...base} id="k" name="Kebisha S." />);
    expect(screen.getByText('Kebisha S.')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
  });
  it('desktop: tap opens the list; phone with onOpenPhone calls it instead', () => {
    render(<StaffPickRow {...base} people={[K]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('LIST')).toBeTruthy();
    cleanup();
    const spy = vi.fn();
    window.matchMedia = mm(true);
    render(<StaffPickRow {...base} people={[K]} onOpenPhone={spy} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(spy).toHaveBeenCalled();
  });
});
