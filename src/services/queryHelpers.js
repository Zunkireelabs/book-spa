// Small helpers for read-only enrichment queries that must never block or break a screen.

// PostgREST puts .in() lists in the URL, which breaks (and supabase-js then retries the network error with backoff,
// ~7s) once it gets long, so id lists are always sent in chunks of at most this many.
export const IN_CHUNK = 100;

// Run `run(chunk)` (a supabase query returning { data, error }) over `ids` in chunks of IN_CHUNK, sequentially, and
// return every row. Throws the first error.
export const inChunks = async (ids, run) => {
  const results = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await run(ids.slice(i, i + IN_CHUNK));
    if (error) throw error;
    results.push(...(data || []));
  }
  return results;
};

// Optional enrichment must never hold a screen up: resolve to `fallback` if it takes longer than `ms`. The timer is
// cleared as soon as the promise settles.
export const failOpenAfter = (promise, ms, fallback) => {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// Free text going into a PostgREST `.or()` ilike filter: commas, dots, parens, quotes and backslashes would break (or inject into)
// the filter string, and %, _ and * would act as wildcards, so they are all dropped. Returns '' when nothing searchable is left.
export const sanitizeSearchTerm = (query) => String(query ?? '').trim().replace(/[,.()"\\%_*]/g, '').trim();

// The `.or()` filter for a customer lookup by name or phone, or null when the term is empty after sanitising.
export const customerSearchFilter = (query) => {
  const term = sanitizeSearchTerm(query);
  return term ? `full_name.ilike.%${term}%,phone.ilike.%${term}%` : null;
};
