// Enora — version Windows (Electron)
const { app, BrowserWindow, session, protocol, net, shell, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Mises à jour automatiques (installateur Windows, depuis GitHub Releases)
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (_) { autoUpdater = null; }
// Mise à jour automatique : installateur Windows et AppImage Linux.
// Mac : l'application n'est pas signée par Apple, macOS refuse donc l'installation automatique -> bandeau « Nouvelle version ».
const canAutoUpdate = () => !!(autoUpdater && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
  && (process.platform === 'win32' || (process.platform === 'linux' && process.env.APPIMAGE)));

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

const adblockLists = require('./adblock-lists.js');
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

// Windows / Linux : les touches multimédia du clavier sont gérées par l'application (fiable aussi avec le lecteur YouTube).
// Sur Mac, le système les transmet déjà à l'application.
const OWN_MEDIA_KEYS = process.platform !== 'darwin';
if (OWN_MEDIA_KEYS) app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
let mainWin = null;
function registerMediaKeys() {
  if (!OWN_MEDIA_KEYS) return;
  const send = (action) => () => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('sonora:media', action); };
  for (const [key, action] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']]) {
    try { globalShortcut.register(key, send(action)); } catch (_) {}
  }
}
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (_) {} });

// Couleur des boutons de la fenêtre (réduire, agrandir, fermer) selon le thème clair ou sombre
ipcMain.handle('sonora:theme', (_e, light) => {
  if (process.platform !== 'win32' || !mainWin || mainWin.isDestroyed()) return;
  try { mainWin.setTitleBarOverlay({ color: '#00000000', symbolColor: light ? '#1d1d1f' : '#f5f5f7', height: 44 }); } catch (_) {}
});

// Mini-lecteur flottant : la fenêtre devient petite et reste au-dessus des autres
let fullBounds = null;
ipcMain.handle('sonora:mini', (_e, on) => {
  const win = mainWin;
  if (!win || win.isDestroyed()) return;
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    fullBounds = win.getBounds();
    win.setMinimumSize(340, 96);
    win.setSize(440, 104);
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(380, 600);
    if (fullBounds) win.setBounds(fullBounds); else win.setSize(1280, 820);
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Enora',
    backgroundColor: '#0e0f14',
    autoHideMenuBar: true,
    // Une seule barre : la barre d'onglets d'Enora sert aussi de barre de titre (Windows et Mac)
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#f5f5f7', height: 44 } } : {}),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
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
  mainWin = win;
  win.loadURL('app://sonora/index.html');
  setupAutoUpdate(win);
  // Les liens externes s'ouvrent dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url); // jamais file:, smb: ni un protocole d'application
    return { action: 'deny' };
  });
  // La fenêtre principale ne quitte jamais l'interface d'Enora
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://sonora/')) e.preventDefault(); });
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
ipcMain.handle('sonora:adblock-info', () => adblockLists.info(blockedCount));
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
  // Consentement aux cookies YouTube (Europe) : sans lui, YouTube redirige ou refuse les requêtes
  for (const [name, value] of [['SOCS', 'CAI'], ['CONSENT', 'YES+cb']]) {
    session.defaultSession.cookies.set({ url: 'https://www.youtube.com', domain: '.youtube.com', path: '/', name, value, secure: true, expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400 }).catch(() => {});
  }

  // Recherche YouTube par une vraie page (fenêtre invisible) : la page de résultats est chargée
  // comme dans un navigateur, puis on lit la liste des vidéos qu'elle contient.
  const ytSearchSession = session.fromPartition('persist:ytsearch');
  installAdblock(ytSearchSession);
  for (const [name, value] of [['SOCS', 'CAI'], ['CONSENT', 'YES+cb']]) {
    ytSearchSession.cookies.set({ url: 'https://www.youtube.com', domain: '.youtube.com', path: '/', name, value, secure: true, expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400 }).catch(() => {});
  }
  let ytWin = null;
  let ytQueue = Promise.resolve();
  const ytWindow = () => {
    if (ytWin && !ytWin.isDestroyed()) return ytWin;
    ytWin = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:ytsearch', sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    ytWin.webContents.setAudioMuted(true);
    ytWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return ytWin;
  };
  const readInitialData = (w) => w.webContents.executeJavaScript('window.ytInitialData ? JSON.stringify(window.ytInitialData) : ""', true);
  async function loadResultsPage(url) {
    const w = ytWindow();
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('YouTube ne répond pas')), ms))]);
    await withTimeout(w.loadURL(url), 25000);
    let data = await readInitialData(w);
    if (!data && /consent\./.test(w.webContents.getURL())) {
      // Page de consentement (Europe) : on accepte, puis on recharge la recherche
      await w.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button, input[type=submit]')].find((x) => /tout accepter|accept all|j'accepte|accepter/i.test(x.innerText || x.value || '')); if (b) b.click(); return !!b; })()`, true).catch(() => false);
      await new Promise((r) => setTimeout(r, 2500));
      await withTimeout(w.loadURL(url), 25000);
      data = await readInitialData(w);
    }
    if (!data) throw new Error(`page de résultats sans données (${new URL(w.webContents.getURL()).hostname})`);
    return data;
  }
  ipcMain.handle('sonora:ytpage', (_event, url) => {
    const u = new URL(url);
    if (u.hostname !== 'www.youtube.com' || u.pathname !== '/results') throw new Error('Adresse non autorisée');
    const job = ytQueue.then(() => loadResultsPage(u.toString()));
    ytQueue = job.catch(() => {});
    return job;
  });

  ipcMain.handle('sonora:http', async (_event, req) => {
    const url = new URL(req.url);
    if (url.protocol !== 'https:' || !/(^|\.)(youtube\.com|googleapis\.com)$/i.test(url.hostname)) throw new Error('Adresse non autorisée');
    const method = req.method === 'POST' ? 'POST' : 'GET';
    const headers = { 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...(req.headers || {}) };
    delete headers.Cookie; // les cookies viennent de la session (consentement enregistré au démarrage)
    const res = await net.fetch(url.toString(), { method, headers, body: method === 'POST' ? req.body : undefined, credentials: 'include' });
    return { status: res.status, text: await res.text() };
  });
  const yt = session.fromPartition('persist:youtube');
  const web = session.fromPartition('persist:web');
  for (const ses of [yt, web]) {
    installAdblock(ses);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(['fullscreen', 'clipboard-sanitized-write'].includes(permission))); // pas de caméra/micro
  }
  // Fenêtre principale : aucune autorisation sensible (caméra, micro, position, notifications…)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(['fullscreen', 'clipboard-sanitized-write', 'media-key-system'].includes(permission)));
  // Bloqueur renforcé : listes EasyList / uBlock Origin, chargées en arrière-plan (le blocage intégré reste actif en attendant)
  adblockLists.enable([yt, web], AD_FILTERS).catch(() => {});

  createWindow();
  registerMediaKeys();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
