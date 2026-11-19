import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pinAuth.js imports lib/supabase.js, which creates a live Supabase client at
// module-import time — not viable under vitest/Node. Mock it so importing
// pinAuth.js here only pulls in the service function, same pattern as
// membershipBackdateDayLock.test.js.
const verifyOtpMock = vi.fn();
const signOutMock = vi.fn();
// users.login_access lookup after the session exists (login off blocks PIN sign-in too)
let loginAccessRow = { login_access: 'email' };
const maybeSingleMock = vi.fn(async () => ({ data: loginAccessRow, error: null }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: (...args) => verifyOtpMock(...args),
      signOut: (...args) => signOutMock(...args),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingleMock() }) }) }),
  },
}));

const { loginWithPin } = await import('./pinAuth');

describe('loginWithPin', () => {
  beforeEach(() => {
    verifyOtpMock.mockReset();
    signOutMock.mockReset();
    loginAccessRow = { login_access: 'email' };
    global.fetch = vi.fn();
    import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts the current email_otp response shape', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ success: true, email_otp: '123456' }),
    });
    verifyOtpMock.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');

    expect(result).toEqual({
      success: true,
      session: { access_token: 'tok' },
      user: { id: 'u1' },
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({
      email: 'staff@zenly.app',
      token: '123456',
      type: 'email',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('ZNLY-262: the Auth hook refusing a login-off user gives the plain message, no retry', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ success: true, email_otp: '123456' }) });
    verifyOtpMock.mockResolvedValue({ data: null, error: { message: 'Error running hook URI: pg-functions://postgres/public/auth_hook_block_login_off' } });
    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');
    expect(result).toEqual({ success: false, error: 'Your login is turned off. Contact your admin.', kind: 'login_off' });
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the legacy otp response shape', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ success: true, otp: '654321' }),
    });
    verifyOtpMock.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');

    expect(result.success).toBe(true);
    expect(verifyOtpMock).toHaveBeenCalledWith({
      email: 'staff@zenly.app',
      token: '654321',
      type: 'email',
    });
  });

  it('fails fast on a bad PIN without retrying verifyOtp', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ success: false, error: 'PIN login failed.' }),
    });

    const result = await loginWithPin('staff@zenly.app', '0000', 'nuad-thai-spa');

    expect(result).toEqual({ success: false, error: 'PIN login failed.', kind: 'wrong_pin' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it('retries once with a fresh OTP when verifyOtp transiently fails', async () => {
    global.fetch
      .mockResolvedValueOnce({ json: async () => ({ success: true, email_otp: '111111' }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, email_otp: '222222' }) });
    verifyOtpMock
      .mockResolvedValueOnce({ data: null, error: { message: 'stale token' } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'tok' }, user: { id: 'u1' } }, error: null });

    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(verifyOtpMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the last error after both retry attempts fail', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ success: true, email_otp: '111111' }) });
    verifyOtpMock.mockResolvedValue({ data: null, error: { message: 'still bad' } });

    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');

    expect(result).toEqual({ success: false, error: 'still bad', kind: 'unavailable' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(verifyOtpMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a PIN sign-in when the login is off, and drops the session', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ success: true, email_otp: '123456' }) });
    verifyOtpMock.mockResolvedValue({ data: { session: { access_token: 'tok' }, user: { id: 'u1' } }, error: null });
    loginAccessRow = { login_access: 'none' };

    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/turned off/);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('allows a PIN sign-in for a login with no value (created outside Staff access)', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ success: true, email_otp: '123456' }) });
    verifyOtpMock.mockResolvedValue({ data: { session: { access_token: 'tok' }, user: { id: 'u1' } }, error: null });
    loginAccessRow = { login_access: null };

    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');

    expect(result.success).toBe(true);
    expect(signOutMock).not.toHaveBeenCalled();
  });
  it('a dropped connection is "unavailable", not a wrong PIN', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa');
    expect(result.success).toBe(false);
    expect(result.kind).toBe('unavailable');
    expect(result.error).toMatch(/Can't check your PIN right now/);
  });

  it('a 5xx answer or a non-JSON body is "unavailable"', async () => {
    global.fetch.mockResolvedValue({ status: 503, json: async () => ({ success: false, error: 'upstream' }) });
    expect((await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa')).kind).toBe('unavailable');
    global.fetch.mockResolvedValue({ status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    expect((await loginWithPin('staff@zenly.app', '1234', 'nuad-thai-spa')).kind).toBe('unavailable');
  });
});
