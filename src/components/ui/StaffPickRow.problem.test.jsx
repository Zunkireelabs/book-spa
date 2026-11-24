// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(cleanup);
import StaffPickRow from './StaffPickRow';

if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

describe('StaffPickRow: a problem replaces the Free chip', () => {
  const people = [{ id: 't', name: 'Rojina K' }];
  it('shows Free without a problem', () => {
    render(<StaffPickRow people={people} statusLine="Free 11:30am–12pm" pill="free" renderPicker={() => null} />);
    expect(screen.getByText('Free')).toBeTruthy();
  });
  it('shows the problem and no Free chip / status line with one', () => {
    render(<StaffPickRow people={people} statusLine="Free 11:30am–12pm" pill="free" problem="Rojina K is now busy 11:30–12:00." renderPicker={() => null} />);
    expect(screen.getByText('Rojina K is now busy 11:30–12:00.')).toBeTruthy();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText('Free 11:30am–12pm')).toBeNull();
  });
});
