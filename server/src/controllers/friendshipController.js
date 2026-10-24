const db = require('../config/database');
const crypto = require('crypto');
const {uuid, fail, pair} = require('../utils/api');
const {transaction, lockPair} = require('../utils/transactions');
async function sendFriendRequest(req, res) {
    const userId = req.session.userId, targetUserId = uuid(req.body.targetUserId, 'Target user ID');
    if (targetUserId === userId) fail(400, 'You cannot add yourself');
    const result = await transaction(async connection => {
        const [target] = await connection.query('SELECT id FROM users WHERE id = ?', [targetUserId]);
        if (!target.length) fail(404, 'User not found');
        const friendship = await lockPair(connection, userId, targetUserId);
        if (friendship?.status === 'blocked') fail(403, 'This user relationship is blocked');
        if (friendship?.status === 'accepted') fail(409, 'You are already friends');
        if (friendship?.status === 'pending') fail(409, 'A friend request is already pending');
        if (friendship?.status === 'rejected') {
            await connection.query("UPDATE friendships SET status = 'pending', requested_by = ?, created_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [userId, friendship.id]);
            return friendship.id;
        }
        const id = crypto.randomUUID(), [first, second] = pair(userId, targetUserId);
        await connection.query("INSERT INTO friendships (id, user1_id, user2_id, requested_by, status) VALUES (?, ?, ?, ?, 'pending')", [id, first, second, userId]);
        return id;
    });
    res.status(201).json({message: 'Friend request sent', friendshipId: result});
}
async function getIncomingFriendRequests(req, res) {
    const id = req.session.userId;
    const [requests] = await db.promise().query(`SELECT f.id, f.requested_by, u.username, u.id AS user_id, f.created_at
        FROM friendships f JOIN users u ON u.id = f.requested_by
        WHERE (f.user1_id = ? OR f.user2_id = ?) AND f.requested_by <> ? AND f.status = 'pending'
        ORDER BY f.created_at DESC`, [id, id, id]);
    res.json({requests});
}
async function getOutgoingFriendRequests(req, res) {
    const id = req.session.userId;
    const [requests] = await db.promise().query(`SELECT f.id, u.id AS user_id, u.username, f.created_at
        FROM friendships f JOIN users u ON u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END
        WHERE f.requested_by = ? AND f.status = 'pending' ORDER BY f.created_at DESC`, [id, id]);
    res.json({requests});
}
async function cancelFriendRequest(req, res) {
    const id = uuid(req.params.id, 'Friend request ID'), userId = req.session.userId;
    await transaction(async connection => {
        const [rows] = await connection.query('SELECT * FROM friendships WHERE id = ? FOR UPDATE', [id]);
        if (!rows.length) fail(404, 'Friend request not found');
        if (rows[0].requested_by !== userId) fail(403, 'Only the sender can cancel this request');
        if (rows[0].status !== 'pending') fail(409, 'Friend request is no longer pending');
        await connection.query('DELETE FROM friendships WHERE id = ?', [id]);
    });
    res.json({message: 'Friend request cancelled'});
}
async function decide(req, res, status) {
    const id = uuid(req.params.id, 'Friend request ID'), userId = req.session.userId;
    await transaction(async connection => {
        const [rows] = await connection.query('SELECT * FROM friendships WHERE id = ? FOR UPDATE', [id]);
        if (!rows.length) fail(404, 'Friend request not found');
        const f = rows[0];
        if (![f.user1_id, f.user2_id].includes(userId) || f.requested_by === userId) fail(403, 'Only the recipient can handle this friend request');
        if (f.status !== 'pending') fail(409, 'Friend request is no longer pending');
        await connection.query('UPDATE friendships SET status = ? WHERE id = ?', [status, id]);
    });
    res.json({message: status === 'accepted' ? 'Friend request accepted' : 'Friend request rejected'});
}
const acceptFriendRequest = (req, res) => decide(req, res, 'accepted');
const rejectFriendRequest = (req, res) => decide(req, res, 'rejected');
async function getFriends(req, res) {
    const id = req.session.userId;
    const [friends] = await db.promise().query(`SELECT u.id, u.username, u.email FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END
        WHERE (f.user1_id = ? OR f.user2_id = ?) AND f.status = 'accepted' ORDER BY u.username`, [id, id, id]);
    res.json({friends});
}
async function blockUser(req, res) {
    const userId = req.session.userId, target = uuid(req.body.targetUserId, 'Target user ID');
    if (userId === target) fail(400, 'You cannot block yourself');
    await transaction(async connection => {
        const [rows] = await connection.query('SELECT id FROM users WHERE id = ?', [target]);
        if (!rows.length) fail(404, 'User not found');
        const f = await lockPair(connection, userId, target);
        if (f?.status === 'blocked') fail(409, 'This user relationship is already blocked');
        if (f) await connection.query("UPDATE friendships SET blocked_previous_status = status, status = 'blocked', blocked_by = ?, blocked_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [userId, f.id]);
        else {
            const [first, second] = pair(userId, target);
            await connection.query("INSERT INTO friendships (id, user1_id, user2_id, requested_by, status, blocked_by, blocked_at) VALUES (?, ?, ?, ?, 'blocked', ?, CURRENT_TIMESTAMP(6))", [crypto.randomUUID(), first, second, userId, userId]);
        }
    });
    res.json({message: 'User blocked'});
}
async function getBlockedUsers(req, res) {
    const id = req.session.userId;
    const [users] = await db.promise().query(`SELECT f.id AS friendship_id, u.id, u.username, f.blocked_at, f.blocked_previous_status FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END
        WHERE f.status = 'blocked' AND f.blocked_by = ? ORDER BY f.blocked_at DESC`, [id, id]);
    res.json({users});
}
async function unblockUser(req, res) {
    const userId = req.session.userId, target = uuid(req.body.targetUserId, 'Target user ID');
    if (userId === target) fail(400, 'You cannot unblock yourself');
    const restored = await transaction(async connection => {
        const [users] = await connection.query('SELECT id FROM users WHERE id = ?', [target]);
        if (!users.length) fail(404, 'User not found');
        const f = await lockPair(connection, userId, target);
        if (!f || f.status !== 'blocked') fail(409, 'This relationship is not blocked');
        if (f.blocked_by !== userId) fail(403, 'Only the user who blocked this relationship can unblock it');
        if (f.blocked_previous_status === 'accepted') {
            await connection.query("UPDATE friendships SET status = 'accepted', blocked_by = NULL, blocked_at = NULL, blocked_previous_status = NULL WHERE id = ?", [f.id]);
            return true;
        }
        // Unblock a non-friend without granting permission to send messages.
        await connection.query('DELETE FROM friendships WHERE id = ?', [f.id]);
        return false;
    });
    res.json({message: restored ? 'User unblocked. Friendship restored.' : 'User unblocked. You can send a new friend request.', friendshipRestored: restored});
}
async function removeFriend(req, res) {
    const userId = req.session.userId, target = uuid(req.body.targetUserId, 'Target user ID');
    if (userId === target) fail(400, 'You cannot remove yourself');
    await transaction(async connection => {
        const [users] = await connection.query('SELECT id FROM users WHERE id = ?', [target]);
        if (!users.length) fail(404, 'User not found');
        const f = await lockPair(connection, userId, target);
        if (!f) fail(404, 'Friendship not found');
        if (f.status !== 'accepted') fail(409, 'You can only remove an accepted friendship');
        await connection.query('DELETE FROM friendships WHERE id = ?', [f.id]);
    });
    res.json({message: 'Friend removed. Chat history is kept; new messages require a new accepted request.'});
}
module.exports = {sendFriendRequest, getIncomingFriendRequests, getOutgoingFriendRequests, cancelFriendRequest,
    acceptFriendRequest, rejectFriendRequest, getFriends, blockUser, getBlockedUsers, unblockUser, removeFriend};
