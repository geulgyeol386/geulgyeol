let allOrders=[], currentOrder=null, completedImageData="";
const ADMIN_AUTH_KEY="geulgyeol_admin_basic";

function readStoredAdminAuth(){
  try { return sessionStorage.getItem(ADMIN_AUTH_KEY) || localStorage.getItem(ADMIN_AUTH_KEY) || ""; }
  catch { return ""; }
}
function saveAdminAuth(token){
  try { sessionStorage.setItem(ADMIN_AUTH_KEY,token); } catch {}
  try { localStorage.setItem(ADMIN_AUTH_KEY,token); } catch {}
}
function clearAdminAuth(){
  try { sessionStorage.removeItem(ADMIN_AUTH_KEY); } catch {}
  try { localStorage.removeItem(ADMIN_AUTH_KEY); } catch {}
}
function adminAuth(){ return readStoredAdminAuth(); }
function withAdminAuth(options={}){
  const headers=new Headers(options.headers||{});
  const token=adminAuth();
  if(token)headers.set("Authorization","Basic "+token);
  return {credentials:"same-origin",cache:"no-store",...options,headers};
}
async function adminFetch(url,options={}){
  const r=await fetch(url,withAdminAuth(options));
  if(r.status===401){
    clearAdminAuth();
    showAdminLogin("관리자 로그인이 필요합니다.");
    throw new Error("admin_auth_required");
  }
  return r;
}
function showAdminLogin(message){
  const box=document.querySelector("#adminLogin"),err=document.querySelector("#adminLoginError");
  if(box)box.hidden=false;
  if(err){err.hidden=!message;if(message)err.textContent=message}
  setTimeout(()=>document.querySelector("#adminLoginUser")?.focus(),50);
}
function hideAdminLogin(){const box=document.querySelector("#adminLogin");if(box)box.hidden=true}
async function tryAdminLogin(e){
  e?.preventDefault();
  const user=document.querySelector("#adminLoginUser").value.trim();
  const pass=document.querySelector("#adminLoginPassword").value;
  let token="";
  try{token=btoa(unescape(encodeURIComponent(user+":"+pass)))}catch{token=btoa(user+":"+pass)}
  saveAdminAuth(token);
  try{
    const r=await fetch("/api/admin/orders",withAdminAuth());
    if(r.status===401)throw new Error("bad_credentials");
    if(!r.ok)throw new Error("server_error");
    allOrders=(await r.json()).map(initialAdmin);
    hideAdminLogin();
    render();
    renderArchive();
    renderSettlement();
    renderOverview();
  }catch(err){
    clearAdminAuth();
    showAdminLogin(err.message==="bad_credentials"?"아이디 또는 비밀번호를 확인해 주세요.":"서버 연결을 확인한 뒤 다시 로그인해 주세요.");
  }
}
async function getAll(){const r=await adminFetch("/api/admin/orders");if(!r.ok)throw new Error("관리자 주문 조회 실패");return await r.json()}
async function putOrder(order){const r=await adminFetch("/api/admin/orders/"+encodeURIComponent(order.storageId),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)});if(!r.ok)throw new Error("주문 저장 실패");return await r.json()}
async function deleteOrder(id){const r=await adminFetch("/api/admin/orders/"+encodeURIComponent(id),{method:"DELETE"});if(!r.ok)throw new Error("주문 삭제 실패")}
const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money=n=>(Number(n)||0).toLocaleString("ko-KR")+"원";
function initialAdmin(o){return {...o,status:o.status||"신규 접수",paymentStatus:o.paymentStatus||"미입금",basePrice:Number(o.basePrice)||estimateBasePrice(o),receivedAmount:Number(o.receivedAmount)||0,extraAmount:Number(o.extraAmount)||0,completedDate:o.completedDate||"",trackingNumber:o.trackingNumber||"",customerReview:o.customerReview||"",adminMemo:o.adminMemo||"",cancelReason:o.cancelReason||"",customerVisible:Boolean(o.customerVisible),customerMessage:o.customerMessage||"",publicWork:Boolean(o.publicWork),featuredWork:Boolean(o.featuredWork),archiveTitle:o.archiveTitle||"",completedImage:o.completedImage||"",progressHistory:Array.isArray(o.progressHistory)?o.progressHistory:[]}}
function estimateBasePriceDetails(o){
  const pricing=window.GEULGYEOL_PRICING;
  const count=Number(o.sentenceCharacterCount)||String(o.sentence||"").replace(/\s/g,"").length;
  return pricing?pricing.calculate(o.workSize||"",count):{price:10000,applied:{type:"기본",label:"가격 설정 확인",price:10000},count};
}
function estimateBasePrice(o){return estimateBasePriceDetails(o).price}
function basePriceBasis(o){const d=estimateBasePriceDetails(o);return `${d.applied.type} 기준 · ${d.applied.label}`}
async function load(){allOrders=(await getAll()).map(initialAdmin);render();renderArchive();renderSettlement();renderOverview()}
function render(){const q=document.querySelector("#searchInput").value.trim().toLowerCase(), workType=document.querySelector("#workTypeFilter").value, status=document.querySelector("#statusFilter").value, pay=document.querySelector("#paymentFilter").value;const rows=allOrders.filter(o=>{const text=[o.id,o.name,o.phone,o.workType,o.recipient,o.sentence].join(" ").toLowerCase();return(!q||text.includes(q))&&(!workType||o.workType===workType)&&(!status||o.status===status)&&(!pay||o.paymentStatus===pay)});document.querySelector("#resultCount").textContent=rows.length+"건";document.querySelector("#orderList").innerHTML=rows.length?rows.map(orderCard).join(""):'<div class="empty-state">조건에 맞는 주문이 없습니다.</div>';dashboard()}
function orderCard(o){return `<article class="order-card" data-id="${o.storageId}"><div class="order-number">${esc(o.id||("주문 "+o.storageId))}</div><div class="order-main"><strong>${esc(o.name||"이름 없음")}</strong><small>${esc(o.phone||"")}</small></div><div class="order-sub"><strong>${esc(o.workType||"종류 미입력")}</strong><small>${esc(o.createdAt||"")}</small></div><div><span class="status-badge">${esc(o.status)}</span></div><div class="order-price">${money(o.receivedAmount+o.extraAmount||o.basePrice)}</div><div>›</div></article>`}
function dashboard(){const c=s=>allOrders.filter(o=>o.status===s).length;document.querySelector("#countAll").textContent=allOrders.length;document.querySelector("#countNew").textContent=c("신규 접수");document.querySelector("#countMaking").textContent=c("제작 중");document.querySelector("#countDone").textContent=c("발송 완료");document.querySelector("#countUnpaid").textContent=allOrders.filter(o=>o.paymentStatus!=="입금 완료").length;document.querySelector("#totalRevenue").textContent=money(allOrders.reduce((s,o)=>s+(Number(o.receivedAmount)||0)+(Number(o.extraAmount)||0),0))}
function formatHistoryDate(value){try{return new Date(value).toLocaleString("ko-KR")}catch{return String(value||"")}}
function renderProgressHistory(history){const root=document.querySelector("#progressHistory");if(!root)return;const rows=Array.isArray(history)?history.slice().reverse():[];root.innerHTML=rows.length?rows.map(x=>`<div class="history-item"><span class="history-dot"></span><div><strong>${esc(x.label||"기록")}</strong><time>${esc(formatHistoryDate(x.at))}</time>${x.detail?`<p>${esc(x.detail)}</p>`:""}</div></div>`).join(""):'<div class="history-empty">아직 기록된 진행 이력이 없습니다.</div>'}
function openDetail(id){currentOrder=allOrders.find(o=>o.storageId===Number(id));if(!currentOrder)return;completedImageData=currentOrder.completedImage||"";document.querySelector("#storageId").value=currentOrder.storageId;document.querySelector("#modalTitle").textContent=(currentOrder.name||"고객")+"님의 주문";document.querySelector("#customerSummary").innerHTML=`<strong>${esc(currentOrder.id||"")}</strong><br>${esc(currentOrder.createdAt||"")} · ${esc(currentOrder.phone||"")} · ${esc(currentOrder.email||"")}<br>${esc(currentOrder.workType||"")} / ${esc(currentOrder.workSize||"크기 미정")} / 희망일 ${esc(currentOrder.dueDate||"미정")}<br><strong>기본요금 산정:</strong> ${esc(basePriceBasis(currentOrder))}`;set("adminWorkType",currentOrder.workType||"기타");set("adminStatus",currentOrder.status);set("adminPayment",currentOrder.paymentStatus);set("adminBasePrice",currentOrder.basePrice);set("adminReceivedAmount",currentOrder.receivedAmount);set("adminExtraAmount",currentOrder.extraAmount);set("adminCompletedDate",currentOrder.completedDate);set("adminTrackingNumber",currentOrder.trackingNumber);set("adminReview",currentOrder.customerReview);set("adminMemo",currentOrder.adminMemo);renderProgressHistory(currentOrder.progressHistory);set("adminCancelReason",currentOrder.cancelReason);set("adminCustomerMessage",currentOrder.customerMessage);document.querySelector("#adminCustomerVisible").checked=currentOrder.customerVisible;document.querySelector("#adminPublic").checked=currentOrder.publicWork;document.querySelector("#adminFeatured").checked=currentOrder.featuredWork;set("adminArchiveTitle",currentOrder.archiveTitle||"");document.querySelector("#referenceImages").innerHTML=imageHtml([currentOrder.referenceImage1,currentOrder.referenceImage2]);document.querySelector("#completedImagePreview").innerHTML=imageHtml([completedImageData]);document.querySelector("#requestText").innerHTML=`${currentOrder.usedAi?`<section class="ai-order-summary"><h3>AI 문구 작성 이력</h3><div class="ai-order-summary-grid"><div><strong>작성 방식</strong>AI와 함께 작성</div><div><strong>원하는 문체</strong>${esc(currentOrder.aiPreferredStyle||"다양하게")}</div><div><strong>최초 생성</strong>${Number(currentOrder.aiGenerationCount)||0}회</div><div><strong>다듬기</strong>${Number(currentOrder.aiRefinementCount)||0}회</div><div><strong>마지막 선택 후보</strong>${currentOrder.aiSelectedCandidate?esc(currentOrder.aiSelectedCandidate+"번"):"직접 수정 또는 미기록"}</div><div><strong>마지막 다듬기 요청</strong>${esc(currentOrder.aiLastRefinement||"없음")}</div><div style="grid-column:1/-1"><strong>강조한 내용</strong>${esc(currentOrder.aiEmphasis||"없음")}</div></div></section>`:`<section class="ai-order-summary"><h3>문구 작성 방식</h3><p>고객이 원하는 문구를 직접 작성했습니다.</p></section>`}<h3>전하고 싶은 마음과 사연</h3><p>${esc(currentOrder.story||"없음")}</p><h3>최종 문구</h3><p>${esc(currentOrder.sentence||"함께 상의")}</p><h3>추가 요청</h3><p>${esc(currentOrder.extra||"없음")}</p>`;document.querySelector("#detailModal").hidden=false;document.body.style.overflow="hidden"}
function imageHtml(arr){const imgs=arr.filter(Boolean);return imgs.length?imgs.map(src=>`<img src="${src}" alt="이미지">`).join(""):'<div class="no-image">등록된 이미지가 없습니다.</div>'}
function set(id,v){document.getElementById(id).value=v??""}
function closeDetail(){document.querySelector("#detailModal").hidden=true;document.body.style.overflow="";currentOrder=null}
async function saveAdmin(e){e.preventDefault();if(!currentOrder)return;let status=val("adminStatus"),paymentStatus=val("adminPayment"),receivedAmount=Number(val("adminReceivedAmount"))||0;if(receivedAmount>0&&status!=="취소·미진행"){paymentStatus="입금 완료";if(status==="신규 접수"||status==="상담 중")status="입금 완료";}Object.assign(currentOrder,{workType:val("adminWorkType")||"기타",status,paymentStatus,basePrice:Number(val("adminBasePrice"))||0,receivedAmount,extraAmount:Number(val("adminExtraAmount"))||0,completedDate:val("adminCompletedDate"),trackingNumber:val("adminTrackingNumber"),customerReview:val("adminReview"),adminMemo:val("adminMemo"),cancelReason:val("adminCancelReason"),customerVisible:document.querySelector("#adminCustomerVisible").checked,customerMessage:val("adminCustomerMessage"),publicWork:document.querySelector("#adminPublic").checked,featuredWork:document.querySelector("#adminFeatured").checked,archiveTitle:val("adminArchiveTitle"),completedImage:completedImageData,updatedAt:new Date().toLocaleString("ko-KR")});await putOrder(currentOrder);await load();closeDetail();alert("변경 내용을 저장했습니다.")}
const val=id=>document.getElementById(id).value.trim();
function readCompletedImage(input){const f=input.files&&input.files[0];if(!f)return;if(!f.type.startsWith("image/")){alert("이미지 파일만 선택해 주세요.");return}const r=new FileReader();r.onload=e=>{completedImageData=e.target.result;document.querySelector("#completedImagePreview").innerHTML=imageHtml([completedImageData])};r.readAsDataURL(f)}
async function removeCurrent(){if(!currentOrder||!confirm("이 주문을 삭제할까요? 삭제 후에는 되돌릴 수 없습니다."))return;await deleteOrder(currentOrder.storageId);await load();closeDetail()}
function backup(){const blob=new Blob([JSON.stringify(allOrders,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="글결_주문백업_"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(a.href)}
function restore(input){const f=input.files&&input.files[0];if(!f)return;const r=new FileReader();r.onload=async e=>{try{const rows=JSON.parse(e.target.result);if(!Array.isArray(rows))throw new Error();if(!confirm(rows.length+"건의 자료를 서버에 복원할까요? 같은 주문은 덮어쓸 수 있습니다."))return;const resp=await adminFetch("/api/admin/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orders:rows.map(initialAdmin)})});if(!resp.ok)throw new Error();await load();alert("자료를 복원했습니다.")}catch{alert("복원에 실패했습니다. 올바른 글결 백업 파일인지 확인해 주세요.")}input.value=""};r.readAsText(f)}
function printCurrent(){if(!currentOrder)return;const w=window.open("","_blank","width=900,height=800");w.document.write(`<html><head><title>글결 작업 의뢰서</title><style>@page{size:A4;margin:18mm}body{font-family:Malgun Gothic,sans-serif;color:#222}h1{border-bottom:2px solid #333;padding-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #777;border-left:1px solid #777}.grid div{padding:9px;border-right:1px solid #777;border-bottom:1px solid #777}.box{margin-top:14px;border:1px solid #777;padding:12px;white-space:pre-wrap}.images{display:flex;gap:10px;margin-top:12px}.images img{max-width:48%;max-height:220px;object-fit:contain}</style></head><body><h1>글결 작업 의뢰서</h1><div class="grid"><div>주문번호: ${esc(currentOrder.id)}</div><div>작성일: ${esc(currentOrder.createdAt)}</div><div>성함: ${esc(currentOrder.name)}</div><div>연락처: ${esc(currentOrder.phone)}</div><div>작품 종류: ${esc(currentOrder.workType)}</div><div>희망 크기: ${esc(currentOrder.workSize||"함께 상의")}</div><div>진행 상태: ${esc(currentOrder.status)}</div><div>기본비용: ${money(currentOrder.basePrice)}</div><div>산정 기준: ${esc(basePriceBasis(currentOrder))}</div><div>글자 수: ${Number(currentOrder.sentenceCharacterCount)||String(currentOrder.sentence||"").replace(/\s/g,"").length}자</div></div><div class="box"><b>전하고 싶은 마음과 사연</b><br><br>${esc(currentOrder.story||"")}</div><div class="box"><b>최종 문구</b><br><br>${esc(currentOrder.sentence||"함께 상의")}</div><div class="images">${[currentOrder.referenceImage1,currentOrder.referenceImage2].filter(Boolean).map(x=>`<img src="${x}">`).join("")}</div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);w.document.close()}

const PROGRESS_STATUSES=new Set(["입금 완료","제작 중","제작 완료","발송 완료"]);
function monthKey(o){
  const iso=String(o.createdAtIso||"");
  const m=iso.match(/^(\d{4})-(\d{2})/);if(m)return `${m[1]}-${m[2]}`;
  const text=String(o.createdAt||"");
  const k=text.match(/(\d{4})\D+(\d{1,2})/);return k?`${k[1]}-${String(k[2]).padStart(2,"0")}`:"";
}
function orderDateLabel(o){
  const iso=String(o.createdAtIso||"");if(/^\d{4}-\d{2}-\d{2}/.test(iso))return iso.slice(0,10);
  const t=String(o.createdAt||"");const m=t.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);return m?`${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`:t;
}
function isProceeded(o){return PROGRESS_STATUSES.has(o.status)}
function actualIncome(o){return (Number(o.receivedAmount)||0)+(Number(o.extraAmount)||0)}
function selectedMonthOrders(){const key=document.querySelector("#settlementMonth").value;return allOrders.filter(o=>monthKey(o)===key)}
function renderSettlement(){
  const rows=selectedMonthOrders();
  const proceeded=rows.filter(isProceeded), shipped=rows.filter(o=>o.status==="발송 완료"), cancelled=rows.filter(o=>o.status==="취소·미진행");
  const revenue=rows.reduce((s,o)=>s+actualIncome(o),0), received=rows.reduce((s,o)=>s+(Number(o.receivedAmount)||0),0), extra=rows.reduce((s,o)=>s+(Number(o.extraAmount)||0),0), base=proceeded.reduce((s,o)=>s+(Number(o.basePrice)||0),0);
  const rate=rows.length?Math.round(proceeded.length/rows.length*100):0;
  document.querySelector("#settleAll").textContent=rows.length+"건";document.querySelector("#settleProceed").textContent=proceeded.length+"건";document.querySelector("#settleShipped").textContent=shipped.length+"건";document.querySelector("#settleCancelled").textContent=cancelled.length+"건";document.querySelector("#settleRate").textContent=rate+"%";document.querySelector("#settleRevenue").textContent=money(revenue);
  document.querySelector("#settleBase").textContent=money(base);document.querySelector("#settleReceived").textContent=money(received);document.querySelector("#settleExtra").textContent=money(extra);document.querySelector("#settleRevenueDetail").textContent=money(revenue);
  const month=document.querySelector("#settlementMonth").value;document.querySelector("#settleMonthLabel").textContent=month?month.replace("-","년 ")+"월":"";document.querySelector("#settleOrderCount").textContent=rows.length+"건";
  const types={};for(const o of rows){const k=o.workType||"기타";types[k]??={all:0,proceed:0,revenue:0};types[k].all++;if(isProceeded(o))types[k].proceed++;types[k].revenue+=actualIncome(o)}
  const typeRows=Object.entries(types).sort((a,b)=>b[1].all-a[1].all).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v.all}건</td><td>${v.proceed}건</td><td>${money(v.revenue)}</td></tr>`).join("");
  document.querySelector("#workTypeSummary").innerHTML=typeRows||'<tr><td colspan="4" class="empty-cell">해당 월의 주문이 없습니다.</td></tr>';
  document.querySelector("#monthlyOrderRows").innerHTML=rows.map(o=>`<tr><td>${esc(orderDateLabel(o))}</td><td>${esc(o.id||"")}</td><td>${esc(o.name||"")}</td><td>${esc(o.workType||"")}</td><td><span class="status-badge">${esc(o.status||"")}</span></td><td>${esc(o.paymentStatus||"")}</td><td>${money(actualIncome(o))}</td><td>${esc(o.status==="취소·미진행"?(o.cancelReason||o.adminMemo||""):(o.adminMemo||""))}</td></tr>`).join("")||'<tr><td colspan="8" class="empty-cell">해당 월의 주문이 없습니다.</td></tr>';
}
function archiveRows(){const type=document.querySelector("#archiveTypeFilter")?.value||"",state=document.querySelector("#archivePublicFilter")?.value||"";return allOrders.filter(o=>o.completedImage&&(!type||o.workType===type)&&(!state||(state==="public"&&o.publicWork)||(state==="private"&&!o.publicWork)||(state==="featured"&&o.featuredWork))).sort((a,b)=>Number(Boolean(b.featuredWork))-Number(Boolean(a.featuredWork))||String(b.completedDate||b.updatedAtIso||"").localeCompare(String(a.completedDate||a.updatedAtIso||"")))}
function renderArchive(){const completed=allOrders.filter(o=>o.completedImage);document.querySelector("#archiveCountAll").textContent=completed.length;document.querySelector("#archiveCountPublic").textContent=completed.filter(o=>o.publicWork).length;document.querySelector("#archiveCountFeatured").textContent=completed.filter(o=>o.featuredWork).length;const rows=archiveRows(),root=document.querySelector("#archiveList");if(!root)return;root.innerHTML=rows.length?rows.map(o=>`<article class="archive-card" data-id="${o.storageId}"><div class="archive-image"><img src="${o.completedImage}" alt="${esc(o.workType||"완성 작품")}">${o.featuredWork?'<span class="featured-mark">대표작</span>':''}</div><div class="archive-info"><div class="archive-meta"><span>${esc(o.workType||"기타")}</span><span>${o.publicWork?'홈페이지 공개':'관리자만 보기'}</span></div><h3>${esc(o.archiveTitle||o.sentence||"마음을 담은 글씨")}</h3><p>${esc(o.name||"")} · ${esc(o.id||"")} · ${esc(o.completedDate||"완료일 미입력")}</p><button type="button">작품 설정 열기</button></div></article>`).join(""):'<div class="empty-state">조건에 맞는 완성 작품이 없습니다. 주문 상세에서 완성 사진을 등록해 주세요.</div>'}

function localDateKey(value){
  const d=value?new Date(value):new Date();
  if(Number.isNaN(d.getTime()))return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function orderTimestamp(o){
  const candidates=[o.createdAtIso,o.updatedAtIso,o.createdAt];
  for(const value of candidates){const t=new Date(value||"").getTime();if(Number.isFinite(t))return t}
  return 0;
}
function attentionReason(o){
  if(o.status==="신규 접수")return "신규 확인";
  if(o.status==="상담 중")return "상담 진행";
  if(o.paymentStatus!=="입금 완료"&&o.status!=="취소·미진행")return "입금 확인";
  if(o.status==="제작 완료"&&!o.trackingNumber)return "발송 준비";
  return "";
}
function overviewItem(o,reason=""){
  return `<div class="${reason?"attention-item":"recent-order-item"}" data-id="${o.storageId}"><div><strong>${esc(o.name||"이름 없음")} · ${esc(o.workType||"기타")}</strong><small>${esc(o.id||"")} · ${esc(o.status||"")} · ${esc(o.phone||"")}</small></div>${reason?`<span class="attention-reason">${esc(reason)}</span>`:`<time>${esc(orderDateLabel(o))}</time>`}</div>`;
}
function renderOverview(){
  const root=document.querySelector("#overviewView");if(!root)return;
  const now=new Date(),today=localDateKey(now),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const todayRows=allOrders.filter(o=>localDateKey(o.createdAtIso||o.createdAt)===today);
  const pending=allOrders.filter(o=>["신규 접수","상담 중"].includes(o.status));
  const making=allOrders.filter(o=>["입금 완료","제작 중"].includes(o.status));
  const monthRows=allOrders.filter(o=>monthKey(o)===month);
  const monthRevenue=monthRows.reduce((sum,o)=>sum+actualIncome(o),0);
  document.querySelector("#overviewTodayOrders").textContent=todayRows.length+"건";
  document.querySelector("#overviewPending").textContent=pending.length+"건";
  document.querySelector("#overviewMaking").textContent=making.length+"건";
  document.querySelector("#overviewMonthRevenue").textContent=money(monthRevenue);
  document.querySelector("#overviewMonthLabel").textContent=`${now.getMonth()+1}월 실제 수입`;
  document.querySelector("#overviewTotalOrders").textContent=`전체 ${allOrders.length}건`;
  document.querySelector("#overviewUpdatedAt").textContent=now.toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  const attention=allOrders.map(o=>({o,reason:attentionReason(o)})).filter(x=>x.reason).sort((a,b)=>orderTimestamp(a.o)-orderTimestamp(b.o)).slice(0,8);
  document.querySelector("#overviewAttentionList").innerHTML=attention.length?attention.map(x=>overviewItem(x.o,x.reason)).join(""):'<div class="overview-empty">지금 바로 확인할 주문이 없습니다.</div>';
  const recent=[...allOrders].sort((a,b)=>orderTimestamp(b)-orderTimestamp(a)).slice(0,6);
  document.querySelector("#overviewRecentList").innerHTML=recent.length?recent.map(o=>overviewItem(o)).join(""):'<div class="overview-empty">접수된 주문이 없습니다.</div>';
  const statuses=["신규 접수","상담 중","입금 완료","제작 중","제작 완료","발송 완료","취소·미진행"];
  const max=Math.max(1,...statuses.map(st=>allOrders.filter(o=>o.status===st).length));
  document.querySelector("#overviewStatusBars").innerHTML=statuses.map(st=>{const count=allOrders.filter(o=>o.status===st).length;return `<div class="status-bar-row"><span>${esc(st)}</span><div class="status-bar-track"><div class="status-bar-fill" style="width:${Math.round(count/max*100)}%"></div></div><strong>${count}건</strong></div>`}).join("");
}
function setAdminView(view){const overview=view==="overview",archive=view==="archive",settlement=view==="settlement",orders=view==="orders",settings=view==="settings";document.querySelector("#overviewView").hidden=!overview;document.querySelector("#ordersView").hidden=!orders;document.querySelector("#archiveView").hidden=!archive;document.querySelector("#settlementView").hidden=!settlement;document.querySelector("#settingsView").hidden=!settings;document.querySelector("#overviewViewButton").classList.toggle("is-active",overview);document.querySelector("#ordersViewButton").classList.toggle("is-active",orders);document.querySelector("#archiveViewButton").classList.toggle("is-active",archive);document.querySelector("#settlementViewButton").classList.toggle("is-active",settlement);document.querySelector("#settingsViewButton").classList.toggle("is-active",settings);if(overview)renderOverview();if(archive)renderArchive();if(settlement)renderSettlement();if(settings)loadTelegramStatus();window.scrollTo({top:0,behavior:"smooth"})}
function settlementCsv(){const rows=selectedMonthOrders();const headers=["접수일","주문번호","고객명","연락처","작품종류","진행상태","입금여부","기본비용","실제받은금액","추가로받은마음","실제수입","취소·미진행 사유","관리자 메모"];
 const data=rows.map(o=>[orderDateLabel(o),o.id,o.name,o.phone,o.workType,o.status,o.paymentStatus,o.basePrice,o.receivedAmount,o.extraAmount,actualIncome(o),o.cancelReason,o.adminMemo]);
 const csv=[headers,...data].map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`글결_월별결산_${document.querySelector("#settlementMonth").value||"전체"}.csv`;a.click();URL.revokeObjectURL(a.href)}
function settlementPrint(){const title=(document.querySelector("#settlementMonth").value||"").replace("-","년 ")+"월 글결 월별 결산";const section=document.querySelector("#settlementView").cloneNode(true);section.hidden=false;section.querySelectorAll("button,input").forEach(el=>el.remove());const w=window.open("","_blank","width=1100,height=850");w.document.write(`<html><head><title>${esc(title)}</title><link rel="stylesheet" href="admin.css?v=7.08"><style>body{padding:24px;background:#fff}.settlement-view{display:block!important}.admin-header,.settlement-controls{display:none!important}@media print{body{padding:0}}</style></head><body><h1>${esc(title)}</h1>${section.outerHTML}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);w.document.close()}

document.addEventListener("DOMContentLoaded",()=>{const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;document.querySelector("#settlementMonth").value=month;document.querySelector("#adminLoginForm")?.addEventListener("submit",tryAdminLogin);if(adminAuth()){load().then(()=>{hideAdminLogin();renderSettlement()}).catch(err=>{if(String(err.message)!=="admin_auth_required")alert("주문 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.")})}else{showAdminLogin()} ;["searchInput","workTypeFilter","statusFilter","paymentFilter"].forEach(id=>document.getElementById(id).addEventListener(id==="searchInput"?"input":"change",render));document.querySelector("#orderList").addEventListener("click",e=>{const c=e.target.closest(".order-card");if(c)openDetail(c.dataset.id)});document.querySelectorAll("[data-close]").forEach(x=>x.addEventListener("click",closeDetail));document.querySelector("#adminForm").addEventListener("submit",saveAdmin);document.querySelector("#completedImageInput").addEventListener("change",e=>readCompletedImage(e.target));document.querySelector("#deleteButton").addEventListener("click",removeCurrent);document.querySelector("#backupButton").addEventListener("click",backup);document.querySelector("#restoreInput").addEventListener("change",e=>restore(e.target));document.querySelector("#printButton").addEventListener("click",printCurrent);document.querySelector("#overviewViewButton").addEventListener("click",()=>setAdminView("overview"));document.querySelector("#overviewRefreshButton").addEventListener("click",()=>load().catch(()=>alert("새로고침하지 못했습니다.")));document.querySelector("#overviewOpenOrders").addEventListener("click",()=>setAdminView("orders"));document.querySelector("#overviewAttentionList").addEventListener("click",e=>{const c=e.target.closest("[data-id]");if(c)openDetail(c.dataset.id)});document.querySelector("#overviewRecentList").addEventListener("click",e=>{const c=e.target.closest("[data-id]");if(c)openDetail(c.dataset.id)});document.querySelector("#ordersViewButton").addEventListener("click",()=>setAdminView("orders"));document.querySelector("#archiveViewButton").addEventListener("click",()=>setAdminView("archive"));document.querySelector("#archiveList").addEventListener("click",e=>{const c=e.target.closest(".archive-card");if(c)openDetail(c.dataset.id)});["archiveTypeFilter","archivePublicFilter"].forEach(id=>document.getElementById(id).addEventListener("change",renderArchive));document.querySelector("#settlementViewButton").addEventListener("click",()=>setAdminView("settlement"));document.querySelector("#settingsViewButton").addEventListener("click",()=>setAdminView("settings"));document.querySelector("#telegramConnectButton").addEventListener("click",connectTelegram);document.querySelector("#telegramTestButton").addEventListener("click",testTelegram);document.querySelector("#telegramDisconnectButton").addEventListener("click",disconnectTelegram);document.querySelector("#settlementQuickButton").addEventListener("click",()=>setAdminView("settlement"));document.querySelector("#settlementMonth").addEventListener("change",renderSettlement);document.querySelector("#settlementCsvButton").addEventListener("click",settlementCsv);document.querySelector("#settlementPrintButton").addEventListener("click",settlementPrint);document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDetail()})});


async function loadTelegramStatus(){
  const badge=document.querySelector("#telegramStatusBadge"),result=document.querySelector("#telegramResult");
  try{const r=await adminFetch("/api/admin/notification-status");const data=await r.json();const ok=Boolean(data.telegram?.tokenSaved&&data.telegram?.chatIdSaved);badge.textContent=ok?"연결됨":"연결 필요";badge.classList.toggle("is-connected",ok);if(result&&ok)result.textContent=`텔레그램 알림이 연결되어 있습니다. Chat ID: ${data.telegram.chatId}${data.telegram.source==="environment"?" (Railway 환경변수)":""}`;document.querySelector("#telegramTestButton").disabled=!ok;document.querySelector("#telegramDisconnectButton").disabled=!ok||data.telegram.source==="environment";}catch(e){if(String(e.message)!=="admin_auth_required")badge.textContent="확인 실패"}
}
async function connectTelegram(){const token=document.querySelector("#telegramToken").value.trim(),result=document.querySelector("#telegramResult"),button=document.querySelector("#telegramConnectButton");if(!token){result.textContent="BotFather가 발급한 봇 토큰을 입력해 주세요.";return}button.disabled=true;result.textContent="봇과 대화방을 확인하고 있습니다…";try{const r=await adminFetch("/api/admin/telegram/connect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});const data=await r.json();if(!r.ok)throw new Error(data.error||"연결 실패");document.querySelector("#telegramToken").value="";result.textContent=`연결되었습니다. @${data.botUsername} → ${data.chatName||"내 대화방"}`;await loadTelegramStatus()}catch(e){result.textContent=e.message||"연결하지 못했습니다."}finally{button.disabled=false}}
async function testTelegram(){const result=document.querySelector("#telegramResult"),button=document.querySelector("#telegramTestButton");button.disabled=true;result.textContent="테스트 알림을 보내고 있습니다…";try{const r=await adminFetch("/api/admin/telegram/test",{method:"POST"});const data=await r.json();if(!r.ok)throw new Error(data.error||"전송 실패");result.textContent="텔레그램으로 테스트 알림을 보냈습니다. 휴대전화에서 확인해 주세요."}catch(e){result.textContent=e.message||"테스트 알림을 보내지 못했습니다."}finally{button.disabled=false}}
async function disconnectTelegram(){if(!confirm("텔레그램 주문 알림 연결을 해제할까요?"))return;const result=document.querySelector("#telegramResult");try{const r=await adminFetch("/api/admin/telegram/disconnect",{method:"POST"});const data=await r.json();if(!r.ok)throw new Error(data.error||"해제 실패");result.textContent="텔레그램 연결을 해제했습니다.";await loadTelegramStatus()}catch(e){result.textContent=e.message||"연결을 해제하지 못했습니다."}}
