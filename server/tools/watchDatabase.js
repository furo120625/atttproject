// Read-only observer, independent of the API server; uses server/.env.
const db = require('../src/config/database');
const tables = ['users', 'public_keys', 'friendships', 'conversations', 'conversation_members', 'messages', 'sessions'];
const countsSql = tables.map(table => `SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM \`${table}\``).join(' UNION ALL ');
let timer, stopped = false, previous = null;

async function poll() {
    try {
        const [[counts], [messages]] = await Promise.all([
            db.promise().query(countsSql),
            db.promise().query('SELECT id, sender_id, conversation_id, ciphertext, nonce FROM messages ORDER BY created_at DESC, id DESC LIMIT 5')
        ]);
        if (stopped) return;
        const signature = JSON.stringify([counts, messages]);
        if (signature !== previous) {
            previous = signature;
            console.log(`\n[${new Date().toLocaleTimeString('en-GB', {hour12: false})}] Database snapshot`);
            console.table(counts);
            if (messages.length) console.table(messages.map(row => ({
                message: row.id.slice(0, 8), sender: row.sender_id.slice(0, 8),
                chat: row.conversation_id.slice(0, 8), iv: row.nonce,
                ciphertextChars: row.ciphertext.length, ciphertextPreview: row.ciphertext.slice(0, 48)
            })));
            else console.log('No messages stored yet.');
        }
    } catch (error) {
        if (!stopped) {
            console.error(`Database observer failed (${error.code || 'DB_ERROR'}). Check MySQL and DB_* in server/.env.`);
            await stop(1);
        }
    }
    if (!stopped) timer = setTimeout(poll, 3000);
}
async function stop(code = 0) {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    process.exitCode = code;
    try { await db.promise().end(); } catch { process.exitCode = 1; }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
console.log('Database observer: reads every 3 seconds; prints when the snapshot changes. Ctrl+C stops this observer.');
void poll();
