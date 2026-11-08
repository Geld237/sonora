// Sources en ligne gratuites, légales et sans publicité (aucune clé API nécessaire) :
//  - Internet Archive (archive.org) : musique libre (netlabels) et films du domaine public
//  - Radio Browser (radio-browser.info) : plus de 40 000 radios du monde entier

import { getSettings, markSettingsChanged } from './settings.js';

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
export const getYtApiKey = () => { try { return (localStorage.getItem(YT_KEY_STORE) || '').trim(); } catch (_) { return ''; } };
export const setYtApiKey = (k, { silent = false } = {}) => { try { localStorage.setItem(YT_KEY_STORE, (k || '').trim()); } catch (_) {} if (!silent) markSettingsChanged(); };

/** Requête HTTP sans restriction CORS : processus principal (Windows) ou natif (iPhone). */
async function httpRequest({ url, method = 'GET', headers = {}, body = null, timeout = 15000 }) {
  const cap = window.Capacitor;
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé')), timeout))]);
  if (window.sonora?.http) {
    const r = await withTimeout(window.sonora.http({ url, method, headers, body: body ? JSON.stringify(body) : undefined }));
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(r.text);
  }
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.nativePromise === 'function') {
    const r = await withTimeout(cap.nativePromise('CapacitorHttp', 'request', { url, method, headers, data: body || undefined, responseType: 'json' }));
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const res = await withTimeout(fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined }));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
  const p = new URLSearchParams({ part: 'snippet,contentDetails,status', chart: 'mostPopular', videoCategoryId: '10', regionCode: region || 'FR', maxResults: '50', hl: 'fr', key });
  const d = await httpRequest({ url: `${YT_API}/videos?${p}` });
  return (d.items || []).filter((v) => v.status?.embeddable !== false).map((v) => ytTrack({
    id: v.id, title: v.snippet?.title, channel: v.snippet?.channelTitle, duration: parseIsoDuration(v.contentDetails?.duration),
  }));
}

async function apiSearch(q, { region = 'FR', recent = false } = {}, key) {
  const p = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', videoEmbeddable: 'true', maxResults: '40', q, regionCode: region, relevanceLanguage: 'fr', key });
  if (recent) p.set('publishedAfter', new Date(Date.now() - 30 * 86400000).toISOString());
  const d = await httpRequest({ url: `${YT_API}/search?${p}` });
  const ids = (d.items || []).map((i) => i.id?.videoId).filter(Boolean);
  return apiVideos(ids, key); // ajoute les durées
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
  for (const k in node) if (k !== 'videoRenderer') collectVideos(node[k], out, seen);
}

async function innertubeSearch(query, { region = 'FR', recent = false } = {}) {
  const body = {
    context: { client: { clientName: 'WEB', clientVersion: '2.20251105.01.00', hl: 'fr', gl: region || 'FR' } },
    query,
    params: recent ? SP_VIDEOS_MONTH : SP_VIDEOS,
  };
  let d;
  try {
    d = await httpRequest({ url: INNERTUBE, method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } catch (e) {
    if (isWebApp()) throw new Error('Version web : ajoutez une clé API YouTube gratuite pour afficher les titres (« ⚙️ Source des titres », en bas de cette page).');
    throw e;
  }
  const out = [];
  collectVideos(d, out, new Set());
  return out;
}

const COUNTRY_NAMES = { FR: 'France', CI: "Côte d'Ivoire", SN: 'Sénégal', CM: 'Cameroun', CD: 'Congo', BE: 'Belgique', CA: 'Québec', MA: 'Maroc', ML: 'Mali', NG: 'Nigeria', US: 'USA', GB: 'UK', HT: 'Haïti' };

/* ---------- Fonctions utilisées par l'interface ---------- */
/** Mode utilisé : 'api' (clé officielle) ou 'interne' */
export const ytMode = () => (getYtApiKey() ? 'api' : 'interne');

/** Tendances musicales d'un pays. */
export async function ytTrending(region = 'FR') {
  const key = getYtApiKey();
  if (key) {
    try {
      const list = await apiTrending(region, key);
      if (list.length) return list;
    } catch (e) { console.warn('API YouTube (tendances) :', e.message); }
  }
  const year = new Date().getFullYear();
  return innertubeSearch(`top hits ${COUNTRY_NAMES[region] || ''} ${year} clip officiel`, { region, recent: true });
}

/** Sorties récentes (30 derniers jours), éventuellement d'un genre. */
export async function ytNewReleases(region = 'FR', genre = '') {
  const q = `${genre || 'nouveauté musique'} clip officiel`;
  const key = getYtApiKey();
  if (key) {
    try { return await apiSearch(q, { region, recent: true }, key); } catch (e) { console.warn('API YouTube (nouveautés) :', e.message); }
  }
  return innertubeSearch(q, { region, recent: true });
}

/** Recherche libre (titre, artiste…). */
export async function ytSearch(q, region = 'FR') {
  const key = getYtApiKey();
  if (key) {
    try { return await apiSearch(q, { region }, key); } catch (e) { console.warn('API YouTube (recherche) :', e.message); }
  }
  return innertubeSearch(q, { region });
}
