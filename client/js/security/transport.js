// One origin, session-bound CSRF token. Raw fetch retained only inside this adapter.
const nativeChatFetch = window.fetch.bind(window);
let csrfToken = null, csrfTask = null;
async function chatCsrf() {
    if (!csrfTask) csrfTask = nativeChatFetch('/api/security/csrf', {cache: 'no-store'}).then(async r => {
        const data = await r.json(); if (!r.ok) throw new Error(data.message); csrfToken = data.csrfToken;
    }).finally(() => { csrfTask = null; });
    await csrfTask;
}
window.fetch = async function(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) throw new Error('Chat requests must use the same origin.');
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        if (!csrfToken) await chatCsrf();
        const headers = new Headers(options.headers); headers.set('X-CSRF-Token', csrfToken);
        options = {...options, headers};
    }
    const response = await nativeChatFetch(input, {...options, cache: 'no-store'});
    const next = response.headers.get('X-CSRF-Token'); if (next) csrfToken = next;
    if (response.ok && url.pathname.endsWith('/auth/logout')) csrfToken = null;
    if (response.status === 403) csrfToken = null;
    return response;
};
