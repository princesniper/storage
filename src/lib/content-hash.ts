import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Hash bytes already held by the existing small-upload pipeline. */
export function sha256Buffer(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash a disk-backed upload incrementally; memory stays bounded by stream buffers. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
