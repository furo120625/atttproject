const crypto = require('crypto');
const db = require('../config/database');
const {uuid, base64, publicKey, fail} = require('../utils/api');
const {transaction, conversationPair, lockPair, accepted} = require('../utils/transactions');
const protocol = require('../../../client/js/security/protocol');
function messageFields(body) {
    if (body.version !== 2) fail(400, 'New messages require protocol version 2. Update the client; legacy messages remain readable.');
    return {version: 2, id: uuid(body.id, 'Message ID'), conversationId: uuid(body.conversationId, 'Conversation ID'),
        senderId: uuid(body.senderId, 'Sender ID'), recipientId: uuid(body.recipientId, 'Recipient ID'),
        ciphertext: base64(body.ciphertext, 'Ciphertext', {min: 16}), nonce: base64(body.nonce, 'Message IV', {bytes: 12}),
        senderPublicKey: publicKey(body.senderPublicKey, 'Ephemeral public key'),
        selfCiphertext: base64(body.selfCiphertext, 'Self ciphertext', {min: 16}), selfNonce: base64(body.selfNonce, 'Self IV', {bytes: 12}),
        selfPublicKey: publicKey(body.selfPublicKey, 'Self ephemeral key'), signature: base64(body.signature, 'Signature', {bytes: 64})};
}
async function sendMessage(req, res) {
    const e = messageFields(req.body);
    if (e.senderId !== req.session.userId || e.senderId === e.recipientId) fail(403, 'Sender must match the login session');
    await transaction(async connection => {
        const peer = await conversationPair(connection, e.conversationId, e.senderId);
        if (peer !== e.recipientId) fail(403, 'Recipient does not belong to this chat');
        accepted(await lockPair(connection, e.senderId, peer));
        const [keys] = await connection.query('SELECT user_id, signing_public_key FROM public_keys WHERE user_id IN (?, ?)', [e.senderId, peer]);
        const sender = keys.find(k => k.user_id === e.senderId), receiver = keys.find(k => k.user_id === peer);
        if (!sender?.signing_public_key || !receiver?.signing_public_key) fail(409, 'Both accounts must upgrade their encryption keys before sending');
        if (!crypto.verify(null, Buffer.from(protocol.signed(e)), {key: Buffer.from(sender.signing_public_key, 'base64'), type: 'spki', format: 'der'}, Buffer.from(e.signature, 'base64'))) fail(400, 'Invalid message signature');
        const [existing] = await connection.query('SELECT id FROM messages WHERE id = ?', [e.id]);
        if (existing.length) fail(409, 'Duplicate message ID / replay rejected');
        await connection.query(`INSERT INTO messages (id, conversation_id, sender_id, recipient_id, protocol_version, signature, sender_signing_key,
            ciphertext, nonce, sender_public_key, self_ciphertext, self_nonce, self_public_key) VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [e.id, e.conversationId, e.senderId, e.recipientId, e.signature, sender.signing_public_key,
                e.ciphertext, e.nonce, e.senderPublicKey, e.selfCiphertext, e.selfNonce, e.selfPublicKey]);
    });
    res.status(201).json({message: 'Signed message stored', messageId: e.id, conversationId: e.conversationId});
}
const columns = 'id, conversation_id, sender_id, recipient_id, protocol_version, signature, sender_signing_key, ciphertext, nonce, sender_public_key, self_ciphertext, self_nonce, self_public_key, created_at';
async function getMessages(req, res) {
    const id = uuid(req.params.conversationId, 'Conversation ID');
    await conversationPair(db.promise(), id, req.session.userId);
    const [messages] = await db.promise().query(`SELECT ${columns} FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`, [id]);
    res.json(messages);
}
async function getJavaInbox(req, res) {
    const id = uuid(req.params.id);
    if (id !== req.session.userId) fail(403, 'You can only read your own inbox');
    const [messages] = await db.promise().query(`SELECT ${columns.split(', ').map(c => 'm.' + c).join(', ')} FROM messages m
        JOIN conversation_members mine ON mine.conversation_id = m.conversation_id AND mine.user_id = ?
        WHERE m.sender_id <> ? ORDER BY m.created_at ASC, m.id ASC`, [id, id]);
    if (!messages.length) return res.status(204).end();
    res.json(messages);
}
module.exports = {sendMessage, getMessages, getJavaInbox, messageFields};
