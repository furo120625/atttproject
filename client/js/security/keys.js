/* Recovery vault and verified key pins. Existing X25519 primitives are reused. */
const SecureKeys = (() => {
    const b64 = x => arrayBufferToBase64(x), bytes = x => Uint8Array.from(atob(x), c => c.charCodeAt(0));
    const utf8 = x => new TextEncoder().encode(x);
    async function store(name, value) {
        const db = await openKeyDatabase();
        try { return await new Promise((resolve, reject) => {
            const t = db.transaction(KEY_STORE_NAME, 'readwrite'); t.objectStore(KEY_STORE_NAME).put(value, name);
            t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
        }); } finally { db.close(); }
    }
    async function read(name) { return getKeyPair(name); }
    async function request(url, body) {
        const r = await fetch(url, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
        const data = await r.json(); if (!r.ok && r.status !== 404) throw new Error(data.message);
        return {r, data};
    }
    function recovery(mode, code = '') {
        const d = document.getElementById('recoveryDialog'), form = document.getElementById('recoveryForm');
        document.getElementById('recoveryTitle').textContent = mode === 'create' ? 'Lưu mã khôi phục khóa' : 'Mở khóa bằng mã khôi phục';
        document.getElementById('recoveryCode').textContent = code;
        document.getElementById('recoveryInput').value = '';
        document.getElementById('recoveryInput').required = mode === 'unlock';
        document.getElementById('recoveryUnlock').hidden = mode !== 'unlock';
        document.getElementById('recoverySave').hidden = mode !== 'create';
        document.getElementById('recoverySaved').checked = false;
        document.getElementById('recoverySaved').required = mode === 'create';
        d.returnValue = 'no';
        return new Promise((resolve, reject) => {
            const submit = e => { if (e.submitter?.value === 'no') return; if (!form.checkValidity()) { e.preventDefault(); form.reportValidity(); } };
            form.addEventListener('submit', submit);
            d.addEventListener('close', () => {
                form.removeEventListener('submit', submit);
                const entered = document.getElementById('recoveryInput').value;
                document.getElementById('recoveryInput').value = ''; document.getElementById('recoveryCode').textContent = '';
                if (d.returnValue !== 'yes') reject(new Error('Đã hủy mở/nâng cấp khóa. Đăng nhập lại để tiếp tục.'));
                else resolve(mode === 'create' ? code : entered);
            }, {once: true});
            d.showModal();
        });
    }
    async function vaultKey(code, salt, id) {
        const clean = code.replace(/[\s-]/g, '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(clean)) throw new Error('Mã khôi phục cần đủ 64 ký tự hex.');
        const raw = Uint8Array.from(clean.match(/../g), x => parseInt(x, 16));
        const key = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
        raw.fill(0);
        return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt, info: utf8('seruchat-recovery-v2|' + id)}, key,
            {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    }
    async function seal(id, pair, sign, code) {
        const publicKey = await exportPublicKey(pair.publicKey), signingPublicKey = b64(await crypto.subtle.exportKey('spki', sign.publicKey));
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
        const raw = utf8(JSON.stringify({x: b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), s: b64(await crypto.subtle.exportKey('pkcs8', sign.privateKey))}));
        const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: utf8(['seruchat-key-bundle-v2', id, publicKey, signingPublicKey].join('|'))}, await vaultKey(code, salt, id), raw);
        raw.fill(0);
        return {publicKey, signingPublicKey, backupVersion: 2, algorithm: 'X25519', encryptedPrivateKey: b64(encrypted), salt: b64(salt), iv: b64(iv)};
    }
    async function restore(id, remote, backup, code) {
        const decrypted = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(backup.iv),
            additionalData: utf8(['seruchat-key-bundle-v2', id, remote.publicKey, remote.signingPublicKey].join('|'))},
            await vaultKey(code, bytes(backup.salt), id), bytes(backup.encryptedPrivateKey));
        const raw = new Uint8Array(decrypted); let parsed;
        try { parsed = JSON.parse(new TextDecoder().decode(raw)); } finally { raw.fill(0); }
        const pair = {publicKey: await crypto.subtle.importKey('spki', bytes(remote.publicKey), 'X25519', true, []),
            privateKey: await crypto.subtle.importKey('pkcs8', bytes(parsed.x), 'X25519', true, ['deriveBits'])};
        const sign = {publicKey: await crypto.subtle.importKey('spki', bytes(remote.signingPublicKey), 'Ed25519', true, ['verify']),
            privateKey: await crypto.subtle.importKey('pkcs8', bytes(parsed.s), 'Ed25519', true, ['sign'])};
        const challenge = utf8('seruchat-restore-check');
        if (!await crypto.subtle.verify('Ed25519', sign.publicKey, await crypto.subtle.sign('Ed25519', sign.privateKey, challenge), challenge)) throw new Error('Signing key mismatch');
        const ephemeral = await generateKeyPair();
        const a = b64(await crypto.subtle.deriveBits({name: 'X25519', public: pair.publicKey}, ephemeral.privateKey, 256));
        const b = b64(await crypto.subtle.deriveBits({name: 'X25519', public: ephemeral.publicKey}, pair.privateKey, 256));
        if (a !== b) throw new Error('Encryption key mismatch');
        return {pair, sign};
    }
    async function setup(id, password) {
        if (!crypto.subtle) throw new Error('Mở tại localhost hoặc HTTPS để dùng mã hóa.');
        let pair = await getKeyPair(id), sign = await read('sign:' + id);
        const {r, data: remote} = await request('/api/keys/public/' + id);
        if (r.ok && pair && await exportPublicKey(pair.publicKey) !== remote.publicKey) throw new Error('Khóa trên thiết bị khác khóa đã đăng ký. Dùng thiết bị gốc.');
        if (r.ok && remote.signingPublicKey && pair && sign) {
            if (b64(await crypto.subtle.exportKey('spki', sign.publicKey)) !== remote.signingPublicKey) throw new Error('Khóa ký đã thay đổi. Dừng sử dụng tài khoản này.');
            return pair;
        }
        if (r.ok && remote.backupVersion === 2) {
            const backup = await request('/api/keys/private'); if (!backup.r.ok) throw new Error('Thiếu backup; dùng thiết bị giữ khóa gốc.');
            const code = await recovery('unlock'); let restored;
            try { restored = await restore(id, remote, backup.data, code); }
            catch { throw new Error('Mã khôi phục sai hoặc backup bị sửa. Không tạo khóa thay thế.'); }
            await store(id, restored.pair); await store('sign:' + id, restored.sign);
            return restored.pair;
        }
        if (r.ok && !pair) {
            if (!password) throw new Error('Đăng xuất rồi đăng nhập để mở backup cũ.');
            const backup = await request('/api/keys/private'); if (!backup.r.ok) throw new Error('Khóa cũ không có backup; dùng thiết bị gốc.');
            let privateKey;
            try { privateKey = await decryptPrivateKey(backup.data.encryptedPrivateKey, password, bytes(backup.data.salt), bytes(backup.data.iv)); }
            catch { throw new Error('Không mở được backup cũ. Không tạo khóa thay thế.'); }
            pair = {publicKey: await crypto.subtle.importKey('spki', bytes(remote.publicKey), 'X25519', true, []), privateKey};
        }
        pair ||= await generateKeyPair();
        sign ||= await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
        // Persist before publish: retries retain the original identity.
        await store(id, pair); await store('sign:' + id, sign);
        const code = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
        await recovery('create', code);
        const bundle = await seal(id, pair, sign, code);
        const proof = ['seruchat-key-v2', id, bundle.publicKey, bundle.signingPublicKey, bundle.encryptedPrivateKey, bundle.salt, bundle.iv].join('|');
        bundle.keyProof = b64(await crypto.subtle.sign('Ed25519', sign.privateKey, utf8(proof)));
        await request('/api/keys/public', bundle);
        return pair;
    }
    async function fingerprint(id, remote) {
        if (!remote.signingPublicKey) throw new Error('Người này cần đăng nhập bản mới để nâng cấp khóa.');
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(['seruchat-fingerprint-v2', id, remote.publicKey, remote.signingPublicKey].join('|'))));
        return Array.from(hash, x => x.toString(16).padStart(2, '0')).join('').match(/.{8}/g).join(' ');
    }
    async function peer(id) {
        const {data} = await request('/api/keys/public/' + id); const fp = await fingerprint(id, data);
        const pinned = await read('trust:' + currentUserId.textContent + ':' + id);
        return {...data, fingerprint: fp, trusted: pinned === fp, changed: !!pinned && pinned !== fp};
    }
    async function trust(id, entered) {
        const remote = await peer(id);
        if (entered.replace(/\s/g, '').toLowerCase() !== remote.fingerprint.replace(/\s/g, '')) throw new Error('Fingerprint không khớp. Đối chiếu mã trực tiếp với người kia.');
        await store('trust:' + currentUserId.textContent + ':' + id, remote.fingerprint);
    }
    return {setup, fingerprint, peer, trust, read, b64, bytes, utf8, seal, restore};
})();
document.getElementById('downloadRecovery').addEventListener('click', () => {
    const code = document.getElementById('recoveryCode').textContent;
    if (!code) return;
    const text = 'Seruchat recovery v2\nUser ID: ' + document.getElementById('currentUserId').textContent + '\nRecovery code: ' + code + '\nKeep private. Never send this code to the server or commit it to Git.\n';
    const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'seruchat-recovery.txt'; a.click(); URL.revokeObjectURL(url);
});
