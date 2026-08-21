/**
 * Per-credential rate limiting (A2.2). Keyed on the caller's credential hash, not IP — every
 * call from this server reaches Zettagrid from the same address, so an IP-keyed limit would
 * only ever throttle the whole server at once, and one misbehaving caller would still be able
 * to get Arupa's IP flagged with Zettagrid.
 *
 * In-memory, single-process. No new dependency: this is a plain fixed-window counter, which
 * is the right amount of mechanism for one Node process protecting an upstream API — nothing
 * here needs to survive a restart or be shared across replicas.
 */

const WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 60;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const maxPerWindow = (() => {
  const configured = parseInt(process.env.ZETTAGRID_RATE_LIMIT_PER_MINUTE || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_PER_WINDOW;
})();

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function sweepStaleBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart >= WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

const sweepTimer = setInterval(sweepStaleBuckets, SWEEP_INTERVAL_MS);
sweepTimer.unref();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
}

export function checkRateLimit(credentialHash: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(credentialHash);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(credentialHash, { count: 1, windowStart: now });
    return { allowed: true, limit: maxPerWindow, remaining: maxPerWindow - 1 };
  }

  bucket.count += 1;

  if (bucket.count > maxPerWindow) {
    return {
      allowed: false,
      limit: maxPerWindow,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)
    };
  }

  return { allowed: true, limit: maxPerWindow, remaining: maxPerWindow - bucket.count };
}
