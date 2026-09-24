// Extracted from ManualMergeCustomersPanel's handleConfirmMerge so the "what
// actually changed" diff is unit-testable without a DOM/React harness (this
// repo has no component-test setup — see CLAUDE.md). Only include a field
// when the staff's edit differs from the canonical record's own value —
// merge_customers already coalesces email/notes/gender/dob from the
// duplicate, this is purely for edits made in the review form.
export function resolveMergeEditPatch({ form, canonical }) {
  const edited = {};
  const fullName = form.fullName.trim();
  const phone = form.phone.trim();
  const email = form.email.trim();
  const notes = form.notes.trim();

  if (fullName && fullName !== (canonical.full_name || '')) edited.fullName = fullName;
  if (phone && phone !== (canonical.phone || '')) edited.phone = phone;
  if (email && email !== (canonical.email || '')) edited.email = email;
  if (notes) edited.notes = notes;

  return edited;
}
