import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/shell";
import FilesClient from "@/components/files/files-client";
import { FileGridSkeleton } from "@/components/ui/skeletons";

export default async function FilesPage() {
  await getServerSession(authOptions);
  return (
    <DashboardShell>
      <Suspense fallback={<FileGridSkeleton />}>
        <FilesClient />
      </Suspense>
    </DashboardShell>
  );
}
