// Pont entre l'interface et l'application Windows.
const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('sonora', {
    platform: 'electron',
    os: process.platform, // win32 | darwin | linux
    // Requêtes vers YouTube sans restriction CORS (faites par le processus principal)
    http: (req) => ipcRenderer.invoke('sonora:http', req),
    // Mises à jour automatiques
    appInfo: () => ipcRenderer.invoke('sonora:app-info'),
    checkUpdate: () => ipcRenderer.invoke('sonora:update-check'),
    installUpdate: () => ipcRenderer.invoke('sonora:update-install'),
    onUpdate: (fn) => ipcRenderer.on('sonora:update', (_e, info) => fn(info)),
  });
} else if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname)) {
  // Lecteur YouTube intégré (iframe) : bloqueur de publicités
  contextBridge.executeInMainWorld({ func: require('./adblock-fn.js') });
}
