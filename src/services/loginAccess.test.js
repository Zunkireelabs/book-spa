import { describe, it, expect } from 'vitest';
import { isLoginAllowed, LOGIN_OFF_MESSAGE } from './loginAccess';

describe('isLoginAllowed', () => {
  it('blocks only an explicit none', () => {
    expect(isLoginAllowed({ login_access: 'none' })).toBe(false);
  });
  it('allows email', () => {
    expect(isLoginAllowed({ login_access: 'email' })).toBe(true);
  });
  it('allows a login with no value (created outside Staff access) and a missing row', () => {
    expect(isLoginAllowed({})).toBe(true);
    expect(isLoginAllowed({ login_access: null })).toBe(true);
    expect(isLoginAllowed(null)).toBe(true);
    expect(isLoginAllowed(undefined)).toBe(true);
  });
  it('has a message to show', () => {
    expect(LOGIN_OFF_MESSAGE).toMatch(/turned off/);
  });
});
