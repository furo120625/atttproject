> **Bản hiện tại là v2.** Các mô tả mật mã/backup/API v1 bên dưới được giữ làm lịch sử. Hướng dẫn chạy, chức năng bảo mật và thay đổi hiện tại: [security-upgrade.md](security-upgrade.md), [api.md](api.md), [security-validation.md](security-validation.md). Không dùng client v1 để gửi tin mới.

# Kiểm chứng bản ghép Seruchat

Thực hiện ngày 06/10/2026 trên môi trường kiểm thử tách biệt, không kết nối database của người dùng.

## Môi trường

- Node.js 24.19.0 và dependency giữ nguyên từ package-lock.json đã upload.
- MySQL 8.0.46, schema thật, MySQL session store thật; database test riêng được xóa sau test.
- OpenJDK 21.0.12; biên dịch ApiClient.java, Sender.java, Receiver.java thành công.
- Chromium headless 153 và Playwright trong môi trường kiểm thử. Các công cụ này không thêm vào dependency của dự án.

## Kết quả

`RUN_MYSQL_TESTS=1 npm test`: **12 passed, 0 failed, 0 skipped**. Bao gồm các test con HTTP/MySQL và test giao thức:

- Đăng ký, email trùng, kiểu dữ liệu sai và session login/logout.
- CSRF Origin không hợp lệ hoặc khác origin bị từ chối.
- Hai bên gửi lời mời đồng thời: một 201, một 409; không tạo hai dòng quan hệ.
- Không được kết bạn chính mình hoặc user không tồn tại.
- Người gửi lời mời và user thứ ba không được accept/reject; chỉ người nhận xử lý.
- Năm request tạo conversation đồng thời trả cùng một ID; có đúng hai thành viên.
- Public key chỉ được đăng ký cho chính session user; từ chối thay key khác.
- Đăng ký key Java không có backup, đăng ký key browser đủ backup, chỉ owner đọc backup.
- Người ngoài conversation không gửi/đọc được tin; giao tiếp API web và alias Java hoạt động.
- Block từ chối gửi tin, tạo chat và lời mời; lịch sử cũ còn đọc được.
- Spam trả 429; logout mất quyền truy cập session.
- Các file mã hóa browser giữ nguyên SHA-256 so với file upload.
- Mã hóa/giải mã tiếng Việt và emoji bằng nguyên code browser; sai private key hoặc sửa ciphertext bị từ chối.
- Adapter khóa không tạo khóa khi thiếu password/server lỗi; reuse khóa local và khôi phục backup giữ public key; mật khẩu sai không ghi đè khóa.

## Kiểm thử trình duyệt và Java qua HTTP/MySQL

Chạy thêm với các profile trình duyệt độc lập và chương trình Java thật:

- Đăng ký từ giao diện, đăng nhập, tạo key và backup.
- Tìm user theo ID, gửi lời mời, accept, mở chat.
- Chat web hai chiều: người gửi đọc bản self, người nhận giải mã đúng tiếng Việt/emoji.
- Username có chuỗi HTML được hiển thị như text; không sinh phần tử img.
- Reload trang dùng lại khóa IndexedDB, đọc lại lịch sử.
- Profile mới đăng nhập cùng account khôi phục backup bằng mật khẩu và đọc lịch sử; public key không thay đổi.
- **Web → Java Receiver:** Receiver giải mã đúng nội dung tiếng Việt.
- **Java Sender → web:** web giải mã đúng tin Java gửi.
- Block qua giao diện và gửi trực tiếp qua API sau block bị từ chối 403.
- Không có pageerror JavaScript trong các luồng được kiểm tra.
- Migration từ schema 7 bảng đã gửi trước chạy thành công trên database test trước khi các luồng trên chạy.

## Bảo toàn mã hóa Java

Đã đối chiếu từng body phương thức với nội dung Java được cung cấp trong Markdown sau khi bỏ escape Markdown và chuẩn hóa whitespace:

- Sender: generateKeyPair, deriveKey, x25519, hkdf, aesGcmEncrypt, exportPublicKey.
- Receiver: x25519, hkdf, aesGcmDecrypt, receiveMessage.

Không thay đổi body các phương thức này. SHA-256 của các body đã chuẩn hóa và hash của ba file browser nằm trong `crypto-preservation.json`. Thay đổi Java nằm ở phần HTTP/session, lưu key local, JSON/CLI và gọi lại các hàm có sẵn để tạo bản mã self.

## Giới hạn kiểm chứng

- Chưa chạy trực tiếp trên máy Windows/MySQL của người dùng; đường dẫn và credentials trong README cần cấu hình theo máy đó.
- Chưa kiểm thử triển khai production với HTTPS/reverse proxy hay nhiều tiến trình server.
- Chưa bổ sung unblock, re-request sau rejected hoặc block độc lập hai chiều; giữ chính sách nêu trong README.
- Rate limit một tiến trình, lịch sử/inbox tải đầy đủ; chưa kiểm thử tải lớn.
- Java Receiver giữ khóa riêng local; chưa có luồng mở backup private key browser trên Java. Không tự thay key đã đăng ký.
- Các bài kiểm tra xác nhận việc ghép và hành vi đã nêu; không phải audit mật mã hay bổ sung thuộc tính bảo mật mới cho giao thức.


## Bản nâng cấp chức năng và quan sát, 07/10/2026

- API/MySQL/giao thức/log: **17 passed, 0 failed, 0 skipped** trên database kiểm thử riêng.
- Bỏ chặn chỉ dành cho người đã chặn; accepted được phục hồi. Người lạ/lời mời pending không tự thành accepted khi bỏ chặn.
- Xóa bạn giữ chat và lịch sử; gửi mới bị từ chối. Hủy lời mời chỉ người gửi được làm; rejected gửi lại được; kết bạn lại dùng đúng chat cũ.
- Log theo dõi cả thành công/lỗi HTTP, opt-in; test xác nhận không in body, cookie, query string, UUID/giá trị người dùng hoặc mật khẩu.
- Observer MySQL đọc snapshot/bản mã, thấy tin mới, không thay dữ liệu và dừng sạch khi Ctrl+C.
- Migration thử trên schema cũ với user, chat, tin mã hóa và quan hệ bị chặn đã tồn tại: giữ nguyên tin/user, thêm cột và cho phép khôi phục đúng bạn cũ; người lạ không được tự kết bạn.
- Chromium: Yes/No cho đăng ký/đăng nhập, gửi lời mời/hủy/reject/accept, gửi tin, block/unblock/remove. No không thực hiện thao tác được chọn, bản nháp tin được giữ.
- UI: bỏ chặn phục hồi bạn; xóa bạn còn lịch sử và khóa ô gửi; kết bạn lại nhắn tiếp được; không có pageerror.
- Reload và thiết bị mới vẫn dùng/khôi phục khóa cũ. Giao tiếp Java <-> browser và tiếng Việt tiếp tục giải mã đúng.
- Ba file crypto browser, Java và dependencies không bị thay bởi bản nâng cấp này.

Giới hạn mới: mô hình chặn lưu một blocked_by cho mỗi cặp. Migration suy ra accepted cho block cũ có chat dựa trên bản ứng dụng trước đó chưa có xóa bạn; nếu database đã được chỉnh tay/nhập từ hệ khác cần kiểm tra quan hệ trước khi áp dụng. Chưa chạy trực tiếp trên máy Windows của người dùng.
