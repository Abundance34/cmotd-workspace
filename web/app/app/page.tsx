import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function ProcureFlowApp() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return <AppShell user={user} />;
}
