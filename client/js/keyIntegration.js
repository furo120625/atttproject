// Keep original crypto files unchanged; route key lifecycle through recovery vault v2.
const keySetupTasks = new Map();
getOrCreateKeyPair = function(userId, password) {
    if (!keySetupTasks.has(userId)) keySetupTasks.set(userId,
        SecureKeys.setup(userId, password).finally(() => keySetupTasks.delete(userId)));
    return keySetupTasks.get(userId);
};
