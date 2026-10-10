/**
 * Resolve a client address for rate limiting.
 *
 * IMPORTANT: X-Forwarded-For is trustworthy only when the hosting proxy strips
 * client-supplied forwarding headers and writes its own value. Verify this in
 * the active hosting platform before relying on per-IP limits at the edge.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",", 1)[0]?.trim();
  const candidate = firstForwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return candidate.slice(0, 128) || "unknown";
}
