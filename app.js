import { db } from "./firebase.js";
import {
  ref, onValue, set, update, push, remove, runTransaction, get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const rootPath = "sergeli_heatmap";
const floorsRef = ref(db, `${rootPath}/floors`);
const settingsRef = ref(db, `${rootPath}/settings`);
const historyRef = ref(db, `${rootPath}/history`);
const requestsRef = ref(db, `${rootPath}/staffRequests`);

let currentPage = "main";
let floors = {
  1:{staff:4, guests:20, norm:5},
  2:{staff:4, guests:20, norm:5},
  3:{staff:4, guests:20, norm:5}
};
let settings = {
  yellowLimit:1,
  redLimit:2,
  pushEnabled:"Включено",
  soundEnabled:"Включено",
  voiceCooldown:300000
};
let history = [];
let staffRequests = {};
let lastAlertText = "";

const floorVoice = {
  1: new Audio("./floor1.mp3"),
  2: new Audio("./floor2.mp3"),
  3: new Audio("./floor3.mp3")
};
Object.values(floorVoice).forEach(a => a.preload = "auto");

let voiceUnlocked = localStorage.getItem("voiceUnlocked") === "1";
let voiceQueue = [];
let isVoicePlaying = false;
let lastVoiceTime = {};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.error);
}

function nowText(){ return new Date().toLocaleString("ru-RU"); }
function todayDate(){ return new Date().toLocaleDateString("ru-RU"); }

function getLoad(data){
  return Number(data.staff) > 0 ? Number(data.guests) / Number(data.staff) : 0;
}
function getStatus(data){
  const load = getLoad(data);
  const norm = Number(data.norm || 1);
  if(load <= norm) return "green";
  if(load <= norm + Number(settings.yellowLimit || 0)) return "yellow";
  return "red";
}
function statusText(status){
  return status === "red" ? "Критичная" : status === "yellow" ? "Высокая" : "Нормальная";
}
function getMissing(data){
  const norm = Math.max(1, Number(data.norm || 1));
  return Math.max(0, Math.ceil(Number(data.guests || 0) / norm) - Number(data.staff || 0));
}
function needText(data,status){
  const missing = getMissing(data);
  if(status === "green") return "Сотрудников хватает";
  if(missing === 1) return "Нужен 1 сотрудник";
  return `Нужно ${missing} сотрудника`;
}

async function addHistory(item){
  await push(historyRef, {...item,time:nowText(),date:todayDate(),createdAt:Date.now()});
}

