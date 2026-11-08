// Génère electron/webview-preload.js à partir de adblock/youtube-adblock.js.
// Le script anti-pub est exécuté dans la page via contextBridge.executeInMainWorld,
// ce qui permet de garder l'isolation de contexte activée (sécurité Electron).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'adblock', 'youtube-adblock.js'), 'utf8');
const out = `// Fichier généré automatiquement par scripts/gen-electron-preload.js — ne pas modifier à la main.
require('electron').contextBridge.executeInMainWorld({
  func: function () {
${js}
  },
});
`;
fs.writeFileSync(path.join(ROOT, 'electron', 'webview-preload.js'), out);
const fn = `// Fichier généré automatiquement par scripts/gen-electron-preload.js — ne pas modifier à la main.
module.exports = function sonoraAdblock() {
${js}
};
`;
fs.writeFileSync(path.join(ROOT, 'electron', 'adblock-fn.js'), fn);
console.log('✓ electron/webview-preload.js et electron/adblock-fn.js générés');
