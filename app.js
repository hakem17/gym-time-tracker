const DAYS={push:{t:"Push",d:"صدر، كتف، تراي",ex:{cardio:true}},pull:{t:"Pull",d:"ضهر، كتف خلفي، باي",ex:{cardio:true}},legs:{t:"Legs",d:"رجل وسمانة",ex:{absA:true}}};
const UNITS=["كجم","كل ناحية","بلطات","باوند","وزن جسم"];
const KEY="gym-time-tracker-v1";

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
/* one-off data fixes */
(function migrate(){
  D.fixes=D.fixes||{};
  if(!D.fixes.lp2019){ // stray 4th Leg Press set (20×19) logged on 15 Oct
    D.history.forEach(h=>{if(h.day!=="legs")return;const d=new Date(h.startedAt);if(d.getMonth()!==9||d.getDate()!==15)return;
      const it=h.items.find(x=>x.id==="lg2");if(it&&it.logs.length===4&&it.logs[3].w=="20"&&it.logs[3].r=="19")it.logs.pop()});
    D.fixes.lp2019=true;save();
  }
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
const TAB_VIEWS=["home","progress","body","food"];
function show(id){["home","session","summary","settings","progress","body","food"].forEach(s=>$(s).classList.toggle("hidden",s!==id));
  $("nav").classList.toggle("hidden",!TAB_VIEWS.includes(id));
  document.querySelectorAll("#nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.v===id?"page":"false"));
  window.scrollTo(0,0);
  if(id!=="home"&&TAB_VIEWS.includes(id)&&window.GTT_render)GTT_render(id)}
const histAll=()=>window.GTT_allSessions?GTT_allSessions():D.history;
const refreshDash=()=>{try{window.GTT_refresh&&GTT_refresh()}catch(e){}};
const setsTxt=(sets,ex)=>sets.map(x=>x.w?`${x.w}×${x.r}`:`${x.r}${ex&&ex.seconds?" ث":""}`).join("، ");
/* tap-twice confirm (popup dialogs are blocked inside the viewer) */
function armed(btn,msg){
  if(btn.dataset.armed){clearTimeout(btn._t);btn.innerHTML=btn._orig;delete btn.dataset.armed;return true}
  btn._orig=btn.innerHTML;btn.dataset.armed="1";btn.textContent=msg;
  btn._t=setTimeout(()=>{if(btn.dataset.armed){btn.innerHTML=btn._orig;delete btn.dataset.armed}},4000);return false}

/* ---------- sound / vibration / wake ---------- */
let ctx=null,lock=null;
function unlock(){try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state==="suspended")ctx.resume()}catch(e){}}
function beep(f,d,delay){if(!ctx)return;const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+delay;o.type="square";o.frequency.value=f;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.35,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+d+.05)}
function vib(p){try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}}
function alarm(){beep(880,.2,0);beep(880,.2,.3);beep(1175,.45,.6);vib([300,150,300,150,700]);
  const b=$("timerBox");b.classList.remove("flash");void b.offsetWidth;b.classList.add("flash")}
function warn(){beep(660,.12,0);vib(120)}
async function wake(){try{if("wakeLock" in navigator&&document.visibilityState==="visible")lock=await navigator.wakeLock.request("screen")}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(D.active)wake()});
document.addEventListener("pointerdown",unlock);

/* ---------- history lookup ---------- */
function lastFor(exId){const H=histAll();for(let i=H.length-1;i>=0;i--){const it=H[i].items.find(x=>x.id===exId&&x.logs&&x.logs.length);if(it)return{it,at:H[i].startedAt}}return null}
function hintFor(ex){
  const L=lastFor(ex.id);if(!L||ex.seconds)return null;
  const logs=L.it.logs,full=logs.length>=ex.sets&&logs.every(x=>+x.r>=ex.hi);
  if(full)return{t:"زوّد الوزن خطوة",c:""};
  if(logs.some(x=>+x.r<ex.lo))return{t:"خليك على نفس الوزن",c:"warn"};
  return{t:"نفس الوزن وزوّد عدة",c:""};
}

