import { describe, it, expect } from 'vitest';
import { htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
  });

  it('strips tags and keeps the text', () => {
    expect(htmlToText('<p>Hi <b>Asha</b>, welcome back.</p>')).toBe('Hi Asha, welcome back.');
  });

  it('turns block-level tags and <br> into line breaks', () => {
    expect(htmlToText('<h2>Hello</h2><p>One</p><p>Two<br>Three</p>')).toBe('Hello\nOne\nTwo\nThree');
  });

  it('drops script and style contents', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Hi</p><script>alert(1)</script>')).toBe('Hi');
  });

  it('decodes common named and numeric entities', () => {
    expect(htmlToText('Tom &amp; Jerry &nbsp;&quot;hi&quot; &#39;x&#39; &#x41;')).toBe('Tom & Jerry "hi" \'x\' A');
  });

  it('keeps escaped markup as literal text rather than re-parsing it', () => {
    expect(htmlToText('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
  });

  it('collapses runs of whitespace and blank lines', () => {
    expect(htmlToText('<p>a    b</p>\n\n\n\n<p>c</p>')).toBe('a b\n\nc');
  });
  it('collapses a non-breaking space (U+00A0) like any other space', () => {
    expect(htmlToText('a\u00a0\u00a0b')).toBe('a b');
  });
});
