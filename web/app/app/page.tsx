import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getFacilityDashboardData } from "@/lib/procureflow/facility-data";
import { getSecurityMigrationStatus } from "@/lib/procureflow/security-check";

export default async function ProcureFlowApp() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [facilityData, securityStatus] = await Promise.all([
    user.role === "Facility Manager"
      ? getFacilityDashboardData(user.id)
      : Promise.resolve(undefined),
    getSecurityMigrationStatus(),
  ]);

  return <AppShell user={user} facilityData={facilityData} securityStatus={securityStatus} />;
}
