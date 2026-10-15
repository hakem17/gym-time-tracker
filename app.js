const DAYS={push:{t:"Push",d:"صدر، كتف، تراي",ex:{cardio:true}},pull:{t:"Pull",d:"ضهر، كتف خلفي، باي",ex:{cardio:true}},legs:{t:"Legs",d:"رجل وسمانة",ex:{absA:true}}};
const UNITS=["كجم","كل ناحية","بلطات","باوند","وزن جسم"];
const KEY="gym-time-tracker-v1";
const BUILD="2026-10-16c";

/* ---------- storage ---------- */
let D=load();
/* new targets from the coach update automatically; your own edits to names/sets/order stay */
(function syncTargets(){
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
  if(!D.fixes.lp2019){ // stray 4th Leg Press set (20×19) logged on 15 Oct
    D.history.forEach(h=>{if(h.day!=="legs")return;const d=new Date(h.startedAt);if(d.getMonth()!==9||d.getDate()!==15)return;
      const it=h.items.find(x=>x.id==="lg2");if(it&&it.logs.length===4&&it.logs[3].w=="20"&&it.logs[3].r=="19")it.logs.pop()});
    D.fixes.lp2019=true;
  }
  // an open workout from the previous layout: turn its logs into rows
  if(D.active&&!D.active.v2){D.active.items.forEach(it=>{if(!it.timed&&!it.rows){it.rows=(it.logs||[]).map(l=>({w:l.w,r:l.r,done:true,t:l.t}));while(it.rows.length<it.sets){const l=it.rows[it.rows.length-1];it.rows.push({w:l?l.w:"",r:l?l.r:"",done:false})}}});D.active.v2=true;D.active.rest=null}
  save();
})();
function load(){try{const v=JSON.parse(localStorage.getItem(KEY));if(v&&v.plans)return v}catch(e){}
  return {plans:JSON.parse(JSON.stringify(DEFAULTS)),history:[],active:null};}
function save(){try{localStorage.setItem(KEY,JSON.stringify(D))}catch(e){}}

/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=(sec,h)=>{sec=Math.max(0,Math.round(sec));const H=Math.floor(sec/3600),M=Math.floor(sec%3600/60),s=sec%60;
  return h?`${H}:${String(M).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${Math.floor(sec/60)}:${String(s).padStart(2,"0")}`};
const hm=min=>`${Math.floor(min/60)}:${String(min%60).padStart(2,"0")}`;
const clock=t=>new Date(t).toLocaleTimeString("ar-EG",{hour:"numeric",minute:"2-digit"});
const dateLbl=t=>new Date(t).toLocaleDateString("ar-EG",{weekday:"long",day:"numeric",month:"long"});
const setsTxt=(sets,ex)=>sets.map(x=>x.w?`${x.w}×${x.r}`:`${x.r}${ex&&ex.seconds?" ث":""}`).join("، ");
const TAB_VIEWS=["home","progress","body","food"];
function show(id){["home","session","summary","settings","progress","body","food"].forEach(s=>$(s).classList.toggle("hidden",s!==id));
  $("nav").classList.toggle("hidden",!TAB_VIEWS.includes(id));
  document.querySelectorAll("#nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.v===id?"page":"false"));
  if(id!=="session")$("rest").classList.add("hidden");
  window.scrollTo(0,0);
  if(id!=="home"&&TAB_VIEWS.includes(id)&&window.GTT_render)GTT_render(id)}
const histAll=()=>window.GTT_allSessions?GTT_allSessions():D.history;
const refreshDash=()=>{try{window.GTT_refresh&&GTT_refresh()}catch(e){};try{window.GTT_queueSync&&GTT_queueSync()}catch(e){}};
const prog=()=>({...PROGRAM,...(D.program||{})});
function programWeek(t=Date.now()){const p=prog(),s=new Date(p.start+"T00:00:00").getTime();return Math.floor((weekStart(t)-weekStart(s))/(7*864e5))+1}
const isDeload=()=>{const p=prog();return programWeek()===p.deloadWeek};
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.remove("hidden");t.classList.remove("pop");void t.offsetWidth;t.classList.add("pop");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.add("hidden"),3200)}
const e1=(w,r)=>{w=parseFloat(w);r=parseFloat(r);return w>0&&r>0?w*(1+r/30):0};
function bestEver(id){let m=0;histAll().forEach(h=>h.items.forEach(x=>{if(x.id===id&&x.logs)x.logs.forEach(l=>{m=Math.max(m,e1(l.w,l.r))})}));return m}
function stepFor(it,w){w=parseFloat(w)||0;if(it.unit==="بلطات"&&w<=30)return 1;if((it.unit==="بلطات"||it.unit==="باوند")&&w>=60)return 10;return 2.5}
/* tap-twice confirm (popups are unreliable inside installed web apps) */
function armed(btn,msg){
  if(btn.dataset.armed){clearTimeout(btn._t);btn.innerHTML=btn._orig;delete btn.dataset.armed;return true}
  btn._orig=btn.innerHTML;btn.dataset.armed="1";btn.textContent=msg;
  btn._t=setTimeout(()=>{if(btn.dataset.armed){btn.innerHTML=btn._orig;delete btn.dataset.armed}},4000);return false}
function weekStart(t=Date.now()){const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+1)%7));return d.getTime()} // week starts Saturday
const ROTATION=["legs","push","pull"];

