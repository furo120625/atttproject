/* Canonical wire format shared by browser and Node. No secrets in this file. */
(function(root) {
    const fields = ['id', 'conversationId', 'senderId', 'recipientId', 'nonce', 'ciphertext', 'senderPublicKey', 'selfNonce', 'selfCiphertext', 'selfPublicKey'];
    const protocol = {
        aad(e, role) { return ['seruchat-aad-v2', e.id, e.conversationId, e.senderId, e.recipientId, role].join('|'); },
        signed(e) { return ['seruchat-signature-v2', ...fields.map(f => e[f])].join('|'); },
        fromRow(r) { return {version: Number(r.protocol_version), id: r.id, conversationId: r.conversation_id,
            senderId: r.sender_id, recipientId: r.recipient_id, nonce: r.nonce, ciphertext: r.ciphertext,
            senderPublicKey: r.sender_public_key, selfNonce: r.self_nonce, selfCiphertext: r.self_ciphertext,
            selfPublicKey: r.self_public_key, signature: r.signature, signingPublicKey: r.sender_signing_key}; }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = protocol;
    else root.ChatProtocol = protocol;
})(globalThis);
