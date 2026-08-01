importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDRvsn15ornx30mkwiTlhhlaL3-HT67D_w",
  authDomain: "sergeli-heatmap.firebaseapp.com",
  projectId: "sergeli-heatmap",
  messagingSenderId: "587633182406",
  appId: "1:587633182406:web:18b1fc7da7ba9fb8f979c7"
});

const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const title=payload.notification?.title||"🚨 Тепловая карта";
  const options={
    body:payload.notification?.body||payload.data?.body||"Требуется внимание",
    icon:"./icon-192.png",
    badge:"./icon-192.png",
    data:{url:payload.data?.url||"./"}
  };
  self.registration.showNotification(title,options);
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification.data?.url||"./";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){if("focus"in client)return client.focus();}
    return clients.openWindow(url);
  }));
});
