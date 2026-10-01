import test from "node:test";
import assert from "node:assert/strict";
import { sortByMetadata, FOLDER_SORT_OPTIONS } from "../src/lib/folder-sorting.ts";

const folders = [
  { id: 4, name: "beta", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-04T00:00:00Z" },
  { id: 2, name: "Alpha", createdAt: "2024-01-03T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z" },
  { id: 3, name: "alpha", createdAt: "2024-01-02T00:00:00Z", updatedAt: "2024-01-03T00:00:00Z" },
  { id: 1, name: "Folder 10", createdAt: null, updatedAt: null },
  { id: 5, name: "Folder 2", createdAt: null, updatedAt: null },
];

test("provides all supported sort choices", () => {
  assert.equal(FOLDER_SORT_OPTIONS.length, 8);
});

test("sorts names case-insensitively with deterministic numeric ordering", () => {
  assert.deepEqual(sortByMetadata(folders, "name:asc").map((folder) => folder.id), [2, 3, 4, 5, 1]);
  assert.deepEqual(sortByMetadata(folders, "name:desc").map((folder) => folder.id), [1, 5, 4, 2, 3]);
});

test("sorts creation timestamps in both directions and puts missing dates last", () => {
  assert.deepEqual(sortByMetadata(folders, "created:desc").map((folder) => folder.id), [2, 3, 4, 1, 5]);
  assert.deepEqual(sortByMetadata(folders, "created:asc").map((folder) => folder.id), [4, 3, 2, 1, 5]);
});

test("sorts modification timestamps using updatedAt and stable id tie-breaks", () => {
  assert.deepEqual(sortByMetadata(folders, "modified:desc").map((folder) => folder.id), [4, 3, 2, 1, 5]);
  assert.deepEqual(sortByMetadata(folders, "modified:asc").map((folder) => folder.id), [2, 3, 4, 1, 5]);
});

test("does not mutate the source array", () => {
  const original = [...folders];
  sortByMetadata(folders, "name:desc");
  assert.deepEqual(folders, original);
});

test("sorts by size in both directions", () => {
  const sized = [{ id: 1, name: "A", size: 200 }, { id: 2, name: "B", size: 50 }, { id: 3, name: "C", size: 100 }];
  assert.deepEqual(sortByMetadata(sized, "size:desc").map((item) => item.id), [1, 3, 2]);
  assert.deepEqual(sortByMetadata(sized, "size:asc").map((item) => item.id), [2, 3, 1]);
});
