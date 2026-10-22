/* Rep — core: storage, router, workout logging, summary, settings.
   Data lives in localStorage under KEY (unchanged since v1, so old history keeps working). */
const DAYS={push:{t:"Push",ar:"الصدر والكتف والتراي",d:"صدر، كتف، تراي",ex:{cardio:true}},pull:{t:"Pull",ar:"الضهر والباي",d:"ضهر، كتف خلفي، باي",ex:{cardio:true}},legs:{t:"Legs",ar:"الرجل",d:"رجل وسمانة",ex:{absA:true}}};
const UNITS=["كجم","كل ناحية","بلطات","باوند","وزن جسم"];
const KEY="gym-time-tracker-v1";
const BUILD="2026-10-22b";
const ROTATION=["legs","push","pull"];
const SKIP_REASONS=["زحمة","وقت","تعب","وجع","تاني"];
const RIR_OPTS=[["0","0: فشل، مكنتش هعرف أعمل عدة كمان"],["1","1: كان فاضل عدة واحدة"],["2","2: كان فاضل عدتين"],["3","3: كان فاضل 3"],["4+","4 أو أكتر: خفيف"]];

/* ================= storage ================= */
function load(){try{const v=JSON.parse(localStorage.getItem(KEY));if(v&&v.plans)return v}catch(e){}
  return {plans:JSON.parse(JSON.stringify(DEFAULTS)),history:[],active:null};}
function save(){try{localStorage.setItem(KEY,JSON.stringify(D))}catch(e){}}
let D=load();
(function syncTargets(){ // coach targets arrive with each update; your own edits to names/sets/order stay
  if(D.planVer===PLAN_VER)return;
  Object.keys(DEFAULTS).forEach(k=>{
    if(!Array.isArray(DEFAULTS[k])||!Array.isArray(D.plans[k]))return;
    DEFAULTS[k].forEach(def=>{const mine=D.plans[k].find(x=>x.id===def.id);if(mine)mine.target=def.target;else D.plans[k].push(JSON.parse(JSON.stringify(def)))});
  });
  if(!D.plans.warmup)D.plans.warmup=JSON.parse(JSON.stringify(DEFAULTS.warmup));
  D.planVer=PLAN_VER;save();
})();
(function migrate(){
  D.fixes=D.fixes||{};
  if(!D.fixes.lp2019){D.history.forEach(h=>{if(h.day!=="legs")return;const d=new Date(h.startedAt);if(d.getMonth()!==9||d.getDate()!==15)return;
    const it=h.items.find(x=>x.id==="lg2");if(it&&it.logs.length===4&&it.logs[3].w=="20"&&it.logs[3].r=="19")it.logs.pop()});D.fixes.lp2019=true}
  if(D.active&&!D.active.v2){D.active.items.forEach(it=>{if(!it.timed&&!it.rows){it.rows=(it.logs||[]).map(l=>({w:l.w,r:l.r,done:true,t:l.t}));while(it.rows.length<it.sets){const l=it.rows[it.rows.length-1];it.rows.push({w:l?l.w:"",r:l?l.r:"",done:false})}}});D.active.v2=true;D.active.rest=null}
  D.profile=D.profile||{name:"محمد"};
  save();
})();

/* ================= helpers ================= */
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=(sec,h)=>{sec=Math.max(0,Math.round(sec));const H=Math.floor(sec/3600),M=Math.floor(sec%3600/60),s=sec%60;
  return h?`${H}:${String(M).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${Math.floor(sec/60)}:${String(s).padStart(2,"0")}`};
const hm=min=>`${Math.floor(min/60)}:${String(min%60).padStart(2,"0")}`;
const clock=t=>new Date(t).toLocaleTimeString("ar-EG",{hour:"numeric",minute:"2-digit"});
const dateLbl=t=>new Date(t).toLocaleDateString("ar-EG",{weekday:"long",day:"numeric",month:"long"});
const setsTxt=(sets,ex)=>sets.map(x=>x.w?`${x.w}×${x.r}`:`${x.r}${ex&&ex.seconds?" ث":""}`).join("، ");
const histAll=()=>window.GTT_allSessions?GTT_allSessions():D.history;
const refreshDash=()=>{try{window.GTT_refresh&&GTT_refresh()}catch(e){};try{window.GTT_queueSync&&GTT_queueSync()}catch(e){}};
function armed(btn,msg){ // tap twice to confirm (dialogs are unreliable in installed web apps)
  if(btn.dataset.armed){clearTimeout(btn._t);btn.innerHTML=btn._orig;delete btn.dataset.armed;return true}
  btn._orig=btn.innerHTML;btn.dataset.armed="1";btn.textContent=msg;
  btn._t=setTimeout(()=>{if(btn.dataset.armed){btn.innerHTML=btn._orig;delete btn.dataset.armed}},4000);return false}
function weekStart(t=Date.now()){const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+1)%7));return d.getTime()} // week starts Saturday
const prog=()=>({...PROGRAM,...(D.program||{})});
function programWeek(t=Date.now()){const p=prog(),s=new Date(p.start+"T00:00:00").getTime();return Math.floor((weekStart(t)-weekStart(s))/(7*864e5))+1}
const isDeload=()=>programWeek()===prog().deloadWeek;
function toast(msg,kind){const t=$("toast");t.textContent=msg;t.className="toast"+(kind==="ok"?" ok":"");void t.offsetWidth;t.classList.add("pop");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.add("hidden"),3200)}
const e1=(w,r)=>{w=parseFloat(w);r=parseFloat(r);return w>0&&r>0?w*(1+r/30):0};
function bestEver(id,before=Infinity){let m=0;histAll().forEach(h=>{if(h.startedAt>=before)return;h.items.forEach(x=>{if(x.id===id&&x.logs)x.logs.forEach(l=>{m=Math.max(m,e1(l.w,l.r))})})});return m}
function stepFor(it,w){w=parseFloat(w)||0;if(it.unit==="بلطات"&&w<=30)return 1;if((it.unit==="بلطات"||it.unit==="باوند")&&w>=60)return 10;return 2.5}
const baseId=id=>String(id||"").replace(/_alt\d+$/,"");
const media=id=>/_alt\d+$/.test(String(id))?null:((typeof EXMEDIA!=="undefined"&&EXMEDIA[baseId(id)])||null);
const videoOf=it=>{const m=media(it.id);return m&&m.video?m.video:"https://www.youtube.com/results?search_query="+encodeURIComponent(it.name+" proper form")};
const imgOf=(id,k=0)=>{const m=media(id);return m&&m.img[k]?m.img[k]:(m&&m.img[0])||""};
const IMG=(src,alt,cls="")=>src?`<img src="${src}" alt="${esc(alt)}" class="${cls}" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`:"";
const ICON={
  chev:'<svg class="ico" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  info:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  swap:'<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
  undo:'<svg viewBox="0 0 24 24"><path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-3"/></svg>',
  check:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  play:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="4"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>'
};

/* ================= sound / vibration / screen ================= */
let actx=null,lock=null;
function unlock(){try{if(!actx)actx=new (window.AudioContext||window.webkitAudioContext)();if(actx.state==="suspended")actx.resume()}catch(e){}}
function beep(f,d,delay){if(!actx)return;const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime+delay;o.type="square";o.frequency.value=f;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.35,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+d+.05)}
function vib(p){try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}}
function alarm(){beep(880,.2,0);beep(880,.2,.3);beep(1175,.45,.6);vib([300,150,300,150,700]);const b=$("rest");b.classList.remove("flash");void b.offsetWidth;b.classList.add("flash")}
function warn(){beep(660,.12,0);vib(120)}
async function wake(){try{if("wakeLock" in navigator&&document.visibilityState==="visible"&&D.active)lock=await navigator.wakeLock.request("screen")}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(D.active)wake()});
document.addEventListener("pointerdown",unlock,{passive:true});

