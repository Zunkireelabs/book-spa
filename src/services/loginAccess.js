// "Login off" (users.login_access = 'none', set on the Staff access screen) blocks sign-in by password AND by PIN.
// Only an explicit 'none' blocks: a login created outside Staff access, or a row with no value, is allowed (never locked out).
// Server half: public.auth_hook_block_login_off (migration-377), once enabled as the Auth "Custom Access Token" hook.
export const LOGIN_OFF_MESSAGE = 'Sign-in is turned off for this account. Ask your administrator.';

export const isLoginAllowed = (profileOrRow) => profileOrRow?.login_access !== 'none';
