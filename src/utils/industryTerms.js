// The org's own words for the person doing the work and the bookable room, readable from plain modules
// (api.js messages, friendlyError) that cannot call the useIndustry hook. OrgContext keeps it in sync.
// Defaults are the spa words, so a spa org reads exactly as it always has.
let terms = { staff: 'Therapist', staffPlural: 'Therapists', room: 'Room', roomPlural: 'Rooms', site: 'branch', sitePlural: 'branches' };

export const setIndustryTerms = ({ staff, staffPlural, room, roomPlural, spa = true } = {}) => {
  terms = {
    site: spa ? 'branch' : 'location',
    sitePlural: spa ? 'branches' : 'locations',
    staff: staff || 'Therapist',
    staffPlural: staffPlural || 'Therapists',
    room: room || 'Room',
    roomPlural: roomPlural || 'Rooms',
  };
};

// "Staff" is a mass noun ("a staff", "Staff is booked" read wrongly), so singular copy says "team member" for it.
const singular = () => (terms.staff.toLowerCase() === terms.staffPlural.toLowerCase() ? 'team member' : terms.staff.toLowerCase());

/** Lower-case singular: "therapist" for spa, "team member" for beauty. */
export const staffWord = () => singular();
/** Lower-case plural: "therapists" for spa, "staff" for beauty. */
export const staffWordPlural = () => terms.staffPlural.toLowerCase();

const keepCase = (from, to) => (from[0] === from[0].toUpperCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to);

/** Swap the spa words in a ready-made message for this org's own words. Identity for a spa org. */
export const localizeTerms = (text) => {
  if (typeof text !== 'string' || !text) return text;
  if (terms.staff === 'Therapist' && terms.room === 'Room') return text;
  return text
    .replace(/\btherapists\b/gi, (m) => keepCase(m, staffWordPlural()))
    .replace(/\btherapist\b/gi, (m) => keepCase(m, singular()))
    .replace(/\brooms\b/gi, (m) => keepCase(m, terms.roomPlural.toLowerCase()))
    .replace(/\broom\b/gi, (m) => keepCase(m, terms.room.toLowerCase()));
};

/** Column / filter heading for the person doing the work. Spa keeps its "Team member"; other trades use their own word ("Staff"). */
export const teamMemberWord = () => (terms.staff === 'Therapist' ? 'Team member' : terms.staff);
/** In-sentence form: spa keeps "team member"; others use their own word ("cleaner"), and a mass noun like "Staff" falls back to "team member". */
export const teamMemberLower = () => (terms.staff === 'Therapist' ? 'team member' : staffWord());
export const teamMemberCap = () => { const w = teamMemberLower(); return w.charAt(0).toUpperCase() + w.slice(1); };

// The word for a business site: spa keeps its own "branch", every other trade says "location" (as the Locations page does).
const capFirst = (w) => w.charAt(0).toUpperCase() + w.slice(1);
export const wordBranch = () => terms.site;
export const wordBranches = () => terms.sitePlural;
export const wordBranchCap = () => capFirst(terms.site);
export const wordBranchesCap = () => capFirst(terms.sitePlural);
/** Swap "branch" in a ready-made string (e.g. report registry copy) for this org's site word. Identity for a spa org. */
export const localizeBranch = (text) => {
  if (typeof text !== 'string' || !text || terms.site === 'branch') return text;
  return text.replace(/\bbranches\b/gi, (m) => keepCase(m, terms.sitePlural)).replace(/\bbranch\b/gi, (m) => keepCase(m, terms.site));
};
