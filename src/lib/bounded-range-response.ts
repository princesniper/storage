export interface BoundedByteRange {
  start: number;
  end: number;
}

export interface RangeBytesResult {
  bytes: Uint8Array;
}

/**
 * Streams a bounded HTTP byte range to the client as each Telegram-sized
 * segment arrives. Avoids waiting for an entire multi-megabyte Range response
 * to be buffered before the browser receives its first bytes.
 */
export function createStreamingPartialResponse(options: {
  range: BoundedByteRange;
  fileSize: number;
  maxBytes: number;
  chunkBytes: number;
  fetchRange: (start: number, end: number) => Promise<RangeBytesResult | null>;
  headers?: HeadersInit;
}): Response {
  const { range, fileSize, maxBytes, chunkBytes, fetchRange } = options;
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error("INVALID_RANGE_CONFIGURATION");
  }
  const end = Math.min(range.end, range.start + maxBytes - 1, fileSize - 1);
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      range.start < 0 || range.start >= fileSize || end < range.start) {
    throw new Error("INVALID_RANGE");
  }

  let offset = range.start;
  const headers = new Headers(options.headers);
  headers.set("Content-Length", String(end - range.start + 1));
  headers.set("Content-Range", "bytes " + range.start + "-" + end + "/" + fileSize);
  headers.set("Accept-Ranges", "bytes");

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset > end) {
        controller.close();
        return;
      }
      // Stop at the next chunk boundary so subsequent requests can fetch
      // aligned Telegram chunks without repeatedly downloading overlapping data.
      const segmentEnd = Math.min(end, (Math.floor(offset / chunkBytes) + 1) * chunkBytes - 1);
      const result = await fetchRange(offset, segmentEnd);
      if (!result) {
        controller.error(new Error("RANGE_STORAGE_UNAVAILABLE"));
        return;
      }
      const expectedLength = segmentEnd - offset + 1;
      if (result.bytes.length !== expectedLength) {
        controller.error(new Error("RANGE_INCOMPLETE:" + result.bytes.length + "/" + expectedLength));
        return;
      }
      controller.enqueue(new Uint8Array(result.bytes));
      offset = segmentEnd + 1;
    },
  });

  return new Response(body, { status: 206, headers });
}

/**
 * Builds a correct single-range response while ensuring the backing store is
 * only asked for the capped interval. The fetcher is injected for deterministic
 * tests and must return exactly the requested byte count.
 */
export async function createBoundedPartialResponse(options: {
  range: BoundedByteRange;
  fileSize: number;
  maxBytes: number;
  fetchRange: (start: number, end: number) => Promise<RangeBytesResult | null>;
  headers?: HeadersInit;
}): Promise<Response | null> {
  const { range, fileSize, maxBytes, fetchRange } = options;
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("INVALID_RANGE_CONFIGURATION");
  }
  const end = Math.min(range.end, range.start + maxBytes - 1, fileSize - 1);
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.start >= fileSize || end < range.start) {
    throw new Error("INVALID_RANGE");
  }

  const result = await fetchRange(range.start, end);
  if (!result) return null;
  const expectedLength = end - range.start + 1;
  if (result.bytes.length !== expectedLength) {
    throw new Error("RANGE_INCOMPLETE:" + result.bytes.length + "/" + expectedLength);
  }

  const headers = new Headers(options.headers);
  headers.set("Content-Length", String(expectedLength));
  headers.set("Content-Range", "bytes " + range.start + "-" + end + "/" + fileSize);
  headers.set("Accept-Ranges", "bytes");
  return new Response(new Uint8Array(result.bytes), { status: 206, headers });
}
