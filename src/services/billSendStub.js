// TEMPORARY STUB (ZNLY-410 Part B): same signatures as Part A's shareBill (api.js) and Part C's fetchBillMessage (api.js) / fillBillMessage (utils/billMessage.js).
// Delete this file at merge and import the real ones in BillActions.jsx.
import { fetchBillUnit, fixBillNumber } from './api';

export async function shareBill(bookingId, extraIds = []) {
  const { data, error } = await fetchBillUnit({ bookingId, extraIds });
  if (error || !data) return { data: null, error: error || { message: 'load' } };
  const anchor = [...data.rows].sort((a, b) => String(a.bookingNumber).localeCompare(String(b.bookingNumber)))[0].id;
  const { data: billNumber, error: e2 } = await fixBillNumber(anchor, extraIds.length > 0);
  return e2 ? { data: null, error: e2 } : { data: { billNumber, token: 'stub-token' }, error: null };
}

export async function fetchBillMessage() {
  return { data: { subject: 'Your bill {bill_number} from {business}', body: 'Hi {first_name}, thank you for visiting {business} today. Your bill {bill_number} is ready.' }, error: null };
}

export const fillBillMessage = (text, vars) => String(text).replace('Hi {first_name}', vars.first_name ? 'Hi {first_name}' : 'Hi there').replace(/\{(first_name|business|bill_number)\}/g, (_, k) => vars[k] || '');
