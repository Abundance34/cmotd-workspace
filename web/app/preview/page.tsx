import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export default function PreviewPage() {
  // The legacy migration preview is a development-only reference surface.
  // Production users must always use the authenticated /app workspace.
  if (process.env.VERCEL_ENV === "production") notFound();
  return <AppShell user={{ fullName: "Development Preview", role: "Admin" }} preview />;
}
