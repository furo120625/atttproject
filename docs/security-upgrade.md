# Seruchat v2: đã nâng cấp ở đâu và chạy như thế nào

Đây là prototype ATTT chạy local trên Node.js + MySQL, có client web và Java. Không cần MongoDB, cron job hoặc triển khai lên Internet để học và demo. Các phần dưới đây đã có trong code, không chỉ là đề xuất.

## 1. Trước và sau

| Phần | Bản cũ | Bản v2 |
|---|---|---|
| Mật mã nền | X25519 -> HKDF-SHA256 -> AES-256-GCM | Giữ nguyên suite, info e2ee-chat-v1, IV 12 byte, tag 128 bit |
| Ràng buộc tin | Không có AAD | AAD chứa phiên bản, ID tin, chat, người gửi, người nhận và vai trò recipient/self |
| Xác thực người gửi | Dựa vào session/server | Thêm chữ ký Ed25519 trên metadata và cả hai bản mã; server và client đều kiểm tra |
| Tin trùng | Server tự tạo ID | Client tạo UUID; chữ ký bao gồm ID; server từ chối ID đã tồn tại |
| Xác minh người nhận | Tin public key của server | SHA-256 fingerprint gắn với UUID + X25519 + Ed25519; đối chiếu ngoài ứng dụng và lưu pin trên thiết bị |
| Khóa thay đổi | API chặn thay X25519 | Chặn thay cả X25519/Ed25519; client phát hiện khác fingerprint và dừng gửi |
| Backup private key | PBKDF2 từ mật khẩu đăng nhập | Recovery secret ngẫu nhiên 32 byte, HKDF-SHA256 + AES-GCM có AAD; server không nhận recovery secret |
| Java lưu khóa | File PKCS8 rõ | vault-v2.json chứa bundle đã mã hóa; phải có recovery code mới mở được |
| Web request | Origin + SameSite | Thêm CSRF token gắn session, xoay token sau đăng nhập |
| Script/web | textContent | Thêm CSP, chống nhúng trang, nosniff, no-referrer, no-store cho API |
| MySQL từ xa | Chưa bật TLS | Cấu hình DB_SSL và CA cho cả pool truy vấn lẫn session store |
| Mật khẩu mới | Chỉ không rỗng | Tối thiểu 12 ký tự, từ chối một số mẫu phổ biến/lặp; mật khẩu tài khoản cũ vẫn đăng nhập được |

Không thêm thư viện mới; giữ các dependency trực tiếp, thêm npm override để express-mysql-session dùng mysql2 cùng phiên bản đã vá của dự án. Ba file mật mã browser gốc vẫn nguyên từng byte. Các hàm X25519/HKDF/AES v1 trong Sender/Receiver vẫn giữ; adapter mới dùng v2 cho tin mới. Các hàm v1 chỉ phục vụ kiểm thử và đọc lịch sử cũ.

## 2. Cập nhật trên máy Windows đang có dữ liệu

1. Dừng `npm start` bằng Ctrl+C nếu đang chạy. Copy `D:\seruchat` sang `D:\seruchat-backup`. Trong Workbench, xuất database `seruchat_full` bằng Server > Data Export. Bản sao database chứa dữ liệu riêng: giữ trên máy.
2. Giải nén `seruchat-update.zip`, copy toàn bộ nội dung vào `D:\seruchat`, chọn Replace. ZIP không chứa .env thật, node_modules hoặc keys; các phần đó trên máy bạn được giữ.
3. Trong Workbench đã kết nối MySQL, mở `D:\seruchat\database\upgrade-security.sql`, chạy toàn bộ. Script dành cho schema 7 bảng của Seruchat, thêm cột thiếu, giữ dữ liệu, chạy lại được. Nếu DB dùng tên khác, sửa dòng USE. Không chạy schema mới trên database đang dùng.
4. CMD thường (npm ci là bắt buộc vì dependency lock đã cập nhật):

```bat
cd /d D:\seruchat\server
npm ci
set DEBUG_API=1
npm start
```

5. Mở `http://localhost:3000`, Ctrl+F5. Đăng nhập tài khoản cũ. Nếu có khóa local hoặc backup cũ mở được bằng mật khẩu, chương trình giữ nguyên X25519, tạo thêm Ed25519 và hiện **mã khôi phục**. Tải/lưu riêng mã đó, đánh dấu đã lưu, Yes. Không gửi mã cho server hoặc người khác.
6. Làm tương tự cho tài khoản thứ hai trong cửa sổ ẩn danh. Vào chat, copy **fingerprint của chính mình** ở đầu trang để người kia đối chiếu. Tại A, nhập fingerprint nhận trực tiếp từ B và xác nhận; tại B, làm tương tự với fingerprint của A. Pin nằm trên thiết bị/profile hiện tại; máy mới cần xác minh lại.
7. Gửi tin. Tin mới dùng chữ ký và AAD. Tin cũ vẫn đọc bằng private key cũ, có nhãn `Tin cũ v1 • chưa có chữ ký/AAD`. Không biến tin cũ thành tin có chữ ký giả.
8. Mở terminal thứ hai: `node tools/watchDatabase.js`. Quan sát số dòng và preview ciphertext như trước.

