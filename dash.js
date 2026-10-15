/* Gym Time Tracker — dashboard: progress, body, food.
   Workout sets come from this phone (D.history) plus the coach's history file.
   Body, photos and food come only from the coach file, which is encrypted (data.enc.json):
   the coach encrypts with the public key in keys.json; only your passphrase opens it. */
(function(){
"use strict";
const DAY=864e5;
const CK="gtt-coach", PK="gtt-pk";
let COACH=null, coachState="locked", coachErr="";
let progDay="all", foodRange=14, curView=null;

/* ---------------- utils ---------------- */
const num=v=>{const n=parseFloat(String(v??"").replace(",","."));return isFinite(n)?n:0};
const dkey=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const parseD=s=>new Date(s+"T12:00:00").getTime();
const shortD=t=>new Date(t).toLocaleDateString("ar-EG",{day:"numeric",month:"short"});
const pct=v=>(v>0?"+":"")+v.toFixed(1)+"%";
const r1=v=>Math.round(v*10)/10;
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};

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
    COACH=await decryptData(ub(pk),enc);coachState="ok";ls.set(CK,JSON.stringify(COACH));
  }catch(e){if(!COACH){coachState="error";coachErr="مقدرتش أحمّل الداتا. اتأكد إنك على النت."}}
}
async function unlockWith(pass){
  coachState="loading";rerender();
  try{
    const keys=await getJSON("keys.json");
    const pkcs8=await unwrapPrivate(keys,pass);
    ls.set(PK,bu(pkcs8));
    await loadCoach();
  }catch(e){coachState="locked";coachErr="الباسورد غلط، أو مفيش نت.";}
  window.GTT_refresh();
}

/* ---------------- sessions ---------------- */
function allSessions(){
  const phone=(typeof D!=="undefined"?D.history:[]).map(h=>({...h,source:h.source||"phone"}));
  const seen=new Set(phone.map(h=>h.day+"|"+dkey(h.startedAt)));
  const coach=(COACH&&COACH.workouts||[]).filter(h=>!seen.has(h.day+"|"+dkey(h.startedAt)));
  return [...coach,...phone].sort((a,b)=>a.startedAt-b.startedAt);
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
    const p=planInfo(e.id);if(p){e.name=p.name;e.day=p.day==="absA"||p.day==="absB"?e.day:p.day}
    e.kind=e.raw.some(x=>x.it.logs.some(l=>num(l.w)>0))?"e1rm":"reps";
    const bl=baselinesFor(e.id);
    e.pts=e.raw.map(({h,it})=>{
      const v=Math.max(...it.logs.map(l=>setVal(l,e.kind)));
      const seg=bl.filter(b=>b<=h.startedAt+DAY/2).length;
      const best=it.logs.reduce((a,l)=>setVal(l,e.kind)>setVal(a,e.kind)?l:a,it.logs[0]);
      return{t:h.startedAt,v,seg,h,it,best};
    }).filter(p=>p.v>0);
    const lastSeg=e.pts.length?e.pts[e.pts.length-1].seg:0;
    e.cur=e.pts.filter(p=>p.seg===lastSeg);
    e.retired=!p;
    if(e.cur.length>=2){const a=e.cur[0].v,b=e.cur[e.cur.length-1].v;e.change=(b/a-1)*100}else e.change=null;
    if(e.cur.length>=2){const n=e.cur.length,a=e.cur[Math.max(0,n-3)].v;e.recent=(e.cur[n-1].v/a-1)*100}else e.recent=null;
    if(e.cur.length>=3){const n=e.cur.length;e.stalled=e.cur[n-1].v<=e.cur[n-3].v+1e-9}else e.stalled=false;
    e.max=e.cur.length?Math.max(...e.cur.map(p=>p.v)):0;
  });
  return map;
}
function sessionScores(S,EX){
  return S.map(h=>{
    const ch=[];
    h.items.forEach(it=>{
      const e=EX[it.id];if(!e||e.abs)return;
      const i=e.pts.findIndex(p=>p.h===h);if(i<1)return;
      const p=e.pts[i],q=e.pts[i-1];if(p.seg!==q.seg)return;
      ch.push({e,pct:(p.v/q.v-1)*100});
    });
    const score=ch.length>=2?ch.reduce((a,c)=>a+c.pct,0)/ch.length:null;
    return{h,score,n:ch.length,ch};
  });
}
const sessDur=h=>(h.source==="chat"&&!h.durKnown)?null:Math.round((h.finishedAt-h.startedAt)/60000);
const cardioDone=h=>h.items.some(x=>x.timed&&x.id==="cardio"&&x.done);
const absDone=h=>h.items.some(x=>x.abs&&x.logs&&x.logs.length);

