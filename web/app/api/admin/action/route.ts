import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
import {
  adminRequestIntervention,
  adminUserSecurityAction,
  setProcurementManagerApprovalLimit,
  type AdminRequestInterventionAction,
  type AdminUserSecurityAction,
} from "@/lib/procureflow/admin-actions";
import { rescindRequestApproval } from "@/lib/procureflow/admin-rescission";
import {
  createAdminManagedUser,
  resetAdminManagedUserPassword,
  updateAdminManagedUser,
  updateAdminRolePermission,
  type AdminPermissionChange,
} from "@/lib/procureflow/admin-user-actions";

type Body = {
  action?: string;
  targetUserId?: number;
  securityAction?: AdminUserSecurityAction;
  reason?: string;
  amount?: string | number;
  requestId?: number;
  interventionAction?: AdminRequestInterventionAction;
  targetProcurementManagerId?: number;
  username?: string;
  fullName?: string;
  email?: string | null;
  role?: string;
  temporaryPassword?: string;
  forcePasswordChange?: boolean;
  permission?: string;
  permissionChange?: AdminPermissionChange;
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "Admin") return NextResponse.json({ error: "Admin access is required." }, { status: 403 });

    const auditReady = await verifyActiveAuditSigningKey().catch(() => false);
    if (!auditReady) {
      return NextResponse.json(
        { error: "ProcureFlow Admin writes are locked because the active v2 audit signing key is not verified." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null) as Body | null;
    const action = String(body?.action || "");
    let result: unknown;

    if (action === "user-security") {
      result = await adminUserSecurityAction(
        user,
        Number(body?.targetUserId),
        String(body?.securityAction || "") as AdminUserSecurityAction,
        String(body?.reason || ""),
      );
    } else if (action === "create-user") {
      result = await createAdminManagedUser(user, {
        username: String(body?.username || ""),
        fullName: String(body?.fullName || ""),
        email: body?.email == null ? null : String(body.email),
        role: String(body?.role || ""),
        temporaryPassword: String(body?.temporaryPassword || ""),
        forcePasswordChange: body?.forcePasswordChange !== false,
        reason: String(body?.reason || ""),
      });
    } else if (action === "update-user") {
      result = await updateAdminManagedUser(user, {
        targetUserId: Number(body?.targetUserId),
        username: String(body?.username || ""),
        fullName: String(body?.fullName || ""),
        email: body?.email == null ? null : String(body.email),
        role: String(body?.role || ""),
        reason: String(body?.reason || ""),
      });
    } else if (action === "reset-user-password") {
      result = await resetAdminManagedUserPassword(user, {
        targetUserId: Number(body?.targetUserId),
        temporaryPassword: String(body?.temporaryPassword || ""),
        reason: String(body?.reason || ""),
      });
    } else if (action === "role-permission") {
      result = await updateAdminRolePermission(user, {
        role: String(body?.role || ""),
        permission: String(body?.permission || ""),
        change: String(body?.permissionChange || "") as AdminPermissionChange,
        reason: String(body?.reason || ""),
      });
    } else if (action === "set-approval-limit") {
      result = await setProcurementManagerApprovalLimit(
        user,
        body?.amount ?? "",
        String(body?.reason || ""),
      );
    } else if (action === "request-intervention") {
      result = await adminRequestIntervention(
        user,
        Number(body?.requestId),
        String(body?.interventionAction || "") as AdminRequestInterventionAction,
        String(body?.reason || ""),
        body?.targetProcurementManagerId == null ? null : Number(body.targetProcurementManagerId),
      );
    } else if (action === "rescind-approval") {
      result = await rescindRequestApproval(
        user,
        Number(body?.requestId),
        String(body?.reason || ""),
      );
    } else {
      return NextResponse.json({ error: "Choose a valid Admin control action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete Admin action.";
    const status = /Only Admin|Admin access|Authentication/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