/* ---------- sound / vibration / wake ---------- */
let ctx=null,lock=null;
function unlock(){try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state==="suspended")ctx.resume()}catch(e){}}
function beep(f,d,delay){if(!ctx)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+delay;o.type="square";o.frequency.value=f;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.35,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+d+.05)}
function vib(p){try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}}
function alarm(){beep(880,.2,0);beep(880,.2,.3);beep(1175,.45,.6);vib([300,150,300,150,700]);
  const b=$("rest");b.classList.remove("flash");void b.offsetWidth;b.classList.add("flash")}
function warn(){beep(660,.12,0);vib(120)}
async function wake(){try{if("wakeLock" in navigator&&document.visibilityState==="visible")lock=await navigator.wakeLock.request("screen")}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(D.active)wake()});
document.addEventListener("pointerdown",unlock);

/* ---------- history lookup ---------- */
function lastFor(exId){const H=histAll();for(let i=H.length-1;i>=0;i--){const it=H[i].items.find(x=>x.id===exId&&x.logs&&x.logs.length);if(it)return{it,at:H[i].startedAt}}return null}
function hintFor(ex){
  const L=lastFor(ex.id);if(!L||ex.seconds)return null;
  const logs=L.it.logs,full=logs.length>=ex.sets&&logs.every(x=>+x.r>=ex.hi);
  if(full)return"المرة اللي فاتت وصلت أعلى عدات: زوّد الوزن خطوة";
  if(logs.some(x=>+x.r<ex.lo))return"خليك على نفس الوزن";
  return"نفس الوزن وحاول تزوّد عدة";
}

/* ---------- HOME ---------- */
function ring(r,frac,color){const C=2*Math.PI*r;return`<circle class="trk" cx="75" cy="75" r="${r}" stroke="${color}"/><circle class="arc" cx="75" cy="75" r="${r}" stroke="${color}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C*(1-Math.min(1,frac))}"/>`}
function renderHome(){
  const pw=programWeek(),P=prog();
  $("todayLbl").textContent=new Date().toLocaleDateString("ar-EG",{weekday:"long",day:"numeric",month:"long"})+(pw>=1&&pw<=P.weeks?` • أسبوع ${pw} من ${P.weeks}`:"");
  $("resumeBtn").classList.toggle("hidden",!D.active);
  const H=histAll(),wk=H.filter(h=>h.startedAt>=weekStart());
  const n=wk.length,c=wk.filter(h=>h.items.some(x=>x.timed&&x.id==="cardio"&&x.done)).length,a=wk.filter(h=>h.items.some(x=>x.abs&&x.logs&&x.logs.length)).length;
  $("ringsCard").innerHTML=`<div class="rings"><svg viewBox="0 0 150 150" aria-hidden="true">${ring(66,n/6,"var(--move)")}${ring(47,c/4,"var(--exercise)")}${ring(28,a/3,"var(--stand)")}</svg>
    <div class="rl"><div><div class="k c-move">تمرينات</div><div class="v num c-move">${n}<small>/6</small></div></div>
    <div><div class="k c-ex">كارديو</div><div class="v num c-ex">${c}<small>/4</small></div></div>
    <div><div class="k c-stand">بطن</div><div class="v num c-stand">${a}<small>/3</small></div></div></div></div>
    <p class="muted" style="margin:12px 0 0;font-size:14px">الأسبوع ده، من السبت</p>`;
  requestAnimationFrame(()=>requestAnimationFrame(()=>$("ringsCard").querySelectorAll(".arc").forEach(el=>el.style.strokeDashoffset=el.dataset.off)));
  const last=H[H.length-1],nextDay=last?ROTATION[(ROTATION.indexOf(last.day)+1)%3]:"legs";
  const lastOf=k=>[...H].reverse().find(h=>h.day===k);
  const ago=k=>{const l=lastOf(k);return l?`آخر مرة ${new Date(l.startedAt).toLocaleDateString("ar-EG",{weekday:"long"})}`:"لسه ما اتلعبش"};
  const cnt=(D.plans[nextDay]||[]).filter(x=>!x.optional).length;
  $("days").innerHTML=`<button class="card next" data-day="${nextDay}" style="width:100%;text-align:right;display:block">
      <span class="lbl">التمرين الجاي</span><b>${DAYS[nextDay].t}</b><span class="sub">${DAYS[nextDay].d} • ${cnt} تمارين</span>
      <span class="go"><span class="muted" style="font-size:14px">${ago(nextDay)}</span><span class="pill move">ابدأ</span></span></button>
    <div class="days2">${ROTATION.filter(k=>k!==nextDay).map(k=>`<button class="dmini" data-day="${k}"><b>${DAYS[k].t}</b><span>${ago(k)}</span></button>`).join("")}</div>`;
  $("days").querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>openSetup(b.dataset.day));
  const banners=[];
  if(isDeload())banners.push(`<div class="card banner"><b>أسبوع الديلود</b><span>نفس أوزان آخر مرة، ونص الستات، ووقف وفاضلك 3 عدات. الأهداف اتغيرت لوحدها.</span></div>`);
  else if(pw===P.deloadWeek-1)banners.push(`<div class="card banner"><b>الأسبوع الجاي ديلود</b><span>الأسبوع ده آخر أسبوع تزوّد فيه.</span></div>`);
  if(new Date().getDay()===5&&window.GTT_weekReport)banners.push(`<button class="card banner" id="repBtn" style="width:100%;text-align:right"><b>تقرير الأسبوع جاهز</b><span>اضغط تشوفه وتبعته في الشات</span></button>`);
  $("banners").innerHTML=banners.join("");
  const rb=$("repBtn");if(rb)rb.onclick=()=>openReport();
  const HL=[...D.history].reverse().slice(0,6);
  $("histBox").classList.toggle("hidden",!HL.length);
  $("histList").innerHTML=HL.map(h=>{const sets=h.items.reduce((s,x)=>s+(x.logs?x.logs.length:0),0),m=Math.round((h.finishedAt-h.startedAt)/60000);
    return`<button data-id="${h.startedAt}"><span><span class="t">${DAYS[h.day].t}</span><span class="s">${dateLbl(h.startedAt)} • ${hm(m)} • ${sets} ست</span></span><span class="chev">‹</span></button>`}).join("");
  $("histList").querySelectorAll("button").forEach(b=>b.onclick=()=>{const h=D.history.find(x=>x.startedAt==b.dataset.id);openSummary(h)});
}

