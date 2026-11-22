// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PickShell from './PickShell';

beforeEach(() => { window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }); });
afterEach(cleanup);

describe('PickShell open signal', () => {
  it('opens once for a positive signal and tells the caller it was consumed, so a remount with 0 stays closed', () => {
    const consumed = vi.fn();
    const { unmount } = render(<PickShell openSignal={7} onSignalConsumed={consumed} title="Pick" renderPicker={() => <p>LIST</p>}>row</PickShell>);
    expect(screen.getByText('LIST')).toBeTruthy();
    expect(consumed).toHaveBeenCalledTimes(1);
    unmount();
    render(<PickShell openSignal={0} onSignalConsumed={consumed} title="Pick" renderPicker={() => <p>LIST</p>}>row</PickShell>);
    expect(screen.queryByText('LIST')).toBeNull();
    expect(consumed).toHaveBeenCalledTimes(1);
  });
});
