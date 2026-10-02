import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFImage, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";

export type ReturnPassPdfInput = {
  returnPassNumber: string;
  gatewayPassNumber: string;
  status: string;
  department: string | null;
  purpose: string | null;
  returnOrigin: string | null;
  receivingLocation: string | null;
  actualReturnDate: string | null;
  expectedReturnDate: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  facilityManagerName: string | null;
  approvedByName: string | null;
  approvedByRole: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  securityCheckpoint: string | null;
  securityOfficerName: string | null;
  gateVerificationTime: string | null;
  gatewayReturnStatus: string | null;
  items: Array<{
    item_description: string;
    unit_of_measure?: string | null;
    serial_number?: string | null;
    asset_tag?: string | null;
    quantity_outbound: number | string;
    quantity_previously_returned: number | string;
    quantity_returned: number | string;
    condition_on_return?: string | null;
    discrepancy_type?: string | null;
    discrepancy_notes?: string | null;
    remarks?: string | null;
  }>;
};

const PAGE_W=595.28, PAGE_H=841.89, LEFT=36, RIGHT=559.28, WIDTH=523.28;
const NAVY=rgb(13/255,41/255,71/255), BLUE=rgb(27/255,95/255,171/255), LINE=rgb(204/255,217/255,229/255), PALE=rgb(243/255,247/255,251/255), INK=rgb(22/255,40/255,58/255), MUTED=rgb(95/255,113/255,130/255), WHITE=rgb(1,1,1);

type Fonts={regular:PDFFont;bold:PDFFont;times:PDFFont;timesBold:PDFFont;timesItalic:PDFFont};
type Branding={rsu:PDFImage|null;cmotd:PDFImage|null};

