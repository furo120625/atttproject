const SecureChat = (() => {
    const {b64, bytes, utf8} = SecureKeys;
    async function encrypt(e, text, publicKeyB64, role) {
        const pub = await crypto.subtle.importKey('spki', bytes(publicKeyB64), 'X25519', false, []);
        const ephemeral = await generateKeyPair(), key = await deriveEncryptionKey(pub, ephemeral.privateKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, tagLength: 128,
            additionalData: utf8(ChatProtocol.aad(e, role))}, key, utf8(text));
        return {nonce: b64(iv), ciphertext: b64(ciphertext), publicKey: await exportPublicKey(ephemeral.publicKey)};
    }
    async function send(conversationId, peerId, text) {
        const peer = await SecureKeys.peer(peerId);
        if (!peer.trusted) throw new Error(peer.changed ? 'Khóa người nhận đã thay đổi. Dừng gửi và xác minh lại.' : 'Cần đối chiếu fingerprint và xác minh người nhận trước khi gửi.');
        const id = currentUserId.textContent, mine = await SecureKeys.peer(id), sign = await SecureKeys.read('sign:' + id);
        if (!sign) throw new Error('Khóa ký đang khóa. Đăng nhập lại.');
        const local = await getKeyPair(id);
        if (await exportPublicKey(local.publicKey) !== mine.publicKey || b64(await crypto.subtle.exportKey('spki', sign.publicKey)) !== mine.signingPublicKey) throw new Error('Khóa của bạn khác khóa đăng ký.');
        const e = {version: 2, id: crypto.randomUUID(), conversationId, senderId: id, recipientId: peerId};
        const [recipient, self] = await Promise.all([encrypt(e, text, peer.publicKey, 'recipient'), encrypt(e, text, mine.publicKey, 'self')]);
        Object.assign(e, {nonce: recipient.nonce, ciphertext: recipient.ciphertext, senderPublicKey: recipient.publicKey,
            selfNonce: self.nonce, selfCiphertext: self.ciphertext, selfPublicKey: self.publicKey});
        e.signature = b64(await crypto.subtle.sign('Ed25519', sign.privateKey, utf8(ChatProtocol.signed(e))));
        const r = await fetch('/api/messages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(e)});
        const data = await r.json(); if (!r.ok) throw new Error(data.message); return data;
    }
    async function decrypt(row, privateKey, conversationId, peerId) {
        if (Number(row.protocol_version) !== 2) return '[Tin cũ v1 • chưa có chữ ký/AAD] ' +
            (row.sender_id === currentUserId.textContent ? await decryptOwnMessage(row, privateKey) : await decryptMessage(row, privateKey));
        const e = ChatProtocol.fromRow(row), own = e.senderId === currentUserId.textContent;
        if (e.conversationId !== conversationId || (own ? e.recipientId !== peerId : e.recipientId !== currentUserId.textContent || e.senderId !== peerId)) throw new Error('Message context mismatch');
        const sender = await SecureKeys.peer(e.senderId);
        if ((!own && !sender.trusted) || sender.signingPublicKey !== e.signingPublicKey) throw new Error('Sender key is unverified or changed');
        const sign = await crypto.subtle.importKey('spki', bytes(sender.signingPublicKey), 'Ed25519', false, ['verify']);
        if (!await crypto.subtle.verify('Ed25519', sign, bytes(e.signature), utf8(ChatProtocol.signed(e)))) throw new Error('Invalid signature');
        const pub = await crypto.subtle.importKey('spki', bytes(own ? e.selfPublicKey : e.senderPublicKey), 'X25519', false, []);
        const shared = await crypto.subtle.deriveBits({name: 'X25519', public: pub}, privateKey, 256);
        const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8('e2ee-chat-v1')}, hkdf,
            {name: 'AES-GCM', length: 256}, false, ['decrypt']);
        const raw = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(own ? e.selfNonce : e.nonce), tagLength: 128,
            additionalData: utf8(ChatProtocol.aad(e, own ? 'self' : 'recipient'))}, key, bytes(own ? e.selfCiphertext : e.ciphertext));
        return new TextDecoder().decode(raw);
    }
    async function showPeer(id) {
        const p = await SecureKeys.peer(id);
        document.getElementById('peerFingerprint').textContent = p.fingerprint;
        document.getElementById('peerSecurityStatus').textContent = p.changed ? 'CẢNH BÁO: khóa đã thay đổi. Không gửi tin.' : p.trusted ? 'Đã đối chiếu fingerprint trên thiết bị này.' : 'Chưa xác minh. Nhận fingerprint từ người kia qua kênh tin cậy rồi nhập bên dưới.';
        return p.trusted;
    }
    return {send, decrypt, showPeer};
})();
