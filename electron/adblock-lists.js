// Bloqueur de publicités renforcé (ordinateur) : moteur open source de Ghostery (@ghostery/adblocker-electron, MPL-2.0)
// alimenté par les listes de filtres reconnues — EasyList, Peter Lowe et les filtres d'uBlock Origin (dont ceux pour YouTube).
// Les listes sont téléchargées au lancement, gardées sur l'appareil et renouvelées tous les 4 jours.
// Tant qu'elles ne sont pas chargées (ou sans connexion), la liste intégrée d'Enora continue de bloquer.
const { app, net, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_AGE = 4 * 24 * 3600 * 1000;
const FR_LIST = 'https://easylist-downloads.adblockplus.org/liste_fr.txt'; // complément pour les sites francophones (facultatif)
const state = { engine: 'intégré', updatedAt: 0, blocked: 0, error: '' };
let blocker = null;

const cacheFile = () => path.join(app.getPath('userData'), 'adblock-engine.bin');
const fetchList = (url, init = {}) => net.fetch(url, { ...init, signal: AbortSignal.timeout(25000) });

/** Les règles intégrées d'Enora (« *://*.domaine/chemin* ») au format des listes de filtres. */
function ownFilters(patterns) {
  return patterns.map((p) => {
    const m = p.match(/^\*:\/\/(?:\*\.)?([^/]+)\/(.*)$/);
    if (!m) return '';
    const rest = m[2].replace(/\*+$/, '');
    return rest ? `||${m[1]}/${rest}` : `||${m[1]}^`;
  }).filter(Boolean);
}

async function build(ElectronBlocker, lists) {
  const fresh = await ElectronBlocker.fromLists(fetchList, lists, { enableCompression: true });
  try { // liste francophone : utile, mais son absence ne doit rien bloquer
    const res = await fetchList(FR_LIST);
    if (res.ok) fresh.updateFromDiff({ added: (await res.text()).split('\n') });
  } catch (_) {}
  return fresh;
}

/**
 * Charge le moteur (cache récent, sinon téléchargement) puis l'active sur les sessions données.
 * @param sessions sessions des pages web (YouTube, sites) : blocage réseau + masquage des emplacements + scripts
 * @param staticPatterns liste intégrée, ajoutée au moteur pour ne rien perdre
 */
async function enable(sessions, staticPatterns) {
  let lib;
  try { lib = require('@ghostery/adblocker-electron'); } catch (e) { state.error = 'moteur absent'; return; }
  const { ElectronBlocker, adsLists } = lib;
  const file = cacheFile();
  let age = Infinity;
  try { age = Date.now() - fs.statSync(file).mtimeMs; } catch (_) {}
  let engine = null;
  if (age < MAX_AGE) {
    try { engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(file))); state.updatedAt = Date.now() - age; } catch (_) { engine = null; }
  }
  if (!engine) {
    try {
      engine = await build(ElectronBlocker, adsLists);
      engine.updateFromDiff({ added: ownFilters(staticPatterns) });
      fs.writeFileSync(file, engine.serialize());
      state.updatedAt = Date.now();
    } catch (e) {
      state.error = String(e.message || e).slice(0, 120);
      // Pas de connexion : on reprend les anciennes listes si elles existent
      try { engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(file))); state.updatedAt = Date.now() - age; } catch (_) { return; }
    }
  }
  blocker = engine;
  blocker.on('request-blocked', () => { state.blocked++; });
  blocker.on('request-redirected', () => { state.blocked++; });
  for (const ses of sessions) {
    try {
      // La bibliothèque enregistre deux canaux communs à toutes les sessions : on évite le doublon
      ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
      ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
      blocker.enableBlockingInSession(ses); // remplace le blocage intégré de cette session
    } catch (e) { state.error = String(e.message || e).slice(0, 120); }
  }
  // Fenêtre principale (lecteur YouTube intégré) : blocage réseau seulement, jamais sur l'interface ni sur les requêtes d'Enora
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (details.webContentsId == null || details.resourceType === 'mainFrame') return callback({});
    try { blocker.onBeforeRequest(details, callback); } catch (_) { callback({}); }
  });
  state.engine = 'listes';
}

const info = (staticBlocked = 0) => ({ engine: state.engine, updatedAt: state.updatedAt, blocked: state.blocked + staticBlocked, error: state.error });
module.exports = { enable, info, ownFilters };