### Trường hợp khóa cũ chỉ nằm trên Java

Dùng thư mục `encryption/keys/<userId>` gốc. Java sẽ giữ X25519, thêm khóa ký, tạo vault và recovery code. Các file private.pkcs8/public.spki cũ chỉ được xóa sau khi ghi vault mã hóa và đăng ký thành công. Xóa file không bảo đảm xóa mọi bản sao hoặc dấu vết trên ổ đĩa; backup cũ vẫn do bạn quản lý.

Nếu key cũ nằm trên thiết bị khác, không có backup hoặc không mở được, chương trình dừng và yêu cầu dùng thiết bị gốc. Không tự thay khóa làm mất lịch sử. Sai recovery code cũng không sinh khóa mới.

### Cài trên máy hoàn toàn mới

Giải nén `seruchat-complete.zip` vào D:\, được `D:\seruchat`. Chạy `database/seruchat_full.sql` một lần để tạo database mới. Trong server, copy `.env.example` sang `.env`, điền DB_* và SESSION_SECRET ngẫu nhiên ít nhất 32 ký tự, chạy `npm ci`, `npm start`. Không dùng SQL tạo mới nếu đã có dữ liệu.

## 3. Khi mở trên profile hoặc máy mới

Đăng nhập bằng email/mật khẩu bình thường. Sau đó nhập **recovery code** để client giải mã backup và kiểm tra cặp khóa. Mật khẩu đăng nhập không mở được backup v2. Private key và signing key được khôi phục rồi lưu trong IndexedDB để tải lại trang không phải nhập lại.

Recovery code không được lưu rõ trên server, trong session hoặc trong vault Java. Browser vẫn lưu CryptoKey trên thiết bị; IndexedDB không phải một két chống XSS/malware. Đăng xuất xóa trạng thái giao diện và plaintext cache trong bộ nhớ, không xóa khóa IndexedDB để giữ khả năng đọc lại lịch sử.

## 4. Java v2

Cần JDK 21. Trong CMD:

```bat
cd /d D:\seruchat\encryption
chcp 65001
javac -encoding UTF-8 ApiClient.java Sender.java Receiver.java SecurityV2.java
java ApiClient setup http://localhost:3000
```

Lần đầu lưu recovery code được in để bạn ghi lại; gõ yes. Các lần sau nhập recovery code để mở vault. Mã chỉ in lúc tạo, không dùng làm log API. Không lưu ảnh terminal có recovery code vào báo cáo.

```bat
java ApiClient fingerprint http://localhost:3000
java ApiClient verify USER_ID_NGUOI_KIA http://localhost:3000
```

Lệnh verify yêu cầu dán fingerprint nhận trực tiếp từ người kia và gõ yes. **Đừng chỉ copy giá trị lấy từ cùng server rồi gọi là đã xác minh.**

Kết bạn bằng web hoặc các lệnh `request`, `requests`, `accept` như bản trước, rồi:

```bat
java -Dfile.encoding=UTF-8 Receiver http://localhost:3000
java -Dfile.encoding=UTF-8 Sender USER_ID_NGUOI_NHAN "Xin chào, tin v2" http://localhost:3000
```

Sender phải giữ private signing key của chính tài khoản, nên cần mở vault. Web và Java v2 dùng chung recovery bundle: Java có thể khôi phục account web bằng recovery code và ngược lại. Các chương trình Java v1 cũ không gửi được tin mới vào server v2.

Không cần đặt SERUCHAT_PASSWORD/SERUCHAT_RECOVERY trong sử dụng bình thường. Các biến này chỉ hỗ trợ kiểm thử không tương tác; shell/history/environment cũng có thể lộ bí mật, nên không dùng để chứa recovery code thật lâu dài.

## 5. Giải thích thay đổi theo từng file

