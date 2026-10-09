export interface BoundedByteRange {
  start: number;
  end: number;
}

export interface RangeBytesResult {
  bytes: Uint8Array;
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