/* ---------- start sheet ---------- */
let pickedDay=null,pickedExtras={},pickedBudget=120;
function openSetup(day){
  if(D.active){show("session");renderSession();return}
  pickedDay=day;pickedExtras={warmup:true,cardio:false,absA:false,absB:false,...DAYS[day].ex};
  const WU=D.plans.warmup||DEFAULTS.warmup;
  const names={warmup:`تسخين ${WU.minutes} دقايق`,cardio:`مشاية ${D.plans.cardio.minutes} دقيقة`,absA:"بطن A",absB:"بطن B (الجنب)"};
  const sh=$("sheet");
  sh.innerHTML=`<div class="sheet" role="dialog" aria-label="ابدأ ${DAYS[day].t}"><div class="grab"></div><h2>${DAYS[day].t}</h2><div class="muted">${DAYS[day].d}</div>
    <div class="opts">${Object.keys(names).map(k=>`<button class="opt" data-k="${k}" role="switch" aria-checked="${!!pickedExtras[k]}"><span>${names[k]}</span><span class="sw"></span></button>`).join("")}</div>
    <div class="muted" style="font-size:14px">هخرج بعد</div>
    <div class="seg2">${[[75,"1:15"],[90,"1:30"],[105,"1:45"],[120,"2:00"]].map(([v,l])=>`<button data-b="${v}" aria-pressed="${pickedBudget===v}"><span class="num">${l}</span></button>`).join("")}</div>
    <button class="pill move block" id="startBtn">ابدأ التمرينة</button></div>`;
  sh.classList.remove("hidden");
  sh.onclick=e=>{if(e.target===sh)sh.classList.add("hidden")};
  sh.querySelectorAll(".opt").forEach(o=>o.onclick=()=>{pickedExtras[o.dataset.k]=!pickedExtras[o.dataset.k];o.setAttribute("aria-checked",pickedExtras[o.dataset.k])});
  sh.querySelectorAll("[data-b]").forEach(b=>b.onclick=()=>{pickedBudget=+b.dataset.b;sh.querySelectorAll("[data-b]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
  $("startBtn").onclick=startSession;
}
/* sets come pre-filled with what you lifted last time, so most sets are one tap */
function defaultRows(x){
  const L=lastFor(x.id),prev=L?L.it.logs:[];
  return Array.from({length:x.sets},(_,j)=>{const p=prev[j]||prev[prev.length-1];return{w:p?p.w:"",r:p?p.r:"",done:false}});
}
function startSession(){
  unlock();$("sheet").classList.add("hidden");
  const dl=isDeload(),mk=x=>{const y={...x};if(dl){y.sets=Math.max(1,Math.ceil(x.sets/2));y.target="ديلود: نفس وزن آخر مرة، ووقف وفاضلك 3 عدات"}return{...y,rows:defaultRows(y),rir:""}};
  const items=D.plans[pickedDay].map(mk);
  if(pickedExtras.warmup){const wu=D.plans.warmup||DEFAULTS.warmup;items.unshift({id:"warmup",name:"تسخين",timed:true,minutes:+wu.minutes||5,note:wu.note,done:false})}
  if(pickedExtras.cardio)items.push({id:"cardio",name:"مشاية إنكلاين",timed:true,minutes:+D.plans.cardio.minutes||20,note:D.plans.cardio.note,done:false});
  if(pickedExtras.absA)D.plans.absA.forEach(x=>items.push({...mk(x),abs:true}));
  if(pickedExtras.absB)D.plans.absB.forEach(x=>items.push({...mk(x),abs:true}));
  D.active={v2:true,day:pickedDay,startedAt:Date.now(),budget:pickedBudget,items,rest:null};
  save();wake();show("session");renderSession();
}

/* ---------- SESSION: the whole workout on one page ---------- */
const A=()=>D.active;
const doneRows=it=>(it.rows||[]).filter(r=>r.done);
const isDone=it=>it.timed?(it.done||!!it.skip):(!!it.skip||doneRows(it).length>=it.sets);
const SKIP_REASONS=["زحمة","وقت","تعب","وجع","تاني"];
const CHECK='<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const curIndex=()=>A().items.findIndex(x=>!isDone(x));
function renderSession(){
  const S=A();if(!S){show("home");renderHome();return}
  $("sDay").textContent=DAYS[S.day].t;
  const ci=curIndex();
  $("exList").innerHTML=S.items.map((it,i)=>{
    const cls=`ex${i===ci?" cur":""}${isDone(it)&&i!==ci?" doneall":""}`;
    if(it.timed)return`<div class="${cls}" id="ex${i}"><div class="exh"><h3>${esc(it.name)}</h3><span class="tag">${it.id==="warmup"?"قبل الحديد":"كارديو"}</span></div>
      ${it.note?`<div class="hintl">${esc(it.note)}</div>`:""}
      ${it.skip?`<div class="hintl">اتعدّت: ${esc(it.skip)} <button class="lnk" data-unskip="${i}">رجّعها</button></div>`:`
      <div class="timed"><span class="big num">${it.minutes} د</span>${it.done?`<button class="pill gray" data-undo-timed="${i}">✓ اتعملت</button>`:`<span style="display:flex;gap:8px"><button class="pill gray" data-mark="${i}">خلصتها</button><button class="pill move" data-time="${i}">ابدأ</button></span>`}</div>
      ${it.done?"":`<div class="exf"><span></span><button class="lnk dim" data-skip="${i}">عدّيها</button></div>`}`}<div class="chips hidden" id="sk${i}"></div></div>`;
    const L=lastFor(it.id),prev=L?L.it.logs:[],h=hintFor(it);
    const unit=it.unit==="كل ناحية"?"ناحية":it.unit==="بلطات"?"بلطات":it.unit==="باوند"?"باوند":it.unit==="وزن جسم"?"وزن":"كجم";
    const nd=doneRows(it).length,allDone=nd>=it.sets;
    return`<div class="${cls}" id="ex${i}">
      <div class="exh"><h3>${esc(it.name)}</h3>${it.unit&&it.unit!=="كجم"?`<span class="tag">${esc(it.unit)}</span>`:""}</div>
      ${it.target?`<div class="goal">الهدف: ${esc(it.target)}</div>`:""}
      ${h||it.left?`<div class="hintl">${[h,it.left?"ابدأ بالشمال":""].filter(Boolean).join(" • ")}</div>`:""}
      ${(()=>{const X=EXTRA[it.origId||it.id]||{};return`<div class="tools">${X.cues?`<button class="tool" data-cue="${i}">إزاي ألعبه</button>`:""}${X.alts&&X.alts.length&&!nd?`<button class="tool" data-busy="${i}">الجهاز مشغول</button>`:""}${it.origId&&!nd?`<button class="tool" data-orig="${i}">رجّع الأصلي</button>`:""}</div>
        ${X.cues?`<div class="cues hidden" id="cue${i}">${esc(X.cues)}</div>`:""}
        ${X.alts&&X.alts.length?`<div class="chips hidden" id="alt${i}"><span class="muted" style="font-size:14px">بدّله بـ</span>${X.alts.map((a,k)=>`<button class="chip" data-alt="${i}" data-k="${k}">${esc(a)}</button>`).join("")}</div>`:""}`})()}
      ${it.skip?`<div class="hintl">اتعدّى: ${esc(it.skip)} <button class="lnk" data-unskip="${i}">رجّعه</button></div>`:`
      <table class="sets"><thead><tr><th>ست</th><th>اللي فات</th><th>${unit}</th><th>${it.seconds?"ثواني":"عدات"}</th><th></th></tr></thead><tbody>
      ${it.rows.map((r,j)=>{const p=prev[j];return`<tr class="${r.done?"done":""}"><td class="n num">${j+1}</td><td class="prev num">${p?(p.w?`${esc(p.w)}×${esc(p.r)}`:esc(p.r)):"—"}</td>
        <td><input inputmode="decimal" aria-label="الوزن ست ${j+1}" data-i="${i}" data-j="${j}" data-f="w" value="${esc(r.w)}" placeholder="${it.unit==="وزن جسم"?"—":""}"></td>
        <td><input inputmode="numeric" aria-label="العدات ست ${j+1}" data-i="${i}" data-j="${j}" data-f="r" value="${esc(r.r)}"></td>
        <td><button class="chk" data-i="${i}" data-j="${j}" aria-label="خلصت ست ${j+1}" aria-pressed="${!!r.done}">${CHECK}</button></td></tr>`}).join("")}
      </tbody></table>
      ${allDone?`<div class="chips"><span class="muted" style="font-size:14px">في آخر ست كان فاضل كام عدة؟</span>${["0","1","2","3","4+"].map(v=>`<button class="chip" data-rir="${i}" data-v="${v}" aria-pressed="${it.rir===v}">${v}</button>`).join("")}</div>`:""}
      ${!allDone&&it.unit!=="وزن جسم"&&it.rows.some(r=>!r.done&&r.w)?(()=>{const nx=it.rows.find(r=>!r.done),st=stepFor(it,nx.w);return`<div class="adj"><span>وزن الستات الجاية</span><button data-step="${i}" data-d="${-st}">−${st}</button><b class="num">${esc(nx.w)}</b><button data-step="${i}" data-d="${st}">+${st}</button></div>`})():""}
      <div class="exf"><button class="lnk" data-add="${i}">+ ست</button>${!nd&&prev.length?`<button class="lnk" data-same="${i}">✓ كله زي اللي فات</button>`:""}${nd?"":`<button class="lnk dim" data-skip="${i}">عدّي</button>`}</div>`}
      <div class="chips hidden" id="sk${i}"></div></div>`;
  }).join("");
  wireSession();tick();
}
function wireSession(){
  const S=A(),L=$("exList");
  L.querySelectorAll("input[data-f]").forEach(inp=>inp.addEventListener("input",()=>{const r=S.items[+inp.dataset.i].rows[+inp.dataset.j];r[inp.dataset.f]=inp.value.trim();r.touched=true;inp.style.outline="";save()}));
  L.querySelectorAll(".chk").forEach(b=>b.onclick=()=>toggleSet(+b.dataset.i,+b.dataset.j));
  L.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.add],l=it.rows[it.rows.length-1];it.rows.push({w:l?l.w:"",r:l?l.r:"",done:false});save();renderSession()});
  L.querySelectorAll("[data-rir]").forEach(b=>b.onclick=()=>{S.items[+b.dataset.rir].rir=b.dataset.v;save();renderSession()});
  L.querySelectorAll("[data-skip]").forEach(b=>b.onclick=()=>{const i=+b.dataset.skip,box=$("sk"+i);
    box.innerHTML='<span class="muted" style="font-size:14px">ليه؟</span>'+SKIP_REASONS.map(r=>`<button class="chip" data-r="${r}">${r}</button>`).join("");box.classList.toggle("hidden");
    box.querySelectorAll("[data-r]").forEach(c=>c.onclick=()=>{S.items[i].skip=c.dataset.r;save();renderSession();focusCurrent()})});
  L.querySelectorAll("[data-unskip]").forEach(b=>b.onclick=()=>{delete S.items[+b.dataset.unskip].skip;save();renderSession()});
  L.querySelectorAll("[data-time]").forEach(b=>b.onclick=()=>{unlock();const i=+b.dataset.time,it=S.items[i];startRest(it.minutes*60,it.name,i)});
  L.querySelectorAll("[data-mark]").forEach(b=>b.onclick=()=>{const i=+b.dataset.mark;S.items[i].done=true;if(S.rest&&S.rest.timed===i)stopRest();save();renderSession();focusCurrent()});
  L.querySelectorAll("[data-cue]").forEach(b=>b.onclick=()=>$("cue"+b.dataset.cue).classList.toggle("hidden"));
  L.querySelectorAll("[data-busy]").forEach(b=>b.onclick=()=>$("alt"+b.dataset.busy).classList.toggle("hidden"));
  L.querySelectorAll("[data-alt]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.alt],X=EXTRA[it.origId||it.id],k=+b.dataset.k;
    if(!it.origId){it.origId=it.id;it.origName=it.name;it.origTarget=it.target;it.origUnit=it.unit}
    it.id=`${it.origId}_alt${k}`;it.name=X.alts[k];it.target="بديل: اختار وزن يوصّلك للرينج المطلوب";it.unit="كجم";it.rows=defaultRows(it);save();renderSession()});
  L.querySelectorAll("[data-orig]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.orig];it.id=it.origId;it.name=it.origName;it.target=it.origTarget;it.unit=it.origUnit;delete it.origId;it.rows=defaultRows(it);save();renderSession()});
  L.querySelectorAll("[data-step]").forEach(b=>b.onclick=()=>{const it=S.items[+b.dataset.step],d=+b.dataset.d;
    it.rows.forEach(r=>{if(!r.done&&r.w!==""){const v=Math.max(0,Math.round((parseFloat(r.w)+d)*100)/100);r.w=String(v);r.touched=true}});save();renderSession()});
  L.querySelectorAll("[data-same]").forEach(b=>b.onclick=()=>{unlock();const i=+b.dataset.same,it=S.items[i];let bad=false;
    it.rows.forEach(r=>{if(!r.done){if(!r.r){bad=true;return}r.done=true;r.t=Date.now()}});save();renderSession();
    if(!bad){checkPR(it);const left=S.items.some(x=>!isDone(x));if(left){const nx=S.items[curIndex()];startRest(it.rest||90,`راحة • الجاي: ${nx?nx.name:""}`);focusCurrent()}}});
  L.querySelectorAll("[data-undo-timed]").forEach(b=>b.onclick=()=>{S.items[+b.dataset.undoTimed].done=false;save();renderSession()});
}
function toggleSet(i,j){
  unlock();const S=A(),it=S.items[i],r=it.rows[j];
  if(r.done){r.done=false;delete r.t;save();renderSession();return}
  if(!r.r){const inp=$("ex"+i).querySelector(`input[data-j="${j}"][data-f="r"]`);if(inp){inp.focus();inp.style.outline="2px solid var(--warn)"}return}
  r.done=true;r.t=Date.now();checkPR(it,r);
  // carry a changed weight to the sets below that you haven't edited yet
  it.rows.forEach((x,k)=>{if(k>j&&!x.done&&!x.touched)x.w=r.w});
  save();
  const allDone=doneRows(it).length>=it.sets,left=S.items.some(x=>!isDone(x));
  renderSession();
  if(!left){stopRest();$("finishBtn2").scrollIntoView({behavior:"smooth",block:"center"});return}
  const nx=S.items[curIndex()];
  startRest(it.rest||90,allDone?`راحة • الجاي: ${nx?nx.name:""}`:`راحة • ${it.name}`);
  if(allDone)focusCurrent();
}
function checkPR(it,r){
  if(it.prShown)return;const prev=bestEver(it.id);if(!prev)return;
  const v=r?e1(r.w,r.r):Math.max(...doneRows(it).map(x=>e1(x.w,x.r)));
  if(v>prev*1.001){it.prShown=true;save();toast(`رقم جديد في ${it.name} 🎉`)}
}
function focusCurrent(){const i=curIndex();if(i<0)return;const el=$("ex"+i);if(el)setTimeout(()=>el.scrollIntoView({behavior:"smooth",block:"start"}),150)}

