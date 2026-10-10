import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeDatabaseTarget } from "../src/lib/database-safety.ts";

test("allows loopback PostgreSQL for local development and smoke tests", () => {
  assert.doesNotThrow(() =>
    assertSafeDatabaseTarget("postgresql://postgres:postgres@localhost:5432/growplants", { NODE_ENV: "development" }),
  );
  assert.doesNotThrow(() =>
    assertSafeDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:5432/growplants", { NODE_ENV: "production" }),
  );
  assert.doesNotThrow(() =>
    assertSafeDatabaseTarget("postgresql://postgres:postgres@[::1]:5432/growplants", { NODE_ENV: "test" }),
  );
});

test("blocks remote production database from development", () => {
  assert.throws(
    () => assertSafeDatabaseTarget("postgresql://user:pass@altaria.proxy.rlwy.net:36941/railway", { NODE_ENV: "development" }),
    /Blocked remote DATABASE_URL/,
  );
  assert.throws(
    () => assertSafeDatabaseTarget("postgresql://user:pass@example.com:5432/growplants", { NODE_ENV: "test" }),
    /Blocked remote DATABASE_URL/,
  );
});

test("blocks remote database even when NODE_ENV=production locally", () => {
  assert.throws(
    () => assertSafeDatabaseTarget("postgresql://user:pass@altaria.proxy.rlwy.net:36941/railway", { NODE_ENV: "production" }),
    /Blocked remote DATABASE_URL/,
  );
});

test("allows configured remote database only on known production platforms", () => {
  const url = "postgresql://user:pass@db.example.com:5432/growplants";
  assert.doesNotThrow(() =>
    assertSafeDatabaseTarget(url, { NODE_ENV: "production", RAILWAY_ENVIRONMENT: "production" }),
  );
  assert.doesNotThrow(() =>
    assertSafeDatabaseTarget(url, { NODE_ENV: "production", FLY_APP_NAME: "growplants-media" }),
  );
  assert.throws(
    () => assertSafeDatabaseTarget(url, { NODE_ENV: "development", RAILWAY_ENVIRONMENT: "production" }),
    /Blocked remote DATABASE_URL/,
  );
});

test("fails closed for missing or malformed database URLs", () => {
  assert.throws(() => assertSafeDatabaseTarget(undefined, { NODE_ENV: "development" }), /DATABASE_URL is required/);
  assert.throws(() => assertSafeDatabaseTarget("not-a-url", { NODE_ENV: "development" }), /valid PostgreSQL URL/);
});
