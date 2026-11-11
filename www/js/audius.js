// Audius : plateforme ouverte où les artistes publient eux-mêmes leur musique.
// API publique et gratuite (https://docs.audius.co/api) : tendances, recherche, écoute complète.
import { getJSON } from './net.js';
import { BUILD } from './build-info.js';

const API = 'https://api.audius.co/v1';
const APP = 'Enora';
const TTL = 3 * 3600 * 1000;
const mem = new Map();

const headers = () => (BUILD.audiusKey ? { 'x-api-key': BUILD.audiusKey } : {});
const withApp = (url) => `${url}${url.includes('?') ? '&' : '?'}app_name=${APP}`;

/** Genres d'Audius proposés dans Enora (nom affiché, nom dans l'API). */
export const AUDIUS_GENRES = [
  ['Tout', ''], ['Électro', 'Electronic'], ['Hip-hop / Rap', 'Hip-Hop/Rap'], ['Pop', 'Pop'], ['R&B / Soul', 'R&B/Soul'], ['Rock', 'Rock'], ['Alternatif', 'Alternative'],
  ['Latino', 'Latin'], ['Reggae', 'Reggae'], ['Dancehall', 'Dancehall'], ['Musiques du monde', 'World'], ['Jazz', 'Jazz'], ['Lo-fi', 'Lo-Fi'], ['Ambient', 'Ambient'],
  ['House', 'House'], ['Techno', 'Techno'], ['Trap', 'Trap'], ['Acoustique', 'Acoustic'], ['Classique', 'Classical'], ['Bandes originales', 'Soundtrack'],
];

function toTrack(t) {
  if (!t || !t.id || t.is_streamable === false || t.is_delete || t.is_unlisted) return null;
  const art = t.artwork || {};
  const year = t.release_date ? new Date(String(t.release_date).replace(' ', 'T')).getFullYear() : 0;
  return {
    key: `audius:${t.id}`, title: t.title || 'Sans titre', artist: t.user?.name || t.user?.handle || 'Artiste Audius',
    cover: art['480x480'] || art['150x150'] || art['1000x1000'] || '', kind: 'audio', origin: 'audius',
    src: withApp(`${API}/tracks/${encodeURIComponent(t.id)}/stream`), duration: t.duration || 0,
    plays: t.play_count || 0, likes: t.favorite_count || 0, ...(year > 1900 ? { year } : {}),
    genre: t.genre || '', mood: t.mood || '', ...(t.ai_attribution_user_id ? { ai: 'declared' } : {}),
    ...(t.is_downloadable ? { downloadable: true } : {}), link: t.permalink ? `https://audius.co${t.permalink}` : '',
  };
}

async function list(url) {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const d = await getJSON(withApp(url), { headers: headers(), timeout: 15000 });
  const items = (d.data || []).map(toTrack).filter(Boolean);
  if (items.length) mem.set(url, { at: Date.now(), items });
  return items;
}

/** Titres les plus écoutés de la semaine (ou du mois), éventuellement d'un genre. */
export async function audiusTrending(genre = '', time = 'week') {
  const p = new URLSearchParams({ time });
  if (genre) p.set('genre', genre);
  return list(`${API}/tracks/trending?${p}`);
}

export async function audiusSearch(query, genre = '') {
  const p = new URLSearchParams({ query });
  if (genre) p.set('genre', genre);
  return list(`${API}/tracks/search?${p}`);
}

/** Titres d'une humeur : tendances du mois filtrées, complétées par une recherche si besoin. */
export async function audiusMood(moods = [], words = '') {
  const set = new Set(moods.map((m) => m.toLowerCase()));
  const seen = new Set();
  const out = [];
  const add = (l) => { for (const t of l) if (!seen.has(t.key)) { seen.add(t.key); out.push(t); } };
  for (const time of ['week', 'month', 'allTime']) {
    try { add((await audiusTrending('', time)).filter((t) => set.has((t.mood || '').toLowerCase()))); } catch (e) { if (!out.length && time === 'allTime') throw e; }
    if (out.length >= 30) break;
  }
  if (out.length < 15 && words) { try { add(await audiusSearch(words)); } catch (_) {} }
  return out;
}