/* rest / timed countdown bar */
function startRest(sec,label,timedIdx){
  const S=A();if(!sec){stopRest();return}
  S.rest={endsAt:Date.now()+sec*1000,dur:sec,label:label||"راحة",timed:timedIdx??null,warned:false,alerted:false};save();
  $("rest").classList.remove("hidden","flash");tick();
}
function stopRest(){const S=A();if(S)S.rest=null;save();$("rest").classList.add("hidden")}
$("restPlus").onclick=()=>{const R=A()&&A().rest;if(!R)return;R.endsAt+=15000;R.dur+=15;R.warned=false;save();tick()};
$("restMinus").onclick=()=>{const R=A()&&A().rest;if(!R)return;R.endsAt-=15000;save();tick()};
$("restSkip").onclick=()=>{const S=A();if(S&&S.rest&&S.rest.timed!=null){S.items[S.rest.timed].done=true}stopRest();renderSession();focusCurrent()};

function endSession(){
  const S=A();if(!S)return;S.finishedAt=Date.now();
  D.history.push({day:S.day,startedAt:S.startedAt,finishedAt:S.finishedAt,items:S.items.map(x=>x.timed
    ?{id:x.id,name:x.name,timed:true,minutes:x.minutes,done:!!x.done,skip:x.skip||""}
    :{id:x.id,name:x.name,unit:x.unit,seconds:!!x.seconds,abs:!!x.abs,optional:!!x.optional,logs:doneRows(x).map(r=>({w:r.w,r:r.r,t:r.t})),rir:x.rir,skip:x.skip||"",...(x.origId?{swappedFrom:x.origName}:{})})});
  if(D.history.length>400)D.history=D.history.slice(-400);
  const h=D.history[D.history.length-1];D.active=null;save();try{lock&&lock.release()}catch(e){}
  refreshDash();openSummary(h);
}
function tick(){
  const S=A();if(!S||$("session").classList.contains("hidden"))return;
  const el=(Date.now()-S.startedAt)/1000;$("elapsed").textContent=fmt(el,el>=3600);
  const left=S.budget-el/60,st=$("status"),rem=S.items.filter(x=>!isDone(x)).length;
  st.className="stat"+(left<0?" late":"");st.textContent=left<0?`عدّيت وقتك بـ ${Math.ceil(-left)} دقيقة`:`فاضل ${Math.floor(left)} دقيقة • ${rem} تمرين`;
  const R=S.rest;
  if(R){
    $("rest").classList.remove("hidden");
    const l=(R.endsAt-Date.now())/1000;$("restCd").textContent=fmt(Math.max(0,l));$("restLab").textContent=R.label;
    const C=2*Math.PI*23,p=$("restP");p.style.strokeDasharray=C;p.style.strokeDashoffset=C*(1-Math.max(0,l)/R.dur);
    if(l<=10&&l>0&&!R.warned){R.warned=true;warn()}
    if(l<=0&&!R.alerted){R.alerted=true;alarm();save();
      if(R.timed!=null){S.items[R.timed].done=true;save();renderSession()}
      setTimeout(()=>{if(A()&&A().rest===R){stopRest();focusCurrent()}},2500)}
  }else $("rest").classList.add("hidden");
}
setInterval(tick,250);

