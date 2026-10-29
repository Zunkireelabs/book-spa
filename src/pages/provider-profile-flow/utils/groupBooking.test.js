import { describe, it, expect } from 'vitest';
import { createLeadPerson, createGuestPerson, addGuest, removeGuest, updateGuestField, MAX_GROUP_SIZE } from './groupBooking';

describe('groupBooking person-list helpers', () => {
  it('addGuest appends a guest labeled by current position, capped at MAX_GROUP_SIZE total people', () => {
    let people = [createLeadPerson()];
    people = addGuest(people);
    expect(people).toHaveLength(2);
    expect(people[1].label).toBe('Guest 2');
    for (let i = 0; i < 10; i++) people = addGuest(people);
    expect(people).toHaveLength(MAX_GROUP_SIZE);
  });

  it('addGuest respects a tighter maxSize than MAX_GROUP_SIZE (branch online_booking_capacity)', () => {
    let people = [createLeadPerson()];
    for (let i = 0; i < 10; i++) people = addGuest(people, 3);
    expect(people).toHaveLength(3);
  });

  it('removeGuest relabels remaining guests by new position, and is a no-op on the lead', () => {
    let people = [createLeadPerson(), createGuestPerson(2), createGuestPerson(3)];
    people = removeGuest(people, people[1].id); // remove "Guest 2"
    expect(people.map((p) => p.label)).toEqual(['Me', 'Guest 2']);
    const unchanged = removeGuest(people, 'lead');
    expect(unchanged).toHaveLength(2);
  });

  it('updateGuestField merges only the targeted person, leaving sibling objects referentially equal', () => {
    const people = [createLeadPerson(), createGuestPerson(2)];
    const next = updateGuestField(people, people[1].id, 'name', 'Priya');
    expect(next[1].name).toBe('Priya');
    expect(next[0]).toBe(people[0]); // untouched person, same reference
  });

  it('guest ids stay unique after removing a middle guest and adding a new one (no position-derived collision)', () => {
    let people = [createLeadPerson()];
    people = addGuest(people); // Guest 2
    people = addGuest(people); // Guest 3
    people = removeGuest(people, people[1].id); // remove the first guest -> [lead, old-Guest-3 relabeled "Guest 2"]
    people = addGuest(people); // appended as new "Guest 3" -- must NOT reuse the removed id
    const ids = people.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
