> **Bản hiện tại là v2.** Các mô tả mật mã/backup/API v1 bên dưới được giữ làm lịch sử. Hướng dẫn chạy, chức năng bảo mật và thay đổi hiện tại: [security-upgrade.md](security-upgrade.md), [api.md](api.md), [security-validation.md](security-validation.md). Không dùng client v1 để gửi tin mới.

# Cập nhật Seruchat đang chạy trên máy bạn

Bản này thêm xóa bạn, bỏ chặn, hủy lời mời, gửi lại lời mời bị từ chối, xác nhận Yes / No, log API và quan sát database. Các file mã hóa, key local, thư viện và bản mã tin nhắn được giữ nguyên.

## Máy đã có database seruchat_full với 7 bảng

1. Tải `seruchat-update.zip`.
2. Trong cửa sổ chạy server, nhấn Ctrl+C và đợi về dấu nhắc `D:\seruchat\server>`.
3. Giữ một bản sao thư mục `D:\seruchat` hiện có. Giải nén ZIP cập nhật vào `D:\seruchat`; chấp nhận thay các file code trùng tên. ZIP chứa `client`, `server`, `database`, `docs` và README; không chứa .env, node_modules, keys hay mật khẩu thật.
4. Mở MySQL Workbench trong kết nối đã đăng nhập. File > Open SQL Script, mở `D:\seruchat\database\upgrade-friends.sql` rồi Ctrl+Shift+Enter. Đây là migration dùng cho bản database 7 bảng của dự án trước khi thêm bỏ chặn. Chạy MỘT LẦN; không chạy lại schema tạo bảng. Nó thêm `blocked_previous_status`, giữ users/keys/messages/conversations và lưu trạng thái accepted cho các quan hệ đang bị chặn mà đã có chat trong bản cũ.
5. Kiểm tra bằng `SHOW COLUMNS FROM seruchat_full.friendships LIKE 'blocked_previous_status';`. Phải có một dòng. Nếu báo Duplicate column thì cột đã được thêm; kiểm tra cột và phần Action Output trước khi chạy thêm. Nếu lỗi khác, dừng ở bước SQL để xử lý, không xóa database.
6. .env hiện có tiếp tục dùng DB_NAME=seruchat_full và mật khẩu MySQL của bạn. Không cần chạy lại npm ci vì dependencies không đổi.
7. Trong CMD:

```bat
cd /d D:\seruchat\server
set DEBUG_API=1
npm start
```

8. Mở http://localhost:3000, Ctrl+F5 để tải lại HTML/CSS/JS. Session và IndexedDB cũ được dùng lại. Vào Người đã chặn > Bỏ chặn > Yes. Nếu hai bên đã có chat trong bản cũ, tình bạn được phục hồi và có thể gửi tin tiếp.

Nếu đã tự sửa server hoặc giao diện sau khi tải bản ghép, kiểm tra bản sao của bạn trước khi thay file. Dữ liệu MySQL nằm ngoài ZIP và không được xóa bởi bản cập nhật.

## Máy mới, chưa có bảng

Dùng `seruchat-complete.zip` mới nhất. Giải nén vào D: để có D:\seruchat. Chạy `database/seruchat_full.sql` thay cho migration. Nó đã có cột mới; không chạy upgrade-friends.sql thêm lần nữa. Cấu hình .env với DB_NAME=seruchat_full, DB_* đúng MySQL và SESSION_SECRET ngẫu nhiên ít nhất 32 ký tự, sau đó npm ci và npm start như README.

## Quy tắc chức năng

- Người nhận có thể chấp nhận/từ chối; người gửi có thể hủy lời mời đang pending. Lời mời bị từ chối được phép gửi lại, chịu giới hạn tốc độ.
- Xóa bạn xóa dòng accepted trong friendships, không xóa users, khóa, conversation hay messages. Hai bên vẫn đọc lịch sử; cần accepted lại để gửi tin mới. Chat cũ được dùng lại khi kết bạn lại.
- Chặn chặn gửi mới/lời mời ở cả hai chiều. Chỉ người đã chặn mới được bỏ chặn; người bị chặn không thể tự vượt chặn. Với một cặp, mô hình hiện tại lưu một blocked_by.
- Bỏ chặn một người từng là bạn khôi phục accepted. Bỏ chặn người chưa là bạn hoặc lời mời chưa được chấp nhận không tự kết bạn; cần gửi lời mời mới.
- Hộp Yes / No áp dụng cho các thao tác chủ động thay đổi trạng thái: tạo tài khoản, đăng nhập/đăng xuất, gửi lời mời, accept/reject/cancel, mở/tạo chat từ danh sách bạn, xóa bạn, chặn/bỏ chặn và gửi tin. No/Esc hủy thao tác. Mở lịch sử chat, tìm user, sao chép ID và tự lấy dữ liệu là thao tác đọc, không hỏi lại.
- Phần API vẫn kiểm tra session và quyền dù ai đó gọi API trực tiếp, không dựa vào hộp xác nhận để cấp quyền.

## Quan sát hoạt động

Trong CMD thứ hai:

```bat
cd /d D:\seruchat\server
node tools/watchDatabase.js
```

Xem chi tiết trong docs/terminal-debug.md. Xem chức năng từng file và luồng dữ liệu trong docs/chuc-nang-va-luong.md.
