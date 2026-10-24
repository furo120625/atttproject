import javax.crypto.Cipher;

import javax.crypto.KeyAgreement;

import javax.crypto.Mac;

import javax.crypto.spec.GCMParameterSpec;

import javax.crypto.spec.SecretKeySpec;

import java.io.IOException;

import java.net.URI;

import java.net.URLEncoder;

import java.net.http.HttpClient;

import java.net.http.HttpRequest;

import java.net.http.HttpResponse;

import java.nio.charset.StandardCharsets;

import java.security.GeneralSecurityException;

import java.security.KeyFactory;

import java.security.KeyPair;

import java.security.KeyPairGenerator;

import java.security.PrivateKey;

import java.security.PublicKey;

import java.security.SecureRandom;

import java.security.spec.X509EncodedKeySpec;

import java.util.Base64;

import java.util.regex.Matcher;

import java.util.regex.Pattern;

/**

 * PHẦN CỦA DŨNG: luồng GỬI của nhắn tin mã hóa đầu cuối. Chỉ 1 file, không cần thư viện ngoài.

 * Cần JDK 21; giao thức v2 nằm trong SecurityV2.java.

 *

 * Giao thức (Quân phải làm khớp y hệt ở phía nhận):

 *   X25519 -> HKDF-SHA256 (salt rỗng, info = "e2ee-chat-v1", 32 byte) -> AES-256-GCM (IV 12 byte, tag 128 bit)

 *   Khóa công khai: SPKI DER -> Base64

 *   Tag GỘP vào cuối ciphertext (đây là cách Java làm sẵn), gói tin chỉ có 3 trường:

 *   iv, ciphertext (đã kèm tag), senderPublicKey  (+ "to" để server biết chuyển cho ai)

 *

 * API của Phong (PHẢI thống nhất với Phong, sửa lại ở phần CẤU HÌNH nếu khác):

 *   GET  {serverUrl}/users/{tên}/public-key  ->  {"publicKey":"<Base64>"}

 *   POST {serverUrl}/messages   body: {"to":"...","iv":"...","ciphertext":"...","senderPublicKey":"..."}

 *

 * Chạy thử:

 *   javac -encoding UTF-8 Sender.java

 *   java -Dstdout.encoding=UTF-8 Sender quan "Xin chào Quân" http://localhost:3000

 *   Tin có dấu bị vỡ chữ trên terminal? Truyền "-" rồi pipe tin vào (đọc bằng UTF-8):

 *   echo Xin chào Quân | java -Dstdout.encoding=UTF-8 Sender quan - http://localhost:3000

 */

public class Sender {

    static String serverUrl = "http://localhost:3000";

    static final String PUBLIC_KEY_PATH = "/users/%s/public-key";   // %s = tên người nhận

    static final String SEND_PATH = "/messages";

    // ===================== HẰNG SỐ MÃ HÓA (không đổi, phải khớp với Quân) =====================

    private static final String HKDF_INFO = "e2ee-chat-v1";

    private static final int IV_BYTES = 12;

    private static final int TAG_BITS = 128;

    private static final SecureRandom RNG = new SecureRandom();

    private static final HttpClient HTTP = ApiClient.HTTP;

    // ==================================================================

    // BƯỚC 1: Lấy khóa công khai (dài hạn) của người nhận từ Phong

    // ==================================================================

    static String fetchRecipientPublicKey(String recipient) throws IOException, InterruptedException {

        String url = serverUrl + String.format(PUBLIC_KEY_PATH,

                URLEncoder.encode(recipient, StandardCharsets.UTF_8));

        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).GET().build();

        HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());

        if (res.statusCode() != 200) {

            throw new IOException("Không lấy được khóa của '" + recipient + "' (HTTP " + res.statusCode() + ")");

        }

        // Server trả JSON {"publicKey":"..."}; lấy giá trị ra bằng regex (khỏi cần thư viện JSON)

        Matcher m = Pattern.compile("\"publicKey\"\\s*:\\s*\"([^\"]+)\"").matcher(res.body());

        if (!m.find()) throw new IOException("Phản hồi của server không có trường publicKey");

        return m.group(1);

    }

    // ==================================================================

    // BƯỚC 2: Sinh cặp khóa X25519 dùng 1 lần (mỗi tin nhắn một cặp mới)

    // ==================================================================

    static KeyPair generateKeyPair() throws GeneralSecurityException {

        return KeyPairGenerator.getInstance("X25519").generateKeyPair();

    }

    // ==================================================================

    // BƯỚC 3: deriveKey = X25519 (ra khóa chung) rồi HKDF (ra khóa AES)

    // ==================================================================

    static byte[] deriveKey(PrivateKey myPrivate, String recipientPublicKeyB64) throws GeneralSecurityException {

        PublicKey theirPublic = KeyFactory.getInstance("X25519").generatePublic(

                new X509EncodedKeySpec(Base64.getDecoder().decode(recipientPublicKeyB64)));

        return hkdf(x25519(myPrivate, theirPublic));

    }

    /** X25519: khóa riêng của mình + khóa công khai của người kia = khóa chung (hai bên ra giống nhau). */

    static byte[] x25519(PrivateKey myPrivate, PublicKey theirPublic) throws GeneralSecurityException {

        KeyAgreement ka = KeyAgreement.getInstance("X25519");

        ka.init(myPrivate);

        ka.doPhase(theirPublic, true);

        return ka.generateSecret();

    }

    /** HKDF-SHA256 (RFC 5869): biến khóa chung thành khóa AES 32 byte. Không dùng thẳng khóa chung. */

    static byte[] hkdf(byte[] sharedSecret) throws GeneralSecurityException {

        Mac mac = Mac.getInstance("HmacSHA256");

        mac.init(new SecretKeySpec(new byte[32], "HmacSHA256"));   // Extract (salt rỗng = 32 byte 0)

        byte[] prk = mac.doFinal(sharedSecret);

        mac.init(new SecretKeySpec(prk, "HmacSHA256"));            // Expand (1 block = 32 byte)

        mac.update(HKDF_INFO.getBytes(StandardCharsets.UTF_8));

        mac.update((byte) 1);

        return mac.doFinal();

    }

    // ==================================================================

    // BƯỚC 4: Mã hóa tin nhắn bằng AES-256-GCM

    // ==================================================================

    /** Kết quả mã hóa. ciphertext ĐÃ GỒM tag ở 16 byte cuối. */

    static class Encrypted {

        final byte[] iv;

        final byte[] ciphertext;

        Encrypted(byte[] iv, byte[] ciphertext) { this.iv = iv; this.ciphertext = ciphertext; }

    }

    static Encrypted aesGcmEncrypt(byte[] aesKey, String message) throws GeneralSecurityException {

        byte[] iv = new byte[IV_BYTES];

        RNG.nextBytes(iv);                                         // IV mới cho MỖI tin, không bao giờ dùng lại

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");

        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(TAG_BITS, iv));

        byte[] ciphertext = cipher.doFinal(message.getBytes(StandardCharsets.UTF_8));  // Java tự nối tag vào cuối

        return new Encrypted(iv, ciphertext);

    }

    // ==================================================================

    // BƯỚC 5: exportPublicKey + gom JSON + gọi API gửi Phong

    // ==================================================================

    /** Khóa công khai -> chuỗi Base64 (SPKI DER) để nhét vào gói tin. */

    static String exportPublicKey(PublicKey publicKey) {

        return Base64.getEncoder().encodeToString(publicKey.getEncoded());

    }

    static String buildJson(String recipient, Encrypted enc, String senderPublicKeyB64) {

        Base64.Encoder b64 = Base64.getEncoder();

        return "{\"to\":\""              + jsonEscape(recipient)             + "\","

             + "\"iv\":\""               + b64.encodeToString(enc.iv)         + "\","

             + "\"ciphertext\":\""       + b64.encodeToString(enc.ciphertext) + "\","

             + "\"senderPublicKey\":\""  + senderPublicKeyB64                 + "\"}";

    }

    /** Escape tối thiểu cho chuỗi đưa vào JSON (Base64 thì không cần, chỉ tên người nhận cần). */

    private static String jsonEscape(String s) {
        return ApiClient.quote(s).substring(1, ApiClient.quote(s).length() - 1);
    }

    static void postToServer(String json) throws IOException, InterruptedException {

        HttpRequest req = HttpRequest.newBuilder(URI.create(serverUrl + SEND_PATH))

                .header("Content-Type", "application/json")

                .POST(HttpRequest.BodyPublishers.ofString(json))

                .build();

        HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());

        if (res.statusCode() / 100 != 2) {

            throw new IOException("Server từ chối gói tin (HTTP " + res.statusCode() + "): " + res.body());

        }

    }

    // ==================================================================

    // HÀM TỔNG: chạy đủ 5 bước. Frontend chỉ cần gọi hàm này khi bấm "Gửi".

    // ==================================================================

    public static void sendMessage(String recipient, String message) throws Exception {

        SecurityV2.send(recipient, message);
    }

    // ==================================================================

    // Chạy thử từ terminal (xóa main này khi ghép vào frontend)

    // ==================================================================

    public static void main(String[] args) {

        if (args.length < 2) {
            System.out.println("Usage: java Sender <recipientUserId> \"message\" [http://localhost:3000]");
            return;
        }
        String recipient = args[0];

        String message   = args.length > 1 ? args[1] : "Xin chào Quân";

        if (args.length > 2) serverUrl = args[2];

        // Tin tiếng Việt truyền qua đối số dòng lệnh có thể vỡ chữ (tùy bảng mã của terminal).

        // Để tránh, truyền "-" rồi gõ/pipe tin nhắn vào stdin: luôn đọc bằng UTF-8.

        if (message.equals("-")) {

            try {

                message = new String(System.in.readAllBytes(), StandardCharsets.UTF_8).strip();

            } catch (IOException e) {

                System.out.println("Không đọc được tin nhắn: " + e.getMessage());

                return;

            }

        }

        try {

            ApiClient.login(serverUrl);
            sendMessage(recipient, message);

            System.out.println("Đã gửi tin mã hóa cho '" + recipient + "' qua " + serverUrl);

        } catch (Exception e) {

            System.out.println("Gửi thất bại: " + e.getMessage());

        }

    }

}