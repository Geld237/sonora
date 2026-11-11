// Service worker de la version web (PWA) : l'application s'ouvre même sans connexion.
// Les fichiers de Enora sont gardés en cache ; les contenus en ligne (YouTube, radios, films) ne le sont pas.
const VERSION = 'sonora-__BUILD__';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css', 'css/fonts.css', 'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2', 'js/icons.js',
  'js/app.js', 'js/api.js', 'js/db.js', 'js/player.js', 'js/platform.js', 'js/youtube-player.js',
  'js/settings.js', 'js/net.js', 'js/lyrics.js', 'js/podcasts.js', 'js/share.js', 'js/recap.js', 'js/rooms.js', 'js/audius.js', 'js/profile.js', 'js/i18n.js', 'js/i18n-en.js', 'js/i18n-es.js', 'js/i18n-de.js', 'js/i18n-pt.js', 'js/i18n-zh.js', 'js/i18n-ar.js', 'js/i18n-hi.js', 'js/i18n-bn.js', 'js/i18n-ru.js', 'js/party.js', 'js/qrcode.js', 'js/cloud.js', 'js/cloud-config.js', 'js/build-info.js', 'js/updates.js',
  'icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sonora-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// L'application demande l'activation de la nouvelle version quand l'utilisateur clique sur « Recharger »
self.addEventListener('message', (event) => { if (event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // contenus externes : jamais en cache
  // Page : réseau d'abord (pour avoir la dernière version), cache si hors-ligne
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  // Fichiers de l'application : cache d'abord, mis à jour en arrière-plan
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    }),
  );
});
