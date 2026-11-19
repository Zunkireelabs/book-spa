// Who may do what to a staff transfer, mirroring the server's rules (so the panel never offers a button the RPC would refuse):
//   extend_staff_transfer            receiving branch's manager only          (mig 157)
//   reschedule_staff_transfer_return both branches                            (mig 166)
//   revert_staff_transfer_now        both branches                            (mig 166)
//   cancel_scheduled_transfer        home branch only (also covers Edit)      (mig 157)
// admin may do everything; staff and admin_viewer are read-only. side = which branch the viewer is looking from.
const RULES = {
  extend: ['receiving'],
  reschedule: ['home', 'receiving'],
  revertNow: ['home', 'receiving'],
  cancelScheduled: ['home'],
  editScheduled: ['home'],
};

export function canAct(action, { role, side }) {
  if (role === 'admin') return action in RULES;
  if (role !== 'manager') return false;
  return (RULES[action] || []).includes(side);
}