| File | Đã sửa/bổ sung | Lý do |
|---|---|---|
| client/js/security/protocol.js (mới) | Chuỗi canonical cho AAD/chữ ký, mapping DB -> envelope | Browser/Node/Java phải ký và kiểm tra cùng dữ liệu; tránh khác thứ tự JSON |
| client/js/security/transport.js (mới) | Fetch cùng origin; lấy/gửi CSRF token; nhận token mới sau login | Bảo vệ các POST, kể cả các lời gọi từ code mật mã gốc |
| client/js/security/keys.js (mới) | Recovery vault, tạo/khôi phục Ed25519, migrate backup v1, SHA-256 fingerprint, pin theo chủ tài khoản và peer | Tách backup khỏi mật khẩu server biết, xác minh khóa và không tự thay khóa |
| client/js/security/messages.js (mới) | Mã hóa hai bản với AAD; ký Ed25519; kiểm tra pin/chữ ký/AAD trước hiển thị | Ràng buộc nội dung và danh tính, phát hiện tin bị sửa hoặc sai chat |
| client/js/keyIntegration.js | Chuyển lifecycle sang SecureKeys.setup; khóa tác vụ đồng thời | Dùng bản mới mà giữ ba file mật mã gốc |
| client/js/app.js | UI xác minh, chặn gửi chưa verified, đọc v1/v2, kiểm tra cache theo toàn bộ row | Không hiển thị lại plaintext cache cho row đã bị sửa; giữ Yes/No |
| client/index.html | Recovery dialog, tải mã, fingerprint của mình/peer, xác nhận đối chiếu; password mới minlength | Các bước bảo mật có thể thực hiện trên giao diện |
| client/css/style.css | Panel khóa, fingerprint dài, dialog và checkbox | Nội dung mã dễ đọc, không tràn giao diện |
| server/src/middleware/security.js (mới) | CSP, headers, API no-store, CSRF token và kiểm tra constant-time | Giảm XSS/clickjacking và yêu cầu giả mạo từ trang khác |
| server/src/server.js | Gắn security middleware/endpoint CSRF; session pool dùng chung cấu hình TLS | Tất cả đường ghi, cả alias Java, đều đi qua CSRF |
| server/src/controllers/authController.js | Chính sách password đăng ký, token CSRF mới khi session regenerate | Giữ đăng nhập tài khoản cũ, tránh token/session cũ dùng lại sau login |
| server/src/controllers/keyController.js | Đăng ký X25519 + Ed25519; proof sở hữu khóa ký; bất biến public keys; backupVersion 2 | Từ chối key sai, thay identity và backup downgrade |
| server/src/controllers/messageController.js | Bắt buộc v2; sender theo session; kiểm tra receiver/member/accepted; xác minh signature; reject ID trùng | Server không phải giải mã nhưng vẫn kiểm tra cấu trúc/quyền/chữ ký |
| server/src/config/connection.js (mới) | Cấu hình MySQL tập trung, TLS kiểm tra chứng chỉ, chặn remote production không TLS | Pool dữ liệu và session cùng áp dụng TLS |
| server/src/config/database.js | Tạo pool từ connection.js | Tránh cấu hình khác nhau giữa hai pool |
| server/src/utils/api.js | Lỗi CSRF thành 403; log lỗi bất ngờ chỉ in mã/tên lỗi | Không in câu SQL hay nội dung lỗi có thể chứa dữ liệu |
| Quy tắc Git ignore | Loại file recovery/vault cá nhân khỏi commit | Tránh gửi dữ liệu mở khóa lên repository |
| server/package.json | Thêm override mysql2 cho express-mysql-session | Loại nhánh mysql2 cũ có cảnh báo, giữ tên/các dependency trực tiếp |
| server/package-lock.json | Cập nhật cây dependency theo override | npm ci cài đúng mysql2 đã vá, không downgrade session library |
| server/.env.example | DB_SSL, DB_SSL_CA_FILE; chỉ placeholder | Local không bắt buộc TLS, remote production có cấu hình rõ |
| database/schema.sql | Cột signing/backup version; protocol/recipient/signature/signing key cho tin | Schema mới có đủ trường v2, tin cũ vẫn được biểu diễn v1 |
| database/seruchat_full.sql | Tương đương schema.sql với tên DB máy bạn | Cài mới theo cấu hình hiện tại |
| database/upgrade-security.sql (mới) | Kiểm tra information_schema, thêm cột thiếu; cập nhật trạng thái block cũ | Migration chạy lại được, không xóa/ghi lại bản mã |
| encryption/SecurityV2.java (mới) | Vault mã hóa, Ed25519, fingerprint/pin, signed envelope và AAD | Java nói cùng giao thức với web; không tạo private key file rõ mới |
| encryption/ApiClient.java | CSRF HTTP, JSON đầy đủ cho inbox, lệnh fingerprint/verify, keys qua v2 | Không làm mất metadata/chữ ký khi chuyển inbox vào Receiver |
| encryption/Sender.java | Luồng gửi chuyển sang SecurityV2.send | Giữ hàm mật mã v1, tin mới dùng v2 |
| encryption/Receiver.java | Main giải mã qua SecurityV2; setup đã đăng ký bundle | Kiểm tra sender pin/signature trước decrypt, vẫn đọc v1 |
| server/test/protocol.test.js | Giữ hash và kiểm thử mật mã gốc; bỏ adapter test v1 đã không còn dùng | Kiểm chứng bảo toàn primitives gốc |
| server/test/security.test.js (mới) | Restore vault, secret sai, backup sửa, ciphertext/signature/context/pin sai | Kiểm thử các ranh giới bảo mật thực tế |
| server/test/integration.test.js | CSRF, key proof, v2, replay, authorization, races, bạn/chặn/xóa/hủy/retry | Kiểm thử server với MySQL thật |
| README.md | Điểm bắt đầu chạy/cập nhật v2 và liên kết hướng dẫn | Tránh chạy SQL tạo mới trên database cũ |
| docs/api.md | Contract CSRF, vault, canonical signature/AAD và alias Java v2 | Ba client phải thống nhất giao thức |
| docs/security-upgrade.md (mới) | Hướng dẫn Windows, từng file và giới hạn | Có thể đọc để chạy và viết báo cáo |
| docs/security-validation.md (mới) | Môi trường, kết quả test, audit và bài demo | Tách bằng chứng đã kiểm thử khỏi giả định |
| docs/chuc-nang-va-luong.md | Thêm cảnh báo nội dung v1 lịch sử và dẫn sang tài liệu v2 | Không nhầm backup/API cũ với bản mới |
| docs/upgrade-local.md | Thêm chỉ dẫn phiên bản mới | Migration bạn bè cũ vẫn giữ làm lịch sử |
| docs/validation.md | Thêm chỉ dẫn kiểm chứng v2 | Kết quả kiểm thử cũ được phân biệt |

