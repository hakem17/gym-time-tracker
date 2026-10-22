/* Rep — dashboard, progress, body and food views (Chart.js).
   Workout sets come from this phone (D.history) plus the coach's history file.
   Body, InBody and food come from the coach file, which is encrypted (data.enc.json):
   the coach encrypts with the public key in keys.json; only your passphrase opens it.
   Progress photos stay in this phone's IndexedDB and are never uploaded. */
(function(){
"use strict";
const DAY=864e5;
const CK="gtt-coach", PK="gtt-pk";
let COACH=null, coachState="locked", coachErr="";
const UI={progTab:"perf",progEx:null,range:30,adhWeeks:8,bodyRange:90,foodRange:30,draft:{waist:"",weight:""},pose:"front"};

/* ---------------- utils ---------------- */
const num=v=>{const n=parseFloat(String(v??"").replace(",","."));return isFinite(n)?n:0};
const dkey=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const parseD=s=>new Date(s+"T12:00:00").getTime();
const LOC="ar-EG-u-nu-latn";
const shortD=t=>new Date(t).toLocaleDateString(LOC,{day:"numeric",month:"short"});
const longD=t=>new Date(t).toLocaleDateString(LOC,{weekday:"long",day:"numeric",month:"long"});
const pct=v=>(v>0?"+":"")+v.toFixed(1)+"%";
const r1=v=>Math.round(v*10)/10;
const sgn=v=>(v>0?"+":"")+r1(v);
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const DAYN={push:"Push",pull:"Pull",legs:"Legs"};
const el=id=>document.getElementById(id);

/* ---------------- crypto (WebCrypto) ---------------- */
const ub=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
const bu=buf=>{let s="";new Uint8Array(buf).forEach(c=>s+=String.fromCharCode(c));return btoa(s)};
async function unwrapPrivate(keys,pass){
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
  const aes=await crypto.subtle.deriveKey({name:"PBKDF2",salt:ub(keys.priv.salt),iterations:keys.priv.iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  return crypto.subtle.decrypt({name:"AES-GCM",iv:ub(keys.priv.iv)},aes,ub(keys.priv.ct)); // pkcs8
}
async function decryptData(pkcs8,enc){
  const priv=await crypto.subtle.importKey("pkcs8",pkcs8,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
  const raw=await crypto.subtle.decrypt({name:"RSA-OAEP"},priv,ub(enc.ek));
  const aes=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:ub(enc.iv)},aes,ub(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
const getJSON=async f=>{const r=await fetch(f,{cache:"no-store"});if(!r.ok)throw new Error(f+" "+r.status);return r.json()};
async function loadCoach(){
  const pk=ls.get(PK);
  if(!pk){coachState="locked";return}
  const cached=ls.get(CK);
  if(cached&&!COACH){try{COACH=JSON.parse(cached);coachState="ok"}catch(e){}}
  try{
    const enc=await getJSON("data.enc.json");
    const base=await decryptData(ub(pk),enc);
    let idx=[];try{idx=await getJSON("updates/index.json")}catch(e){}
    for(const u of idx){try{mergeUpdate(base,await decryptData(ub(pk),await getJSON("updates/"+u.file)))}catch(e){}}
    COACH=base;coachState="ok";ls.set(CK,JSON.stringify(COACH));
  }catch(e){if(!COACH){coachState="error";coachErr="مقدرتش أحمّل الداتا. اتأكد إنك على النت."}}
}
function mergeUpdate(base,u){
  const byDate=(a,b)=>{const m=new Map((a||[]).map(x=>[x.date,x]));(b||[]).forEach(x=>m.set(x.date,{...(m.get(x.date)||{}),...x}));return[...m.values()].sort((x,y)=>x.date<y.date?-1:1)};
  ["inbody","waist","weight","physique"].forEach(k=>{if(u[k])base[k]=byDate(base[k],u[k])});
  if(u.nutrition){base.nutrition=base.nutrition||{};if(u.nutrition.days)base.nutrition.days=byDate(base.nutrition.days,u.nutrition.days);if(u.nutrition.targets)base.nutrition.targets=u.nutrition.targets;if(u.nutrition.dayTargets)base.nutrition.dayTargets={...(base.nutrition.dayTargets||{}),...u.nutrition.dayTargets}}
  if(u.workouts){const key=h=>h.day+"|"+dkey(h.startedAt),m=new Map((base.workouts||[]).map(h=>[key(h),h]));u.workouts.forEach(h=>m.set(key(h),h));base.workouts=[...m.values()].sort((a,b)=>a.startedAt-b.startedAt)}
  if(u.baselines){base.baselines=base.baselines||{};Object.entries(u.baselines).forEach(([k,v])=>{base.baselines[k]=[...new Set([...(base.baselines[k]||[]),...v])]})}
  if(u.updated)base.updated=u.updated;
}
async function unlockWith(pass){
  coachState="loading";coachErr="";rerender();
  try{
    const keys=await getJSON("keys.json");
    const pkcs8=await unwrapPrivate(keys,pass);
    ls.set(PK,bu(pkcs8));
    await loadCoach();
  }catch(e){coachState="locked";coachErr="الباسورد غلط، أو مفيش نت."}
  window.GTT_refresh();
}

/* ---------------- sessions & analytics ---------------- */
function allSessions(){
  const phone=(typeof D!=="undefined"?D.history:[]).map(h=>({...h,source:h.source||"phone"}));
  const C=(COACH&&COACH.workouts||[]),key=h=>h.day+"|"+dkey(h.startedAt),cm=new Map(C.map(h=>[key(h),h]));
  // same workout in both: the phone wins, but anything left empty on the phone (e.g. abs written only in the chat) is filled from the coach copy
  const merged=phone.map(h=>{const c=cm.get(key(h));if(!c)return h;
    const items=h.items.map(x=>{const y=c.items.find(z=>z.id===x.id);if(!y)return x;
      if(x.timed)return x.done?x:{...x,done:y.done||x.done};return(x.logs&&x.logs.length)||!(y.logs&&y.logs.length)?x:{...x,logs:y.logs,skip:""}});
    c.items.forEach(y=>{if(!items.some(x=>x.id===y.id))items.push(y)});return{...h,items}});
  const seen=new Set(phone.map(key));
  return [...C.filter(h=>!seen.has(key(h))).map(h=>({...h,source:h.source||"chat"})),...merged].sort((a,b)=>a.startedAt-b.startedAt);
}
window.GTT_allSessions=allSessions;

const MUSCLE={pu1:"صدر",pu2:"صدر",pu3:"صدر",pu4:"صدر",pu5:"كتف",pu6:"كتف",pu7:"تراي",pu8:"تراي",pu9:"تراي",
  pl1:"ضهر",pl2:"ضهر",pl3:"ضهر",pl_row_wide:"ضهر",pl4:"أسفل الضهر",pl5:"كتف خلفي",pl5_db:"كتف خلفي",pl6:"كتف خلفي",pl7:"باي",pl8:"باي",pl9:"باي",
  lg1:"أمامية",lg2:"أمامية",lg3:"أمامية",lg4:"خلفية ومقعدة",lg5:"خلفية ومقعدة",lg_rdl:"خلفية ومقعدة",lg6:"جوانب",lg7:"جوانب",lg8:"سمانة",lg9:"سمانة",
  aa1:"بطن",aa2:"بطن",ab1:"بطن",ab2:"بطن"};
const MUSCLE_ORDER=["صدر","كتف","كتف خلفي","تراي","ضهر","أسفل الضهر","باي","أمامية","خلفية ومقعدة","سمانة","جوانب","بطن"];
function planInfo(id){
  for(const k of ["push","pull","legs","absA","absB"]){const x=(D.plans[k]||[]).find(e=>e.id===id);if(x)return{...x,day:k}}
  return null;
}
function baselinesFor(id){
  const a=[...((COACH&&COACH.baselines&&COACH.baselines[id])||[])];
  const p=planInfo(id);if(p&&p.baselines)a.push(...p.baselines);
  return a.map(parseD).sort((x,y)=>x-y);
}
/* per-set strength: estimated 1-rep max (Epley); bodyweight/seconds fall back to reps */
const setVal=(l,kind)=>kind==="e1rm"?(num(l.w)>0&&num(l.r)>0?num(l.w)*(1+num(l.r)/30):0):num(l.r);
function exerciseSeries(S){
  const map={};
  S.forEach(h=>h.items.forEach(it=>{
    if(it.timed||!it.logs||!it.logs.length)return;
    (map[it.id]=map[it.id]||{id:it.id,name:it.name,unit:it.unit,abs:!!it.abs,day:h.day,raw:[]}).raw.push({h,it});
  }));
  Object.values(map).forEach(e=>{
    const p=planInfo(e.id);if(p){e.name=p.name;e.unit=p.unit;e.day=p.day==="absA"||p.day==="absB"?e.day:p.day}
    e.kind=e.raw.some(x=>x.it.logs.some(l=>num(l.w)>0))?"e1rm":"reps";
    const bl=baselinesFor(e.id);
    let segMax={};
    e.pts=e.raw.map(({h,it})=>{
      const v=Math.max(...it.logs.map(l=>setVal(l,e.kind)));
      const seg=bl.filter(b=>b<=h.startedAt+DAY/2).length;
      const best=it.logs.reduce((a,l)=>setVal(l,e.kind)>setVal(a,e.kind)?l:a,it.logs[0]);
      const vol=it.logs.reduce((s,l)=>s+(e.kind==="e1rm"?num(l.w)*num(l.r):num(l.r)),0);
      return{t:h.startedAt,v,seg,h,it,best,vol};
    }).filter(p=>p.v>0);
    e.pts.forEach(p=>{const m=segMax[p.seg];p.pr=m!=null&&p.v>m*1.001;segMax[p.seg]=Math.max(m||0,p.v)});
    const lastSeg=e.pts.length?e.pts[e.pts.length-1].seg:0;
    e.cur=e.pts.filter(p=>p.seg===lastSeg);
    e.retired=!p;
    e.change=e.cur.length>=2?(e.cur[e.cur.length-1].v/e.cur[0].v-1)*100:null;
    if(e.cur.length>=2){const n=e.cur.length,a=e.cur[Math.max(0,n-3)].v;e.recent=(e.cur[n-1].v/a-1)*100}else e.recent=null;
    e.stalled=e.cur.length>=3&&e.cur[e.cur.length-1].v<=e.cur[e.cur.length-3].v+1e-9;
  });
  return map;
}
const sessDur=h=>(h.source==="chat"&&!h.durKnown)?null:Math.round((h.finishedAt-h.startedAt)/60000);
const cardioDone=h=>h.items.some(x=>x.timed&&x.id==="cardio"&&x.done);
const absDone=h=>h.items.some(x=>x.abs&&x.logs&&x.logs.length);
function bodySeries(){
  const mergeBy=(a,b)=>{const m=new Map((a||[]).map(x=>[x.date,x]));(b||[]).forEach(x=>m.set(x.date,x));return[...m.values()].sort((x,y)=>x.date<y.date?-1:1)};
  const PB=(typeof D!=="undefined"&&D.body)||{},C=COACH||{};
  return{waist:mergeBy(C.waist,PB.waist),weight:mergeBy(C.weight,PB.weight),inbody:(C.inbody||[]).slice().sort((a,b)=>a.date<b.date?-1:1)};
}
function recentPRs(EX,n=4){
  const out=[];Object.values(EX).forEach(e=>{if(e.abs)return;e.pts.forEach(p=>{if(p.pr)out.push({e,p})})});
  return out.sort((a,b)=>b.p.t-a.p.t).slice(0,n);
}

/* ---------------- Chart.js helpers ---------------- */
const CH={};
const C_LIME="#B8F23A",C_PINK="#FF3D7F",C_SKY="#5AC8FA",C_MUTED="#9BA3AE",C_GRID="rgba(255,255,255,.06)";
if(window.Chart){
  Chart.defaults.color=C_MUTED;Chart.defaults.borderColor=C_GRID;
  Chart.defaults.font.family='"Rubik","Cairo",system-ui,sans-serif';Chart.defaults.font.size=11;
  Chart.defaults.animation.duration=350;
}
function destroyAll(scope){Object.keys(CH).forEach(k=>{if(!scope||!document.body.contains(CH[k].canvas)){CH[k].destroy();delete CH[k]}})}
function mount(id,cfg){
  const box=el(id);if(!box)return;
  if(CH[id]){CH[id].destroy();delete CH[id]}
  if(!window.Chart){box.innerHTML='<div class="empty">الرسوم مش متاحة (المكتبة ما اتحملتش).</div>';return}
  box.innerHTML="<canvas></canvas>";
  CH[id]=new Chart(box.querySelector("canvas"),cfg);
}
const baseTip={rtl:true,textDirection:"rtl",backgroundColor:"#20252B",borderColor:"#2E343C",borderWidth:1,titleColor:"#F3F5F7",bodyColor:"#F3F5F7",
  padding:10,cornerRadius:12,displayColors:false,titleFont:{family:"Cairo",weight:"700",size:13},bodyFont:{family:"Cairo",size:13}};
/* line over real time. pts:[{x,y,...}], gaps: insert null to break the line. */
function timeLine(id,sets,o={}){
  const xs=sets.flatMap(s=>s.data.filter(p=>p&&p.y!=null).map(p=>p.x));
  if(!xs.length){const b=el(id);if(b)b.innerHTML=`<div class="empty">${o.empty||"لسه مفيش قياسات في الفترة دي."}</div>`;return}
  let x0=o.min??Math.min(...xs),x1=Math.max(...xs,o.max??0);if(x1-x0<2*DAY){x0-=2*DAY;x1+=2*DAY}
  mount(id,{type:"line",data:{datasets:sets.map(s=>({borderColor:C_LIME,backgroundColor:C_LIME,borderWidth:2.5,tension:0,spanGaps:false,
      pointRadius:c=>c.raw&&c.raw.pr?6:(s.data.length>30?2:4),pointHoverRadius:7,
      pointBackgroundColor:c=>c.raw&&c.raw.pr?C_PINK:(c.raw&&c.raw.hollow?"#16191D":(s.color||C_LIME)),
      pointBorderColor:c=>c.raw&&c.raw.pr?C_PINK:(s.color||C_LIME),...s}))},
    options:{responsive:true,maintainAspectRatio:false,parsing:false,normalized:true,animations:{x:{duration:0}},
      interaction:{mode:"nearest",axis:"x",intersect:false},
      layout:{padding:{top:6,right:6,left:2}},
      plugins:{legend:{display:false},tooltip:{...baseTip,callbacks:{title:it=>it.length?longD(it[0].raw.x):"",label:c=>o.label?o.label(c.raw,c.dataset):`${r1(c.raw.y)}`,afterLabel:c=>c.raw.note||""}}},
      scales:{x:{type:"linear",min:x0,max:x1,grid:{display:false},ticks:{maxTicksLimit:5,maxRotation:0,callback:v=>shortD(v)}},
        y:{grid:{color:C_GRID},ticks:{maxTicksLimit:5,callback:v=>r1(v)},title:{display:!!o.unit,text:o.unit||"",color:C_MUTED,font:{family:"Cairo",size:11}},...(o.y||{})}}}});
}
/* bars by category label with an optional target line (same unit, same axis) */
function bars(id,labels,values,o={}){
  if(!values.some(v=>v!=null)){const b=el(id);if(b)b.innerHTML=`<div class="empty">${o.empty||"مفيش داتا في الفترة دي."}</div>`;return}
  const ds=[{type:"bar",data:values,backgroundColor:values.map((v,i)=>o.colorOf?o.colorOf(v,i):C_LIME),borderRadius:6,maxBarThickness:22,label:o.name||""}];
  (o.extra||[]).forEach(e=>ds.push({type:"bar",borderRadius:6,maxBarThickness:16,...e}));
  if(o.target!=null)ds.push({type:"line",data:labels.map(()=>o.target),borderColor:"rgba(243,245,247,.55)",borderDash:[6,5],borderWidth:1.5,pointRadius:0,pointHoverRadius:0,label:"الهدف"});
  mount(id,{type:"bar",data:{labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,
    interaction:{mode:"index",intersect:false},
    plugins:{legend:{display:false},tooltip:{...baseTip,displayColors:!!(o.extra&&o.extra.length),filter:i=>i.raw!=null,callbacks:{title:it=>it.length?(o.titleOf?o.titleOf(it[0].dataIndex):it[0].label):"",label:c=>o.label?o.label(c):`${c.dataset.label?c.dataset.label+": ":""}${c.raw}`}}},
    scales:{x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:7}},
      y:{beginAtZero:true,grid:{color:C_GRID},ticks:{maxTicksLimit:5},suggestedMax:o.target?o.target*1.15:undefined,title:{display:!!o.unit,text:o.unit||"",color:C_MUTED,font:{family:"Cairo",size:11}}}}}});
}
const rangeSeg=(cur,opts,attr="r")=>`<div class="seg" role="group" aria-label="الفترة">${opts.map(([v,l])=>`<button data-${attr}="${v}" aria-pressed="${cur===v}">${l}</button>`).join("")}</div>`;
const RANGES=[[7,"7 أيام"],[30,"30 يوم"],[90,"90 يوم"],[0,"الكل"]];
const since=r=>r?Date.now()-r*DAY:-Infinity;

/* ---------------- shared bits ---------------- */
const hdr=(title,sub,right)=>`<div class="hdr"><div><h1>${title}</h1>${sub?`<div class="sub">${sub}</div>`:""}</div>${right||""}</div>`;
function lockCard(why){
  if(coachState==="ok")return"";
  if(coachState==="loading")return`<div class="card"><p class="empty">بفتح الداتا…</p></div>`;
  return`<div class="card"><h2 style="font-size:17px">افتح داتا الكوتش</h2><p class="muted" style="font-size:14px;margin-top:4px">${why} الداتا متشفرة. اكتب الباسورد مرة واحدة على الموبايل ده.</p>
    <input id="passIn" class="fld" type="password" autocomplete="current-password" placeholder="الباسورد" aria-label="الباسورد" style="margin-top:12px">
    <button class="btn lime block" id="passBtn" style="margin-top:10px">افتح</button>${coachErr?`<p class="flag" style="margin-top:8px">${coachErr}</p>`:""}</div>`;
}
function wireLock(root){const b=root.querySelector("#passBtn");if(!b)return;const i=root.querySelector("#passIn");
  const go=()=>{if(i.value.trim())unlockWith(i.value.trim())};b.onclick=go;i.addEventListener("keydown",e=>{if(e.key==="Enter")go()})}
function ringSVG(v,of,color){const C=2*Math.PI*32,p=of?Math.min(1,v/of):0;
  return`<div class="ring"><svg viewBox="0 0 76 76" aria-hidden="true"><circle class="t" cx="38" cy="38" r="32"/><circle class="a" cx="38" cy="38" r="32" stroke="${color}" style="--full:${C}" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-p)}"/></svg><div class="c"><span class="num">${v}<small class="muted" style="font-size:12px">/${of}</small></span></div></div>`}
const delta=(d,unit,goodWhenDown=true)=>{if(d==null)return"";const cls=Math.abs(d)<.05?"flat":(d<0)===goodWhenDown?"good":"bad";return`<span class="delta ${cls}"><span class="num">${sgn(d)}</span> ${unit}</span>`};

/* ---------------- HOME ---------------- */
function renderHome(){
  const root=el("v-home"),S=allSessions(),EX=exerciseSeries(S),ws=weekStart(),wk=S.filter(h=>h.startedAt>=ws);
  const nd=nextDayKey(),P=D.plans[nd]||[],first=P.find(x=>!x.optional)||P[0],act=D.active;
  const B=bodySeries(),wt=B.weight,wa=B.waist,lastW=wt[wt.length-1],lastWa=wa[wa.length-1];
  const d30=(arr,k)=>{if(arr.length<2)return null;const last=arr[arr.length-1],t=parseD(last.date)-30*DAY;const base=arr.find(x=>parseD(x.date)>=t)||arr[0];return base===last?null:last[k]-base[k]};
  const prs=recentPRs(EX),h=new Date().getHours(),greet=h<12?"صباح الخير":h<18?"أهلاً":"مساء الخير";
  const exs=Object.values(EX).filter(e=>!e.abs&&!e.retired&&e.recent!=null);
  const top=exs.filter(e=>e.recent>0).sort((a,b)=>b.recent-a.recent)[0],stalled=exs.filter(e=>e.stalled);
  const pw=programWeek(),pr=prog();
  const insights=[];
  if(top)insights.push(`أكتر تمرين اتحسن مؤخراً: <b>${esc(top.name)}</b> <span class="num delta good">${pct(top.recent)}</span>`);
  if(stalled.length)insights.push(`واقف آخر مرتين: <b>${stalled.slice(0,3).map(e=>esc(e.name)).join("، ")}</b>${stalled.length>3?` و${stalled.length-3} كمان`:""}`);
  const durs=wk.map(sessDur).filter(v=>v!=null);if(durs.length)insights.push(`متوسط مدة التمرينة الأسبوع ده: <b class="num">${hm(Math.round(durs.reduce((a,b)=>a+b,0)/durs.length))}</b>`);
  root.innerHTML=hdr(`${greet}، ${esc(D.profile&&D.profile.name||"")}`,longD(Date.now())+(pw>=1&&pw<=pr.weeks?` • أسبوع <span class="num">${pw}</span> من ${pr.weeks}`:""),
      `<a class="icon-btn" href="#/settings" aria-label="الإعدادات" style="color:var(--muted)"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg></a>`)+
    (isDeload()?`<div class="card" style="border-color:rgba(90,200,250,.4);margin-bottom:12px"><b>أسبوع الديلود</b><div class="muted" style="font-size:14px">نص الستات، نفس الأوزان، ووقف وفاضلك 3 عدات. التطبيق بيظبطها لوحده.</div></div>`:"")+
    (act?`<div class="hero">${IMG(imgOf((act.items.find(x=>!x.timed)||{}).id),"")}<div class="in"><div class="lbl">تمرين شغال</div><h2>${DAYS[act.day].t}</h2>
        <div class="meta">بدأ ${clock(act.startedAt)} • <span class="num">${act.items.filter(x=>x.timed?(x.done||x.skip):(x.skip||(x.rows||[]).filter(r=>r.done).length>=x.sets)).length}/${act.items.length}</span> تمارين</div>
        <a class="btn lime block" href="#/workout">كمّل التمرين</a></div></div>`
     :`<div class="hero">${IMG(first?imgOf(first.id):"",first?first.name:"")}<div class="in"><div class="lbl">تمرين النهارده</div><h2>${DAYS[nd].t}</h2>
        <div class="meta">${DAYS[nd].d} • <span class="num">${P.filter(x=>!x.optional).length}</span> تمارين</div>
        <button class="btn lime block" id="homeStart">ابدأ التمرين</button></div></div>`)+
    `<div class="sec"><h2>الأسبوع ده</h2>${new Date().getDay()===5||wk.length?`<button id="repOpen">تقرير الأسبوع</button>`:""}</div>
    <div class="card"><div class="rings3"><div>${ringSVG(wk.length,6,C_LIME)}<div class="ring-k">تمرين</div></div>
      <div>${ringSVG(wk.filter(cardioDone).length,4,C_SKY)}<div class="ring-k">كارديو</div></div><div>${ringSVG(wk.filter(absDone).length,3,C_PINK)}<div class="ring-k">بطن</div></div></div></div>`+
    `<div class="sec"><h2>الجسم</h2><a href="#/body">الكل</a></div>
    <div class="grid2"><div class="stat"><div class="k">الوزن</div><div class="v num">${lastW?lastW.kg:"—"}<small> كجم</small></div>${lastW?`<div class="muted" style="font-size:12px">${shortD(parseD(lastW.date))} ${delta(d30(wt,"kg"),"كجم")}</div>`:`<div class="muted" style="font-size:12px">سجّل من الجسم</div>`}</div>
      <div class="stat"><div class="k">الوسط</div><div class="v num">${lastWa?lastWa.cm:"—"}<small> سم</small></div>${lastWa?`<div class="muted" style="font-size:12px">${shortD(parseD(lastWa.date))} ${delta(d30(wa,"cm"),"سم")}</div>`:`<div class="muted" style="font-size:12px">سجّل من الجسم</div>`}</div></div>
    ${wa.length>=2?`<div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:14px"><b>الوسط آخر 90 يوم</b><span class="muted">سم</span></div><div class="chartbox sm" id="hWaist"></div></div>`:""}`+
    `<div class="sec"><h2>أرقام قياسية</h2><a href="#/progress">التقدم</a></div>`+
    (prs.length?`<div class="list">${prs.map(({e,p})=>`<div class="row">${IMG(imgOf(e.id),e.name,"thumb")||'<span class="thumb"></span>'}<div class="grow"><div class="t">${esc(e.name)} <span class="pr">PR</span></div><span class="s"><span class="num">${esc(setsTxt([p.best],p.it))}</span> • ${shortD(p.t)}</span></div></div>`).join("")}</div>`
      :`<div class="card empty"><b>لسه مفيش أرقام قياسية</b>أول ما تكسر رقمك في أي تمرين هيظهر هنا.</div>`)+
    (insights.length?`<div class="sec"><h2>ملاحظات</h2></div><div class="card" style="display:grid;gap:8px;font-size:15px">${insights.map(x=>`<div>${x}</div>`).join("")}</div>`:"")+
    `<div class="sec"><h2>آخر التمرينات</h2></div>`+
    (S.length?`<div class="list">${S.slice(-5).reverse().map(h=>{const m=sessDur(h),n=h.items.filter(x=>!x.timed&&x.logs&&x.logs.length).length;
      return`<a class="row" href="#/summary/${h.startedAt}" style="color:inherit;text-decoration:none"><div class="grow"><div class="t">${DAYN[h.day]||h.day} <span class="muted" style="font-weight:400">• ${shortD(h.startedAt)}</span></div><span class="s">${n} تمارين${m!=null?` • <span class="num">${hm(m)}</span>`:""}${cardioDone(h)?" • كارديو":""}${absDone(h)?" • بطن":""}</span></div><span class="chev">‹</span></a>`}).join("")}</div>`
      :`<div class="card empty"><b>لسه مفيش تمرينات</b>ابدأ أول تمرينة وهتتسجل هنا.</div>`)+
    (coachState!=="ok"?`<div style="margin-top:12px">${lockCard("الوزن والوسط والتمرينات القديمة جوه داتا الكوتش.")}</div>`:"");
  wireLock(root);
  const hs=el("homeStart");if(hs)hs.onclick=()=>GTT_startWorkoutFor(nd);
  const ro=el("repOpen");if(ro)ro.onclick=()=>GTT_openReport();
  if(wa.length>=2){const t=Date.now()-90*DAY;timeLine("hWaist",[{data:wa.filter(x=>parseD(x.date)>=t).map(x=>({x:parseD(x.date),y:x.cm}))}],{label:p=>`${p.y} سم`,empty:"مفيش قياسات في آخر 90 يوم."})}
}

/* ---------------- PROGRESS ---------------- */
function renderProgress(){
  const root=el("v-progress"),S=allSessions(),EX=exerciseSeries(S);
  const tabs=[["perf","الأداء"],["str","القوة"],["adh","الالتزام"]];
  root.innerHTML=hdr("التقدم","",`<button class="btn ghost sm" id="repOpen">تقرير الأسبوع</button>`)+
    (coachState!=="ok"?lockCard("التمرينات القديمة من الشات جوه داتا الكوتش."):"")+
    `<div class="seg" role="tablist">${tabs.map(([k,l])=>`<button role="tab" data-tab="${k}" aria-pressed="${UI.progTab===k}">${l}</button>`).join("")}</div><div id="progBody"></div>`;
  wireLock(root);
  el("repOpen").onclick=()=>GTT_openReport();
  root.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{UI.progTab=b.dataset.tab;renderProgress()});
  const body=el("progBody");
  if(!S.length){body.innerHTML=`<div class="card empty"><b>لسه مفيش تمرينات</b>بعد أول تمرينة هتلاقي الرسوم هنا.</div>`;return}
  if(UI.progTab==="perf")progPerf(body,EX);else if(UI.progTab==="str")progStrength(body,S,EX);else progAdh(body,S);
}
function progPerf(body,EX){
  const list=Object.values(EX).filter(e=>!e.retired);
  const groups=[["push","Push"],["pull","Pull"],["legs","Legs"]];
  if(!UI.progEx||!EX[UI.progEx]){const last=list.filter(e=>!e.abs).sort((a,b)=>b.pts[b.pts.length-1].t-a.pts[a.pts.length-1].t)[0];UI.progEx=last?last.id:(list[0]||{}).id}
  const e=EX[UI.progEx];
  if(!e){body.innerHTML=`<div class="card empty"><b>مفيش تمارين متسجلة</b></div>`;return}
  const from=since(UI.range),pts=e.pts.filter(p=>p.t>=from),bl=baselinesFor(e.id);
  const unit=e.kind==="e1rm"?(e.unit&&e.unit!=="كجم"?e.unit:"كجم"):(e.raw.some(x=>x.it.seconds)?"ثانية":"عدة");
  const opt=x=>`<option value="${x.id}" ${x.id===e.id?"selected":""}>${esc(x.name)}</option>`;
  body.innerHTML=`<label for="exSel">التمرين</label><select id="exSel" class="fld">${groups.map(([k,l])=>{const g=list.filter(x=>!x.abs&&x.day===k);return g.length?`<optgroup label="${l}">${g.map(opt).join("")}</optgroup>`:""}).join("")}
      ${list.some(x=>x.abs)?`<optgroup label="بطن">${list.filter(x=>x.abs).map(opt).join("")}</optgroup>`:""}</select>
    <div style="margin-top:12px">${rangeSeg(UI.range,RANGES)}</div>
    <div class="grid3">${(()=>{const c=e.cur,last=c[c.length-1];return`<div class="stat"><div class="k">آخر مرة</div><div class="v num" style="font-size:19px">${last?esc(setsTxt([last.best],last.it)):"—"}</div></div>
      <div class="stat"><div class="k">${e.kind==="e1rm"?"القوة التقديرية":"أحسن"}</div><div class="v num" style="font-size:19px">${last?r1(last.v):"—"}</div></div>
      <div class="stat"><div class="k">من البداية</div><div class="v num" style="font-size:19px;color:${e.change>0?"var(--lime)":"var(--ink)"}">${e.change!=null?pct(e.change):"جديد"}</div></div>`})()}</div>
    <div class="card" style="margin-top:12px"><b>${e.kind==="e1rm"?"القوة التقديرية (1RM)":"أحسن ست"}</b><div class="muted" style="font-size:13px">${e.kind==="e1rm"?"محسوبة من الوزن والعدات (Epley). النقطة الوردي = رقم قياسي":"أعلى عدات في ست. النقطة الوردي = رقم قياسي"}</div>
      <div class="chartbox" id="cEx"></div><div class="legend"><span><i></i>${e.kind==="e1rm"?"1RM تقديري":"أحسن ست"} (${esc(unit)})</span><span><i class="pink"></i>PR</span>${bl.length?'<span><i class="ref"></i>جهاز جديد: الخط بيبدأ من جديد</span>':""}</div></div>
    <div class="card" style="margin-top:12px"><b>الحجم في كل تمرينة</b><div class="muted" style="font-size:13px">${e.kind==="e1rm"?"مجموع الوزن × العدات في كل الستات":"مجموع العدات في كل الستات"}</div><div class="chartbox sm" id="cVol"></div></div>
    <details class="more"><summary>كل المرات</summary><table class="dt"><tr><th>التاريخ</th><th>الستات</th><th>${e.kind==="e1rm"?"1RM":"أحسن"}</th></tr>
      ${e.pts.slice().reverse().map(p=>`<tr><td>${shortD(p.t)}${p.pr?' <span class="pr">PR</span>':""}</td><td class="n">${esc(setsTxt(p.it.logs,p.it))}</td><td class="n">${r1(p.v)}</td></tr>`).join("")}</table></details>`;
  el("exSel").onchange=ev=>{UI.progEx=ev.target.value;progPerf(body,EX)};
  body.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{UI.range=+b.dataset.r;progPerf(body,EX)});
  // break the line at each new-equipment baseline
  const data=[];pts.forEach((p,i)=>{if(i&&pts[i-1].seg!==p.seg)data.push({x:(pts[i-1].t+p.t)/2,y:null});
    data.push({x:p.t,y:r1(p.v),pr:p.pr,note:`${setsTxt(p.it.logs,p.it)}${p.it.rir?` • RIR ${p.it.rir}`:""}${p.h.approxDate?" • التاريخ تقريبي":""}`})});
  timeLine("cEx",[{data}],{min:UI.range?from:undefined,max:Date.now(),unit,label:p=>`${p.pr?"رقم قياسي • ":""}${p.y} ${unit}`,empty:"مفيش مرات في الفترة دي. جرّب فترة أطول."});
  bars("cVol",pts.map(p=>shortD(p.t)),pts.map(p=>Math.round(p.vol)),{colorOf:(v,i)=>pts[i].pr?C_PINK:"rgba(184,242,58,.75)",unit:e.kind==="e1rm"?unit:"عدة",
    titleOf:i=>longD(pts[i].t),label:c=>`${c.raw.toLocaleString("en-US")} ${e.kind==="e1rm"?unit:"عدة"}`,empty:"مفيش مرات في الفترة دي."});
}
function progStrength(body,S,EX){
  const from=since(UI.range);
  // strength index: each exercise's best set vs its first session on the current equipment, averaged per workout
  const idx={push:[],pull:[],legs:[]};
  S.forEach(h=>{if(!idx[h.day])return;const vals=[];
    h.items.forEach(it=>{const e=EX[it.id];if(!e||e.abs||e.retired)return;const p=e.cur.find(q=>q.h===h);if(!p)return;vals.push(p.v/e.cur[0].v*100)});
    if(vals.length>=2&&h.startedAt>=from)idx[h.day].push({x:h.startedAt,y:r1(vals.reduce((a,b)=>a+b,0)/vals.length),note:`${vals.length} تمارين`})});
  const exs=Object.values(EX).filter(e=>!e.abs&&!e.retired).sort((a,b)=>(b.change??-1e9)-(a.change??-1e9));
  body.innerHTML=rangeSeg(UI.range,RANGES)+
    `<div class="card"><b>مؤشر القوة لكل يوم</b><div class="muted" style="font-size:13px">100 = أول مرة على نفس الجهاز. فوق 100 يعني أقوى</div><div class="chartbox lg" id="cStr"></div>
      <div class="legend"><span><i></i>Legs</span><span><i style="background:${C_SKY}"></i>Push</span><span><i class="pink"></i>Pull</span></div></div>
    <div class="sec"><h2>التغيير في كل تمرين</h2></div>
    <div class="list">${exs.map(e=>`<button class="row" data-ex="${e.id}">${IMG(imgOf(e.id),e.name,"thumb")||'<span class="thumb"></span>'}<span class="grow"><span class="t">${esc(e.name)}</span><span class="s">${e.cur.length} مرة${e.stalled?" • واقف":""}</span></span><span class="num delta ${e.change>0?"good":"flat"}">${e.change!=null?pct(e.change):"جديد"}</span></button>`).join("")}</div>`;
  body.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{UI.range=+b.dataset.r;progStrength(body,S,EX)});
  body.querySelectorAll("[data-ex]").forEach(b=>b.onclick=()=>{UI.progEx=b.dataset.ex;UI.progTab="perf";renderProgress();window.scrollTo(0,0)});
  timeLine("cStr",[{data:idx.legs,label:"Legs"},{data:idx.push,label:"Push",borderColor:C_SKY,backgroundColor:C_SKY,color:C_SKY},{data:idx.pull,label:"Pull",borderColor:C_PINK,backgroundColor:C_PINK,color:C_PINK}],
    {min:UI.range?from:undefined,max:Date.now(),unit:"%",label:(p,ds)=>`${ds.label}: ${p.y}`,empty:"محتاج تمرينتين على الأقل من نفس اليوم."});
}
function progAdh(body,S){
  const ws=weekStart(),n=UI.adhWeeks,W=[];
  for(let i=n-1;i>=0;i--){const a=ws-i*7*DAY,b=a+7*DAY,ss=S.filter(h=>h.startedAt>=a&&h.startedAt<b);W.push({a,n:ss.length,c:ss.filter(cardioDone).length,ab:ss.filter(absDone).length})}
  const wk=S.filter(h=>h.startedAt>=ws);
  const vol={};wk.forEach(h=>h.items.forEach(x=>{const m=MUSCLE[x.id];if(m&&x.logs)vol[m]=(vol[m]||0)+x.logs.length}));
  const skips=[];wk.forEach(h=>h.items.forEach(x=>{if((x.timed?!x.done:!(x.logs&&x.logs.length))&&!x.optional&&x.id!=="warmup")skips.push(x)}));
  const reasons={};skips.forEach(x=>{const r=x.skip||"من غير سبب";reasons[r]=(reasons[r]||0)+1});
  body.innerHTML=rangeSeg(n,[[4,"4 أسابيع"],[8,"8 أسابيع"],[12,"12 أسبوع"]],"w")+
    `<div class="card"><b>التمرينات كل أسبوع</b><div class="muted" style="font-size:13px">الهدف 6 في الأسبوع (الأسبوع بيبدأ السبت)</div><div class="chartbox" id="cAdh"></div>
      <div class="legend"><span><i></i>تمرين</span><span><i class="ref"></i>الهدف 6</span></div></div>
    <div class="card" style="margin-top:12px"><b>الكارديو والبطن</b><div class="muted" style="font-size:13px">الهدف: كارديو 4، بطن 3</div><div class="chartbox sm" id="cCa"></div>
      <div class="legend"><span><i style="background:${C_SKY}"></i>كارديو</span><span><i class="pink"></i>بطن</span></div></div>
    <div class="sec"><h2>ستات كل عضلة الأسبوع ده</h2></div>
    <div class="list">${MUSCLE_ORDER.filter(m=>vol[m]).map(m=>`<div class="row"><span class="grow t">${m}</span><span class="num end">${vol[m]}</span></div>`).join("")||'<div class="empty">لسه مفيش تمرينات الأسبوع ده.</div>'}</div>
    ${skips.length?`<div class="card" style="margin-top:12px;font-size:14px"><b>اتشال الأسبوع ده (${skips.length})</b><div class="muted">${Object.entries(reasons).map(([r,c])=>`${esc(r)} ${c}`).join("، ")}</div></div>`:""}`;
  body.querySelectorAll("[data-w]").forEach(b=>b.onclick=()=>{UI.adhWeeks=+b.dataset.w;progAdh(body,S)});
  const labels=W.map(w=>shortD(w.a));
  bars("cAdh",labels,W.map(w=>w.n),{target:6,unit:"تمرين",colorOf:v=>v>=6?C_LIME:"rgba(184,242,58,.55)",titleOf:i=>`أسبوع ${shortD(W[i].a)}`,label:c=>c.dataset.type==="line"?"الهدف: 6":`${c.raw} تمرين`});
  bars("cCa",labels,W.map(w=>w.c),{colorOf:()=>C_SKY,name:"كارديو",unit:"مرة",extra:[{data:W.map(w=>w.ab),backgroundColor:C_PINK,label:"بطن"}],titleOf:i=>`أسبوع ${shortD(W[i].a)}`,label:c=>`${c.dataset.label}: ${c.raw}`});
}

/* ---------------- WEEKLY REPORT (text for the chat) ---------------- */
function weekReport(){
  const S=allSessions(),EX=exerciseSeries(S),ws=weekStart(),wk=S.filter(h=>h.startedAt>=ws);
  const card=wk.filter(cardioDone).length,ab=wk.filter(absDone).length;
  const ups=[],flat=[];
  Object.values(EX).forEach(e=>{if(e.abs)return;const inWk=e.cur.filter(p=>p.t>=ws);if(!inWk.length)return;
    const before=e.cur.filter(p=>p.t<ws);if(!before.length)return;
    const best=Math.max(...inWk.map(p=>p.v)),prevMax=Math.max(...before.map(p=>p.v)),last=before[before.length-1].v;
    const ch=(best/last-1)*100;(ch>0.5?ups:flat).push(`${e.name} ${pct(ch)}${best>prevMax*1.001?" 🎉":""}`)});
  const skips=[];wk.forEach(h=>h.items.forEach(x=>{if((x.timed?!x.done:!(x.logs&&x.logs.length))&&!x.optional&&x.id!=="warmup")skips.push(`${x.name}${x.skip?` (${x.skip})`:""}`)}));
  const durs=wk.map(sessDur).filter(v=>v!=null),wa=bodySeries().waist;
  const lines=[`تقرير الأسبوع (من ${shortD(ws)})`,`تمرينات: ${wk.length} من 6 • كارديو: ${card} من 4 • بطن: ${ab} من 3`];
  if(durs.length)lines.push(`متوسط مدة التمرينة: ${hm(Math.round(durs.reduce((a,b)=>a+b,0)/durs.length))}`);
  if(wa.length)lines.push(`آخر قياس وسط: ${wa[wa.length-1].cm} سم (${shortD(parseD(wa[wa.length-1].date))})`);
  lines.push("",`اتحسن (${ups.length}): ${ups.length?ups.join("، "):"مفيش"}`,`ثابت أو نزل (${flat.length}): ${flat.length?flat.join("، "):"مفيش"}`);
  if(skips.length)lines.push(`اتشال: ${skips.join("، ")}`);
  wk.forEach(h=>{lines.push("",`${DAYN[h.day]||h.day} • ${shortD(h.startedAt)}`);
    h.items.forEach(x=>{if(x.timed){lines.push(`- ${x.name}: ${x.done?"✅":"❌"}`);return}if(x.logs&&x.logs.length)lines.push(`- ${x.name}: ${setsTxt(x.logs,x)}${x.rir?` (RIR ${x.rir})`:""}`)})});
  return lines.join("\n");
}
window.GTT_weekReport=weekReport;

/* ---------------- BODY ---------------- */
const AREA={shoulders:"الأكتاف",chest_upper:"أعلى الصدر",chest_mid_lower:"الصدر الأوسط والسفلي",arms_biceps:"البايسبس",arms_triceps:"الترايسبس",
  back_width:"عرض الضهر (اللاتس)",back_lower:"أسفل الضهر",abs_upper:"البطن العلوية",abs_lower_waist:"البطن السفلية والوسط",legs:"الرجل"};
const LVL={strong:["قوي","strong"],average:["متوسط",""],weak:["ضعيف","weak"],not_visible:["مش باين","na"]};
function renderBody(r){
  const root=el("v-body"),sub=r&&r.sub==="photos"?"photos":"stats";
  root.innerHTML=hdr("الجسم",COACH&&COACH.updated?`آخر تحديث من الكوتش ${shortD(parseD(COACH.updated))}`:"")+
    `<div class="seg"><button data-go="body" aria-pressed="${sub==="stats"}">القياسات</button><button data-go="body/photos" aria-pressed="${sub==="photos"}">الصور</button></div><div id="bodyIn"></div>`;
  root.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go,true));
  sub==="photos"?bodyPhotos(el("bodyIn")):bodyStats(el("bodyIn"));
}
function bodyStats(box){
  const B=bodySeries(),wt=B.weight,wa=B.waist,ib=B.inbody;
  const clean=ib.filter(x=>x.clean),lastIb=clean[clean.length-1]||ib[ib.length-1];
  const lastW=wt[wt.length-1],lastWa=wa[wa.length-1];
  const tile=(k,v,u,d)=>`<div class="stat"><div class="k">${k}</div><div class="v num">${v??"—"}<small> ${u}</small></div><div class="muted" style="font-size:12px">${d||"&nbsp;"}</div></div>`;
  const P=(COACH&&COACH.physique||[]).slice().sort((a,b)=>a.date<b.date?-1:1);
  const full=P.filter(p=>Object.values(p.areas||{}).filter(a=>a.level!=="not_visible").length>=6);
  const latest=full[full.length-1]||P[P.length-1],areas=latest?Object.entries(latest.areas):[];
  const from=since(UI.bodyRange);
  box.innerHTML=`<div class="grid2">${tile("الوزن",lastW&&lastW.kg,"كجم",lastW&&shortD(parseD(lastW.date)))}${tile("الوسط",lastWa&&lastWa.cm,"سم",wa.length>1?`${delta(wa[wa.length-1].cm-wa[0].cm,"سم")} من ${shortD(parseD(wa[0].date))}`:lastWa&&shortD(parseD(lastWa.date)))}
      ${tile("الدهون",lastIb&&lastIb.fat_pct,"%",lastIb&&`InBody ${shortD(parseD(lastIb.date))}`)}${tile("العضل",lastIb&&lastIb.smm,"كجم",lastIb?"Skeletal Muscle":"")}</div>
    <div class="card" style="margin-top:12px"><b>سجّل قياس</b><div class="muted" style="font-size:13px">الصبح صايم قبل التمرين، الوسط عند السرة</div>
      <div class="entry"><div><label for="inWaist">الوسط (سم)</label><input id="inWaist" class="fld" inputmode="decimal" placeholder="${lastWa?lastWa.cm:"81"}" value="${esc(UI.draft.waist)}"></div>
      <div><label for="inWeight">الوزن (كجم)</label><input id="inWeight" class="fld" inputmode="decimal" placeholder="${lastW?lastW.kg:"77"}" value="${esc(UI.draft.weight)}"></div>
      <button class="btn lime" id="inSave">حفظ</button></div><p class="flag" id="inMsg" style="margin-top:8px"></p></div>
    <div style="margin-top:12px">${rangeSeg(UI.bodyRange,RANGES)}</div>
    <div class="card"><b>الوزن</b><div class="muted" style="font-size:13px">الوزن لوحده بيتأثر بالمية والكارب والكرياتين</div><div class="chartbox" id="cWt"></div></div>
    <div class="card" style="margin-top:12px"><b>الوسط</b><div class="muted" style="font-size:13px">أوضح مؤشر إن الدهون بتنزل</div><div class="chartbox" id="cWaist"></div></div>
    ${ib.length?`<details class="more" id="ibMore"><summary>InBody</summary><div class="muted" style="font-size:13px">الدايرة الفاضية = قياس بعد تمرين (أقل دقة)</div>
      <b style="display:block;margin-top:10px">الدهون %</b><div class="chartbox sm" id="cFat"></div><b style="display:block;margin-top:10px">العضل (كجم)</b><div class="chartbox sm" id="cSmm"></div></details>`:""}
    ${latest?`<div class="sec"><h2>تقييم العضلات من الصور</h2><span class="muted" style="font-size:13px">${shortD(parseD(latest.date))}</span></div>
      <div class="list">${areas.map(([k,a])=>`<div class="row"><div class="grow"><div class="t">${AREA[k]||k}</div><span class="s">${esc(a.note||"")}</span></div><span class="lvl ${LVL[a.level]?.[1]||""}">${LVL[a.level]?.[0]||esc(a.level)}</span></div>`).join("")}</div>`:""}
    ${coachState!=="ok"?`<div style="margin-top:12px">${lockCard("الـ InBody والقياسات القديمة جايه من شات Body Tracker.")}</div>`:""}`;
  wireLock(box);
  ["inWaist","inWeight"].forEach(id=>el(id).addEventListener("input",ev=>{UI.draft[id==="inWaist"?"waist":"weight"]=ev.target.value}));
  el("inSave").onclick=()=>{
    const w=num(el("inWaist").value),k=num(el("inWeight").value),okW=w>40&&w<200,okK=k>30&&k<250;
    if(!okW&&!okK){el("inMsg").textContent="اكتب الوسط أو الوزن الأول.";return}
    const d=dkey(Date.now());D.body=D.body||{};
    const put=(key,obj)=>{const a=(D.body[key]=D.body[key]||[]).filter(x=>x.date!==d);a.push(obj);D.body[key]=a.sort((x,y)=>x.date<y.date?-1:1)};
    if(okW)put("waist",{date:d,cm:w,note:"من التطبيق"});if(okK)put("weight",{date:d,kg:k,source:"scale",note:"من التطبيق"});
    UI.draft={waist:"",weight:""};save();try{window.GTT_queueSync&&GTT_queueSync()}catch(e){};toast("القياس اتحفظ ✓","ok");bodyStats(box)};
  box.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{UI.bodyRange=+b.dataset.r;bodyStats(box)});
  const inR=x=>parseD(x.date)>=from,o={min:UI.bodyRange?from:undefined,max:Date.now()};
  const dirty=d=>ib.some(i=>i.date===d&&!i.clean);
  timeLine("cWt",[{data:wt.filter(inR).map(x=>({x:parseD(x.date),y:x.kg,hollow:x.source==="inbody"&&dirty(x.date),note:x.note||""}))}],{...o,unit:"كجم",label:p=>`${p.y} كجم`});
  timeLine("cWaist",[{data:wa.filter(inR).map(x=>({x:parseD(x.date),y:x.cm,note:x.note||""}))}],{...o,unit:"سم",label:p=>`${p.y} سم`});
  const more=el("ibMore");if(more)more.addEventListener("toggle",()=>{if(!more.open)return;
    timeLine("cFat",[{data:ib.map(x=>({x:parseD(x.date),y:x.fat_pct,hollow:!x.clean,note:`${x.fat_kg} كجم دهون${x.clean?"":" • بعد تمرين"}`}))}],{unit:"%",label:p=>`${p.y}%`});
    timeLine("cSmm",[{data:ib.map(x=>({x:parseD(x.date),y:x.smm,hollow:!x.clean,note:x.clean?"":"بعد تمرين"}))}],{unit:"كجم",label:p=>`${p.y} كجم`})});
}