/* ---------- HOME ---------- */
let pickedDay=null,pickedExtras={};
/* Egyptian week: starts Saturday */
function weekStart(t=Date.now()){const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+1)%7));return d.getTime()}
const ROTATION=["legs","push","pull"];
function barbell(done,total=6){
  // plates load from the collars outward, alternating sides
  const pos=[[-1,0],[1,0],[-1,1],[1,1],[-1,2],[1,2]].slice(0,total);
  let s=`<svg class="bb" viewBox="0 0 340 96" aria-hidden="true"><rect class="bar" x="8" y="44" width="324" height="8" rx="4"/><rect class="bar" x="104" y="36" width="8" height="24" rx="2"/><rect class="bar" x="228" y="36" width="8" height="24" rx="2"/>`;
  pos.forEach(([side,k],i)=>{const h=80-k*10,x=side<0?86-k*22:242+k*22,y=48-h/2;
    s+=i<done?`<rect class="plate" x="${x}" y="${y}" width="16" height="${h}" rx="4"/>`:`<rect class="slot" x="${x+1}" y="${y+1}" width="14" height="${h-2}" rx="4"/>`});
  return s+"</svg>";
}
const dots=(n,of)=>`<span class="dots">${Array.from({length:of},(_,i)=>`<i class="${i<n?"on":""}"></i>`).join("")}</span>`;
function renderHome(){
  $("resumeBtn").classList.toggle("hidden",!D.active);
  const H=histAll(),ws=weekStart(),wk=H.filter(h=>h.startedAt>=ws);
  const nCardio=wk.filter(h=>h.items.some(x=>x.timed&&x.id==="cardio"&&x.done)).length,nAbs=wk.filter(h=>h.items.some(x=>x.abs&&x.logs&&x.logs.length)).length;
  $("weekHero").innerHTML=`<div class="weekline"><b>الأسبوع ده</b><span><span class="num">${wk.length}</span> من 6 تمرينات</span><span>كارديو <span class="num">${nCardio}</span> من 4</span><span>بطن <span class="num">${nAbs}</span> من 3</span></div>`;
  const last=H[H.length-1],nextDay=last?ROTATION[(ROTATION.indexOf(last.day)+1)%3]:"legs";
  $("days").innerHTML=ROTATION.map(k=>{const lastK=[...H].reverse().find(h=>h.day===k);
    return `<button class="day${k===nextDay?" isnext":""}" data-day="${k}"><div><b>${DAYS[k].t}</b><span>${DAYS[k].d}${lastK?` • آخر مرة ${new Date(lastK.startedAt).toLocaleDateString("ar-EG",{weekday:"long"})}`:""}</span></div><span class="go">${k===nextDay?"الجاي":"ابدأ"}</span></button>`}).join("");
  $("days").querySelectorAll(".day").forEach(b=>b.onclick=()=>openSetup(b.dataset.day,b));
  $("days").classList.remove("hidden");$("setup").classList.add("hidden");
  const HL=[...D.history].reverse().slice(0,8);
  $("histBox").classList.toggle("hidden",!HL.length);
  $("histList").innerHTML=HL.map(h=>`<li><span>${DAYS[h.day].t} • ${dateLbl(h.startedAt)}</span><button data-id="${h.startedAt}">الملخص</button></li>`).join("");
  $("histList").querySelectorAll("button").forEach(b=>b.onclick=()=>{const h=D.history.find(x=>x.startedAt==b.dataset.id);openSummary(h)});
}
function openSetup(day,btn){
  if(D.active&&btn&&!armed(btn,"فيه تمرينة مفتوحة. اضغط تاني للغيها وتبدأ جديدة"))return;
  if(D.active){D.active=null;save()}
  pickedDay=day;pickedExtras={warmup:true,cardio:false,absA:false,absB:false,...DAYS[day].ex};
  $("setupTitle").textContent=`${DAYS[day].t}: إيه الإضافات النهارده؟`;
  const WU=D.plans.warmup||DEFAULTS.warmup;
  const names={warmup:`تسخين ${WU.minutes} دقايق`,cardio:`مشاية ${D.plans.cardio.minutes} دقيقة`,absA:"بطن A",absB:"بطن B (الجنب)"};
  $("extras").innerHTML=Object.keys(names).map(k=>`<button class="chip" data-k="${k}" aria-pressed="${!!pickedExtras[k]}">${names[k]}</button>`).join("");
  $("extras").querySelectorAll(".chip").forEach(c=>c.onclick=()=>{pickedExtras[c.dataset.k]=!pickedExtras[c.dataset.k];c.setAttribute("aria-pressed",pickedExtras[c.dataset.k])});
  $("days").classList.add("hidden");$("setup").classList.remove("hidden");
}
function startSession(){
  unlock();
  const items=D.plans[pickedDay].map(x=>({...x,logs:[],rir:""}));
  if(pickedExtras.warmup){const wu=D.plans.warmup||DEFAULTS.warmup;items.unshift({id:"warmup",name:"تسخين",timed:true,minutes:+wu.minutes||5,note:wu.note,done:false})}
  if(pickedExtras.cardio)items.push({id:"cardio",name:"مشاية إنكلاين",timed:true,minutes:+D.plans.cardio.minutes||20,note:D.plans.cardio.note,done:false});
  if(pickedExtras.absA)D.plans.absA.forEach(x=>items.push({...x,logs:[],rir:"",abs:true}));
  if(pickedExtras.absB)D.plans.absB.forEach(x=>items.push({...x,logs:[],rir:"",abs:true}));
  D.active={day:pickedDay,startedAt:Date.now(),budget:+$("budget").value,items,i:0,phase:"work",endsAt:0,dur:0,advance:false,alerted:false,warned:false};
  save();wake();show("session");renderSession();
}

