import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard/shell";
import FoldersClient from "@/components/folders/folders-client";

function FoldersFallback() {
  return <div className="p-6 text-sm text-muted-foreground">Loading storage…</div>;
}

export default function FoldersPage() {
  return (
    <DashboardShell>
      <Suspense fallback={<FoldersFallback />}>
        <FoldersClient />
      </Suspense>
    </DashboardShell>
  );
}