/* progress photos: kept only on this phone (IndexedDB), downscaled to save space */
const PDB={db:null,
  open(){return this.db?Promise.resolve(this.db):new Promise((res,rej)=>{const r=indexedDB.open("rep-photos",1);r.onupgradeneeded=()=>r.result.createObjectStore("photos",{keyPath:"id"});r.onsuccess=()=>{this.db=r.result;res(this.db)};r.onerror=()=>rej(r.error)})},
  async tx(mode,fn){const db=await this.open();return new Promise((res,rej)=>{const t=db.transaction("photos",mode),s=t.objectStore("photos"),out=fn(s);t.oncomplete=()=>res(out&&out.result);t.onerror=()=>rej(t.error)})},
  all(){return this.tx("readonly",s=>s.getAll())},put(x){return this.tx("readwrite",s=>s.put(x))},del(id){return this.tx("readwrite",s=>s.delete(id))}};
const POSES={front:"أمام",side:"جنب",back:"ضهر"};
function shrink(file,max=1080){return new Promise((res,rej)=>{const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{const s=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>b?res(b):rej(new Error("blob")),"image/jpeg",.82)};
  img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("img"))};img.src=url})}
let photoURLs=[];
async function bodyPhotos(box){
  box.innerHTML=`<div class="card"><b>صور التقدم</b><div class="muted" style="font-size:13px">بتتحفظ على الموبايل ده بس، ومش بتترفع على GitHub ولا بتدخل في النسخة الاحتياطية. نفس الإضاءة والمكان كل أسبوع.</div>
      <div class="seg" style="margin-top:12px">${Object.entries(POSES).map(([k,l])=>`<button data-pose="${k}" aria-pressed="${UI.pose===k}">${l}</button>`).join("")}</div>
      <label class="btn lime block" for="phIn" style="margin:0;color:var(--lime-ink);font-size:16px">+ ضيف صورة</label><input id="phIn" type="file" accept="image/*" class="hidden"></div>
    <div id="phList" style="margin-top:12px"><div class="empty">بحمّل…</div></div>`;
  box.querySelectorAll("[data-pose]").forEach(b=>b.onclick=()=>{UI.pose=b.dataset.pose;box.querySelectorAll("[data-pose]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
  el("phIn").onchange=async ev=>{const f=ev.target.files[0];if(!f)return;try{const blob=await shrink(f);await PDB.put({id:Date.now(),date:dkey(Date.now()),pose:UI.pose,blob});toast("الصورة اتحفظت ✓","ok")}catch(e){toast("مقدرتش أحفظ الصورة")}bodyPhotos(box)};
  let list=[];try{list=await PDB.all()}catch(e){el("phList").innerHTML='<div class="card empty"><b>التخزين مش متاح</b>المتصفح ده مش سامح بحفظ الصور.</div>';return}
  photoURLs.forEach(u=>URL.revokeObjectURL(u));photoURLs=[];
  if(!list.length){el("phList").innerHTML='<div class="card empty"><b>لسه مفيش صور</b>صوّر أمام وجنب وضهر مرة في الأسبوع عشان تقارن.</div>';return}
  const byDate={};list.sort((a,b)=>b.id-a.id).forEach(p=>(byDate[p.date]=byDate[p.date]||[]).push(p));
  el("phList").innerHTML=Object.entries(byDate).map(([d,ps])=>`<div class="sec" style="margin-top:14px"><h2>${longD(parseD(d))}</h2></div><div class="photos">${ps.map(p=>{const u=URL.createObjectURL(p.blob);photoURLs.push(u);
      return`<figure><img src="${u}" alt="صورة ${POSES[p.pose]||""} ${d}" data-view="${p.id}"><figcaption>${POSES[p.pose]||""}</figcaption><button class="del" data-del="${p.id}" aria-label="امسح الصورة">✕</button></figure>`}).join("")}</div>`).join("");
  box.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!armed(b,"؟"))return;await PDB.del(+b.dataset.del);bodyPhotos(box)});
  box.querySelectorAll("[data-view]").forEach(im=>im.onclick=()=>{const sh=el("sheet");sh.innerHTML=`<div class="sheet"><div class="grab"></div><img src="${im.src}" alt="${esc(im.alt)}" style="width:100%;border-radius:16px"></div>`;sh.classList.remove("hidden");sh.onclick=()=>sh.classList.add("hidden")});
}

