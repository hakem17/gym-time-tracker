/* Backup to GitHub: after each workout the phone's log is encrypted with the coach's public key
   (keys.json) and saved as logs/phone.enc.json in the repo. Only the passphrase can open it.
   The token stays on this phone and is only sent to api.github.com. */
(function(){
"use strict";
const REPO="hakem17/gym-time-tracker",PATH="logs/phone.enc.json",TK="gtt-gh-token",LAST="gtt-last-sync";
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const ub=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
const bu=buf=>{let s="";const a=new Uint8Array(buf);for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode.apply(null,a.subarray(i,i+8192));return btoa(s)};
const b64utf8=str=>bu(new TextEncoder().encode(str));
let state="idle",msg="",timer=null;

async function encrypt(obj){
  const keys=await (await fetch("keys.json",{cache:"no-store"})).json();
  const pub=await crypto.subtle.importKey("spki",ub(keys.pub),{name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"]);
  const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  const aes=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},aes,new TextEncoder().encode(JSON.stringify(obj)));
  const ek=await crypto.subtle.encrypt({name:"RSA-OAEP"},pub,raw);
  return{v:1,ek:bu(ek),iv:bu(iv),ct:bu(ct)};
}
async function decryptWithStoredKey(enc){
  const pk=ls.get("gtt-pk");if(!pk)throw new Error("nokey");
  const priv=await crypto.subtle.importKey("pkcs8",ub(pk),{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
  const raw=await crypto.subtle.decrypt({name:"RSA-OAEP"},priv,ub(enc.ek));
  const aes=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:ub(enc.iv)},aes,ub(enc.ct))));
}
const api=(path,opt={})=>fetch(`https://api.github.com/repos/${REPO}/contents/${path}`,{...opt,headers:{"Accept":"application/vnd.github+json","Authorization":`Bearer ${ls.get(TK)}`,...(opt.headers||{})}});
async function remote(){const r=await api(PATH+"?ref=main",{cache:"no-store"});if(r.status===404)return null;if(!r.ok)throw new Error("get "+r.status);return r.json()}

async function syncUp(){
  if(!ls.get(TK)){state="off";render();return}
  if(typeof D==="undefined")return;
  state="busy";msg="";render();
  try{
    const payload={v:1,updated:new Date().toISOString(),build:typeof BUILD!=="undefined"?BUILD:"",history:D.history,body:D.body||{},plans:D.plans};
    const enc=await encrypt(payload);
    const cur=await remote();
    const body={message:`Workout log backup ${new Date().toISOString().slice(0,16)}`,content:b64utf8(JSON.stringify(enc)),branch:"main",...(cur?{sha:cur.sha}:{})};
    const r=await api(PATH,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(r.status===401||r.status===403)throw new Error("auth");
    if(r.status===409||r.status===422){const again=await remote();body.sha=again&&again.sha;const r2=await api(PATH,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r2.ok)throw new Error("put "+r2.status)}
    else if(!r.ok)throw new Error("put "+r.status);
    ls.set(LAST,String(Date.now()));state="ok";
  }catch(e){state="err";msg=e.message==="auth"?"الـ token مرفوض: اتأكد إن له صلاحية Contents: Read and write على الريبو.":navigator.onLine?"الرفع فشل، هحاول تاني المرة الجاية.":"مفيش نت، هيترفع لما يرجع."}
  render();
}
async function restore(btn){
  btn.textContent="بجيب…";
  try{
    const cur=await remote();if(!cur){btn.textContent="مفيش نسخة على GitHub لسه";return}
    const enc=JSON.parse(new TextDecoder().decode(ub(cur.content.replace(/\n/g,""))));
    const data=await decryptWithStoredKey(enc);
    const have=new Set(D.history.map(h=>h.startedAt));let added=0;
    (data.history||[]).forEach(h=>{if(!have.has(h.startedAt)){D.history.push(h);added++}});
    D.history.sort((a,b)=>a.startedAt-b.startedAt);
    if(data.body){D.body=D.body||{};["waist","weight"].forEach(k=>{const m=new Map((D.body[k]||[]).map(x=>[x.date,x]));(data.body[k]||[]).forEach(x=>{if(!m.has(x.date))m.set(x.date,x)});D.body[k]=[...m.values()].sort((a,b)=>a.date<b.date?-1:1)})}
    save();btn.textContent=added?`اترجع ${added} تمرينة ✓`:"كله موجود أصلاً ✓";window.GTT_refresh&&GTT_refresh();
  }catch(e){btn.textContent=e.message==="nokey"?"افتح داتا الكوتش بالباسورد الأول (من التقدم)":"الاسترجاع فشل"}
}
function render(){
  const c=document.getElementById("syncCard");if(!c)return;
  const has=!!ls.get(TK),last=+ls.get(LAST)||0;
  const status=!has?`<p class="muted" style="margin:0">مقفولة. التمرينات محفوظة على الموبايل ده بس.</p>`
    :state==="busy"?`<p class="muted" style="margin:0">بيرفع…</p>`
    :state==="err"?`<p class="syncbad" style="margin:0">${msg}</p>`
    :`<p class="syncok" style="margin:0">شغالة ✓ ${last?`آخر رفع ${new Date(last).toLocaleString("ar-EG",{weekday:"short",hour:"numeric",minute:"2-digit"})}`:""}</p>`;
  c.innerHTML=status+`
    <details style="margin-top:10px"><summary class="lnk" style="cursor:pointer">${has?"غيّر الـ token":"شغّلها (مرة واحدة)"}</summary>
      <ol style="padding-inline-start:20px;margin:8px 0;font-size:14px;line-height:1.7;color:var(--muted)">
        <li>افتح github.com/settings/personal-access-tokens/new</li>
        <li>Repository access: Only select repositories ← gym-time-tracker</li>
        <li>Permissions ← Contents: Read and write</li>
        <li>Generate، وانسخ الـ token والصقه هنا</li></ol>
      <input id="tokIn" type="password" class="fld" placeholder="github_pat_…" autocomplete="off" style="direction:ltr">
      <button class="pill move block" id="tokSave" style="margin-top:10px">احفظ وارفع دلوقتي</button>
      ${has?`<button class="lnk dim" id="tokDel">امسح الـ token</button>`:""}</details>
    ${has?`<div class="row"><button class="pill gray" id="syncNow">ارفع دلوقتي</button><button class="pill gray" id="syncGet">استرجع من GitHub</button></div>`:""}`;
  const q=id=>document.getElementById(id);
  q("tokSave").onclick=()=>{const v=q("tokIn").value.trim();if(!v)return;ls.set(TK,v);syncUp()};
  if(q("tokDel"))q("tokDel").onclick=()=>{ls.del(TK);state="off";render()};
  if(q("syncNow"))q("syncNow").onclick=syncUp;
  if(q("syncGet"))q("syncGet").onclick=()=>restore(q("syncGet"));
}
window.GTT_queueSync=()=>{if(!ls.get(TK))return;clearTimeout(timer);timer=setTimeout(syncUp,1500)};
window.addEventListener("online",()=>{if(state==="err")syncUp()});
render();
})();
