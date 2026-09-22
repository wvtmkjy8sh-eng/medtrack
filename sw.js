const CACHE="medtrack-v40";
const ASSETS=["./","./index.html","./style.css","./app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png"];
const VIBRATE=[400,120,400,120,400,180,800,180,400];
const IS_IOS=/iphone|ipad|ipod/i.test(self.navigator.userAgent);

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener("activate",e=>e.waitUntil(
  caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())
));

function bypassCache(req){
  const url=new URL(req.url);
  return req.method!=="GET" || url.pathname.endsWith("sync.php") || url.search.includes("vapid") || url.search.includes("source=pwa");
}
self.addEventListener("fetch",e=>{
  if(bypassCache(e.request)){
    e.respondWith(fetch(e.request).catch(()=>caches.match("./index.html")));
    return;
  }
  e.respondWith(
    fetch(e.request).then(res=>{
      const c=res.clone();
      caches.open(CACHE).then(x=>x.put(e.request,c));
      return res;
    }).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html")))
  );
});

function idbOpen(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open("medtrack-reminders",1);
    req.onupgradeneeded=()=>req.result.createObjectStore("kv");
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function idbGet(key){
  const db=await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("kv","readonly");
    const q=tx.objectStore("kv").get(key);
    q.onsuccess=()=>resolve(q.result);
    q.onerror=()=>reject(q.error);
  });
}
async function idbSet(key,value){
  const db=await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("kv","readwrite");
    tx.objectStore("kv").put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

function notifyOptions(payload){
  const data=payload||{};
  return {
    body:data.body||"Hora de se medicar ou suplementar.",
    icon:"./icons/icon-192.png",
    badge:"./icons/icon-192.png",
    tag:data.tag||"medtrack-dose",
    data:{doses:data.doses||[],url:"./"},
    vibrate:data.vibrate||VIBRATE,
    requireInteraction:true,
    renotify:true,
    silent:false,
    sound:data.sound||"default",
    timestamp:Date.now(),
    lang:"pt-BR",
    actions:IS_IOS?[]:[{action:"take",title:"Tomei"},{action:"skip",title:"Pular"}]
  };
}
function showDoseNotice(payload){
  return self.registration.showNotification(payload.title||"Hora da dose",notifyOptions(payload));
}

self.addEventListener("push",event=>{
  let payload={title:"Hora da dose",body:"Tem um horário agora. Abra o MedTrack para registrar."};
  try{
    if(event.data) payload=Object.assign(payload,event.data.json());
  }catch(_){
    try{if(event.data) payload.body=event.data.text()||payload.body}catch(__){}
  }
  event.waitUntil(showDoseNotice(payload));
});

self.addEventListener("periodicsync",event=>{
  if(event.tag==="medtrack-dose-check") event.waitUntil(checkStoredDoses());
});
self.addEventListener("sync",event=>{
  if(event.tag==="medtrack-dose-check") event.waitUntil(checkStoredDoses());
});
self.addEventListener("message",event=>{
  const data=event.data||{};
  if(data.type==="MEDTRACK_STORE_SCHEDULE"){
    event.waitUntil(idbSet("schedule",data.schedule||{}));
  }
  if(data.type==="MEDTRACK_CHECK_DOSES"){
    event.waitUntil(checkStoredDoses());
  }
});

async function checkStoredDoses(){
  const schedule=await idbGet("schedule");
  if(!schedule||schedule.reminderMode==="visual") return;
  const taken=new Set(schedule.taken||[]);
  const now=Date.now();
  const due=(schedule.doses||[]).filter(d=>d&&!taken.has(d.key)&&(Number(d.at)||0)<=now);
  if(!due.length) return;
  const last=schedule.lastAlert||{};
  const wave=Number(last._wave)||0;
  if(wave&&now-wave<60*1000) return;
  const visible=await self.clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>list.some(c=>c.visibilityState==="visible")).catch(()=>false);
  if(visible) return;
  due.forEach(d=>{last[d.key]=now});
  last._wave=now;
  schedule.lastAlert=last;
  await idbSet("schedule",schedule);
  const body=due.map(d=>`${d.name}${d.dose?" · "+d.dose:""} · ${d.time}`).join("\n");
  await showDoseNotice({
    title:due.length>1?"MedTrack — horários agora":"MedTrack — hora da dose",
    body,
    tag:"medtrack-dose",
    doses:due.map(d=>({id:d.id,time:d.time}))
  });
}

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const action=event.action;
  const data=event.notification.data||{};
  event.waitUntil((async()=>{
    const clientsList=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const payload={type:"MEDTRACK_ALARM_ACTION",action,doses:data.doses||[]};
    for(const client of clientsList){
      if(action==="take"||action==="skip") client.postMessage(payload);
      if("focus"in client) return client.focus();
    }
    if(self.clients.openWindow) return self.clients.openWindow("./?source=pwa");
  })());
});
