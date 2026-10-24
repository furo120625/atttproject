const crypto = require('crypto');
class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ApiError(status, message); };
function uuid(value, label = 'User ID') {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(400, `${label} is invalid`);
    return value.toLowerCase();
}
function text(value, label, max, trim = true) {
    if (typeof value !== 'string') fail(400, `${label} must be a string`);
    const result = trim ? value.trim() : value;
    if (!result.length || Array.from(result).length > max) fail(400, `${label} must contain 1-${max} characters`);
    return result;
}
function base64(value, label, {bytes, min = 1, max = 32768} = {}) {
    if (typeof value !== 'string' || !value.length || value.length > Math.ceil(max / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(400, `${label} must be valid Base64`);
    const data = Buffer.from(value, 'base64');
    if (data.toString('base64') !== value || data.length < min || data.length > max || (bytes && data.length !== bytes)) fail(400, `${label} has an invalid length`);
    return value;
}
function publicKey(value, label = 'Public key') {
    base64(value, label, {max: 128});
    try {
        const key = crypto.createPublicKey({key: Buffer.from(value, 'base64'), format: 'der', type: 'spki'});
        if (key.asymmetricKeyType !== 'x25519') fail(400, `${label} must be X25519 SPKI`);
    } catch (error) { if (error instanceof ApiError) throw error; fail(400, `${label} must be X25519 SPKI`); }
    return value;
}
function pair(a, b) { return a < b ? [a, b] : [b, a]; }
const endpoint = handler => async (req, res, next) => {
    try { await handler(req, res); } catch (error) { next(error); }
};
function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    if (error.csrf) return res.status(403).json({message: error.message});
    if (error instanceof ApiError) return res.status(error.status).json({message: error.message});
    if (error.type === 'entity.parse.failed') return res.status(400).json({message: 'Invalid JSON body'});
    if (error.type === 'entity.too.large') return res.status(413).json({message: 'Request body is too large'});
    const mapping = {
        ER_DUP_ENTRY: [409, 'This record already exists'],
        ER_NO_REFERENCED_ROW_2: [404, 'Referenced user or record does not exist'],
        ER_ROW_IS_REFERENCED_2: [409, 'Record is still in use'],
        ER_CHECK_CONSTRAINT_VIOLATED: [400, 'Data violates a database constraint'],
        ER_DATA_TOO_LONG: [400, 'One or more fields are too long'],
        ER_LOCK_DEADLOCK: [409, 'Concurrent change; please retry'],
        ER_LOCK_WAIT_TIMEOUT: [409, 'Concurrent change; please retry']
    };
    if (mapping[error.code]) { const [status, message] = mapping[error.code]; return res.status(status).json({message}); }
    console.error('API error:', error.code || error.name);
    res.status(500).json({message: 'Internal server error'});
}
module.exports = {ApiError, fail, uuid, text, base64, publicKey, pair, endpoint, errorHandler};
