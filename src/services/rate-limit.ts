/**
 * Rate limiting with a bounded in-process fallback and optional shared Redis.
 * Set REDIS_URL only when a shared Redis service is already provisioned.
 * If configured Redis is unavailable, sensitive requests fail closed rather
 * than silently degrading to per-instance limits.
 */
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

type Bucket = { count: number; windowStart: number };
export interface RateLimitResult { ok: boolean; remaining: number; resetMs: number }
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
let redis: Redis | null = null;
let redisInit: Promise<Redis | null> | null = null;
let redisFailed = false;

function cleanOld(now: number, windowMs: number) {
  for (const [key, bucket] of buckets) if (now - bucket.windowStart > windowMs) buckets.delete(key);
}

export function rateLimit(key: string, maxPerWindow: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanOld(now, windowMs);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    if (!bucket && buckets.size >= MAX_BUCKETS) return { ok: false, remaining: 0, resetMs: windowMs };
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: Math.max(0, maxPerWindow - 1), resetMs: windowMs };
  }
  if (bucket.count >= maxPerWindow) return { ok: false, remaining: 0, resetMs: Math.max(1, windowMs - (now - bucket.windowStart)) };
  bucket.count += 1;
  return { ok: true, remaining: maxPerWindow - bucket.count, resetMs: Math.max(1, windowMs - (now - bucket.windowStart)) };
}

async function getRedis(): Promise<Redis | null> {
  if (!env.REDIS_URL || redisFailed) return null;
  if (redis?.status === "ready") return redis;
  if (!redisInit) {
    redisInit = (async () => {
      const client = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2500, retryStrategy: () => null });
      client.on("error", () => {});
      try { await client.connect(); if (client.status !== "ready") throw new Error("Redis not ready"); redis = client; return client; }
      catch { redisFailed = true; client.disconnect(); return null; }
      finally { redisInit = null; }
    })();
  }
  return redisInit;
}

/** Atomic fixed-window limiter shared across instances when REDIS_URL is configured. */
export async function rateLimitAsync(key: string, maxPerWindow: number, windowMs: number): Promise<RateLimitResult> {
  if (!env.REDIS_URL) return rateLimit(key, maxPerWindow, windowMs);
  const client = await getRedis();
  if (!client) return { ok: false, remaining: 0, resetMs: windowMs };
  const digest = createHash("sha256").update(key).digest("hex");
  const redisKey = "growplants:ratelimit:" + digest;
  try {
    const result = await client.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('PTTL', KEYS[1]); return {count, ttl}",
      1, redisKey, String(windowMs),
    ) as [number, number];
    const count = Number(result[0]);
    const ttl = Math.max(1, Number(result[1]));
    return { ok: count <= maxPerWindow, remaining: Math.max(0, maxPerWindow - count), resetMs: ttl };
  } catch {
    // Fail closed when an explicitly configured shared limiter is unavailable.
    return { ok: false, remaining: 0, resetMs: windowMs };
  }
}

export function clearRateLimit(key: string) { buckets.delete(key); }
