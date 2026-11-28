import { describe, it, expect } from 'vitest';
import { pickReplyTo } from './channels.ts';

describe('pickReplyTo', () => {
  it('prefers the billing email, falls back to the owner email', () => {
    expect(pickReplyTo({ billing_email: ' a@b.com ' }, 'o@b.com')).toBe('a@b.com');
    expect(pickReplyTo({}, 'o@b.com')).toBe('o@b.com');
  });
  it('is undefined when there is no usable email', () => {
    expect(pickReplyTo(null, null)).toBeUndefined();
    expect(pickReplyTo({ billing_email: 'nope' }, '')).toBeUndefined();
  });
});
