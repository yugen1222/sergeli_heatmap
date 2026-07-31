import { db, authReady, messagingReady } from "./firebase.js";
import { ref,onValue,set,update,push,remove,get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const ROOT="sergeli_heatmap";
const VAPID_KEY="PASTE_YOUR_PUBLIC_VAPID_KEY_HERE";

const floorsRef=ref(db,`${ROOT}/floors`);
const settingsRef=ref(db,`${ROOT}/settings`);
const historyRef=ref(db,`${ROOT}/history`);
const requestsRef=ref(db,`${ROOT}/staffRequests`);
const analyticsRef=ref(db,`${ROOT}/analyticsEvents`);

let floors={1:{staff:4,guests:20,norm:5},2:{staff:4,guests:20,norm:5},3:{staff:4,guests:20,norm:5}};
let settings={yellowLimit:1,redLimit:2,pushEnabled:"Включено",soundEnabled:"Включено",voiceCooldown:300000};
let history=[],analyticsEvents=[],requests={};
let currentPage="main",lastAlertSignature="",previousStatuses={};
let voiceUnlocked=false,voiceQueue=[],isVoicePlaying=false,lastVoiceTime={};
const voices={1:new Audio("./floor1.mp3"),2:new Audio("./floor2.mp3"),3:new Audio("./floor3.mp3")};
Object.values(voices).forEach(a=>a.preload="auto");

await authReady;

if("serviceWorker" in navigator) navigator.serviceWorker.register("./firebase-messaging-sw.js").catch(console.error);

const now=()=>Date.now();
const dateKey=(ts=Date.now())=>new Date(ts).toISOString().slice(0,10);
const timeText=(ts=Date.now())=>new Date(ts).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
const floorLoad=d=>Number(d.staff)>0?Number(d.guests)/Number(d.staff):0;
function statusOf(d){
  const load=floorLoad(d),norm=Number(d.norm||1);
  if(load<=norm)return"green";
  if(load<=norm+Number(settings.yellowLimit||0))return"yellow";
  return"red";
}
const missingOf=d=>Math.max(0,Math.ceil(Number(d.guests||0)/Math.max(1,Number(d.norm||1)))-Number(d.staff||0));
const statusText=s=>s==="red"?"Критичная":s==="yellow"?"Высокая":"Нормальная";

async function logEvent(event){
  const payload={...event,createdAt:now(),date:dateKey(),time:timeText()};
  await Promise.all([push(historyRef,payload),push(analyticsRef,payload)]);
}

onValue(floorsRef,async snap=>{
  if(snap.exists()) floors=snap.val(); else await set(floorsRef,floors);
  await trackStatusTransitions();
  renderAll();
});
onValue(settingsRef,snap=>{if(snap.exists())settings={...settings,...snap.val()};renderAll();loadSettings();});
onValue(historyRef,snap=>{history=snap.exists()?Object.values(snap.val()).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)):[];renderJournal();});
onValue(analyticsRef,snap=>{analyticsEvents=snap.exists()?Object.values(snap.val()):[];renderAnalytics();});
onValue(requestsRef,snap=>{requests=snap.exists()?snap.val():{};renderRequests();renderFloors();renderAnalytics();});

async function trackStatusTransitions(){
  for(let i=1;i<=3;i++){
    const current=statusOf(floors[i]),previous=previousStatuses[i];
    if(previous && previous!==current){
      if(current==="red") await logEvent({type:"alert",floor:i,label:"Критическая нагрузка",fromStatus:previous,toStatus:current});
      if(previous==="red" && current!=="red") await logEvent({type:"alert_resolved",floor:i,label:"Красная зона завершена",fromStatus:previous,toStatus:current});
    }
    previousStatuses[i]=current;
  }
}

