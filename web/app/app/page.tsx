import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getFacilityDashboardData } from "@/lib/procureflow/facility-data";

export default async function ProcureFlowApp() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const facilityData = user.role === "Facility Manager"
    ? await getFacilityDashboardData(user.id)
    : undefined;

  return <AppShell user={user} facilityData={facilityData} />;
}
