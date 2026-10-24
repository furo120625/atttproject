# API Seruchat v2

Client web và Java cùng origin/session. GET `/api/security/csrf` tạo/lấy CSRF token. Tất cả POST phải gửi `X-CSRF-Token` và cookie session. Login tạo session mới và trả token mới qua header `X-CSRF-Token`. Các API sau login cần xác thực.

## Tài khoản/quan hệ

- POST `/api/auth/register`: username, email, password (>=12 ký tự cho account mới).
- POST `/api/auth/login`: email, password; GET `/api/auth/me`; POST `/api/auth/logout`.
- GET `/api/users/:id`: user + relationship.
- POST `/api/friendships/request|block|unblock|remove`: targetUserId.
- GET `/api/friendships`, `/requests`, `/outgoing`, `/blocked`.
- POST `/api/friendships/:id/accept|reject|cancel`.
- POST `/api/conversations`: friendId; GET `/api/conversations`.

## Khóa

GET `/api/keys/public/:userId` -> publicKey (X25519 SPKI Base64), signingPublicKey (Ed25519 SPKI Base64 hoặc null cho key v1), backupVersion, algorithm.

POST `/api/keys/public` yêu cầu publicKey, signingPublicKey, backupVersion **number 2**, encryptedPrivateKey, salt (16 byte), iv (12 byte), keyProof (64 byte signature Base64). Không gửi recovery code. Proof ký UTF-8 của chuỗi `seruchat-key-v2|userId|publicKey|signingPublicKey|encryptedPrivateKey|salt|iv`. Khóa X25519 và signing key đã đăng ký không thay được bằng key khác.

GET `/api/keys/private` chỉ trả backup của session owner: encryptedPrivateKey, salt, iv, backupVersion. Backup v1 dùng PBKDF2-SHA256/password; v2 dùng random recovery32 + HKDF-SHA256(salt, info=`seruchat-recovery-v2|userId`) tạo AES-256-GCM key. Plain bundle JSON: x=PKCS8 X25519 Base64, s=PKCS8 Ed25519 Base64. Vault AAD UTF-8: `seruchat-key-bundle-v2|userId|publicKey|signingPublicKey`.

## Tin mới

POST `/api/messages` chỉ nhận v2:

```
version: number 2
id, conversationId, senderId, recipientId: UUID lowercase
nonce, ciphertext, senderPublicKey: recipient ciphertext, IV, ephemeral SPKI
selfNonce, selfCiphertext, selfPublicKey: self ciphertext, IV, ephemeral SPKI
signature: Ed25519 signature Base64 64 byte
```

AAD recipient/self UTF-8: `seruchat-aad-v2|id|conversationId|senderId|recipientId|recipient` hoặc kết thúc bằng `self`.

Chữ ký ký UTF-8 theo thứ tự cố định: `seruchat-signature-v2|id|conversationId|senderId|recipientId|nonce|ciphertext|senderPublicKey|selfNonce|selfCiphertext|selfPublicKey`. UUID/Base64 không có ký tự `|`. Không ký JSON tự do và không gửi thêm plaintext. GCM tag 16 byte nối cuối mỗi ciphertext.

X25519 shared secret -> HKDF-SHA256(salt 32 zero bytes, info e2ee-chat-v1) -> AES256. Giữ primitives v1, thêm AAD/signature cho v2. Có cặp ephemeral riêng cho mỗi bản recipient/self.

Server kiểm tra session sender, recipient/member/chat/accepted, cấu trúc và chữ ký với key đăng ký. ID trùng ->409; v1 gửi mới ->400; không là thành viên/không là bạn/chặn ->403. GCM tag do client kiểm tra vì server không có khóa.

GET `/api/messages/:conversationId` trả row đầy đủ, gồm protocol_version, recipient_id, signature, sender_signing_key cùng trường cũ. Tin v1 có các trường v2 null và chỉ được đọc, gắn nhãn legacy.

## Java alias

GET/POST `/users/:id/public-key` tương đương API keys, vẫn session-owner và CSRF khi ghi. POST `/messages` nhận cùng envelope v2. GET `/messages/:id` chỉ inbox owner, trả row đầy đủ; 204 nếu rỗng. Sender Java v1 cũ không gửi được vào server v2.

## Fingerprint

SHA-256 UTF-8 của `seruchat-fingerprint-v2|userId|publicKey|signingPublicKey`, lowercase hex 64 ký tự, chia 8 nhóm 8 để đọc. Client tự tính; server không trả fingerprint được coi là tin cậy. Pin trên thiết bị sau khi đối chiếu ngoài ứng dụng; không lưu pin trên server.