/* ---------- SESSION ---------- */
const A=()=>D.active;
const isDone=it=>it.timed?it.done:it.logs.length>=it.sets;
function nextIndex(from){const its=A().items;for(let k=from+1;k<its.length;k++)if(!isDone(its[k]))return k;for(let k=0;k<its.length;k++)if(!isDone(its[k]))return k;return -1}
function renderSession(){
  const S=A();if(!S){show("home");renderHome();return}
  const it=S.items[S.i];
  $("sDay").textContent=DAYS[S.day].t;$("budgetLbl").textContent=hm(S.budget);
  const resting=S.phase==="rest"||S.phase==="timed";
  $("workCard").classList.toggle("hidden",resting);$("timerBox").classList.toggle("hidden",!resting);

  $("planSum").textContent=`كل تمارين النهارده (${S.items.filter(isDone).length} من ${S.items.length})`;
  $("exName").textContent=it.name;
  $("exUnit").textContent=it.timed?(it.id==="warmup"?"قبل الحديد":"كارديو"):it.unit||"";
  if(it.timed){
    $("exMeta").textContent=`${it.minutes} دقيقة${it.note?` • ${it.note}`:""}`;
    $("exGoal").classList.add("hidden");
    $("exLast").classList.add("hidden");$("exHint").classList.add("hidden");$("dots").classList.add("hidden");$("setForm").classList.add("hidden");
    $("undoBtn").classList.add("hidden");
    $("step").textContent=it.done?"اتعملت ✅":`${it.minutes} دقيقة${it.note?` • ${it.note}`:""}`;$("note").textContent="";
    $("mainBtn").textContent=it.done?"التمرين الجاي":`ابدأ ${it.minutes} دقيقة`;
  }else{
    const s=it.logs.length;
    $("exMeta").innerHTML=`${it.sets} × <span class="num">${it.lo}–${it.hi}</span>${it.seconds?" ثانية":""} • راحة <span class="num">${fmt(it.rest)}</span>`;
    $("exGoal").classList.toggle("hidden",!it.target);
    $("exGoal").innerHTML=`<small>الهدف النهارده</small>${esc(it.target)}`;
    const L=lastFor(it.id);
    $("exLast").classList.toggle("hidden",!L);
    if(L)$("exLast").innerHTML=`المرة اللي فاتت: <span class="num">${esc(setsTxt(L.it.logs,it))}</span>`;
    const h=hintFor(it);const leftTxt=it.left?"ابدأ بالشمال":"";
    $("exHint").className="hint"+(h&&h.c?" "+h.c:"");
    $("exHint").classList.toggle("hidden",!h&&!leftTxt);
    $("exHint").textContent=[h&&h.t,leftTxt].filter(Boolean).join(" • ");
    $("dots").classList.remove("hidden");
    $("dots").innerHTML=Array.from({length:Math.max(it.sets,s)},(_,k)=>`<span class="dot ${k<s?"done":k===s?"cur":""}"></span>`).join("");
    const done=s>=it.sets;
    $("setForm").classList.toggle("hidden",false);
    const lastSet=s>=it.sets-1;
    $("rirBox").classList.toggle("hidden",!lastSet);$("grid").classList.toggle("three",lastSet);
    $("rLbl").textContent=it.seconds?"الثواني":"العدات";
    $("wLbl").textContent=it.unit==="كل ناحية"?"الوزن (ناحية واحدة)":it.unit&&it.unit!=="كجم"&&it.unit!=="وزن جسم"?`الوزن (${it.unit})`:"الوزن";
    $("w").placeholder=it.unit==="وزن جسم"?"اختياري":"";
    const prevW=s?it.logs[s-1].w:(L&&L.it.logs[0]?L.it.logs[0].w:"");
    $("w").value=prevW;$("r").value="";$("rir").value="";
    $("undoBtn").classList.toggle("hidden",!s);
    $("step").textContent=done?"خلصت الستات ✅":`ست ${s+1} من ${it.sets}${it.optional?" • اختياري":""}`;$("note").textContent="";
    $("mainBtn").textContent=`خلصت الست ${s+1}`;
  }
  // timer labels
  if(S.phase==="rest"){
    const nx=S.advance?S.items[nextIndex(S.i)]:it;
    $("tLbl").textContent="راحة";$("plusBtn").classList.remove("hidden");$("endBtn").textContent="خلصت الراحة";
    $("nextup").innerHTML=S.advance?(nx?`الجاي:<b>${esc(nx.name)}</b>`:"دي كانت آخر ست"):`الجاي: ست ${it.logs.length+1} من ${it.sets}<b>${esc(it.name)}</b>`;
  }else if(S.phase==="timed"){
    $("tLbl").textContent=it.name;$("plusBtn").classList.add("hidden");$("endBtn").textContent="خلصت";$("nextup").textContent=it.note||"";
  }
  $("planList").innerHTML=S.items.map((x,k)=>{
    const prog=x.timed?(x.done?"✅":`${x.minutes} د`):(x.logs.length>=x.sets?"✅":`${x.logs.length}/${x.sets}`);
    return `<li class="${isDone(x)?"done":""} ${k===S.i?"cur":""}"><button data-k="${k}"><span>${esc(x.name)}${x.optional?" (اختياري)":""}${x.target?`<small>الهدف: ${esc(x.target)}</small>`:""}</span><span class="num">${prog}</span></button></li>`}).join("");
  $("planList").querySelectorAll("button").forEach(b=>b.onclick=()=>jump(+b.dataset.k));
  tick();
}
function jump(k){const S=A();$("skipReasons").classList.add("hidden");S.i=k;S.phase="work";S.alerted=false;save();renderSession();window.scrollTo(0,0)}
function doneSet(){
  unlock();const S=A(),it=S.items[S.i];
  if(it.timed){if(it.done){advance();return}S.phase="timed";S.dur=it.minutes*60;S.endsAt=Date.now()+S.dur*1000;S.alerted=false;S.warned=false;save();renderSession();return}
  const w=$("w").value.trim(),r=$("r").value.trim();
  if(!r){$("r").focus();$("note").textContent=it.seconds?"اكتب الثواني الأول.":"اكتب العدات الأول.";return}
  it.logs.push({w,r,t:Date.now()});
  if($("rir").value)it.rir=$("rir").value;
  const blockDone=it.logs.length>=it.sets;
  if(blockDone&&nextIndex(S.i)===-1){save();endSession();return}
  S.phase="rest";S.dur=it.rest;S.endsAt=Date.now()+it.rest*1000;S.advance=blockDone;S.alerted=false;S.warned=false;save();renderSession();
}
function advance(){const S=A();const n=nextIndex(S.i);if(n===-1){endSession();return}S.i=n;S.phase="work";save();renderSession()}
function endRest(){const S=A();S.alerted=false;if(S.phase==="timed"){S.items[S.i].done=true;advance();return}
  if(S.advance)advance();else{S.phase="work";save();renderSession()}}
