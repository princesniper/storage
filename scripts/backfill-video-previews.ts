import { runVideoThumbnailBackfill } from "../src/lib/video-thumbnail";

const args = process.argv.slice(2);
const valueAfter = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const limit = Number(valueAfter("--limit") ?? "Infinity");
const concurrency = Number(valueAfter("--concurrency") ?? "1");
const dryRun = args.includes("--dry-run");

console.log("Video Preview Backfill");
console.log(`Limit: ${Number.isFinite(limit) ? limit : "all"} | Concurrency: ${Math.max(1, Math.min(2, concurrency))} | Dry run: ${dryRun}`);

const result = await runVideoThumbnailBackfill({
  limit: Number.isFinite(limit) ? limit : undefined,
  concurrency,
  dryRun,
});

if (typeof result === "number") {
  console.log(`Eligible videos: ${result}`);
} else {
  console.log(`Processed: ${result.processed}`);
  console.log(`Success: ${result.success}`);
  console.log(`Failed: ${result.failed}`);
}
