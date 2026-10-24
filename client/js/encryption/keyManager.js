const KEY_DB_NAME = "secure-chat-keys";
const KEY_STORE_NAME = "keys";
function openKeyDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(
            KEY_DB_NAME,
            1
        );
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(KEY_STORE_NAME)) {
                database.createObjectStore(KEY_STORE_NAME);
            }
        };
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            reject(request.error);
        };
    });
}
async function saveKeyPair(userId, keyPair) {
    const database = await openKeyDatabase();
    return new Promise((resolve, reject) => {
        const transaction =
            database.transaction(
                KEY_STORE_NAME,
                "readwrite"
            );
        const store =
            transaction.objectStore(
                KEY_STORE_NAME
            );
        const request = store.put(
            keyPair,
            userId
        );
        request.onsuccess = () => {
            resolve();
        };
        request.onerror = () => {
            reject(request.error);
        };
    });
}
async function getKeyPair(userId) {
    const database = await openKeyDatabase();
    return new Promise((resolve, reject) => {
        const transaction =
            database.transaction(
                KEY_STORE_NAME,
                "readonly"
            );
        const store =
            transaction.objectStore(
                KEY_STORE_NAME
            );
        const request =
            store.get(userId);
        request.onsuccess = () => {
            resolve(request.result || null);
        };
        request.onerror = () => {
            reject(request.error);
        };
    });
}
async function generateKeyPair() {
    return crypto.subtle.generateKey(
        {
            name: "X25519"
        },
        true,
        [
            "deriveBits"
        ]
    );
}
async function deriveKeyFromPassword(
    password,
    salt
) {
    const passwordKey =
        await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(password),
            "PBKDF2",
            false,
            ["deriveKey"]
        );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 600000,
            hash: "SHA-256"
        },
        passwordKey,
        {
            name: "AES-GCM",
            length: 256
        },
        false,
        [
            "encrypt",
            "decrypt"
        ]
    );
}
async function encryptPrivateKey(
    privateKey,
    password
) {
    const privateKeyData =
        await crypto.subtle.exportKey(
            "pkcs8",
            privateKey
        );
    const salt =
        crypto.getRandomValues(
            new Uint8Array(16)
        );
    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );
    const encryptionKey =
        await deriveKeyFromPassword(
            password,
            salt
        );
    const encryptedData =
        await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv
            },
            encryptionKey,
            privateKeyData
        );
    return {
        encryptedPrivateKey:
            btoa(
                String.fromCharCode(
                    ...new Uint8Array(
                        encryptedData
                    )
                )
            ),
        salt:
            btoa(
                String.fromCharCode(
                    ...salt
                )
            ),
        iv:
            btoa(
                String.fromCharCode(
                    ...iv
                )
            )
    };
}
async function decryptPrivateKey(
    encryptedPrivateKey,
    password,
    salt,
    iv
) {
    const encryptionKey =
        await deriveKeyFromPassword(
            password,
            salt
        );
    const encryptedData =
        Uint8Array.from(
            atob(encryptedPrivateKey),
            character =>
                character.charCodeAt(0)
        );
    const privateKeyData =
        await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv
            },
            encryptionKey,
            encryptedData
        );
    return crypto.subtle.importKey(
        "pkcs8",
        privateKeyData,
        {
            name: "X25519"
        },
        true,
        [
            "deriveBits"
        ]
    );
}
async function getOrCreateKeyPair(
    userId,
    password
) {
    let keyPair =
        await getKeyPair(userId);
    if (keyPair) {
        if (password) {
            const response =
                await fetch("/api/keys/private");
            if (response.status === 404) {
                await saveMyPublicKey(
                    userId,
                    password
                );
            }
        }
        return keyPair;
    }
    const response =
        await fetch("/api/keys/private");
    if (response.ok) {
        const data =
            await response.json();
        const salt =
            Uint8Array.from(
                atob(data.salt),
                character =>
                    character.charCodeAt(0)
            );
        const iv =
            Uint8Array.from(
                atob(data.iv),
                character =>
                    character.charCodeAt(0)
            );
        const privateKey =
            await decryptPrivateKey(
                data.encryptedPrivateKey,
                password,
                salt,
                iv
            );
        const publicKeyResponse =
            await fetch(
                `/api/keys/public/${userId}`
            );
        const publicKeyData =
            await publicKeyResponse.json();
        const publicKeyBytes =
            Uint8Array.from(
                atob(publicKeyData.publicKey),
                character =>
                    character.charCodeAt(0)
            );
        const publicKey =
            await crypto.subtle.importKey(
                "spki",
                publicKeyBytes,
                {
                    name: "X25519"
                },
                true,
                []
            );
        keyPair = {
            publicKey,
            privateKey
        };
        await saveKeyPair(
            userId,
            keyPair
        );
        return keyPair;
    }
    keyPair =
        await generateKeyPair();
    await saveKeyPair(
        userId,
        keyPair
    );
    await saveMyPublicKey(
        userId,
        password
    );
    return keyPair;
}
async function exportPublicKey(publicKey) {
    const publicKeyData =
        await crypto.subtle.exportKey(
            "spki",
            publicKey
        );
    return btoa(
        String.fromCharCode(
            ...new Uint8Array(publicKeyData)
        )
    );
}
async function saveMyPublicKey(
    userId,
    password
) {
    const keyPair =
        await getOrCreateKeyPair(userId);
    const publicKey =
        await exportPublicKey(
            keyPair.publicKey
        );
    const encrypted =
        await encryptPrivateKey(
            keyPair.privateKey,
            password
        );
    const response =
        await fetch(
            "/api/keys/public",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    publicKey,
                    algorithm: "X25519",
                    encryptedPrivateKey:
                    encrypted.encryptedPrivateKey,
                    salt:
                    encrypted.salt,
                    iv:
                    encrypted.iv
                })
            }
        );
    const data =
        await response.json();
    if (!response.ok) {
        throw new Error(data.message);
    }
    return data;
}