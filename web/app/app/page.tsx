import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CompleteRoleShell } from "@/components/complete-role-shell";
import { ForcedPasswordChangeScreen } from "@/components/settings-workspace";
import { getFacilityDashboardData } from "@/lib/procureflow/facility-data";
import { getProcurementDashboardData } from "@/lib/procureflow/procurement-data";
import { getApproverDashboardData } from "@/lib/procureflow/approver-data";
import { getFinanceDashboardData } from "@/lib/procureflow/finance-data";
import { getLogisticsDashboardData } from "@/lib/procureflow/logistics-data";
import { getLogisticsPOItems } from "@/lib/procureflow/logistics-items";
import { getAuditorDashboardData } from "@/lib/procureflow/auditor-data";
import { getAdminDashboardData } from "@/lib/procureflow/admin-data";
import { getSecurityMigrationStatus } from "@/lib/procureflow/security-check";
import { getParityData } from "@/lib/procureflow/parity-data";

export default async function ProcureFlowApp() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  if (user.mustChangePassword) {
    return <ForcedPasswordChangeScreen username={user.username} fullName={user.fullName} role={user.role} />;
  }

  const [facilityData, procurementData, approverData, financeData, logisticsData, logisticsItems, adminData, auditorData, securityStatus, parityData] = await Promise.all([
    user.role === "Facility Manager" ? getFacilityDashboardData(user.id) : Promise.resolve(undefined),
    user.role === "Procurement Manager" ? getProcurementDashboardData(user.id) : Promise.resolve(undefined),
    user.role === "Approver" ? getApproverDashboardData(user.id) : Promise.resolve(undefined),
    user.role === "Finance" ? getFinanceDashboardData() : Promise.resolve(undefined),
    user.role === "Logistics Officer" ? getLogisticsDashboardData() : Promise.resolve(undefined),
    user.role === "Logistics Officer" ? getLogisticsPOItems() : Promise.resolve([]),
    user.role === "Admin" ? getAdminDashboardData() : Promise.resolve(undefined),
    user.role === "Auditor" ? getAuditorDashboardData() : Promise.resolve(undefined),
    getSecurityMigrationStatus(),
    getParityData(user),
  ]);

  return (
    <CompleteRoleShell
      user={{ id: user.id, fullName: user.fullName, username: user.username, role: user.role }}
      facilityData={facilityData}
      procurementData={procurementData}
      approverData={approverData}
      financeData={financeData}
      logisticsData={logisticsData}
      logisticsItems={logisticsItems}
      adminData={adminData}
      auditorData={auditorData}
      securityStatus={securityStatus}
      parityData={parityData}
    />
  );
}