onValue(floorsRef, snap => {
  if(snap.exists()) floors = snap.val();
  else set(floorsRef, floors);
  render();
  renderAnalytics();
});
onValue(settingsRef, snap => {
  if(snap.exists()) settings = {...settings,...snap.val()};
  else set(settingsRef, settings);
  render();
  loadAdmin();
});
onValue(historyRef, snap => {
  if(snap.exists()){
    history = Object.entries(snap.val()).map(([id,v])=>({id,...v})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  } else history = [];
  renderHistory();
});
onValue(requestsRef, snap => {
  staffRequests = snap.exists() ? snap.val() : {};
  renderRequests();
  render();
  renderAnalytics();
});

document.getElementById("toggleBtn").addEventListener("click", togglePage);
document.getElementById("voiceUnlockBtn").addEventListener("click", unlockVoice);
document.getElementById("saveNormsBtn").addEventListener("click", saveNorms);
document.getElementById("saveLimitsBtn").addEventListener("click", saveLimits);
document.getElementById("permissionBtn").addEventListener("click", requestNotificationPermission);
document.getElementById("saveNotificationsBtn").addEventListener("click", saveNotificationSettings);
document.getElementById("clearHistoryBtn").addEventListener("click", clearHistory);
document.querySelectorAll(".testVoiceBtn").forEach(btn => btn.addEventListener("click", ()=>testVoice(Number(btn.dataset.floor))));
document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", ()=>openTab(btn.dataset.tab, btn)));

function togglePage(){
  currentPage = currentPage === "main" ? "admin" : "main";
  document.getElementById("mainPage").classList.toggle("hidden", currentPage !== "main");
  document.getElementById("adminPage").classList.toggle("hidden", currentPage !== "admin");
  document.getElementById("pageTitle").textContent = currentPage === "main" ? "🔥 Тепловая карта" : "⚙️ Админ-панель";
  document.getElementById("toggleBtn").textContent = currentPage === "main" ? "⚙️ Админ" : "⬅️ Назад";
  if(currentPage === "admin"){ loadAdmin(); renderAnalytics(); renderHistory(); }
}
function openTab(id, btn){
  document.querySelectorAll(".tab-content").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  btn.classList.add("active");
}

window.changeValue = async function(floor,type){
  const oldValue = Number(floors[floor][type] || 0);
  const label = type === "staff" ? "сотрудников" : "гостей";
  let value = prompt(`Введите количество ${label} для ${floor} этажа:`, oldValue);
  if(value === null) return;
  value = Number(value);
  if(!Number.isFinite(value) || value < 0){ alert("Введите правильное число"); return; }
  if(type === "staff" && value < 1){ alert("Сотрудников не может быть меньше 1"); return; }
  await update(ref(db, `${rootPath}/floors/${floor}`), {[type]:value});
  await addHistory({floor,type,label:type==="staff"?"Сотрудники":"Гости",oldValue,newValue:value});
};

window.stepValue = async function(floor,type,delta){
  const oldValue = Number(floors[floor][type] || 0);
  const newValue = oldValue + delta;
  if(newValue < 0) return;
  if(type === "staff" && newValue < 1) return;
  await update(ref(db, `${rootPath}/floors/${floor}`), {[type]:newValue});
  await addHistory({floor,type,label:type==="staff"?"Сотрудники":"Гости",oldValue,newValue});
};

function render(){
  const box = document.getElementById("floors");
  box.innerHTML = "";
  const redFloors = [];

  for(let i=1;i<=3;i++){
    const data = floors[i] || {staff:1,guests:0,norm:5};
    const status = getStatus(data);
    const missing = getMissing(data);
    if(status === "red") redFloors.push({floor:i,guests:data.guests,staff:data.staff,missing});

    const hasOpenRequest = Object.values(staffRequests).some(r => Number(r.toFloor)===i && ["open","accepted"].includes(r.status));
    box.insertAdjacentHTML("beforeend", `
      <article class="floor ${status}">
        <div class="counter">
          ${counterHtml(i,"staff","Сотрудники",data.staff)}
          ${counterHtml(i,"guests","Гости",data.guests)}
        </div>
        <div class="floor-info">
          <h2>Этаж №${i}</h2>
          <p>Нагрузка: ${statusText(status)}</p>
          <p>${needText(data,status)}</p>
          ${status==="red" ? `<button class="request-btn" onclick="createStaffRequest(${i})" ${hasOpenRequest?"disabled":""}>${hasOpenRequest?"Запрос отправлен":"🙋 Запросить сотрудника"}</button>`:""}
        </div>
      </article>
    `);
  }
  renderNotification(redFloors);
}

function counterHtml(floor,type,label,value){
  return `<div class="counter-box">
    <div class="counter-label">${label}</div>
    <div class="stepper">
      <button class="step-btn" onclick="stepValue(${floor},'${type}',-1)">−</button>
      <div class="counter-value" onclick="changeValue(${floor},'${type}')">${value}</div>
      <button class="step-btn" onclick="stepValue(${floor},'${type}',1)">+</button>
    </div>
  </div>`;
}

window.createStaffRequest = async function(toFloor){
  const missing = Math.max(1,getMissing(floors[toFloor]));
  await push(requestsRef,{
    toFloor,needed:missing,status:"open",createdAt:Date.now(),createdText:nowText()
  });
  await addHistory({floor:toFloor,type:"request",label:"Запрос сотрудника",oldValue:"—",newValue:`Нужно ${missing}`});
};

window.respondToRequest = async function(requestId,fromFloor,canGive){
  const requestRef = ref(db, `${rootPath}/staffRequests/${requestId}`);
  if(!canGive){
    await update(requestRef,{[`declinedBy/${fromFloor}`]:true});
    return;
  }
  const snap = await get(requestRef);
  if(!snap.exists()) return;
  const req = snap.val();
  if(req.status !== "open"){ alert("Запрос уже принят другим этажом"); return; }
  if(Number(floors[fromFloor].staff||0) <= 1){ alert("На этом этаже нельзя уменьшить сотрудников ниже 1"); return; }
  await update(requestRef,{status:"accepted",fromFloor,acceptedAt:Date.now(),acceptedText:nowText()});
};

window.confirmArrival = async function(requestId){
  const requestRef = ref(db, `${rootPath}/staffRequests/${requestId}`);
  const snap = await get(requestRef);
  if(!snap.exists()) return;
  const req = snap.val();
  if(req.status !== "accepted") return;

  const from = Number(req.fromFloor), to = Number(req.toFloor);
  const amount = 1;
  if(Number(floors[from].staff||0) <= 1){ alert("На этаже-доноре уже недостаточно сотрудников"); return; }

  await update(ref(db, rootPath), {
    [`floors/${from}/staff`]: Number(floors[from].staff)-amount,
    [`floors/${to}/staff`]: Number(floors[to].staff)+amount,
    [`staffRequests/${requestId}/status`]:"completed",
    [`staffRequests/${requestId}/completedAt`]:Date.now(),
    [`staffRequests/${requestId}/completedText`]:nowText()
  });
  await addHistory({floor:to,type:"transfer",label:"Перевод сотрудника",oldValue:`${from} этаж`,newValue:`${to} этаж`});
};

window.cancelRequest = async function(requestId){
  await update(ref(db, `${rootPath}/staffRequests/${requestId}`),{status:"cancelled",cancelledAt:Date.now()});
};

function renderRequests(){
  const panel = document.getElementById("staffRequestPanel");
  const entries = Object.entries(staffRequests).filter(([,r])=>["open","accepted"].includes(r.status));
  if(!entries.length){ panel.innerHTML=""; return; }

  panel.innerHTML = `<div class="requests-wrap">${entries.map(([id,r])=>{
    const to = Number(r.toFloor);
    if(r.status === "accepted"){
      return `<div class="request-card accepted">
        <div class="request-title">✅ ${r.fromFloor} этаж готов отправить сотрудника на ${to} этаж</div>
        <div class="request-meta">Запрос: ${r.createdText||""}</div>
        <div class="request-actions">
          <button class="confirm-btn" onclick="confirmArrival('${id}')">Сотрудник прибыл</button>
          <button class="reject-btn" onclick="cancelRequest('${id}')">Отменить</button>
        </div>
      </div>`;
    }
    const responseButtons = [1,2,3].filter(f=>f!==to).map(f=>`
      <button class="accept-btn" onclick="respondToRequest('${id}',${f},true)">${f} этаж: могу дать</button>
      <button class="reject-btn" onclick="respondToRequest('${id}',${f},false)">${f} этаж: не могу</button>
    `).join("");
    return `<div class="request-card">
      <div class="request-title">🚨 ${to} этаж просит ${r.needed||1} сотрудника</div>
      <div class="request-meta">Создано: ${r.createdText||""}</div>
      <div class="request-actions">${responseButtons}</div>
    </div>`;
  }).join("")}</div>`;
}

function renderNotification(redFloors){
  const notification = document.getElementById("notification");
  const alertCount = document.getElementById("alertCount");
  if(!redFloors.length){
    notification.classList.add("hidden"); notification.innerHTML="";
    alertCount.classList.add("hidden"); lastAlertText="";
    return;
  }
  alertCount.classList.remove("hidden");
  alertCount.textContent = `${redFloors.length} тревог`;

  const html = redFloors.map(x=>`🔴 <b>${x.floor} этаж</b>: гостей ${x.guests}, сотрудников ${x.staff}, не хватает <b>+${x.missing}</b>.`).join("<br>");
  notification.innerHTML = `🚨 ВНИМАНИЕ! Нужно перераспределить сотрудников:<br><br>${html}`;
  notification.classList.remove("hidden");

  const signature = JSON.stringify(redFloors.map(x=>[x.floor,x.guests,x.staff,x.missing]));
  if(signature !== lastAlertText){
    redFloors.forEach(x=>addVoiceToQueue(x.floor));
    sendPhoneNotification("🚨 Горит этаж!",redFloors.map(x=>`${x.floor} этаж: не хватает +${x.missing}`).join(". "));
    lastAlertText = signature;
  }
}

async function unlockVoice(){
  try{
    const a = floorVoice[1];
    a.volume = 0.01;
    await a.play();
    a.pause(); a.currentTime = 0; a.volume = 1;
    voiceUnlocked = true;
    localStorage.setItem("voiceUnlocked","1");
    document.getElementById("voiceUnlockBtn").textContent = "🔊 Голос включён";
    alert("Голосовые уведомления включены");
  }catch(e){
    alert("Браузер не разрешил звук. Проверьте громкость и разрешения сайта.");
  }
}
async function testVoice(floor){
  if(!voiceUnlocked) await unlockVoice();
  addVoiceToQueue(floor,true);
}
function addVoiceToQueue(floor,force=false){
  if(settings.soundEnabled === "Выключено" || !voiceUnlocked) return;
  const now = Date.now();
  const cooldown = Number(settings.voiceCooldown || 300000);
  if(!force && lastVoiceTime[floor] && now-lastVoiceTime[floor] < cooldown) return;
  if(!voiceQueue.includes(floor)) voiceQueue.push(floor);
  playNextVoice();
}
function playNextVoice(){
  if(isVoicePlaying || !voiceQueue.length) return;
  const floor = voiceQueue.shift();
  const audio = floorVoice[floor];
  if(!audio){ playNextVoice(); return; }
  isVoicePlaying = true;
  lastVoiceTime[floor] = Date.now();
  audio.currentTime = 0;
  audio.onended = ()=>{ isVoicePlaying=false; setTimeout(playNextVoice,1200); };
  audio.onerror = ()=>{ isVoicePlaying=false; playNextVoice(); };
  audio.play().catch(()=>{ isVoicePlaying=false; });
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    const red = [1,2,3].filter(i=>getStatus(floors[i])==="red");
    red.forEach(i=>addVoiceToQueue(i,true));
  }
});