document.getElementById("adminBtn").onclick=toggleAdmin;
document.getElementById("tvBtn").onclick=()=>document.body.classList.toggle("tv-mode");
document.getElementById("voiceBtn").onclick=unlockVoice;
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>openTab(b.dataset.tab,b));
document.querySelectorAll(".testVoice").forEach(b=>b.onclick=()=>testVoice(Number(b.dataset.floor)));
document.getElementById("saveNormsBtn").onclick=saveNorms;
document.getElementById("saveThresholdsBtn").onclick=saveThresholds;
document.getElementById("saveNotificationsBtn").onclick=saveNotifications;
document.getElementById("pushPermissionBtn").onclick=enablePush;
document.getElementById("clearHistoryBtn").onclick=clearHistory;
document.getElementById("historyFloorFilter").onchange=renderJournal;
document.getElementById("historyTypeFilter").onchange=renderJournal;

function toggleAdmin(){
  currentPage=currentPage==="main"?"admin":"main";
  document.getElementById("mainPage").classList.toggle("hidden",currentPage!=="main");
  document.getElementById("adminPage").classList.toggle("hidden",currentPage!=="admin");
  document.getElementById("adminBtn").textContent=currentPage==="main"?"⚙️ Админ":"⬅️ Назад";
  document.getElementById("pageTitle").textContent=currentPage==="main"?"🔥 Тепловая карта Сергели":"⚙️ Админ-панель";
  if(currentPage==="admin"){loadSettings();renderAnalytics();renderJournal();}
}
function openTab(id,button){
  document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.getElementById(id).classList.add("active");button.classList.add("active");
}

window.stepValue=async(floor,type,delta)=>{
  const oldValue=Number(floors[floor][type]||0),newValue=oldValue+delta;
  if(newValue<0||(type==="staff"&&newValue<1))return;
  await update(ref(db,`${ROOT}/floors/${floor}`),{[type]:newValue});
  await logEvent({type,floor,label:type==="staff"?"Сотрудники":"Гости",oldValue,newValue,delta});
};
window.manualValue=async(floor,type)=>{
  const oldValue=Number(floors[floor][type]||0);
  let value=prompt(`Введите количество ${type==="staff"?"сотрудников":"гостей"}:`,oldValue);
  if(value===null)return;value=Number(value);
  if(!Number.isFinite(value)||value<0||(type==="staff"&&value<1)){alert("Неверное значение");return;}
  await update(ref(db,`${ROOT}/floors/${floor}`),{[type]:value});
  await logEvent({type,floor,label:type==="staff"?"Сотрудники":"Гости",oldValue,newValue:value,delta:value-oldValue});
};
function counter(floor,type,label,value){return`<div class="counter-box"><div class="counter-label">${label}</div><div class="stepper"><button class="step-btn" onclick="stepValue(${floor},'${type}',-1)">−</button><div class="value" onclick="manualValue(${floor},'${type}')">${value}</div><button class="step-btn" onclick="stepValue(${floor},'${type}',1)">+</button></div></div>`}

function renderFloors(){
  const grid=document.getElementById("floorsGrid");grid.innerHTML="";
  const reds=[];
  for(let i=1;i<=3;i++){
    const d=floors[i],s=statusOf(d),missing=missingOf(d);
    if(s==="red")reds.push({floor:i,missing,guests:d.guests,staff:d.staff});
    const active=Object.values(requests).some(r=>Number(r.toFloor)===i&&["open","accepted"].includes(r.status));
    grid.insertAdjacentHTML("beforeend",`<article class="floor ${s}"><div class="counter">${counter(i,"staff","Сотрудники",d.staff)}${counter(i,"guests","Гости",d.guests)}</div><div class="floor-info"><h2>${i} этаж</h2><p>Нагрузка: ${statusText(s)}</p><p>${s==="green"?"Сотрудников хватает":missing===1?"Нужен 1 сотрудник":`Нужно ${missing} сотрудника`}</p>${s==="red"?`<button class="request-btn" onclick="createRequest(${i})" ${active?"disabled":""}>${active?"Запрос отправлен":"Запросить сотрудника"}</button>`:""}</div></article>`);
  }
  renderBanner(reds);
}
function renderBanner(reds){
  const b=document.getElementById("criticalBanner"),c=document.getElementById("alertCount");
  if(!reds.length){b.classList.add("hidden");c.classList.add("hidden");lastAlertSignature="";return;}
  b.classList.remove("hidden");c.classList.remove("hidden");c.textContent=`${reds.length} тревог`;
  b.innerHTML=`🚨 ${reds.map(x=>`${x.floor} этаж: не хватает +${x.missing}`).join(" • ")}`;
  const signature=JSON.stringify(reds);
  if(signature!==lastAlertSignature){reds.forEach(x=>enqueueVoice(x.floor));lastAlertSignature=signature;}
}

