import { supabasePlatform } from 'lib/supabase';

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

export const getRevenueRollup = (from, to) =>
  supabasePlatform.rpc('platform_get_revenue_rollup', { p_from: from, p_to: to }).then(unwrap);

export const listRates = (orgId) =>
  supabasePlatform.rpc('platform_list_rates', { p_org_id: orgId }).then(unwrap);

export const listCollections = (orgId) =>
  supabasePlatform.rpc('platform_list_collections', { p_org_id: orgId }).then(unwrap);

export const collectCommission = ({ orgId, periodStart, periodEnd, ratePercent, basis, vatRatePercent, collectedAt, notes, actualAmount }) =>
  supabasePlatform.rpc('platform_collect_commission', {
    p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    p_rate: ratePercent, p_basis: basis, p_vat_rate: vatRatePercent,
    p_collected_at: collectedAt, p_notes: notes || null,
    p_actual_amount: actualAmount === '' || actualAmount == null ? null : Number(actualAmount),
  }).then(unwrap);

export const previewBlendedCommission = (orgId, periodStart, periodEnd) =>
  supabasePlatform.rpc('platform_preview_blended_commission', {
    p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
  }).then(unwrap);

export const getOrgBookings = (orgId, from, to) =>
  supabasePlatform.rpc('platform_get_org_bookings', { p_org_id: orgId, p_from: from, p_to: to }).then(unwrap);

export const getOrgMembershipDeposits = (orgId, from, to) =>
  supabasePlatform.rpc('platform_get_org_membership_deposits', { p_org_id: orgId, p_from: from, p_to: to }).then(unwrap);

export const getOrgVoucherSales = (orgId, from, to) =>
  supabasePlatform.rpc('platform_get_org_voucher_sales', { p_org_id: orgId, p_from: from, p_to: to }).then(unwrap);

export const formatNPR = (amount) => `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
