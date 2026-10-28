export const MAX_GROUP_SIZE = 6;

export const createLeadPerson = () => ({
  id: 'lead',
  label: 'Me',
  isLead: true,
  service: null,
  professional: null,
});

export const createGuestPerson = (n) => ({
  id: `guest-${n}`,
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
