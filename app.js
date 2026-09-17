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
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const todayKey=()=>new Date().toISOString().slice(0,10);
const fmtDate=d=>new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long"}).format(d);
const iconFor=t=>t==="suplemento"||t==="vitamina"?"sup":"med";
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
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
  $("#fabAdd")?.classList.toggle("hidden",screen==="register");
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
  renderToday(); toast(status==="taken"?"Dose registrada como tomada":"Dose marcada como pulada");
}
function getStatus(m,time){return state.history.find(x=>x.key===doseKey(m,time))?.status}
function renderToday(){
  const now=new Date(), key=todayKey();
  $("#todayDate").textContent=fmtDate(now);
  const doses=[];
  state.meds.filter(m=>m.active!==false).forEach(m=>(m.times||[]).forEach(time=>doses.push({m,time,status:getStatus(m,time)})));
  doses.sort((a,b)=>a.time.localeCompare(b.time));
  const taken=doses.filter(x=>x.status==="taken").length, skipped=doses.filter(x=>x.status==="skipped").length;
  $("#scheduledCount").textContent=doses.length;$("#takenCount").textContent=taken;$("#skippedCount").textContent=skipped;
  const pct=doses.length?Math.round(taken/doses.length*100):0;$("#progressText").textContent=pct+"%";$("#progressRing").style.background=`conic-gradient(var(--accent) ${pct*3.6}deg,var(--track) ${pct*3.6}deg)`;
  $("#todayStatus").textContent=doses.length?(pct===100?"Rotina concluída":"Acompanhe suas doses"):"";
  $("#emptyToday").classList.toggle("hidden",doses.length>0);
  $("#todayList").innerHTML=doses.map(({m,time,status})=>{
    const overdue=!status && time<now.toTimeString().slice(0,5);
    return `<article class="dose-card ${status?"done":""} ${overdue?"overdue":""}">
      <div class="dose-icon ${iconFor(m.type)}"><svg viewBox="0 0 24 24"><path d="M7 4h10v16H7zM9 8h6M9 12h6M9 16h4"/></svg></div>
      <div class="dose-main"><strong>${esc(m.name)}</strong><small>${esc(m.dose||"Dose não informada")} ${m.notes?"· "+esc(m.notes):""}</small></div>
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
  if(id){const m=state.meds.find(x=>x.id===id);if(!m)return;Object.assign(m,{name,type,dose,notes,active,times,durationDays});addActivity("medicamento_editado",{medId:m.id,medName:m.name,durationDays})}
  else {const m={id:uid(),name,type,dose,notes,active,times,durationDays,createdAt:new Date().toISOString()};state.meds.push(m);addActivity("medicamento_cadastrado",{medId:m.id,medName:m.name,durationDays})}
  save();resetForm();renderMeds();show("today");toast(id?"Medicamento atualizado":"Medicamento cadastrado");
};
$("#cancelEdit").onclick=resetForm;

function renderMeds(){
  $("#medCount").textContent=state.meds.length;
  $("#medList").innerHTML=state.meds.length?state.meds.map(m=>`<article class="med-card">
    <div class="med-info"><strong>${esc(m.name)} ${m.active===false?"· inativo":""}</strong><div class="med-meta">${esc(m.type)}${m.dose?" · "+esc(m.dose):""}</div><div class="med-times">${(m.times||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join("")}</div></div>
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

$("#notifyBtn").onclick=async()=>{
  if(!("Notification"in window))return toast("Seu navegador não oferece notificações");
  const p=await Notification.requestPermission();$("#notifyBtn").textContent=p==="granted"?"Ativadas":"Ativar";addActivity("notificacoes_permissao",{permission:p});toast(p==="granted"?"Notificações ativadas":"Permissão não concedida");
};
$("#reminderMode").onchange=()=>{state.settings.reminderMode=$("#reminderMode").value;save();addActivity("modo_lembrete_alterado",{mode:state.settings.reminderMode})};
$("#clearHistory").onclick=()=>{if(confirm("Apagar todo o histórico de doses?")){const count=state.history.length;state.history=[];addActivity("historico_doses_limpo",{removed:count});save();renderHistory();renderToday();toast("Histórico apagado")}};

let deferredPrompt;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("#installBtn").classList.remove("hidden")});
$("#installBtn").onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("#installBtn").classList.add("hidden")};

async function reminderCheck(){
  if(state.settings.reminderMode!=="notification"||!("Notification"in window)||Notification.permission!=="granted")return;
  const now=new Date(),time=now.toTimeString().slice(0,5),key=todayKey()+"|"+time;
  state.settings.notified??={};
  if(state.settings.notified[key])return;
  const due=state.meds.filter(m=>m.active!==false&&(m.times||[]).includes(time)).filter(m=>!getStatus(m,time));
  if(due.length){new Notification("MedTrack — hora da dose",{body:due.map(m=>`${m.name}${m.dose?" · "+m.dose:""}`).join("\n")});state.settings.notified[key]=true;save()}
}
setInterval(reminderCheck,30000);reminderCheck();
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
$("#reminderMode").value=state.settings.reminderMode||"notification";
$("#notifyBtn").textContent=("Notification"in window&&Notification.permission==="granted")?"Ativadas":"Ativar";
addTime();renderMeds();renderToday();

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
  const saveSettings = document.getElementById("saveSettings");
  if (!saveSettings) return;

  function downloadEventLog() {
    try {
      const events = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]");
      const exportedAt = new Date();
      const pad = n => String(n).padStart(2, "0");
      const stamp = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth()+1)}-${pad(exportedAt.getDate())}_${pad(exportedAt.getHours())}-${pad(exportedAt.getMinutes())}-${pad(exportedAt.getSeconds())}`;
      const payload = {
        app: "MedTrack",
        version: "11.0",
        exportedAt: exportedAt.toISOString(),
        eventCount: events.length,
        events
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `MedTrack-event-log-${stamp}.json`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (err) {
      console.warn("MedTrack: não foi possível baixar o Event Log.", err);
      return false;
    }
  }

  saveSettings.addEventListener("click", () => {
    try {
      state.settings = state.settings || {};
      state.settings.reminderMode = document.getElementById("reminderMode").value;
      const themeMode = document.getElementById("themeMode");
      if (themeMode) {
        state.settings.theme = themeMode.value;
        applyTheme(state.settings.theme);
      }
      save();
      addActivity("configuracoes_salvas", {
        source: "botao_salvar",
        reminderMode: state.settings.reminderMode,
        notifications: ("Notification" in window ? Notification.permission : "unsupported")
      });

      // Export the complete local activity log immediately after saving.
      // The browser places the file in its normal download location on desktop,
      // mobile or tablet; no existing app data or functionality is changed.
      const downloaded = downloadEventLog();
      addActivity("event_log_baixado", {success: downloaded, source: "botao_salvar"});

      const old = saveSettings.textContent;
      saveSettings.textContent = "Salvo";
      saveSettings.classList.add("saved");
      setTimeout(() => {
        saveSettings.textContent = old;
        saveSettings.classList.remove("saved");
      }, 1200);
    } catch (err) {
      console.warn("MedTrack: não foi possível salvar configurações.", err);
    }
  });

  window.MedTrackActivity = Object.freeze({
    list() {
      try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]"); }
      catch (_) { return []; }
    }
  });
})();
