// "Login off" (users.login_access = 'none', set on the Staff access screen) blocks sign-in by password AND by PIN.
// Only an explicit 'none' blocks: a login created outside Staff access, or a row with no value, is allowed (never locked out).
// Server half: public.auth_hook_block_login_off (migration-377), once enabled as the Auth "Custom Access Token" hook.
export const LOGIN_OFF_MESSAGE = 'Sign-in is turned off for this account. Ask your administrator.';

export const isLoginAllowed = (profileOrRow) => profileOrRow?.login_access !== 'none';

// The Auth hook refuses the token, and GoTrue returns its raw text: "Error running hook URI: pg-functions://postgres/public/auth_hook_block_login_off".
// Both sign-in paths (password, PIN) show this plain sentence instead. Anything else comes back unchanged (null/undefined stay as they are).
export const LOGIN_OFF_HOOK_MESSAGE = 'Your login is turned off. Contact your admin.';
const LOGIN_OFF_HOOK = /auth_hook_block_login_off|error running hook uri/i;
export const isLoginOffHookError = (err) => LOGIN_OFF_HOOK.test((typeof err === 'string' ? err : err?.message) || '');
export const friendlyLoginError = (message) => (message != null && LOGIN_OFF_HOOK.test(String(message)) ? LOGIN_OFF_HOOK_MESSAGE : message);
