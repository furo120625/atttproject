const crypto = require('crypto');
const db = require('../config/database');
const {uuid, fail} = require('../utils/api');
const {transaction, lockPair, accepted} = require('../utils/transactions');
async function ensureConversation(connection, userId, friendId) {
    const f = await lockPair(connection, userId, friendId);
    accepted(f);
    // All create/send/block requests take the same friendship lock first.
    const [rows] = await connection.query(`SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id
        WHERE cm1.user_id = ? AND cm2.user_id = ? LIMIT 1 FOR UPDATE`, [userId, friendId]);
    if (rows.length) {
        const [members] = await connection.query('SELECT user_id FROM conversation_members WHERE conversation_id = ? FOR UPDATE', [rows[0].id]);
        if (members.length !== 2) fail(409, 'This conversation must contain exactly two users');
        return {id: rows[0].id, created: false};
    }
    const id = crypto.randomUUID();
    await connection.query('INSERT INTO conversations (id) VALUES (?)', [id]);
    await connection.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [id, userId, id, friendId]);
    return {id, created: true};
}
async function createConversation(req, res) {
    const userId = req.session.userId, friendId = uuid(req.body.friendId, 'Friend ID');
    if (userId === friendId) fail(400, 'You cannot create a conversation with yourself');
    const result = await transaction(async connection => {
        const [users] = await connection.query('SELECT id FROM users WHERE id = ?', [friendId]);
        if (!users.length) fail(404, 'User not found');
        return ensureConversation(connection, userId, friendId);
    });
    res.status(result.created ? 201 : 200).json({message: result.created ? 'Conversation created' : 'Conversation already exists', conversationId: result.id});
}
async function getConversations(req, res) {
    const id = req.session.userId;
    const [rows] = await db.promise().query(`SELECT c.id AS conversation_id, peer.user_id, u.username,
        f.status AS friendship_status, f.blocked_by, f.blocked_previous_status FROM conversations c
        JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
        JOIN conversation_members peer ON peer.conversation_id = c.id AND peer.user_id <> ?
        JOIN users u ON u.id = peer.user_id
        LEFT JOIN friendships f ON f.user1_id = LEAST(mine.user_id, peer.user_id) AND f.user2_id = GREATEST(mine.user_id, peer.user_id)
        ORDER BY c.created_at ASC, c.id ASC`, [id, id]);
    res.json(rows);
}
module.exports = {createConversation, getConversations, ensureConversation};
