import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getFacilityDashboardData } from "@/lib/procureflow/facility-data";
import { getProcurementDashboardData } from "@/lib/procureflow/procurement-data";
import { getApproverDashboardData } from "@/lib/procureflow/approver-data";
import { getSecurityMigrationStatus } from "@/lib/procureflow/security-check";

export default async function ProcureFlowApp() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [facilityData, procurementData, approverData, securityStatus] = await Promise.all([
    user.role === "Facility Manager"
      ? getFacilityDashboardData(user.id)
      : Promise.resolve(undefined),
    user.role === "Procurement Manager"
      ? getProcurementDashboardData(user.id)
      : Promise.resolve(undefined),
    user.role === "Approver"
      ? getApproverDashboardData(user.id)
      : Promise.resolve(undefined),
    getSecurityMigrationStatus(),
  ]);

  return (
    <AppShell
      user={user}
      facilityData={facilityData}
      procurementData={procurementData}
      approverData={approverData}
      securityStatus={securityStatus}
    />
  );
}
