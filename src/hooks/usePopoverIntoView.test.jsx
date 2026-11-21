// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import usePopoverIntoView from './usePopoverIntoView';

afterEach(cleanup);

const Probe = ({ open }) => {
  const ref = usePopoverIntoView(open);
  return (
    <div data-testid="scroll" style={{ overflowY: 'auto' }}>
      <div>{open && <div ref={ref} data-testid="pop" />}</div>
    </div>
  );
};

describe('usePopoverIntoView (ZNLY-325)', () => {
  it('scrolls the panel by how far the popover sticks out below it (minus a 12px gap)', () => {
    const { getByTestId, rerender } = render(<Probe open={false} />);
    const sc = getByTestId('scroll');
    sc.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400 });
    sc.scrollTop = 0;
    const proto = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function () { return this.dataset?.testid === 'pop' ? { top: 350, bottom: 480, left: 0, right: 100, width: 100, height: 130 } : proto.call(this); };
    rerender(<Probe open />);
    window.HTMLElement.prototype.getBoundingClientRect = proto;
    expect(sc.scrollTop).toBe(480 - (400 - 12));
  });
  it('does nothing when the popover already fits', () => {
    const { getByTestId, rerender } = render(<Probe open={false} />);
    const sc = getByTestId('scroll');
    sc.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400 });
    const proto = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function () { return this.dataset?.testid === 'pop' ? { top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100 } : proto.call(this); };
    rerender(<Probe open />);
    window.HTMLElement.prototype.getBoundingClientRect = proto;
    expect(sc.scrollTop).toBe(0);
  });
});