function safe(value:unknown){return String(value??"-").replace(/[\r\n]+/g," ").replace(/[–—]/g,"-").replace(/’/g,"'").trim()||"-";}
function whole(value:unknown){const n=Number(value);return Number.isFinite(n)?String(Math.max(0,Math.round(n))):safe(value);}
function dateText(value:unknown,time=false){if(!value)return "-";const d=new Date(String(value));if(Number.isNaN(d.getTime()))return safe(value);return new Intl.DateTimeFormat("en-NG",{day:"2-digit",month:"short",year:"numeric",...(time?{hour:"2-digit",minute:"2-digit",hour12:true}:{}),timeZone:"Africa/Lagos"}).format(d);}
function fit(font:PDFFont,text:unknown,size:number,max:number,min=5.8){let s=size;const raw=safe(text);while(s>min&&font.widthOfTextAtSize(raw,s)>max)s-=.25;return s;}
function wrap(font:PDFFont,text:unknown,size:number,max:number,limit=3){const words=safe(text).split(/\s+/);const lines:string[]=[];let current="";for(const word of words){const next=current?current+" "+word:word;if(font.widthOfTextAtSize(next,size)<=max){current=next;continue;}if(current){lines.push(current);current="";if(lines.length>=limit)break;}if(font.widthOfTextAtSize(word,size)<=max)current=word;else{let part="";for(const ch of word){if(font.widthOfTextAtSize(part+ch,size)<=max)part+=ch;else{if(part)lines.push(part);part=ch;if(lines.length>=limit)break;}}current=part;}}if(current&&lines.length<limit)lines.push(current);return lines.length?lines:["-"];}
function lines(page:PDFPage,font:PDFFont,rows:string[],x:number,y:number,size:number,color=INK){rows.forEach((t,i)=>page.drawText(t,{x,y:y-i*(size+2),font,size,color}));}
function box(page:PDFPage,x:number,y:number,w:number,h:number,fill=WHITE){page.drawRectangle({x,y,width:w,height:h,color:fill,borderColor:LINE,borderWidth:.65});}
function field(page:PDFPage,f:Fonts,x:number,y:number,w:number,h:number,label:string,value:unknown,maxLines=2){page.drawText(label.toUpperCase(),{x:x+7,y:y+h-12,font:f.bold,size:6.2,color:MUTED});lines(page,f.regular,wrap(f.regular,value,8,w-14,maxLines),x+7,y+h-27,8);}
async function branding(pdf:PDFDocument):Promise<Branding>{const dir=path.join(process.cwd(),"public","branding");const embed=async(n:string)=>{try{return await pdf.embedPng(fs.readFileSync(path.join(dir,n)));}catch{return null;}};return{rsu:await embed("rsu_logo.png"),cmotd:await embed("cmotd_logo.png")};}
function imageFit(page:PDFPage,img:PDFImage|null,x:number,y:number,w:number,h:number){if(!img)return;const ratio=img.width/img.height;let dw=w,dh=w/ratio;if(dh>h){dh=h;dw=h*ratio;}page.drawImage(img,{x:x+(w-dw)/2,y:y+(h-dh)/2,width:dw,height:dh});}
function header(page:PDFPage,f:Fonts,b:Branding,input:ReturnPassPdfInput,continuation=false){
  imageFit(page,b.rsu,36,748,62,62);imageFit(page,b.cmotd,PAGE_W-98,748,62,62);
  const t1="Centre For Marine and Offshore Technology Development (CMOTD)",t2="Consultancy Services Unit, Rivers State University",tag="Where Theory becomes Reality and Individuals are Equipped to Lead in the Industry!";
  const s1=fit(f.timesBold,t1,13.2,390,10.2);page.drawText(t1,{x:(PAGE_W-f.timesBold.widthOfTextAtSize(t1,s1))/2,y:794,font:f.timesBold,size:s1,color:rgb(0,0,0)});
  page.drawText(t2,{x:(PAGE_W-f.timesBold.widthOfTextAtSize(t2,11.5))/2,y:775,font:f.timesBold,size:11.5,color:rgb(0,0,0)});
  const st=fit(f.timesItalic,tag,9.5,395,8);page.drawText(tag,{x:(PAGE_W-f.timesItalic.widthOfTextAtSize(tag,st))/2,y:758,font:f.timesItalic,size:st,color:rgb(0,0,0)});
  page.drawLine({start:{x:LEFT,y:740},end:{x:RIGHT,y:740},thickness:1.1,color:BLUE});
  page.drawRectangle({x:LEFT,y:686,width:WIDTH,height:44,color:NAVY});
  page.drawText(continuation?"RETURN PASS - CONTINUED":"RETURN PASS",{x:52,y:703,font:f.bold,size:continuation?12.5:15,color:WHITE});
  const ctl="PROCUREFLOW CONTROLLED DOCUMENT";page.drawText(ctl,{x:RIGHT-f.bold.widthOfTextAtSize(ctl,8.2)-12,y:713,font:f.bold,size:8.2,color:WHITE});
  const no=safe(input.returnPassNumber);const ns=fit(f.regular,no,8.2,230,6.5);page.drawText(no,{x:RIGHT-f.regular.widthOfTextAtSize(no,ns)-12,y:699,font:f.regular,size:ns,color:WHITE});
}
function footer(page:PDFPage,f:Fonts,index:number,total:number){page.drawLine({start:{x:LEFT,y:51},end:{x:RIGHT,y:51},thickness:.8,color:BLUE});const a="Consultancy Unit, Rivers State University, Nkpolu-Oroworokwo, Port Harcourt, Rivers State",c="Email: info@cmotd.org   |   Phone NO.: +2349163505000";page.drawText(a,{x:(PAGE_W-f.times.widthOfTextAtSize(a,7.4))/2,y:37,font:f.times,size:7.4,color:INK});page.drawText(c,{x:(PAGE_W-f.times.widthOfTextAtSize(c,7.1))/2,y:26,font:f.times,size:7.1,color:INK});page.drawText("Generated by ProcureFlow | Controlled Return Pass",{x:LEFT,y:13,font:f.regular,size:6.1,color:MUTED});const p=`Page ${index+1} of ${total}`;page.drawText(p,{x:RIGHT-f.regular.widthOfTextAtSize(p,6.1),y:13,font:f.regular,size:6.1,color:MUTED});}

