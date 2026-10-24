const crypto = require('crypto');
const {fail} = require('../utils/api');
function headers(req, res, next) {
    res.set({
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    if (req.path.startsWith('/api/') || req.path.startsWith('/messages') || req.path.startsWith('/users/')) res.set('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production' && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
}
function token(req) { return req.session.csrfToken ||= crypto.randomBytes(32).toString('hex'); }
function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const provided = req.get('X-CSRF-Token'), expected = req.session.csrfToken;
    if (!expected || typeof provided !== 'string' || !/^[a-f0-9]{64}$/.test(provided) ||
        !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return next(Object.assign(new Error('CSRF token missing or invalid. Reload the page.'), {status: 403, csrf: true}));
    next();
}
module.exports = {headers, csrf, token};
