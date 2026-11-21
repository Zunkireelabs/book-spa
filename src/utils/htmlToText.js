// Plain-text preview of an HTML message body (review queue, message log). Pure string work (no DOM), so it is safe to run on
// anything: tags are dropped, block-level tags become line breaks, <script>/<style> contents are removed and the common
// entities are decoded. Not a sanitiser: its output is only ever rendered as text.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] ?? m));

export const htmlToText = (html) => {
  if (!html) return '';
  const text = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  // Decode last so an escaped "&lt;b&gt;" stays the literal text "<b>" instead of being treated as a tag.
  return decodeEntities(text)
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
