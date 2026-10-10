interface CachedAnalytics {
  data: unknown;
  expires: number;
  key: string;
}

let cacheEntry: CachedAnalytics | null = null;

export function getCachedAnalytics(key: string): unknown | null {
  if (!cacheEntry || cacheEntry.key !== key || Date.now() >= cacheEntry.expires) return null;
  return cacheEntry.data;
}

export function setCachedAnalytics(key: string, data: unknown, ttlMs: number): void {
  cacheEntry = { key, data, expires: Date.now() + ttlMs };
}

/** Called when channel visibility or labels change so dashboard totals refresh. */
export function invalidateAnalyticsCache(): void {
  cacheEntry = null;
}