const SKIP_REASONS=["زحمة","وقت","تعب","وجع","تاني"];
function skip(){const S=A(),it=S.items[S.i];
  if(!isDone(it)&&!it.skip){ // ask why once, so the dashboard can tell crowding from pain
    const box=$("skipReasons");
    if(box.classList.contains("hidden")){box.innerHTML='<span class="muted">ليه هتعدّيه؟</span>'+SKIP_REASONS.map(r=>`<button class="chip" data-r="${r}">${r}</button>`).join("");
      box.classList.remove("hidden");box.querySelectorAll("button").forEach(b=>b.onclick=()=>{it.skip=b.dataset.r;box.classList.add("hidden");save();skip()});return}
  }
  $("skipReasons").classList.add("hidden");
  const n=nextIndex(S.i);if(n===-1||n===S.i){if(armed($("skipBtn"),"مفيش تمارين تانية. اضغط تاني للإنهاء"))endSession();return}S.i=n;S.phase="work";save();renderSession()}
function undo(){const S=A(),it=S.items[S.i];if(it.logs.length){it.logs.pop();if(it.logs.length<it.sets)it.rir="";save();renderSession()}}
function endSession(){
  const S=A();if(!S)return;S.finishedAt=Date.now();
  D.history.push({day:S.day,startedAt:S.startedAt,finishedAt:S.finishedAt,items:S.items.map(x=>x.timed?{id:x.id,name:x.name,timed:true,minutes:x.minutes,done:x.done,skip:x.skip||""}:{id:x.id,name:x.name,unit:x.unit,seconds:!!x.seconds,abs:!!x.abs,optional:!!x.optional,logs:x.logs,rir:x.rir,skip:x.skip||""})});
  if(D.history.length>400)D.history=D.history.slice(-400);refreshDash();
  const h=D.history[D.history.length-1];D.active=null;save();try{lock&&lock.release()}catch(e){}
  openSummary(h);
}
function tick(){
  const S=A();if(!S||$("session").classList.contains("hidden"))return;
  const el=(Date.now()-S.startedAt)/1000;$("elapsed").textContent=fmt(el,true);
  const left=S.budget-el/60,st=$("status");
  const remaining=S.items.filter(x=>!isDone(x)).length;
  if(left<0){st.className="status late";st.textContent=`عدّيت وقتك بـ ${Math.ceil(-left)} دقيقة`}
  else{st.className="status ok";st.textContent=`فاضل ${Math.floor(left)} دقيقة • ${remaining} تمرين`}
  if(S.phase==="rest"||S.phase==="timed"){
    const l=(S.endsAt-Date.now())/1000;$("digits").textContent=fmt(Math.max(0,l));
    const C=2*Math.PI*52,p=$("prog");p.style.strokeDasharray=C;p.style.strokeDashoffset=C*(1-Math.max(0,l)/S.dur);
    if(l<=10&&l>0&&!S.warned){S.warned=true;warn()}
    if(l<=0&&!S.alerted){S.alerted=true;alarm();save();
      if(S.phase==="rest")setTimeout(()=>{if(A()&&A().phase==="rest")endRest()},1300);
      else{$("tLbl").textContent="خلصت ✅"}}
  }
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
    out.push(`${x.abs?"-":n++ +"-"} ${x.name}${u}: ${x.logs.length?setsTxt(x.logs,x):`متلعبش${x.skip?` (${x.skip})`:""}`}${x.rir?` (RIR ${x.rir})`:""}`);
  });
  return out.join("\n");
}
let curSum=null;
function openSummary(h){curSum=h;$("editBox").classList.add("hidden");$("editBtn").classList.toggle("hidden",!D.history.includes(h));$("sumText").value=summaryText(h);$("shareBtn").textContent="ابعت الملخص";$("copyBtn").textContent="نسخ";show("summary")}
async function copyText(t,btn){try{await navigator.clipboard.writeText(t);btn.textContent="اتنسخ ✅"}catch(e){const ta=$("sumText");ta.select();try{document.execCommand("copy");btn.textContent="اتنسخ ✅"}catch(_){btn.textContent="حدد النص وانسخه"}}}
$("shareBtn").onclick=async()=>{const t=$("sumText").value;if(navigator.share){try{await navigator.share({text:t});return}catch(e){if(e.name==="AbortError")return}}copyText(t,$("shareBtn"))};
$("copyBtn").onclick=()=>copyText($("sumText").value,$("copyBtn"));
$("homeBtn").onclick=()=>{show("home");renderHome()};
$("delSumBtn").onclick=()=>{if(!curSum)return;if(!armed($("delSumBtn"),"اضغط تاني عشان تمسحها نهائياً"))return;
  D.history=D.history.filter(x=>x.startedAt!==curSum.startedAt);curSum=null;save();refreshDash();show("home");renderHome()};
