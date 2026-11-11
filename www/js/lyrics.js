// Paroles automatiques : LRCLIB (base ouverte et gratuite, sans clé). https://lrclib.net
import { getJSON } from './net.js';

const API = 'https://lrclib.net/api';
const STORE = 'sonora.lyrics';
const MAX = 40; // paroles gardées sur l'appareil

function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (_) { return {}; } }
function save(all) {
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, MAX);
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]])))); } catch (_) {}
}

/** Nettoie un titre de clip : « (Clip officiel) », « feat. … », « [4K] »… */
export function cleanTitle(s) {
  return String(s || '')
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s+[-–—|]\s+(clip|official|officiel|lyrics?|paroles|audio|video|vidéo).*$/i, '')
    .replace(/["«»“”]/g, '')
    .replace(/\s+/g, ' ').trim();
}
const cleanArtist = (s) => {
  const a = String(s || '').split(/\s*(?:,|&| x | feat\.?| ft\.?)\s*/i)[0].trim();
  return /^(youtube|inconnu|artiste inconnu|vidéo locale)$/i.test(a) ? '' : a;
};

/**
 * Cherche les paroles d'un titre. Renvoie { text, timed } ou null.
 * Les paroles synchronisées ne sont utilisées que si la durée correspond (sinon elles seraient décalées).
 */
export async function fetchLyrics(track, duration = 0) {
  if (!track || track.live || track.kind === 'video' || track.origin === 'podcast' || track.origin === 'radio') return null;
  const all = load();
  const hit = all[track.key];
  if (hit && Date.now() - hit.at < (hit.text ? 90 : 3) * 86400000) return hit.text ? { text: hit.text, timed: hit.timed } : null;
  const title = cleanTitle(track.title);
  const artist = cleanArtist(track.artist);
  if (title.length < 2) return null;
  const urls = [];
  if (artist) urls.push(`${API}/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`);
  urls.push(`${API}/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}`);
  let best = null;
  for (const u of urls) {
    let list = [];
    try { list = await getJSON(u, { timeout: 10000 }); } catch (_) { continue; }
    if (!Array.isArray(list)) continue;
    const scored = list.filter((x) => x && (x.syncedLyrics || x.plainLyrics)).map((x) => {
      const diff = duration && x.duration ? Math.abs(x.duration - duration) : 999;
      return { x, diff, score: (x.syncedLyrics && diff <= 3 ? 0 : 1000) + Math.min(diff, 900) };
    }).sort((a, b) => a.score - b.score);
    if (scored.length) { best = scored[0]; break; }
  }
  let out = null;
  if (best) {
    const timed = !!best.x.syncedLyrics && best.diff <= 3;
    const text = timed ? best.x.syncedLyrics : (best.x.plainLyrics || best.x.syncedLyrics.replace(/\[[\d:.]+\]\s?/g, ''));
    out = { text, timed };
  }
  all[track.key] = { at: Date.now(), text: out?.text || '', timed: !!out?.timed };
  save(all);
  return out;
}
