// Sources en ligne gratuites, légales et sans publicité (aucune clé API nécessaire) :
//  - Internet Archive (archive.org) : musique libre (netlabels) et films du domaine public
//  - Radio Browser (radio-browser.info) : plus de 40 000 radios du monde entier

import { getSettings, markSettingsChanged } from './settings.js';
import { BUILD } from './build-info.js';

const IA = 'https://archive.org';

/** Version web (navigateur / PWA) : ni application Windows, ni application mobile. */
const isWebApp = () => !window.sonora?.http && !(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
const RADIO_SERVERS = ['de1', 'fi1', 'de2'].map((h) => `https://${h}.api.radio-browser.info`);
let radioBase = null;

async function fetchJSON(url, timeout = 15000) {
  // iPhone : requête native (évite toute restriction CORS)
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.nativePromise === 'function') {
    const res = await Promise.race([
      cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', headers: { Accept: 'application/json' }, responseType: 'json' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Délai dépassé')), timeout)),
    ]);
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const prettyName = (name) => name.split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/^\d+[\s._-]+/, '').replace(/[_]+/g, ' ').trim();

function parseLength(len) {
  if (!len) return 0;
  if (String(len).includes(':')) return String(len).split(':').reduce((acc, p) => acc * 60 + parseFloat(p || 0), 0);
  return parseFloat(len) || 0;
}