const COL=[LEFT,58,247,292,349,405,462,RIGHT];
function tableHead(page:PDFPage,f:Fonts,y:number){page.drawText("RETURN RECONCILIATION",{x:LEFT,y,font:f.bold,size:9.5,color:NAVY});y-=10;page.drawRectangle({x:LEFT,y:y-24,width:WIDTH,height:24,color:NAVY});["#","Item / Asset","Out","Prev","Now","After","Condition"].forEach((h,i)=>page.drawText(h,{x:COL[i]+4,y:y-16,font:f.bold,size:6.4,color:WHITE}));return y-24;}
function rowHeight(f:Fonts,item:ReturnPassPdfInput["items"][number]){const desc=wrap(f.regular,item.item_description,7.4,COL[2]-COL[1]-8,3);const cond=wrap(f.regular,[item.condition_on_return,item.discrepancy_type].filter(Boolean).join(" / ")||"-",6.9,RIGHT-COL[6]-8,2);return Math.max(27,11+Math.max(desc.length,cond.length)*9);}
function itemRow(page:PDFPage,f:Fonts,y:number,item:ReturnPassPdfInput["items"][number],index:number,h:number){box(page,LEFT,y-h,WIDTH,h,index%2===0?PALE:WHITE);COL.slice(1,-1).forEach(x=>page.drawLine({start:{x,y:y-h},end:{x,y},thickness:.5,color:LINE}));const out=Math.round(Number(item.quantity_outbound||0)),prev=Math.round(Number(item.quantity_previously_returned||0)),now=Math.round(Number(item.quantity_returned||0)),after=Math.max(0,out-prev-now);page.drawText(String(index+1),{x:COL[0]+5,y:y-17,font:f.regular,size:7.4,color:INK});lines(page,f.regular,wrap(f.regular,item.item_description,7.4,COL[2]-COL[1]-8,3),COL[1]+5,y-17,7.4);[out,prev,now,after].forEach((v,i)=>page.drawText(String(v),{x:COL[2+i]+5,y:y-17,font:i===2?f.bold:f.regular,size:7.4,color:INK}));const condition=[item.condition_on_return,item.discrepancy_type,item.discrepancy_notes,item.remarks].filter(Boolean).join(" - ")||"-";lines(page,f.regular,wrap(f.regular,condition,6.7,RIGHT-COL[6]-8,3),COL[6]+4,y-15,6.7);return y-h;}

