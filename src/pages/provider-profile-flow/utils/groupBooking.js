export const MAX_GROUP_SIZE = 6;

export const createLeadPerson = () => ({
  id: 'lead',
  label: 'Me',
  isLead: true,
  service: null,
  professional: null,
});

const generateGuestId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// id is independent of label/position — addGuest/removeGuest relabel guests by
// position on every change, but ids must stay stable so a later addGuest (which
// also derives its *label* from position) can never mint an id that collides with
// a still-present person's id.
export const createGuestPerson = (n, id = generateGuestId()) => ({
  id,
  label: `Guest ${n}`,
  isLead: false,
  service: null,
  professional: null,
  name: '',
});

const relabelGuests = (people) => {
  let guestNumber = 1;
  return people.map((person) => {
    if (person.isLead) return person;
    guestNumber += 1;
    return person.label === `Guest ${guestNumber}` ? person : { ...person, label: `Guest ${guestNumber}` };
  });
};

// maxSize lets a caller clamp tighter than MAX_GROUP_SIZE's hard product cap (6) --
// a branch's own online_booking_capacity (Booking Settings, migration-301) can be
// set lower, and since every guest counts 1-for-1 against that cap (confirmed
// product decision -- a group of N consumes N online-capacity units, not 1), the
// UI must never let a customer build a group bigger than the branch could ever
// actually seat online. Defaults to MAX_GROUP_SIZE so existing callers/tests are
// unaffected.
export const addGuest = (people, maxSize = MAX_GROUP_SIZE) => {
  if (people.length >= maxSize) return people;
  const nextNumber = people.length + 1;
  return [...people, createGuestPerson(nextNumber)];
};

export const removeGuest = (people, guestId) => {
  if (guestId === 'lead') return people;
  const filtered = people.filter((person) => person.id !== guestId);
  if (filtered.length === people.length) return people;
  return relabelGuests(filtered);
};

export const updateGuestField = (people, guestId, field, value) =>
  people.map((person) => (person.id === guestId ? { ...person, [field]: value } : person));
