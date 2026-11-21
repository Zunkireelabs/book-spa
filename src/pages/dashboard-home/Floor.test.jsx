// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Floor from './Floor';

const floor = { headcount: 1, working: 1, therapists: [{ therapist_id: 't1', name: 'Asha', blocks: [{ kind: 'booked', from_min: 600, to_min: 660, booking_id: 'b1' }] }] };

// ZNLY-329: percent tracks (calc(100% - nc)) went stale when the docked panel closed and the card widened; desktop must use a 1fr track.
describe('Floor timeline sizing', () => {
  it('desktop timeline column is a minmax(0,1fr) track, never a percentage', () => {
    const { container } = render(<Floor floor={floor} nowMin={620} open="09:00" close="18:00" />);
    const html = container.innerHTML;
    expect(html).toContain('grid-cols-[var(--nc)_minmax(0,1fr)]');
    expect(html).not.toContain('--tw');
    expect(html).not.toMatch(/calc\(100%[ _]*-[ _]*var\(--nc\)\)/);
  });
  it('the card clips on desktop as a last-resort guard', () => {
    const { container } = render(<Floor floor={floor} nowMin={null} open="09:00" close="18:00" />);
    expect(container.querySelector('[data-floor-scroll]').className).toContain('md:overflow-hidden');
  });
  it('floor null then data re-renders without a hook-order crash', () => {
    const { container, rerender } = render(<Floor floor={null} nowMin={null} open="09:00" close="18:00" />);
    expect(container.innerHTML).toBe('');
    expect(() => rerender(<Floor floor={floor} nowMin={620} open="09:00" close="18:00" />)).not.toThrow();
    expect(container.textContent).toContain('Asha');
  });
});
