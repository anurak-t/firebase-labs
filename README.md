# Firebase NoSQL Mini Social Lab

เว็บ mini social network สำหรับรายวิชา **Database Modernization** หัวข้อ **Firebase NoSQL** ใช้ HTML, CSS และ JavaScript ธรรมดาเท่านั้น เพื่อให้นักศึกษาเห็นการทำงานของ Firebase Auth, Firestore, Realtime Database, Security Rules และ Hosting ในโปรเจกต์เดียว

## สิ่งที่ได้ทดลอง

- Google Authentication สำหรับเข้าสู่ระบบ
- Firestore สำหรับ profile, feed, post, comment และ like
- Realtime Database สำหรับ presence, typing indicator และ direct message chat
- Security Rules สำหรับแยกสิทธิ์อ่าน/เขียนตาม `auth.uid`
- Firebase Hosting สำหรับ deploy static web app

## โครงสร้างไฟล์

```text
.
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── firebase-config.example.js
├── firebase.json
├── firestore.rules
├── database.rules.json
├── .firebaserc.example
└── README.md
```

## 1. เตรียม Firebase Project

1. เข้า Firebase Console แล้วสร้าง project ใหม่
2. เพิ่ม Web App ใน project
3. คัดลอก Firebase config ที่มีค่า `apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, และ `appId`
4. เปิดเมนู Authentication แล้ว enable provider แบบ Google
5. เปิด Cloud Firestore โดยเริ่มจาก production mode ได้ เพราะเราจะ deploy rules เอง
6. เปิด Realtime Database และเลือก region ที่เหมาะกับห้องเรียน เช่น `asia-southeast1`

## 2. ตั้งค่าไฟล์ Config

คัดลอกไฟล์ตัวอย่าง:

```powershell
Copy-Item public/firebase-config.example.js public/firebase-config.js
```

แก้ `public/firebase-config.js` ให้เป็น config ของ project ตัวเอง:

```js
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

export const useEmulators = false;
```


## 3. ติดตั้งและ Login Firebase CLI

ติดตั้ง CLI ถ้ายังไม่มี:

```powershell
npm install -g firebase-tools
```

เข้าสู่ระบบ:

```powershell
firebase login
```

ตั้งค่า project:

```powershell
Copy-Item .firebaserc.example .firebaserc
```

จากนั้นแก้ `.firebaserc` ให้ `your-firebase-project-id` เป็น project ID จริง หรือใช้คำสั่ง:

```powershell
firebase use --add
```

## 4. แนวคิดของ `firebase init`

โปรเจกต์นี้เตรียมไฟล์ที่ปกติ `firebase init` จะสร้างไว้แล้ว:

- `firebase.json` กำหนด Hosting public folder เป็น `public` และชี้ rules files
- `firestore.rules` คือ rules ของ Cloud Firestore
- `database.rules.json` คือ rules ของ Realtime Database
- `.firebaserc` ผูกโฟลเดอร์นี้กับ Firebase project

ถ้าต้อง init เองใน lab ใหม่ ให้เลือก Hosting, Firestore และ Realtime Database แล้วตั้ง public directory เป็น `public`

## 5. ทดสอบบนเครื่อง

รัน static hosting ในเครื่อง:

```powershell
firebase serve --only hosting
```

หรือใช้ emulator suite:

```powershell
firebase emulators:start --only hosting,firestore,database,auth
```

ถ้าจะใช้ emulator ให้เปลี่ยน `useEmulators` ใน `public/firebase-config.js` เป็น `true` แต่ Google popup sign-in เหมาะกับการทดสอบกับ Firebase project จริงมากกว่า

## 6. Deploy Rules และ Hosting

Deploy rules และเว็บพร้อมกัน:

```powershell
firebase deploy --only firestore:rules,database,hosting
```

หลัง deploy เสร็จ CLI จะแสดง Hosting URL เช่น:

```text
https://YOUR_PROJECT_ID.web.app
```

ให้นักศึกษาเปิด URL นี้ ทดสอบ sign in, post, like, comment และ chat

## การออกแบบข้อมูล

Firestore เหมาะกับข้อมูล social feed เพราะ query เอกสารแบบเรียงเวลาได้ดี และทำ subcollection สำหรับ comments/likes ได้ชัด:

```text
users/{uid}
posts/{postId}
posts/{postId}/comments/{commentId}
posts/{postId}/likes/{uid}
```

Realtime Database เหมาะกับข้อมูลที่ต้อง realtime และมี state เปลี่ยนบ่อย เช่น online status, typing และ chat messages:

```text
status/{uid}
chats/{chatId}
chatMessages/{chatId}/{messageId}
typing/{chatId}/{uid}
```

DM chat ใช้ deterministic chat ID จาก UID สองคนที่ sort แล้ว เช่น:

```text
uidA_uidB
```

วิธีนี้ทำให้ผู้ใช้คู่เดิมเปิดห้องเดิมเสมอ ไม่ต้อง query หา room ซ้ำ

## เทคนิคที่ควรสังเกต

- ใช้ `auth.uid` เป็น key สำคัญของ rules เพื่อให้ตรวจสิทธิ์ง่าย
- เก็บ `authorName` และ `authorPhotoURL` ซ้ำใน post/comment เป็น denormalized author snapshot เพื่อ render feed ได้เร็วโดยไม่ต้อง join
- ใช้ Firestore `onSnapshot` กับ feed เพื่อเห็น document updates แบบ realtime
- ใช้ RTDB `onValue`, `push`, `set`, `update` และ `onDisconnect` กับ chat/presence
- ใช้ Hosting เสิร์ฟไฟล์ static ทั้งหมด จึงไม่ต้องมี backend server
- Rules ตั้งใจให้เขียนผิดสิทธิ์แล้ว fail เพื่อใช้เป็นโจทย์ทดลอง

## แบบฝึกหัดในห้องเรียน

1. Sign in ด้วย Google แล้วดูเอกสารของตัวเองใน `users/{uid}`
2. สร้างโพสต์ แล้วดูข้อมูลใน Firestore console
3. กด like แล้วสังเกตว่า document ID ของ like คือ UID ของตัวเอง
4. เปิดสอง browser หรือให้เพื่อน login แล้วลองส่ง DM chat
5. ดู path `status/{uid}` ใน Realtime Database แล้วปิด tab เพื่อดู `onDisconnect`
6. กดปุ่ม Rule Test ในแอป แล้วอธิบายว่าทำไม rules ถึงปฏิเสธ
7. แก้ rules ให้หลวมขึ้นชั่วคราว แล้วทดลองว่าเกิดความเสี่ยงอะไร
8. Deploy ด้วย Hosting แล้วส่ง URL ที่ได้
