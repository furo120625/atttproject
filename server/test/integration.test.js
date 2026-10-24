const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const protocol = require('../../client/js/security/protocol');
test('Real MySQL: secure sessions, versioned API, authorization, friends and replay', {skip: process.env.RUN_MYSQL_TESTS !== '1'}, async t => {
    const mysql = require('mysql2/promise');
    const name='seruchat_test_'+crypto.randomBytes(6).toString('hex');
    const admin=await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',multipleStatements:true});
    process.env.DB_NAME=name; process.env.SESSION_SECRET=crypto.randomBytes(32).toString('hex');
    let app,server,db;
    try {
        await admin.query(fs.readFileSync(path.resolve(__dirname,'../../database/schema.sql'),'utf8').replace(/\bseruchat\b/g,name));
        db=require('../src/config/database'); app=require('../src/server').createApp(); await app.locals.sessionStore.onReady();
        server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}); const url='http://127.0.0.1:'+server.address().port;
        function client() {
            let cookie='',csrf='';
            async function request(route,body,extra={}) {
                if(body!==undefined&&!csrf) csrf=(await request('/api/security/csrf')).data.csrfToken;
                const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
                const set=r.headers.get('set-cookie'); if(set) cookie=set.split(';')[0]; const next=r.headers.get('X-CSRF-Token');if(next)csrf=next;
                return {status:r.status,data:r.status===204?null:await r.json(),headers:r.headers};
            }
            return request;
        }
        const a=client(),b=client(),eve=client(),anon=client(),password='demo-password'; let alice,bob,evil,conversation,invite;
        function identity(id) {
            const x=crypto.generateKeyPairSync('x25519'),s=crypto.generateKeyPairSync('ed25519');
            const bundle={publicKey:x.publicKey.export({format:'der',type:'spki'}).toString('base64'),signingPublicKey:s.publicKey.export({format:'der',type:'spki'}).toString('base64'),backupVersion:2,
                encryptedPrivateKey:crypto.randomBytes(128).toString('base64'),salt:crypto.randomBytes(16).toString('base64'),iv:crypto.randomBytes(12).toString('base64')};
            bundle.keyProof=crypto.sign(null,Buffer.from(['seruchat-key-v2',id,bundle.publicKey,bundle.signingPublicKey,bundle.encryptedPrivateKey,bundle.salt,bundle.iv].join('|')),s.privateKey).toString('base64');
            return {bundle,s,x};
        }
        let ia,ib;
        function message(overrides={}) {
            const e={version:2,id:crypto.randomUUID(),conversationId:conversation,senderId:alice.id,recipientId:bob.id,
                ciphertext:crypto.randomBytes(32).toString('base64'),nonce:crypto.randomBytes(12).toString('base64'),senderPublicKey:ia.bundle.publicKey,
                selfCiphertext:crypto.randomBytes(32).toString('base64'),selfNonce:crypto.randomBytes(12).toString('base64'),selfPublicKey:ia.bundle.publicKey,...overrides};
            e.signature=crypto.sign(null,Buffer.from(protocol.signed(e)),ia.s.privateKey).toString('base64');return e;
        }
        await t.test('CSRF is mandatory, tokens rotate on login, weak new passwords rejected, old logins remain usable',async()=>{
            const raw=await fetch(url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(raw.status,403);
            assert.equal((await anon('/api/auth/register',{username:'Weak',email:'weak@test.test',password:'111111a'})).status,400);
            alice=(await a('/api/auth/register',{username:'A',email:'a@test.test',password})).data.user;
            bob=(await b('/api/auth/register',{username:'B',email:'b@test.test',password})).data.user;
            evil=(await eve('/api/auth/register',{username:'E',email:'e@test.test',password})).data.user;
            assert.ok(alice.id&&bob.id&&evil.id);
            for(const [c,email] of [[a,'a'],[b,'b'],[eve,'e']]) assert.equal((await c('/api/auth/login',{email:email+'@test.test',password})).status,200);
            assert.equal((await a('/api/friendships/request',{targetUserId:bob.id},{'X-CSRF-Token':'0'.repeat(64)})).status,403);
            assert.equal((await a('/api/friendships/request',{targetUserId:bob.id},{Origin:'https://evil.test'})).status,403);
            const page=await fetch(url);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(page.headers.get('x-frame-options'),'DENY');
        });
        await t.test('Immutable X25519/Ed25519 keys, proof and owner-only recovery backup',async()=>{
            ia=identity(alice.id);ib=identity(bob.id);
            assert.equal((await a('/api/keys/public',ia.bundle)).status,200); assert.equal((await b('/api/keys/public',ib.bundle)).status,200);
            assert.equal((await a('/api/keys/public',identity(alice.id).bundle)).status,409);
            assert.equal((await b('/api/keys/public',{...ib.bundle,keyProof:crypto.randomBytes(64).toString('base64')})).status,400);
            assert.equal((await eve('/users/'+bob.id+'/public-key',ib.bundle)).status,403);
            assert.equal((await b('/api/keys/private')).data.backupVersion,2);
            assert.equal((await eve('/api/keys/private')).status,404);
            assert.equal((await anon('/api/keys/private')).status,401);
            assert.equal((await b('/api/keys/public',{publicKey:ib.bundle.publicKey})).status,400);
        });
        await t.test('Friend request races and atomic conversation creation',async()=>{
            const result=await Promise.all([a('/api/friendships/request',{targetUserId:bob.id}),b('/api/friendships/request',{targetUserId:alice.id})]);
            assert.deepEqual(result.map(x=>x.status).sort(),[201,409]);
            invite=result.find(x=>x.status===201).data.friendshipId;const recipient=result[0].status===201?b:a;
            assert.equal((await eve('/api/friendships/'+invite+'/accept',{})).status,403); assert.equal((await recipient('/api/friendships/'+invite+'/accept',{})).status,200);
            const chats=await Promise.all(Array.from({length:4},()=>a('/api/conversations',{friendId:bob.id})));
            assert.equal(new Set(chats.map(x=>x.data.conversationId)).size,1);conversation=chats[0].data.conversationId;
        });
        await t.test('Reject impersonation, edited signatures, replay, protocol downgrade and foreign reads',async()=>{
            assert.equal((await eve('/api/messages',message())).status,403);
            assert.equal((await a('/api/messages',{...message(),signature:crypto.randomBytes(64).toString('base64')})).status,400);
            assert.equal((await a('/api/messages',message({recipientId:evil.id}))).status,403);
            assert.equal((await a('/api/messages',{version:1})).status,400);
            const e=message(); assert.equal((await a('/api/messages',e)).status,201);assert.equal((await a('/api/messages',e)).status,409);
            const edited={...message(),ciphertext:crypto.randomBytes(32).toString('base64')};assert.equal((await a('/api/messages',edited)).status,400);
            assert.equal((await eve('/api/messages/'+conversation)).status,403);assert.equal((await eve('/messages/'+bob.id)).status,403);
            const history=await b('/api/messages/'+conversation);assert.equal(history.data.length,1);assert.equal(history.data[0].protocol_version,2);
            assert.equal((await b('/messages/'+bob.id)).data.length,1);
        });
        await t.test('Block/unblock/remove preserve history and enforce permissions',async()=>{
            assert.equal((await b('/api/friendships/block',{targetUserId:alice.id})).status,200);
            assert.equal((await a('/api/messages',message())).status,403);
            assert.equal((await a('/api/friendships/unblock',{targetUserId:bob.id})).status,403);
            assert.equal((await b('/api/friendships/unblock',{targetUserId:alice.id})).data.friendshipRestored,true);
            assert.equal((await a('/api/messages',message())).status,201);
            assert.equal((await a('/api/friendships/remove',{targetUserId:bob.id})).status,200);
            assert.equal((await a('/api/messages',message())).status,403); assert.equal((await a('/api/messages/'+conversation)).data.length,2);
        });
        await t.test('Cancel/reject/retry/re-friend reuse the conversation',async()=>{
            let f=(await a('/api/friendships/request',{targetUserId:bob.id})).data.friendshipId;
            assert.equal((await b('/api/friendships/'+f+'/cancel',{})).status,403);assert.equal((await a('/api/friendships/'+f+'/cancel',{})).status,200);
            f=(await a('/api/friendships/request',{targetUserId:bob.id})).data.friendshipId;assert.equal((await b('/api/friendships/'+f+'/reject',{})).status,200);
            const again=await a('/api/friendships/request',{targetUserId:bob.id});assert.equal(again.status,201);assert.equal((await b('/api/friendships/'+again.data.friendshipId+'/accept',{})).status,200);
            assert.equal((await a('/api/conversations',{friendId:bob.id})).data.conversationId,conversation);
            assert.equal((await eve('/api/friendships/block',{targetUserId:alice.id})).status,200);assert.equal((await eve('/api/friendships/unblock',{targetUserId:alice.id})).data.friendshipRestored,false);
        });
        await t.test('Limiter and logout invalidate access',async()=>{
            let result;for(let i=0;i<25;i++) result=await eve('/api/friendships/request',{targetUserId:evil.id});assert.equal(result.status,429);
            assert.equal((await a('/api/auth/logout',{})).status,200);assert.equal((await a('/api/auth/me')).status,401);
        });
    } finally {
        if(server) await new Promise(r=>server.close(r));if(app) await app.locals.sessionStore.close();if(db) await db.promise().end();
        await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();
    }
});
