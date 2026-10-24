const db = require('../config/database');
const {uuid, fail, pair} = require('../utils/api');
async function getUserById(req, res) {
    const id = uuid(req.params.id);
    const [users] = await db.promise().query('SELECT id, username, created_at FROM users WHERE id = ?', [id]);
    if (!users.length) fail(404, 'User not found');
    const [first, second] = pair(req.session.userId, id);
    const [relations] = await db.promise().query('SELECT id, status, requested_by, blocked_by, blocked_previous_status FROM friendships WHERE user1_id = ? AND user2_id = ?', [first, second]);
    res.json({user: users[0], relationship: relations[0] || null});
}
module.exports = {getUserById};