/* ---------- SUMMARY ---------- */
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
let curSum=null;
function openSummary(h){
  curSum=h;$("editBox").classList.add("hidden");$("editBtn").classList.toggle("hidden",!D.history.includes(h));
  const sets=h.items.reduce((s,x)=>s+(x.logs?x.logs.length:0),0),m=Math.round((h.finishedAt-h.startedAt)/60000),ex=h.items.filter(x=>!x.timed&&x.logs&&x.logs.length).length;
  $("sumDate").textContent=`${DAYS[h.day].t} • ${dateLbl(h.startedAt)}`;
  $("sumStats").innerHTML=`<div class="stat"><div class="k">الوقت</div><div class="v num c-ex">${hm(m)}</div></div><div class="stat"><div class="k">تمارين</div><div class="v num c-move">${ex}</div></div><div class="stat"><div class="k">ستات</div><div class="v num c-stand">${sets}</div></div>`;
  $("sumText").value=summaryText(h);$("shareBtn").textContent="ابعت الملخص";$("copyBtn").textContent="نسخ";show("summary");
}
async function copyText(t,btn){try{await navigator.clipboard.writeText(t);btn.textContent="اتنسخ ✓"}catch(e){const ta=$("sumText");ta.select();try{document.execCommand("copy");btn.textContent="اتنسخ ✓"}catch(_){btn.textContent="حدد النص وانسخه"}}}
$("shareBtn").onclick=async()=>{const t=$("sumText").value;if(navigator.share){try{await navigator.share({text:t});return}catch(e){if(e.name==="AbortError")return}}copyText(t,$("shareBtn"))};
$("copyBtn").onclick=()=>copyText($("sumText").value,$("copyBtn"));
$("homeBtn").onclick=()=>{show("home");renderHome()};
$("delSumBtn").onclick=()=>{if(!curSum)return;if(!armed($("delSumBtn"),"اضغط تاني عشان تمسحها نهائياً"))return;
  D.history=D.history.filter(x=>x.startedAt!==curSum.startedAt);curSum=null;save();refreshDash();show("home");renderHome()};