/* ---------------- tooltip ---------------- */
const tip=()=>document.getElementById("tip");
function showTip(html,x,y){const t=tip();t.innerHTML=html;t.classList.remove("hidden");
  const w=t.offsetWidth,h=t.offsetHeight,vw=innerWidth;let left=x-w/2;left=Math.max(8,Math.min(vw-w-8,left));let top=y-h-14;if(top<8)top=y+18;
  t.style.left=left+"px";t.style.top=top+"px"}
function hideTip(){tip().classList.add("hidden")}
document.addEventListener("scroll",hideTip,{passive:true});
document.addEventListener("pointerdown",e=>{if(!e.target.closest(".chart"))hideTip()});

/* ---------------- charts (inline SVG, one axis each) ---------------- */
const SVGNS="http://www.w3.org/2000/svg";
function niceRange(lo,hi){if(lo===hi){lo-=1;hi+=1}const pad=(hi-lo)*.12;lo-=pad;hi+=pad;
  const step=Math.pow(10,Math.floor(Math.log10((hi-lo)/3)));const m=[1,2,2.5,5,10].find(k=>(hi-lo)/(step*k)<=4)||10;const st=step*m;
  return{lo:Math.floor(lo/st)*st,hi:Math.ceil(hi/st)*st,st}}
const fmtN=v=>Math.abs(v)>=100?Math.round(v).toLocaleString("en-US"):String(r1(v));
/* line over time: pts [{t,y,tip,hollow}]; breaks: timestamps where a new baseline starts */
function lineChart(el,pts,o={}){
  el.innerHTML="";if(!pts.length){el.innerHTML='<div class="empty">لسه مفيش داتا كفاية.</div>';return}
  const W=Math.max(260,el.clientWidth||300),H=o.h||170,L=40,R=12,T=12,B=26;
  let ys=pts.map(p=>p.y);if(o.ref!=null)ys.push(o.ref);
  const yr=niceRange(Math.min(...ys),Math.max(...ys));
  let t0=pts[0].t,t1=pts[pts.length-1].t;if(t0===t1){t0-=3*DAY;t1+=3*DAY}
  const X=t=>L+10+(t-t0)/(t1-t0)*(W-L-R-20),Y=v=>T+(1-(v-yr.lo)/(yr.hi-yr.lo))*(H-T-B);
  let s=`<svg viewBox="0 0 ${W} ${H}" dir="ltr" style="direction:ltr" role="img" aria-label="${o.label||""}">`;
  for(let v=yr.lo;v<=yr.hi+1e-9;v+=yr.st)s+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L-6}" y="${Y(v)+4}" text-anchor="end">${fmtN(v)}</text>`;
  if(o.ref!=null)s+=`<line class="ref" x1="${L}" x2="${W-R}" y1="${Y(o.ref)}" y2="${Y(o.ref)}"/>`;
  const ticks=Math.min(pts.length,Math.max(2,Math.floor((W-L-R)/70)));
  for(let i=0;i<ticks;i++){const t=t0+(t1-t0)*i/(ticks-1||1);s+=`<text class="ax" x="${X(t)}" y="${H-6}" text-anchor="middle">${shortD(t)}</text>`}
  const segs=[];let cur=[];pts.forEach((p,i)=>{if(i&&o.breaks&&o.breaks.some(b=>b>pts[i-1].t&&b<=p.t+DAY/2)){segs.push(cur);cur=[]}cur.push(p)});segs.push(cur);
  segs.forEach(sg=>{if(sg.length>1)s+=`<polyline class="ln" points="${sg.map(p=>X(p.t)+","+Y(p.y)).join(" ")}"/>`});
  if(o.breaks)o.breaks.forEach(b=>{if(b>t0&&b<t1)s+=`<line class="ref" x1="${X(b)}" x2="${X(b)}" y1="${T}" y2="${H-B}"/><text class="ax" x="${X(b)+4}" y="${T+10}">جهاز جديد</text>`});
  pts.forEach(p=>s+=`<circle class="pt${p.hollow?" hollow":""}" cx="${X(p.t)}" cy="${Y(p.y)}" r="${pts.length>24?3:4.5}"/>`);
  s+=`<line class="cross hidden" x1="0" x2="0" y1="${T}" y2="${H-B}" style="display:none"/><rect class="hit" x="${L}" y="0" width="${W-L-R}" height="${H}"/></svg>`;
  el.innerHTML=s;
  const svg=el.querySelector("svg"),cross=svg.querySelector(".cross");
  const move=e=>{const r=svg.getBoundingClientRect(),sx=(e.clientX-r.left)*W/r.width;let best=pts[0],bd=1e18;
    pts.forEach(p=>{const d=Math.abs(X(p.t)-sx);if(d<bd){bd=d;best=p}});
    cross.style.display="";cross.setAttribute("x1",X(best.t));cross.setAttribute("x2",X(best.t));
    showTip(best.tip,r.left+X(best.t)*r.width/W,r.top+Y(best.y)*r.height/H)};
  svg.addEventListener("pointermove",move);svg.addEventListener("pointerdown",move);
  svg.addEventListener("pointerleave",()=>{cross.style.display="none";hideTip()});
}
/* bars by day: bars [{t,y,tip,dim}], ref line + optional band */
function barChart(el,bars,o={}){
  el.innerHTML="";if(!bars.length){el.innerHTML='<div class="empty">لسه مفيش داتا كفاية.</div>';return}
  const W=Math.max(260,el.clientWidth||300),H=o.h||170,L=40,R=8,T=12,B=26;
  const ys=bars.map(b=>b.y);if(o.ref!=null)ys.push(o.ref);if(o.band)ys.push(o.band[1]);
  const yr=niceRange(0,Math.max(...ys));yr.lo=0;
  const n=bars.length,slot=(W-L-R)/n,bw=Math.max(3,Math.min(26,slot-2));
  const X=i=>L+i*slot+slot/2,Y=v=>T+(1-(v-yr.lo)/(yr.hi-yr.lo))*(H-T-B);
  let s=`<svg viewBox="0 0 ${W} ${H}" dir="ltr" style="direction:ltr" role="img" aria-label="${o.label||""}">`;
  for(let v=yr.lo;v<=yr.hi+1e-9;v+=yr.st)s+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L-6}" y="${Y(v)+4}" text-anchor="end">${fmtN(v)}</text>`;
  if(o.band)s+=`<rect class="band" x="${L}" width="${W-L-R}" y="${Y(o.band[1])}" height="${Y(o.band[0])-Y(o.band[1])}"/>`;
  bars.forEach((b,i)=>{const y=Y(b.y),h=Math.max(0,Y(0)-y),r=Math.min(4,bw/2,h);
    s+=`<path class="bar${b.dim?" dim":""}" d="M${X(i)-bw/2},${Y(0)} V${y+r} Q${X(i)-bw/2},${y} ${X(i)-bw/2+r},${y} H${X(i)+bw/2-r} Q${X(i)+bw/2},${y} ${X(i)+bw/2},${y+r} V${Y(0)} Z"/>`});
  if(o.ref!=null)s+=`<line class="ref" x1="${L}" x2="${W-R}" y1="${Y(o.ref)}" y2="${Y(o.ref)}"/>`;
  const every=Math.ceil(n/Math.max(2,Math.floor((W-L-R)/56)));
  bars.forEach((b,i)=>{if((i%every===0&&n-1-i>=every)||i===n-1)s+=`<text class="ax" x="${X(i)}" y="${H-6}" text-anchor="middle">${shortD(b.t)}</text>`});
  bars.forEach((b,i)=>s+=`<rect class="hit" data-i="${i}" x="${L+i*slot}" y="0" width="${slot}" height="${H-B}"/>`);
  el.innerHTML=s+"</svg>";
  const svg=el.querySelector("svg");
  svg.querySelectorAll(".hit").forEach(r=>{const f=e=>{const b=bars[+r.dataset.i],rc=svg.getBoundingClientRect();showTip(b.tip,rc.left+X(+r.dataset.i)*rc.width/W,rc.top+Y(b.y)*rc.height/H)};
    r.addEventListener("pointerenter",f);r.addEventListener("pointerdown",f)});
  svg.addEventListener("pointerleave",hideTip);
}
function spark(pts){
  if(pts.length<2)return'<svg viewBox="0 0 92 28"></svg>';
  const ys=pts.map(p=>p.v),lo=Math.min(...ys),hi=Math.max(...ys),t0=pts[0].t,t1=pts[pts.length-1].t||t0+1;
  const X=t=>4+(t-t0)/((t1-t0)||1)*84,Y=v=>24-(hi===lo?10:(v-lo)/(hi-lo)*20);
  return`<svg viewBox="0 0 92 28" style="direction:ltr" aria-hidden="true"><polyline fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p=>X(p.t)+","+Y(p.v)).join(" ")}"/><circle cx="${X(pts[pts.length-1].t)}" cy="${Y(pts[pts.length-1].v)}" r="3" fill="var(--series)"/></svg>`;
}

