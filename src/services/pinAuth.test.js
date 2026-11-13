import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pinAuth.js imports lib/supabase.js, which creates a live Supabase client at
// module-import time — not viable under vitest/Node. Mock it so importing
// pinAuth.js here only pulls in the service function, same pattern as
// membershipBackdateDayLock.test.js.
const verifyOtpMock = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: (...args) => verifyOtpMock(...args),
    },
  },
}));

const { loginWithPin } = await import('./pinAuth');

describe('loginWithPin', () => {
  beforeEach(() => {
    verifyOtpMock.mockReset();
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

    expect(result).toEqual({ success: false, error: 'PIN login failed.' });
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

    expect(result).toEqual({ success: false, error: 'still bad' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(verifyOtpMock).toHaveBeenCalledTimes(2);
  });
});
