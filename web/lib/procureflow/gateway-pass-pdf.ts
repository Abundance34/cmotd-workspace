function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\r\n]+/g, " ");
}

const REPLACEMENTS: Record<string, string> = {
  "₦": "NGN ", "–": "-", "—": "-", "→": "->", "•": "*", "…": "...", "’": "'", "“": '"', "”": '"',
};

function ascii(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, (char) => REPLACEMENTS[char] || "?");
}

function textWidth(value: string, size: number) {
  return ascii(value).length * size * 0.49;
}

function wrap(value: unknown, maxChars: number) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

export type GatewayPassPdfInput = {
  passNumber: string;
  status: string | null;
  department: string | null;
  movementType: string;
  purpose: string;
  originLocation: string | null;
  destination: string | null;
  expectedMovementDate: string | null;
  expectedReturnDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  receiverName: string | null;
  receiverOrganization: string | null;
  facilityManagerName: string | null;
  reviewedByName: string | null;
  procurementReviewNote: string | null;
  approvedByName: string | null;
  approvedByRole: string | null;
  approvalNote: string | null;
  securityCheckpoint: string | null;
  securityOfficerName: string | null;
  gateVerificationTime: string | null;
  exitEntryConfirmation: string | null;
  logisticsStatus: string | null;
  logisticsDeliveryReference: string | null;
  logisticsWaybillNumber: string | null;
  items: Array<{
    item_description: string;
    item_category?: string | null;
    quantity: number | string;
    unit_of_measure?: string | null;
    quality_condition?: string | null;
    serial_number?: string | null;
    asset_tag?: string | null;
    fragility_status?: string | null;
    handling_instruction?: string | null;
    remarks?: string | null;
    colour?: string | null;
  }>;
};

