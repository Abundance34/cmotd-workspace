import {NextResponse} from "next/server";
import {getCurrentUser} from "@/lib/auth";
import {startMirrorInspection} from "@/lib/procureflow/admin-workspace-mirror";
import {verifyActiveAuditSigningKey} from "@/lib/procureflow/security-check";
export const runtime="nodejs";
export async function POST(request:Request){
 const admin=await getCurrentUser();
 if(!admin||admin.role!=="Admin"||admin.mustChangePassword)return NextResponse.json({error:"Admin access required."},{status:403});
 if(!(await verifyActiveAuditSigningKey().catch(()=>false)))return NextResponse.json({error:"Inspection is unavailable until the audit signing key is healthy."},{status:503});
 try{
  const body=await request.json();
  const result=await startMirrorInspection(admin,body.targetUserId,body.reason);
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch(error){
  const message=error instanceof Error?error.message:"Could not inspect this workspace.";
  return NextResponse.json({error:message},{status:400,headers:{"Cache-Control":"no-store"}});
 }
}
