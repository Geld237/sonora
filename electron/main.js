// Enora — version Windows (Electron)
const { app, BrowserWindow, session, protocol, net, shell, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Mises à jour automatiques (installateur Windows, depuis GitHub Releases)
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (_) { autoUpdater = null; }
const canAutoUpdate = () => !!(autoUpdater && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR);

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js'); // généré depuis adblock/youtube-adblock.js

// Serveurs et adresses publicitaires bloqués au niveau réseau
const AD_FILTERS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.googletagservices.com/*',
  '*://adservice.google.com/*',
  '*://*.adservice.google.com/*',
  '*://*.2mdn.net/*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_*',
  '*://*.youtube.com/youtubei/v1/player/ad_break*',
  '*://*.youtube.com/pcs/activeview*',
  '*://*.youtube-nocookie.com/pagead/*',
  '*://*.adnxs.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.criteo.com/*',
  '*://*.criteo.net/*',
  '*://*.taboola.com/*',
  '*://*.outbrain.com/*',
  '*://*.moatads.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.adsafeprotected.com/*',
  '*://*.pubmatic.com/*',
  '*://*.rubiconproject.com/*',
  '*://*.openx.net/*',
  '*://*.casalemedia.com/*',
  '*://*.smartadserver.com/*',
  // Régies publicitaires et pop-ups fréquentes sur les sites de streaming
  '*://*.popads.net/*',
  '*://*.popcash.net/*',
  '*://*.propellerads.com/*',
  '*://*.propellerclick.com/*',
  '*://*.exoclick.com/*',
  '*://*.exosrv.com/*',
  '*://*.adsterra.com/*',
  '*://*.adsterratech.com/*',
  '*://*.juicyads.com/*',
  '*://*.trafficjunky.net/*',
  '*://*.hilltopads.net/*',
  '*://*.onclickads.net/*',
  '*://*.clickadu.com/*',
  '*://*.adcash.com/*',
  '*://*.monetag.com/*',
  '*://*.a-ads.com/*',
  '*://*.mgid.com/*',
  '*://*.revcontent.com/*',
  '*://*.yllix.com/*',
  '*://*.admaven.com/*',
  '*://*.galaksion.com/*',
];

let blockedCount = 0;
function installAdblock(ses) {
  ses.webRequest.onBeforeRequest({ urls: AD_FILTERS }, (details, callback) => {
    blockedCount++;
    callback({ cancel: true });
  });
}

// L'application s'appelait « Sonora » : on garde le même dossier de données pour ne rien perdre
// (bibliothèque hors-ligne, favoris, playlists, réglages, connexion au compte).
app.setPath('userData', path.join(app.getPath('appData'), 'Sonora'));

// Protocole app:// pour servir l'interface (nécessaire pour les modules JavaScript)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// YouTube doit voir un navigateur Chrome classique
app.userAgentFallback = app.userAgentFallback.replace(/\s?Electron\/\S+/i, '').replace(/\s?sonora\/\S+/i, '');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Enora',
    backgroundColor: '#0e0f14',
    autoHideMenuBar: true,
    icon: path.join(WWW, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'app-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegrationInSubFrames: true, // le preload s'exécute aussi dans l'iframe du lecteur YouTube (bloqueur de pub)
      webviewTag: true,
      webSecurity: false, // permet d'interroger les API (archive.org, radios) sans restriction CORS
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadURL('app://sonora/index.html');
  setupAutoUpdate(win);
  // Les liens externes s'ouvrent dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.on('web-contents-created', (_event, contents) => {
  // Paramètres imposés à la vue YouTube (<webview>)
  contents.on('will-attach-webview', (_e, webPreferences, params) => {
    webPreferences.preload = WEBVIEW_PRELOAD;  // le script anti-pub est injecté dans la page via executeInMainWorld
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    if (params.partition !== 'persist:web') params.partition = 'persist:youtube';
  });

  if (contents.getType() === 'webview') {
    // Bloqueur de pop-ups : seules les fenêtres du même site (ou YouTube/Google) sont ouvertes, dans la même vue.
    contents.setWindowOpenHandler(({ url }) => {
      const base = (h) => {
        const parts = (h || '').split('.');
        const n = parts.length >= 3 && /^(co|com|org|net|gouv|ac|gov)$/.test(parts[parts.length - 2]) ? 3 : 2;
        return parts.slice(-n).join('.');
      };
      let current = '', target = '';
      try { current = new URL(contents.getURL()).hostname; } catch (_) {}
      try { target = new URL(url).hostname; } catch (_) {}
      const trusted = /(^|\.)(youtube\.com|youtu\.be|google\.[a-z.]+)$/i.test(target);
      if (trusted || (target && base(target) === base(current))) contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

function setupAutoUpdate(win) {
  if (!canAutoUpdate()) return;
  const send = (state, info = {}) => { if (!win.isDestroyed()) win.webContents.send('sonora:update', { state, version: info.version || '' }); };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => send('downloading', info));
  autoUpdater.on('update-downloaded', (info) => send('ready', info));
  autoUpdater.on('error', () => {});
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
}

ipcMain.handle('sonora:update-install', () => { if (canAutoUpdate()) autoUpdater.quitAndInstall(); });
ipcMain.handle('sonora:update-check', async () => {
  if (!canAutoUpdate()) return { auto: false };
  try { const r = await autoUpdater.checkForUpdates(); return { auto: true, version: r?.updateInfo?.version || '' }; } catch (e) { return { auto: true, error: e.message }; }
});
ipcMain.handle('sonora:app-info', () => ({ version: app.getVersion(), autoUpdate: canAutoUpdate() }));

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let p = decodeURIComponent(url.pathname);
      if (!p || p === '/') p = '/index.html';
      const file = path.normalize(path.join(WWW, p));
      if (!file.startsWith(WWW + path.sep)) return new Response('Accès refusé', { status: 403 });
      return await net.fetch(pathToFileURL(file).toString());
    } catch (_) {
      return new Response('Introuvable', { status: 404 });
    }
  });

  installAdblock(session.defaultSession);

  // Le lecteur YouTube intégré exige une page d'origine (Referer) en http(s)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://www.youtube.com/embed/*', '*://www.youtube-nocookie.com/embed/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://sonora.app/';
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Requêtes YouTube pour l'onglet Musique (recherche, tendances) — hôtes limités
  ipcMain.handle('sonora:http', async (_event, req) => {
    const url = new URL(req.url);
    if (url.protocol !== 'https:' || !/(^|\.)(youtube\.com|googleapis\.com)$/i.test(url.hostname)) throw new Error('Adresse non autorisée');
    const method = req.method === 'POST' ? 'POST' : 'GET';
    const res = await net.fetch(url.toString(), { method, headers: req.headers || {}, body: method === 'POST' ? req.body : undefined });
    return { status: res.status, text: await res.text() };
  });
  const yt = session.fromPartition('persist:youtube');
  const web = session.fromPartition('persist:web');
  for (const ses of [yt, web]) {
    installAdblock(ses);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(['fullscreen', 'clipboard-sanitized-write'].includes(permission))); // pas de caméra/micro
  }

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
