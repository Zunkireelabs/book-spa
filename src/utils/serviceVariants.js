const DURATION_SUFFIX_RE = /\s*-\s*\d+\s*min$/i;

export function getExtendOptions(currentService, allServices) {
  if (!currentService) return [];
  const baseName = currentService.name.replace(DURATION_SUFFIX_RE, '').trim().toLowerCase();
  return (allServices || [])
    .filter(s =>
      s.is_active !== false &&
      s.category === currentService.category &&
      s.name.replace(DURATION_SUFFIX_RE, '').trim().toLowerCase() === baseName &&
      s.duration_minutes > currentService.duration_minutes
    )
    .sort((a, b) => a.duration_minutes - b.duration_minutes);
}