/* ---------------- FOOD ---------------- */
function renderFood(){
  const root=el("v-food");
  if(coachState!=="ok"){root.innerHTML=hdr("الأكل","")+lockCard("السعرات جايه من شات Calorie Tracker.");wireLock(root);return}
  const N=COACH.nutrition||{},T=N.targets||{};
  const all=(N.days||[]).slice().sort((a,b)=>a.date<b.date?-1:1);
  if(!all.length||!T.kcal){root.innerHTML=hdr("الأكل","")+`<div class="card empty"><b>مفيش أيام أكل متسجلة</b>الأيام بتتسجل في شات Calorie Tracker وبتوصل هنا.</div>`;return}
  const DT=N.dayTargets||{},tg=dt=>{const o=DT[dt]||{};return{kcal:o.kcal||T.kcal,p:(o.protein||T.protein||[0])[0],c:(o.carbs||T.carbs||[0])[0],f:(o.fat||T.fat||[0])[0],m:!!DT[dt]}};
  const last=all[all.length-1],L=tg(last.date),kT=L.kcal,pT=L.p,todayK=dkey(Date.now()),nextM=Object.keys(DT).filter(k=>k>=todayK).sort()[0];
  const R=UI.foodRange,end=new Date();end.setHours(12,0,0,0);
  const nDays=R||Math.max(1,Math.round((end.getTime()-parseD(all[0].date))/DAY)+1);
  const keys=[];for(let i=nDays-1;i>=0;i--)keys.push(dkey(end.getTime()-i*DAY));
  const map=new Map(all.map(d=>[d.date,d])),days=keys.map(k=>map.get(k)||null);
  const full=days.filter(d=>d&&d.kcal!=null&&!d.partial);
  const avg=f=>full.length?Math.round(full.reduce((a,d)=>a+(d[f]||0),0)/full.length):null;
  const inBand=full.filter(d=>{const k=tg(d.date).kcal;return d.kcal>=k*.9&&d.kcal<=k*1.1}).length,pHit=full.filter(d=>d.protein>=tg(d.date).p).length;
  const lp=(v,t)=>t?Math.min(100,Math.round(v/t*100)):0;
  const macro=(k,v,t,u)=>`<div><div style="display:flex;justify-content:space-between;font-size:13px"><span class="muted">${k}</span><span class="num">${v??"—"} / ${t} ${u}</span></div><div style="height:6px;border-radius:3px;background:var(--s3);margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${lp(v||0,t)}%;background:var(--lime);border-radius:3px"></i></div></div>`;
  root.innerHTML=hdr("الأكل","الأيام بتتسجل في شات Calorie Tracker")+
    `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>آخر يوم متسجل</b><span class="muted" style="font-size:13px">${longD(parseD(last.date))}${last.partial?" • لسه مقفلش":""}${last.fasting?" • صيام":""}</span></div>
      <div style="display:flex;gap:16px;align-items:center;margin-top:10px">${ringSVG(last.kcal??0,kT,last.kcal>kT*1.1?"#FFB020":C_LIME).replace('class="ring"','class="ring" style="width:96px;height:96px;margin:0"').replace(/<small class="muted"[^>]*>\/\d+<\/small>/,"")}
        <div style="flex:1;display:grid;gap:8px">${macro("بروتين",last.protein,pT,"جم")}${macro("كارب",last.carbs,L.c,"جم")}${macro("دهون",last.fat,L.f,"جم")}</div></div>
      <div class="muted" style="font-size:12px;margin-top:6px">الهدف ${kT.toLocaleString("en-US")} سعر${L.m?" • يوم صيانة":""}</div></div>
    ${nextM?(()=>{const n=tg(nextM);return`<div class="card" style="margin-top:12px;border-color:${C_LIME}"><b>${nextM===todayK?"النهارده":longD(parseD(nextM))} • يوم صيانة</b><div class="muted" style="font-size:13px;margin-top:4px">سعرات ${n.kcal.toLocaleString("en-US")} • بروتين ${n.p}+ • كارب ${n.c} • دهون ${n.f} جم — مقصود وعالي، مش غلطة.</div></div>`})():""}
    <div style="margin-top:12px">${rangeSeg(R,RANGES)}</div>
    ${full.length?`<div class="grid3"><div class="stat"><div class="k">متوسط السعرات</div><div class="v num" style="font-size:20px">${avg("kcal").toLocaleString("en-US")}</div></div>
      <div class="stat"><div class="k">قريب من الهدف</div><div class="v num" style="font-size:20px">${inBand}/${full.length}</div></div><div class="stat"><div class="k">البروتين وصل</div><div class="v num" style="font-size:20px">${pHit}/${full.length}</div></div></div>`
      :`<div class="card empty"><b>مفيش أيام مقفولة في الفترة دي</b>آخر يوم متسجل ${shortD(parseD(last.date))}. جرّب فترة أطول.</div>`}
    <div class="card" style="margin-top:12px"><b>السعرات كل يوم</b><div class="chartbox" id="cK"></div><div class="legend"><span><i></i>جوه ±10% من الهدف</span><span><i style="background:#FFB020"></i>بعيد</span><span><i class="ref"></i>الهدف ${kT.toLocaleString("en-US")}</span></div></div>
    <div class="card" style="margin-top:12px"><b>البروتين كل يوم</b><div class="chartbox sm" id="cP"></div><div class="legend"><span><i class="ref"></i>الهدف ${pT} جم</span></div></div>
    <details class="more"><summary>كل الأيام</summary><table class="dt"><tr><th>اليوم</th><th>سعرات</th><th>بروتين</th><th>كارب</th><th>دهون</th></tr>
      ${days.filter(Boolean).reverse().map(d=>`<tr><td>${shortD(parseD(d.date))}${d.fasting?" ص":""}${DT[d.date]?" ⚖":""}${d.partial?" *":""}</td><td class="n">${d.kcal??"—"}</td><td class="n">${d.protein??"—"}</td><td class="n">${d.carbs??"—"}</td><td class="n">${d.fat??"—"}</td></tr>`).join("")}</table>
      <p class="muted" style="font-size:12px;margin-top:6px">ص = صيام • ⚖ = يوم صيانة (هدفه أعلى) • * = اليوم مقفلش (مش داخل في المتوسط)</p></details>`;
  root.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{UI.foodRange=+b.dataset.r;renderFood()});
  const labels=keys.map(k=>shortD(parseD(k))),tt=i=>longD(parseD(keys[i]))+(days[i]&&days[i].partial?" • مقفلش":"")+(days[i]&&days[i].fasting?" • صيام":"");
  bars("cK",labels,days.map(d=>d&&d.kcal!=null?d.kcal:null),{target:kT,unit:"سعر",titleOf:tt,empty:"مفيش أيام متسجلة في الفترة دي.",
    colorOf:(v,i)=>{if(days[i]&&days[i].partial)return"rgba(155,163,174,.5)";const k=tg(keys[i]).kcal;return v>=k*.9&&v<=k*1.1?C_LIME:"#FFB020"},
    label:c=>c.dataset.type==="line"?`الهدف ${kT}`:`${c.raw.toLocaleString("en-US")} سعر • بروتين ${days[c.dataIndex].protein??"—"} جم`});
  bars("cP",labels,days.map(d=>d&&d.protein!=null?d.protein:null),{target:pT,unit:"جم",titleOf:tt,empty:"مفيش أيام متسجلة في الفترة دي.",
    colorOf:(v,i)=>days[i]&&days[i].partial?"rgba(155,163,174,.5)":(v>=tg(keys[i]).p?C_LIME:"rgba(184,242,58,.45)"),label:c=>c.dataset.type==="line"?`الهدف ${pT} جم`:`${c.raw} جم بروتين`});
}

/* ---------------- wiring ---------------- */
function render(view,r){destroyAll(true);({home:renderHome,progress:renderProgress,body:renderBody,food:renderFood}[view]||(()=>{}))(r)}
function rerender(){if(typeof curRoute!=="undefined"&&curRoute&&["home","progress","body","food"].includes(curRoute.view))render(curRoute.view,curRoute)}
window.GTT_render=render;
window.GTT_refresh=rerender;
loadCoach().then(rerender);
})();
