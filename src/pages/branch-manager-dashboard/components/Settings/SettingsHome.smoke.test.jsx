// @vitest-environment jsdom
// Phone Settings home (ZNLY-295): below lg `?view=settings` shows the grouped list (no redirect), built from the same filters as the desktop menu.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const state = vi.hoisted(() => ({ role: 'admin', rooms: true, overall: false, belowLg: true }));
vi.mock('contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: state.role } }), useOptionalAuth: () => ({ profile: { role: state.role } }) }));
vi.mock('contexts/BranchContext', () => ({ useBranch: () => ({ isOverall: state.overall, loading: false, branchName: 'Lazimpat' }) }));
vi.mock('hooks/useIndustry', () => ({ useIndustry: () => ({ locationLabelPlural: 'Rooms', enableRooms: state.rooms }) }));

import SettingsLayout from './SettingsLayout';

const Where = () => { const l = useLocation(); return <div data-testid="where">{l.search}</div>; };
const mount = () => render(
  <MemoryRouter initialEntries={['/org/dashboard?view=settings']}>
    <SettingsLayout view="settings" renderSetting={(v) => <div>page:{v}</div>} />
    <Where />
  </MemoryRouter>
);
const titles = () => [...document.querySelectorAll('[data-setting]')].map((b) => b.getAttribute('data-setting'));

beforeEach(() => {
  Object.assign(state, { role: 'admin', rooms: true, overall: false, belowLg: true });
  window.matchMedia = (q) => ({ matches: state.belowLg && q.includes('1023.98'), media: q, addEventListener() {}, removeEventListener() {} });
  sessionStorage.clear();
});
afterEach(cleanup);

describe('Settings home on a phone', () => {
  it('admin sees the grouped list, no redirect', () => {
    mount();
    expect(screen.getByTestId('settings-home')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('?view=settings');
    for (const g of ['Business', 'Payments', 'Booking & profile', 'Account']) expect(within(screen.getByTestId('settings-home')).getByText(g)).toBeTruthy();
    expect(titles()).toEqual(expect.arrayContaining(['rooms', 'services', 'locations', 'billing', 'booking-settings', 'audit']));
  });
  it('manager does not get admin-only pages', () => {
    state.role = 'manager';
    mount();
    expect(titles()).toEqual(expect.arrayContaining(['services', 'categories']));
    expect(titles()).not.toContain('locations');
    expect(titles()).not.toContain('billing');
    expect(titles()).not.toContain('booking-settings');
  });
  it('Rooms only when the industry uses rooms', () => {
    state.rooms = false;
    mount();
    expect(titles()).not.toContain('rooms');
    expect(titles()).toContain('services');
  });
  it('Overall hides branch pages', () => {
    state.overall = true;
    mount();
    expect(titles()).not.toContain('services');
    expect(titles()).toContain('audit');
  });
  it('opening a row goes to that page; the home then marks where you were', () => {
    sessionStorage.setItem('zennly.settings.last', 'services');
    mount();
    expect(document.querySelector('[data-setting="services"]').getAttribute('data-was')).toBe('true');
    fireEvent.click(document.querySelector('[data-setting="categories"]'));
    expect(screen.getByTestId('where').textContent).toBe('?view=categories');
  });
  it('desktop keeps the redirect to the first page', () => {
    state.belowLg = false;
    mount();
    expect(screen.queryByTestId('settings-home')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('?view=rooms');
  });
});
