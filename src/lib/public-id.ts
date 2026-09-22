/**
 * Cryptographically secure random publicId generator.
 * Format: "gp_" + 12 URL-safe base62 chars.
 *
 * 62^12 ≈ 3.2 × 10^21 — unguessable, non-sequential.
 */
import { randomBytes } from "crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function encodeBase62(buf: Buffer, length: number): string {
  let num = 0n;
  for (const b of buf) num = (num << 8n) | BigInt(b);
  let s = "";
  while (s.length < length) {
    s = ALPHABET[Number(num % 62n)] + s;
    num = num / 62n;
  }
  return s;
}

export function generatePublicId(): string {
  // 9 random bytes → 12 base62 chars (9 bytes = 72 bits → 2^72 ≈ 4.7 × 10^21 > 62^12)
  const buf = randomBytes(9);
  return `gp_${encodeBase62(buf, 12)}`;
}