/* ---------------- shared bits ---------------- */
const head=(title,sub)=>`<div class="dhead"><h1>${title}</h1><span class="muted">${sub||""}</span></div>`;
function lockCard(why){
  if(coachState==="ok")return"";
  if(coachState==="loading")return`<div class="dcard"><p class="empty">بفتح الداتا…</p></div>`;
  return`<div class="dcard lockcard"><h2>افتح داتا الكوتش</h2><p class="sub">${why} الداتا متشفرة. اكتب الباسورد مرة واحدة على الموبايل ده.</p>
    <input id="passIn" type="password" autocomplete="current-password" placeholder="الباسورد" aria-label="الباسورد">
    <button class="primary" id="passBtn">افتح</button>${coachErr?`<p class="flag">${coachErr}</p>`:""}</div>`;
}
function wireLock(root){const b=root.querySelector("#passBtn");if(!b)return;const i=root.querySelector("#passIn");
  const go=()=>{if(i.value.trim())unlockWith(i.value.trim())};b.onclick=go;i.addEventListener("keydown",e=>{if(e.key==="Enter")go()})}

/* ---------------- PROGRESS ---------------- */
function renderProgress(){
  const root=document.getElementById("progress");
  const S=allSessions(),EX=exerciseSeries(S),SC=sessionScores(S,EX);
  const now=Date.now(),wk=S.filter(h=>h.startedAt>now-7*DAY),prev=S.filter(h=>h.startedAt<=now-7*DAY&&h.startedAt>now-14*DAY);
  const durs=wk.map(sessDur).filter(v=>v!=null),avgDur=durs.length?Math.round(durs.reduce((a,b)=>a+b,0)/durs.length):null;
  const kpi=(k,v,of,d)=>`<div class="kpi"><div class="k">${k}</div><div class="v num">${v}${of!=null?`<small> / ${of}</small>`:""}</div>${of!=null?`<div class="meter"><i style="width:${Math.min(100,v/of*100)}%"></i></div>`:""}${d?`<div class="d">${d}</div>`:""}</div>`;
  const scored=SC.filter(x=>x.score!=null);
  const best=scored.reduce((a,b)=>!a||b.score>a.score?b:a,null),worst=scored.reduce((a,b)=>!a||b.score<a.score?b:a,null);
  const exs=Object.values(EX).filter(e=>!e.abs&&!e.retired&&e.change!=null);
  const top=[...exs].filter(e=>e.recent!=null&&e.recent>0).sort((a,b)=>b.recent-a.recent).slice(0,3);
  const stalled=exs.filter(e=>e.stalled);
  const skips=[];wk.forEach(h=>h.items.forEach(x=>{if((x.timed?!x.done:!(x.logs&&x.logs.length))&&!x.optional&&x.id!=="warmup")skips.push({x,h})}));
  const reasons={};skips.forEach(s=>{const r=s.x.skip||"من غير سبب";reasons[r]=(reasons[r]||0)+1});
  // muscle sets, last 7 days
  const vol={};wk.forEach(h=>h.items.forEach(x=>{const m=MUSCLE[x.id];if(m&&x.logs)vol[m]=(vol[m]||0)+x.logs.length}));
  const vmax=Math.max(12,...Object.values(vol));
  // 4 rolling weeks
  const weeks=[0,1,2,3].map(i=>{const a=now-(i+1)*7*DAY,b=now-i*7*DAY,ss=S.filter(h=>h.startedAt>a&&h.startedAt<=b);
    const sc=SC.filter(x=>x.score!=null&&x.h.startedAt>a&&x.h.startedAt<=b);
    return{lbl:i?`من ${i*7+1} لـ ${(i+1)*7} يوم`:"آخر 7 أيام",n:ss.length,c:ss.filter(cardioDone).length,ab:ss.filter(absDone).length,
      g:sc.length?sc.reduce((s,x)=>s+x.score,0)/sc.length:null}});
  const dayLbl=k=>({push:"Push",pull:"Pull",legs:"Legs"}[k]||k);
  const list=Object.values(EX).filter(e=>!e.abs&&(progDay==="all"||e.day===progDay)).sort((a,b)=>(a.retired-b.retired)||((b.cur.at?.(-1)?.t||0)-(a.cur.at?.(-1)?.t||0)));
  root.innerHTML=head("التقدم",`${S.length} تمرينة متسجلة`)+
  (coachState!=="ok"?lockCard("التمرينات القديمة من الشات (من 27 سبتمبر) جوه داتا الكوتش."):"")+
  `<div class="kpis">${kpi("تمرينات آخر 7 أيام",wk.length,6,prev.length?`الأسبوع اللي قبله ${prev.length}`:"")}
    ${kpi("كارديو",wk.filter(cardioDone).length,4)}${kpi("بطن",wk.filter(absDone).length,3)}
    ${kpi("متوسط مدة التمرينة",avgDur!=null?hm(avgDur):"—",null,avgDur!=null?"من التمرينات اللي اتسجل وقتها":"")}</div>`+
  `<div class="dcard"><h2>أحسن وأضعف تمرينة</h2><p class="sub">متوسط تغيّر القوة في كل تمرين مقارنة بالمرة اللي قبلها</p>
    ${best?`<div class="pair"><div class="callout"><div class="k">الأحسن</div><b>${dayLbl(best.h.day)} • ${shortD(best.h.startedAt)}</b><span class="num">${pct(best.score)}</span> <span class="muted">في ${best.n} تمارين</span></div>
      <div class="callout"><div class="k">الأضعف</div><b>${dayLbl(worst.h.day)} • ${shortD(worst.h.startedAt)}</b><span class="num">${pct(worst.score)}</span> <span class="muted">في ${worst.n} تمارين</span></div></div>`:`<p class="empty">محتاج تمرينتين على الأقل من نفس اليوم.</p>`}</div>`+
  `<div class="dcard"><h2>أكتر تمارين اتحسنت</h2><p class="sub">القوة التقديرية (e1RM) في آخر 3 مرات. بين القوسين: من أول مرة</p>
    <ul class="list">${top.map(e=>`<li><span>${esc(e.name)}</span><span><span class="num" dir="ltr">${pct(e.recent)}</span> <span class="muted" dir="ltr">(${pct(e.change)})</span></span></li>`).join("")||'<li class="empty">لسه.</li>'}</ul>
    ${stalled.length?`<h2 style="margin-top:14px">واقفة</h2><p class="sub">مزادتش في آخر مرتين</p><ul class="list">${stalled.map(e=>`<li><span>${esc(e.name)}</span><span class="muted">${dayLbl(e.day)}</span></li>`).join("")}</ul>`:""}</div>`+
  `<div class="dcard"><h2>ستات كل عضلة</h2><p class="sub">آخر 7 أيام. الخط المتقطع = 10 ستات</p>
    ${MUSCLE_ORDER.filter(m=>vol[m]).map(m=>`<div style="display:grid;grid-template-columns:96px 1fr 28px;align-items:center;gap:8px;margin:6px 0;font-size:14px">
      <span>${m}</span><span style="position:relative;height:12px;background:var(--bg);border-radius:6px;display:block">
      <i style="position:absolute;inset:0 0 0 auto;width:${vol[m]/vmax*100}%;background:var(--series);border-radius:6px;display:block"></i>
      <i style="position:absolute;top:-3px;bottom:-3px;right:${10/vmax*100}%;border-right:2px dashed var(--muted);display:block"></i></span>
      <span class="num" style="text-align:left">${vol[m]}</span></div>`).join("")||'<p class="empty">مفيش تمرينات آخر 7 أيام.</p>'}</div>`+
  `<div class="dcard"><h2>الالتزام آخر 4 أسابيع</h2>
    <table class="dt"><thead><tr><th>الفترة</th><th>تمرين</th><th>كارديو</th><th>بطن</th><th>التقدم</th></tr></thead><tbody>
    ${weeks.map(w=>`<tr><td>${w.lbl}</td><td class="n">${w.n}/6</td><td class="n">${w.c}/4</td><td class="n">${w.ab}/3</td><td class="n">${w.g!=null?pct(w.g):"—"}</td></tr>`).join("")}</tbody></table>
    ${skips.length?`<p class="sub" style="margin-top:10px">اتشال آخر 7 أيام: ${skips.length} (${Object.entries(reasons).map(([r,c])=>`${r} ${c}`).join("، ")})</p>`:""}</div>`+
  `<div class="seg" id="progSeg">${["all","push","pull","legs"].map(k=>`<button class="chip" data-k="${k}" aria-pressed="${progDay===k}">${k==="all"?"الكل":dayLbl(k)}</button>`).join("")}</div>`+
  `<div class="dcard"><h2>كل تمرين</h2><p class="sub">اضغط على أي تمرين تشوف الشارت بتاعه</p><div id="exList2">${list.map(e=>`<button class="exrow" data-id="${e.id}"><span>${esc(e.name)}<small>${e.retired?"اتشال من البرنامج":`${e.cur.length} مرة${e.kind==="reps"?" • بالعدات":""}`}</small></span>${spark(e.cur)}<span class="chg">${e.change!=null?pct(e.change):"—"}</span></button><div class="exchart hidden" id="ch-${e.id}"></div>`).join("")}</div></div>`;
  wireLock(root);
  root.querySelectorAll("#progSeg .chip").forEach(b=>b.onclick=()=>{progDay=b.dataset.k;renderProgress()});
  root.querySelectorAll(".exrow").forEach(b=>b.onclick=()=>{const e=EX[b.dataset.id],box=document.getElementById("ch-"+e.id);
    if(!box.classList.contains("hidden")){box.classList.add("hidden");return}
    box.classList.remove("hidden");box.innerHTML='<div class="chart"></div><div class="legend"></div><details class="tbl"><summary>الأرقام</summary><table class="dt"></table></details>';
    const bl=baselinesFor(e.id);
    lineChart(box.querySelector(".chart"),e.pts.map(p=>({t:p.t,y:r1(p.v),tip:`<b>${shortD(p.t)}</b><br>${esc(setsTxt(p.it.logs,p.it))}${p.it.rir?` • RIR ${esc(p.it.rir)}`:""}<br>${e.kind==="e1rm"?"القوة التقديرية":"أحسن عدات"}: ${r1(p.v)}${p.h.approxDate?"<br>التاريخ تقريبي":""}`})),{breaks:bl,label:e.name});
    box.querySelector(".legend").innerHTML=`<span><i></i>${e.kind==="e1rm"?`القوة التقديرية (${esc(e.unit||"كجم")})`:"أحسن عدات"}</span>${bl.length?'<span><i class="ref"></i>جهاز جديد: المقارنة بتبدأ من هنا</span>':""}`;
    box.querySelector("table").innerHTML=`<tr><th>التاريخ</th><th>الستات</th><th>القيمة</th></tr>`+e.pts.slice().reverse().map(p=>`<tr><td>${shortD(p.t)}</td><td class="n">${esc(setsTxt(p.it.logs,p.it))}</td><td class="n">${r1(p.v)}</td></tr>`).join("")});
}

