import test from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../src/lib/http-range.ts";

const SIZE = 10 * 1024 * 1024;

test("parses initial and mid-file byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-1048575", SIZE), { start: 0, end: 1048575 });
  assert.deepEqual(parseByteRange("bytes=5242880-6291455", SIZE), { start: 5242880, end: 6291455 });
});

test("parses open-ended and suffix ranges", () => {
  assert.deepEqual(parseByteRange("bytes=1048576-", SIZE), { start: 1048576, end: SIZE - 1 });
  assert.deepEqual(parseByteRange("bytes=-1024", SIZE), { start: SIZE - 1024, end: SIZE - 1 });
  assert.deepEqual(parseByteRange("bytes=-99999999", SIZE), { start: 0, end: SIZE - 1 });
});

test("clamps explicit end beyond EOF and rejects unsatisfiable ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-99999999", SIZE), { start: 0, end: SIZE - 1 });
  assert.equal(parseByteRange("bytes=10485760-", SIZE), null);
  assert.equal(parseByteRange("bytes=9-8", SIZE), null);
  assert.equal(parseByteRange("bytes=-0", SIZE), null);
});

test("rejects malformed, multi-range, and invalid-size input", () => {
  assert.equal(parseByteRange("bytes=", SIZE), null);
  assert.equal(parseByteRange("bytes=abc-def", SIZE), null);
  assert.equal(parseByteRange("bytes=0-1,4-5", SIZE), null);
  assert.equal(parseByteRange("bytes=0-1", 0), null);
});

test("shared and canonical playback sources use bounded range APIs and metadata-only HEAD handlers", async () => {
  const fs = await import("node:fs/promises");
  const sharedRoute = await fs.readFile(new URL("../src/app/api/shared/folders/[token]/files/[id]/route.ts", import.meta.url), "utf8");
  const canonicalRoute = await fs.readFile(new URL("../src/app/images/[file]/route.ts", import.meta.url), "utf8");
  const sharedMedia = await fs.readFile(new URL("../src/lib/shared-media.ts", import.meta.url), "utf8");
  const serveMedia = await fs.readFile(new URL("../src/lib/serve-media.ts", import.meta.url), "utf8");
  assert.match(sharedRoute, /fetchRange: \(start, end\) => getSharedFileRange\(file, start, end\)/);
  assert.match(sharedRoute, /createBoundedPartialResponse/);
  assert.doesNotMatch(sharedRoute, /createStreamingPartialResponse|TELEGRAM_RANGE_CHUNK_BYTES/);
  assert.match(sharedRoute, /start \+ MAX_VIDEO_RANGE_BYTES - 1/);
  assert.match(canonicalRoute, /export async function HEAD/);
  assert.match(sharedMedia, /telegramService\.downloadFileRange/);
  assert.match(serveMedia, /createBoundedPartialResponse/);
  assert.match(serveMedia, /start \+ MAX_VIDEO_RANGE_BYTES - 1/);
  assert.doesNotMatch(serveMedia, /createStreamingPartialResponse|TELEGRAM_RANGE_CHUNK_BYTES/);
  assert.doesNotMatch(sharedRoute, /getSharedFileBytes\(file\)[\s\S]{0,150}if \(isVideo\)/);
});


test("Files grid uses generated posters or placeholders instead of original video URLs", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/components/files/files-client.tsx", import.meta.url), "utf8");
  const thumb = source.slice(source.indexOf("function Thumb("), source.indexOf("interface CardProps"));
  assert.match(thumb, /file\.previewUrl/);
  const videoBranch = thumb.slice(thumb.indexOf("if (isVideoMime"), thumb.indexOf("  return <img src={file.publicUrl}"));
  assert.doesNotMatch(videoBranch, /<video|publicUrl/);
  assert.doesNotMatch(thumb, /preload="auto"/);
});

