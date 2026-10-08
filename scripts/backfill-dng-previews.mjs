import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const rawExtensions = ["cr2","cr3","nef","nrw","arw","srf","sr2","dng","raf","rw2","orf","orf2","pef","ptx","srw","x3f","iiq","3fr","mos","mef","mrw","erf","kdc","dcr","raw"];
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((v) => v.startsWith("--limit="));
const batchArg = process.argv.find((v) => v.startsWith("--batch="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 1000) : 1000;
const batch = batchArg ? Math.max(1, Math.min(100, Number(batchArg.split("=")[1]) || 25)) : 25;

let processed = 0;
try {
  while (processed < limit) {
    const rows = await db.file.findMany({
      where: {
        status: "active",
        extension: { in: rawExtensions },
        OR: [
          { previewStatus: "none" },
          { previewStatus: "failed" },
        ],
      },
      orderBy: { id: "asc" },
      take: Math.min(batch, limit - processed),
      select: { id: true, originalName: true, mimeType: true },
    });
    if (!rows.length) break;

    if (dryRun) {
      for (const row of rows) console.log(`[DNG_BACKFILL] would queue id=${row.id} name=${JSON.stringify(row.originalName)} mime=${row.mimeType}`);
    } else {
      const result = await db.file.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, status: "active", OR: [{ previewStatus: "none" }, { previewStatus: "failed" }] },
        data: { previewStatus: "pending", previewError: null },
      });
      console.log(`[DNG_BACKFILL] queued=${result.count} batch=${rows.length}`);
    }
    processed += rows.length;
    if (rows.length < batch) break;
  }
  console.log(`[DNG_BACKFILL] ${dryRun ? "dry-run" : "complete"} processed=${processed}`);
} finally {
  await db.$disconnect();
}
