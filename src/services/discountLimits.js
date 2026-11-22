// What each role may direct-apply as a discount (a fraction). Its own tiny module so the booking rules in api.js and the error
// guidance text read the SAME numbers without the guidance code importing the whole API layer.
// (Moved here from api.js: this is now the ONE place to change a limit, e.g. back to 0.15 for staff.)
export const DISCOUNT_LIMITS = {
  // TEMPORARY (2026-08-31): raised from 0.15 to match STAFF_REQUEST_CEILING, so staff
  // can direct-apply up to 50% with no manager approval step. Revert by setting this
  // back to 0.15 — the request-to-manager path (STAFF_REQUEST_CEILING below) reactivates
  // automatically once this drops below it again.
  staff:        0.50,
  manager:      1.00, // 100%
  admin:        1.00, // 100%
  admin_viewer: 0,    // view-only role — RLS blocks writes regardless, this is just a safe default
};


// What a role may direct-apply, in whole percent.
export const directDiscountPercent = (role) => Math.round((DISCOUNT_LIMITS[role] || 0) * 100);
