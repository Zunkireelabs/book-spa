// Pure layout math for overlapping bookings in a grid column: clustering, the side-by-side card slots and the
// "+N" overflow badge geometry.
// ── Overlap layout constants & helpers ─────────────────
export const MAX_VISIBLE_OVERLAP = 2;
const OVERLAP_GAP = 2;       // px between side-by-side cards
export const OVERLAP_PADDING = 4;   // px from column edges

/**
 * Group overlapping bookings into clusters.
 * Sweep algorithm: sort by startTime, extend running max endTime.
 * Strict overlap (startTime < clusterEnd), back-to-back are separate clusters.
 * Ties on startTime (e.g. simultaneous online bookings) break by createdAt so
 * whichever booking was actually placed first (down to the millisecond) lands
 * in the leftmost card slot.
 */
export function clusterOverlapping(bookings) {
  const valid = bookings.filter(b => b.startTime && b.endTime);
  if (valid.length === 0) return [];

  const sorted = [...valid].sort((a, b) => {
    const byStart = a.startTime.localeCompare(b.startTime);
    if (byStart !== 0) return byStart;
    if (a.createdAt && b.createdAt) return new Date(a.createdAt) - new Date(b.createdAt);
    if (a.createdAt) return -1;
    if (b.createdAt) return 1;
    return 0;
  });
  const clusters = [[sorted[0]]];
  let clusterEnd = sorted[0].endTime;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < clusterEnd) {
      clusters[clusters.length - 1].push(sorted[i]);
      if (sorted[i].endTime > clusterEnd) clusterEnd = sorted[i].endTime;
    } else {
      clusters.push([sorted[i]]);
      clusterEnd = sorted[i].endTime;
    }
  }
  return clusters;
}

// True end time of a cluster — the latest endTime across ALL members, not
// just cluster[0] (the earliest-STARTING member, which sort order guarantees,
// but which can easily have an earlier end than a later-starting member it
// transitively overlaps through a third booking). Using cluster[0].endTime
// alone under-sizes the cluster's rendered box whenever that happens, which
// visually clips the "+N more" badge into the wrong time range — it renders
// within the earliest member's span even when the hidden booking(s) it
// represents start later, making a booking near the END of a wide cluster
// look like it's happening near the cluster's start until you click it.
export function clusterEndTime(cluster) {
  return cluster.reduce((max, b) => (b.endTime > max ? b.endTime : max), cluster[0].endTime);
}

// Earliest startTime across a set of bookings — symmetric counterpart to
// clusterEndTime(). Used to position the collapsed overflow badge at the
// actual time span of the bookings it hides, not the whole cluster's span.
export function earliestStartTime(items) {
  return items.reduce((min, b) => (b.startTime < min ? b.startTime : min), items[0].startTime);
}

// The overflow badge only ever needs to fit "+N" — giving it a full card-width
// slot (the old behavior) squeezed the two real cards into equal thirds. It
// gets a narrow width instead (clamped so it stays legible in very
// narrow/zoomed-out columns); cards keep the rest of the space.
const BADGE_MIN_WIDTH = 34;
const BADGE_MAX_WIDTH = 56;
export const BADGE_MIN_HEIGHT = 64; // px — keeps wrapped "+N" text readable on short clusters
const MIN_CARD_WIDTH = 10; // px — floor so cards never go negative-width in a very narrow/zoomed-out column

/**
 * Calculate positioning for cards within an overlap cluster.
 * Shows up to MAX_VISIBLE_OVERLAP full-size cards side by side; any extra
 * bookings collapse into a "+N more" badge (see OverflowBadge) instead of
 * being squeezed into ever-thinner slivers.
 *
 * Positions are CSS calc() strings against the column's real width (100% of the cluster box, which spans the
 * column), so the cards fill the column at any width or zoom without measuring the DOM. The badge keeps its
 * px min/max via clamp().
 * Returns { cards: [{left, width}|null], badge: {left, width, count}|null }
 */
export function getOverlapLayout(clusterSize) {
  if (clusterSize <= 1) {
    return { cards: [null], badge: null };
  }

  const visibleCount = Math.min(clusterSize, MAX_VISIBLE_OVERLAP);
  const hasBadge = clusterSize > MAX_VISIBLE_OVERLAP;

  const avail = `100% - ${OVERLAP_PADDING * 2}px`; // column width minus the edge padding
  const totalGap = (visibleCount + (hasBadge ? 1 : 0) - 1) * OVERLAP_GAP;
  // Badge: ~38% of the available width within its px min/max, shrunk (even below the min) if the cards would
  // otherwise go below MIN_CARD_WIDTH.
  const badgeWidth = hasBadge
    ? `max(0px, min(clamp(${BADGE_MIN_WIDTH}px, calc((${avail}) * 0.38), ${BADGE_MAX_WIDTH}px), calc(${avail} - ${totalGap}px - ${MIN_CARD_WIDTH * visibleCount}px)))`
    : '0px';
  const cardWidth = `max(${MIN_CARD_WIDTH}px, calc((${avail} - ${totalGap}px - ${badgeWidth}) / ${visibleCount}))`;

  const cards = [];
  for (let i = 0; i < visibleCount; i++) {
    cards.push({
      left: `calc(${OVERLAP_PADDING}px + ${i} * (${cardWidth} + ${OVERLAP_GAP}px))`,
      width: cardWidth,
    });
  }

  let badge = null;
  if (hasBadge) {
    badge = {
      left: `calc(${OVERLAP_PADDING}px + ${visibleCount} * (${cardWidth} + ${OVERLAP_GAP}px))`,
      width: badgeWidth,
      count: clusterSize - MAX_VISIBLE_OVERLAP,
    };
  }

  return { cards, badge };
}