async function sendPhoneNotification(title,body){
  if(settings.pushEnabled==="Выключено" || !("Notification" in window) || Notification.permission!=="granted") return;
  if("serviceWorker" in navigator){
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title,{body,icon:"./icon-192.png",badge:"./icon-192.png",vibrate:[200,100,200],tag:"sergeli-alert"});
  }
}
async function requestNotificationPermission(){
  if(!("Notification" in window)){ alert("Браузер не поддерживает уведомления"); return; }
  const p = await Notification.requestPermission();
  alert(p==="granted"?"Уведомления разрешены":"Уведомления не разрешены");
}

function loadAdmin(){
  for(let i=1;i<=3;i++) document.getElementById(`norm${i}`).value = floors[i]?.norm ?? 5;
  document.getElementById("yellowLimit").value = settings.yellowLimit;
  document.getElementById("redLimit").value = settings.redLimit;
  document.getElementById("pushEnabled").value = settings.pushEnabled;
  document.getElementById("soundEnabled").value = settings.soundEnabled;
  document.getElementById("voiceCooldown").value = String(settings.voiceCooldown||300000);
}
async function saveNorms(){
  const updates={};
  for(let i=1;i<=3;i++) updates[`${rootPath}/floors/${i}/norm`] = Number(document.getElementById(`norm${i}`).value);
  await update(ref(db),updates); alert("Нормы сохранены");
}
async function saveLimits(){
  await update(settingsRef,{
    yellowLimit:Number(document.getElementById("yellowLimit").value),
    redLimit:Number(document.getElementById("redLimit").value)
  }); alert("Пороги сохранены");
}
async function saveNotificationSettings(){
  await update(settingsRef,{
    pushEnabled:document.getElementById("pushEnabled").value,
    soundEnabled:document.getElementById("soundEnabled").value,
    voiceCooldown:Number(document.getElementById("voiceCooldown").value)
  }); alert("Настройки уведомлений сохранены");
}

