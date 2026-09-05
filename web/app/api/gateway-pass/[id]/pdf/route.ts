import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { simplePdf } from "@/lib/procureflow/simple-pdf";

export const runtime="nodejs";

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const {id:idText}=await params;const id=Number(idText);if(!Number.isInteger(id)||id<=0)return NextResponse.json({error:"Invalid gateway pass."},{status:400});
  const sql=db();const rows=await sql<any[]>`SELECT gp.*,u.full_name facility_manager_name,a.full_name approved_by_name FROM gateway_passes gp LEFT JOIN users u ON u.id=gp.facility_manager_user_id LEFT JOIN users a ON a.id=gp.approved_by_user_id WHERE gp.id=${id} LIMIT 1`;const gp=rows[0];if(!gp)return NextResponse.json({error:"Gateway pass not found."},{status:404});
  if(user.role==="Facility Manager"&&Number(gp.facility_manager_user_id)!==user.id)return NextResponse.json({error:"This gateway pass is not assigned to you."},{status:403});
  if(!["Facility Manager","Procurement Manager","Approver","Admin","Auditor","Logistics Officer"].includes(user.role))return NextResponse.json({error:"Gateway pass access denied."},{status:403});
  if(!["Approved","Generated","Downloaded","Closed"].includes(String(gp.status||"")))return NextResponse.json({error:"The gateway pass is not approved for generation."},{status:409});
  const items=await sql<any[]>`SELECT * FROM gateway_pass_items WHERE gateway_pass_id=${id} ORDER BY id`;
  const lines=[
    `Pass Number: ${gp.pass_number}`,`Status: ${gp.status}`,`Department: ${gp.department||""}`,`Movement Type: ${gp.movement_type||""}`,`Purpose: ${gp.purpose||""}`,
    `Origin: ${gp.origin_location||""}`,`Destination: ${gp.destination||""}`,`Expected Movement: ${gp.expected_movement_date||""}`,`Expected Return: ${gp.expected_return_date||""}`,
    `Facility / Utility Head: ${gp.facility_manager_name||""}`,`Vehicle: ${gp.vehicle_number||""}`,`Driver: ${gp.driver_name||""}`,`Driver Phone: ${gp.driver_phone||""}`,
    `Receiver: ${gp.receiver_name||""}`,`Receiver Organisation: ${gp.receiver_organization||""}`,`Approved By: ${gp.approved_by_name||gp.approved_by_role||""}`,`Approval Note: ${gp.approval_note||""}`,"","ITEMS",
    ...items.map((item,index)=>`${index+1}. ${item.item_description} | Qty ${item.quantity} ${item.unit_of_measure||""} | Condition ${item.quality_condition||""} | Serial ${item.serial_number||"-"} | Asset ${item.asset_tag||"-"} | Handling ${item.handling_instruction||"-"}`),
    "","Security checkpoint fields are completed during physical movement coordination."
  ];
  const pdf=simplePdf(`CMOTD GATEWAY PASS — ${gp.pass_number}`,lines,"ProcureFlow Gateway Pass");return new NextResponse(pdf,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${gp.pass_number}.pdf"`}});
}
