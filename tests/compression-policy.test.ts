import test from "node:test";
import assert from "node:assert/strict";
import { COMPRESSION_LIMIT_BYTES, compressionPolicy, isWorthwhile, shouldUseCompressedOutput } from "../src/lib/compression/compression-policy.ts";

test("original mode never compresses", () => {
  assert.deepEqual(compressionPolicy({ mode: "original", size: 1 }), {
    eligible: false,
    shouldAttempt: false,
    reason: "original-mode",
  });
});

test("balanced mode compresses files at or below 800 MB", () => {
  const exact = compressionPolicy({ mode: "balanced", size: COMPRESSION_LIMIT_BYTES });
  assert.equal(exact.eligible, true);
  assert.equal(exact.shouldAttempt, true);
});

test("801 MB bypasses compression", () => {
  const result = compressionPolicy({ mode: "auto", size: COMPRESSION_LIMIT_BYTES + 1 });
  assert.equal(result.eligible, false);
  assert.equal(result.shouldAttempt, false);
  assert.equal(result.reason, "over-800mb");
});

test("auto skips tiny files before compression", () => {
  const result = compressionPolicy({ mode: "auto", size: 1024 });
  assert.equal(result.eligible, true);
  assert.equal(result.shouldAttempt, false);
  assert.equal(result.reason, "auto-file-too-small");
});

test("balanced accepts any valid size reduction", () => {
  assert.equal(shouldUseCompressedOutput("balanced", 1000, 990), true);
});

test("auto accepts worthwhile savings", () => {
  assert.equal(isWorthwhile(1000, 900), true);
});

test("auto rejects insignificant savings", () => {
  assert.equal(isWorthwhile(1000, 960), false);
});

test("larger or invalid output is never worthwhile", () => {
  assert.equal(isWorthwhile(1000, 1000), false);
  assert.equal(isWorthwhile(1000, 1200), false);
  assert.equal(isWorthwhile(1000, 0), false);
});
