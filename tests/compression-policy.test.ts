import test from "node:test";
import assert from "node:assert/strict";
import { compressionPolicy, isWorthwhile, shouldUseCompressedOutput } from "../src/lib/compression/compression-policy.ts";

test("original mode never compresses", () => {
  assert.deepEqual(compressionPolicy({ mode: "original", size: 1 }), {
    eligible: false,
    shouldAttempt: false,
    reason: "original-mode",
  });
});

test("balanced mode has no file-size ceiling", () => {
  const result = compressionPolicy({ mode: "balanced", size: 2 * 1024 * 1024 * 1024 });
  assert.equal(result.eligible, true);
  assert.equal(result.shouldAttempt, true);
});

test("auto mode has no 800 MB bypass", () => {
  const result = compressionPolicy({ mode: "auto", size: 801 * 1024 * 1024 });
  assert.equal(result.eligible, true);
  assert.equal(result.shouldAttempt, true);
});

test("auto skips tiny files before compression", () => {
  const result = compressionPolicy({ mode: "auto", size: 1024 });
  assert.equal(result.eligible, true);
  assert.equal(result.shouldAttempt, false);
  assert.equal(result.reason, "auto-file-too-small");
});

test("invalid sizes are rejected", () => {
  assert.equal(compressionPolicy({ mode: "balanced", size: 0 }).shouldAttempt, false);
  assert.equal(compressionPolicy({ mode: "balanced", size: -1 }).shouldAttempt, false);
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