export const iaCover = (id) => `${IA}/services/img/${encodeURIComponent(id)}`;
export const iaFileUrl = (id, name) => `${IA}/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;

/** Recherche Internet Archive. Retourne une liste d'éléments {id, title, creator, year, cover}. */
export async function iaSearch(query, { rows = 40, page = 1, sort = 'downloads desc' } = {}) {
  const p = new URLSearchParams({ q: query, rows: String(rows), page: String(page), output: 'json' });
  ['identifier', 'title', 'creator', 'year'].forEach((f) => p.append('fl[]', f));
  if (sort) p.append('sort[]', sort);
  const data = await fetchJSON(`${IA}/advancedsearch.php?${p.toString()}`);
  return (data?.response?.docs || []).map((d) => ({
    id: d.identifier,
    title: first(d.title) || d.identifier,
    creator: first(d.creator) || '',
    year: first(d.year) || '',
    cover: iaCover(d.identifier),
  }));
}

/** Requêtes prêtes à l'emploi */
export function musicQuery(term, genre) {
  const parts = ['mediatype:audio', '(collection:netlabels OR collection:opensource_audio OR collection:audio_music)', '-collection:podcasts'];
  if (genre) parts.push(`subject:(${genre})`);
  if (term) parts.push(`(${term})`);
  return parts.join(' AND ');
}

export function filmQuery(term, category) {
  const parts = ['mediatype:movies'];
  parts.push(category || 'collection:feature_films');
  if (term) parts.push(`(${term})`);
  return parts.join(' AND ');
}

/** Détails d'un album : liste des pistes MP3 jouables. */
/**
 * Choix du fichier selon la qualité :
 *  low    : MP3 64 kbit/s (économie de données)
 *  normal : MP3 VBR (~128 à 256 kbit/s)
 *  high   : fichier original sans perte (FLAC/WAV) s'il existe, sinon le meilleur MP3
 */
function pickAudio(group, quality) {
  const order = {
    low: ['k64', 'vbr', 'mp3', 'ogg', 'lossless'],
    normal: ['vbr', 'mp3', 'k64', 'ogg', 'lossless'],
    high: ['lossless', 'mp3hi', 'vbr', 'mp3', 'ogg', 'k64'],
  }[quality] || ['vbr', 'mp3', 'k64'];
  for (const k of order) if (group[k]) return group[k];
  return null;
}

/** Regroupe les différentes versions (original + dérivés) d'une même piste. */
function groupAudioFiles(files) {
  const groups = new Map();
  for (const f of files) {
    const name = f.name || '';
    const fmt = (f.format || '').toLowerCase();
    const isAudio = /\.(mp3|flac|wav|ogg|m4a)$/i.test(name);
    if (!isAudio) continue;
    const root = f.source === 'derivative' && f.original ? f.original : name;
    const g = groups.get(root) || { meta: null };
    if (f.source !== 'derivative') g.meta = f;
    if (/\.flac$/i.test(name) || /\.wav$/i.test(name) || fmt.includes('flac') || fmt.includes('wave')) g.lossless = g.lossless || f;
    else if (/64kb/i.test(fmt) || /_64kb\.mp3$/i.test(name)) g.k64 = f;
    else if (/vbr/i.test(fmt)) g.vbr = f;
    else if (/\.mp3$/i.test(name)) { if ((parseInt(f.bitrate, 10) || 0) >= 256 || /320/.test(fmt)) g.mp3hi = f; else g.mp3 = g.mp3 || f; }
    else if (/\.ogg$/i.test(name)) g.ogg = f;
    if (!g.meta) g.meta = f;
    groups.set(root, g);
  }
  // On ne garde que les groupes qui ont au moins une version MP3 ou sans perte lisible partout
  return [...groups.values()].filter((g) => g.vbr || g.mp3 || g.mp3hi || g.k64 || g.lossless);
}

/** Détails d'un album : liste des pistes, avec la qualité choisie dans les réglages. */
export async function iaAlbum(id) {
  const { streamQuality, downloadQuality } = getSettings();
  const m = await fetchJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  const meta = m.metadata || {};
  const groups = groupAudioFiles(m.files || []);
  const trackNo = (g) => parseInt((g.meta && g.meta.track) || (g.vbr && g.vbr.track) || '0', 10) || 0;
  const label = (g) => (g.vbr || g.mp3 || g.mp3hi || g.k64 || g.lossless).name;
  groups.sort((a, b) => trackNo(a) - trackNo(b) || label(a).localeCompare(label(b), undefined, { numeric: true }));
  const artist = first(meta.creator) || 'Artiste inconnu';
  const cover = iaCover(id);
  const albumTitle = first(meta.title) || id;
  return {
    id,
    title: albumTitle,
    artist,
    year: first(meta.year) || first(meta.date) || '',
    cover,
    description: stripHtml(first(meta.description)),
    tracks: groups.map((g) => {
      const info = g.meta || {};
      const stream = pickAudio(g, streamQuality);
      const dl = pickAudio(g, downloadQuality);
      const keyFile = g.vbr || g.mp3 || g.mp3hi || g.k64 || g.lossless; // clé stable, quelle que soit la qualité
      return {
        key: `ia:${id}:${keyFile.name}`,
        title: info.title || stream.title || prettyName(keyFile.name),
        artist: info.creator || info.artist || artist,
        album: albumTitle,
        cover,
        kind: 'audio',
        origin: 'archive',
        src: iaFileUrl(id, stream.name),
        dlSrc: iaFileUrl(id, dl.name),
        size: parseInt(dl.size, 10) || 0,
        quality: qualityLabel(stream),
        duration: parseLength(info.length || stream.length),
      };
    }),
  };
}

function qualityLabel(f) {
  const fmt = (f.format || '').toLowerCase();
  if (/flac|wave/.test(fmt) || /\.(flac|wav)$/i.test(f.name)) return 'Sans perte';
  if (/64kb/.test(fmt)) return '64 kbit/s';
  if (/vbr/.test(fmt)) return 'MP3 VBR';
  return 'MP3';
}

/** Détails d'un film : choisit un fichier MP4 lisible sur Windows et iPhone. */
export async function iaFilm(id) {
  const m = await fetchJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  const meta = m.metadata || {};
  const mp4 = (m.files || []).filter((f) => /\.(mp4|m4v)$/i.test(f.name) && !/thumb/i.test(f.name));
  const rank = (f) => {
    const fmt = (f.format || '').toLowerCase();
    if (fmt === 'h.264') return 0;
    if (fmt.includes('512kb')) return 1;
    if (fmt.includes('h.264')) return 2;
    if (fmt.includes('mpeg4')) return 3;
    return 4;
  };
  mp4.sort((a, b) => rank(a) - rank(b));
  const file = mp4[0];
  // Pour le téléchargement hors-ligne : la version la plus légère (512Kb) si elle existe
  const light = mp4.find((f) => /512kb/i.test(f.format || ''));
  const dlFile = getSettings().filmDownload === 'high' ? file : (light || file);
  const title = first(meta.title) || id;
  const year = first(meta.year) || (first(meta.date) || '').slice(0, 4);
  return {
    id,
    title,
    year,
    creator: first(meta.creator) || first(meta.director) || '',
    description: stripHtml(first(meta.description)),
    runtime: first(meta.runtime) || '',
    cover: iaCover(id),
    track: file
      ? {
          key: `iafilm:${id}`,
          title,
          artist: [first(meta.creator) || first(meta.director), year].filter(Boolean).join(' · ') || 'Film',
          cover: iaCover(id),
          kind: 'video',
          origin: 'archive',
          src: iaFileUrl(id, file.name),
          dlSrc: iaFileUrl(id, dlFile.name),
          size: parseInt(dlFile.size, 10) || 0,
        }
      : null,
  };
}

/** Radios : recherche par nom, pays (code ISO) ou genre. */
export async function radioSearch({ name = '', country = '', tag = '' } = {}) {
  const p = new URLSearchParams({ limit: '80', hidebroken: 'true', order: 'clickcount', reverse: 'true' });
  if (name) p.set('name', name);
  if (country) p.set('countrycode', country);
  if (tag) p.set('tag', tag);
  const servers = radioBase ? [radioBase, ...RADIO_SERVERS.filter((s) => s !== radioBase)] : RADIO_SERVERS;
  let lastError = null;
  for (const base of servers) {
    try {
      const list = await fetchJSON(`${base}/json/stations/search?${p.toString()}`, 7000);
      radioBase = base;
      const seen = new Set();
      const httpsOnly = isWebApp() && location.protocol === 'https:';
      return list
        .filter((s) => s.url_resolved && (!httpsOnly || s.url_resolved.startsWith('https:')) && !seen.has(s.name.trim().toLowerCase()) && seen.add(s.name.trim().toLowerCase()))
        .map((s) => ({
          key: `radio:${s.stationuuid}`,
          title: s.name.trim(),
          artist: [s.country, (s.tags || '').split(',').filter(Boolean).slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'Radio',
          cover: s.favicon || '',
          kind: 'audio',
          origin: 'radio',
          live: true,
          src: s.url_resolved,
        }));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Radios indisponibles');
}

/* =========================================================================
   YouTube : titres récents, tendances et recherche
   - Avec une clé API (gratuite) : API officielle YouTube Data v3
   - Sans clé : interface interne de YouTube (utilisée par le site lui-même)
   La lecture se fait ensuite avec le lecteur officiel de YouTube.
   ========================================================================= */
const YT_KEY_STORE = 'sonora.ytApiKey';
/** Clé saisie par l'utilisateur (Réglages) */
export const getUserYtApiKey = () => { try { return (localStorage.getItem(YT_KEY_STORE) || '').trim(); } catch (_) { return ''; } };
/** Clé intégrée à la publication (version web) */
export const hasBuiltInYtKey = () => !!BUILD.ytKey;
/** Clé utilisée : celle de l'utilisateur en priorité, sinon la clé intégrée */
export const getYtApiKey = () => getUserYtApiKey() || BUILD.ytKey || '';
export const setYtApiKey = (k, { silent = false } = {}) => { try { localStorage.setItem(YT_KEY_STORE, (k || '').trim()); } catch (_) {} if (!silent) markSettingsChanged(); };

/** Requête HTTP sans restriction CORS : processus principal (Windows) ou natif (iPhone). */
/** Erreur HTTP avec la raison donnée par Google/YouTube (quota, clé refusée…). */
const API_REASONS = {
  quotaExceeded: 'quota YouTube du jour atteint',
  dailyLimitExceeded: 'quota YouTube du jour atteint',
  rateLimitExceeded: 'trop de requêtes, réessayez dans un instant',
  keyInvalid: 'clé API YouTube invalide',
  API_KEY_INVALID: 'clé API YouTube invalide',
  accessNotConfigured: 'l\'API YouTube Data v3 n\'est pas activée pour cette clé',
  SERVICE_DISABLED: 'l\'API YouTube Data v3 n\'est pas activée pour cette clé',
  API_KEY_HTTP_REFERRER_BLOCKED: 'clé limitée à un autre site (restriction « Sites Web »)',
  API_KEY_SERVICE_BLOCKED: 'clé non autorisée pour l\'API YouTube',
  forbidden: 'accès refusé par YouTube',
};
function httpError(status, text) {
  let reason = '';
  try {
    const d = typeof text === 'string' ? JSON.parse(text) : text;
    const e = d?.error || {};
    reason = e.errors?.[0]?.reason || e.details?.find((x) => x.reason)?.reason || e.status || '';
  } catch (_) {}
  const err = new Error(API_REASONS[reason] ? `${API_REASONS[reason]} (HTTP ${status})` : `HTTP ${status}`);
  err.status = status;
  err.reason = reason;
  return err;
}

/** Requête HTTP sans restriction CORS : processus principal (Windows) ou natif (Android / iPhone). */
async function httpRequest({ url, method = 'GET', headers = {}, body = null, timeout = 15000, text = false }) {
  const cap = window.Capacitor;
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé')), timeout))]);
  const payload = body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  if (window.sonora?.http) {
    const r = await withTimeout(window.sonora.http({ url, method, headers, body: payload }));
    if (r.status >= 400) throw httpError(r.status, r.text);
    return text ? r.text : JSON.parse(r.text);
  }
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.nativePromise === 'function') {
    const r = await withTimeout(cap.nativePromise('CapacitorHttp', 'request', { url, method, headers, data: body ?? undefined, responseType: text ? 'text' : 'json' }));
    if (r.status >= 400) throw httpError(r.status, r.data);
    if (text) return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const res = await withTimeout(fetch(url, { method, headers, body: payload }));
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  return text ? res.text() : res.json();
}

function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
function parseClock(txt) {
  if (!txt) return 0;
  return String(txt).split(':').reduce((acc, p) => acc * 60 + (parseInt(p, 10) || 0), 0);
}
const decodeEntities = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** « Artiste - Titre (Clip officiel) » -> { artist, title } */
function splitTitle(raw, channel) {
  let title = decodeEntities(raw).trim();
  let artist = decodeEntities(channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = title.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (m) { artist = m[1].trim(); title = m[2].trim(); }
  title = title.replace(/\s*[([](official|clip|lyrics?|paroles|audio|video|vidéo|music video|visuali[sz]er|hd|4k)[^)\]]*[)\]]/gi, '').trim() || title;
  return { artist, title };
}

function ytTrack({ id, title, channel, duration }) {
  const t = splitTitle(title, channel);
  return {
    key: `yt:${id}`,
    ytId: id,
    title: t.title,
    artist: t.artist || 'YouTube',
    cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    kind: 'youtube',
    origin: 'youtube',
    duration: duration || 0,
  };
}

/* ---------- Avec clé : API officielle ---------- */
const YT_API = 'https://www.googleapis.com/youtube/v3';

async function apiVideos(ids, key) {
  if (!ids.length) return [];
  const p = new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.join(','), maxResults: '50', key });
  const d = await httpRequest({ url: `${YT_API}/videos?${p}` });
  return (d.items || []).filter((v) => v.status?.embeddable !== false).map((v) => ytTrack({
    id: v.id, title: v.snippet?.title, channel: v.snippet?.channelTitle, duration: parseIsoDuration(v.contentDetails?.duration),
  }));
}

async function apiTrending(region, key) {
  if (!region || region === 'WW') return [];
  const p = new URLSearchParams({ part: 'snippet,contentDetails,status', chart: 'mostPopular', videoCategoryId: '10', regionCode: region, maxResults: '50', hl: 'fr', key });
  const d = await httpRequest({ url: `${YT_API}/videos?${p}` });
  return (d.items || []).filter((v) => v.status?.embeddable !== false).map((v) => ytTrack({
    id: v.id, title: v.snippet?.title, channel: v.snippet?.channelTitle, duration: parseIsoDuration(v.contentDetails?.duration),
  }));
}

async function apiSearchOnce(q, { region, recentDays = 0, order = '', category = true }, key) {
  const p = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '40', q, key });
  if (category) p.set('videoCategoryId', '10');
  if (region && region !== 'WW') p.set('regionCode', region);
  if (recentDays) p.set('publishedAfter', new Date(Date.now() - recentDays * 86400000).toISOString());
  if (order) p.set('order', order);
  const d = await httpRequest({ url: `${YT_API}/search?${p}` });
  return (d.items || []).map((i) => i.id?.videoId).filter(Boolean);
}

/** Recherche officielle. Si un petit pays ne donne rien, la recherche est élargie pas à pas
 *  (sans filtre de catégorie, puis sans limite de date, puis sans filtre de pays). */
async function apiSearch(q, { region = 'FR', recent = false, recentDays = 0, order = '' } = {}, key) {
  const days = recentDays || (recent ? 30 : 0);
  // Chaque recherche coûte 100 unités du quota gratuit (10 000 par jour) : 2 tentatives au maximum
  const attempts = [
    { region, recentDays: days, order, category: true },
    { region, recentDays: 0, order: '', category: false },
  ];
  let best = [];
  for (const a of attempts) {
    const ids = await apiSearchOnce(q, a, key);
    if (ids.length > best.length) best = ids;
    if (best.length >= 10) break;
  }
  return best.length ? apiVideos(best, key) : []; // ajoute les durées
}

/* ---------- Sans clé : interface interne de YouTube ---------- */
const INNERTUBE = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const SP_VIDEOS = 'EgIQAQ==';          // type : vidéo
const SP_VIDEOS_MONTH = 'EgQIBBAB';    // type : vidéo, mis en ligne ce mois-ci

function collectVideos(node, out, seen) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectVideos(n, out, seen); return; }
  const v = node.videoRenderer;
  if (v && v.videoId && !seen.has(v.videoId)) {
    seen.add(v.videoId);
    const isLive = !v.lengthText;
    if (!isLive) {
      out.push(ytTrack({
        id: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '',
        channel: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
        duration: parseClock(v.lengthText?.simpleText),
      }));
    }
  }
  const tok = node.continuationCommand?.token;
  if (tok && !out.token) out.token = tok;
  for (const k in node) if (k !== 'videoRenderer') collectVideos(node[k], out, seen);
}

/** Méthode de secours : la page de résultats de recherche, lue comme par un navigateur. */
async function htmlSearch(query, { region = 'FR', recent = false } = {}) {
  const gl = !region || region === 'WW' ? 'US' : region;
  const sp = encodeURIComponent(recent ? SP_VIDEOS_MONTH : SP_VIDEOS);
  const html = await httpRequest({
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}&hl=fr&gl=${gl}&persist_gl=1`,
    headers: { Accept: 'text/html', Cookie: 'SOCS=CAI; CONSENT=YES+cb' },
    text: true,
  });
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) || html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (!m) throw new Error('page YouTube illisible');
  const out = [];
  collectVideos(JSON.parse(m[1]), out, new Set());
  return out;
}

