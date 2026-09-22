/**
 * V2-Feature-6: Redis-backed cache with in-memory LRU fallback.
 *
 * - If REDIS_URL is set and reachable, Redis is primary (LRU kept as a warm
 *   secondary so a Redis blip never breaks serving).
 * - If REDIS_URL is empty or the connection fails, falls back to the V1
 *   in-memory LRU behavior and logs a warning (never logs the URL/secrets).
 *
 * Keys (namespace `storage:`):
 *   storage:file:bytes:{publicId}  -> binary (Buffer)
 *   storage:file:meta:{publicId}    -> JSON string
 *   storage:file:exists:{publicId}  -> "1" | "0"
 *
 * TTLs: bytes = CACHE_TTL_SECONDS (7d default), meta = 5 min, exists = 60 s.
 *
 * NOTE: all methods are async (breaking change vs V1) — callers must await.
 */
import { LRUCache } from "lru-cache";
import Redis from "ioredis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface FileMeta {
  mimeType: string;
  size: number;
  status: string;
  updatedAt: string;
}

export type CacheBackend = "redis" | "memory";

// ---- In-memory LRU (V1 behavior, always available as fallback) ----
const bytesCache = new LRUCache<string, Buffer>({
  max: env.CACHE_MAX_ITEMS,
  // Soft cap on total bytes — 500 * ~500KB = 250 MB max
  maxSize: 250 * 1024 * 1024,
  sizeCalculation: (buf) => buf.byteLength,
  ttl: env.CACHE_TTL_SECONDS * 1000,
  allowStale: false,
});

const metaCache = new LRUCache<string, FileMeta>({
  max: env.CACHE_MAX_ITEMS * 4,
  ttl: 5 * 60 * 1000, // 5 min for metadata
});

const existsCache = new LRUCache<string, boolean>({
  max: env.CACHE_MAX_ITEMS * 10,
  ttl: 60 * 1000, // 60s negative cache
});

const META_TTL_S = 5 * 60;
const EXISTS_TTL_S = 60;

// ---- Redis (optional primary) ----
let redis: Redis | null = null;
let redisPermanentlyFailed = false;
let warnedNoRedis = false;
let connectAttempt: Promise<boolean> | null = null;

function warnOnce(msg: string, extra?: Record<string, unknown>) {
  if (!warnedNoRedis) {
    warnedNoRedis = true;
    logger.warn(msg, extra);
  }
}

async function ensureRedis(): Promise<Redis | null> {
  if (!env.REDIS_URL) return null;
  if (redisPermanentlyFailed) return null;
  if (redis && redis.status === "ready") return redis;
  if (!connectAttempt) {
    connectAttempt = (async () => {
      try {
        const client = new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          retryStrategy: () => null, // don't loop forever; fall back to memory
        });
        client.on("error", () => {
          // Swallowed — per-op try/catch handles fallback. No secret logging.
        });
        await client.connect();
        if (client.status !== "ready") throw new Error(`unexpected status ${client.status}`);
        redis = client;
        logger.info("cache: Redis connected, using as primary");
        return true;
      } catch (e) {
        redisPermanentlyFailed = true;
        warnOnce("cache: Redis unavailable, falling back to in-memory LRU", {
          err: e instanceof Error ? e.message : String(e),
        });
        try {
          redis?.disconnect();
        } catch {
          /* ignore */
        }
        redis = null;
        return false;
      } finally {
        connectAttempt = null;
      }
    })();
  }
  const ok = await connectAttempt;
  return ok && redis ? redis : null;
}

const kBytes = (publicId: string) => `storage:file:bytes:${publicId}`;
const kMeta = (publicId: string) => `storage:file:meta:${publicId}`;
const kExists = (publicId: string) => `storage:file:exists:${publicId}`;

