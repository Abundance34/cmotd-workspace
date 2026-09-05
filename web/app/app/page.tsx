import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { LogisticsShell } from "@/components/logistics-shell";
import { AuditorShell } from "@/components/auditor-shell";
import { getFacilityDashboardData } from "@/lib/procureflow/facility-data";
import { getProcurementDashboardData } from "@/lib/procureflow/procurement-data";
import { getApproverDashboardData } from "@/lib/procureflow/approver-data";
import { getFinanceDashboardData } from "@/lib/procureflow/finance-data";
import { getLogisticsDashboardData } from "@/lib/procureflow/logistics-data";
import { getLogisticsPOItems } from "@/lib/procureflow/logistics-items";
import { getAuditorDashboardData } from "@/lib/procureflow/auditor-data";
import { getSecurityMigrationStatus } from "@/lib/procureflow/security-check";

export default async function ProcureFlowApp() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  if (user.role === "Logistics Officer") {
    const [logisticsData, logisticsItems, securityStatus] = await Promise.all([
      getLogisticsDashboardData(),
      getLogisticsPOItems(),
      getSecurityMigrationStatus(),
    ]);
    return (
      <LogisticsShell
        user={{ id: user.id, fullName: user.fullName, username: user.username, role: "Logistics Officer" }}
        data={logisticsData}
        items={logisticsItems}
        securityStatus={securityStatus}
      />
    );
  }

  if (user.role === "Auditor") {
    const [auditorData, securityStatus] = await Promise.all([
      getAuditorDashboardData(),
      getSecurityMigrationStatus(),
    ]);
    return (
      <AuditorShell
        user={{ id: user.id, fullName: user.fullName, username: user.username, role: "Auditor" }}
        data={auditorData}
        securityStatus={securityStatus}
      />
    );
  }

  const [facilityData, procurementData, approverData, financeData, securityStatus] = await Promise.all([
    user.role === "Facility Manager"
      ? getFacilityDashboardData(user.id)
      : Promise.resolve(undefined),
    user.role === "Procurement Manager"
      ? getProcurementDashboardData(user.id)
      : Promise.resolve(undefined),
    user.role === "Approver"
      ? getApproverDashboardData(user.id)
      : Promise.resolve(undefined),
    user.role === "Finance"
      ? getFinanceDashboardData()
      : Promise.resolve(undefined),
    getSecurityMigrationStatus(),
  ]);

  return (
    <AppShell
      user={user}
      facilityData={facilityData}
      procurementData={procurementData}
      approverData={approverData}
      financeData={financeData}
      securityStatus={securityStatus}
    />
  );
}
