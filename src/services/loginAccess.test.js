import { describe, it, expect } from 'vitest';
import { isLoginAllowed, LOGIN_OFF_MESSAGE, friendlyLoginError, isLoginOffHookError, LOGIN_OFF_HOOK_MESSAGE } from './loginAccess';

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

describe('friendlyLoginError (ZNLY-262)', () => {
  it('maps the raw Auth hook text to the plain message', () => {
    expect(friendlyLoginError('Error running hook URI: pg-functions://postgres/public/auth_hook_block_login_off')).toBe('Your login is turned off. Contact your admin.');
    expect(friendlyLoginError('ERROR RUNNING HOOK URI: x')).toBe(LOGIN_OFF_HOOK_MESSAGE);
    expect(friendlyLoginError('blocked by AUTH_HOOK_BLOCK_LOGIN_OFF')).toBe(LOGIN_OFF_HOOK_MESSAGE);
  });
  it('leaves every other error unchanged, and null / undefined as they are', () => {
    expect(friendlyLoginError('Invalid login credentials')).toBe('Invalid login credentials');
    expect(friendlyLoginError(null)).toBeNull();
    expect(friendlyLoginError(undefined)).toBeUndefined();
  });
  it('isLoginOffHookError reads an error object, a string, or nothing', () => {
    expect(isLoginOffHookError({ message: 'Error running hook URI: x' })).toBe(true);
    expect(isLoginOffHookError('auth_hook_block_login_off')).toBe(true);
    expect(isLoginOffHookError({ message: 'Invalid login credentials' })).toBe(false);
    expect(isLoginOffHookError(null)).toBe(false);
  });
});
