// ZNLY-113: what a VISITING staff member can be booked for at the branch they are visiting. Services are per branch, so the rule is by
// name: they must already do it at their home branch (a service nobody is linked to is open to everyone) and the visited branch must offer it.
// The calendar's service picker and the Therapists peek share this, so the two can never disagree.

const norm = (name) => String(name).trim().toLowerCase();

/** Lower-cased names of the services `therapistId` does at their HOME branch. `eligibility` is { serviceId: [therapistId, ...] }. */
export function homeServiceNameSet(homeServices, eligibility, therapistId) {
  const eligible = eligibility || {};
  return new Set((homeServices || []).filter((s) => !eligible[s.id] || eligible[s.id].includes(therapistId)).map((s) => norm(s.name)));
}

/** The visited branch's services that the visitor also does at home. */
export function servicesBookableHere(hereServices, homeNames) {
  return (hereServices || []).filter((s) => homeNames.has(norm(s.name)));
}
