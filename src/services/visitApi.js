// ZNLY-402 piece 5: the screens import the booking-level calls from here; the implementations are the api.js wrappers (migration 430), which also route
// COMBO_USE_SINGLE_EDIT / MULTI_STAFF_USE_SINGLE_EDIT to today's single-booking edit path. Every call returns { data, error }.
export { visitCreate, visitUpdate, visitSetStatus, visitRemoveService, visitReschedule, visitApplyDiscount, visitSetStaff } from './api';