function rgb(r: number, g: number, b: number) { return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`; }

function buildPage(input: GatewayPassPdfInput, pageIndex: number, pageCount: number, items: GatewayPassPdfInput["items"], continuation: boolean) {
  const ops: string[] = [];
  const navy = rgb(0.055, 0.145, 0.255);
  const blue = rgb(0.105, 0.365, 0.690);
  const pale = rgb(0.945, 0.970, 0.995);
  const slate = rgb(0.330, 0.400, 0.475);
  const dark = rgb(0.070, 0.110, 0.165);
  const border = rgb(0.790, 0.835, 0.885);

  const fillRect = (x:number,y:number,w:number,h:number,color:string) => ops.push(`q ${color} rg ${x} ${y} ${w} ${h} re f Q`);
  const strokeRect = (x:number,y:number,w:number,h:number,color=border,width=0.7) => ops.push(`q ${color} RG ${width} w ${x} ${y} ${w} ${h} re S Q`);
  const line = (x1:number,y1:number,x2:number,y2:number,color=border,width=0.7) => ops.push(`q ${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`);
  const txt = (x:number,y:number,size:number,value:unknown,bold=false,color=dark) => ops.push(`BT ${color} rg /${bold?"F2":"F1"} ${size} Tf ${x} ${y} Td (${pdfEscape(ascii(value))}) Tj ET`);
  const fitText = (x:number,y:number,w:number,size:number,value:unknown,bold=false,color=dark) => {
    const raw=ascii(value); let use=size; while(use>6 && textWidth(raw,use)>w)use-=0.4; txt(x,y,use,raw,bold,color);
  };
  const labelValue = (x:number,y:number,w:number,label:string,value:unknown) => {
    txt(x,y+15,7,label.toUpperCase(),true,slate); fitText(x,y,w,10,value||"-",false,dark);
  };

  fillRect(0,0,595,842,rgb(1,1,1));
  fillRect(34,752,527,58,navy);
  txt(50,783,18,"CMOTD",true,rgb(1,1,1));
  txt(50,767,7.5,"PROCUREFLOW CONTROLLED DOCUMENT",true,rgb(0.815,0.890,0.980));
  txt(388,783,15,continuation?"GATEWAY PASS - CONTINUED":"GATEWAY PASS",true,rgb(1,1,1));
  fitText(388,766,157,9,input.passNumber,true,rgb(0.875,0.930,1));

  if (!continuation) {
    fillRect(34,715,527,25,pale); strokeRect(34,715,527,25,border);
    txt(48,724,7,"STATUS",true,slate); fitText(92,723,125,9,input.status||"Draft",true,blue);
    txt(253,724,7,"DEPARTMENT",true,slate); fitText(320,723,225,9,input.department||"-",true,dark);

    strokeRect(34,622,527,82,border);
    line(297,622,297,704,border);
    labelValue(48,676,225,"Movement type",input.movementType);
    labelValue(311,676,225,"Expected movement",input.expectedMovementDate||"-");
    labelValue(48,642,225,"Origin",input.originLocation||"-");
    labelValue(311,642,225,"Destination",input.destination||"-");

    strokeRect(34,559,527,52,border);
    txt(48,592,7,"PURPOSE",true,slate);
    const purposeLines=wrap(input.purpose,105).slice(0,2); purposeLines.forEach((v,i)=>txt(48,576-i*13,9.5,v,false,dark));

    txt(34,540,10,"MOVEMENT & RECEIVER DETAILS",true,navy);
    strokeRect(34,474,527,54,border);
    line(210,474,210,528,border); line(385,474,385,528,border);
    labelValue(48,500,145,"Vehicle",input.vehicleNumber||"-");
    labelValue(224,500,145,"Driver",input.driverName||"-");
    labelValue(399,500,145,"Driver phone",input.driverPhone||"-");
    labelValue(48,478,145,"Expected return",input.expectedReturnDate||"-");
    labelValue(224,478,145,"Receiver",input.receiverName||"-");
    labelValue(399,478,145,"Organisation",input.receiverOrganization||"-");
  }

  let tableTop = continuation ? 706 : 447;
  txt(34,tableTop+13,10,continuation?"ITEMS - CONTINUED":"ITEMS / ASSETS",true,navy);
  tableTop -= 2;
  const cols=[34,56,270,326,376,450,561];
  fillRect(34,tableTop-24,527,24,navy);
  ["#","Description","Qty","Unit","Condition","Serial / Asset"].forEach((h,i)=>txt(cols[i]+5,tableTop-16,7.2,h,true,rgb(1,1,1)));
  let y=tableTop-24;
  items.forEach((item,index)=>{
    const desc=wrap(item.item_description,38).slice(0,2);
    const serial=[item.serial_number,item.asset_tag].filter(Boolean).join(" / ")||"-";
    const condition=[item.quality_condition,item.fragility_status&&item.fragility_status!=="Normal"?item.fragility_status:null].filter(Boolean).join(" / ")||"-";
    const rowH=Math.max(31,desc.length*11+12);
    fillRect(34,y-rowH,527,rowH,index%2===0?rgb(0.985,0.990,0.997):rgb(1,1,1));
    for(const x of cols)line(x,y,x,y-rowH,border); line(561,y,561,y-rowH,border); line(34,y-rowH,561,y-rowH,border);
    txt(40,y-18,8,String(pageIndex===0?index+1:(pageIndex*18)+index+1),true,dark);
    desc.forEach((v,i)=>fitText(62,y-17-i*10,200,8.2,v,false,dark));
    fitText(276,y-18,44,8,String(item.quantity),false,dark);
    fitText(332,y-18,38,8,item.unit_of_measure||"-",false,dark);
    fitText(382,y-18,62,7.8,condition,false,dark);
    fitText(456,y-18,99,7.5,serial,false,dark);
    y-=rowH;
  });

  if (!continuation) {
    const approvalTop=Math.min(y-18,205);
    txt(34,approvalTop,10,"AUTHORIZATION & CONTROL",true,navy);
    const boxTop=approvalTop-12; const boxH=68;
    strokeRect(34,boxTop-boxH,527,boxH,border);
    line(210,boxTop-boxH,210,boxTop,border); line(385,boxTop-boxH,385,boxTop,border);
    labelValue(48,boxTop-34,145,"Utility / Facility Head",input.facilityManagerName||"-");
    labelValue(224,boxTop-34,145,"Procurement review",input.reviewedByName||"Pending / not recorded");
    labelValue(399,boxTop-34,145,"Approver / MD",input.approvedByName||input.approvedByRole||"Pending / not recorded");
    txt(48,boxTop-56,6.8,"Approval note",true,slate); fitText(101,boxTop-56,444,7.3,input.approvalNote||input.procurementReviewNote||"-",false,dark);

    const securityY=boxTop-boxH-52;
    txt(34,securityY+36,10,"SECURITY / LOGISTICS CHECKPOINT",true,navy);
    strokeRect(34,securityY-18,527,45,border);
    labelValue(48,securityY-1,112,"Checkpoint",input.securityCheckpoint||"To be completed");
    labelValue(172,securityY-1,112,"Security officer",input.securityOfficerName||"To be completed");
    labelValue(296,securityY-1,112,"Gate verification",input.gateVerificationTime||"To be completed");
    labelValue(420,securityY-1,125,"Movement status",input.exitEntryConfirmation||input.logisticsStatus||"Pending");
  }

  fillRect(34,25,527,1,border);
  txt(34,13,6.8,"Generated by ProcureFlow | Controlled copy | Validate status in the live system",false,slate);
  txt(505,13,6.8,`Page ${pageIndex+1} of ${pageCount}`,true,slate);
  return ops.join("\n");
}

export function gatewayPassPdf(input: GatewayPassPdfInput) {
  const firstItems=input.items.slice(0,7);
  const remaining=input.items.slice(7);
  const chunks: GatewayPassPdfInput["items"][]=[];
  for(let i=0;i<remaining.length;i+=18)chunks.push(remaining.slice(i,i+18));
  const pageItems=[firstItems,...chunks];
  const pageCount=pageItems.length;

  const objects:string[]=[]; const catalogId=1,pagesId=2,fontId=3,boldFontId=4; let nextId=5;
  const pageIds:number[]=[];const contentIds:number[]=[];
  for(let i=0;i<pageCount;i++){pageIds.push(nextId++);contentIds.push(nextId++);}
  objects[catalogId]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[fontId]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[boldFontId]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[pagesId]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  pageItems.forEach((items,index)=>{
    const stream=buildPage(input,index,pageCount,items,index>0);
    objects[contentIds[index]]=`<< /Length ${Buffer.byteLength(stream,"utf8")} >>\nstream\n${stream}\nendstream`;
    objects[pageIds[index]]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`;
  });
  let body="%PDF-1.4\n";const offsets:number[]=[0];
  for(let id=1;id<objects.length;id++){offsets[id]=Buffer.byteLength(body,"utf8");body+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
  const xref=Buffer.byteLength(body,"utf8");body+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let id=1;id<objects.length;id++)body+=`${String(offsets[id]).padStart(10,"0")} 00000 n \n`;
  body+=`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body,"utf8");
}
