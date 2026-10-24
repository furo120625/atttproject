# Kiểm chứng bản bảo mật v2

Ngày 07/10/2026. Môi trường kiểm thử: Node.js 24, MySQL 8.0.46, JDK 21, Chromium 153. Các kiểm thử dùng database tạm riêng, không dùng dữ liệu trên máy Windows của người dùng.

## Kết quả tự động

- `npm test` với `RUN_MYSQL_TESTS=1`: **15 kiểm thử, 15 đạt, 0 lỗi, 0 bỏ qua**.
- Kiểm tra hash: ba file crypto browser giữ nguyên byte; dependency trực tiếp giữ nguyên; lock cập nhật để loại mysql2 cũ trong session library.
- Unit: tiếng Việt/emoji recipient+self; sai private key; sửa ciphertext/signature/self ciphertext; sửa AAD ngay cả khi ký lại envelope; sai context; sender chưa pin hoặc đổi key.
- Backup: khôi phục X25519+Ed25519; mật khẩu đăng nhập không mở được vault v2; recovery code sai, backup sửa hoặc đổi user context bị từ chối.
- API/MySQL: CSRF bắt buộc; token thay sau login; weak registration bị từ chối; key proof; owner-only backup; immutable keys; signed v2; chống gửi v1; ID trùng/replay; giả sender; recipient ngoài chat; đọc inbox/chat trái quyền.
- Quan hệ: request race, atomic conversation reuse, block/unblock/remove giữ lịch sử, chỉ blocker unblock, cancel/reject/retry/re-friend, nonfriend unblock không thành bạn, limiter 429, logout hết quyền.

## Kiểm thử trình duyệt và Java

Đã chạy hai profile browser độc lập và các profile mới để khôi phục. Script browser kiểm thử nằm ngoài dependency dự án; không yêu cầu cài thêm Playwright để chạy ứng dụng.

1. Tạo database từ schema bản trước, seed account/backup mật khẩu/tin v1, chạy migration v2 **hai lần**. Không mất tài khoản/public key/ciphertext.
2. Đăng nhập bằng mật khẩu cũ dưới 12 ký tự vẫn hoạt động; giữ X25519 cũ, tạo Ed25519 và backup bằng recovery riêng.
3. Lịch sử v1 tiếng Việt vẫn giải mã, hiển thị nhãn legacy.
4. Chưa đối chiếu fingerprint: nút gửi bị khóa. Hai phía đối chiếu rồi gửi v2 tiếng Việt/emoji thành công.
5. Chọn No khi gửi: giữ bản nháp và số dòng messages không tăng.
6. Sửa signature của row đã được hiển thị: plaintext cache bị kiểm tra lại và tin bị báo không hợp lệ; khôi phục row ban đầu thì đọc lại được.
7. Sửa signing key của peer trực tiếp trong DB để mô phỏng key change: client phát hiện fingerprint đổi và khóa gửi.
8. Reload profile cũ: dùng lại khóa. Profile mới: mở bằng recovery code, fingerprint giữ nguyên; phải pin peer lại trên profile mới.
9. Java khôi phục backup account web, fingerprint khớp. Java -> web và web -> Java đều kiểm tra chữ ký và AAD rồi giải mã đúng.
10. Java vault trên đĩa không chứa recovery code, không tạo private.pkcs8 rõ; recovery code sai thất bại.
11. Tài khoản web mới: No trong recovery dialog hủy publish; logout rồi login lại có token CSRF đúng và setup tiếp được.
12. Java dùng bộ PKCS8/SPKI cũ: nâng lên vault mã hóa, giữ X25519, xóa file cũ sau thành công; browser khôi phục được bundle do Java tạo và fingerprint khớp.
13. Không có pageerror JavaScript trong các trang được theo dõi; Chrome chạy với web security bật khi kiểm thử.

Đây là kiểm thử chức năng/ranh giới bảo mật của prototype, không phải chứng nhận, pentest toàn diện hoặc bằng chứng chống server/thiết bị bị kiểm soát.

## Tự demo để làm báo cáo

- Mở hai profile; chụp màn hình public fingerprint và trạng thái verified. Không chụp recovery code.
- Gửi một tin tiếng Việt; xem messages tăng và chỉ có ciphertext trong Workbench/observer.
- Trong database thử nghiệm riêng, sửa 1 ký tự signature/ciphertext rồi refresh: phải không hiển thị plaintext của tin bị sửa. Giữ bản gốc để khôi phục; không làm trên dữ liệu cần giữ.
- Dùng tài khoản thứ ba gọi GET chat khác: nhận 403.
- POST thiếu X-CSRF-Token: nhận 403. Gửi cùng envelope/ID hai lần: lần hai 409.
- Mở profile mới, nhập recovery code sai: không tạo khóa thay thế. Nhập đúng: fingerprint cũ khôi phục; đối chiếu peer lại.
- Trình bày giới hạn trong security-upgrade.md: chưa ratchet/forward secrecy, tin v1 chưa xác thực, không chống JavaScript độc hại do server phát.

## Kiểm tra dependency

Audit trước nâng cấp phát hiện 2 mục cảnh báo trong nhánh express-mysql-session -> mysql2 cũ. Thêm override để nhánh này dùng bản mysql2 của dependency trực tiếp hiện tại (3.24.4), không thêm thư viện và không downgrade express-mysql-session. Cài lại bằng npm ci rồi audit/kiểm thử lại. Kết quả `npm ls mysql2`: mysql2@3.24.4 được dedupe cho cả ứng dụng và session library. `npm audit --omit=dev --json`: **0 cảnh báo đã biết** tại thời điểm kiểm tra.

Advisory: https://github.com/advisories/GHSA-3f6p-5ww8-9rcr và https://github.com/advisories/GHSA-rgwj-5xj2-c3m3. Audit chỉ bao phủ các cảnh báo có trong cơ sở dữ liệu tại thời điểm kiểm tra, không bảo đảm phần mềm không có lỗ hổng.