test("Telegram range helper bounds retries and rejects incomplete byte ranges", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/services/telegram.ts", import.meta.url), "utf8");
  const rangeMethod = source.slice(source.indexOf("async downloadFileRange("), source.indexOf("async deleteMessage(", source.indexOf("async downloadFileRange(")));
  assert.match(rangeMethod, /attempt <= 3/);
  assert.match(rangeMethod, /iterDownload/);
  assert.match(rangeMethod, /workerCount = Math\.min\(8, chunkCount\)/);
  assert.match(rangeMethod, /Math\.floor\(start \/ requestSize\) \* requestSize/);
  assert.match(rangeMethod, /Promise\.all\(Array\.from\(\{ length: workerCount \}/);
  assert.match(rangeMethod, /RANGE_INCOMPLETE/);
  assert.match(rangeMethod, /refreshDocumentReference/);
});

test("mock benchmark reports expected 512 KiB chunk counts and bounded buffer estimates", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const scriptPath = fileURLToPath(new URL("../scripts/benchmark-video-ranges.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [scriptPath], { encoding: "utf8" });
  const report = JSON.parse(output);
  assert.equal(report.mode, "mock-only; no Telegram/Railway network");
  assert.deepEqual(report.results.map((item: { telegramChunks: number }) => item.telegramChunks), [2, 8, 16]);
  assert.deepEqual(report.results.map((item: { bytesFetched: number }) => item.bytesFetched), [1048576, 4194304, 8388608]);
  assert.deepEqual(report.results.map((item: { estimatedPeakBufferMiB: number }) => item.estimatedPeakBufferMiB), [2, 8, 16]);
  assert.ok(report.results.every((item: { bodyCorrect: boolean; retries: number }) => item.bodyCorrect && item.retries === 0));
});


test("video Range uses one bounded Telegram fetch per HTTP response", { timeout: 5000 }, async () => {
  const { createBoundedPartialResponse } = await import("../src/lib/bounded-range-response.ts");
  const maxRangeBytes = 4 * 1024 * 1024;
  const calls: Array<[number, number]> = [];
  const pending = createBoundedPartialResponse({
    range: { start: 512 * 1024, end: 16 * 1024 * 1024 - 1 },
    fileSize: 32 * 1024 * 1024,
    maxBytes: maxRangeBytes,
    headers: { "Content-Type": "video/mp4" },
    fetchRange: async (start, end) => {
      calls.push([start, end]);
      return { bytes: new Uint8Array(end - start + 1).fill(23) };
    },
  });
  const response = await pending;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls, [[512 * 1024, 512 * 1024 + maxRangeBytes - 1]]);
  assert.equal(response?.status, 206);
  assert.equal(response?.headers.get("Content-Range"), `bytes 524288-${524288 + maxRangeBytes - 1}/33554432`);
  assert.equal(response?.headers.get("Content-Length"), String(maxRangeBytes));
  assert.equal(response?.headers.get("Accept-Ranges"), "bytes");
  const body = await response!.arrayBuffer();
  assert.equal(body.byteLength, maxRangeBytes);
  assert.ok(new Uint8Array(body).every((byte) => byte === 23));
});

test("video Range near EOF returns a short final interval exactly", { timeout: 5000 }, async () => {
  const { createBoundedPartialResponse } = await import("../src/lib/bounded-range-response.ts");
  const fileSize = 1024 * 1024 + 123;
  const calls: Array<[number, number]> = [];
  const response = await createBoundedPartialResponse({
    range: { start: 1024 * 1024, end: fileSize - 1 },
    fileSize,
    maxBytes: 4 * 1024 * 1024,
    fetchRange: async (start, end) => {
      calls.push([start, end]);
      return { bytes: new Uint8Array(end - start + 1).fill(91) };
    },
  });
  assert.deepEqual(calls, [[1024 * 1024, fileSize - 1]]);
  assert.equal(response?.status, 206);
  assert.equal(response?.headers.get("Content-Range"), `bytes 1048576-${fileSize - 1}/${fileSize}`);
  assert.equal(response?.headers.get("Content-Length"), "123");
  const body = await response!.arrayBuffer();
  assert.equal(body.byteLength, 123);
  assert.ok(new Uint8Array(body).every((byte) => byte === 91));
});

test("mocked shared-video Range returns exactly the requested 1 MiB without full-file fetch", async () => {
  const { createBoundedPartialResponse } = await import("../src/lib/bounded-range-response.ts");
  const fileSize = 5 * 1024 * 1024;
  const expected = Buffer.alloc(1024 * 1024, 7);
  const calls: Array<[number, number]> = [];
  const response = await createBoundedPartialResponse({
    range: { start: 0, end: 1024 * 1024 - 1 },
    fileSize,
    maxBytes: 4 * 1024 * 1024,
    headers: { "Content-Type": "video/mp4", "Cache-Control": "private, no-store" },
    fetchRange: async (start, end) => {
      calls.push([start, end]);
      return { bytes: expected };
    },
  });
  assert.deepEqual(calls, [[0, 1024 * 1024 - 1]]);
  assert.equal(response?.status, 206);
  assert.equal(response?.headers.get("Content-Range"), "bytes 0-1048575/5242880");
  assert.equal(response?.headers.get("Content-Length"), "1048576");
  assert.equal(response?.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await response?.arrayBuffer())?.byteLength, 1024 * 1024);
});

test("mocked shared-video Range caps oversized requests and rejects short Telegram data", async () => {
  const { createBoundedPartialResponse } = await import("../src/lib/bounded-range-response.ts");
  const calls: Array<[number, number]> = [];
  const response = await createBoundedPartialResponse({
    range: { start: 0, end: 8 * 1024 * 1024 - 1 },
    fileSize: 16 * 1024 * 1024,
    maxBytes: 4 * 1024 * 1024,
    fetchRange: async (start, end) => {
      calls.push([start, end]);
      return { bytes: new Uint8Array(end - start + 1) };
    },
  });
  assert.deepEqual(calls, [[0, 4 * 1024 * 1024 - 1]]);
  assert.equal(response?.headers.get("Content-Range"), "bytes 0-4194303/16777216");
  await assert.rejects(() => createBoundedPartialResponse({
    range: { start: 0, end: 1023 },
    fileSize: 4096,
    maxBytes: 4096,
    fetchRange: async () => ({ bytes: new Uint8Array(100) }),
  }), /RANGE_INCOMPLETE/);
});
