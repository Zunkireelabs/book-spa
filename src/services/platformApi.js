import { supabasePlatform } from 'lib/supabase';

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

export const getRevenueRollup = (from, to) =>
  supabasePlatform.rpc('platform_get_revenue_rollup', { p_from: from, p_to: to }).then(unwrap);

export const listRates = (orgId) =>
  supabasePlatform.rpc('platform_list_rates', { p_org_id: orgId }).then(unwrap);

export const listCollections = (orgId) =>
  supabasePlatform.rpc('platform_list_collections', { p_org_id: orgId }).then(unwrap);

export const setCommissionRate = ({ orgId, ratePercent, basis, vatRatePercent, effectiveFrom }) =>
  supabasePlatform.rpc('platform_set_commission_rate', {
    p_org_id: orgId, p_rate: ratePercent, p_basis: basis,
    p_vat_rate: vatRatePercent, p_effective_from: effectiveFrom,
  }).then(unwrap);

export const recordCollection = ({ orgId, periodStart, periodEnd, amount, collectedAt, notes }) =>
  supabasePlatform.rpc('platform_record_collection', {
    p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    p_amount: amount, p_collected_at: collectedAt, p_notes: notes || null,
  }).then(unwrap);

export const getOrgBookings = (orgId, from, to) =>
  supabasePlatform.rpc('platform_get_org_bookings', { p_org_id: orgId, p_from: from, p_to: to }).then(unwrap);

export const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