export const cache = {
  /** Current active backend. Triggers one connection attempt if REDIS_URL is set. */
  async backend(): Promise<CacheBackend> {
    const client = await ensureRedis();
    return client ? "redis" : "memory";
  },

  // ---- Bytes ----
  async getBytes(publicId: string): Promise<Buffer | undefined> {
    const client = await ensureRedis();
    if (client) {
      try {
        const buf = await client.getBuffer(kBytes(publicId));
        if (buf) {
          bytesCache.set(`file:bytes:${publicId}`, Buffer.from(buf));
          return Buffer.from(buf);
        }
      } catch (e) {
        logger.warn("cache: Redis getBytes failed, using LRU", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    } else if (env.REDIS_URL) {
      warnOnce("cache: Redis unavailable, falling back to in-memory LRU");
    }
    return bytesCache.get(`file:bytes:${publicId}`);
  },

  async setBytes(publicId: string, buf: Buffer): Promise<void> {
    bytesCache.set(`file:bytes:${publicId}`, buf);
    const client = await ensureRedis();
    if (!client) return;
    try {
      await client.set(kBytes(publicId), buf, "EX", env.CACHE_TTL_SECONDS);
    } catch (e) {
      logger.warn("cache: Redis setBytes failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  },

  // ---- Meta ----
  async getMeta(publicId: string): Promise<FileMeta | undefined> {
    const client = await ensureRedis();
    if (client) {
      try {
        const raw = await client.get(kMeta(publicId));
        if (raw) {
          const parsed = JSON.parse(raw) as FileMeta;
          metaCache.set(`file:meta:${publicId}`, parsed);
          return parsed;
        }
      } catch (e) {
        logger.warn("cache: Redis getMeta failed, using LRU", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return metaCache.get(`file:meta:${publicId}`);
  },

  async setMeta(publicId: string, meta: FileMeta): Promise<void> {
    metaCache.set(`file:meta:${publicId}`, meta);
    const client = await ensureRedis();
    if (!client) return;
    try {
      await client.set(kMeta(publicId), JSON.stringify(meta), "EX", META_TTL_S);
    } catch (e) {
      logger.warn("cache: Redis setMeta failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  },

  // ---- Exists (negative cache for missing files) ----
  async getExists(publicId: string): Promise<boolean | undefined> {
    const client = await ensureRedis();
    if (client) {
      try {
        const raw = await client.get(kExists(publicId));
        if (raw === "1" || raw === "0") {
          const val = raw === "1";
          existsCache.set(`file:exists:${publicId}`, val);
          return val;
        }
      } catch (e) {
        logger.warn("cache: Redis getExists failed, using LRU", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return existsCache.get(`file:exists:${publicId}`);
  },

  async setExists(publicId: string, exists: boolean): Promise<void> {
    existsCache.set(`file:exists:${publicId}`, exists);
    const client = await ensureRedis();
    if (!client) return;
    try {
      await client.set(kExists(publicId), exists ? "1" : "0", "EX", EXISTS_TTL_S);
    } catch (e) {
      logger.warn("cache: Redis setExists failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  },

  // ---- Invalidate everything for a publicId (used on delete) ----
  async invalidate(publicId: string): Promise<void> {
    bytesCache.delete(`file:bytes:${publicId}`);
    metaCache.delete(`file:meta:${publicId}`);
    existsCache.delete(`file:exists:${publicId}`);
    const client = await ensureRedis();
    if (!client) return;
    try {
      await client.del(kBytes(publicId), kMeta(publicId), kExists(publicId));
    } catch (e) {
      logger.warn("cache: Redis invalidate failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  },

  // ---- Stats (LRU info + active backend; Redis key count on best effort) ----
  async stats() {
    const client = await ensureRedis();
    let redisKeys: number | undefined;
    if (client) {
      try {
        // Count only our namespace to avoid reporting unrelated DB size.
        const keys = await client.keys("storage:file:*");
        redisKeys = keys.length;
      } catch {
        redisKeys = undefined;
      }
    }
    return {
      backend: (client ? "redis" : "memory") as CacheBackend,
      bytesSize: bytesCache.size,
      bytesBytes: bytesCache.calculatedSize,
      metaSize: metaCache.size,
      existsSize: existsCache.size,
      ...(redisKeys !== undefined ? { redisKeys } : {}),
    };
  },
};
