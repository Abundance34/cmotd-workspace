import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export default function PreviewPage() {
  const allowed = process.env.VERCEL_ENV !== "production" || process.env.MIGRATION_PREVIEW === "1";
  if (!allowed) notFound();
  return <AppShell user={{ fullName: "Migration Preview", role: "Admin" }} preview />;
}
