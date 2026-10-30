import {notFound,redirect} from "next/navigation";
import {getCurrentUser} from "@/lib/auth";
import {getMirrorTarget} from "@/lib/procureflow/admin-workspace-mirror";
import {getFacilityDashboardData} from "@/lib/procureflow/facility-data";
import {getProcurementDashboardData} from "@/lib/procureflow/procurement-data";
import {getApproverDashboardData} from "@/lib/procureflow/approver-data";
import {getFinanceDashboardData} from "@/lib/procureflow/finance-data";
import {getLogisticsDashboardData} from "@/lib/procureflow/logistics-data";
import {getAuditorReviewDashboardData} from "@/lib/procureflow/auditor-review-data";
import {getSecurityMigrationStatus} from "@/lib/procureflow/security-check";
import {getParityData} from "@/lib/procureflow/parity-data";
import {AdminWorkspaceMirrorView} from "@/components/admin-workspace-mirror-view";
export const dynamic="force-dynamic";
export default async function ReadOnlyEmployeeDashboard({params}:{params:Promise<{viewId:string}>}){
 const admin=await getCurrentUser();
 if(!admin)redirect("/");
 if(admin.role!=="Admin"||admin.mustChangePassword)notFound();
 let target;
 try{target=await getMirrorTarget(admin,(await params).viewId);}catch{notFound();}
 const [facilityData,procurementData,approverData,financeData,logisticsData,auditorData,securityStatus,parityData]=await Promise.all([
  target.role==="Facility Manager"||target.role==="ICT"?getFacilityDashboardData(target.id):Promise.resolve(undefined),
  target.role==="Procurement Manager"?getProcurementDashboardData(target.id):Promise.resolve(undefined),
  target.role==="Approver"?getApproverDashboardData(target.id):Promise.resolve(undefined),
  target.role==="Finance"?getFinanceDashboardData():Promise.resolve(undefined),
  target.role==="Logistics Officer"?getLogisticsDashboardData():Promise.resolve(undefined),
  target.role==="Auditor"?getAuditorReviewDashboardData():Promise.resolve(undefined),
  getSecurityMigrationStatus(),
  getParityData(target)
 ]);
 return <AdminWorkspaceMirrorView target={{id:target.id,fullName:target.fullName,username:target.username,role:target.role}} facilityData={facilityData} procurementData={procurementData} approverData={approverData} financeData={financeData} logisticsData={logisticsData} auditorData={auditorData} securityStatus={securityStatus} parityData={parityData}/>;
}
