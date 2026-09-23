import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json(
    { error: "Gateway Pass approval is now completed directly by Procurement Manager or Logistics. Approver / MD has read-only access to approved Gateway Passes." },
    { status: 409 },
  );
}
