# Xem API va database trong hai cua so terminal

Dung ban code da ghep o `D:\seruchat`. SQL, .env va thu vien da cai van duoc dung lai.

## Cai ban cap nhat

Neu dang dung ban cu, cai `seruchat-update.zip` va migration theo docs/upgrade-local.md. Neu dung ban complete moi nhat, cac cong cu da co san. Khong chay lai schema tao bang tren database da co du lieu.

## Terminal 1: API server

Mo Command Prompt va chay:

```bat
cd /d D:\seruchat\server
set DEBUG_API=1
npm start
```

Tren web, thu dang nhap, ket ban, mo chat, gui tin. Terminal hien mau sau (thoi gian va duration la vi du):

```text
[00:35:10] LOGIN POST /api/auth/login -> 200 (85.1 ms)
[00:35:20] FRIEND_REQUEST POST /api/friendships/request -> 201 (8.4 ms)
[00:35:30] ACCEPT_FRIEND POST /api/friendships/:id/accept -> 200 (6.2 ms)
[00:35:40] OPEN_CHAT POST /api/conversations -> 201 (7.5 ms)
[00:35:50] SEND_MESSAGE POST /api/messages -> 201 (5.8 ms)
[00:35:52] READ_MESSAGES GET /api/messages/:conversationId -> 200 (3.6 ms)
```

200/201: xu ly thanh cong. 400: du lieu khong hop le. 401: chua dang nhap. 403: khong du quyen/bi chan. 404: khong tim thay. 409: xung dot/trung. 429: gui qua nhanh. 500/503: loi server/database. Ket qua API cu the van hien tren web.

Day la log HTTP khi response hoan thanh, khong phai log tung cau SQL hay tung buoc mat ma. READ_MESSAGES, READ_FRIENDS va READ_REQUESTS lap lai vi client tu lay du lieu khoang 2,5 giay khi tab dang hien.

Log chi in ten thao tac, method, mau route, status va thoi gian xu ly. Khong in body, query string, cookie, mat khau, private key, noi dung ban ro hay public key. UUID tren route duoc thay bang ten tham so.

De tat log, Ctrl+C, chay `set DEBUG_API=` roi `npm start`. Neu da dat DEBUG_API=1 trong .env thi doi thanh DEBUG_API=0; bien set trong CMD chi ap dung cho cua so do.

## Terminal 2: xem database tu cap nhat

Mo cua so Command Prompt khac:

```bat
cd /d D:\seruchat\server
node tools/watchDatabase.js
```

Script dung dung DB_* trong server/.env (vi du DB_NAME=seruchat_full). Moi 3 giay no doc so dong cua 7 bang va 5 tin moi nhat; chi in lai khi snapshot thay doi. Neu chua co tin, hien `No messages stored yet.`. No khong ghi/xoa du lieu.

Bang tin hien ID rut gon, IV, do dai ciphertext theo so ky tu Base64 va 48 ky tu dau cua ciphertext. Day la ban ma; terminal nay khong co private key de giai ma. Snapshot khong bao gom noi dung sessions, password hash hay backup private key. Tu dong dem khong phai audit log: thay doi giua hai lan doc co the khong duoc ghi nhan; neu sua row ma so luong va 5 tin cuoi khong doi thi khong co dong snapshot moi.

Ctrl+C o terminal 2 chi dung script quan sat. Terminal 1 van phuc vu web. Neu loi DB, script in ma loi de kiem tra MySQL va DB_*.

## Xem ban ghi day du trong Workbench

Trong ket noi MySQL, Ctrl+T va chay:

```sql
SELECT id, username, email, created_at FROM seruchat_full.users;
SELECT id, user1_id, user2_id, status, requested_by, blocked_by FROM seruchat_full.friendships;
SELECT * FROM seruchat_full.conversation_members;
SELECT id, conversation_id, sender_id, ciphertext, nonce,
       sender_public_key, self_ciphertext, self_nonce, self_public_key, created_at
FROM seruchat_full.messages ORDER BY created_at DESC, id DESC LIMIT 20;
```

Neu .env dung ten database khac, doi seruchat_full trong cac cau SELECT. Nhan Ctrl+Shift+Enter de chay tat ca cau lenh. Mo tung tab Result de xem ket qua tung bang. Chay lai SELECT de lay du lieu moi.

users luu password_hash, khong luu mat khau ro; friendships luu pending/accepted/rejected/blocked; messages luu ciphertext/IV/public key tam thoi va ban ma self de nguoi gui doc lai. Server HTTP va MySQL server la hai tien trinh khac nhau; watchDatabase.js la mot client chi doc MySQL.

Ma hoa/giai ma web van xay ra trong trinh duyet. Nhan F12 > Network de xem request API va Response. Java Sender/Receiver la cac client terminal khac, xem huong dan trong README. Cac ham ma hoa va dependencies giu nguyen. Cac API quan he moi va migration duoc giai thich trong docs/upgrade-local.md.