function renderEdit(){
  const h=curSum,box=$("editBox");
  box.innerHTML=h.items.map((x,i)=>x.timed?`<div class="edEx"><div class="edHead">${esc(x.name)}</div>
      <label class="check"><input type="checkbox" data-i="${i}" data-f="done" ${x.done?"checked":""}> اتعملت</label></div>`
    :`<div class="edEx"><div class="edHead">${esc(x.name)}</div>
      ${x.logs.map((l,j)=>`<div class="edRow"><span class="num muted">${j+1}</span>
        <input type="text" inputmode="decimal" aria-label="الوزن" data-i="${i}" data-j="${j}" data-f="w" value="${esc(l.w)}">
        <span class="muted">×</span><input type="text" inputmode="numeric" aria-label="العدات" data-i="${i}" data-j="${j}" data-f="r" value="${esc(l.r)}">
        <button class="mini" data-i="${i}" data-j="${j}" data-a="del">امسح</button></div>`).join("")}
      <div class="edRow"><button class="mini" data-i="${i}" data-a="add">+ ست</button>
        <span class="muted" style="font-size:13px">RIR</span><input type="text" inputmode="numeric" style="max-width:60px" data-i="${i}" data-f="rir" value="${esc(x.rir)}">
        ${x.logs.length?"":`<select data-i="${i}" data-f="skip" aria-label="سبب التخطي"><option value="">السبب؟</option>${SKIP_REASONS.map(r=>`<option ${x.skip===r?"selected":""}>${r}</option>`).join("")}</select>`}</div></div>`).join("")+
    `<button class="pill move block" id="edSave" style="margin-top:14px">حفظ</button>`;
  box.querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("change",()=>{const it=h.items[+inp.dataset.i],f=inp.dataset.f;
    if(f==="w"||f==="r")it.logs[+inp.dataset.j][f]=inp.value.trim();else if(f==="done")it.done=inp.checked;else it[f]=inp.value.trim()}));
  box.querySelectorAll("button[data-a]").forEach(b=>b.onclick=()=>{const it=h.items[+b.dataset.i];
    if(b.dataset.a==="del"){if(!armed(b,"تاني"))return;it.logs.splice(+b.dataset.j,1)}else{const l=it.logs[it.logs.length-1];it.logs.push({w:l?l.w:"",r:l?l.r:""})}
    renderEdit()});
  $("edSave").onclick=()=>{save();refreshDash();openSummary(h)};
}
$("editBtn").onclick=()=>{const b=$("editBox");if(b.classList.contains("hidden")){renderEdit();b.classList.remove("hidden");b.scrollIntoView({behavior:"smooth"})}else b.classList.add("hidden")};

