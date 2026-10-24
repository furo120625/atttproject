const db = require('../config/database');
const {fail, pair} = require('./api');
async function transaction(work) {
    const connection = await db.promise().getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
}
async function lockPair(connection, a, b) {
    const [first, second] = pair(a, b);
    const [rows] = await connection.query('SELECT * FROM friendships WHERE user1_id = ? AND user2_id = ? FOR UPDATE', [first, second]);
    return rows[0];
}
function accepted(friendship) {
    if (friendship?.status === 'blocked') fail(403, 'This user relationship is blocked');
    if (friendship?.status !== 'accepted') fail(403, 'You must be friends to send messages');
}
async function conversationPair(connection, conversationId, userId) {
    const [rows] = await connection.query('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY user_id', [conversationId]);
    if (!rows.some(row => row.user_id === userId)) fail(403, 'You are not a member of this conversation');
    if (rows.length !== 2) fail(409, 'This conversation must contain exactly two users');
    return rows.find(row => row.user_id !== userId).user_id;
}
module.exports = {transaction, lockPair, accepted, conversationPair};
