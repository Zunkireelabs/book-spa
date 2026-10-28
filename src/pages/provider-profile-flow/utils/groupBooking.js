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

export const addGuest = (people) => {
  if (people.length >= MAX_GROUP_SIZE) return people;
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
