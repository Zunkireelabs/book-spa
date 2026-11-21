import { describe, it, expect } from 'vitest';
import {
  timingSafeEqual, isAuthorized, validateCreateBookingBody, collapseTherapistIds, statusForBookingResult, mapRpcError,
} from './marketplace';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const good = () => ({
  org_slug: 'nuad', branch_id: U(1), service_id: U(2), date: '2026-12-01', start_time: '11:00',
  customer: { full_name: 'A B', phone: '+9779800000000' }, idempotency_key: U(3),
});

describe('timingSafeEqual', () => {
  it('matches equal strings and rejects any difference', () => {
    expect(timingSafeEqual('s3cret', 's3cret')).toBe(true);
    expect(timingSafeEqual('s3cret', 's3creT')).toBe(false);
    expect(timingSafeEqual('s3cret', 's3cret!')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
  it('handles multi-byte characters', () => {
    expect(timingSafeEqual('नमस्ते', 'नमस्ते')).toBe(true);
    expect(timingSafeEqual('नमस्ते', 'नमस्त')).toBe(false);
  });
});

describe('isAuthorized', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isAuthorized('Bearer abc', 'abc')).toBe(true);
    expect(isAuthorized('Bearer abd', 'abc')).toBe(false);
    expect(isAuthorized('abc', 'abc')).toBe(false);
    expect(isAuthorized('bearer abc', 'abc')).toBe(false);
    expect(isAuthorized(null, 'abc')).toBe(false);
    expect(isAuthorized(undefined, 'abc')).toBe(false);
  });
  it('rejects everything when no secret is configured', () => {
    expect(isAuthorized('Bearer ', '')).toBe(false);
    expect(isAuthorized('Bearer x', undefined)).toBe(false);
  });
});

describe('validateCreateBookingBody', () => {
  it('accepts a complete body', () => expect(validateCreateBookingBody(good())).toBeNull());
  it('accepts HH:MM:SS', () => expect(validateCreateBookingBody({ ...good(), start_time: '11:00:00' })).toBeNull());
  it('names the first missing field', () => {
    expect(validateCreateBookingBody({ ...good(), org_slug: '' })).toBe('Missing required field: org_slug');
    expect(validateCreateBookingBody({ ...good(), customer: { full_name: 'A' } })).toBe('Missing required field: customer.phone');
    expect(validateCreateBookingBody({ ...good(), idempotency_key: undefined })).toBe('Missing required field: idempotency_key');
  });
  it('rejects non-objects and bad shapes', () => {
    expect(validateCreateBookingBody(null)).toBe('Body must be a JSON object');
    expect(validateCreateBookingBody({ ...good(), branch_id: 'x' })).toBe('branch_id must be a UUID');
    expect(validateCreateBookingBody({ ...good(), date: '1/12/2026' })).toBe('date must be YYYY-MM-DD');
    expect(validateCreateBookingBody({ ...good(), start_time: '25:00' })).toBe('start_time must be HH:MM');
    expect(validateCreateBookingBody({ ...good(), therapist_ids: ['nope'] })).toBe('therapist ids must be UUIDs');
    expect(validateCreateBookingBody({ ...good(), room_id: 'nope' })).toBe('room_id must be a UUID');
  });
});

describe('collapseTherapistIds', () => {
  it('prefers the array, falls back to the single id, else null', () => {
    expect(collapseTherapistIds({ therapist_ids: [U(1), U(2)], therapist_id: U(3) })).toEqual([U(1), U(2)]);
    expect(collapseTherapistIds({ therapist_id: U(3) })).toEqual([U(3)]);
    expect(collapseTherapistIds({ therapist_ids: [] })).toBeNull();
    expect(collapseTherapistIds({})).toBeNull();
  });
});

describe('error mapping', () => {
  it('only ORG_NOT_ENABLED is a 404; other refusals stay 200', () => {
    expect(statusForBookingResult({ success: false, error_code: 'ORG_NOT_ENABLED' })).toBe(404);
    expect(statusForBookingResult({ success: false, error_code: 'DATE_CLOSED' })).toBe(200);
    expect(statusForBookingResult({ success: true })).toBe(200);
    expect(statusForBookingResult(null)).toBe(200);
  });
  it('maps Postgres codes', () => {
    expect(mapRpcError({ code: 'BSNF1' })).toEqual({ status: 404, error_code: 'ORG_NOT_ENABLED' });
    expect(mapRpcError({ code: '22023' })).toEqual({ status: 400, error_code: 'INVALID_INPUT' });
    expect(mapRpcError({ code: 'XX000' })).toEqual({ status: 500, error_code: 'UNEXPECTED_ERROR' });
    expect(mapRpcError(null)).toEqual({ status: 500, error_code: 'UNEXPECTED_ERROR' });
  });
});