/* edit a saved session: fix a wrong number, delete a stray set, note why something was skipped */
function renderEdit(){
  const h=curSum,box=$("editBox");
  box.innerHTML=h.items.map((x,i)=>x.timed?`<div class="edEx"><div class="edHead">${esc(x.name)}</div>
      <label class="check"><input type="checkbox" data-i="${i}" data-f="done" ${x.done?"checked":""}> اتعملت</label></div>`
    :`<div class="edEx"><div class="edHead">${esc(x.name)}${x.unit&&x.unit!=="كجم"?` <span class="unit">${esc(x.unit)}</span>`:""}</div>
      ${x.logs.map((l,j)=>`<div class="edRow"><span class="num muted">${j+1}</span>
        <input type="text" inputmode="decimal" aria-label="الوزن" data-i="${i}" data-j="${j}" data-f="w" value="${esc(l.w)}">
        <span class="muted">×</span><input type="text" inputmode="numeric" aria-label="العدات" data-i="${i}" data-j="${j}" data-f="r" value="${esc(l.r)}">
        <button class="mini" data-i="${i}" data-j="${j}" data-a="del" aria-label="امسح الست">امسح</button></div>`).join("")}
      <div class="edRow"><button class="mini" data-i="${i}" data-a="add">+ ست</button>
        <label class="muted" style="margin:0 8px 0 0">RIR</label><input type="text" inputmode="numeric" style="max-width:64px" data-i="${i}" data-f="rir" value="${esc(x.rir)}">
        ${x.logs.length?"":`<select data-i="${i}" data-f="skip" aria-label="سبب التخطي"><option value="">السبب؟</option>${SKIP_REASONS.map(r=>`<option ${x.skip===r?"selected":""}>${r}</option>`).join("")}</select>`}</div></div>`).join("")+
    `<button class="primary" id="edSave">حفظ التعديل</button>`;
  box.querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("change",()=>{const it=h.items[+inp.dataset.i],f=inp.dataset.f;
    if(f==="w"||f==="r")it.logs[+inp.dataset.j][f]=inp.value.trim();else if(f==="done")it.done=inp.checked;else it[f]=inp.value.trim()}));
  box.querySelectorAll("button[data-a]").forEach(b=>b.onclick=()=>{const it=h.items[+b.dataset.i];
    if(b.dataset.a==="del"){if(!armed(b,"تاني"))return;it.logs.splice(+b.dataset.j,1)}else{const l=it.logs[it.logs.length-1];it.logs.push({w:l?l.w:"",r:l?l.r:""})}
    renderEdit()});
  $("edSave").onclick=()=>{save();refreshDash();openSummary(h)};
}
$("editBtn").onclick=()=>{const b=$("editBox");if(b.classList.contains("hidden")){renderEdit();b.classList.remove("hidden");b.scrollIntoView({behavior:"smooth"})}else b.classList.add("hidden")};

