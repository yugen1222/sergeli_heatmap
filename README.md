# Sergeli Heatmap v3

## Что включено
- управление персоналом и переводы между этажами;
- голосовая очередь с повторами;
- FCM Push для свёрнутого/закрытого сайта;
- аналитика по часам, тревогам, длительности красной зоны и переводам;
- красивый журнал;
- ТВ-режим в 3 колонки.

## Перед запуском
1. Загрузите в корень репозитория:
   index.html, style.css, app.js, firebase.js, firebase-messaging-sw.js,
   floor1.mp3, floor2.mp3, floor3.mp3.
2. В Firebase Authentication включите Anonymous.
3. В Firebase Console → Project settings → Cloud Messaging → Web Push certificates
   создайте ключ и вставьте PUBLIC VAPID KEY в app.js вместо:
   PASTE_YOUR_PUBLIC_VAPID_KEY_HERE
4. Для настоящих Push при закрытом сайте установите Firebase CLI и выполните:
   npm install -g firebase-tools
   firebase login
   firebase use sergeli-heatmap
   firebase deploy --only functions,database
5. Cloud Functions могут потребовать переход проекта Firebase на Blaze.
6. После открытия сайта нажмите «Включить голос» и «Разрешить Push».

## Важно
Если телефон полностью выключен, уведомление физически не придёт до включения телефона.