/** Résultats suivants (même recherche) à partir du jeton « page suivante ». */
async function innertubeContinue(token, region) {
  const cfg = ytConfig || {};
  const version = cfg.version || '2.20261101.00.00';
  const body = { context: { client: { clientName: 'WEB', clientVersion: version, hl: 'fr', gl: !region || region === 'WW' ? 'US' : region, ...(cfg.visitor ? { visitorData: cfg.visitor } : {}) } }, continuation: token };
  const headers = { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': version };
  if (!isWebApp()) { headers.Origin = 'https://www.youtube.com'; headers.Referer = 'https://www.youtube.com/'; }
  const url = cfg.key ? `${INNERTUBE}&key=${encodeURIComponent(cfg.key)}` : INNERTUBE;
  const d = await httpRequest({ url, method: 'POST', headers, body });
  const out = [];
  collectVideos(d, out, new Set());
  return out;
}

/* Paramètres actuels du site YouTube (version du client, clé interne, identifiant visiteur),
   lus sur la page d'accueil de YouTube : ils changent régulièrement. */
let ytConfig = null;
let ytConfigPromise = null;
async function loadYtConfig(force = false) {
  if (ytConfig && !force) return ytConfig;
  if (ytConfigPromise && !force) return ytConfigPromise;
  ytConfigPromise = (async () => {
    const html = await httpRequest({
      url: 'https://www.youtube.com/?hl=fr&persist_hl=1',
      headers: { 'Accept-Language': 'fr-FR,fr;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+cb' },
      text: true,
    });
    const pick = (name) => (html.match(new RegExp('"' + name + '"\\s*:\\s*"([^"]+)"')) || [])[1] || '';
    ytConfig = { version: pick('INNERTUBE_CLIENT_VERSION') || '2.20261101.00.00', key: pick('INNERTUBE_API_KEY'), visitor: pick('VISITOR_DATA') };
    try { localStorage.setItem('sonora.ytcfg', JSON.stringify({ ...ytConfig, t: Date.now() })); } catch (_) {}
    return ytConfig;
  })().finally(() => { ytConfigPromise = null; });
  return ytConfigPromise;
}
try { const c = JSON.parse(localStorage.getItem('sonora.ytcfg')); if (c && Date.now() - c.t < 3 * 86400000) ytConfig = c; } catch (_) {}

async function innertubeRequest(query, region, recent, cfg) {
  const version = cfg?.version || '2.20261101.00.00';
  const body = {
    context: { client: { clientName: 'WEB', clientVersion: version, hl: 'fr', gl: !region || region === 'WW' ? 'US' : region, ...(cfg?.visitor ? { visitorData: cfg.visitor } : {}) } },
    query,
    params: recent ? SP_VIDEOS_MONTH : SP_VIDEOS,
  };
  const headers = { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': version };
  if (!isWebApp()) { headers.Origin = 'https://www.youtube.com'; headers.Referer = 'https://www.youtube.com/'; }
  if (cfg?.visitor) headers['X-Goog-Visitor-Id'] = cfg.visitor;
  const url = cfg?.key ? `${INNERTUBE}&key=${encodeURIComponent(cfg.key)}` : INNERTUBE;
  return httpRequest({ url, method: 'POST', headers, body });
}

async function innertubeSearch(query, { region = 'FR', recent = false } = {}) {
  let d;
  try {
    try {
      d = await innertubeRequest(query, region, recent, ytConfig);
    } catch (first) {
      if (isWebApp()) throw first;
      // Refus (403/400…) : on relit les paramètres actuels de YouTube puis on réessaie une fois
      const cfg = await loadYtConfig(true).catch(() => null);
      try {
        if (!cfg) throw first;
        d = await innertubeRequest(query, region, recent, cfg);
      } catch (second) {
        // Toujours refusé : page de résultats de recherche
        return await htmlSearch(query, { region, recent });
      }
    }
  } catch (e) {
    if (isWebApp()) {
      throw new Error(getYtApiKey()
        ? 'YouTube a refusé la clé ou son quota du jour est atteint. Réessayez plus tard, ou ajoutez votre propre clé (Réglages → YouTube).'
        : 'Version web : ajoutez une clé API YouTube gratuite pour afficher les titres (Réglages → YouTube).');
    }
    throw e;
  }
  const out = [];
  collectVideos(d, out, new Set());
  return out;
}

const COUNTRY_NAMES = { WW: '', FR: 'France', CI: "Côte d'Ivoire", SN: 'Sénégal', CM: 'Cameroun', CD: 'Congo', BE: 'Belgique', CA: 'Québec', MA: 'Maroc', ML: 'Mali', NG: 'Nigeria', US: 'USA', GB: 'UK', HT: 'Haïti', KM: 'Comores', TG: 'Togo' };

/** Recherche sans clé, élargie si un petit pays ne donne presque rien. */
async function innertubeWide(query, { region, recent }) {
  let list = await innertubeSearch(query, { region, recent });
  if (list.length < 10 && recent) {
    const more = await innertubeSearch(query, { region, recent: false }).catch(() => []);
    const token = list.token || more.token;
    list = mergeTracks(list, more);
    list.token = token;
  }
  return list;
}

/* ---------- Fonctions utilisées par l'interface ---------- */
/** Mode utilisé : 'api' (clé officielle) ou 'interne' */
export const ytMode = () => (getYtApiKey() ? 'api' : 'interne');

// Adjectif utilisé dans les recherches (« musique camerounaise »…)
const COUNTRY_ADJ = { FR: 'française', CI: 'ivoirienne', SN: 'sénégalaise', CM: 'camerounaise', CD: 'congolaise', BE: 'belge', CA: 'québécoise', MA: 'marocaine', ML: 'malienne', NG: 'nigériane', US: 'américaine', GB: 'britannique', HT: 'haïtienne', KM: 'comorienne', TG: 'togolaise' };

/** Fusionne plusieurs listes sans doublon (même vidéo). */
function mergeTracks(...lists) {
  const seen = new Set();
  const out = [];
  for (const l of lists) for (const t of l || []) if (!seen.has(t.ytId)) { seen.add(t.ytId); out.push(t); }
  return out;
}

/* Cache de 6 heures : les listes s'affichent tout de suite et le quota YouTube gratuit est préservé. */
const CACHE_TTL = 6 * 3600 * 1000;
const cacheKey = (k) => `sonora.ytcache.${k}`;
function cacheGet(k) {
  try { const v = JSON.parse(localStorage.getItem(cacheKey(k))); if (v && Date.now() - v.t < CACHE_TTL && v.items?.length) return v.items; } catch (_) {}
  return null;
}
function cacheSet(k, items) {
  if (!items?.length) return;
  try { localStorage.setItem(cacheKey(k), JSON.stringify({ t: Date.now(), items })); } catch (_) {
    // stockage plein : on vide l'ancien cache
    try { Object.keys(localStorage).filter((x) => x.startsWith('sonora.ytcache.')).forEach((x) => localStorage.removeItem(x)); } catch (_) {}
  }
}

/**
 * Cherche avec plusieurs formulations et fusionne les résultats jusqu'à au moins 20 titres.
 * Si YouTube ne répond pas, la dernière liste connue (même ancienne) est affichée.
 */
async function multiSearch(cacheId, queries, { region, recent, order = '' }) {
  const cached = cacheGet(cacheId);
  if (cached) return cached;
  const key = getYtApiKey();
  const TARGET = 60; // 3 pages de 20 titres
  let out = [];
  let lastError = null;
  const tokens = [];
  const list = isWebApp() && key ? queries.slice(0, 2) : queries;
  for (const q of list) {
    try {
      let l = [];
      const viaApi = async () => { try { return await apiSearch(q, { region, recent, recentDays: recent ? 60 : 0, order }, key); } catch (e) { lastError = e; return []; } };
      const viaInternal = async () => { try { return await innertubeWide(q, { region, recent }); } catch (e) { lastError = e; return []; } };
      if (isWebApp()) {
        // Version web : seule l'API officielle est possible (navigateur)
        l = key ? await viaApi() : await viaInternal();
      } else {
        // Applications : méthode gratuite d'abord (sans quota), clé officielle en secours
        l = await viaInternal();
        if (!l.length && key) l = await viaApi();
      }
      if (l.token) tokens.push(l.token);
      out = mergeTracks(out, l);
    } catch (e) { lastError = e; }
    if (out.length >= TARGET) break;
  }
  // Pages suivantes de YouTube (applications) tant qu'il manque des titres
  const used = new Set();
  for (let guard = 0; out.length < TARGET && guard < 5 && !isWebApp(); guard++) {
    const token = [...tokens].reverse().find((t) => !used.has(t)); // le plus récent d'abord
    if (!token) break;
    used.add(token);
    try {
      const more = await innertubeContinue(token, region);
      if (more.token) tokens.push(more.token);
      out = mergeTracks(out, more);
    } catch (e) { lastError = e; break; }
  }
  if (out.length) { cacheSet(cacheId, out); return out; }
  // Rien de neuf : on ressort la dernière liste connue, même périmée, plutôt qu'un écran vide
  try { const v = JSON.parse(localStorage.getItem(cacheKey(cacheId))); if (v?.items?.length) return v.items; } catch (_) {}
  if (lastError) throw lastError;
  return [];
}

/** Tendances musicales d'un pays (ou du monde). */
export async function ytTrending(region = 'FR') {
  const year = new Date().getFullYear();
  const id = `trend.${region}.${new Date().toISOString().slice(0, 10)}`;
  const cached = cacheGet(id);
  if (cached) return cached;
  const key = getYtApiKey();
  if (key && region !== 'WW') {
    try {
      const official = await apiTrending(region, key); // classement officiel (pas disponible dans tous les pays)
      if (official.length >= 10) { cacheSet(id, official); return official; }
    } catch (e) { console.warn('API YouTube (tendances) :', e.message); }
  }
  const name = COUNTRY_NAMES[region] || '';
  const adj = COUNTRY_ADJ[region] || '';
  const queries = region === 'WW'
    ? [`top hits ${year} official music video`, `most viewed music videos ${year}`, `global top songs ${year}`]
    : [`top hits ${name} ${year}`, `musique ${adj} ${year}`, `${name} clip officiel ${year}`, `meilleures chansons ${adj}`];
  return multiSearch(id, queries, { region, recent: true, order: 'viewCount' });
}

/** Sorties récentes, éventuellement d'un genre. */
export async function ytNewReleases(region = 'FR', genre = '') {
  const name = COUNTRY_NAMES[region] || '';
  const adj = COUNTRY_ADJ[region] || '';
  const base = genre || (region === 'WW' ? 'new music' : `nouveauté musique ${adj}`);
  const queries = [`${base} ${name} clip officiel`, `${base} ${new Date().getFullYear()}`, `${genre || 'nouveau clip'} ${name}`]
    .map((q) => q.replace(/\s+/g, ' ').trim());
  return multiSearch(`new.${region}.${genre}`, queries, { region, recent: true, order: 'viewCount' });
}

/** Style musical d'un pays (Makossa au Cameroun, Twarab aux Comores…). */
export async function ytStyle(region = 'FR', style = '') {
  const name = region === 'WW' ? '' : (COUNTRY_NAMES[region] || '');
  const year = new Date().getFullYear();
  const queries = [`${style} ${name} ${year}`, `${style} ${name} clip officiel`, `${style} ${name}`, `${style}`]
    .map((q) => q.replace(/\s+/g, ' ').trim());
  return multiSearch(`style.${region}.${style}`, [...new Set(queries)], { region, recent: false });
}

/** Recherche libre (titre, artiste…). */
export async function ytSearch(q, region = 'FR') {
  return multiSearch(`search.${region}.${q.toLowerCase()}`, [q], { region, recent: false });
}
