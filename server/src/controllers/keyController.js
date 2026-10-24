const crypto = require('crypto');
const db = require('../config/database');
const {fail, uuid, publicKey, base64} = require('../utils/api');
const {transaction} = require('../utils/transactions');
function signingKey(value) {
    base64(value, 'Signing public key', {max: 128});
    try { if (crypto.createPublicKey({key: Buffer.from(value, 'base64'), format: 'der', type: 'spki'}).asymmetricKeyType !== 'ed25519') fail(400, 'Signing key must be Ed25519'); }
    catch { fail(400, 'Signing key must be Ed25519 SPKI'); }
    return value;
}
async function savePublicKey(req, res) {
    const id = req.session.userId;
    if (req.params.id && uuid(req.params.id) !== id) fail(403, 'You can only publish your own key');
    const key = publicKey(req.body.publicKey), sign = signingKey(req.body.signingPublicKey);
    if (req.body.backupVersion !== 2) fail(400, 'Recovery backup version 2 is required. Use the upgraded client.');
    if (req.body.algorithm && req.body.algorithm !== 'X25519') fail(400, 'Algorithm must be X25519');
    const encrypted = base64(req.body.encryptedPrivateKey, 'Encrypted key bundle', {min: 16, max: 4096});
    const salt = base64(req.body.salt, 'Key salt', {bytes: 16}), iv = base64(req.body.iv, 'Key IV', {bytes: 12});
    const proof = base64(req.body.keyProof, 'Key proof', {bytes: 64});
    const canonical = ['seruchat-key-v2', id, key, sign, encrypted, salt, iv].join('|');
    if (!crypto.verify(null, Buffer.from(canonical), {key: Buffer.from(sign, 'base64'), format: 'der', type: 'spki'}, Buffer.from(proof, 'base64'))) fail(400, 'Invalid signing-key proof');
    await transaction(async connection => {
        const [users] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
        if (!users.length) fail(401, 'User no longer exists');
        const [keys] = await connection.query('SELECT public_key, signing_public_key FROM public_keys WHERE user_id = ?', [id]);
        if (keys.length && (keys[0].public_key !== key || (keys[0].signing_public_key && keys[0].signing_public_key !== sign))) fail(409, 'Registered keys cannot be replaced. Restore your original keys.');
        if (!keys.length) await connection.query(`INSERT INTO public_keys
            (user_id, public_key, signing_public_key, backup_version, algorithm, encrypted_private_key, encryption_salt, encryption_iv)
            VALUES (?, ?, ?, 2, 'X25519', ?, ?, ?)`, [id, key, sign, encrypted, salt, iv]);
        else await connection.query(`UPDATE public_keys SET signing_public_key = ?, backup_version = 2,
            encrypted_private_key = ?, encryption_salt = ?, encryption_iv = ? WHERE user_id = ?`, [sign, encrypted, salt, iv, id]);
    });
    res.json({message: 'Keys and recovery-encrypted backup saved'});
}
async function getPublicKey(req, res) {
    const id = uuid(req.params.userId || req.params.id);
    const [keys] = await db.promise().query('SELECT public_key, signing_public_key, backup_version, algorithm FROM public_keys WHERE user_id = ?', [id]);
    if (!keys.length) fail(404, 'Public key not found');
    res.json({publicKey: keys[0].public_key, signingPublicKey: keys[0].signing_public_key, backupVersion: keys[0].backup_version, algorithm: keys[0].algorithm});
}
async function getMyPrivateKey(req, res) {
    const [keys] = await db.promise().query('SELECT encrypted_private_key, encryption_salt, encryption_iv, backup_version FROM public_keys WHERE user_id = ?', [req.session.userId]);
    if (!keys.length || !keys[0].encrypted_private_key) fail(404, 'Encrypted private key not available');
    res.json({encryptedPrivateKey: keys[0].encrypted_private_key, salt: keys[0].encryption_salt, iv: keys[0].encryption_iv, backupVersion: keys[0].backup_version});
}
module.exports = {savePublicKey, getPublicKey, getMyPrivateKey, signingKey};
