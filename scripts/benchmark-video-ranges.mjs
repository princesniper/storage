#!/usr/bin/env node
/**
 * Reproducible MOCK benchmark for bounded Telegram-style ranges.
 * It models 512 KiB Telegram chunks and the current buffer-then-respond behavior.
 * It does not contact Telegram or predict Railway network latency.
 *
 * Run: node scripts/benchmark-video-ranges.mjs
 * Optional simulated per-chunk delay: RANGE_MOCK_CHUNK_DELAY_MS=5 node scripts/benchmark-video-ranges.mjs
 */
import { performance } from "node:perf_hooks";

const MiB = 1024 * 1024;
const TELEGRAM_CHUNK = 512 * 1024;
const delayMs = Math.max(0, Number(process.env.RANGE_MOCK_CHUNK_DELAY_MS ?? 0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchMockRange(length) {
  const started = performance.now();
  const chunks = [];
  let bytesFetched = 0;
  let firstChunkAt = null;
  let calls = 0;
  for (let offset = 0; offset < length; offset += TELEGRAM_CHUNK) {
    calls += 1;
    if (delayMs) await sleep(delayMs);
    const count = Math.min(TELEGRAM_CHUNK, length - offset);
    const chunk = Buffer.alloc(count, calls % 251);
    chunks.push(chunk);
    bytesFetched += chunk.length;
    if (firstChunkAt === null) firstChunkAt = performance.now();
  }
  const joined = Buffer.concat(chunks);
  const totalMs = performance.now() - started;
  const bodyCorrect = joined.length === length && bytesFetched === length;
  return {
    rangeMiB: length / MiB,
    firstChunkMs: Number(((firstChunkAt ?? performance.now()) - started).toFixed(2)),
    bufferedResponseTtfbMs: Number(totalMs.toFixed(2)),
    totalFetchMs: Number(totalMs.toFixed(2)),
    telegramChunks: calls,
    bytesFetched,
    estimatedPeakBufferMiB: Number(((bytesFetched + joined.length) / MiB).toFixed(2)),
    retries: 0,
    bodyCorrect,
  };
}

const results = [];
for (const mib of [1, 4, 8]) results.push(await fetchMockRange(mib * MiB));
console.log(JSON.stringify({
  mode: "mock-only; no Telegram/Railway network",
  telegramChunkBytes: TELEGRAM_CHUNK,
  simulatedPerChunkDelayMs: delayMs,
  results,
}, null, 2));