window.createRequest=async toFloor=>{
  const needed=Math.max(1,missingOf(floors[toFloor]));
  await push(requestsRef,{toFloor,needed,status:"open",createdAt:now(),time:timeText()});
  await logEvent({type:"request",floor:toFloor,label:"Запрос сотрудника",needed});
};
window.answerRequest=async(id,fromFloor,canGive)=>{
  if(!canGive){await update(ref(db,`${ROOT}/staffRequests/${id}`),{[`declined/${fromFloor}`]:true});return;}
  const snap=await get(ref(db,`${ROOT}/staffRequests/${id}`));if(!snap.exists())return;
  const r=snap.val();if(r.status!=="open"){alert("Запрос уже принят");return;}
  if(Number(floors[fromFloor].staff)<=1){alert("Нельзя оставить этаж без сотрудников");return;}
  await update(ref(db,`${ROOT}/staffRequests/${id}`),{status:"accepted",fromFloor,acceptedAt:now()});
};
window.confirmTransfer=async id=>{
  const snap=await get(ref(db,`${ROOT}/staffRequests/${id}`));if(!snap.exists())return;
  const r=snap.val(),from=Number(r.fromFloor),to=Number(r.toFloor);
  if(r.status!=="accepted"||Number(floors[from].staff)<=1)return;
  await update(ref(db,ROOT),{[`floors/${from}/staff`]:Number(floors[from].staff)-1,[`floors/${to}/staff`]:Number(floors[to].staff)+1,[`staffRequests/${id}/status`]:"completed",[`staffRequests/${id}/completedAt`]:now()});
  await logEvent({type:"transfer",floor:to,fromFloor:from,toFloor:to,label:"Перевод сотрудника",amount:1});
};
window.cancelRequest=async id=>update(ref(db,`${ROOT}/staffRequests/${id}`),{status:"cancelled"});

function renderRequests(){
  const area=document.getElementById("requestArea");
  const list=Object.entries(requests).filter(([,r])=>["open","accepted"].includes(r.status));
  if(!list.length){area.innerHTML="";return;}
  area.innerHTML=list.map(([id,r])=>{
    if(r.status==="accepted")return`<div class="request-card accepted"><div class="request-title">✅ ${r.fromFloor} этаж готов отправить сотрудника на ${r.toFloor} этаж</div><div class="request-actions"><button class="action-good" onclick="confirmTransfer('${id}')">Сотрудник прибыл</button><button class="action-bad" onclick="cancelRequest('${id}')">Отменить</button></div></div>`;
    return`<div class="request-card"><div class="request-title">🚨 ${r.toFloor} этаж просит ${r.needed} сотрудника</div><div class="request-actions">${[1,2,3].filter(f=>f!==Number(r.toFloor)).map(f=>`<button class="action-good" onclick="answerRequest('${id}',${f},true)">${f} этаж: могу дать</button><button class="action-bad" onclick="answerRequest('${id}',${f},false)">${f} этаж: не могу</button>`).join("")}</div></div>`;
  }).join("");
}