function openReport(){
  const t=window.GTT_weekReport?GTT_weekReport():"";const sh=$("sheet");
  sh.innerHTML=`<div class="sheet"><div class="grab"></div><h2>تقرير الأسبوع</h2><textarea id="repText" readonly style="margin-top:12px;background:var(--card2)">${esc(t)}</textarea>
    <button class="pill move block" id="repShare" style="margin-top:12px">ابعت التقرير</button></div>`;
  sh.classList.remove("hidden");sh.onclick=e=>{if(e.target===sh)sh.classList.add("hidden")};
  $("repShare").onclick=async()=>{if(navigator.share){try{await navigator.share({text:t});return}catch(e){if(e.name==="AbortError")return}}copyText(t,$("repShare"))};
}
window.GTT_openReport=openReport;

/* ---------- SETTINGS ---------- */
let tab="push",openEx=null;
const TABS={push:"Push",pull:"Pull",legs:"Legs",absA:"بطن A",absB:"بطن B",cardio:"مشاية"};
function renderSettings(){
  $("tabs").innerHTML=Object.keys(TABS).map(k=>`<button class="chip" data-t="${k}" aria-pressed="${k===tab}">${TABS[k]}</button>`).join("");
  $("tabs").querySelectorAll(".chip").forEach(c=>c.onclick=()=>{tab=c.dataset.t;openEx=null;renderSettings()});
  const isC=tab==="cardio";$("cardioEdit").classList.toggle("hidden",!isC);$("plansList").classList.toggle("hidden",isC);$("addEx").classList.toggle("hidden",isC);
  if(isC){$("cMin").value=D.plans.cardio.minutes;$("cNote").value=D.plans.cardio.note;return}
  const list=D.plans[tab];
  $("plansList").innerHTML=list.map((x,k)=>`<div class="exs">
    <div class="exhead"><div class="nm">${esc(x.name)}<span class="sm">${x.sets} × ${x.lo}–${x.hi}${x.seconds?" ث":""} • راحة ${fmt(x.rest)} • ${esc(x.unit)}${x.optional?" • اختياري":""}</span></div>
      <button class="mini" data-a="up" data-k="${k}" aria-label="لفوق">↑</button><button class="mini" data-a="down" data-k="${k}" aria-label="لتحت">↓</button>
      <button class="mini" data-a="edit" data-k="${k}">${openEx===k?"تم":"تعديل"}</button></div>
    ${openEx===k?`<div class="edit">
      <div class="full"><label>الاسم</label><input type="text" data-f="name" value="${esc(x.name)}"></div>
      <div><label>الستات</label><input type="number" inputmode="numeric" data-f="sets" value="${x.sets}"></div>
      <div><label>الراحة (ثانية)</label><input type="number" inputmode="numeric" data-f="rest" value="${x.rest}"></div>
      <div><label>أقل عدات</label><input type="number" inputmode="numeric" data-f="lo" value="${x.lo}"></div>
      <div><label>أعلى عدات</label><input type="number" inputmode="numeric" data-f="hi" value="${x.hi}"></div>
      <div class="full"><label>الوحدة</label><select data-f="unit">${UNITS.map(u=>`<option ${u===x.unit?"selected":""}>${u}</option>`).join("")}</select></div>
      <div class="full"><label>الهدف</label><input type="text" data-f="target" value="${esc(x.target)}"></div>
      <label class="check"><input type="checkbox" data-f="optional" ${x.optional?"checked":""}> اختياري</label>
      <label class="check"><input type="checkbox" data-f="left" ${x.left?"checked":""}> ابدأ بالشمال</label>
      <label class="check full"><input type="checkbox" data-f="seconds" ${x.seconds?"checked":""}> بالثواني بدل العدات</label>
      <button class="pill gray full" data-a="base" data-k="${k}">جهاز جديد: ابدأ المقارنة من النهارده</button>
      <button class="pill gray full" data-a="del" data-k="${k}" style="color:var(--move)">شيل التمرين</button>
    </div>`:""}</div>`).join("");
  $("plansList").querySelectorAll("button[data-a]").forEach(b=>b.onclick=()=>{const k=+b.dataset.k,a=b.dataset.a;
    if(a==="del"){if(!armed(b,"اضغط تاني عشان تشيله"))return;list.splice(k,1);openEx=null}
    if(a==="base"){if(!armed(b,"اضغط تاني: الشارت هيبدأ خط جديد"))return;const t=new Date(),ds=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;(list[k].baselines=list[k].baselines||[]).push(ds);refreshDash()}
    if(a==="edit")openEx=openEx===k?null:k;
    if(a==="up"&&k>0){[list[k-1],list[k]]=[list[k],list[k-1]];openEx=null}
    if(a==="down"&&k<list.length-1){[list[k+1],list[k]]=[list[k],list[k+1]];openEx=null}
    save();renderSettings()});
  $("plansList").querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("change",()=>{const x=list[openEx],f=inp.dataset.f;
    x[f]=inp.type==="checkbox"?inp.checked:inp.type==="number"?Math.max(0,+inp.value||0):inp.value.trim();save()}));
}
$("addEx").onclick=()=>{D.plans[tab].push(E("x"+Date.now(),"تمرين جديد",3,8,12,90,"كجم",""));openEx=D.plans[tab].length-1;save();renderSettings()};
$("cMin").onchange=()=>{D.plans.cardio.minutes=Math.max(1,+$("cMin").value||20);save()};
$("cNote").onchange=()=>{D.plans.cardio.note=$("cNote").value.trim();save()};
$("exportBtn").onclick=()=>{$("backup").value=JSON.stringify({plans:D.plans,history:D.history});copyText($("backup").value,$("exportBtn"))};
$("importBtn").onclick=()=>{try{const v=JSON.parse($("backup").value);if(!v.plans)throw 0;if(!armed($("importBtn"),"هتستبدل كل حاجة. اضغط تاني"))return;
  D.plans=v.plans;D.history=v.history||[];save();renderSettings();$("importBtn").textContent="اترجعت ✓"}catch(e){$("importBtn").textContent="النسخة دي مش سليمة"}};