/* ---------- SETTINGS ---------- */
let tab="push",openEx=null;
const TABS={push:"Push",pull:"Pull",legs:"Legs",absA:"بطن A",absB:"بطن B",cardio:"مشاية"};
function renderSettings(){
  $("tabs").innerHTML=Object.keys(TABS).map(k=>`<button class="chip" data-t="${k}" aria-pressed="${k===tab}">${TABS[k]}</button>`).join("");
  $("tabs").querySelectorAll(".chip").forEach(c=>c.onclick=()=>{tab=c.dataset.t;openEx=null;renderSettings()});
  const isC=tab==="cardio";$("cardioEdit").classList.toggle("hidden",!isC);$("exList").classList.toggle("hidden",isC);$("addEx").classList.toggle("hidden",isC);
  if(isC){$("cMin").value=D.plans.cardio.minutes;$("cNote").value=D.plans.cardio.note;return}
  const list=D.plans[tab];
  $("exList").innerHTML=list.map((x,k)=>`<div class="ex">
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
      <button class="ghost full" data-a="base" data-k="${k}">جهاز جديد: ابدأ المقارنة من النهارده${x.baselines&&x.baselines.length?` (آخر مرة ${esc(x.baselines[x.baselines.length-1])})`:""}</button>
      <button class="ghost full" data-a="del" data-k="${k}" style="color:var(--plate);border-color:var(--plate)">شيل التمرين</button>
    </div>`:""}</div>`).join("");
  $("exList").querySelectorAll("button[data-a]").forEach(b=>b.onclick=()=>{const k=+b.dataset.k,a=b.dataset.a;
    if(a==="del"){if(!armed(b,"اضغط تاني عشان تشيله"))return;list.splice(k,1);openEx=null}
    if(a==="base"){if(!armed(b,"اضغط تاني: الشارت هيبدأ خط جديد"))return;const t=new Date(),ds=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;(list[k].baselines=list[k].baselines||[]).push(ds);refreshDash()}
    if(a==="edit")openEx=openEx===k?null:k;
    if(a==="up"&&k>0){[list[k-1],list[k]]=[list[k],list[k-1]];openEx=null}
    if(a==="down"&&k<list.length-1){[list[k+1],list[k]]=[list[k],list[k+1]];openEx=null}
    if(a==="del"&&false){}
    save();renderSettings()});
  $("exList").querySelectorAll("[data-f]").forEach(inp=>inp.addEventListener("change",()=>{const x=list[openEx],f=inp.dataset.f;
    x[f]=inp.type==="checkbox"?inp.checked:inp.type==="number"?Math.max(0,+inp.value||0):inp.value.trim();save()}));
}
$("addEx").onclick=()=>{D.plans[tab].push(E("x"+Date.now(),"تمرين جديد",3,8,12,90,"كجم",""));openEx=D.plans[tab].length-1;save();renderSettings()};
$("cMin").onchange=()=>{D.plans.cardio.minutes=Math.max(1,+$("cMin").value||20);save()};
$("cNote").onchange=()=>{D.plans.cardio.note=$("cNote").value.trim();save()};
$("exportBtn").onclick=()=>{$("backup").value=JSON.stringify({plans:D.plans,history:D.history});copyText($("backup").value,$("exportBtn"))};
$("importBtn").onclick=()=>{try{const v=JSON.parse($("backup").value);if(!v.plans)throw 0;if(!armed($("importBtn"),"هتستبدل كل حاجة. اضغط تاني"))return;
  D.plans=v.plans;D.history=v.history||[];save();renderSettings();$("importBtn").textContent="اترجعت ✅"}catch(e){$("importBtn").textContent="النسخة دي مش سليمة"}};
$("resetPlans").onclick=()=>{if(!armed($("resetPlans"),"اضغط تاني للتأكيد (السجل مش هيتمسح)"))return;D.plans=JSON.parse(JSON.stringify(DEFAULTS));save();renderSettings()};

/* ---------- wiring ---------- */
$("toSettings").onclick=()=>{show("settings");renderSettings()};
document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>{show(b.dataset.v);if(b.dataset.v==="home")renderHome()});
$("backHome").onclick=()=>{show("home");renderHome()};
$("cancelSetup").onclick=renderHome;
$("startBtn").onclick=startSession;
$("resumeBtn").onclick=()=>{wake();show("session");renderSession()};
$("mainBtn").onclick=doneSet;
$("endBtn").onclick=endRest;
$("plusBtn").onclick=()=>{const S=A();S.endsAt+=30000;S.dur+=30;S.warned=false;save()};
$("skipBtn").onclick=skip;$("undoBtn").onclick=undo;
$("finishBtn").onclick=()=>{if(armed($("finishBtn"),"اضغط تاني عشان تنهي وتطلع الملخص"))endSession()};
$("restartBtn").onclick=()=>{const S=A();if(!S)return;
  if(!armed($("restartBtn"),"اضغط تاني: هتتمسح ومش هتتحفظ"))return;
  const day=S.day;D.active=null;save();try{lock&&lock.release()}catch(e){}
  show("home");renderHome();openSetup(day)};
["w","r"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();id==="w"?$("r").focus():doneSet()}}));

if(D.active){show("session");renderSession();wake()}else{show("home");renderHome()}
const BUILD="2026-10-15f";
if("serviceWorker" in navigator&&location.protocol==="https:"){
  // a new version takes over → reload once so the new files show right away
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
$("hardRefresh").onclick=hardRefresh;
