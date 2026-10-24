const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const p = path.resolve(__dirname, '../../client/js');
function context() {
    const pairs = new Map(), remotes = new Map();
    const c = vm.createContext({crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
        document: {getElementById: () => ({addEventListener() {}})}, currentUserId: {textContent: ''},
        fetch: async url => ({ok: remotes.has(url.split('/').pop()), status: remotes.has(url.split('/').pop()) ? 200 : 404,
            json: async () => remotes.get(url.split('/').pop()) || {message:'Missing'}})});
    for (const f of ['encryption/keyManager.js','encryption/encryption.js','encryption/decryption.js','security/protocol.js','security/keys.js','security/messages.js']) vm.runInContext(fs.readFileSync(path.join(p,f),'utf8'),c);
    c.getKeyPair = async id => pairs.get(id);
    return {c, pairs, remotes, keys: vm.runInContext('SecureKeys',c), chat: vm.runInContext('SecureChat',c)};
}
test('Recovery backup restores both key types; login password, wrong recovery and edited backup fail', async () => {
    const {c,keys} = context(); const id=crypto.randomUUID(), pair=await c.generateKeyPair(), sign=await crypto.webcrypto.subtle.generateKey('Ed25519',true,['sign','verify']);
    const code=crypto.randomBytes(32).toString('hex'), backup=await keys.seal(id,pair,sign,code);
    const restored=await keys.restore(id,backup,backup,code);
    assert.equal(await c.exportPublicKey(restored.pair.publicKey),backup.publicKey);
    await assert.rejects(keys.restore(id,backup,backup,'demo-password'));
    await assert.rejects(keys.restore(id,backup,backup,crypto.randomBytes(32).toString('hex')));
    const bad=Buffer.from(backup.encryptedPrivateKey,'base64'); bad[1]^=1;
    await assert.rejects(keys.restore(id,backup,{...backup,encryptedPrivateKey:bad.toString('base64')},code));
    await assert.rejects(keys.restore(crypto.randomUUID(),backup,backup,code));
});
test('Signed AAD envelope decrypts for recipient/self and rejects tampering, bad context, unverified/changed sender', async () => {
    const {c,keys,chat,pairs,remotes}=context(), subtle=crypto.webcrypto.subtle;
    const a=crypto.randomUUID(), b=crypto.randomUUID(), conv=crypto.randomUUID();
    for(const id of [a,b]) {
        const x=await c.generateKeyPair(), sign=await subtle.generateKey('Ed25519',true,['sign','verify']);
        pairs.set(id,x); pairs.set('sign:'+id,sign);
        remotes.set(id,{publicKey:await c.exportPublicKey(x.publicKey),signingPublicKey:Buffer.from(await subtle.exportKey('spki',sign.publicKey)).toString('base64')});
    }
    const aFp=await keys.fingerprint(a,remotes.get(a)), bFp=await keys.fingerprint(b,remotes.get(b));
    pairs.set('trust:'+a+':'+b,bFp); pairs.set('trust:'+b+':'+a,aFp);
    let envelope; const native=c.fetch;
    c.fetch=async (url,opt)=>{ if(opt?.body) {envelope=JSON.parse(opt.body);return {ok:true,json:async()=>({})};} return native(url); };
    c.currentUserId.textContent=a;
    await chat.send(conv,b,'Xin chào 👋');
    const e=envelope, row={id:e.id,protocol_version:2,conversation_id:conv,sender_id:a,recipient_id:b,nonce:e.nonce,ciphertext:e.ciphertext,
        sender_public_key:e.senderPublicKey,self_nonce:e.selfNonce,self_ciphertext:e.selfCiphertext,self_public_key:e.selfPublicKey,signature:e.signature,sender_signing_key:remotes.get(a).signingPublicKey};
    assert.equal(await chat.decrypt(row,pairs.get(a).privateKey,conv,b),'Xin chào 👋');
    c.currentUserId.textContent=b;
    assert.equal(await chat.decrypt(row,pairs.get(b).privateKey,conv,a),'Xin chào 👋');
    for(const field of ['ciphertext','signature','self_ciphertext']) {
        const bytes=Buffer.from(row[field],'base64'); bytes[0]^=1;
        await assert.rejects(chat.decrypt({...row,[field]:bytes.toString('base64')},pairs.get(b).privateKey,conv,a));
    }
    await assert.rejects(chat.decrypt({...row,id:crypto.randomUUID()},pairs.get(b).privateKey,conv,a));
    await assert.rejects(chat.decrypt({...row,recipient_id:a},pairs.get(b).privateKey,conv,a));
    await assert.rejects(chat.decrypt(row,pairs.get(b).privateKey,crypto.randomUUID(),a));
    const changed={...e,id:crypto.randomUUID()}; changed.signature=Buffer.from(await subtle.sign('Ed25519',pairs.get('sign:'+a).privateKey,Buffer.from(c.ChatProtocol.signed(changed)))).toString('base64');
    await assert.rejects(chat.decrypt({...row,id:changed.id,signature:changed.signature},pairs.get(b).privateKey,conv,a));
    pairs.delete('trust:'+b+':'+a); await assert.rejects(chat.decrypt(row,pairs.get(b).privateKey,conv,a));
    pairs.set('trust:'+b+':'+a,aFp); remotes.get(a).signingPublicKey=remotes.get(b).signingPublicKey;
    await assert.rejects(chat.decrypt(row,pairs.get(b).privateKey,conv,a));
});