/* ---------------- BODY ---------------- */
const AREA={shoulders:"الأكتاف",chest_upper:"أعلى الصدر",chest_mid_lower:"الصدر الأوسط والسفلي",arms_biceps:"البايسبس",arms_triceps:"الترايسبس",
  back_width:"عرض الضهر (اللاتس)",back_lower:"أسفل الضهر",abs_upper:"البطن العلوية",abs_lower_waist:"البطن السفلية والوسط",legs:"الرجل"};
const LVL={strong:["قوي","strong"],average:["متوسط",""],weak:["ضعيف","weak"],not_visible:["مش باين","na"]};
function renderBody(){
  const root=document.getElementById("body");
  if(coachState!=="ok"){root.innerHTML=head("الجسم","")+lockCard("القياسات والصور جايه من شات Body Tracker.");wireLock(root);return}
  const C=COACH,ib=(C.inbody||[]).slice().sort((a,b)=>a.date<b.date?-1:1),wa=(C.waist||[]).slice().sort((a,b)=>a.date<b.date?-1:1);
  const wt=(C.weight||[]).slice().sort((a,b)=>a.date<b.date?-1:1);
  const clean=ib.filter(x=>x.clean),lastIb=clean[clean.length-1]||ib[ib.length-1];
  const tile=(k,v,u,d)=>`<div class="kpi"><div class="k">${k}</div><div class="v num">${v??"—"}<small> ${u}</small></div>${d?`<div class="d">${d}</div>`:""}</div>`;
  const wD=wa.length>1?r1(wa[wa.length-1].cm-wa[0].cm):null;
  const P=(C.physique||[]).slice().sort((a,b)=>a.date<b.date?-1:1);
  const full=P.filter(p=>Object.values(p.areas||{}).filter(a=>a.level!=="not_visible").length>=6);
  const latest=full[full.length-1]||P[P.length-1];
  const areas=latest?Object.entries(latest.areas):[];
  root.innerHTML=head("الجسم",C.updated?`آخر تحديث ${shortD(parseD(C.updated))}`:"")+
  `<div class="kpis">${tile("الوزن",wt.length?wt[wt.length-1].kg:null,"كجم",wt.length?shortD(parseD(wt[wt.length-1].date)):"")}
    ${tile("الدهون",lastIb?lastIb.fat_pct:null,"%",lastIb?`InBody ${shortD(parseD(lastIb.date))}`:"")}
    ${tile("العضل",lastIb?lastIb.smm:null,"كجم","Skeletal Muscle")}
    ${tile("الوسط",wa.length?wa[wa.length-1].cm:null,"سم",wD!=null?`<span dir="ltr">${wD>0?"+":""}${wD}</span> سم من ${shortD(parseD(wa[0].date))}`:"")}</div>`+
  `<div class="dcard"><h2>الوسط عند السرة</h2><p class="sub">صايم الصبح. أسرع مؤشر للدهون بين قياسات الـ InBody</p><div class="chart" id="cWaist"></div></div>`+
  `<div class="dcard"><h2>الدهون %</h2><p class="sub">الدايرة الفاضية = قياس مش نضيف (بعد تمرين)</p><div class="chart" id="cFat"></div></div>`+
  `<div class="dcard"><h2>العضل (كجم)</h2><p class="sub">الهدف في التنشيف: يفضل ثابت</p><div class="chart" id="cSmm"></div></div>`+
  `<div class="dcard"><h2>الوزن (كجم)</h2><div class="chart" id="cWt"></div></div>`+
  (latest?`<div class="dcard"><h2>العضلات من الصور</h2><p class="sub">تقييم بالعين يوم ${shortD(parseD(latest.date))}، مش قياس. ${esc(latest.summary||"")}</p>
    <div class="pair" style="margin-bottom:8px"><div class="callout"><div class="k">الأقوى</div>${areas.filter(([,a])=>a.level==="strong").map(([k])=>`<b>${AREA[k]||k}</b>`).join("")||"—"}</div>
    <div class="callout"><div class="k">الأضعف</div>${areas.filter(([,a])=>a.level==="weak").map(([k])=>`<b>${AREA[k]||k}</b>`).join("")||"—"}</div></div>
    <ul class="list">${areas.map(([k,a])=>`<li><span>${AREA[k]||k}<small style="display:block;color:var(--muted);font-size:12px">${esc(a.note||"")}</small></span><span class="lvl ${LVL[a.level]?.[1]||""}">${LVL[a.level]?.[0]||a.level}</span></li>`).join("")}</ul>
    ${P.length>1?`<details class="tbl"><summary>كل التقييمات</summary><div style="overflow-x:auto"><table class="matrix"><tr><th></th>${P.map(p=>`<th>${shortD(parseD(p.date))}</th>`).join("")}</tr>
      ${Object.keys(AREA).map(k=>`<tr><td>${AREA[k]}</td>${P.map(p=>{const a=p.areas&&p.areas[k];return`<td>${a?`<span class="lvl ${LVL[a.level]?.[1]||""}">${LVL[a.level]?.[0]||"—"}</span>`:"—"}</td>`}).join("")}</tr>`).join("")}</table></div></details>`:""}
    <p class="sub" style="margin-top:10px">ابعت صور جديدة في Body Tracker بنفس الإضاءة والزاوية، والتقييم هيتحدث هنا.</p></div>`:"");
  const pt=(d,y,t,h)=>({t:parseD(d),y,tip:t,hollow:h});
  lineChart(document.getElementById("cWaist"),wa.map(x=>pt(x.date,x.cm,`<b>${shortD(parseD(x.date))}</b><br>${x.cm} سم${x.note?`<br>${esc(x.note)}`:""}`)),{label:"الوسط"});
  lineChart(document.getElementById("cFat"),ib.map(x=>pt(x.date,x.fat_pct,`<b>${shortD(parseD(x.date))}</b><br>${x.fat_pct}% (${x.fat_kg} كجم)${x.clean?"":"<br>مش نضيف: بعد تمرين"}`,!x.clean)),{label:"الدهون"});
  lineChart(document.getElementById("cSmm"),ib.map(x=>pt(x.date,x.smm,`<b>${shortD(parseD(x.date))}</b><br>${x.smm} كجم${x.clean?"":"<br>مش نضيف: بعد تمرين"}`,!x.clean)),{label:"العضل"});
  lineChart(document.getElementById("cWt"),wt.map(x=>pt(x.date,x.kg,`<b>${shortD(parseD(x.date))}</b><br>${x.kg} كجم${x.note?`<br>${esc(x.note)}`:""}`,x.source==="inbody"&&ib.some(i=>i.date===x.date&&!i.clean))),{label:"الوزن"});
}

