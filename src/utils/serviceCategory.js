// Edit-service category rules (ZNLY-308). services.category is free text, so a service can carry a category that has no row in
// service_categories (a renamed or deleted category, or a tenant that never set any up).

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Select options: the business's categories, plus the service's own current one when it is missing, so the form always shows it
// (`suffix` is a grey note CustomSelect renders in the open list only).
export const categoryOptions = (categories, current) => {
  const opts = (categories || []).map((c) => ({ value: c.name, label: c.name }));
  const cur = String(current ?? '').trim();
  if (cur && !opts.some((o) => norm(o.value) === norm(cur))) opts.push({ value: current, label: cur, suffix: '(not in Categories)' }); // suffix shows in the open list only; the closed select reads just the name
  return opts;
};

export const isCategoryMissing = (categories, current) => {
  const cur = norm(current);
  return !!cur && !(categories || []).some((c) => norm(c.name) === cur);
};

// What to send as `category` on save. Editing: only an explicit change writes a value (undefined = leave the column alone, and
// updateServicePricing skips undefined). Creating: whatever is chosen.
export const categoryForSave = ({ isEdit, current, original }) => {
  if (!isEdit) return current;
  return (current ?? '') === (original ?? '') ? undefined : current;
};
