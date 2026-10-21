import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getExpenseEvidence } from "@/lib/procureflow/expense-reconciliation";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
 try{
  const p=await params;const id=Number(p.id);if(!Number.isSafeInteger(id)||id<1)throw new Error("Invalid attachment.");
  const evidence=await getExpenseEvidence(user,id);
  const body=evidence.content instanceof Uint8Array?evidence.content:Buffer.from(evidence.content);
  return new NextResponse(new Uint8Array(body),{headers:{"Content-Type":evidence.mime_type,"Content-Disposition":'attachment; filename="'+String(evidence.file_name).replace(/["\\\r\n]/g,"_")+'"',"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"}});
 }catch{return NextResponse.json({error:"Attachment not found or access denied."},{status:404});}
}