export async function returnPassPdf(input:ReturnPassPdfInput){
  const pdf=await PDFDocument.create();const f:Fonts={regular:await pdf.embedFont(StandardFonts.Helvetica),bold:await pdf.embedFont(StandardFonts.HelveticaBold),times:await pdf.embedFont(StandardFonts.TimesRoman),timesBold:await pdf.embedFont(StandardFonts.TimesRomanBold),timesItalic:await pdf.embedFont(StandardFonts.TimesRomanItalic)};const b=await branding(pdf);const pages:PDFPage[]=[];
  const add=(cont=false)=>{const p=pdf.addPage([PAGE_W,PAGE_H]);pages.push(p);header(p,f,b,input,cont);return p;};
  let page=add(false),y=674;
  box(page,LEFT,y-30,WIDTH,30,PALE);field(page,f,LEFT,y-30,WIDTH/3,30,"Return Status",input.status);field(page,f,LEFT+WIDTH/3,y-30,WIDTH/3,30,"Return Pass",input.returnPassNumber);field(page,f,LEFT+WIDTH*2/3,y-30,WIDTH/3,30,"Original Gateway Pass",input.gatewayPassNumber);y-=42;
  const half=WIDTH/2;box(page,LEFT,y-66,WIDTH,66);page.drawLine({start:{x:LEFT+half,y:y-66},end:{x:LEFT+half,y},thickness:.65,color:LINE});field(page,f,LEFT,y-33,half,33,"Department",input.department||"-");field(page,f,LEFT+half,y-33,half,33,"Actual Return Date",dateText(input.actualReturnDate));field(page,f,LEFT,y-66,half,33,"Return Origin",input.returnOrigin||"-");field(page,f,LEFT+half,y-66,half,33,"Receiving Location",input.receivingLocation||"-");y-=78;
  box(page,LEFT,y-42,WIDTH,42);field(page,f,LEFT,y-42,WIDTH,42,"Purpose",input.purpose||"-",2);y-=55;
  page.drawText("RETURN MOVEMENT DETAILS",{x:LEFT,y,font:f.bold,size:9.5,color:NAVY});y-=10;const third=WIDTH/3;box(page,LEFT,y-48,WIDTH,48);page.drawLine({start:{x:LEFT+third,y:y-48},end:{x:LEFT+third,y},thickness:.65,color:LINE});page.drawLine({start:{x:LEFT+third*2,y:y-48},end:{x:LEFT+third*2,y},thickness:.65,color:LINE});field(page,f,LEFT,y-48,third,48,"Vehicle",input.vehicleNumber||"-");field(page,f,LEFT+third,y-48,third,48,"Driver",input.driverName||"-");field(page,f,LEFT+third*2,y-48,third,48,"Driver Phone",input.driverPhone||"-");y-=62;
  y=tableHead(page,f,y);
  input.items.forEach((item,index)=>{const h=rowHeight(f,item);if(y-h<220){page=add(true);y=tableHead(page,f,666);}y=itemRow(page,f,y,item,index,h);});
  const totalOut=input.items.reduce((sum,item)=>sum+Math.round(Number(item.quantity_outbound||0)),0);
  const totalPrev=input.items.reduce((sum,item)=>sum+Math.round(Number(item.quantity_previously_returned||0)),0);
  const totalNow=input.items.reduce((sum,item)=>sum+Math.round(Number(item.quantity_returned||0)),0);
  const totalAfter=Math.max(0,totalOut-totalPrev-totalNow);
  if(y<245){page=add(true);y=666;}else y-=14;
  const summaryH=34;box(page,LEFT,y-summaryH,WIDTH,summaryH,PALE);const summaryW=WIDTH/4;
  [["Originally Released",totalOut],["Returned Now",totalNow],["Previously Returned",totalPrev],["Outstanding",totalAfter]].forEach(([label,value],i)=>{if(i)page.drawLine({start:{x:LEFT+summaryW*i,y:y-summaryH},end:{x:LEFT+summaryW*i,y},thickness:.55,color:LINE});page.drawText(String(label).toUpperCase(),{x:LEFT+summaryW*i+7,y:y-12,font:f.bold,size:5.9,color:MUTED});page.drawText(String(value),{x:LEFT+summaryW*i+7,y:y-27,font:f.bold,size:10.5,color:i===3?BLUE:INK});});
  y-=summaryH+18;
  page.drawText("RETURN AUTHORIZATION & GATE VERIFICATION",{x:LEFT,y,font:f.bold,size:9.5,color:NAVY});y-=10;
  const authTop=45,authNote=28;
  box(page,LEFT,y-authTop,WIDTH,authTop);page.drawLine({start:{x:LEFT+third,y:y-authTop},end:{x:LEFT+third,y},thickness:.65,color:LINE});page.drawLine({start:{x:LEFT+third*2,y:y-authTop},end:{x:LEFT+third*2,y},thickness:.65,color:LINE});
  field(page,f,LEFT,y-authTop,third,authTop,"Facility Head",input.facilityManagerName||"-");field(page,f,LEFT+third,y-authTop,third,authTop,"Verified By",input.approvedByName||input.approvedByRole||"-");field(page,f,LEFT+third*2,y-authTop,third,authTop,"Verification Date",dateText(input.approvedAt,true));
  box(page,LEFT,y-authTop-authNote,WIDTH,authNote,PALE);page.drawText("VERIFICATION NOTE",{x:LEFT+7,y:y-authTop-11,font:f.bold,size:6.1,color:MUTED});lines(page,f.regular,wrap(f.regular,input.approvalNote||"-",6.7,WIDTH-105,2),LEFT+98,y-authTop-11,6.7);
  y-=authTop+authNote+16;
  page.drawText("SECURITY CHECKPOINT",{x:LEFT,y,font:f.bold,size:9.5,color:NAVY});y-=10;box(page,LEFT,y-42,WIDTH,42);const q=WIDTH/4;for(let i=1;i<4;i++)page.drawLine({start:{x:LEFT+q*i,y:y-42},end:{x:LEFT+q*i,y},thickness:.65,color:LINE});field(page,f,LEFT,y-42,q,42,"Checkpoint",input.securityCheckpoint||"To be completed");field(page,f,LEFT+q,y-42,q,42,"Security Officer",input.securityOfficerName||"To be completed");field(page,f,LEFT+q*2,y-42,q,42,"Gate Verification",dateText(input.gateVerificationTime,true));field(page,f,LEFT+q*3,y-42,q,42,"Gateway Return Status",input.gatewayReturnStatus||"-");
  pages.forEach((p,i)=>footer(p,f,i,pages.length));pdf.setTitle(input.returnPassNumber+" - CMOTD Return Pass");pdf.setAuthor("Centre For Marine and Offshore Technology Development (CMOTD)");return Buffer.from(await pdf.save());
}
