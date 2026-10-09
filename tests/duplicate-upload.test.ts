import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Buffer, sha256File } from "../src/lib/content-hash.ts";

test("content hashes are independent of filenames and distinguish different bytes", () => {
  const photo = Buffer.from("same photo content");
  assert.equal(sha256Buffer(photo), sha256Buffer(Buffer.from(photo)));
  assert.notEqual(sha256Buffer(photo), sha256Buffer(Buffer.from("other photo content")));
  assert.equal(Buffer.byteLength("abcd"), Buffer.byteLength("wxyz"));
  assert.notEqual(sha256Buffer(Buffer.from("abcd")), sha256Buffer(Buffer.from("wxyz")));
});

test("disk-backed hashing matches buffer hashing without reading the whole file into one Buffer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "growplants-hash-test-"));
  try {
    const path = join(directory, "large-video.bin");
    const chunk = Buffer.alloc(1024 * 1024, 37);
    const bytes = Buffer.concat(Array.from({ length: 8 }, () => chunk));
    await writeFile(path, bytes);
    assert.equal(await sha256File(path), sha256Buffer(bytes));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upload routes reserve SHA-256 before Telegram transfer and persist hashes", async () => {
  const fs = await import("node:fs/promises");
  const route = await fs.readFile(new URL("../src/app/api/files/route.ts", import.meta.url), "utf8");
  const resumable = await fs.readFile(new URL("../src/app/api/uploads/complete/route.ts", import.meta.url), "utf8");
  const directReservation = route.indexOf("reserveUploadHash(sha256, reservationId)");
  const directTelegramUpload = route.indexOf("telegramService.uploadFile(");
  assert.ok(directReservation >= 0 && directReservation < directTelegramUpload);
  assert.match(route, /sha256,/);
  assert.match(route, /tx\.uploadReservation\.deleteMany/);
  const resumableHash = resumable.indexOf("await sha256File(assembled)");
  const resumableReservation = resumable.indexOf("reserveUploadHash(sha256, uploadId)");
  const resumableTelegramUpload = resumable.indexOf("telegramService.uploadFileFromPath(");
  assert.ok(resumableHash >= 0 && resumableHash < resumableReservation);
  assert.ok(resumableReservation < resumableTelegramUpload);
  assert.match(resumable, /sha256,/);
  assert.match(resumable, /releaseUploadReservation\(uploadId\)/);
});

test("reservation migration provides a database uniqueness boundary for concurrent requests", async () => {
  const fs = await import("node:fs/promises");
  const schema = await fs.readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await fs.readFile(new URL("../prisma/migrations/20261009100000_upload_dedup_reservations/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /model UploadReservation\s*\{[\s\S]*?sha256\s+String\s+@id/);
  assert.match(migration, /PRIMARY KEY \("sha256"\)/);
  assert.match(migration, /UNIQUE INDEX "UploadReservation_uploadId_key"/);
});

test("upload UI treats server-confirmed duplicates as skipped rather than failed or 100% uploaded", async () => {
  const fs = await import("node:fs/promises");
  const upload = await fs.readFile(new URL("../src/components/upload/upload-client.tsx", import.meta.url), "utf8");
  const client = await fs.readFile(new URL("../src/lib/client/resumable-upload.ts", import.meta.url), "utf8");
  assert.match(upload, /status: "skipped", progress: 0/);
  assert.match(upload, /duplicates skipped/);
  assert.match(upload, /i\.status === "skipped"/);
  assert.match(client, /state\.stage === "duplicate"/);
});

test("sign-out uses a confirmation dialog and the move picker renders an accessible root folder tree", async () => {
  const fs = await import("node:fs/promises");
  const shell = await fs.readFile(new URL("../src/components/dashboard/shell.tsx", import.meta.url), "utf8");
  const picker = await fs.readFile(new URL("../src/components/files/bulk-file-actions.tsx", import.meta.url), "utf8");
  assert.match(shell, /<AlertDialog open=\{signOutOpen\}/);
  assert.match(shell, /Sign out\?/);
  assert.doesNotMatch(shell, /onClick=\{handleSignOut\}/);
  assert.match(picker, /role="tree"/);
  assert.match(picker, /\/ \(Root\)/);
  assert.match(picker, /role="treeitem"/);
  assert.match(picker, /ArrowRight/);
});
