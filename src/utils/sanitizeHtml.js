import DOMPurify from 'dompurify';

// Used only for rendering HTML *previews* in the admin dashboard (a real
// browser/JS context) — never in the actual outreach send path, which is
// server-side SQL string substitution and never executed as script by an
// email client. See TemplateEditorPanel.jsx's Preview box.
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '', { ADD_ATTR: ['style'] });
}
