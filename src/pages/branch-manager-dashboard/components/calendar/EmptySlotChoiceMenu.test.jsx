// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import EmptySlotChoiceMenu from './EmptySlotChoiceMenu';

afterEach(cleanup);

describe('EmptySlotChoiceMenu layering (ZNLY-325)', () => {
  it('uses the semantic z-popover token so it is never hidden behind an open side panel, and no raw z value', () => {
    render(<EmptySlotChoiceMenu x={300} y={200} options={[{ key: 'a', label: 'New booking', icon: 'Plus', onSelect: vi.fn() }]} onClose={() => {}} />);
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('z-popover');
    expect(menu.className).not.toMatch(/z-\[|z-dropdown/);
  });
});
