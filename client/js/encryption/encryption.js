async function deriveEncryptionKey(
    recipientPublicKey,
    senderPrivateKey
) {
    const sharedSecret =
        await crypto.subtle.deriveBits(
            {
                name: "X25519",
                public: recipientPublicKey
            },
            senderPrivateKey,
            256
        );
    const hkdfKey =
        await crypto.subtle.importKey(
            "raw",
            sharedSecret,
            "HKDF",
            false,
            ["deriveKey"]
        );
    return crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(32),
            info: new TextEncoder().encode(
                "e2ee-chat-v1"
            )
        },
        hkdfKey,
        {
            name: "AES-GCM",
            length: 256
        },
        false,
        ["encrypt"]
    );
}
async function encryptForRecipient(
    message,
    recipientPublicKey
) {
    const senderKeyPair =
        await crypto.subtle.generateKey(
            {
                name: "X25519"
            },
            true,
            ["deriveBits"]
        );
    const aesKey =
        await deriveEncryptionKey(
            recipientPublicKey,
            senderKeyPair.privateKey
        );
    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );
    const plaintext =
        new TextEncoder().encode(message);
    const ciphertext =
        await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv,
                tagLength: 128
            },
            aesKey,
            plaintext
        );
    const senderPublicKey =
        await crypto.subtle.exportKey(
            "spki",
            senderKeyPair.publicKey
        );
    return {
        iv,
        ciphertext: new Uint8Array(ciphertext),
        senderPublicKey
    };
}
async function encryptForSelf(
    message,
    myPublicKey
) {
    const senderKeyPair =
        await crypto.subtle.generateKey(
            {
                name: "X25519"
            },
            true,
            ["deriveBits"]
        );
    const aesKey =
        await deriveEncryptionKey(
            myPublicKey,
            senderKeyPair.privateKey
        );
    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );
    const plaintext =
        new TextEncoder().encode(message);
    const ciphertext =
        await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv,
                tagLength: 128
            },
            aesKey,
            plaintext
        );
    const senderPublicKey =
        await crypto.subtle.exportKey(
            "spki",
            senderKeyPair.publicKey
        );
    return {
        iv,
        ciphertext: new Uint8Array(ciphertext),
        senderPublicKey
    };
}
function arrayBufferToBase64(buffer) {
    return btoa(
        String.fromCharCode(
            ...new Uint8Array(buffer)
        )
    );
}
async function sendEncryptedMessage(
    conversationId,
    recipientUserId,
    message
) {
    // 1. Lấy public key của người nhận
    const keyResponse = await fetch(
        `/api/keys/public/${recipientUserId}`
    );
    const keyData = await keyResponse.json();
    if (!keyResponse.ok) {
        throw new Error(keyData.message);
    }
    // 2. Chuyển public key của người nhận
    // từ Base64 → CryptoKey
    const publicKeyData = Uint8Array.from(
        atob(keyData.publicKey),
        char => char.charCodeAt(0)
    );
    const recipientPublicKey =
        await crypto.subtle.importKey(
            "spki",
            publicKeyData,
            {
                name: "X25519"
            },
            false,
            []
        );
    // 3. Lấy key pair cố định của chính mình
    const myUserId =
        currentUserId.textContent.trim();
    if (!myUserId) {
        throw new Error(
            "Current user ID is missing"
        );
    }
    const myKeyPair =
        await getOrCreateKeyPair(myUserId);
    // 4. Mã hóa message cho người nhận
    const recipientEncrypted =
        await encryptForRecipient(
            message,
            recipientPublicKey
        );
    // 5. Mã hóa thêm một bản cho chính mình
    const selfEncrypted =
        await encryptForSelf(
            message,
            myKeyPair.publicKey
        );
    // 6. Chuyển dữ liệu người nhận → Base64
    const nonce =
        arrayBufferToBase64(
            recipientEncrypted.iv
        );
    const ciphertext =
        arrayBufferToBase64(
            recipientEncrypted.ciphertext
        );
    const senderPublicKey =
        arrayBufferToBase64(
            recipientEncrypted.senderPublicKey
        );
    // 7. Chuyển dữ liệu của chính mình → Base64
    const selfNonce =
        arrayBufferToBase64(
            selfEncrypted.iv
        );
    const selfCiphertext =
        arrayBufferToBase64(
            selfEncrypted.ciphertext
        );
    const selfPublicKey =
        arrayBufferToBase64(
            selfEncrypted.senderPublicKey
        );
    // 8. Gửi cả hai bản mã hóa lên server
    const response = await fetch(
        "/api/messages",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                conversationId,
                ciphertext,
                nonce,
                senderPublicKey,
                selfCiphertext,
                selfNonce,
                selfPublicKey
            })
        }
    );
    // 9. Đọc kết quả từ server
    const data =
        await response.json();
    if (!response.ok) {
        throw new Error(
            data.message
        );
    }
    return data;
}