import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const { getClientIp } = await import("../src/lib/client-ip.ts");

test("CSP is report-only and does not enforce a new blocking policy", async () => {
  const source = await readFile(path.join(process.cwd(), "src/middleware.ts"), "utf8");
  assert.match(source, /Content-Security-Policy-Report-Only/);
  assert.doesNotMatch(source, /headers\.set\(\s*["']Content-Security-Policy["']/);
});

test("Dockerfile does not accept production credentials as build arguments", async () => {
  const source = await readFile(path.join(process.cwd(), "Dockerfile"), "utf8");
  assert.doesNotMatch(source, /^ARG\s+(DATABASE_URL|AUTH_SECRET|ADMIN_EMAIL|ADMIN_PASSWORD)\s*$/m);
  assert.match(source, /build-placeholder@example\.invalid/);
});

test("resumable upload sessions have expiry cleanup and endpoint rate limits", async () => {
  const source = await readFile(path.join(process.cwd(), "src/lib/resumable-upload.ts"), "utf8");
  assert.match(source, /UPLOAD_SESSION_TTL_MS/);
  assert.match(source, /cleanupExpiredUploads/);
  for (const route of ["session", "chunk", "complete"]) {
    const routeSource = await readFile(path.join(process.cwd(), `src/app/api/uploads/${route}/route.ts`), "utf8");
    assert.match(routeSource, /rateLimitAsync/);
  }
});

test("client IP helper selects the first forwarded address and bounds input", () => {
  assert.equal(getClientIp(new Headers({ "x-forwarded-for": " 203.0.113.4, 10.0.0.2" })), "203.0.113.4");
  assert.equal(getClientIp(new Headers({ "x-real-ip": "198.51.100.8" })), "198.51.100.8");
  assert.equal(getClientIp(new Headers()), "unknown");
  assert.equal(getClientIp(new Headers({ "x-real-ip": "x".repeat(200) })).length, 128);
});
