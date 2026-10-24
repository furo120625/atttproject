const el = id => document.getElementById(id);
// Binding used by the unchanged original sendEncryptedMessage function.
const currentUserId = el('currentUserId');
let sessionPassword = null, currentConversationId = null, currentConversationUserId = null;
let currentFriendshipStatus = null, currentBlockedBy = null;
let ready = false, refreshing = false, sending = false, openingChat = false, peerVerified = false, keyPair = null;
let viewVersion = 0, listVersion = 0, found = null;
const userCache = new Map(), plaintextCache = new Map();
class CancelledAction extends Error {}
function notice(message, error = false) {
    el('operationStatus').textContent = message; el('operationStatus').classList.toggle('error', error);
}
function report(error, target) {
    if (error instanceof CancelledAction) return;
    if (target) el(target).textContent = error.message;
    notice(error.message, true);
}
function confirmAction(title, description) {
    const dialog = el('confirmDialog');
    if (dialog.open) return Promise.resolve(false);
    el('confirmTitle').textContent = title; el('confirmDescription').textContent = description;
    dialog.returnValue = 'no';
    return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), {once: true});
        dialog.showModal(); el('confirmNo').focus();
    });
}
function confirmationFor(url, body) {
    const name = userCache.get(body.targetUserId || body.friendId) || found?.user.username || 'người dùng này';
    if (url.endsWith('/auth/register')) return ['Tạo tài khoản?', 'Bạn xác nhận tạo tài khoản với thông tin vừa nhập?'];
    if (url.endsWith('/auth/login')) return ['Đăng nhập?', 'Bạn xác nhận đăng nhập tài khoản này?'];
    if (url.endsWith('/auth/logout')) return ['Đăng xuất?', 'Bạn sẽ cần đăng nhập lại để tiếp tục chat.'];
    if (url.endsWith('/friendships/request')) return ['Gửi lời mời kết bạn?', `Gửi lời mời đến ${name}? Người nhận cần chấp nhận trước khi nhắn tin.`];
    if (url.endsWith('/friendships/block')) return ['Chặn người dùng?', `Chặn ${name}? Hai bên sẽ không gửi được tin mới. Lịch sử chat được giữ lại.`];
    if (url.endsWith('/friendships/unblock')) return ['Bỏ chặn?', `Bỏ chặn ${name}? Nếu hai bên là bạn trước khi chặn, tình bạn được khôi phục. Nếu chưa là bạn, cần gửi lời mời mới.`];
    if (url.endsWith('/friendships/remove')) return ['Xóa bạn?', `Xóa ${name} khỏi danh sách bạn? Lịch sử chat vẫn còn. Hai bên cần kết bạn lại để gửi tin mới.`];
    if (url.endsWith('/accept')) return ['Chấp nhận kết bạn?', 'Hai bên sẽ có thể nhắn tin sau khi bạn chọn Yes.'];
    if (url.endsWith('/reject')) return ['Từ chối lời mời?', 'Lời mời sẽ được từ chối. Người gửi có thể gửi lại lời mời sau này.'];
    if (url.endsWith('/cancel')) return ['Hủy lời mời đã gửi?', 'Người nhận sẽ không còn thấy lời mời này. Bạn có thể gửi lời mời mới sau đó.'];
    if (url.endsWith('/conversations')) return ['Mở cuộc trò chuyện?', `Mở chat với ${name}? Nếu đã có chat, lịch sử cũ sẽ được dùng lại.`];
    return ['Xác nhận thao tác?', 'Chọn Yes để tiếp tục hoặc No để giữ nguyên.'];
}
async function api(url, body) {
    if (body !== undefined && !await confirmAction(...confirmationFor(url, body))) throw new CancelledAction();
    const response = await fetch(url, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) {
        if (response.status === 401 && ready) clearSession();
        throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
}
function paragraph(parent, text, className) {
    const p = document.createElement('p'); p.textContent = text; if (className) p.className = className;
    parent.append(p); return p;
}
function button(parent, label, work, action, danger = false) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    if (action) b.dataset.action = action; if (danger) b.classList.add('danger');
    b.addEventListener('click', async () => {
        b.disabled = true;
        try { await work(); } catch (error) { report(error); } finally { b.disabled = false; }
    });
    parent.append(b); return b;
}
function row(parent, title, detail) {
    const item = document.createElement('div'); item.className = 'list-row';
    const info = document.createElement('div'); info.className = 'list-info';
    paragraph(info, title, 'list-title'); if (detail) paragraph(info, detail, 'list-detail');
    const actions = document.createElement('div'); actions.className = 'row-actions';
    item.append(info, actions); parent.append(item); return actions;
}
function empty(parent, text) { if (!parent.children.length) paragraph(parent, text, 'empty-state'); }
function clearSession() {
    if (el('confirmDialog').open) el('confirmDialog').close('no');
    ready = false; peerVerified = false; el('ownFingerprint').textContent = ''; sessionPassword = null; keyPair = null; found = null;
    currentUserId.textContent = ''; currentConversationId = null; currentConversationUserId = null;
    currentFriendshipStatus = null; currentBlockedBy = null; viewVersion++; listVersion++;
    userCache.clear(); plaintextCache.clear();
    for (const id of ['friendsList', 'friendRequests', 'outgoingRequests', 'conversationsList', 'messagesList', 'blockedUsers', 'chatActions', 'foundExtraActions']) el(id).replaceChildren();
    el('userInfo').hidden = true; el('chatSection').hidden = true; el('foundUser').hidden = true;
    el('loginSection').hidden = false; el('registerSection').hidden = true; el('loginForm').reset();
    el('messageInput').value = ''; notice('');
}
async function showUser(user, password) {
    el('username').textContent = `Username: ${user.username}`; el('userEmail').textContent = `Email: ${user.email}`;
    currentUserId.textContent = user.id; userCache.set(user.id, user.username);
    sessionPassword = password || null; ready = true;
    el('loginSection').hidden = true; el('registerSection').hidden = true; el('userInfo').hidden = false;
    el('keyStatus').textContent = 'Preparing encryption keys...';
    try {
        const keys = await getOrCreateKeyPair(user.id, sessionPassword);
        if (!ready || currentUserId.textContent !== user.id) return;
        keyPair = keys; el('keyStatus').textContent = 'Khóa v2 sẵn sàng: X25519 + AES-GCM + Ed25519.';
        const own = await SecureKeys.peer(user.id); el('ownFingerprint').textContent = own.fingerprint;
    } catch (error) { keyPair = null; el('keyStatus').textContent = error.message; }
    finally { sessionPassword = null; el('loginForm').reset(); }
    await refreshLists();
}
async function relationshipAction(action, userId) {
    const data = await api(`/api/friendships/${action}`, {targetUserId: userId}); notice(data.message); await refreshLists();
}
async function decideRequest(id, action) {
    const data = await api(`/api/friendships/${id}/${action}`, {}); notice(data.message); await refreshLists();
}
async function chatWith(userId) {
    if (openingChat) return;
    openingChat = true; updateSendState();
    try {
        const data = await api('/api/conversations', {friendId: userId});
        await refreshLists(); await openConversation(data.conversationId, userId, 'accepted');
    } finally { openingChat = false; updateSendState(); }
}
const statusLabels = {accepted: 'Bạn bè', pending: 'Đang chờ kết bạn', rejected: 'Đã từ chối', blocked: 'Đã chặn'};
function renderFound() {
    if (!found) return;
    const user = found.user, relation = found.relationship, mine = currentUserId.textContent;
    const self = user.id === mine, blocked = relation?.status === 'blocked';
    el('foundUsername').textContent = user.username; el('foundUserId').textContent = user.id;
    el('foundRelationship').textContent = self ? 'Đây là tài khoản của bạn.' : blocked ?
        (relation.blocked_by === mine ? 'Bạn đang chặn người này.' : 'Người này đang chặn bạn.') : (statusLabels[relation?.status] || 'Chưa kết bạn');
    el('addFriend').hidden = self || ['accepted', 'pending', 'blocked'].includes(relation?.status);
    el('blockFoundUser').hidden = self || blocked;
    const actions = el('foundExtraActions'); actions.replaceChildren();
    if (relation?.status === 'accepted') {
        button(actions, 'Mở chat', () => chatWith(user.id), 'open-chat');
        button(actions, 'Xóa bạn', () => relationshipAction('remove', user.id), 'remove', true);
    } else if (blocked && relation.blocked_by === mine) button(actions, 'Bỏ chặn', () => relationshipAction('unblock', user.id), 'unblock');
    else if (relation?.status === 'pending') {
        if (relation.requested_by === mine) button(actions, 'Hủy lời mời', () => decideRequest(relation.id, 'cancel'), 'cancel');
        else { button(actions, 'Chấp nhận', () => decideRequest(relation.id, 'accept'), 'accept'); button(actions, 'Từ chối', () => decideRequest(relation.id, 'reject'), 'reject'); }
    }
}
async function refreshLists() {
    if (!ready) return;
    const id = currentUserId.textContent, version = ++listVersion, foundId = found?.user.id;
    const [incoming, outgoing, friends, conversations, blocked, foundResult] = await Promise.all([
        api('/api/friendships/requests'), api('/api/friendships/outgoing'), api('/api/friendships'), api('/api/conversations'),
        api('/api/friendships/blocked'), foundId ? api(`/api/users/${foundId}`) : null]);
    if (!ready || id !== currentUserId.textContent || version !== listVersion) return;
    for (const request of [...incoming.requests, ...outgoing.requests]) userCache.set(request.user_id, request.username);
    el('friendRequests').replaceChildren();
    for (const request of incoming.requests) {
        const actions = row(el('friendRequests'), request.username, request.user_id);
        button(actions, 'Chấp nhận', () => decideRequest(request.id, 'accept'), 'accept');
        button(actions, 'Từ chối', () => decideRequest(request.id, 'reject'), 'reject');
        button(actions, 'Chặn', () => relationshipAction('block', request.user_id), 'block', true);
    }
    empty(el('friendRequests'), 'Không có lời mời mới.'); el('outgoingRequests').replaceChildren();
    for (const request of outgoing.requests) {
        const actions = row(el('outgoingRequests'), request.username, 'Đang chờ người nhận chấp nhận');
        button(actions, 'Hủy lời mời', () => decideRequest(request.id, 'cancel'), 'cancel');
    }
    empty(el('outgoingRequests'), 'Chưa có lời mời đang chờ.'); el('friendsList').replaceChildren();
    for (const friend of friends.friends) {
        userCache.set(friend.id, friend.username); const actions = row(el('friendsList'), friend.username, friend.id);
        button(actions, 'Mở chat', () => chatWith(friend.id), 'open-chat');
        button(actions, 'Xóa bạn', () => relationshipAction('remove', friend.id), 'remove', true);
        button(actions, 'Chặn', () => relationshipAction('block', friend.id), 'block', true);
    }
    empty(el('friendsList'), 'Chưa có bạn. Tìm User ID để gửi lời mời.'); el('conversationsList').replaceChildren();
    for (const conversation of conversations) {
        userCache.set(conversation.user_id, conversation.username);
        const actions = row(el('conversationsList'), conversation.username, statusLabels[conversation.friendship_status] || 'Chưa kết bạn • lịch sử được giữ');
        button(actions, 'Mở chat', () => openConversation(conversation.conversation_id, conversation.user_id, conversation.friendship_status, conversation.blocked_by), 'open-chat');
        if (currentConversationId === conversation.conversation_id) { currentFriendshipStatus = conversation.friendship_status; currentBlockedBy = conversation.blocked_by; }
    }
    empty(el('conversationsList'), 'Chưa có cuộc trò chuyện.'); el('blockedUsers').replaceChildren();
    for (const user of blocked.users) {
        userCache.set(user.id, user.username);
        const actions = row(el('blockedUsers'), user.username, user.id + ' • ' + (user.blocked_previous_status === 'accepted' ? 'Bỏ chặn để khôi phục bạn bè' : 'Bỏ chặn để có thể gửi lời mời mới'));
        button(actions, 'Bỏ chặn', () => relationshipAction('unblock', user.id), 'unblock');
    }
    empty(el('blockedUsers'), 'Bạn chưa chặn ai.');
    if (foundResult && found?.user.id === foundId) { found = foundResult; renderFound(); }
    updateSendState();
}
function updateSendState() {
    const accepted = currentFriendshipStatus === 'accepted';
    el('messageInput').disabled = openingChat || !keyPair || !accepted || !peerVerified;
    el('sendMessageButton').disabled = openingChat || sending || !keyPair || !accepted || !peerVerified;
    el('chatRelationship').textContent = currentFriendshipStatus === 'blocked' ?
        (currentBlockedBy === currentUserId.textContent ? 'Bạn đã chặn người này. Bỏ chặn để tiếp tục; lịch sử vẫn đọc được.' : 'Người này đang chặn bạn. Chỉ họ có thể bỏ chặn; lịch sử vẫn đọc được.') :
        !accepted && currentConversationId ? 'Hai bên chưa là bạn. Cần lời mời được chấp nhận để gửi tin mới; lịch sử vẫn còn.' : '';
    const actions = el('chatActions'); actions.replaceChildren(); if (!currentConversationUserId) return;
    const peer = currentConversationUserId;
    if (accepted) { button(actions, 'Xóa bạn', () => relationshipAction('remove', peer), 'remove', true); button(actions, 'Chặn', () => relationshipAction('block', peer), 'block', true); }
    else if (currentFriendshipStatus === 'blocked' && currentBlockedBy === currentUserId.textContent) button(actions, 'Bỏ chặn', () => relationshipAction('unblock', peer), 'unblock');
    else if (!currentFriendshipStatus || currentFriendshipStatus === 'rejected') button(actions, 'Kết bạn lại', () => relationshipAction('request', peer), 'request');
}
async function openConversation(id, peer, status, blockedBy = null) {
    peerVerified = false; currentConversationId = id; currentConversationUserId = peer; currentFriendshipStatus = status; currentBlockedBy = blockedBy;
    viewVersion++; el('chatSection').hidden = false; el('chatUser').textContent = `Chat: ${userCache.get(peer) || peer}`;
    el('messagesList').replaceChildren(); el('messageInput').value = ''; el('messageStatus').textContent = '';
    updateSendState();
    try { peerVerified = await SecureChat.showPeer(peer); } catch (error) { el('peerSecurityStatus').textContent = error.message; }
    updateSendState(); await refreshMessages();
}
async function refreshMessages() {
    if (!ready || !currentConversationId) return;
    const version = viewVersion, myId = currentUserId.textContent, conversation = currentConversationId, peer = currentConversationUserId;
    try { peerVerified = await SecureChat.showPeer(peer); } catch { peerVerified = false; }
    if (!peerVerified) plaintextCache.clear();
    updateSendState();
    const messages = await api(`/api/messages/${conversation}`);
    const fragment = document.createDocumentFragment();
    for (const message of messages) {
        const item = document.createElement('div'); item.className = 'chat-message'; if (message.sender_id === myId) item.classList.add('mine');
        paragraph(item, userCache.get(message.sender_id) || message.sender_id, 'message-sender');
        let text = 'Khóa đang bị khóa. Đăng nhập lại để đọc tin.';
        if (keyPair) {
            const cacheKey = JSON.stringify(message);
            if (plaintextCache.get(message.id)?.source !== cacheKey) {
                try { plaintextCache.set(message.id, {source: cacheKey, text: await SecureChat.decrypt(message, keyPair.privateKey, conversation, peer)}); }
                catch { plaintextCache.set(message.id, {source: cacheKey, text: '[Chưa xác minh khóa hoặc tin nhắn không hợp lệ]'}); }
            }
            text = plaintextCache.get(message.id).text;
        }
        paragraph(item, text, 'message-text'); const time = document.createElement('time'); time.dateTime = message.created_at;
        time.textContent = new Date(message.created_at).toLocaleString('vi-VN'); item.append(time); fragment.append(item);
    }
    if (!ready || version !== viewVersion || myId !== currentUserId.textContent) return;
    const list = el('messagesList'), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const oldScroll = list.scrollTop, oldCount = list.querySelectorAll('.chat-message').length;
    list.replaceChildren(fragment); empty(list, 'Chưa có tin nhắn.');
    if (nearBottom || !oldCount) list.scrollTop = list.scrollHeight; else list.scrollTop = oldScroll;
}
el('showRegister').addEventListener('click', () => { el('loginSection').hidden = true; el('registerSection').hidden = false; });
el('showLogin').addEventListener('click', () => { el('registerSection').hidden = true; el('loginSection').hidden = false; });
el('registerForm').addEventListener('submit', async event => {
    event.preventDefault(); const submit = el('registerForm').querySelector('button[type=submit]'); if (submit.disabled) return;
    const password = el('registerPassword').value;
    if (password !== el('confirmPassword').value) { el('registerMessage').textContent = 'Passwords do not match'; return; }
    submit.disabled = true;
    try {
        await api('/api/auth/register', {username: el('registerUsername').value, email: el('registerEmail').value, password});
        el('registerForm').reset(); el('registerSection').hidden = true; el('loginSection').hidden = false; el('loginMessage').textContent = 'Account created. You can now log in.';
    } catch (error) { report(error, 'registerMessage'); } finally { submit.disabled = false; }
});
el('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const submit = el('loginForm').querySelector('button[type=submit]'); if (submit.disabled) return; submit.disabled = true;
    try {
        const password = el('loginPassword').value, data = await api('/api/auth/login', {email: el('loginEmail').value, password});
        await showUser(data.user, password); el('loginMessage').textContent = ''; notice('');
    } catch (error) { report(error, 'loginMessage'); } finally { submit.disabled = false; }
});
el('logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', {}); clearSession(); el('loginMessage').textContent = 'You have been logged out.'; } catch (error) { report(error, 'logoutMessage'); }
});
el('findUserForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        found = await api(`/api/users/${encodeURIComponent(el('userId').value.trim())}`); userCache.set(found.user.id, found.user.username);
        renderFound(); el('foundUser').hidden = false; el('findUserMessage').textContent = '';
    } catch (error) { found = null; el('foundUser').hidden = true; report(error, 'findUserMessage'); }
});
el('addFriend').addEventListener('click', async () => { try { if (found) await relationshipAction('request', found.user.id); } catch (error) { report(error); } });
el('blockFoundUser').addEventListener('click', async () => { try { if (found) await relationshipAction('block', found.user.id); } catch (error) { report(error); } });
el('copyUserId').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(currentUserId.textContent); el('copyMessage').textContent = 'User ID copied'; } catch { el('copyMessage').textContent = 'Select and copy your User ID manually.'; }
});
el('messageForm').addEventListener('submit', async event => {
    event.preventDefault(); if (sending) return;
    const message = el('messageInput').value.trim(); if (!message || !currentConversationId || !keyPair || currentFriendshipStatus !== 'accepted') return;
    if (new TextEncoder().encode(message).length > 8192) { el('messageStatus').textContent = 'Message is limited to 8192 UTF-8 bytes.'; return; }
    sending = true; updateSendState(); const version = viewVersion, conversation = currentConversationId, peer = currentConversationUserId;
    try {
        if (!await confirmAction('Gửi tin nhắn?', `Gửi tin này đến ${userCache.get(peer) || peer}? Chọn No sẽ giữ nguyên bản nháp.`)) return;
        if (!ready || version !== viewVersion) return;
        await SecureChat.send(conversation, peer, message);
        if (version === viewVersion) { el('messageInput').value = ''; el('messageStatus').textContent = 'Đã gửi tin.'; await refreshMessages(); }
    } catch (error) { report(error, 'messageStatus'); } finally { sending = false; updateSendState(); }
});
el('verifyPeer').addEventListener('click', async () => {
    try {
        const peer = currentConversationUserId; if (!peer) return;
        if (!await confirmAction('Xác minh người nhận?', 'Bạn đã đối chiếu fingerprint với chính người này qua kênh tin cậy?')) return;
        await SecureKeys.trust(peer, el('peerVerifyInput').value); el('peerVerifyInput').value = '';
        peerVerified = await SecureChat.showPeer(peer); plaintextCache.clear(); updateSendState(); await refreshMessages();
    } catch (error) { report(error, 'peerSecurityStatus'); }
});
el('messageInput').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el('messageForm').requestSubmit(); } });
setInterval(async () => {
    if (!ready || refreshing || document.hidden || document.querySelector('dialog[open]')) return;
    refreshing = true; try { await refreshLists(); await refreshMessages(); } catch (error) { if (ready) report(error, 'messageStatus'); } finally { refreshing = false; }
}, 2500);
(async () => { try { const data = await api('/api/auth/me'); await showUser(data.user); } catch (error) { el('loginMessage').textContent = error.message === 'Not authenticated' ? '' : error.message; } })();
