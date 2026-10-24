// Optional request tracing. Never read request bodies, cookies or query strings.
const routes = [
    ['POST', '/api/auth/register', 'REGISTER'],
    ['POST', '/api/auth/login', 'LOGIN'],
    ['GET', '/api/auth/me', 'SESSION_CHECK'],
    ['POST', '/api/auth/logout', 'LOGOUT'],
    ['GET', '/api/users/:id', 'FIND_USER'],
    ['POST', '/api/friendships/request', 'FRIEND_REQUEST'],
    ['GET', '/api/friendships/requests', 'READ_REQUESTS'],
    ['GET', '/api/friendships/outgoing', 'READ_SENT_REQUESTS'],
    ['POST', '/api/friendships/:id/cancel', 'CANCEL_REQUEST'],
    ['POST', '/api/friendships/:id/accept', 'ACCEPT_FRIEND'],
    ['POST', '/api/friendships/:id/reject', 'REJECT_FRIEND'],
    ['GET', '/api/friendships', 'READ_FRIENDS'],
    ['POST', '/api/friendships/block', 'BLOCK_USER'],
    ['POST', '/api/friendships/unblock', 'UNBLOCK_USER'],
    ['POST', '/api/friendships/remove', 'REMOVE_FRIEND'],
    ['GET', '/api/friendships/blocked', 'READ_BLOCKED'],
    ['POST', '/api/keys/public', 'SAVE_PUBLIC_KEY'],
    ['GET', '/api/keys/public/:userId', 'READ_PUBLIC_KEY'],
    ['GET', '/api/keys/private', 'READ_ENCRYPTED_KEY_BACKUP'],
    ['POST', '/api/conversations', 'OPEN_CHAT'],
    ['GET', '/api/conversations', 'READ_CHATS'],
    ['POST', '/api/messages', 'SEND_MESSAGE'],
    ['GET', '/api/messages/:conversationId', 'READ_MESSAGES'],
    ['GET', '/users/:id/public-key', 'JAVA_READ_PUBLIC_KEY'],
    ['POST', '/users/:id/public-key', 'JAVA_SAVE_PUBLIC_KEY'],
    ['POST', '/messages', 'JAVA_SEND_MESSAGE'],
    ['GET', '/messages/:id', 'JAVA_READ_INBOX']
].map(([method, path, action]) => ({method, path, action,
    pattern: new RegExp('^' + path.replace(/:[A-Za-z]+/g, '[^/]+') + '/?$', 'i')}));

module.exports = function debugRequests({enabled = process.env.DEBUG_API === '1', write = line => console.log(line)} = {}) {
    if (!enabled) return (req, res, next) => next();
    return (req, res, next) => {
        const pathname = req.path;
        if (!(pathname === '/api' || pathname.startsWith('/api/') || pathname === '/messages' ||
            pathname.startsWith('/messages/') || pathname.startsWith('/users/'))) return next();
        const route = routes.find(item => item.method === req.method && item.pattern.test(pathname));
        const start = process.hrtime.bigint();
        res.once('finish', () => {
            const elapsed = (Number(process.hrtime.bigint() - start) / 1e6).toFixed(1);
            const time = new Date().toLocaleTimeString('en-GB', {hour12: false});
            // Only constant route templates are printed, never user-supplied IDs or URLs.
            write(`[${time}] ${route?.action || 'UNKNOWN_API_ROUTE'} ${route?.method || 'REQUEST'} ${route?.path || '(unmatched)'} -> ${res.statusCode} (${elapsed} ms)`);
        });
        next();
    };
};
