const KEY="medtrack-v3";
let state=JSON.parse(localStorage.getItem(KEY)||'{"meds":[],"history":[],"settings":{"reminderMode":"notification","notified":{}}}');
state.meds ??= []; state.history ??= []; state.settings ??= {reminderMode:"notification",notified:{},theme:"system"};
state.settings.theme ??= "system";

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const ACTIVITY_KEY="medtrack-activity-log";
function addActivity(action,details={}){
  try{
    const current=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||"[]");
    current.unshift({id:Date.now()+"-"+Math.random().toString(36).slice(2,8),action,details,at:new Date().toISOString()});
    localStorage.setItem(ACTIVITY_KEY,JSON.stringify(current.slice(0,500)));
  }catch(_){ }
}
let hydrating=false, cloudTimer=null;
const save=()=>{
  localStorage.setItem(KEY,JSON.stringify(state));
  if(!hydrating){
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(()=>syncReminders(),500);
  }
};
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const todayKey=()=>{
  const d=new Date();
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
};
const localDateKey=d=>{
  const dt=d instanceof Date?d:new Date(d);
  if(Number.isNaN(dt.getTime())) return todayKey();
  const p=n=>String(n).padStart(2,"0");
  return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`;
};
function parseDayKey(value){
  if(value==null||value==="") return "";
  const s=String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt=new Date(s);
  if(!Number.isNaN(dt.getTime())) return localDateKey(dt);
  const iso=s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso?iso[1]:"";
}
const fmtDate=d=>new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(d);
const fmtShort=key=>{
  const day=parseDayKey(key);
  const [y,m,d]=String(day||key).split("-");
  if(!d) return key;
  return `${d}/${m}/${y}`;
};
function medStartKey(m){
  return parseDayKey(m.startDate)||(m.createdAt?localDateKey(m.createdAt):"")||todayKey();
}
function daysBetween(startKey,endKey){
  const start=parseDayKey(startKey);
  const end=parseDayKey(endKey);
  if(!start||!end) return NaN;
  const a=new Date(`${start}T12:00:00`);
  const b=new Date(`${end}T12:00:00`);
  return Math.round((b-a)/86400000);
}
function isMedScheduledOn(m,dateKey=todayKey()){
  if(m.active===false) return false;
  const days=parseInt(m.durationDays,10);
  if(!Number.isFinite(days)||days<=0) return true;
  const n=daysBetween(medStartKey(m),dateKey);
  if(!Number.isFinite(n)||n<0) return true;
  return n<days;
}
function nowTime(){return new Date().toTimeString().slice(0,5)}
const iconFor=t=>t==="suplemento"||t==="vitamina"?"sup":"med";
function toast(msg){const el=$("#toast");if(!el)return;el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
function kindLabel(t){return t==="suplemento"?"suplemento":t==="vitamina"?"vitamina":"medicamento"}
function kindPhrase(t){return t==="vitamina"?"da vitamina":t==="suplemento"?"do suplemento":"do medicamento"}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
function isStandalone(){
  if(isIOS()) return window.navigator.standalone===true||window.matchMedia("(display-mode: standalone)").matches;
  return window.matchMedia("(display-mode: standalone)").matches||window.matchMedia("(display-mode: fullscreen)").matches;
}
function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
function getStatusOn(m,time,dateKey){
  const hit=state.history.find(x=>{
    if(String(x.medId)!==String(m.id)||x.time!==time) return false;
    const local=x.at?localDateKey(x.at):(parseDayKey(x.date)||parseDayKey(String(x.key||"").slice(0,10)));
    return local===dateKey;
  });
  return hit?.status;
}
function upcomingDosePayload(){
  const items=[], taken=[];
  for(let dayOffset=0; dayOffset<2; dayOffset++){
    const d=new Date();
    d.setDate(d.getDate()+dayOffset);
    const dateKey=localDateKey(d);
    state.meds.filter(m=>isMedScheduledOn(m,dateKey)).forEach(m=>(m.times||[]).forEach(time=>{
      const status=getStatusOn(m,time,dateKey);
      const key=`${dateKey}|${m.id}|${time}`;
      if(status){taken.push(key);return}
      const [h,mi]=String(time).split(":").map(Number);
      if(!Number.isFinite(h)) return;
      const when=new Date(d.getFullYear(),d.getMonth(),d.getDate(),h,mi,0,0);
      items.push({id:m.id,name:m.name,dose:m.dose||"",type:m.type,time,date:dateKey,at:when.getTime(),key});
    }));
  }
  return {doses:items,taken};
}
function show(screen){
  $$(".tab").forEach(b=>{
    const on=b.dataset.screen===screen;
    b.classList.toggle("active",on);
    if(on) b.setAttribute("aria-current","page");
    else b.removeAttribute("aria-current");
  });
  $$(".screen").forEach(s=>{
    const on=s.id===screen;
    s.classList.toggle("active",on);
    s.hidden=!on;
  });
  $("#fabAdd")?.classList.toggle("hidden",screen==="register"||screen==="settings");
  addActivity("navegacao",{section:screen});
  if(screen==="today")renderToday();
  if(screen==="register")renderMeds();
  if(screen==="history")renderHistory();
}
$$(".tab").forEach(b=>b.onclick=()=>show(b.dataset.screen));
$$("[data-go]").forEach(b=>b.onclick=()=>show(b.dataset.go));

function doseKey(m,time,date=todayKey()){return `${date}|${m.id}|${time}`}
function record(m,time,status){
  const key=doseKey(m,time), i=state.history.findIndex(x=>x.key===key);
  const item={key,date:todayKey(),medId:m.id,medName:m.name,time,status,at:new Date().toISOString()};
  if(i>=0) state.history[i]=item; else state.history.push(item);
  save();
  addActivity(status==="taken"?"dose_tomada":"dose_pulada",{medId:m.id,medName:m.name,time,status,date:item.date});
  stopDoseAlarm();
  syncReminders();
  renderToday(); toast(status==="taken"?"Dose registrada como tomada":"Dose marcada como pulada");
}
function getStatus(m,time){
  const today=todayKey();
  const hit=state.history.find(x=>{
    if(String(x.medId)!==String(m.id)||x.time!==time) return false;
    const local=x.at?localDateKey(x.at):(parseDayKey(x.date)||parseDayKey(String(x.key||"").slice(0,10)));
    return local===today;
  });
  return hit?.status;
}
function renderToday(){
  const now=new Date(), date=todayKey(), clock=nowTime();
  $("#todayDate").textContent=fmtDate(now);
  const doses=[];
  state.meds.filter(m=>isMedScheduledOn(m,date)).forEach(m=>(m.times||[]).forEach(time=>doses.push({m,time,status:getStatus(m,time)})));
  doses.sort((a,b)=>a.time.localeCompare(b.time));
  const taken=doses.filter(x=>x.status==="taken").length, skipped=doses.filter(x=>x.status==="skipped").length;
  $("#scheduledCount").textContent=doses.length;$("#takenCount").textContent=taken;$("#skippedCount").textContent=skipped;
  const pct=doses.length?Math.round(taken/doses.length*100):0;$("#progressText").textContent=pct+"%";$("#progressRing").style.background=`conic-gradient(var(--accent) ${pct*3.6}deg,var(--track) ${pct*3.6}deg)`;
  $("#todayStatus").textContent=doses.length?(pct===100?"Rotina concluída":"Acompanhe suas doses"):"";
  $("#emptyToday").classList.toggle("hidden",doses.length>0);
  $("#todayList").innerHTML=doses.map(({m,time,status})=>{
    const overdue=!status && time<clock;
    return `<article class="dose-card ${status?"done":""} ${overdue?"overdue":""}">
      <div class="dose-icon ${iconFor(m.type)}"><svg viewBox="0 0 24 24"><path d="M7 4h10v16H7zM9 8h6M9 12h6M9 16h4"/></svg></div>
      <div class="dose-main"><strong>${esc(m.name)}</strong><small>${esc(m.dose||"Dose não informada")} ${m.notes?"· "+esc(m.notes):""}${medDurationLabel(m)?" · "+esc(medDurationLabel(m)):""}</small></div>
      <div class="dose-time">${esc(time)}</div>
      ${status?`<div class="status ${status}">${status==="taken"?"Tomado":"Pulado"}</div>`:`<div class="dose-actions"><button class="take" data-action="take" data-id="${m.id}" data-time="${time}">Tomei</button><button class="skip" data-action="skip" data-id="${m.id}" data-time="${time}">Pular</button></div>`}
    </article>`}).join("");
  $$("#todayList [data-action]").forEach(b=>b.onclick=()=>{const m=state.meds.find(x=>x.id===b.dataset.id);if(m)record(m,b.dataset.time,b.dataset.action==="take"?"taken":"skipped")});
}

function addTime(value="08:00"){
  const row=document.createElement("div");row.className="time-row";row.innerHTML=`<input type="time" value="${value}" required><button type="button" class="remove-time" aria-label="Remover horário">×</button>`;
  row.querySelector(".remove-time").onclick=()=>{if($$("#times .time-row").length>1)row.remove();else toast("Mantenha pelo menos um horário")};
  $("#times").append(row);
}
function resetForm(){ $("#medForm").reset();$("#medId").value="";$("#durationDays").value="";$("#times").innerHTML="";addTime();$("#active").checked=true;$("#formTitle").textContent="Novo medicamento";$("#saveBtn").textContent="Salvar medicamento";$("#cancelEdit").classList.add("hidden") }
$("#addTime").onclick=()=>addTime();
$("#medForm").onsubmit=e=>{
  e.preventDefault();
  const id=$("#medId").value,name=$("#name").value.trim(),type=$("#type").value,dose=$("#dose").value.trim(),notes=$("#notes").value.trim(),active=$("#active").checked;
  const durationRaw=$("#durationDays").value.trim();
  const durationDays=durationRaw?Math.max(1,parseInt(durationRaw,10)||1):"";
  const times=$$("#times input").map(x=>x.value).filter(Boolean).sort();
  if(!times.length)return toast("Informe um horário");
  if(id){
    const m=state.meds.find(x=>x.id===id);if(!m)return;
    Object.assign(m,{name,type,dose,notes,active,times,durationDays});
    m.startDate=parseDayKey(m.startDate)||medStartKey(m);
    addActivity("medicamento_editado",{medId:m.id,medName:m.name,durationDays,startDate:m.startDate});
  } else {
    const m={id:uid(),name,type,dose,notes,active,times,durationDays,startDate:todayKey(),createdAt:new Date().toISOString()};
    state.meds.push(m);
    addActivity("medicamento_cadastrado",{medId:m.id,medName:m.name,durationDays,startDate:m.startDate});
  }
  save();resetForm();renderMeds();show("today");syncReminders();reminderCheck();
  if(!("Notification"in window)||Notification.permission!=="granted"){
    toast("Salvo. Ative as notificações em Ajustes para eu te chamar no horário.");
  }else{
    toast(id?"Medicamento atualizado":"Medicamento cadastrado");
  }
};
$("#cancelEdit").onclick=resetForm;

function medDurationLabel(m){
  const days=parseInt(m.durationDays,10);
  if(!Number.isFinite(days)||days<=0) return "";
  const start=medStartKey(m);
  const n=daysBetween(start,todayKey())+1;
  const endDate=new Date(`${parseDayKey(start)||todayKey()}T12:00:00`);
  if(Number.isNaN(endDate.getTime())) return `${days} dias`;
  endDate.setDate(endDate.getDate()+days-1);
  const end=localDateKey(endDate);
  if(!Number.isFinite(n)||n<1) return `${days} dias · até ${fmtShort(end)}`;
  if(n>days) return `Encerrado em ${fmtShort(end)}`;
  return `Dia ${n} de ${days} · até ${fmtShort(end)}`;
}
function renderMeds(){
  $("#medCount").textContent=state.meds.length;
  $("#medList").innerHTML=state.meds.length?state.meds.map(m=>`<article class="med-card">
    <div class="med-info"><strong>${esc(m.name)} ${m.active===false?"· inativo":""}</strong><div class="med-meta">${esc(m.type)}${m.dose?" · "+esc(m.dose):""}${medDurationLabel(m)?" · "+esc(medDurationLabel(m)):""}</div><div class="med-times">${(m.times||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join("")}</div></div>
    <div class="med-actions"><button class="mini" data-edit="${m.id}">Editar</button><button class="mini" data-delete="${m.id}">Excluir</button></div>
  </article>`).join(""):`<div class="empty"><h3>Nenhum cadastro</h3><p>Seus medicamentos aparecerão aqui.</p></div>`;
  $$("#medList [data-edit]").forEach(b=>b.onclick=()=>editMed(b.dataset.edit));
  $$("#medList [data-delete]").forEach(b=>b.onclick=()=>deleteMed(b.dataset.delete));
}
function editMed(id){
  const m=state.meds.find(x=>x.id===id);if(!m)return;
  $("#medId").value=m.id;$("#name").value=m.name;$("#type").value=m.type;$("#dose").value=m.dose||"";$("#notes").value=m.notes||"";$("#durationDays").value=m.durationDays||"";$("#active").checked=m.active!==false;$("#times").innerHTML="";(m.times||["08:00"]).forEach(addTime);
  $("#formTitle").textContent="Editar medicamento";$("#saveBtn").textContent="Salvar alterações";$("#cancelEdit").classList.remove("hidden");show("register");scrollTo({top:0,behavior:"smooth"});
}
function deleteMed(id){
  const m=state.meds.find(x=>x.id===id);if(!m)return;
  if(confirm(`Excluir "${m.name}"?`)){state.meds=state.meds.filter(x=>x.id!==id);state.history=state.history.filter(x=>x.medId!==id);addActivity("medicamento_excluido",{medId:id,medName:m.name});save();renderMeds();renderToday();toast("Medicamento excluído")}
}

let currentFilter="all";
$$(".filter").forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;$$(".filter").forEach(x=>x.classList.toggle("active",x===b));renderHistory()});
function renderHistory(){
  const arr=[...state.history].filter(x=>currentFilter==="all"||x.status===currentFilter).sort((a,b)=>b.at.localeCompare(a.at));
  $("#historyList").innerHTML=arr.length?arr.map(x=>`<article class="history-item"><div class="history-left"><strong>${esc(x.medName)}</strong><span>${esc(x.date)} · ${esc(x.time)}</span></div><span class="status ${x.status}">${x.status==="taken"?"Tomado":"Pulado"}</span></article>`).join(""):`<div class="empty"><h3>Nenhum registro</h3><p>As doses registradas aparecerão aqui.</p></div>`;
}

async function enableSystemAlerts(){
  unlockAlarmAudio();
  prepareBeepFile();
  if(!("Notification"in window))return toast("Seu navegador não oferece notificações");
  if(isIOS()&&!isStandalone()){
    toast("No iPhone: Compartilhar → Adicionar à Tela de Início e abra pelo ícone.");
    updateAlertSetup();
    return;
  }
  const p=await Notification.requestPermission();
  $("#notifyBtn").textContent=p==="granted"?"Ativadas":"Ativar";
  addActivity("notificacoes_permissao",{permission:p});
  if(p!=="granted"){
    updateAlertSetup();
    return toast("Permissão não concedida. Em Ajustes do iPhone, permita notificações do MedTrack.");
  }
  const sub=await enableBackgroundPush(true);
  if(!(sub&&sub.endpoint)){
    delete state.settings.pushEndpoint;
    localStorage.setItem(KEY,JSON.stringify(state));
    updateAlertSetup();
    $("#notifyBtn").textContent="Ativar";
    return toast("A permissão existe, mas o alerta ainda não registrou. Feche o app, abra pelo ícone e toque de novo.");
  }
  await syncReminders(true);
  updateAlertSetup();
  toast("Pronto. Deve chegar um aviso de teste agora. Se não chegar, permita o som do MedTrack em Ajustes.");
}
$("#notifyBtn").onclick=()=>enableSystemAlerts();
$("#pwaAlertBtn")?.addEventListener("click",()=>enableSystemAlerts());
function updateAlertSetup(){
  const box=$("#pwaAlertSetup"), title=$("#pwaAlertTitle"), text=$("#pwaAlertText"), btn=$("#pwaAlertBtn");
  if(!box) return;
  const granted=("Notification"in window&&Notification.permission==="granted"&&state.settings.pushEndpoint&&state.settings.pushOrigin===location.origin);
  if(granted){box.classList.add("hidden");return}
  box.classList.remove("hidden");
  if(isIOS()&&!isStandalone()){
    if(title) title.textContent="Instale o app para alertar de verdade";
    if(text) text.textContent="No iPhone, só o ícone na Tela de Início consegue notificar com a tela desligada.";
    if(btn) btn.textContent="Como instalar";
  }else{
    if(title) title.textContent="Alertas com a tela desligada";
    if(text) text.textContent="Ative aqui no app instalado. O bipe interno só toca com o app aberto; o aviso de verdade chega na Central de Notificações com a tela desligada.";
    if(btn) btn.textContent="Ativar alertas";
  }
}
$("#reminderMode").onchange=()=>{state.settings.reminderMode=$("#reminderMode").value;save();addActivity("modo_lembrete_alterado",{mode:state.settings.reminderMode});syncReminders()};

function backupStamp(d=new Date()){
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function readBackupEvents(){
  try{return JSON.parse(localStorage.getItem(ACTIVITY_KEY)||"[]")}catch(_){return []}
}
function buildBackup(){
  return {
    app:"MedTrack",
    version:"19.0",
    exportedAt:new Date().toISOString(),
    meds:Array.isArray(state.meds)?state.meds:[],
    history:Array.isArray(state.history)?state.history:[],
    settings:state.settings||{},
    events:readBackupEvents()
  };
}
function extractBackup(data){
  if(data==null) return null;
  if(Array.isArray(data)){
    if(data.some(x=>x&&(Array.isArray(x.times)||x.name))) return {meds:data};
    if(data.some(x=>x&&x.action)) return {events:data};
    return null;
  }
  if(typeof data!=="object") return null;
  const nested=[data.state,data.data,data.backup,data.payload,data].find(x=>x&&typeof x==="object")||data;
  const meds=Array.isArray(nested.meds)?nested.meds:Array.isArray(data.meds)?data.meds:null;
  const history=Array.isArray(nested.history)?nested.history:Array.isArray(data.history)?data.history:null;
  const settings=nested.settings&&typeof nested.settings==="object"?nested.settings:data.settings&&typeof data.settings==="object"?data.settings:null;
  const events=Array.isArray(data.events)?data.events:Array.isArray(nested.events)?nested.events:null;
  if(!meds&&!history&&!settings&&!events) return null;
  return {meds,history,settings,events};
}
function applyImportedJson(data){
  const pack=extractBackup(data);
  if(!pack) throw new Error("formato");
  const notes=[];
  if(Array.isArray(pack.events)){
    localStorage.setItem(ACTIVITY_KEY,JSON.stringify(pack.events.slice(0,500)));
    notes.push("atividade");
  }
  if(Array.isArray(pack.meds)){state.meds=pack.meds;notes.push("cadastros")}
  if(Array.isArray(pack.history)){state.history=pack.history;notes.push("histórico")}
  if(pack.settings&&typeof pack.settings==="object"){
    state.settings={...state.settings,...pack.settings};
    state.settings.notified=state.settings.notified||{};
    applyTheme(state.settings.theme||"system");
    const reminder=$("#reminderMode");
    if(reminder) reminder.value=state.settings.reminderMode||"notification";
    notes.push("ajustes");
  }
  if(!notes.length) throw new Error("formato");
  save();
  renderMeds();
  renderToday();
  renderHistory();
  syncReminders();
  addActivity("json_carregado",{parts:notes,source:"botao_carregar"});
  if(!Array.isArray(pack.meds)&&!Array.isArray(pack.history)){
    toast("Este JSON não tem medicamentos. Salve um novo backup.");
    return;
  }
  toast("Dados carregados");
  show("today");
}
function readFileText(file){
  if(file&&typeof file.text==="function") return file.text();
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("leitura"));
    reader.readAsText(file);
  });
}
function triggerJsonDownload(blob,filename){
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=filename;
  link.rel="noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function exportBackupFile(){
  const payload=buildBackup();
  const filename=`MedTrack-backup-${backupStamp()}.json`;
  const text=JSON.stringify(payload,null,2);
  const blob=new Blob([text],{type:"application/json;charset=utf-8"});
  const file=new File([blob],filename,{type:"application/json"});
  triggerJsonDownload(blob,filename);
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(ios&&navigator.canShare&&navigator.canShare({files:[file]})){
    navigator.share({files:[file],title:"MedTrack"}).catch(()=>{});
  }
  return "download";
}

const importJson=$("#importJson");
const pickJson=$("#pickJson");
const applyJson=$("#applyJson");
const importFileName=$("#importFileName");
let pendingImportFile=null;
function setPendingImport(file){
  pendingImportFile=file||null;
  if(importFileName) importFileName.textContent=file?file.name:"Nenhum arquivo selecionado";
  if(applyJson) applyJson.disabled=!file;
}
pickJson?.addEventListener("click",()=>{
  unlockAlarmAudio();
  importJson?.click();
});
importJson?.addEventListener("change",e=>{
  const file=e.target.files&&e.target.files[0];
  setPendingImport(file||null);
  if(file) toast("Arquivo selecionado. Toque em Aplicar.");
});
applyJson?.addEventListener("click",async()=>{
  if(!pendingImportFile) return toast("Escolha um arquivo JSON primeiro");
  try{
    const text=await readFileText(pendingImportFile);
    applyImportedJson(JSON.parse(text));
    if(importJson) importJson.value="";
    setPendingImport(null);
  }catch(_){
    toast("JSON inválido");
  }
});

let deferredPrompt;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("#installBtn").classList.remove("hidden")});
$("#installBtn").onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("#installBtn").classList.add("hidden")};

let alarmCtx=null, alarmTimer=null, alarmStopTimer=null, alarmNotifyTimer=null, alarmNodes=[], pendingAlarmDoses=[];
const REALERT_MS=60*1000;
const VIBRATE_PATTERN=[400,120,400,120,400,180,800,180,400];
function unlockAlarmAudio(){
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx) return;
    alarmCtx=alarmCtx||new Ctx();
    if(alarmCtx.state==="suspended") alarmCtx.resume();
  }catch(_){ }
}
function vibratePulse(pattern=VIBRATE_PATTERN){
  try{if(navigator.vibrate) navigator.vibrate(pattern)}catch(_){ }
}
function prepareBeepFile(){
  const el=$("#doseBeep");
  if(!el||el.src) return;
  try{
    const Off=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!Off) return;
    const ctx=new Off(1,22050,22050);
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.frequency.value=880;osc.type="square";
    gain.gain.value=0.35;osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(0.18);
    ctx.startRendering().then(buf=>{
      el.src=URL.createObjectURL(new Blob([encodeWav(buf)],{type:"audio/wav"}));
    }).catch(()=>{});
  }catch(_){ }
}
function encodeWav(buffer){
  const data=buffer.getChannelData(0);
  const out=new ArrayBuffer(44+data.length*2);
  const view=new DataView(out);
  const w=(o,s)=>{for(let i=0;i<s.length;i++) view.setUint8(o+i,s.charCodeAt(i))};
  w(0,"RIFF");view.setUint32(4,36+data.length*2,true);w(8,"WAVE");w(12,"fmt ");
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);w(36,"data");view.setUint32(40,data.length*2,true);
  let o=44;
  for(let i=0;i<data.length;i++,o+=2){
    const s=Math.max(-1,Math.min(1,data[i]));
    view.setInt16(o,s<0?s*0x8000:s*0x7fff,true);
  }
  return out;
}
function playBeepFile(){
  const el=$("#doseBeep");
  if(!el||!el.src) return;
  el.loop=true;
  el.currentTime=0;
  el.play().catch(()=>{});
}
function markAlarmNotified(doses){
  const now=Date.now();
  state.settings.notified??={};
  doses.forEach(m=>{
    const key=m.key||doseKey(m,m._time||m.time);
    state.settings.notified[key]=now;
  });
  save();
}
function stopDoseAlarm(){
  alarmNodes.forEach(n=>{try{n.stop()}catch(_){ } try{n.disconnect()}catch(_){ }});
  alarmNodes=[];
  if(alarmTimer){clearInterval(alarmTimer);alarmTimer=null}
  if(alarmStopTimer){clearTimeout(alarmStopTimer);alarmStopTimer=null}
  if(alarmNotifyTimer){clearInterval(alarmNotifyTimer);alarmNotifyTimer=null}
  try{navigator.vibrate&&navigator.vibrate(0)}catch(_){ }
  const beep=$("#doseBeep");
  if(beep){beep.loop=false;beep.pause();try{beep.currentTime=0}catch(_){ }}
  $("#doseAlarm")?.classList.add("hidden");
}
function alarmCopy(meds){
  const list=meds||[];
  if(!list.length) return {title:"Hora da dose",body:"Tem um horário agora. Registre quando tomar."};
  if(list.length===1){
    const m=list[0];
    const time=m._time||m.time;
    return {
      title:`Hora ${kindPhrase(m.type)}`,
      body:`${m.name}${m.dose?" · "+m.dose:""}${time?" · "+time:""}`
    };
  }
  return {
    title:`Hora de ${list.length} doses`,
    body:list.map(m=>`${m.name}${m.dose?" · "+m.dose:""} · ${m._time||m.time}`).join(" · ")
  };
}
function beepBurst(){
  if(!alarmCtx) return;
  const t=alarmCtx.currentTime;
  const osc=alarmCtx.createOscillator();
  const osc2=alarmCtx.createOscillator();
  const gain=alarmCtx.createGain();
  osc.type="sine";
  osc2.type="sine";
  osc.frequency.setValueAtTime(784,t);
  osc.frequency.setValueAtTime(988,t+0.16);
  osc2.frequency.setValueAtTime(392,t);
  gain.gain.setValueAtTime(0.0001,t);
  gain.gain.exponentialRampToValueAtTime(0.28,t+0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001,t+0.42);
  osc.connect(gain);osc2.connect(gain);gain.connect(alarmCtx.destination);
  osc.start(t);osc2.start(t);
  osc.stop(t+0.45);osc2.stop(t+0.45);
  alarmNodes.push(osc,osc2,gain);
}
function startDoseAlarm(meds){
  const next=meds.map(m=>({id:m.id,time:m._time||m.time,key:m.key||doseKey(m,m._time||m.time)}));
  const same=next.map(d=>d.key).sort().join()===pendingAlarmDoses.map(d=>d.key).sort().join();
  if(same&&!$("#doseAlarm")?.classList.contains("hidden")) return;
  pendingAlarmDoses=next;
  unlockAlarmAudio();
  const copy=alarmCopy(meds);
  const title=$("#doseAlarmTitle");
  const text=$("#doseAlarmText");
  if(title) title.textContent=copy.title;
  if(text) text.textContent=copy.body+" — registre para eu continuar com você.";
  $("#doseAlarm")?.classList.remove("hidden");
  prepareBeepFile();
  beepBurst();
  vibratePulse([180,80,180]);
  let pulses=1;
  if(alarmTimer) clearInterval(alarmTimer);
  alarmTimer=setInterval(()=>{
    pulses+=1;
    beepBurst();
    vibratePulse([160,70,160]);
    if(pulses>=3){clearInterval(alarmTimer);alarmTimer=null}
  },900);
}
function applyAlarmRecords(status,doses=pendingAlarmDoses){
  const list=doses||[];
  list.forEach(d=>{
    const m=state.meds.find(x=>String(x.id)===String(d.id));
    if(m&&!getStatus(m,d.time)) record(m,d.time,status);
  });
}
$("#silenceAlarm")?.addEventListener("click",()=>{
  unlockAlarmAudio();
  markAlarmNotified(pendingAlarmDoses);
  stopDoseAlarm();
  toast("Tudo bem. Te chamo de novo em 1 minuto se ainda não registrar.");
});
$("#alarmTake")?.addEventListener("click",()=>{unlockAlarmAudio();applyAlarmRecords("taken")});
$("#alarmSkip")?.addEventListener("click",()=>{unlockAlarmAudio();applyAlarmRecords("skipped")});
["pointerdown","touchstart"].forEach(ev=>document.addEventListener(ev,()=>{unlockAlarmAudio();prepareBeepFile()},{passive:true}));

function pruneNotified(){
  const today=todayKey();
  state.settings.notified??={};
  let dirty=false;
  Object.keys(state.settings.notified).forEach(k=>{
    if(!String(k).startsWith(today+"|")){delete state.settings.notified[k];dirty=true}
  });
  if(dirty) save();
}
function dueDosesNow(){
  const date=todayKey(), clock=nowTime();
  const [ch,cm]=clock.split(":").map(Number);
  const nowM=ch*60+cm;
  const list=[];
  state.meds.filter(m=>isMedScheduledOn(m,date)).forEach(m=>(m.times||[]).forEach(time=>{
    const [h,mi]=String(time).split(":").map(Number);
    if(!Number.isFinite(h)||nowM<h*60+mi||getStatus(m,time)) return;
    list.push({...m,_time:time,key:doseKey(m,time,date)});
  }));
  return list;
}
async function pushDoseNotification(alarmMeds){
  if(state.settings.reminderMode==="visual") return;
  if(!("Notification"in window)||Notification.permission!=="granted") return;
  const copy=alarmCopy(alarmMeds);
  const title=copy.title;
  const body=copy.body;
  const options={
    body,
    icon:"./icons/icon-192.png",
    badge:"./icons/icon-192.png",
    tag:"medtrack-dose",
    data:{doses:alarmMeds.map(m=>({id:m.id,time:m._time}))},
    vibrate:VIBRATE_PATTERN,
    requireInteraction:true,
    renotify:true,
    silent:false,
    sound:"default"
  };
  if(!isIOS()) options.actions=[{action:"take",title:"Tomei"},{action:"skip",title:"Pular"}];
  try{
    const reg=await navigator.serviceWorker.ready;
    await reg.showNotification(title,options);
  }catch(_){
    try{new Notification(title,{body,icon:"./icons/icon-192.png"})}catch(__){ }
  }
}
async function scheduleUpcomingNotifications(){
  if(state.settings.pushEndpoint) return;
  if(!("Notification"in window)||Notification.permission!=="granted") return;
  if(!("serviceWorker"in navigator)) return;
  const now=Date.now();
  const pack=upcomingDosePayload();
  try{
    const reg=await navigator.serviceWorker.ready;
    const existing=await (reg.getNotifications({includeTriggered:true}).catch(()=>reg.getNotifications()));
    (existing||[]).forEach(n=>{
      if(String(n.tag||"").startsWith("medtrack-sched-")) try{n.close()}catch(_){ }
    });
    if(typeof TimestampTrigger==="undefined") return;
    pack.doses.filter(d=>d.at>now).forEach(d=>{
      const body=`Hora ${kindPhrase(d.type)}: ${d.name}${d.dose?" · "+d.dose:""}`;
      reg.showNotification("MedTrack — hora da dose",{
        body,
        icon:"./icons/icon-192.png",
        badge:"./icons/icon-192.png",
        vibrate:VIBRATE_PATTERN,
        requireInteraction:true,
        renotify:true,
        silent:false,
        sound:"default",
        tag:`medtrack-sched-${d.key}`,
        showTrigger:new TimestampTrigger(d.at),
        data:{doses:[{id:d.id,time:d.time}]}
      }).catch(()=>{});
    });
  }catch(_){ }
}
async function waitForServiceWorker(){
  if(!("serviceWorker"in navigator)) return null;
  const reg=await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"}).catch(()=>null);
  if(!reg) return null;
  try{await reg.update()}catch(_){ }
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller){
    await new Promise(resolve=>{
      const t=setTimeout(resolve,2500);
      navigator.serviceWorker.addEventListener("controllerchange",()=>{clearTimeout(t);resolve()},{once:true});
    });
  }
  return navigator.serviceWorker.ready;
}
async function enableBackgroundPush(forceNew=false){
  if(!("serviceWorker"in navigator)||!("PushManager"in window)) return false;
  if(Notification.permission!=="granted") return false;
  try{
    const reg=await waitForServiceWorker();
    if(!reg) return false;
    const vapid=await fetch("./sync.php?vapid=1",{cache:"no-store"}).then(r=>r.json()).catch(()=>({}));
    if(!vapid.publicKey) return false;
    if(state.settings.pushOrigin&&state.settings.pushOrigin!==location.origin) forceNew=true;
    let sub=await reg.pushManager.getSubscription();
    if(forceNew&&sub){
      try{await sub.unsubscribe()}catch(_){ }
      sub=null;
    }
    if(!sub){
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(vapid.publicKey)
      });
    }
    if(reg.periodicSync&&reg.periodicSync.register){
      try{await reg.periodicSync.register("medtrack-dose-check",{minInterval:15*60*1000})}catch(_){ }
    }
    if(reg.sync&&reg.sync.register){
      try{await reg.sync.register("medtrack-dose-check")}catch(_){ }
    }
    state.settings.pushEndpoint=sub.endpoint;
    state.settings.pushOrigin=location.origin;
    localStorage.setItem(KEY,JSON.stringify(state));
    return sub;
  }catch(err){
    console.warn("MedTrack: push não inscrito.",err);
    return false;
  }
}
async function syncReminders(sendTest=false){
  const pack=upcomingDosePayload();
  const schedule={...pack,reminderMode:state.settings.reminderMode||"notification"};
  if("serviceWorker"in navigator){
    const reg=await navigator.serviceWorker.ready.catch(()=>null);
    reg?.active?.postMessage({type:"MEDTRACK_STORE_SCHEDULE",schedule});
  }
  await scheduleUpcomingNotifications();
  try{
    const sub=await enableBackgroundPush();
    const stamp=Date.now();
    state.settings.cloudUpdatedAt=stamp;
    localStorage.setItem(KEY,JSON.stringify(state));
    await fetch("sync.php",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        subscription:sub?sub.toJSON():undefined,
        doses:pack.doses,
        taken:pack.taken,
        reminderMode:state.settings.reminderMode||"notification",
        meds:state.meds,
        history:state.history,
        settings:state.settings,
        updatedAtMs:stamp,
        test:!!sendTest,
        replaceSubscriptions:true
      })
    });
  }catch(_){ }
}
async function hydrateFromServer(){
  try{
    const remote=await fetch("sync.php",{cache:"no-store"}).then(r=>r.json());
    if(!remote) return;
    const remoteMeds=Array.isArray(remote.meds)?remote.meds:[];
    const remoteStamp=Number(remote.updatedAtMs)||0;
    const localStamp=Number(state.settings.cloudUpdatedAt)||0;
    if(!remoteMeds.length) return;
    if(state.meds.length&&remoteStamp<=localStamp) return;
    hydrating=true;
    state.meds=remoteMeds;
    if(Array.isArray(remote.history)) state.history=remote.history;
    if(remote.settings&&typeof remote.settings==="object"){
      const keepEndpoint=state.settings.pushEndpoint;
      const keepOrigin=state.settings.pushOrigin;
      state.settings={...state.settings,...remote.settings};
      state.settings.notified=state.settings.notified||{};
      if(keepEndpoint) state.settings.pushEndpoint=keepEndpoint;
      if(keepOrigin) state.settings.pushOrigin=keepOrigin;
    }
    state.settings.cloudUpdatedAt=remoteStamp||Date.now();
    save();
    renderMeds();
    renderToday();
    renderHistory();
    hydrating=false;
  }catch(_){
    hydrating=false;
  }
}
async function reminderCheck(){
  pruneNotified();
  const due=dueDosesNow();
  if(!due.length) return;
  const now=Date.now();
  state.settings.notified??={};
  const fresh=due.filter(m=>{
    const last=state.settings.notified[m.key];
    if(last===true) return true;
    if(!last) return true;
    const ts=Number(last)||0;
    return now-ts>=REALERT_MS;
  });
  if(!document.hidden) startDoseAlarm(due);
  if(!fresh.length) return;
  markAlarmNotified(fresh);
  if(document.hidden&&!state.settings.pushEndpoint) await pushDoseNotification(fresh);
  addActivity("alerta_dose",{count:fresh.length,names:fresh.map(m=>m.name)});
}
if("serviceWorker"in navigator){
  navigator.serviceWorker.addEventListener("message",e=>{
    const data=e.data||{};
    if(data.type!=="MEDTRACK_ALARM_ACTION") return;
    const status=data.action==="skip"?"skipped":"taken";
    applyAlarmRecords(status,data.doses);
    show("today");
  });
}
setInterval(reminderCheck,5000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden) reminderCheck()});
window.addEventListener("pageshow",()=>reminderCheck());
window.addEventListener("focus",()=>reminderCheck());
reminderCheck();
if("serviceWorker"in navigator){
  navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"}).then(reg=>{
    reg.update().catch(()=>{});
  }).catch(()=>{});
}
$("#reminderMode").value=state.settings.reminderMode||"notification";
$("#notifyBtn").textContent=("Notification"in window&&Notification.permission==="granted")?"Ativadas":"Ativar";
addTime();
{
  let patched=false;
  state.meds.forEach(m=>{
    const start=medStartKey(m);
    if(m.startDate!==start){m.startDate=start;patched=true}
  });
  if(patched) save();
}
renderMeds();renderToday();
updateAlertSetup();
hydrateFromServer().then(()=>{
  updateAlertSetup();
  if(Notification.permission==="granted") syncReminders();
});

function resolvedTheme(pref){
  if(pref==="light"||pref==="dark") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";
}
function applyTheme(pref=state.settings.theme||"system"){
  const mode=resolvedTheme(pref);
  document.documentElement.dataset.theme=mode;
  document.documentElement.dataset.themePref=pref;
  const meta=$('meta[name="theme-color"]');
  if(meta) meta.content=mode==="light"?"#eef2f6":"#0b0f14";
  const sel=$("#themeMode");
  if(sel) sel.value=pref;
}
applyTheme();
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change",()=>{
  if((state.settings.theme||"system")==="system") applyTheme("system");
});
$("#themeToggle")?.addEventListener("click",()=>{
  const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
  state.settings.theme=next;save();applyTheme(next);
});
$("#themeMode")?.addEventListener("change",()=>{
  state.settings.theme=$("#themeMode").value;save();applyTheme(state.settings.theme);
});


/* =========================
   MedTrack v6 — PWA reliability layer
   ========================= */
(() => {
  const installBtn = document.getElementById('installApp');
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (_) {}
      deferredPrompt = null;
      installBtn.hidden = true;
    });
  }

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installBtn) installBtn.hidden = true;
  });

  // iOS does not expose beforeinstallprompt. The app remains installable
  // through Safari's Share > Add to Home Screen when served over HTTPS.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (installBtn && isIOS && !standalone) {
    installBtn.hidden = false;
    installBtn.textContent = 'Adicionar à Tela Inicial';
    installBtn.onclick = () => {
      alert('No iPhone/iPad: toque em Compartilhar no Safari e escolha “Adicionar à Tela de Início”.');
    };
  }

  // Service worker: register only in secure contexts (HTTPS or localhost).
  // Force update check so an old cached shell is less likely to persist.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        await reg.update();
      } catch (err) {
        console.warn('MedTrack: Service Worker não pôde ser registrado.', err);
      }
    });
  }
})();

/* ==========================================================
   MedTrack v10 — settings save + activity audit
   Additive only: existing medication/history/PWA behavior stays intact.
   ========================================================== */
(() => {
  window.MedTrackActivity = Object.freeze({
    list() {
      try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]"); }
      catch (_) { return []; }
    }
  });
})();

function persistSettings(){
  state.settings=state.settings||{};
  const reminderMode=$("#reminderMode");
  if(reminderMode) state.settings.reminderMode=reminderMode.value;
  const themeMode=$("#themeMode");
  if(themeMode){
    state.settings.theme=themeMode.value;
    applyTheme(state.settings.theme);
  }
  save();
  addActivity("configuracoes_salvas",{
    source:"botao_salvar",
    reminderMode:state.settings.reminderMode,
    notifications:("Notification"in window?Notification.permission:"unsupported")
  });
}
function onSaveBackup(){
  try{
    persistSettings();
    exportBackupFile();
    addActivity("backup_exportado",{success:true,source:"botao_salvar"});
    const saveSettings=$("#saveSettings");
    if(!saveSettings) return;
    const old=saveSettings.textContent;
    saveSettings.textContent="Salvo";
    saveSettings.classList.add("saved");
    toast("Backup salvo em JSON");
    setTimeout(()=>{
      saveSettings.textContent=old;
      saveSettings.classList.remove("saved");
    },1200);
  }catch(err){
    console.warn("MedTrack: não foi possível salvar o backup.",err);
    toast("Não foi possível salvar o JSON");
  }
}
$("#saveSettings").onclick=onSaveBackup;
