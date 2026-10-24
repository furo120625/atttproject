const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const debugRequests = require('../src/middleware/debugRequests');

async function serve(enabled, lines, run) {
    const app = express();
    app.use(debugRequests({enabled, write: line => lines.push(line)}));
    app.use(express.json());
    app.post('/api/auth/login', (req, res) => res.status(201).json({ok: true}));
    app.get('/api/messages/:conversationId', (req, res) => res.status(403).json({message: 'Forbidden'}));
    app.use((req, res) => res.status(404).end());
    app.use((error, req, res, next) => res.status(400).json({message: 'Bad JSON'}));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}
test('Request tracing reports completed HTTP results without exposing credentials, bodies, IDs or query strings', async () => {
    const lines = [], secret = 'DO_NOT_LOG_THIS_VALUE';
    await serve(true, lines, async url => {
        let response = await fetch(url + '/api/auth/login?token=' + secret, {
            method: 'POST', headers: {'Content-Type': 'application/json', Cookie: 'connect.sid=' + secret},
            body: JSON.stringify({email: secret, password: secret, privateKey: secret})
        });
        assert.equal(response.status, 201);
        assert.deepEqual(await response.json(), {ok: true});
        response = await fetch(url + '/api/messages/' + secret);
        assert.equal(response.status, 403); await response.text();
        response = await fetch(url + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'});
        assert.equal(response.status, 400); await response.text();
        response = await fetch(url + '/api/' + secret);
        assert.equal(response.status, 404); await response.text();
    });
    assert.equal(lines.length, 4);
    assert.match(lines[0], /LOGIN POST \/api\/auth\/login -> 201 \(\d+\.\d ms\)/);
    assert.match(lines[1], /READ_MESSAGES GET \/api\/messages\/:conversationId -> 403/);
    assert.match(lines[2], /LOGIN POST \/api\/auth\/login -> 400/);
    assert.match(lines[3], /UNKNOWN_API_ROUTE REQUEST \(unmatched\) -> 404/);
    assert.ok(lines.every(line => !line.includes(secret)));
});
test('Disabled tracing leaves HTTP responses unchanged and emits no logs', async () => {
    const lines = [];
    await serve(false, lines, async url => {
        const response = await fetch(url + '/api/auth/login', {method: 'POST'});
        assert.equal(response.status, 201); await response.text();
    });
    assert.deepEqual(lines, []);
});
