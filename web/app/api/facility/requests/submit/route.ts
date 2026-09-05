import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { submitFacilityRequest } from "@/lib/procureflow/facility-actions";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const requestId = Number(body?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
    }

    const result = await submitFacilityRequest(user, requestId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit request.";
    const status = /Only Utility|another user's|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