async function unlockVoice(){
  try{
    const response=await fetch("./floor1.mp3",{cache:"no-store"});if(!response.ok)throw new Error("floor1.mp3 не найден");
    voiceUnlocked=true;document.getElementById("voiceBtn").textContent="🔊 Голос включён";
    await testVoice(1);
  }catch(e){voiceUnlocked=false;alert("Звук не включён: "+e.message);}
}
async function testVoice(floor){
  try{
    const a=voices[floor];Object.values(voices).forEach(x=>{x.pause();x.currentTime=0;});
    isVoicePlaying=true;a.onended=()=>{isVoicePlaying=false;setTimeout(playNextVoice,800)};await a.play();
  }catch(e){isVoicePlaying=false;alert(`Не удалось проиграть floor${floor}.mp3`);}
}
function enqueueVoice(floor){
  if(!voiceUnlocked||settings.soundEnabled==="Выключено")return;
  const t=now(),cool=Number(settings.voiceCooldown||300000);
  if(lastVoiceTime[floor]&&t-lastVoiceTime[floor]<cool)return;
  if(!voiceQueue.includes(floor))voiceQueue.push(floor);playNextVoice();
}
function playNextVoice(){
  if(isVoicePlaying||!voiceQueue.length)return;
  const floor=voiceQueue.shift(),a=voices[floor];isVoicePlaying=true;lastVoiceTime[floor]=now();a.currentTime=0;
  a.onended=()=>{isVoicePlaying=false;setTimeout(playNextVoice,1000)};a.play().catch(()=>{isVoicePlaying=false;});
}
setInterval(()=>{for(let i=1;i<=3;i++)if(statusOf(floors[i])==="red")enqueueVoice(i)},30000);

async function enablePush(){
  if(!("Notification"in window)){alert("Браузер не поддерживает Push");return;}
  if(VAPID_KEY.startsWith("PASTE_")){alert("Сначала вставьте публичный VAPID key в app.js");return;}
  const permission=await Notification.requestPermission();if(permission!=="granted"){alert("Разрешение не получено");return;}
  const messaging=await messagingReady;if(!messaging){alert("FCM не поддерживается браузером");return;}
  const registration=await navigator.serviceWorker.ready;
  const token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:registration});
  if(!token){alert("FCM token не получен");return;}
  const safe=btoa(token).replaceAll("/","_").replaceAll("+","-").replaceAll("=","");
  await set(ref(db,`${ROOT}/pushTokens/${safe}`),{token,createdAt:now(),userAgent:navigator.userAgent});
  alert("Push-уведомления включены");
}

function loadSettings(){
  for(let i=1;i<=3;i++)document.getElementById(`norm${i}`).value=floors[i]?.norm??5;
  document.getElementById("yellowLimit").value=settings.yellowLimit;
  document.getElementById("redLimit").value=settings.redLimit;
  document.getElementById("pushEnabled").value=settings.pushEnabled;
  document.getElementById("soundEnabled").value=settings.soundEnabled;
  document.getElementById("voiceCooldown").value=String(settings.voiceCooldown||300000);
}
async function saveNorms(){const u={};for(let i=1;i<=3;i++)u[`${ROOT}/floors/${i}/norm`]=Number(document.getElementById(`norm${i}`).value);await update(ref(db),u);alert("Сохранено");}
async function saveThresholds(){await update(settingsRef,{yellowLimit:Number(document.getElementById("yellowLimit").value),redLimit:Number(document.getElementById("redLimit").value)});alert("Сохранено");}
async function saveNotifications(){await update(settingsRef,{pushEnabled:document.getElementById("pushEnabled").value,soundEnabled:document.getElementById("soundEnabled").value,voiceCooldown:Number(document.getElementById("voiceCooldown").value)});alert("Сохранено");}

