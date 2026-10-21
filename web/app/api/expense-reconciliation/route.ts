import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getExpenseReconciliationData,runExpenseReconciliationAction } from "@/lib/procureflow/expense-reconciliation";
import { verifyActiveAuditSigningKey } from "@/lib/procureflow/security-check";
export const runtime="nodejs";
export async function GET(){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
 try{return NextResponse.json(await getExpenseReconciliationData(user),{headers:{"Cache-Control":"no-store"}});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unable to load reconciliations."},{status:500});}
}
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
 const valid=await verifyActiveAuditSigningKey().catch(()=>false);
 if(!valid)return NextResponse.json({error:"Writes are locked until the audit signing key is healthy."},{status:503});
 try{
  const body=await request.json();
  if(!body||typeof body!=="object")throw new Error("Invalid request.");
  const result=await runExpenseReconciliationAction(user,String(body.action||""),body.payload||{});
  return NextResponse.json({ok:true,result},{headers:{"Cache-Control":"no-store"}});
 }catch(e){const message=e instanceof Error?e.message:"Action failed.";return NextResponse.json({error:message},{status:/access denied|not authorized|Only Finance|independent|different Procurement Manager/i.test(message)?403:400});}
}
