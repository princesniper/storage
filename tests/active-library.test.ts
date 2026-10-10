import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateVisibleFolderIds,
  withNonRemovedStorageChannel,
} from "../src/lib/active-library.ts";

test("removed-only folder subtrees and empty nested descendants are hidden", () => {
  const folders = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 2 },
    { id: 4, parentId: 3 }, // empty nested folder under a removed-only branch
    { id: 5, parentId: null },
    { id: 6, parentId: 5 },
    { id: 7, parentId: null }, // truly global empty root folder
  ];
  const associations = [
    { folderId: 3, channelStatus: "removed" },
    { folderId: 6, channelStatus: "active" },
  ];

  const visible = calculateVisibleFolderIds(folders, associations);
  assert.deepEqual([...visible].sort((a, b) => a - b), [5, 6, 7]);
});

test("shared parent remains visible if any descendant belongs to a non-removed channel", () => {
  const folders = [
    { id: 10, parentId: null },
    { id: 11, parentId: 10 },
    { id: 12, parentId: 10 },
    { id: 13, parentId: 12 }, // empty folder inherits the shared parent's scope
  ];
  const associations = [
    { folderId: 11, channelStatus: "removed" },
    { folderId: 12, channelStatus: "active" },
  ];

  const visible = calculateVisibleFolderIds(folders, associations);
  assert.deepEqual([...visible].sort((a, b) => a - b), [10, 12, 13]);
  assert.equal(visible.has(11), false);
});

test("deleted file mappings still scope a folder to its channel until records are purged", () => {
  const folders = [
    { id: 20, parentId: null },
    { id: 21, parentId: 20 },
  ];
  // The helper receives all File->channel relations regardless of File.status.
  const visible = calculateVisibleFolderIds(folders, [
    { folderId: 21, channelStatus: "inactive" },
  ]);
  assert.deepEqual([...visible].sort((a, b) => a - b), [20, 21]);
});

test("channel with zero files does not claim or hide global empty folders", () => {
  const folders = [
    { id: 30, parentId: null },
    { id: 31, parentId: 30 },
    { id: 32, parentId: null },
  ];
  const visible = calculateVisibleFolderIds(folders, []);
  assert.deepEqual([...visible].sort((a, b) => a - b), [30, 31, 32]);
});

test("cycles and orphaned associations cannot cause infinite traversal", () => {
  const folders = [
    { id: 40, parentId: 41 },
    { id: 41, parentId: 40 },
    { id: 42, parentId: 999 },
  ];
  const visible = calculateVisibleFolderIds(folders, [
    { folderId: 40, channelStatus: "removed" },
  ]);
  assert.equal(visible.has(40), false);
  assert.equal(visible.has(41), false);
  assert.equal(visible.has(42), true);
});

test("file query helper combines caller filters with the non-removed channel predicate", () => {
  const where = withNonRemovedStorageChannel({
    status: "active",
    originalName: { contains: "photo" },
  });
  assert.deepEqual(where, {
    AND: [
      { status: "active", originalName: { contains: "photo" } },
      { storageChannel: { is: { status: { not: "removed" } } } },
    ],
  });
});