function todayEvents(){const key=dateKey();return analyticsEvents.filter(e=>e.date===key);}
function renderAnalytics(){
  if(!document.getElementById("statGuests"))return;
  const ev=todayEvents();let guests=0,staff=0,top=1,topLoad=-1,alerts=0;
  for(let i=1;i<=3;i++){guests+=Number(floors[i]?.guests||0);staff+=Number(floors[i]?.staff||0);const l=floorLoad(floors[i]);if(l>topLoad){top=i;topLoad=l;}if(statusOf(floors[i])==="red")alerts++;}
  const transfers=ev.filter(e=>e.type==="transfer");
  document.getElementById("statGuests").textContent=guests;document.getElementById("statStaff").textContent=staff;document.getElementById("statAlerts").textContent=alerts;document.getElementById("statTransfers").textContent=transfers.length;document.getElementById("statTopFloor").textContent=`${top} этаж`;

  const hourly={};ev.filter(e=>["guests","staff"].includes(e.type)).forEach(e=>{const h=new Date(e.createdAt).getHours();(hourly[h]??=[]).push(Number(e.newValue||0));});
  let peak="—",peakValue=-1;Object.entries(hourly).forEach(([h,arr])=>{const avg=arr.reduce((a,b)=>a+b,0)/arr.length;if(avg>peakValue){peakValue=avg;peak=`${String(h).padStart(2,"0")}:00`;}});
  document.getElementById("statPeakHour").textContent=peak;

  const maxAvg=Math.max(1,...Object.values(hourly).map(a=>a.reduce((x,y)=>x+y,0)/a.length));
  document.getElementById("hourlyChart").innerHTML=Array.from({length:24},(_,h)=>{const a=hourly[h]||[],avg=a.length?a.reduce((x,y)=>x+y,0)/a.length:0;return`<div class="bar-wrap"><div class="bar" style="height:${Math.max(2,avg/maxAvg*190)}px"></div><div class="bar-label">${String(h).padStart(2,"0")}</div></div>`}).join("");

  const entries={1:0,2:0,3:0},durations={1:0,2:0,3:0},openStart={};
  ev.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).forEach(e=>{if(e.type==="alert"){entries[e.floor]=(entries[e.floor]||0)+1;openStart[e.floor]=e.createdAt;}if(e.type==="alert_resolved"&&openStart[e.floor]){durations[e.floor]+=e.createdAt-openStart[e.floor];delete openStart[e.floor];}});
  for(const [f,start]of Object.entries(openStart))durations[f]+=now()-start;
  document.getElementById("redEntries").innerHTML=[1,2,3].map(f=>`<div class="metric-row"><span>${f} этаж</span><b>${entries[f]} раз</b></div>`).join("");
  document.getElementById("redDurations").innerHTML=[1,2,3].map(f=>`<div class="metric-row"><span>${f} этаж</span><b>${Math.round(durations[f]/60000)} мин</b></div>`).join("");
  const routes={};transfers.forEach(t=>{const k=`${t.fromFloor} → ${t.toFloor}`;routes[k]=(routes[k]||0)+1;});
  document.getElementById("transferStats").innerHTML=Object.keys(routes).length?Object.entries(routes).map(([k,v])=>`<div class="metric-row"><span>${k}</span><b>${v}</b></div>`).join(""):"Переводов пока нет";
}

function renderJournal(){
  const root=document.getElementById("journal");if(!root)return;
  const ff=document.getElementById("historyFloorFilter").value,tf=document.getElementById("historyTypeFilter").value;
  const data=history.filter(e=>(ff==="all"||String(e.floor)===ff)&&(tf==="all"||e.type===tf)).slice(0,200);
  const icon=e=>e.type==="staff"?"👤":e.type==="guests"?"👥":e.type==="transfer"?"🔄":e.type==="alert"?"🚨":e.type==="request"?"🙋":"✅";
  const text=e=>{
    if(e.type==="transfer")return`Перевод сотрудника: ${e.fromFloor} → ${e.toFloor} этаж`;
    if(["staff","guests"].includes(e.type))return`${e.label}: ${e.delta>0?"+":""}${e.delta} (${e.oldValue} → ${e.newValue}), ${e.floor} этаж`;
    return`${e.label||e.type}, ${e.floor||"—"} этаж`;
  };
  root.innerHTML=data.length?data.map(e=>`<div class="journal-item ${e.type}"><div class="journal-time">${e.time||""}</div><div class="journal-icon">${icon(e)}</div><div class="journal-main"><b>${text(e)}</b><small>${e.date||""}</small></div></div>`).join(""):"Событий пока нет";
}
async function clearHistory(){if(confirm("Очистить историю и аналитику?"))await Promise.all([remove(historyRef),remove(analyticsRef)]);}

function renderAll(){renderFloors();renderRequests();renderAnalytics();renderJournal();}
renderAll();
