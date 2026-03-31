const { contextBridge, app, ipcRenderer } = require('electron');
const packageJson = require('./package.json');

contextBridge.exposeInMainWorld('appInfo', {
    version: packageJson.version,
    name: packageJson.name,
    isElectron: true
});

contextBridge.exposeInMainWorld('electronAuth', {
    googleAuth: (clientId, scopes) => ipcRenderer.invoke('google-auth', { clientId, scopes })
});
