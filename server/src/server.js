const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const db = require('./config/database');
const auth = require('./middleware/auth');
const security = require('./middleware/security');
const rateLimit = require('./middleware/rateLimit');
const debugRequests = require('./middleware/debugRequests');
const {endpoint, errorHandler, fail, ApiError} = require('./utils/api');
const accounts = require('./controllers/authController');
const users = require('./controllers/userController');
const friends = require('./controllers/friendshipController');
const keys = require('./controllers/keyController');
const messages = require('./controllers/messageController');
const conversations = require('./controllers/conversationController');
function makeSessionStore() {
    return new MySQLStore({expiration: 24 * 60 * 60 * 1000, endConnectionOnClose: true},
        require('mysql2/promise').createPool({...require('./config/connection'), charset: 'utf8mb4_bin'}));
}
function createApp({store} = {}) {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('REPLACE_')) throw new Error('Set SESSION_SECRET to a random string of at least 32 characters in server/.env');
    const app = express();
    app.disable('x-powered-by');
    app.use(debugRequests());
    app.use(security.headers);
    if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
    app.use(express.json({limit: '128kb'}));
    app.use((req, res, next) => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('Origin')) {
            try {
                const origin = new URL(req.get('Origin'));
                if (origin.host !== req.get('Host') || origin.protocol !== `${req.protocol}:`) fail(403, 'Cross-origin write request is not allowed');
            } catch (error) { return next(error instanceof ApiError ? error : new ApiError(400, 'Invalid Origin header')); }
        }
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body !== undefined &&
            (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({message: 'JSON body must be an object'});
        req.body ??= {};
        next();
    });
    const sessionStore = store || makeSessionStore();
    app.locals.sessionStore = sessionStore;
    app.use(session({secret: process.env.SESSION_SECRET, store: sessionStore, resave: false,
        saveUninitialized: false, cookie: {httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 86400000}}));
    app.get('/api/security/csrf', (req, res) => res.json({csrfToken: security.token(req)}));
    app.use(security.csrf);
    const authLimit = rateLimit({limit: 15, windowMs: 60000, key: req => req.ip});
    const friendsLimit = rateLimit({limit: 20, windowMs: 60000});
    const sendLimit = rateLimit({limit: 30, windowMs: 10000});
    const keyLimit = rateLimit({limit: 10, windowMs: 60000});
    const createLimit = rateLimit({limit: 30, windowMs: 60000});
    app.post('/api/auth/register', authLimit, endpoint(accounts.register));
    app.post('/api/auth/login', authLimit, endpoint(accounts.login));
    app.use('/api', auth);
    app.get('/api/auth/me', endpoint(accounts.me));
    app.post('/api/auth/logout', endpoint(async (req, res) => {
        await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie('connect.sid', {httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production'});
        res.json({message: 'Logout successful'});
    }));
    app.get('/api/users/:id', endpoint(users.getUserById));
    app.post('/api/friendships/request', friendsLimit, endpoint(friends.sendFriendRequest));
    app.get('/api/friendships/requests', endpoint(friends.getIncomingFriendRequests));
    app.get('/api/friendships/outgoing', endpoint(friends.getOutgoingFriendRequests));
    app.post('/api/friendships/:id/cancel', friendsLimit, endpoint(friends.cancelFriendRequest));
    app.post('/api/friendships/:id/accept', friendsLimit, endpoint(friends.acceptFriendRequest));
    app.post('/api/friendships/:id/reject', friendsLimit, endpoint(friends.rejectFriendRequest));
    app.get('/api/friendships', endpoint(friends.getFriends));
    app.post('/api/friendships/block', friendsLimit, endpoint(friends.blockUser));
    app.post('/api/friendships/unblock', friendsLimit, endpoint(friends.unblockUser));
    app.post('/api/friendships/remove', friendsLimit, endpoint(friends.removeFriend));
    app.get('/api/friendships/blocked', endpoint(friends.getBlockedUsers));
    app.post('/api/keys/public', keyLimit, endpoint(keys.savePublicKey));
    app.get('/api/keys/public/:userId', endpoint(keys.getPublicKey));
    app.get('/api/keys/private', endpoint(keys.getMyPrivateKey));
    app.post('/api/conversations', createLimit, endpoint(conversations.createConversation));
    app.get('/api/conversations', endpoint(conversations.getConversations));
    app.post('/api/messages', sendLimit, endpoint(messages.sendMessage));
    app.get('/api/messages/:conversationId', endpoint(messages.getMessages));
    // Java HTTP compatibility. IDs are UUIDs; all routes use the login session.
    app.get('/users/:id/public-key', auth, endpoint(keys.getPublicKey));
    app.post('/users/:id/public-key', auth, keyLimit, endpoint(keys.savePublicKey));
    app.post('/messages', auth, sendLimit, endpoint(messages.sendMessage));
    app.get('/messages/:id', auth, endpoint(messages.getJavaInbox));
    app.use('/api', (req, res) => res.status(404).json({message: 'API route not found'}));
    app.use(express.static(path.resolve(__dirname, '../../client')));
    app.use((req, res) => res.status(404).json({message: 'Route not found'}));
    app.use(errorHandler);
    return app;
}
async function start() {
    const app = createApp(), store = app.locals.sessionStore;
    try {
        await db.promise().query('SELECT 1');
        await store.onReady();
        const port = Number(process.env.PORT || 3000);
        const server = app.listen(port, '0.0.0.0', () => {
            console.log(`Seruchat: http://localhost:${port}`);
            if (process.env.DEBUG_API === '1') console.log('API tracing enabled: action, route, status and duration. Automatic polling also appears here.');
        });
        server.on('error', error => { console.error('Server failed:', error.message); store.close(); db.end(); process.exitCode = 1; });
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => {
            store.close(); db.end();
        }));
    } catch (error) { console.error('Startup failed:', error.message); await store.close(); await db.promise().end(); process.exitCode = 1; }
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {createApp, start};
