async function decryptMessage(
    encryptedMessage,
    receiverPrivateKey
) {
    const senderPublicKeyData =
        Uint8Array.from(
            atob(
                encryptedMessage.sender_public_key
            ),
            char => char.charCodeAt(0)
        );
    const senderPublicKey =
        await crypto.subtle.importKey(
            "spki",
            senderPublicKeyData,
            {
                name: "X25519"
            },
            false,
            []
        );
    const sharedSecret =
        await crypto.subtle.deriveBits(
            {
                name: "X25519",
                public: senderPublicKey
            },
            receiverPrivateKey,
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
    const aesKey =
        await crypto.subtle.deriveKey(
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
            ["decrypt"]
        );
    const iv =
        Uint8Array.from(
            atob(encryptedMessage.nonce),
            char => char.charCodeAt(0)
        );
    const ciphertext =
        Uint8Array.from(
            atob(encryptedMessage.ciphertext),
            char => char.charCodeAt(0)
        );
    const plaintext =
        await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv,
                tagLength: 128
            },
            aesKey,
            ciphertext
        );
    return new TextDecoder().decode(
        plaintext
    );
}
async function decryptOwnMessage(
    encryptedMessage,
    myPrivateKey
) {
    const selfEncryptedMessage = {
        sender_public_key:
        encryptedMessage.self_public_key,
        nonce:
        encryptedMessage.self_nonce,
        ciphertext:
        encryptedMessage.self_ciphertext
    };
    return decryptMessage(
        selfEncryptedMessage,
        myPrivateKey
    );
}