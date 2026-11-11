// Podcasts : annuaire public d'Apple pour la recherche, puis le flux RSS ouvert de chaque émission.
import { getJSON, getText } from './net.js';

const SUBS = 'sonora.podcasts';
const POS = 'sonora.podpos';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

export const getSubscriptions = () => read(SUBS, []);
export const setSubscriptions = (list) => write(SUBS, list);
export const isSubscribed = (feed) => getSubscriptions().some((p) => p.feed === feed);
export function toggleSubscription(p) {
  const list = getSubscriptions();
  const i = list.findIndex((x) => x.feed === p.feed);
  if (i >= 0) list.splice(i, 1); else list.unshift({ feed: p.feed, title: p.title, author: p.author || '', cover: p.cover || '', addedAt: Date.now() });
  write(SUBS, list);
  return i < 0;
}

/** Reprise de lecture : position enregistrée par épisode. */
export const getPosition = (key) => read(POS, {})[key] || 0;
export function setPosition(key, sec, duration = 0) {
  const all = read(POS, {});
  if (duration && sec > duration - 20) delete all[key]; else all[key] = Math.floor(sec);
  const keys = Object.keys(all);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete all[k];
  write(POS, all);
}

const fromItunes = (r) => ({ id: String(r.collectionId || r.trackId || ''), title: r.collectionName || r.trackName || '', author: r.artistName || '', cover: r.artworkUrl600 || r.artworkUrl100 || '', feed: r.feedUrl || '' });

export async function podcastSearch(term, country = 'fr') {
  const d = await getJSON(`https://itunes.apple.com/search?media=podcast&limit=30&country=${country}&term=${encodeURIComponent(term)}`);
  return (d.results || []).map(fromItunes).filter((p) => p.feed);
}

/** Podcasts les plus écoutés du pays. */
export async function podcastTop(country = 'fr') {
  try {
    const d = await getJSON(`https://itunes.apple.com/${country}/rss/toppodcasts/limit=30/json`);
    const list = (d.feed?.entry || []).map((e) => ({
      id: e.id?.attributes?.['im:id'] || '', title: e['im:name']?.label || '', author: e['im:artist']?.label || '',
      cover: (e['im:image'] || []).slice(-1)[0]?.label || '', feed: '',
    })).filter((p) => p.id);
    if (list.length) return list;
  } catch (_) {}
  return podcastSearch('podcast', country);
}

export async function podcastLookup(id) {
  const d = await getJSON(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`);
  const r = (d.results || [])[0];
  return r ? fromItunes(r) : null;
}

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
function seconds(v) {
  if (!v) return 0;
  const p = String(v).trim().split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return p.reduce((a, n) => a * 60 + n, 0);
}
const text = (node, sel) => { const e = node.getElementsByTagName(sel)[0]; return e ? (e.textContent || '').trim() : ''; };
const strip = (html) => { const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html'); return (d.body.textContent || '').replace(/\s+/g, ' ').trim(); };

/** Lit le flux RSS d'une émission : description et épisodes (pistes jouables). */
export async function podcastFeed(feed) {
  const xml = await getText(feed, { timeout: 20000 });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ch = doc.getElementsByTagName('channel')[0];
  if (!ch) throw new Error('Flux du podcast illisible');
  const title = text(ch, 'title');
  const img = ch.getElementsByTagName('itunes:image')[0]?.getAttribute('href') || text(ch.getElementsByTagName('image')[0] || ch, 'url');
  const episodes = [...doc.getElementsByTagName('item')].slice(0, 150).map((it) => {
    const enc = it.getElementsByTagName('enclosure')[0];
    const url = enc?.getAttribute('url') || '';
    if (!url) return null;
    const type = enc.getAttribute('type') || '';
    const cover = it.getElementsByTagName('itunes:image')[0]?.getAttribute('href') || img;
    return {
      key: `pod:${hash(text(it, 'guid') || url)}`, title: text(it, 'title'), artist: title, album: title, cover,
      kind: /^video/.test(type) ? 'video' : 'audio', origin: 'podcast', src: url.replace(/^http:/, 'https:'),
      duration: seconds(text(it, 'itunes:duration')), date: Date.parse(text(it, 'pubDate')) || 0,
      size: +enc.getAttribute('length') || 0, note: strip(text(it, 'description') || text(it, 'itunes:summary')).slice(0, 220),
    };
  }).filter(Boolean);
  return { feed, title, author: text(ch, 'itunes:author'), cover: img, description: strip(text(ch, 'description')).slice(0, 600), episodes };
}
