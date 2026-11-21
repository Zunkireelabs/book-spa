// Pure helpers shared by the three marketplace edge functions (ZNLY-332). No Deno or network imports,
// so Vitest can test them (marketplace.test.ts).

/** Constant-time string compare: the work done depends only on the longer length, never on where the strings differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/** True only when the header is exactly `Bearer <secret>` and the secret is non-empty. */
export function isAuthorized(authHeader: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const prefix = 'Bearer ';
  const header = authHeader ?? '';
  const token = header.startsWith(prefix) ? header.slice(prefix.length) : '';
  // Compare even when the prefix is missing so every rejected request does the same work.
  const ok = timingSafeEqual(token, secret);
  return header.startsWith(prefix) && ok;
}

export interface CreateBookingBody {
  org_slug: string;
  branch_id: string;
  service_id: string;
  date: string;
  start_time: string;
  customer: { full_name: string; email?: string | null; phone: string; gender?: string | null };
  special_requests?: string | null;
  gender_preference?: string | null;
  therapist_id?: string | null;
  therapist_ids?: string[] | null;
  room_id?: string | null;
  therapist_room_overrides?: Record<string, string> | null;
  idempotency_key: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Returns the first problem as a plain message, or null when the body is usable. */
export function validateCreateBookingBody(body: unknown): string | null {
  const b = body as Partial<CreateBookingBody> | null;
  if (!b || typeof b !== 'object') return 'Body must be a JSON object';
  const required: Array<[string, unknown]> = [
    ['org_slug', b.org_slug],
    ['branch_id', b.branch_id],
    ['service_id', b.service_id],
    ['date', b.date],
    ['start_time', b.start_time],
    ['customer.full_name', b.customer?.full_name],
    ['customer.phone', b.customer?.phone],
    ['idempotency_key', b.idempotency_key],
  ];
  const missing = required.find(([, v]) => v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));
  if (missing) return `Missing required field: ${missing[0]}`;
  if (!UUID_RE.test(String(b.branch_id))) return 'branch_id must be a UUID';
  if (!UUID_RE.test(String(b.service_id))) return 'service_id must be a UUID';
  if (!UUID_RE.test(String(b.idempotency_key))) return 'idempotency_key must be a UUID';
  if (!DATE_RE.test(String(b.date))) return 'date must be YYYY-MM-DD';
  if (!TIME_RE.test(String(b.start_time))) return 'start_time must be HH:MM';
  const ids = [...(b.therapist_ids ?? []), ...(b.therapist_id ? [b.therapist_id] : [])];
  if (ids.some((id) => !UUID_RE.test(String(id)))) return 'therapist ids must be UUIDs';
  if (b.room_id && !UUID_RE.test(String(b.room_id))) return 'room_id must be a UUID';
  return null;
}

/** therapist_ids wins over therapist_id; empty means "any available". */
export function collapseTherapistIds(b: Pick<CreateBookingBody, 'therapist_id' | 'therapist_ids'>): string[] | null {
  const many = b.therapist_ids?.filter(Boolean);
  if (many && many.length > 0) return many;
  return b.therapist_id ? [b.therapist_id] : null;
}

/** RPC result -> HTTP status. A structured business refusal stays 200 so the caller can switch on error_code; only
 *  ORG_NOT_ENABLED (a setup problem) is 404. */
export function statusForBookingResult(data: { success?: boolean; error_code?: string } | null | undefined): number {
  if (data?.success === false && data?.error_code === 'ORG_NOT_ENABLED') return 404;
  return 200;
}

/** Postgres error from a marketplace RPC -> HTTP status + stable error_code. BSNF1 = org not opted in. */
export function mapRpcError(error: { code?: string } | null | undefined): { status: number; error_code: string } {
  if (error?.code === 'BSNF1') return { status: 404, error_code: 'ORG_NOT_ENABLED' };
  if (error?.code === '22023') return { status: 400, error_code: 'INVALID_INPUT' };
  return { status: 500, error_code: 'UNEXPECTED_ERROR' };
}
