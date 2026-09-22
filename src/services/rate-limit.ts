/**
 * In-memory rate limiter using sliding window per IP+key.
 * V1 sandbox doesn't use Redis; this is sufficient for single-admin deployment.
 */
type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
}

function cleanOld(now: number, windowMs: number) {
  // Lazy GC: remove buckets older than window
  for (const [k, b] of buckets) {
    if (now - b.windowStart > windowMs) buckets.delete(k);
  }
}

export function rateLimit(key: string, maxPerWindow: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanOld(now, windowMs);
  const b = buckets.get(key);
  if (!b || now - b.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: maxPerWindow - 1, resetMs: windowMs };
  }
  if (b.count >= maxPerWindow) {
    return { ok: false, remaining: 0, resetMs: windowMs - (now - b.windowStart) };
  }
  b.count += 1;
  return { ok: true, remaining: maxPerWindow - b.count, resetMs: windowMs - (now - b.windowStart) };
}

export function clearRateLimit(key: string) {
  buckets.delete(key);
}
