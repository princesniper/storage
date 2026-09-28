import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { telegramService } from "@/services/telegram";
import { DashboardShell } from "@/components/dashboard/shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SettingsClient from "@/components/settings/settings-client";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  await telegramService.ensureStarted();
  const tg = await db.telegramAccount.findFirst();
  const tgStatus = telegramService.getStatus();
  const tgError = telegramService.getLastError();

  return (
    <DashboardShell>
      <SettingsClient
        adminEmail={session?.user?.email ?? ""}
        storageStatus={tgStatus}
        storageError={tgError ?? undefined}
        phoneReference={tg?.phoneReference ?? undefined}
        lastConnectedAt={tg?.lastConnectedAt?.toISOString() ?? undefined}
      />
    </DashboardShell>
  );
}