$("resetPlans").onclick=()=>{if(!armed($("resetPlans"),"اضغط تاني للتأكيد"))return;D.plans=JSON.parse(JSON.stringify(DEFAULTS));save();renderSettings()};

/* ---------- wiring ---------- */
$("toSettings").onclick=()=>{show("settings");renderSettings()};
$("backHome").onclick=()=>{show("home");renderHome()};
document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>{show(b.dataset.v);if(b.dataset.v==="home")renderHome()});
$("resumeBtn").onclick=()=>{wake();show("session");renderSession()};
const fin=btn=>()=>{if(armed(btn,"اضغط تاني عشان تنهي"))endSession()};
$("finishBtn").onclick=fin($("finishBtn"));$("finishBtn2").onclick=fin($("finishBtn2"));
$("restartBtn").onclick=()=>{const S=A();if(!S)return;
  if(!armed($("restartBtn"),"اضغط تاني: هتتمسح ومش هتتحفظ"))return;
  const day=S.day;D.active=null;save();try{lock&&lock.release()}catch(e){}
  show("home");renderHome();openSetup(day)};

if(D.active){show("session");renderSession();wake()}else{show("home");renderHome()}

/* ---------- updates ---------- */
if("serviceWorker" in navigator&&location.protocol==="https:"){
  let reloaded=false;navigator.serviceWorker.addEventListener("controllerchange",()=>{if(reloaded||D.active)return;reloaded=true;location.reload()});
  window.addEventListener("load",()=>{navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{})});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")navigator.serviceWorker.getRegistration().then(r=>r&&r.update()).catch(()=>{})});
}
async function hardRefresh(){
  try{const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()))}catch(e){}
  try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}catch(e){}
  location.replace(location.pathname+"?v="+Date.now());
}
$("verLbl").textContent=`النسخة ${BUILD} • الأهداف ${PLAN_VER}`;
$("progStart").value=prog().start;
$("progStart").onchange=()=>{D.program={...(D.program||{}),start:$("progStart").value};save();renderHome()};
$("hardRefresh").onclick=hardRefresh;
