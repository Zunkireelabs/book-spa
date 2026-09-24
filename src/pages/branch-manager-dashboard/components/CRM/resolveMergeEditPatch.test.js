import { describe, it, expect } from 'vitest';
import { resolveMergeEditPatch } from './resolveMergeEditPatch';

const canonical = { full_name: 'Manju Tiwari', phone: '+9779861493942', email: '' };

describe('resolveMergeEditPatch', () => {
  it('returns an empty object when nothing in the form differs from canonical and notes is blank', () => {
    const form = { fullName: 'Manju Tiwari', phone: '+9779861493942', email: '', notes: '' };
    expect(resolveMergeEditPatch({ form, canonical })).toEqual({});
  });

  it('includes only the fields that changed', () => {
    const form = { fullName: 'Manju Tiwari', phone: '+9779851137306', email: '', notes: '' };
    expect(resolveMergeEditPatch({ form, canonical })).toEqual({ phone: '+9779851137306' });
  });

  it('includes notes whenever notes is non-blank, even if canonical had none', () => {
    const form = { fullName: 'Manju Tiwari', phone: '+9779861493942', email: '', notes: 'merged duplicate 2026-09-24' };
    expect(resolveMergeEditPatch({ form, canonical })).toEqual({ notes: 'merged duplicate 2026-09-24' });
  });

  it('trims whitespace before comparing and before including a value', () => {
    const form = { fullName: '  Manju Tiwari  ', phone: '+9779861493942', email: '', notes: '   ' };
    expect(resolveMergeEditPatch({ form, canonical })).toEqual({});
  });

  it('ignores a blank fullName/phone/email edit (falls back to canonical, matching current behavior)', () => {
    const form = { fullName: '', phone: '', email: '', notes: '' };
    expect(resolveMergeEditPatch({ form, canonical })).toEqual({});
  });
});
