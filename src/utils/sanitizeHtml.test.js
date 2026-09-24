// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('strips a script tag entirely', () => {
    const dirty = '<p>Hello</p><script>alert(1)</script>';
    expect(sanitizeHtml(dirty)).toBe('<p>Hello</p>');
  });

  it('strips an inline event-handler attribute', () => {
    const dirty = '<img src="x.png" onerror="alert(1)">';
    expect(sanitizeHtml(dirty)).not.toContain('onerror');
  });

  it('keeps ordinary styled markup intact', () => {
    const clean = '<div style="color:#2D5A27;padding:8px;"><p>Hi {{customer_name}}</p></div>';
    expect(sanitizeHtml(clean)).toContain('Hi {{customer_name}}');
    expect(sanitizeHtml(clean)).toContain('style=');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
