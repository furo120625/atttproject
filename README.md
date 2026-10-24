# Seruchat v2 — BTL ATTT chạy local

Node.js/Express + MySQL + web + Java. Giữ X25519, HKDF-SHA256, AES-256-GCM; bổ sung Ed25519, AAD, xác minh fingerprint, recovery backup riêng, CSRF/CSP và TLS MySQL tùy chọn. Không cần MongoDB hoặc cron job.

**Đang có D:\seruchat và database seruchat_full:** đọc [docs/security-upgrade.md](docs/security-upgrade.md). Copy ZIP cập nhật, giữ .env/keys/node_modules, chạy database/upgrade-security.sql, npm ci rồi npm start rồi Ctrl+F5. Không chạy schema tạo mới trên dữ liệu cũ. Tài khoản cũ giữ X25519 và tin cũ, đăng nhập lần đầu bản mới sẽ tạo recovery code và signing key.

**Cài mới:** chạy database/seruchat_full.sql; trong server, copy .env.example sang .env, điền MySQL và SESSION_SECRET ngẫu nhiên >=32 ký tự; npm ci; npm start. Đã kiểm thử Node.js 24, MySQL 8, JDK21 và Chromium có X25519/Ed25519 Web Crypto.

```bat
cd /d D:\seruchat\server
npm start
```

Mở http://localhost:3000. Hai người dùng ở profile khác nhau (thường/ẩn danh). Lưu riêng recovery code của từng người, đối chiếu fingerprint trước gửi tin. Mật khẩu đăng nhập không mở được backup v2. Mất cả khóa local và recovery code thì không đọc lại được tin.

Hướng dẫn Java, từng file sửa, migration, luồng, kiểm thử và giới hạn: [docs/security-upgrade.md](docs/security-upgrade.md), [docs/security-validation.md](docs/security-validation.md), [docs/api.md](docs/api.md).

```bat
set DEBUG_API=1
npm start
```

Terminal khác: `node tools/watchDatabase.js`. Observer chỉ đọc, hiện số dòng và preview bản mã; giữ thư mục server đúng cấu hình .env.

`npm test` chạy unit; `set RUN_MYSQL_TESTS=1` rồi `npm test` chạy thêm kiểm thử MySQL bằng database tạm, không sửa DB ứng dụng. Tài khoản test cần quyền CREATE/DROP database.

Không thêm thư viện mới; đã cập nhật dependency lock bằng override mysql2 cho session library; ba file crypto browser gốc giữ nguyên byte. Các bộ client/server mới phải nâng cùng nhau: server từ chối gửi tin v1 mới, vẫn trả lịch sử v1. Chưa có Double Ratchet, MFA hoặc bảo vệ trước server phát JavaScript độc hại. Không khẳng định mức an toàn tương đương dịch vụ chat đã được đánh giá chuyên nghiệp.