/* ================= history lookups ================= */
function lastFor(exId,before=Infinity){const H=histAll();for(let i=H.length-1;i>=0;i--){if(H[i].startedAt>=before)continue;const it=H[i].items.find(x=>x.id===exId&&x.logs&&x.logs.length);if(it)return{it,at:H[i].startedAt}}return null}
function hintFor(ex){
  const L=lastFor(ex.id);if(!L||ex.seconds)return null;
  const logs=L.it.logs;
  if(logs.length>=ex.sets&&logs.every(x=>+x.r>=ex.hi))return"المرة اللي فاتت وصلت أعلى عدات: زوّد الوزن خطوة";
  if(logs.some(x=>+x.r<ex.lo))return"خليك على نفس الوزن";
  return"نفس الوزن وحاول تزوّد عدة";
}
const nextDayKey=()=>{const H=histAll(),last=H[H.length-1];return last?ROTATION[(ROTATION.indexOf(last.day)+1)%3]:"legs"};

/* ================= router (hash based: works on GitHub Pages refresh, back/forward) ================= */
const NAV_OF={home:"home",workout:"workout",progress:"progress",body:"body",food:"food",settings:"settings",plans:"settings",summary:"home"};
const scrollMem={};let curRoute=null;
function parseHash(){const p=location.hash.replace(/^#\/?/,"").split("/").filter(Boolean);
  if(!p.length)return{view:"home",key:"home"};
  if(p[0]==="settings"&&p[1]==="exercises")return{view:"plans",key:"plans"};
  if(p[0]==="summary")return{view:"summary",id:+p[1]||0,key:"summary/"+p[1]};
  if(p[0]==="body")return{view:"body",sub:p[1]==="photos"?"photos":"stats",key:"body/"+(p[1]||"")};
  if(NAV_OF[p[0]])return{view:p[0],key:p[0]};
  return{view:"home",key:"home"};
}
function go(path,replace){const h="#/"+path.replace(/^\/+/,"");if(location.hash===h){route();return}if(replace)location.replace(h);else location.hash=h}
function route(){
  const r=parseHash();
  if(curRoute)scrollMem[curRoute.key]=window.scrollY;
  const same=curRoute&&curRoute.key===r.key,prev=curRoute;curRoute=r;
  document.querySelectorAll("main>.view").forEach(s=>s.classList.toggle("hidden",s.id!=="v-"+r.view));
  document.querySelectorAll("#nav a").forEach(a=>a.setAttribute("aria-current",a.dataset.v===NAV_OF[r.view]?"page":"false"));
  $("sheet").classList.add("hidden");
  render(r);
  if(!same){const v=$("v-"+r.view),order=["home","workout","progress","body","food","settings"],a=order.indexOf(NAV_OF[prev?prev.view:"home"]),b=order.indexOf(NAV_OF[r.view]);
    const backDir=b<a||(prev&&(prev.view==="plans"&&r.view==="settings"||prev.view==="summary"));
    v.classList.remove("enter","back-dir");void v.offsetWidth;v.classList.add("enter");if(backDir)v.classList.add("back-dir");
    clearTimeout(v._en);v._en=setTimeout(()=>v.classList.remove("enter","back-dir"),800)}
  if(!same)requestAnimationFrame(()=>window.scrollTo(0,scrollMem[r.key]||0));
  tick();
}
function render(r=curRoute){
  if(!r)return;
  try{
    if(r.view==="workout")renderWorkout();
    else if(r.view==="summary")renderSummary(r.id);
    else if(r.view==="settings")renderSettings();
    else if(r.view==="plans")renderPlans();
    else if(window.GTT_render)GTT_render(r.view,r);
  }catch(e){console.error(e);$("v-"+r.view).innerHTML=`<div class="card empty"><b>حصلت مشكلة في الشاشة دي</b>${esc(e.message)}</div>`}
}
window.addEventListener("hashchange",route);

/* ================= WORKOUT ================= */
const A=()=>D.active;
const doneRows=it=>(it.rows||[]).filter(r=>r.done);
const isDone=it=>it.timed?(it.done||!!it.skip):(!!it.skip||doneRows(it).length>=it.sets);
const curIndex=()=>A().items.findIndex(x=>!isDone(x));
let pickedDay=null,pickedExtras=null,pickedBudget=120,pickedFit=true,justDone=null,justOpened=null;

function defaultRows(x){const L=lastFor(x.id),prev=L?L.it.logs:[];
  return Array.from({length:x.sets},(_,j)=>{const p=prev[j]||prev[prev.length-1];return{w:p?p.w:"",r:p?p.r:"",done:false}})}

function renderWorkout(){D.active?renderSession():renderPicker()}

function renderPicker(){
  const root=$("v-workout"),nd=nextDayKey();
  if(!pickedDay)pickedDay=nd;
  if(!pickedExtras||pickedExtras._d!==pickedDay)pickedExtras={_d:pickedDay,warmup:true,cardio:false,absA:false,absB:false,...DAYS[pickedDay].ex};
  const P=D.plans[pickedDay]||[],first=P.find(x=>!x.optional)||P[0],dl=isDeload();
  const WU=D.plans.warmup||DEFAULTS.warmup;
  const names={warmup:`تسخين ${WU.minutes} دقايق`,cardio:`مشاية ${D.plans.cardio.minutes} دقيقة`,absA:"بطن A",absB:"بطن B (الجنب)"};
  root.innerHTML=`<div class="hdr"><div><div class="sub">${dl?"أسبوع الديلود":"اختار تمرينة النهارده"}</div><h1>التمرين</h1></div></div>
    <div class="seg" role="group" aria-label="اليوم">${ROTATION.map(k=>`<button data-day="${k}" aria-pressed="${k===pickedDay}">${DAYS[k].t}${k===nd?" •":""}</button>`).join("")}</div>
    <div class="hero">${IMG(first?imgOf(first.id):"",first?first.name:"")}<div class="in"><div class="lbl">${pickedDay===nd?"التمرين الجاي في الدور":"تمرين مختلف عن الدور"}</div>
      <h2>${DAYS[pickedDay].t}</h2><div class="meta">${DAYS[pickedDay].d} • ${P.filter(x=>!x.optional).length} تمارين</div></div></div>
    <div class="sec"><h2>التمارين</h2></div>
    <div class="list">${P.map(x=>`<div class="row">${IMG(imgOf(x.id),x.name,"thumb")||'<span class="thumb"></span>'}<div class="grow"><div class="t">${esc(x.name)}${x.optional?' <span class="tag">اختياري</span>':""}</div><span class="s"><span class="num">${dl?Math.max(1,Math.ceil(x.sets/2)):x.sets} × ${x.lo}–${x.hi}</span>${x.target?` • ${esc(x.target)}`:""}</span></div></div>`).join("")}</div>
    <div class="sec"><h2>الإضافات</h2></div>
    <div class="opts" style="margin-top:0">${Object.keys(names).map(k=>`<button class="opt" data-k="${k}" role="switch" aria-checked="${!!pickedExtras[k]}"><span>${names[k]}</span><span class="sw"></span></button>`).join("")}</div>
    <div class="muted" style="font-size:14px;margin:4px 2px;display:flex;justify-content:space-between"><span>مدة التمرينة</span><b id="outAt" style="color:var(--lime)">لو بدأت دلوقتي هتخرج ${clock(Date.now()+pickedBudget*60000)}</b></div>
    <div class="seg">${[[75,"1:15"],[90,"1:30"],[105,"1:45"],[120,"2:00"],[135,"2:15"],[150,"2:30"]].map(([v,l])=>`<button data-b="${v}" aria-pressed="${pickedBudget===v}"><span class="num">${l}</span></button>`).join("")}</div>
    <div id="fitBox"></div>
    <button class="btn lime block" id="startBtn">ابدأ ${DAYS[pickedDay].t}</button>`;
  root.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{pickedDay=b.dataset.day;renderPicker()});
  root.querySelectorAll(".opt").forEach(o=>o.onclick=()=>{pickedExtras[o.dataset.k]=!pickedExtras[o.dataset.k];o.setAttribute("aria-checked",pickedExtras[o.dataset.k]);renderFit()});
  renderFit();
  root.querySelectorAll("[data-b]").forEach(b=>b.onclick=()=>{pickedBudget=+b.dataset.b;renderFit();$("outAt").textContent=`لو بدأت دلوقتي هتخرج ${clock(Date.now()+pickedBudget*60000)}`;root.querySelectorAll("[data-b]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
  $("startBtn").onclick=startSession;
}
function renderFit(){
  const box=$("fitBox");if(!box)return;
  const items=buildItems(pickedDay,pickedExtras),F=planFit(items,pickedBudget),P=D.plans[pickedDay];
  const rs=[...new Set(P.filter(x=>!x.optional).map(x=>x.rest||90))].sort((a,b)=>b-a);
  let html;
  if(F.fits)html=`<div class="fit ok">التمرينة دي محتاجة حوالي <b class="num">${hm(F.need)}</b>، والوقت اللي اخترته كفاية.</div>`;
  else if(F.possible)html=`<div class="fit warn"><b>الوقت قصير على التمرينة دي.</b> محتاجة حوالي <b class="num">${hm(F.need)}</b> بالراحة المكتوبة، وانت اخترت <b class="num">${hm(pickedBudget)}</b>.
      <div style="margin-top:6px">لو كمّلت، هقلل الراحة عشان تلحق: ${rs.map(r=>`<span class="num">${fmt(r)}</span> ← <span class="num">${fmt(fitRest(r,F.f))}</span>`).join("، ")}</div></div>`;
  else html=`<div class="fit bad"><b>مش هتلحق حتى بأقل راحة.</b> محتاجة حوالي <b class="num">${hm(F.need)}</b>، وأقل حاجة ممكنة <b class="num">${hm(F.minNeed)}</b> (راحة 1:30 للتقيل و0:45 للصغير). ${(()=>{const on=[pickedExtras.cardio&&"المشاية",(pickedExtras.absA||pickedExtras.absB)&&"البطن"].filter(Boolean);return on.length?`شيل ${on.join(" أو ")}، أو اختار وقت أطول.`:"اختار وقت أطول."})()}</div>`;
  box.innerHTML=html+(F.fits?"":`<button class="opt" id="fitTg" role="switch" aria-checked="${pickedFit}" style="background:var(--s1);border-radius:var(--r-md);margin-top:8px"><span>قلل الراحة عشان أخرج في ميعادي</span><span class="sw"></span></button>`);
  const t=$("fitTg");if(t)t.onclick=()=>{pickedFit=!pickedFit;t.setAttribute("aria-checked",pickedFit)};
}
function startWorkoutFor(day){pickedDay=day;pickedExtras=null;go("workout")}
window.GTT_startWorkoutFor=startWorkoutFor;

function buildItems(day,ex){
  const dl=isDeload(),mk=x=>{const y={...x};if(dl){y.sets=Math.max(1,Math.ceil(x.sets/2));y.target="ديلود: نفس وزن آخر مرة، ووقف وفاضلك 3 عدات"}return{...y,rows:defaultRows(y),rir:""}};
  const items=D.plans[day].map(mk);
  if(ex.warmup){const wu=D.plans.warmup||DEFAULTS.warmup;items.unshift({id:"warmup",name:"تسخين",timed:true,minutes:+wu.minutes||5,note:wu.note,done:false})}
  if(ex.cardio)items.push({id:"cardio",name:"مشاية إنكلاين",timed:true,minutes:+D.plans.cardio.minutes||20,note:D.plans.cardio.note,done:false});
  if(ex.absA)D.plans.absA.forEach(x=>items.push({...mk(x),abs:true}));
  if(ex.absB)D.plans.absB.forEach(x=>items.push({...mk(x),abs:true}));
  return items;
}

/* ===== time planning =====
   A workout = work (≈45 s a set) + rest between sets (from the plan) + changeover between exercises
   (walking, setting up the machine) + timed blocks. The changeover is learnt from your own finished
   workouts, so the estimate follows your real pace. When time is short, rests shrink — but never
   below a floor (1:30 for heavy lifts, 1:00 for medium, 0:45 for small ones). */
const WORK_S=45;
const restFloor=r=>r>=120?90:r>=90?60:45;
const r15=x=>Math.round(x/15)*15;
function changeoverS(){
  const xs=[];D.history.slice(-8).forEach(h=>{if(!h.finishedAt||h.source==="chat")return;
    let work=0,rest=0,timed=0,n=0;
    h.items.forEach(x=>{if(x.timed){if(x.done)timed+=(x.minutes||0)*60;return}const k=(x.logs||[]).length;if(!k)return;
      const p=planInfo2(x.id);n++;work+=k*WORK_S;rest+=(k-1)*((p&&p.rest)||90)});
    if(n>=3){const c=((h.finishedAt-h.startedAt)/1000-work-rest-timed)/n;xs.push(c)}});
  if(!xs.length)return 150;
  xs.sort((a,b)=>a-b);return Math.min(300,Math.max(90,xs[Math.floor(xs.length/2)]));
}
function planInfo2(id){for(const k of ["push","pull","legs","absA","absB"]){const x=(D.plans[k]||[]).find(e=>e.id===baseId(id));if(x)return x}return null}
/* remaining time parts for a list of items (skips optional ones you haven't started) */
function timeParts(items,co){
  let fixed=0;const rests=[];
  items.forEach(it=>{if(isDone(it))return;
    if(it.timed){fixed+=it.minutes*60;return}
    const done=doneRows(it).length;if(it.optional&&!done)return;
    const left=Math.max(0,it.sets-done);if(!left)return;
    fixed+=left*WORK_S+(done?0:co);
    const n=done?left:left-1;for(let k=0;k<n;k++)rests.push(it.rest||90)});
  return{fixed,rests};
}
/* scale every rest by the same factor so the total fits; floors stop it going too low */
function fitScale(rests,avail){
  const tot=f=>rests.reduce((a,r)=>a+Math.max(restFloor(r),r*f),0);
  if(tot(1)<=avail)return 1;
  if(tot(0)>avail)return 0;
  let lo=0,hi=1;for(let k=0;k<30;k++){const m=(lo+hi)/2;if(tot(m)>avail)hi=m;else lo=m}return lo;
}
const fitRest=(r,f)=>f>=1?r:Math.max(restFloor(r),r15(r*f));
function planFit(items,budgetMin){
  const co=changeoverS(),{fixed,rests}=timeParts(items,co),restSum=rests.reduce((a,b)=>a+b,0);
  const need=Math.round((fixed+restSum)/60),avail=budgetMin*60-fixed,f=fitScale(rests,avail);
  const minNeed=Math.round((fixed+rests.reduce((a,r)=>a+restFloor(r),0))/60);
  return{need,minNeed,f,fits:need<=budgetMin,possible:minNeed<=budgetMin};
}
/* live: rest for the set you just finished, so you still leave at your exit time */
function restFor(it){
  const S=A(),base=it.rest||90;if(!S||S.fit===false)return base;
  const left=(S.startedAt+S.budget*60000-Date.now())/1000,{fixed,rests}=timeParts(S.items,changeoverS());
  // mid-exercise, this rest is already among `rests`; after the last set it is the extra gap before the next exercise
  const all=doneRows(it).length<it.sets?rests:[base,...rests];
  return fitRest(base,fitScale(all,left-fixed));
}

function startSession(){
  unlock();
  const items=buildItems(pickedDay,pickedExtras);
  D.active={v2:true,day:pickedDay,startedAt:Date.now(),budget:pickedBudget,fit:pickedFit,items,rest:null,open:null};
  save();wake();renderWorkout();window.scrollTo(0,0);
}

function renderSession(){
  const S=A(),root=$("v-workout"),ci=curIndex(),openI=S.open!=null&&S.items[S.open]?S.open:ci;
  const done=S.items.filter(isDone).length;
  root.innerHTML=`<div class="whead"><div class="top"><div><div class="muted" style="font-size:13px">تمرين</div><h1>${DAYS[S.day].ar}</h1></div>
      <div class="clk num" id="elapsed">0:00</div><button class="btn pink sm" id="finishBtn">إنهاء</button></div>
    <div class="bar"><i style="width:${Math.round(done/S.items.length*100)}%"></i></div>
    <div class="meta"><span><span class="num">${done}/${S.items.length}</span> تمارين</span><span id="status"></span></div></div>
    <div id="exList">${S.items.map((it,i)=>i===openI?exOpen(it,i,i===ci):exClosed(it,i,i===ci)).join("")}</div>
    <div class="endrow"><button class="btn pink block" id="finishBtn2">إنهاء التمرينة</button><button class="link dim" id="restartBtn">الغي التمرينة وابدأ من الأول</button></div>`;
  wireSession();tick();justDone=null;justOpened=null;
}
function exClosed(it,i,isCur){
  const n=it.timed?(it.done?1:0):doneRows(it).length,of=it.timed?1:it.sets,ok=isDone(it);
  const sub=it.timed?`${it.minutes} دقيقة`:`${it.sets} × ${it.lo}–${it.hi}${it.target?` • ${it.target}`:""}`;
  return`<div class="ex${isCur?" cur":""}" id="ex${i}"><button class="ex-row" data-open="${i}" aria-expanded="false">
    ${IMG(imgOf(it.id),it.name,"thumb")||'<span class="thumb"></span>'}<span class="grow"><h3>${esc(it.name)}</h3><span class="s">${it.skip?`اتعدّى: ${esc(it.skip)}`:ok&&!it.timed?(it.rir?`RIR ${esc(it.rir)}`:(it.abs||it.seconds?esc(sub):'<span style="color:var(--warn)">RIR ناقص: اضغط وسجله</span>')):esc(sub)}</span></span>
    <span class="ex-prog${ok?" done":""}">${ok&&!it.skip?"✓":`<span class="num">${n}/${of}</span>`}</span></button></div>`;
}
function exOpen(it,i,isCur){
  const m=media(it.id),X=(typeof EXTRA!=="undefined"&&EXTRA[baseId(it.origId||it.id)])||{};
  const mus=m?[...m.muscles,...m.muscles2.slice(0,2)]:[];
  const anim=m&&m.img[1];
  const head=m?`<div class="ex-media${anim?" anim":""}">${IMG(m.img[0],it.name+": بداية الحركة")}${anim?IMG(m.img[1],it.name+": نهاية الحركة","f2"):""}<div class="cap"><h3>${esc(it.name)}</h3></div>${anim?`<button class="tool flip" data-anim="${i}" aria-pressed="false" aria-label="وقّف الحركة"><svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg></button>`:""}</div>`
    :`<div class="ex-body" style="padding-bottom:0"><h3 style="font-size:19px;font-weight:800">${esc(it.name)}</h3></div>`;
  if(it.timed)return`<div class="ex${isCur?" cur":""}" id="ex${i}">${head}<div class="ex-body">
      ${it.note?`<div class="hintl">${esc(it.note)}</div>`:""}
      ${it.skip?`<div class="hintl">اتعدّت: ${esc(it.skip)} <button class="link" data-unskip="${i}">رجّعها</button></div>`:""}</div>
      ${it.skip?"":`<div class="timed"><span class="big num">${it.minutes}:00</span>${it.done?`<button class="btn ghost sm" data-undo-timed="${i}">✓ اتعملت</button>`:`<span style="display:flex;gap:8px"><button class="btn ghost sm" data-mark="${i}">خلصتها</button><button class="btn lime sm" data-time="${i}">ابدأ</button></span>`}</div>`}
      ${!it.done&&!it.skip?`<div class="ex-body" style="padding-top:0"><button class="link dim" data-skip="${i}">عدّيها</button><div class="chips hidden" id="sk${i}"></div></div>`:""}</div>`;
  const L=lastFor(it.id),prev=L?L.it.logs:[],h=hintFor(it),nd=doneRows(it).length,allDone=nd>=it.sets;
  const bestPrev=prev.reduce((a,l)=>e1(l.w,l.r)>e1(a.w,a.r)?l:a,prev[0]||{w:"",r:""});
  const unit=it.unit==="كل ناحية"?"ناحية":it.unit==="بلطات"?"بلطات":it.unit==="باوند"?"باوند":it.unit==="وزن جسم"?"وزن":"كجم";
  const activeJ=it.rows.findIndex(r=>!r.done);
  return`<div class="ex${isCur?" cur":""}${justOpened===i?" opening":""}" id="ex${i}">${head}<div class="ex-body">
    ${mus.length?`<div class="muscles">${mus.map((x,k)=>`<span class="tag${k<m.muscles.length?" lime":""}">${esc(x)}</span>`).join("")}${it.unit&&it.unit!=="كجم"?`<span class="tag">${esc(it.unit)}</span>`:""}</div>`:""}
    <div class="kv"><div><div class="k">آخر مرة</div><div class="v num">${bestPrev.r?(bestPrev.w?`${esc(bestPrev.w)}×${esc(bestPrev.r)}`:esc(bestPrev.r)):"—"}</div></div>
      <div><div class="k">المطلوب</div><div class="v num">${it.sets}×${it.lo}–${it.hi}</div></div><div><div class="k">الراحة${(()=>{const r=restFor(it);return r<(it.rest||90)?' <span class="tag lime" style="font-size:10px">مختصرة</span>':""})()}</div><div class="v num">${fmt(restFor(it))}</div></div></div>
    ${it.target?`<div class="goal">الهدف: ${esc(it.target)}</div>`:""}
    ${h||it.left?`<div class="hintl">${[h,it.left?"ابدأ بالشمال":""].filter(Boolean).join(" • ")}</div>`:""}
    <div class="tools"><a class="tool" href="${esc(videoOf(it))}" target="_blank" rel="noopener">${ICON.play}فيديو الأداء</a>${X.cues?`<button class="tool" data-cue="${i}">${ICON.info}طريقة الأداء</button>`:""}${X.alts&&X.alts.length&&!nd?`<button class="tool" data-busy="${i}">${ICON.swap}الجهاز مشغول</button>`:""}${it.origId&&!nd?`<button class="tool" data-orig="${i}">${ICON.undo}رجّع الأصلي</button>`:""}</div>
    ${X.cues?`<div class="drawer hidden" id="cue${i}">${esc(X.cues)}</div>`:""}
    ${X.alts&&X.alts.length?`<div class="chips hidden" id="alt${i}" style="margin-top:8px"><span class="muted" style="font-size:13px">بدّله بـ</span>${X.alts.map((a,k)=>`<button class="chip" data-alt="${i}" data-k="${k}">${esc(a)}</button>`).join("")}</div>`:""}
    ${it.skip?`<div class="hintl" style="margin-top:8px">اتعدّى: ${esc(it.skip)} <button class="link" data-unskip="${i}">رجّعه</button></div>`:`
    <table class="sets"><thead><tr><th>ست</th><th>اللي فات</th><th>${unit}</th><th>${it.seconds?"ثواني":"عدات"}</th><th></th></tr></thead><tbody>
    ${it.rows.map((r,j)=>{const p=prev[j];return`<tr class="${r.done?"done":j===activeJ?"active":""}${justDone===i+"-"+j?" pop":""}"><td class="n"><span class="no num">${j+1}</span></td><td class="prev num">${p?(p.w?`${esc(p.w)}×${esc(p.r)}`:esc(p.r)):"—"}</td>
      <td><input inputmode="decimal" enterkeyhint="next" aria-label="الوزن ست ${j+1}" data-i="${i}" data-j="${j}" data-f="w" value="${esc(r.w)}" placeholder="${it.unit==="وزن جسم"?"—":""}"></td>
      <td><input inputmode="numeric" enterkeyhint="done" aria-label="العدات ست ${j+1}" data-i="${i}" data-j="${j}" data-f="r" value="${esc(r.r)}"></td>
      <td><button class="chk" data-i="${i}" data-j="${j}" aria-label="خلصت ست ${j+1}" aria-pressed="${!!r.done}">${ICON.check}</button></td></tr>`}).join("")}
    </tbody></table>
    ${!allDone&&it.unit!=="وزن جسم"&&activeJ>=0&&it.rows[activeJ].w!==""?(()=>{const st=stepFor(it,it.rows[activeJ].w);return`<div class="adj"><span>وزن الستات الجاية</span><button data-step="${i}" data-d="${-st}">−${st}</button><b class="num">${esc(it.rows[activeJ].w)}</b><button data-step="${i}" data-d="${st}">+${st}</button></div>`})():""}
    ${it.seconds?"":`<label class="rirbox${allDone&&!it.rir&&!it.abs?" need":""}"><span><b>RIR آخر ست</b><small>فاضلك كام عدة لحد ما توقف؟</small></span>
      <select data-rir="${i}" aria-label="RIR آخر ست"><option value="" ${!it.rir?"selected":""}>اختار</option>${RIR_OPTS.map(([v,l])=>`<option value="${v}" ${it.rir===v?"selected":""}>${l}</option>`).join("")}</select></label>`}
    <div class="exf"><button class="link" data-add="${i}">+ ست</button>${!nd&&prev.length?`<button class="link" data-same="${i}">✓ كله زي اللي فات</button>`:""}${nd?"":`<button class="link dim" data-skip="${i}">عدّي</button>`}</div>`}
    <div class="chips hidden" id="sk${i}" style="margin-top:6px"></div></div></div>`;
}
function wireSession(){
  const S=A(),L=$("v-workout"),q=s=>L.querySelectorAll(s);
  q("[data-open]").forEach(b=>b.onclick=()=>{S.open=+b.dataset.open;justOpened=S.open;save();renderSession();const el=$("ex"+S.open);el&&el.scrollIntoView({behavior:"smooth",block:"start"})});
  q("input[data-f]").forEach(inp=>{inp.addEventListener("input",()=>{const r=S.items[+inp.dataset.i].rows[+inp.dataset.j];r[inp.dataset.f]=inp.value.trim();r.touched=true;inp.style.borderColor="";save()});
    inp.addEventListener("focus",()=>inp.select())});
  q(".chk").forEach(b=>b.onclick=()=>toggleSet(+b.dataset.i,+b.dataset.j));
  q("[data-anim]").forEach(b=>b.onclick=()=>{const box=b.closest(".ex-media"),still=box.classList.toggle("still");b.innerHTML=still?'<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>':'<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';b.setAttribute("aria-pressed",still);b.setAttribute("aria-label",still?"شغّل الحركة":"وقّف الحركة")});
  q("[data-add]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.add],l=it.rows[it.rows.length-1];it.rows.push({w:l?l.w:"",r:l?l.r:"",done:false});save();renderSession()});
  q("select[data-rir]").forEach(sel=>sel.onchange=()=>{const i=+sel.dataset.rir,it=S.items[i];it.rir=sel.value;
    if(doneRows(it).length>=it.sets&&it.rir){S.open=null;save();renderSession();focusCurrent()}else{save();sel.closest(".rirbox").classList.remove("need")}});
  q("[data-skip]").forEach(b=>b.onclick=()=>{const i=+b.dataset.skip,box=$("sk"+i);
    box.innerHTML='<span class="muted" style="font-size:13px">ليه؟</span>'+SKIP_REASONS.map(r=>`<button class="chip" data-r="${r}">${r}</button>`).join("");box.classList.toggle("hidden");
    box.querySelectorAll("[data-r]").forEach(c=>c.onclick=()=>{S.items[i].skip=c.dataset.r;S.open=null;save();renderSession();focusCurrent()})});
  q("[data-unskip]").forEach(b=>b.onclick=()=>{delete S.items[+b.dataset.unskip].skip;save();renderSession()});
  q("[data-time]").forEach(b=>b.onclick=()=>{unlock();const i=+b.dataset.time,it=S.items[i];startRest(it.minutes*60,it.name,i)});
  q("[data-mark]").forEach(b=>b.onclick=()=>{const i=+b.dataset.mark;S.items[i].done=true;if(S.rest&&S.rest.timed===i)stopRest();S.open=null;save();renderSession();focusCurrent()});
  q("[data-undo-timed]").forEach(b=>b.onclick=()=>{S.items[+b.dataset.undoTimed].done=false;save();renderSession()});
  q("[data-cue]").forEach(b=>b.onclick=()=>$("cue"+b.dataset.cue).classList.toggle("hidden"));
  q("[data-busy]").forEach(b=>b.onclick=()=>$("alt"+b.dataset.busy).classList.toggle("hidden"));
  q("[data-alt]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.alt],X=EXTRA[baseId(it.origId||it.id)],k=+b.dataset.k;
    if(!it.origId){it.origId=it.id;it.origName=it.name;it.origTarget=it.target;it.origUnit=it.unit}
    it.id=`${it.origId}_alt${k}`;it.name=X.alts[k];it.target="بديل: اختار وزن يوصّلك للرينج المطلوب";it.unit="كجم";it.rows=defaultRows(it);save();renderSession()});
  q("[data-orig]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.orig];it.id=it.origId;it.name=it.origName;it.target=it.origTarget;it.unit=it.origUnit;delete it.origId;it.rows=defaultRows(it);save();renderSession()});
  q("[data-step]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.step],d=+b.dataset.d;
    it.rows.forEach(r=>{if(!r.done&&r.w!==""){r.w=String(Math.max(0,Math.round((parseFloat(r.w)+d)*100)/100));r.touched=true}});save();renderSession()});
  q("[data-same]").forEach(b=>b.onclick=()=>{unlock();const i=+b.dataset.same,it=S.items[i];let bad=false;
    it.rows.forEach(r=>{if(!r.done){if(!r.r){bad=true;return}r.done=true;r.t=Date.now()}});
    const askRir=!bad&&!it.rir&&!it.abs&&!it.seconds;
    if(!bad)checkPR(it);S.open=askRir?i:null;save();renderSession();
    if(!bad){if(S.items.some(x=>!isDone(x))){const nx=S.items[curIndex()];startRest(restFor(it),`راحة • الجاي: ${nx?nx.name:""}`);if(!askRir)focusCurrent()}}});
  const fin=btn=>()=>{if(armed(btn,"اضغط تاني للإنهاء"))endSession()};
  $("finishBtn").onclick=fin($("finishBtn"));$("finishBtn2").onclick=fin($("finishBtn2"));
  $("restartBtn").onclick=()=>{if(!armed($("restartBtn"),"اضغط تاني: هتتمسح ومش هتتحفظ"))return;const day=S.day;D.active=null;save();stopRest();try{lock&&lock.release()}catch(e){}pickedDay=day;renderWorkout()};
}
function toggleSet(i,j){
  unlock();const S=A(),it=S.items[i],r=it.rows[j];
  if(r.done){r.done=false;delete r.t;save();renderSession();return}
  if(!r.r){const inp=$("ex"+i).querySelector(`input[data-j="${j}"][data-f="r"]`);if(inp){inp.focus();inp.style.borderColor="var(--warn)"}return}
  r.done=true;r.t=Date.now();justDone=i+"-"+j;checkPR(it,r);
  it.rows.forEach((x,k)=>{if(k>j&&!x.done&&!x.touched)x.w=r.w}); // carry a changed weight to untouched sets below
  const allDone=doneRows(it).length>=it.sets,askRir=allDone&&!it.rir&&!it.abs&&!it.seconds;if(allDone){if(askRir)S.open=i;else{S.open=null;justOpened=curIndex()}}save();
  const left=S.items.some(x=>!isDone(x));renderSession();
  if(!left){stopRest();$("finishBtn2").scrollIntoView({behavior:"smooth",block:"center"});return}
  const nx=S.items[curIndex()];
  startRest(restFor(it),allDone?`راحة • الجاي: ${nx?nx.name:""}`:`راحة • ${it.name}`);
  if(allDone&&!askRir)focusCurrent();
  if(askRir)setTimeout(()=>{const b=$("ex"+i)&&$("ex"+i).querySelector(".rirbox");b&&b.scrollIntoView({behavior:"smooth",block:"center"})},150);
}
function checkPR(it,r){
  if(it.prShown)return;const prev=bestEver(it.id,A().startedAt);if(!prev)return;
  const v=r?e1(r.w,r.r):Math.max(0,...doneRows(it).map(x=>e1(x.w,x.r)));
  if(v>prev*1.001){it.prShown=true;save();toast(`رقم قياسي جديد في ${it.name} 🎉`)}
}
function focusCurrent(){const i=curIndex();if(i<0)return;setTimeout(()=>{const el=$("ex"+i);el&&el.scrollIntoView({behavior:"smooth",block:"start"})},120)}

/* rest / timed countdown — one interval for the whole app */
function startRest(sec,label,timedIdx){const S=A();if(!S)return;if(!sec){stopRest();return}
  S.rest={endsAt:Date.now()+sec*1000,dur:sec,label:label||"راحة",timed:timedIdx??null,warned:false,alerted:false};save();$("rest").classList.remove("hidden","flash");tick()}
function stopRest(){const S=A();if(S){S.rest=null;save()}$("rest").classList.add("hidden")}
$("restPlus").onclick=()=>{const R=A()&&A().rest;if(!R)return;R.endsAt+=15000;R.dur+=15;R.warned=false;save();tick()};
$("restMinus").onclick=()=>{const R=A()&&A().rest;if(!R)return;R.endsAt-=15000;save();tick()};
$("restSkip").onclick=()=>{const S=A();if(S&&S.rest&&S.rest.timed!=null){S.items[S.rest.timed].done=true;S.open=null}stopRest();if(curRoute&&curRoute.view==="workout"){renderSession();focusCurrent()}};

function endSession(){
  const S=A();if(!S)return;S.finishedAt=Date.now();stopRest();
  const h={day:S.day,startedAt:S.startedAt,finishedAt:S.finishedAt,items:S.items.map(x=>x.timed
    ?{id:x.id,name:x.name,timed:true,minutes:x.minutes,done:!!x.done,skip:x.skip||""}
    :{id:x.id,name:x.name,unit:x.unit,seconds:!!x.seconds,abs:!!x.abs,optional:!!x.optional,logs:doneRows(x).map(r=>({w:r.w,r:r.r,t:r.t})),rir:x.rir,skip:x.skip||"",...(x.origId?{swappedFrom:x.origName}:{})})};
  D.history.push(h);if(D.history.length>400)D.history=D.history.slice(-400);
  D.active=null;pickedDay=null;save();try{lock&&lock.release()}catch(e){}
  refreshDash();go("summary/"+h.startedAt,true);
}
let lastTickView=null;
function tick(){
  const S=A();const rest=$("rest");
  if(!S){rest.classList.add("hidden");document.body.classList.remove("resting");return}
  const onW=curRoute&&curRoute.view==="workout";
  if(onW&&$("elapsed")){const el=(Date.now()-S.startedAt)/1000;$("elapsed").textContent=fmt(el,el>=3600);
    const left=S.budget-el/60,st=$("status"),rem=S.items.filter(x=>!isDone(x)).length;
    const out=clock(S.startedAt+S.budget*60000);
    if(st){st.className=left<0?"late":"";st.textContent=left<0?`كان المفروض تخرج ${out}، متأخر ${Math.ceil(-left)} دقيقة • ${rem} متبقي`:`هتخرج الساعة ${out} • ${rem} متبقي`}}
  const R=S.rest;
  if(!R){rest.classList.add("hidden");document.body.classList.remove("resting");return}
  rest.classList.remove("hidden");document.body.classList.add("resting");
  const l=(R.endsAt-Date.now())/1000;$("restCd").textContent=fmt(Math.max(0,l));$("restLab").textContent=R.label;
  const C=2*Math.PI*24,p=$("restP");p.style.strokeDasharray=C;p.style.strokeDashoffset=C*(1-Math.max(0,l)/R.dur);
  if(l<=10&&l>0&&!R.warned){R.warned=true;warn()}
  if(l<=0&&!R.alerted){R.alerted=true;alarm();
    if(R.timed!=null){S.items[R.timed].done=true;S.open=null}save();
    if(R.timed!=null&&onW)renderSession();
    setTimeout(()=>{if(A()&&A().rest===R){stopRest();if(curRoute&&curRoute.view==="workout")focusCurrent()}},2500)}
}
setInterval(tick,250);

/* ================= SUMMARY ================= */
function summaryText(h){
  const dur=Math.round((h.finishedAt-h.startedAt)/60000);
  const out=[`${DAYS[h.day].t} — ${dateLbl(h.startedAt)}`,`دخول ${clock(h.startedAt)}، خروج ${clock(h.finishedAt)} (${hm(dur)})`,""];
  let n=1,absHead=false;
  h.items.forEach(x=>{
    if(x.timed){out.push(`${x.name}: ${x.done?`${x.minutes} دقيقة ✅`:`متعملتش${x.skip?` (${x.skip})`:""}`}`);return}
    if(x.abs&&!absHead){out.push("","بطن:");absHead=true}
    if(!x.logs.length&&x.optional)return;
    const u=x.unit&&x.unit!=="كجم"?` (${x.unit})`:"";
    out.push(`${x.abs?"-":n++ +"-"} ${x.name}${x.swappedFrom?` (بدل ${x.swappedFrom})`:""}${u}: ${x.logs.length?setsTxt(x.logs,x):`متلعبش${x.skip?` (${x.skip})`:""}`}${x.rir?` (RIR ${x.rir})`:""}`);
  });
  return out.join("\n");
}
async function share(text,btn){if(navigator.share){try{await navigator.share({text});return}catch(e){if(e.name==="AbortError")return}}copyText(text,btn)}
async function copyText(t,btn){try{await navigator.clipboard.writeText(t);btn.textContent="اتنسخ ✓"}catch(e){const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");btn.textContent="اتنسخ ✓"}catch(_){btn.textContent="انسخ يدوي"}ta.remove()}}
function renderSummary(id){
  const root=$("v-summary"),h=D.history.find(x=>x.startedAt===id)||histAll().find(x=>x.startedAt===id);
  if(!h){root.innerHTML=`<div class="hdr"><a class="back" href="#/">${ICON.chev}الرئيسية</a></div><div class="card empty"><b>التمرينة دي مش موجودة</b>ممكن تكون اتمسحت.</div>`;return}
  const mine=D.history.includes(h),m=Math.round((h.finishedAt-h.startedAt)/60000);
  const ex=h.items.filter(x=>!x.timed&&x.logs&&x.logs.length),sets=ex.reduce((s,x)=>s+x.logs.length,0);
  const isPR=x=>{const prev=bestEver(x.id,h.startedAt);return prev>0&&Math.max(...x.logs.map(l=>e1(l.w,l.r)))>prev*1.001};
  root.innerHTML=`<div class="hdr"><div><a class="back" href="#/">${ICON.chev}الرئيسية</a><h1>ملخص التمرين</h1><div class="sub">${DAYS[h.day].t} • ${dateLbl(h.startedAt)} • ${clock(h.startedAt)}</div></div></div>
    <div class="grid3"><div class="stat"><div class="k">المدة</div><div class="v num">${hm(m)}</div></div><div class="stat"><div class="k">تمارين</div><div class="v num">${ex.length}</div></div><div class="stat"><div class="k">ستات</div><div class="v num">${sets}</div></div></div>
    <div class="sec"><h2>أداء التمارين</h2></div>
    <div class="list">${h.items.map(x=>x.timed?`<div class="row"><div class="grow"><div class="t">${esc(x.name)}</div><span class="s">${x.minutes} دقيقة</span></div><span class="end">${x.done?'<span class="tag lime">✓</span>':`<span class="tag">${x.skip||"لا"}</span>`}</span></div>`
      :(!x.logs.length&&x.optional)?"":`<div class="row">${IMG(imgOf(x.id),x.name,"thumb")||'<span class="thumb"></span>'}<div class="grow"><div class="t">${esc(x.name)} ${x.logs.length&&isPR(x)?'<span class="pr">PR</span>':""}</div><span class="s num">${x.logs.length?esc(setsTxt(x.logs,x)):`متلعبش${x.skip?` (${esc(x.skip)})`:""}`}${x.rir?` • RIR ${esc(x.rir)}`:""}</span></div>${x.logs.length?'<span class="tag lime">✓</span>':""}</div>`).join("")}</div>
    <button class="btn lime block" id="shareBtn" style="margin-top:16px">ابعت الملخص للكوتش</button>
    <div class="grid2" style="margin-top:10px"><button class="btn ghost" id="copyBtn">نسخ</button>${mine?`<button class="btn ghost" id="editBtn">عدّل الأرقام</button>`:""}</div>
    <div id="editBox" class="card hidden" style="margin-top:12px"></div>
    ${mine?`<div style="text-align:center;margin-top:12px"><button class="link dim" id="delSumBtn">امسح التمرينة دي من السجل</button></div>`:""}`;
  const t=summaryText(h);
  $("shareBtn").onclick=()=>share(t,$("shareBtn"));$("copyBtn").onclick=()=>copyText(t,$("copyBtn"));
  if(mine){
    $("editBtn").onclick=()=>{const b=$("editBox");if(b.classList.contains("hidden")){renderEdit(h);b.classList.remove("hidden");b.scrollIntoView({behavior:"smooth"})}else b.classList.add("hidden")};
    $("delSumBtn").onclick=()=>{if(!armed($("delSumBtn"),"اضغط تاني عشان تمسحها نهائياً"))return;D.history=D.history.filter(x=>x.startedAt!==h.startedAt);save();refreshDash();go("",true)};
  }
}
function renderEdit(h){
  const box=$("editBox");
  box.innerHTML=h.items.map((x,i)=>x.timed?`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><label class="check"><input type="checkbox" data-i="${i}" data-f="done" ${x.done?"checked":""}> ${esc(x.name)}</label></div>`
    :`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div style="font-weight:700;margin-bottom:6px">${esc(x.name)}</div>
      ${x.logs.map((l,j)=>`<div style="display:flex;gap:6px;align-items:center;margin-top:6px"><span class="num muted" style="width:18px">${j+1}</span>
        <input class="fld" style="max-width:90px;text-align:center" inputmode="decimal" aria-label="الوزن" data-i="${i}" data-j="${j}" data-f="w" value="${esc(l.w)}"><span class="muted">×</span>
        <input class="fld" style="max-width:80px;text-align:center" inputmode="numeric" aria-label="العدات" data-i="${i}" data-j="${j}" data-f="r" value="${esc(l.r)}">
        <button class="btn ghost sm" data-i="${i}" data-j="${j}" data-a="del">امسح</button></div>`).join("")}
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn ghost sm" data-i="${i}" data-a="add">+ ست</button><span class="muted" style="font-size:13px">RIR</span>
        <input class="fld" style="max-width:64px;text-align:center" inputmode="numeric" data-i="${i}" data-f="rir" value="${esc(x.rir)}">
        ${x.logs.length?"":`<select class="fld" style="max-width:120px" data-i="${i}" data-f="skip" aria-label="سبب التخطي"><option value="">السبب؟</option>${SKIP_REASONS.map(r=>`<option ${x.skip===r?"selected":""}>${r}</option>`).join("")}</select>`}</div></div>`).join("")+
    `<button class="btn lime block" id="edSave" style="margin-top:14px">حفظ</button>`;
  box.querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("change",()=>{const it=h.items[+inp.dataset.i],f=inp.dataset.f;
    if(f==="w"||f==="r")it.logs[+inp.dataset.j][f]=inp.value.trim();else if(f==="done")it.done=inp.checked;else it[f]=inp.value.trim()}));
  box.querySelectorAll("button[data-a]").forEach(b=>b.onclick=()=>{const it=h.items[+b.dataset.i];
    if(b.dataset.a==="del"){if(!armed(b,"تاني"))return;it.logs.splice(+b.dataset.j,1)}else{const l=it.logs[it.logs.length-1];it.logs.push({w:l?l.w:"",r:l?l.r:""})}renderEdit(h)});
  $("edSave").onclick=()=>{save();refreshDash();renderSummary(h.startedAt);toast("اتحفظ ✓","ok")};
}

/* ================= weekly report sheet ================= */
function openReport(){
  const t=window.GTT_weekReport?GTT_weekReport():"",sh=$("sheet");
  sh.innerHTML=`<div class="sheet" role="dialog" aria-label="تقرير الأسبوع"><div class="grab"></div><h2>تقرير الأسبوع</h2><textarea class="fld" readonly style="margin-top:12px">${esc(t)}</textarea>
    <button class="btn lime block" id="repShare" style="margin-top:12px">ابعت التقرير</button></div>`;
  sh.classList.remove("hidden");sh.onclick=e=>{if(e.target===sh)sh.classList.add("hidden")};
  $("repShare").onclick=()=>share(t,$("repShare"));
}
window.GTT_openReport=openReport;

/* ================= SETTINGS ================= */
function renderSettings(){
  const root=$("v-settings"),hasKey=(()=>{try{return!!localStorage.getItem("gtt-pk")}catch(e){return false}})();
  root.innerHTML=`<div class="hdr"><h1>الإعدادات</h1></div>
    <div class="card" style="display:flex;align-items:center;gap:12px"><div class="icon-btn" style="background:var(--lime-soft);color:var(--lime);font-weight:800">${esc((D.profile.name||"؟").slice(0,1))}</div>
      <div style="flex:1"><label for="pName" style="margin:0">الاسم</label><input id="pName" class="fld" style="min-height:40px;padding:6px 10px" value="${esc(D.profile.name||"")}"></div></div>
    <div class="sec"><h2>التمرين</h2></div>
    <div class="list"><a class="row" href="#/settings/exercises" style="color:inherit;text-decoration:none"><div class="grow"><div class="t">التمارين والأهداف</div><span class="s">Push • Pull • Legs • البطن • المشاية</span></div><span class="chev">‹</span></a>
      <div class="row"><div class="grow"><label for="progStart" class="t" style="color:var(--ink);font-size:16px">بداية البرنامج (أسبوع 1)</label><span class="s">8 أسابيع: 7 زيادة وأسبوع ديلود. دلوقتي أسبوع ${programWeek()}</span></div><input id="progStart" type="date" class="fld" style="max-width:160px" value="${prog().start}"></div></div>
    <div class="sec"><h2>الداتا</h2></div>
    <div class="list"><details class="row" style="display:block"><summary style="list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between"><span><span class="t">النسخة الاحتياطية على GitHub</span><span class="s">متشفرة، بترفع بعد كل تمرينة</span></span><span class="chev">‹</span></summary><div id="syncCard" style="margin-top:12px"></div></details>
      <details class="row" style="display:block"><summary style="list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between"><span><span class="t">نسخة يدوية</span><span class="s">انسخ أو استرجع كل حاجة كنص</span></span><span class="chev">‹</span></summary>
        <textarea id="backup" class="fld" style="min-height:90px;direction:ltr;font-size:12px;margin-top:12px"></textarea>
        <div class="grid2" style="margin-top:10px"><button class="btn ghost" id="exportBtn">انسخ النسخة</button><button class="btn ghost" id="importBtn">استرجع</button></div></details>
      <div class="row"><div class="grow"><div class="t">داتا الكوتش</div><span class="s">${hasKey?"مفتوحة على الموبايل ده":"مقفولة: افتحها بالباسورد من التقدم"}</span></div>${hasKey?`<button class="link dim" id="lockBtn">اقفلها</button>`:""}</div></div>
    <div class="sec"><h2>عن التطبيق</h2></div>
    <div class="list"><div class="row"><div class="grow"><div class="t">Rep</div><span class="s">النسخة ${BUILD} • الأهداف ${PLAN_VER}</span></div><button class="btn ghost sm" id="hardRefresh">حدّث الآن</button></div>
      <div class="row"><div class="grow"><span class="s">صور التمارين من free-exercise-db (ملكية عامة). الرسوم البيانية بـ Chart.js (MIT).</span></div></div></div>`;
  $("pName").onchange=()=>{D.profile.name=$("pName").value.trim()||"محمد";save()};
  $("progStart").onchange=()=>{D.program={...(D.program||{}),start:$("progStart").value};save();renderSettings()};
  $("exportBtn").onclick=()=>{$("backup").value=JSON.stringify({plans:D.plans,history:D.history,body:D.body||{},profile:D.profile});copyText($("backup").value,$("exportBtn"))};
  $("importBtn").onclick=()=>{try{const v=JSON.parse($("backup").value);if(!v.plans)throw 0;if(!armed($("importBtn"),"هتستبدل كل حاجة. اضغط تاني"))return;
    D.plans=v.plans;D.history=v.history||[];if(v.body)D.body=v.body;if(v.profile)D.profile=v.profile;save();refreshDash();$("importBtn").textContent="اترجعت ✓"}catch(e){$("importBtn").textContent="النسخة مش سليمة"}};
  if($("lockBtn"))$("lockBtn").onclick=()=>{if(!armed($("lockBtn"),"تاني"))return;try{localStorage.removeItem("gtt-pk");localStorage.removeItem("gtt-coach")}catch(e){}location.reload()};
  $("hardRefresh").onclick=hardRefresh;
  window.GTT_renderSync&&GTT_renderSync();
}
let planTab="push",openEx=null;
const PTABS={push:"Push",pull:"Pull",legs:"Legs",absA:"بطن A",absB:"بطن B",cardio:"مشاية"};
function renderPlans(){
  const root=$("v-plans");
  root.innerHTML=`<div class="hdr"><div><a class="back" href="#/settings">${ICON.chev}الإعدادات</a><h1>التمارين</h1></div></div>
    <div class="seg" id="tabs">${Object.keys(PTABS).map(k=>`<button data-t="${k}" aria-pressed="${k===planTab}">${PTABS[k]}</button>`).join("")}</div><div id="planBody"></div>
    <div style="text-align:center;margin-top:14px"><button class="link dim" id="resetPlans">رجّع التمارين والأهداف للأصل</button></div>`;
  root.querySelectorAll("#tabs button").forEach(c=>c.onclick=()=>{planTab=c.dataset.t;openEx=null;renderPlans()});
  $("resetPlans").onclick=()=>{if(!armed($("resetPlans"),"اضغط تاني للتأكيد"))return;D.plans=JSON.parse(JSON.stringify(DEFAULTS));save();renderPlans()};
  const body=$("planBody");
  if(planTab==="cardio"){body.innerHTML=`<div class="card edit" style="margin-top:0"><div><label for="cMin">المدة بالدقايق</label><input id="cMin" type="number" inputmode="numeric" value="${D.plans.cardio.minutes}"></div><div><label for="cNote">ملاحظة</label><input id="cNote" type="text" value="${esc(D.plans.cardio.note)}"></div></div>`;
    $("cMin").onchange=()=>{D.plans.cardio.minutes=Math.max(1,+$("cMin").value||20);save()};$("cNote").onchange=()=>{D.plans.cardio.note=$("cNote").value.trim();save()};return}
  const list=D.plans[planTab];
  body.innerHTML=`<div class="list">${list.map((x,k)=>`<div class="row" style="display:block"><div style="display:flex;align-items:center;gap:10px">
      ${IMG(imgOf(x.id),x.name,"thumb")||'<span class="thumb"></span>'}<button class="grow" style="text-align:right" data-a="edit" data-k="${k}"><div class="t">${esc(x.name)}</div><span class="s"><span class="num">${x.sets} × ${x.lo}–${x.hi}</span> • راحة ${fmt(x.rest)} • ${esc(x.unit)}${x.optional?" • اختياري":""}</span></button>
      <button class="btn ghost sm" data-a="up" data-k="${k}" aria-label="لفوق">↑</button><button class="btn ghost sm" data-a="down" data-k="${k}" aria-label="لتحت">↓</button></div>
    ${openEx===k?`<div class="edit">
      <div class="full"><label>الاسم</label><input type="text" data-f="name" value="${esc(x.name)}"></div>
      <div><label>الستات</label><input type="number" inputmode="numeric" data-f="sets" value="${x.sets}"></div><div><label>الراحة (ثانية)</label><input type="number" inputmode="numeric" data-f="rest" value="${x.rest}"></div>
      <div><label>أقل عدات</label><input type="number" inputmode="numeric" data-f="lo" value="${x.lo}"></div><div><label>أعلى عدات</label><input type="number" inputmode="numeric" data-f="hi" value="${x.hi}"></div>
      <div class="full"><label>الوحدة</label><select data-f="unit">${UNITS.map(u=>`<option ${u===x.unit?"selected":""}>${u}</option>`).join("")}</select></div>
      <div class="full"><label>الهدف</label><input type="text" data-f="target" value="${esc(x.target)}"></div>
      <label class="check"><input type="checkbox" data-f="optional" ${x.optional?"checked":""}> اختياري</label><label class="check"><input type="checkbox" data-f="left" ${x.left?"checked":""}> ابدأ بالشمال</label>
      <label class="check full"><input type="checkbox" data-f="seconds" ${x.seconds?"checked":""}> بالثواني بدل العدات</label>
      <button class="btn ghost full" data-a="base" data-k="${k}">جهاز جديد: ابدأ المقارنة من النهارده</button>
      <button class="btn ghost full" data-a="del" data-k="${k}" style="color:var(--pink)">شيل التمرين</button></div>`:""}</div>`).join("")}</div>
    <button class="btn ghost block" id="addEx" style="margin-top:12px">+ ضيف تمرين</button>`;
  body.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{const k=+b.dataset.k,a=b.dataset.a;
    if(a==="del"){if(!armed(b,"اضغط تاني عشان تشيله"))return;list.splice(k,1);openEx=null}
    if(a==="base"){if(!armed(b,"اضغط تاني: الشارت هيبدأ خط جديد"))return;const t=new Date(),ds=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;(list[k].baselines=list[k].baselines||[]).push(ds);refreshDash()}
    if(a==="edit")openEx=openEx===k?null:k;
    if(a==="up"&&k>0){[list[k-1],list[k]]=[list[k],list[k-1]];openEx=null}
    if(a==="down"&&k<list.length-1){[list[k+1],list[k]]=[list[k],list[k+1]];openEx=null}
    save();renderPlans()});
  body.querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("change",()=>{const x=list[openEx],f=inp.dataset.f;
    x[f]=inp.type==="checkbox"?inp.checked:inp.type==="number"?Math.max(0,+inp.value||0):inp.value.trim();save()}));
  $("addEx").onclick=()=>{list.push(E("x"+Date.now(),"تمرين جديد",3,8,12,90,"كجم",""));openEx=list.length-1;save();renderPlans()};
}

/* ================= updates ================= */
if("serviceWorker" in navigator&&location.protocol==="https:"){
  let reloaded=false;navigator.serviceWorker.addEventListener("controllerchange",()=>{if(reloaded||D.active)return;reloaded=true;location.reload()});
  window.addEventListener("load",()=>{navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{})});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")navigator.serviceWorker.getRegistration().then(r=>r&&r.update()).catch(()=>{})});
}
async function hardRefresh(){
  try{const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()))}catch(e){}
  try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}catch(e){}
  location.replace(location.pathname+"?v="+Date.now()+location.hash);
}

/* first route after every script has loaded (dash.js registers the dashboard renderers) */
setTimeout(()=>{if(D.active)wake();route()},0);
