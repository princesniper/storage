import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/shell";
import UploadClient from "@/components/upload/upload-client";

export default async function UploadPage() {
  await getServerSession(authOptions);
  return (
    <DashboardShell>
      <UploadClient />
    </DashboardShell>
  );
}
