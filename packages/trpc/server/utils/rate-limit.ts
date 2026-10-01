type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function enforceRateLimit(params: { key: string; limit: number; windowMs: number }) {
  const now = Date.now();
  const existing = buckets.get(params.key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(params.key, { count: 1, resetAt: now + params.windowMs });
    return { ok: true as const, remaining: params.limit - 1 };
  }

  if (existing.count >= params.limit) {
    return { ok: false as const, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  buckets.set(params.key, existing);
  return { ok: true as const, remaining: params.limit - existing.count };
}

