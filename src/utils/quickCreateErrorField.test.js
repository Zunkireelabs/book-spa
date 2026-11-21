import { describe, it, expect } from 'vitest';
import { fieldForErrorCode, ERROR_CODE_FIELD } from './quickCreateErrorField';

describe('fieldForErrorCode', () => {
  it.each(Object.entries(ERROR_CODE_FIELD))('%s -> %s', (code, field) => {
    expect(fieldForErrorCode(code)).toBe(field);
  });
  it.each([['ROOMS_FULL', 'time'], ['ROOM_FULL', 'room'], ['ROOM_CONFLICT', 'room'], ['THERAPIST_ABSENT', 'staff'], ['BRANCH_CLOSED', 'time'], ['NO_CONTACT_INFO', 'customer']])('%s is %s', (c, f) => {
    expect(fieldForErrorCode(c)).toBe(f);
  });
  it('is null for unknown or missing codes', () => {
    expect(fieldForErrorCode('SOMETHING_NEW')).toBeNull();
    expect(fieldForErrorCode(undefined)).toBeNull();
  });
});