/* ---------------- FOOD ---------------- */
function renderFood(){
  const root=document.getElementById("food");
  if(coachState!=="ok"){root.innerHTML=head("الأكل","")+lockCard("السعرات جايه من شات Calorie Tracker.");wireLock(root);return}
  const N=COACH.nutrition||{},T=N.targets||{kcal:2260,protein:[150,155],fat:[60,65]};
  const all=(N.days||[]).slice().sort((a,b)=>a.date<b.date?-1:1);
  const days=foodRange?all.slice(-foodRange):all;
  const full=days.filter(d=>d.kcal!=null&&!d.partial);
  const kT=T.kcal,band=[kT*.9,kT*1.1],pT=T.protein[0],fT=T.fat[0];
  const avg=full.length?Math.round(full.reduce((a,d)=>a+d.kcal,0)/full.length):null;
  const inBand=full.filter(d=>d.kcal>=band[0]&&d.kcal<=band[1]).length;
  const pHit=full.filter(d=>d.protein>=pT).length,fHit=full.filter(d=>d.fat>=fT*.92&&d.fat<=T.fat[1]*1.15).length;
  const far=[...full].sort((a,b)=>Math.abs(b.kcal-kT)-Math.abs(a.kcal-kT)).slice(0,3);
  const tile=(k,v,of,d)=>`<div class="kpi"><div class="k">${k}</div><div class="v num">${v}${of!=null?`<small> / ${of}</small>`:""}</div>${of?`<div class="meter"><i style="width:${Math.min(100,v/of*100)}%"></i></div>`:""}${d?`<div class="d">${d}</div>`:""}</div>`;
  const tipD=d=>`<b>${shortD(parseD(d.date))}${d.fasting?" • صيام":""}</b><br>${d.kcal??"—"} سعر • بروتين ${d.protein??"—"} • كارب ${d.carbs??"—"} • دهون ${d.fat??"—"}${d.partial?"<br>اليوم مقفلش":""}`;
  root.innerHTML=head("الأكل",`الهدف ${kT.toLocaleString("en-US")} سعر • ${pT}+ بروتين`)+
  `<div class="seg" id="foodSeg">${[[14,"14 يوم"],[30,"30 يوم"],[0,"الكل"]].map(([v,l])=>`<button class="chip" data-v="${v}" aria-pressed="${foodRange===v}">${l}</button>`).join("")}</div>`+
  `<div class="kpis">${tile("متوسط السعرات",avg!=null?avg.toLocaleString("en-US"):"—",null,avg!=null?`<span dir="ltr">${avg-kT>0?"+":""}${avg-kT}</span> عن الهدف`:"")}
    ${tile("أيام في النطاق",inBand,full.length,"±10% من الهدف")}${tile("أيام البروتين",pHit,full.length,`${pT} جم أو أكتر`)}${tile("أيام الدهون",fHit,full.length,`حوالين ${T.fat[0]}–${T.fat[1]} جم`)}</div>`+
  `<div class="dcard"><h2>السعرات كل يوم</h2><p class="sub">المنطقة الرمادي = ±10% من الهدف. العمود الباهت = يوم مقفلش</p><div class="chart" id="cK"></div>
    <div class="legend"><span><i></i>السعرات</span><span><i class="ref"></i>الهدف ${kT.toLocaleString("en-US")}</span><span><i class="band"></i>النطاق</span></div></div>`+
  `<div class="dcard"><h2>البروتين كل يوم (جم)</h2><div class="chart" id="cP"></div><div class="legend"><span><i></i>البروتين</span><span><i class="ref"></i>${pT} جم</span></div></div>`+
  `<div class="dcard"><h2>الدهون كل يوم (جم)</h2><div class="chart" id="cF"></div><div class="legend"><span><i></i>الدهون</span><span><i class="ref"></i>${fT} جم</span></div></div>`+
  `<div class="dcard"><h2>أبعد أيام عن الهدف</h2><ul class="list">${far.map(d=>`<li><span>${shortD(parseD(d.date))}${d.fasting?" • صيام":""}<small style="display:block;color:var(--muted);font-size:12px">بروتين ${d.protein} • دهون ${d.fat}</small></span><span class="num">${d.kcal.toLocaleString("en-US")}</span></li>`).join("")}</ul>
    <details class="tbl"><summary>كل الأيام</summary><table class="dt"><tr><th>اليوم</th><th>سعرات</th><th>بروتين</th><th>كارب</th><th>دهون</th></tr>
    ${days.slice().reverse().map(d=>`<tr><td>${shortD(parseD(d.date))}${d.fasting?" ص":""}${d.partial?" *":""}</td><td class="n">${d.kcal??"—"}</td><td class="n">${d.protein??"—"}</td><td class="n">${d.carbs??"—"}</td><td class="n">${d.fat??"—"}</td></tr>`).join("")}</table>
    <p class="sub">ص = صيام • * = اليوم مقفلش</p></details></div>`;
  root.querySelectorAll("#foodSeg .chip").forEach(b=>b.onclick=()=>{foodRange=+b.dataset.v;renderFood()});
  const withK=days.filter(d=>d.kcal!=null);
  barChart(document.getElementById("cK"),withK.map(d=>({t:parseD(d.date),y:d.kcal,dim:d.partial,tip:tipD(d)})),{ref:kT,band,label:"السعرات"});
  barChart(document.getElementById("cP"),withK.filter(d=>d.protein!=null).map(d=>({t:parseD(d.date),y:d.protein,dim:d.partial,tip:tipD(d)})),{ref:pT,label:"البروتين"});
  barChart(document.getElementById("cF"),withK.filter(d=>d.fat!=null).map(d=>({t:parseD(d.date),y:d.fat,dim:d.partial,tip:tipD(d)})),{ref:fT,label:"الدهون"});
}

/* ---------------- wiring ---------------- */
function render(id){curView=id;hideTip();({progress:renderProgress,body:renderBody,food:renderFood}[id]||(()=>{}))()}
function rerender(){if(curView&&!document.getElementById(curView).classList.contains("hidden"))render(curView)}
window.GTT_render=render;
window.GTT_refresh=()=>{rerender();const h=document.getElementById("home");if(h&&!h.classList.contains("hidden")&&typeof renderHome==="function")renderHome()};
let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(rerender,200)});
loadCoach().then(()=>window.GTT_refresh());
})();
