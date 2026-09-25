import FoldersClient from "@/components/folders/folders-client";
import { DashboardShell } from "@/components/dashboard/shell";

export default function FoldersPage() {
  return <DashboardShell><FoldersClient /></DashboardShell>;
}
