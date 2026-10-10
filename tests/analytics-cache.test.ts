import test from "node:test";
import assert from "node:assert/strict";
import {
  getCachedAnalytics,
  invalidateAnalyticsCache,
  setCachedAnalytics,
} from "../src/lib/analytics-cache.ts";

test("analytics cache can be invalidated immediately after channel removal or reconnect", () => {
  setCachedAnalytics("days=30", { totalActive: 5775 }, 60_000);
  assert.deepEqual(getCachedAnalytics("days=30"), { totalActive: 5775 });
  invalidateAnalyticsCache();
  assert.equal(getCachedAnalytics("days=30"), null);
});

test("analytics cache keys are isolated and expired entries are ignored", () => {
  setCachedAnalytics("days=7", { totalActive: 12 }, 60_000);
  assert.equal(getCachedAnalytics("days=30"), null);
  setCachedAnalytics("days=1", { totalActive: 1 }, 0);
  assert.equal(getCachedAnalytics("days=1"), null);
  invalidateAnalyticsCache();
});
