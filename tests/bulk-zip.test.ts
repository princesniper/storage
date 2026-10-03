import test from "node:test";
import assert from "node:assert/strict";
import { createZipStream } from "../src/lib/zip.ts";

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

test("bulk ZIP preserves file content and emits a valid end record", async () => {
  const archive = await collect(createZipStream([
    { name: "photo.txt", getBytes: async () => Buffer.from("photo-content") },
    { name: "video.txt", getBytes: async () => Buffer.from("video-content") },
  ]));
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.ok(archive.includes(Buffer.from("photo-content")));
  assert.ok(archive.includes(Buffer.from("video-content")));
  assert.ok(archive.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));
});

test("bulk ZIP sanitizes traversal paths and uniquifies duplicate names", async () => {
  const archive = await collect(createZipStream([
    { name: "../../same.txt", getBytes: async () => Buffer.from("one") },
    { name: "same.txt", getBytes: async () => Buffer.from("two") },
  ]));
  assert.ok(archive.includes(Buffer.from("same.txt")));
  assert.ok(archive.toString("latin1").includes("same.txt (1)"), archive.toString("latin1").match(/same.{0,30}txt/g)?.join(" | "));
  assert.ok(!archive.includes(Buffer.from("../")));
});
