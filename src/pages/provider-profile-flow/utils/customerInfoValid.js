import { isValidPhoneForCountry } from '../../../utils/phone';

// Single source of truth for "is this customer's own info complete enough to book" --
// previously duplicated between BookingView/index.jsx and GroupConfirmStep.jsx (whose own
// comment said it "mirrors" this), which is exactly how the two drifted: solo's copy never
// required phone at all for years (fixed separately), and neither copy ever checked
// agreeToTerms, so a customer could explicitly untick "I agree to the Terms and Conditions"
// and still book. One function, composed by both callers, so that can't happen again.
export const isCustomerInfoValid = (customerInfo) => {
  if (!customerInfo.firstName.trim()) return false;
  if (customerInfo.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email)) return false;
  // Phone was previously only format-checked WHEN present, never required -- the actual
  // bug behind a customer reaching Review-and-confirm with no phone at all, since this is
  // what disables the Review button, not CustomerForm's own cosmetic error text (which
  // only populates once the field is blurred). createBooking() hard-requires a phone on
  // this path with no code on that error (see api.js), so an empty one here always fails
  // confirmation anyway -- this just stops it before the customer gets that far.
  // GroupConfirmStep.jsx's isLeadContactValid/isGuestContactValid already required this
  // correctly; this brings solo in line with it instead of the other way around.
  if (!isValidPhoneForCountry(customerInfo.phone, customerInfo.phoneCountryCode)) return false;
  if (!customerInfo.agreeToTerms) return false;
  return true;
};
