const argon2 = require('argon2');
const crypto = require('crypto');
const security = require('../middleware/security');
const db = require('../config/database');
const {text, fail} = require('../utils/api');
function credentials(body, registering = false) {
    const email = text(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email is invalid');
    const password = text(body.password, 'Password', 1024, false);
    return {email, password, ...(registering ? {username: text(body.username, 'Username', 100)} : {})};
}
async function register(req, res) {
    const {username, email, password} = credentials(req.body, true);
    if (Array.from(password).length < 12 || /^(.)\1+$/.test(password) || ['password1234', '123456789012', 'qwerty123456'].includes(password.toLowerCase())) fail(400, 'New passwords need at least 12 characters and must not be a common or repeated password.');
    const [users] = await db.promise().query('SELECT id FROM users WHERE email = ?', [email]);
    if (users.length) fail(409, 'Email already exists');
    const passwordHash = await argon2.hash(password), id = crypto.randomUUID();
    await db.promise().query('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)', [id, username, email, passwordHash]);
    res.status(201).json({message: 'Account created successfully', user: {id, username, email}});
}
async function login(req, res) {
    const {email, password} = credentials(req.body);
    const [users] = await db.promise().query('SELECT id, username, email, password_hash FROM users WHERE email = ?', [email]);
    const user = users[0];
    if (!user || !await argon2.verify(user.password_hash, password)) fail(401, 'Invalid email or password');
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    res.set('X-CSRF-Token', security.token(req));
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({message: 'Login successful', user: {id: user.id, username: user.username, email: user.email}});
}
async function me(req, res) {
    const [rows] = await db.promise().query('SELECT id, username, email FROM users WHERE id = ?', [req.session.userId]);
    if (!rows.length) fail(401, 'User no longer exists');
    res.json({user: rows[0]});
}
module.exports = {register, login, me};