Không thay controller user/friendship/conversation, middleware auth/rateLimit/debugRequests, transactions, tools/watchDatabase hay ba file crypto browser. Chức năng bạn bè và observer giữ nguyên.

## 6. Các giới hạn cần ghi đúng trong báo cáo

- Không có Double Ratchet/forward secrecy/post-compromise security. Khóa riêng dài hạn bị lộ có thể giải mã tin cũ tương ứng đã thu thập. Không tuyên bố ngang Signal.
- CSP không chống được server phát JavaScript độc hại hợp lệ cùng origin hoặc malware/extension trên máy. Mã khôi phục riêng giảm rủi ro server biết mật khẩu mở backup; không biến web thành hệ thống chống mọi server độc hại.
- Fingerprint chỉ có ý nghĩa khi đối chiếu qua kênh tin cậy độc lập. Pin là theo profile/thiết bị, không đồng bộ qua server. Đổi máy phải xác minh lại.
- Proof đăng ký chứng minh sở hữu private key Ed25519 mới, không phải chứng minh X25519 cũ hoặc danh tính ngoài đời. Lần nâng cấp đầu tiên vẫn dựa vào phiên đăng nhập và thiết bị giữ khóa cũ; account takeover trước khi thêm Ed25519 là giới hạn.
- Chữ ký Ed25519 có thể được bên thứ ba kiểm chứng; giao thức này không cung cấp tính phủ nhận như một số giao thức chat chuyên dụng.
- Tin v1 chưa có chữ ký/AAD; không dùng tin v1 để chứng minh xác thực người gửi. Server chỉ chấp nhận tin mới v2.
- Chặn ID trùng ngăn lưu lại cùng envelope qua API; không ngăn server độc hại hiển thị lại/giấu/xóa tin hoặc thao túng thứ tự/thời gian. Timestamp do server cung cấp không nằm trong chữ ký.
- API xác thực chữ ký và quyền; server không có AES key nên không tự kiểm tra được GCM tag hoặc hai bản mã có cùng plaintext. Client phát hiện không giải mã được.
- Password policy mới là mức cơ bản, không phải bộ kiểm tra toàn bộ mật khẩu bị lộ. Chưa có MFA, reset/change password, quản lý thiết bị, session dashboard hoặc xoay khóa identity.
- Rate limiter một process, polling/full history dành cho BTL nhỏ; không phải chống DDoS hay hệ thống nhiều server.
- Không có QR, chỉ có fingerprint đầy đủ. Không đưa secret/chữ ký riêng vào ảnh báo cáo; public fingerprint có thể chia sẻ.
