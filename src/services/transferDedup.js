// A therapist transferred out and back more than once within the same viewed range
// would otherwise produce two rows for the same id — two calendar columns for one
// person, or an undefined "which window wins." Rows must already be given in the
// order the caller wants "most relevant" to win (e.g. chronologically ascending, so
// the LAST occurrence is the most recent transfer) — this function is order-preserving
// and keeps whichever occurrence of a key comes last.
export function dedupeTransfersByKey(rows, getKey) {
  const byKey = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    if (!key) return;
    // Map preserves insertion order of keys — re-setting an existing key updates its
    // value but does NOT move it to the end, so a plain .set() would leave a repeated
    // key at its FIRST position even though it now holds the LAST row's data. Delete
    // before re-setting so the key's position reflects its last-write order too.
    byKey.delete(key);
    byKey.set(key, row);
  });
  return [...byKey.values()];
}
