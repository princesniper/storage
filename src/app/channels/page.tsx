import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/shell";
import ChannelsClient from "@/components/channels/channels-client";

export default async function ChannelsPage() {
  await getServerSession(authOptions);
  return (
    <DashboardShell>
      <ChannelsClient />
    </DashboardShell>
  );
}
