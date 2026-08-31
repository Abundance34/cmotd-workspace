import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginScreen } from "@/components/login-screen";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/app");
  const previewAvailable = process.env.VERCEL_ENV !== "production" || process.env.MIGRATION_PREVIEW === "1";
  return <LoginScreen previewAvailable={previewAvailable} />;
}
