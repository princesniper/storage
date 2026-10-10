import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const channelListRoute = read("src/app/api/channels/route.ts");
const channelItemRoute = read("src/app/api/channels/[id]/route.ts");
const filesRoute = read("src/app/api/files/route.ts");
const selectionIdsRoute = read("src/app/api/files/selection-ids/route.ts");
const bulkDownloadRoute = read("src/app/api/files/bulk-download/route.ts");
const fileItemRoute = read("src/app/api/files/[id]/route.ts");
const foldersRoute = read("src/app/api/folders/route.ts");
const folderItemRoute = read("src/app/api/folders/[id]/route.ts");
const folderBulkDownloadRoute = read("src/app/api/folders/bulk-download/route.ts");
const folderItemDownloadRoute = read("src/app/api/folders/[id]/download/route.ts");
const analyticsRoute = read("src/app/api/analytics/overview/route.ts");
const sharedMedia = read("src/lib/shared-media.ts");
const sharedFolderRoute = read("src/app/api/shared/folders/[token]/route.ts");
const sharedFolderDownloadRoute = read("src/app/api/shared/folders/[token]/download/route.ts");
const channelUi = read("src/components/channels/channels-client.tsx");
const schema = read("prisma/schema.prisma");
const telegramService = read("src/services/telegram.ts");

test("remove soft-marks and hides the channel without deleting any stored records", () => {
  assert.match(channelItemRoute, /status:\s*"removed"/);
  assert.match(channelItemRoute, /action:\s*"SOFT_REMOVE"/);
  assert.match(channelItemRoute, /dataPreserved:\s*true/);
  assert.doesNotMatch(channelItemRoute, /db\.storageChannel\.delete\(/);
  assert.match(channelListRoute, /where:\s*\{\s*status:\s*\{\s*not:\s*"removed"\s*\}\s*\}/);
  assert.match(channelItemRoute, /invalidateAnalyticsCache\(\)/);
  assert.match(channelListRoute, /invalidateAnalyticsCache\(\)/);
});

test("reconnect reuses the unique existing channel row only after Telegram access verification", () => {
  assert.match(schema, /telegramChannelId\s+String\s+@unique/);
  assert.match(channelListRoute, /telegramService\.testChannel\(parsed\.destinationId\)/);
  assert.match(channelListRoute, /db\.storageChannel\.upsert\(/);
  assert.match(channelListRoute, /where:\s*\{\s*telegramChannelId:\s*parsed\.destinationId\s*\}/);
  assert.match(channelListRoute, /status:\s*"active"/);
  assert.match(channelListRoute, /restoredExistingData:\s*Boolean\(existing\)/);
  assert.doesNotMatch(channelListRoute, /db\.file\.create\(/);
  assert.doesNotMatch(channelListRoute, /db\.folder\.create\(/);
});

test("active Files results, search totals, selection IDs and downloads exclude removed-channel files", () => {
  assert.match(filesRoute, /withNonRemovedStorageChannel\(\{\}\)/);
  assert.match(filesRoute, /db\.file\.count\(\{\s*where\s*\}\)/);
  assert.match(selectionIdsRoute, /withNonRemovedStorageChannel\(\{\}\)/);
  assert.match(bulkDownloadRoute, /withNonRemovedStorageChannel\(\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*status:\s*"active"\s*\}\)/);
  assert.match(fileItemRoute, /withNonRemovedStorageChannel/);
});

test("folder navigation/counts and folder downloads use relationship-derived visible folder IDs", () => {
  assert.match(foldersRoute, /getVisibleFolderIds\(db\)/);
  assert.match(foldersRoute, /id:\s*\{\s*in:\s*\[\.\.\.visibleIds\]\s*\}/);
  assert.match(foldersRoute, /storageChannel:\s*\{\s*is:\s*\{\s*status:\s*\{\s*not:\s*"removed"\s*\}/);
  assert.match(folderItemRoute, /getVisibleFolderIds\(db\)/);
  assert.match(folderItemRoute, /FOLDER_HAS_REMOVED_CHANNEL_DATA/);
  assert.match(folderBulkDownloadRoute, /getVisibleFolderIds\(db\)/);
  assert.match(folderBulkDownloadRoute, /withNonRemovedStorageChannel/);
  assert.match(folderItemDownloadRoute, /getVisibleFolderIds\(db\)/);
  assert.match(folderItemDownloadRoute, /withNonRemovedStorageChannel/);
});

test("channel UI refreshes files and folders after removal and reconnect", () => {
  assert.match(channelUi, /qc\.invalidateQueries\(\{\s*queryKey:\s*\["files"\]\s*\}\)/);
  assert.match(channelUi, /qc\.invalidateQueries\(\{\s*queryKey:\s*\["folders"\]\s*\}\)/);
  assert.match(channelUi, /qc\.invalidateQueries\(\{\s*queryKey:\s*\["destinations"\]\s*\}\)/);
});

test("channel authorization check is read-only and never posts a temporary test message", () => {
  const start = telegramService.indexOf("async testChannel(");
  const end = telegramService.indexOf("private getFloodWaitSeconds", start);
  assert.ok(start >= 0 && end > start, "testChannel method must be found");
  const body = telegramService.slice(start, end);
  assert.match(body, /getMessages\(peer,\s*\{\s*limit:\s*1\s*\}\)/);
  assert.doesNotMatch(body, /sendMessage|deleteMessages/);
});

test("analytics and preserved share links exclude removed-channel files and refresh on reconnect", () => {
  assert.match(analyticsRoute, /withNonRemovedStorageChannel/);
  assert.match(analyticsRoute, /getCachedAnalytics/);
  assert.match(analyticsRoute, /setCachedAnalytics/);
  assert.match(sharedMedia, /withNonRemovedStorageChannel\(\{\s*id:\s*fileId,\s*status:\s*"active"\s*\}\)/);
  assert.match(sharedFolderRoute, /getVisibleFolderIds\(db\)/);
  assert.match(sharedFolderRoute, /withNonRemovedStorageChannel/);
  assert.match(sharedFolderDownloadRoute, /getVisibleFolderIds\(db\)/);
  assert.match(sharedFolderDownloadRoute, /withNonRemovedStorageChannel/);
});
