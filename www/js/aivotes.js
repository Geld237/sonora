// Signalements « créé par IA » : chaque appareil vote une fois par titre (flèche haute = IA, flèche basse = pas IA).
// Un vote = un document Firestore « aivotes/{titre}__{identité de l'appareil} ». Aucun compte n'est nécessaire.
import * as cloud from './cloud.js';

const CACHE = 'sonora.aivotes';
const TTL = 10 * 60 * 1000;
const read = () => { try { return JSON.parse(localStorage.getItem(CACHE)) || {}; } catch (_) { return {}; } };
const write = (all) => {
  const keys = Object.keys(all);
  if (keys.length > 400) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 400)) delete all[k];
  try { localStorage.setItem(CACHE, JSON.stringify(all)); } catch (_) {}
};
const trackId = (key) => String(key).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
/** Seuls les titres en ligne ont un identifiant commun à tous les appareils. */
export const canVote = (t) => !!t && !t.live && (t.kind === 'youtube' || t.origin === 'audius');

/** Dernier décompte connu sur cet appareil (pour les listes), sans requête. */
export const knownVotes = (key) => read()[key] || null;

/** Décompte des votes d'un titre : { up, down, mine } (mine = 1, -1 ou 0). */
export async function getVotes(key, { fresh = false } = {}) {
  const all = read();
  const hit = all[key];
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit;
  const me = (await cloud.deviceToken()).uid;
  const id = trackId(key);
  const res = await cloud.authFetch(':runQuery', { method: 'POST', device: true, body: { structuredQuery: {
    from: [{ collectionId: 'aivotes' }], limit: 500, select: { fields: [{ fieldPath: 'v' }] },
    where: { fieldFilter: { field: { fieldPath: 'track' }, op: 'EQUAL', value: { stringValue: id } } },
  } } });
  const out = { up: 0, down: 0, mine: 0, at: Date.now() };
  for (const r of Array.isArray(res) ? res : []) {
    const d = r.document;
    if (!d) continue;
    const v = +d.fields?.v?.integerValue || 0;
    if (v > 0) out.up++; else if (v < 0) out.down++;
    if (d.name.endsWith(`__${me}`)) out.mine = v > 0 ? 1 : -1;
  }
  all[key] = out; write(all);
  return out;
}

/** Vote (1 = créé par IA, -1 = pas IA). Revoter la même chose retire le vote. */
export async function vote(key, v) {
  const s = await cloud.deviceToken();
  const id = trackId(key);
  const cur = await getVotes(key).catch(() => ({ up: 0, down: 0, mine: 0 }));
  const path = `aivotes/${id}__${s.uid}`;
  if (cur.mine === v) await cloud.authFetch(path, { method: 'DELETE', device: true });
  else await cloud.authFetch(path, { method: 'PATCH', device: true, body: { fields: { track: { stringValue: id }, v: { integerValue: String(v) }, at: { integerValue: String(Date.now()) } } } });
  return getVotes(key, { fresh: true });
}
