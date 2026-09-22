import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard/shell";
import AuditClient from "@/components/audit/audit-client";

export default async function AuditPage() {
  await getServerSession(authOptions);

  const [logs, total] = await Promise.all([
    db.uploadLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        admin: { select: { email: true } },
        file: { select: { id: true, publicId: true, originalName: true } },
      },
    }),
    db.uploadLog.count(),
  ]);

  return (
    <DashboardShell>
      <AuditClient
        initialLogs={logs.map((l) => ({
          id: l.id,
          operation: l.operation,
          status: l.status,
          errorMessage: l.errorMessage,
          ip: l.ip,
          createdAt: l.createdAt.toISOString(),
          adminEmail: l.admin?.email ?? null,
          file: l.file
            ? { id: l.file.id, publicId: l.file.publicId, originalName: l.file.originalName }
            : null,
        }))}
        initialTotal={total}
      />
    </DashboardShell>
  );
}
