const { contextBridge, app } = require('electron');
const packageJson = require('./package.json');

contextBridge.exposeInMainWorld('appInfo', {
    version: packageJson.version,
    name: packageJson.name
});
