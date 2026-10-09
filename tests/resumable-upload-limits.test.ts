import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RAW_RESUMABLE_CHUNKS,
  MAX_RESUMABLE_CHUNKS,
  RAW_RESUMABLE_CHUNK_SIZE,
  RESUMABLE_CHUNK_SIZE,
} from "../src/lib/upload-limits.ts";

test("resumable sessions accept the configured 800 MiB video limit", () => {
  const videoSize = 800 * 1024 * 1024;
  const requiredChunks = Math.ceil(videoSize / RESUMABLE_CHUNK_SIZE);
  assert.equal(requiredChunks, 800);
  assert.ok(requiredChunks <= MAX_RESUMABLE_CHUNKS);
});

test("ordinary resumable chunk limit remains bounded at 1 GiB", () => {
  assert.equal(RESUMABLE_CHUNK_SIZE * MAX_RESUMABLE_CHUNKS, 1024 * 1024 * 1024);
  assert.ok(Math.ceil((1024 * 1024 * 1024 + 1) / RESUMABLE_CHUNK_SIZE) > MAX_RESUMABLE_CHUNKS);
});

test("RAW uploads retain their smaller chunks and larger chunk-count allowance", () => {
  assert.equal(RAW_RESUMABLE_CHUNK_SIZE, 256 * 1024);
  assert.equal(MAX_RAW_RESUMABLE_CHUNKS, 16384);
});