function renderAnalytics(){
  if(!document.getElementById("redCount")) return;
  let red=0,yellow=0,totalGuests=0,totalStaff=0,topFloor=1,topLoad=-1;
  for(let i=1;i<=3;i++){
    const d=floors[i]||{};
    const s=getStatus(d), l=getLoad(d);
    if(s==="red") red++; if(s==="yellow") yellow++;
    totalGuests+=Number(d.guests||0); totalStaff+=Number(d.staff||0);
    if(l>topLoad){topLoad=l;topFloor=i;}
  }
  document.getElementById("redCount").textContent=red;
  document.getElementById("yellowCount").textContent=yellow;
  document.getElementById("totalGuests").textContent=totalGuests;
  document.getElementById("totalStaff").textContent=totalStaff;
  document.getElementById("topFloor").textContent=`${topFloor} этаж`;
  document.getElementById("activeRequests").textContent=Object.values(staffRequests).filter(r=>["open","accepted"].includes(r.status)).length;

  document.getElementById("loadBars").innerHTML=[1,2,3].map(i=>{
    const d=floors[i]||{}, load=getLoad(d), norm=Number(d.norm||1);
    const percent=Math.min(100,Math.round(load/(norm+Number(settings.redLimit||2))*100));
    const status=getStatus(d), color=status==="red"?"#ef4444":status==="yellow"?"#eab308":"#22c55e";
    return `<div class="load-row"><div class="load-row-head"><span>${i} этаж</span><span>${load.toFixed(1)} гостя/сотр.</span></div><div class="load-track"><div class="load-fill" style="width:${percent}%;background:${color}"></div></div></div>`;
  }).join("");
}

function renderHistory(){
  const root=document.getElementById("historyColumns");
  if(!root) return;
  root.innerHTML=[1,2,3].map(floor=>{
    const items=history.filter(h=>Number(h.floor)===floor).slice(0,40);
    return `<section class="history-column"><h3>${floor} этаж</h3>${items.length?items.map(h=>{
      const cls=h.type==="staff"?"staff":h.type==="guests"?"guests":"transfer";
      return `<div class="history-item ${cls}"><b>${h.time||""}</b><br>${h.label||""}: <b>${h.oldValue}</b> → <b>${h.newValue}</b></div>`;
    }).join(""):"<p>Пока нет изменений</p>"}</section>`;
  }).join("");
}
async function clearHistory(){
  if(confirm("Очистить всю историю?")) await remove(historyRef);
}

if(voiceUnlocked) document.getElementById("voiceUnlockBtn").textContent="🔊 Голос включён";
render();
renderRequests();
