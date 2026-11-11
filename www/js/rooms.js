// Écoute à plusieurs : un salon = un document Firestore « rooms/{CODE} » que l'hôte met à jour
// (titre, position, lecture/pause) et que les invités relisent toutes les 3 secondes.
import * as cloud from './cloud.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join('');
const POLL = 3000;

let room = null;      // { code, host: bool, timer, offset, last }
let hooks = null;     // { getState, apply, onStatus }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(room); } catch (_) {} });

export const currentRoom = () => room;
export function onRoom(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function initRooms(h) { hooks = h; }

function fields(obj) { return { fields: { data: { stringValue: JSON.stringify(obj) }, at: { integerValue: String(Date.now()) } } }; }
function parse(doc) { try { return { data: JSON.parse(doc.fields.data.stringValue), updateTime: Date.parse(doc.updateTime) }; } catch (_) { return null; } }

/** Écrit l'état du salon ; renvoie l'heure du serveur (pour compenser le décalage des horloges). */
async function write(code, data) {
  const t0 = Date.now();
  const doc = await cloud.authFetch(`rooms/${code}`, { method: 'PATCH', body: fields(data) });
  const t1 = Date.now();
  const server = Date.parse(doc.updateTime);
  if (server && room) room.offset = server - (t0 + t1) / 2; // heure serveur - heure locale
  return doc;
}

const shareable = (t) => !!t && (t.kind === 'youtube' || /^https?:/.test(t.src || ''));
function snapshot() {
  const s = hooks.getState();
  const t = shareable(s.track) ? { ...s.track } : null;
  if (t) { delete t.mediaId; if (t.cover && t.cover.startsWith('blob:')) delete t.cover; }
  return { v: 1, track: t, pos: Math.round((s.position || 0) * 10) / 10, playing: !!s.playing && !!t, name: (cloud.getSession()?.email || '').split('@')[0].slice(0, 20) };
}

/** Crée un salon : cet appareil devient l'hôte. */
export async function createRoom() {
  if (!cloud.isLoggedIn()) throw new Error('Connectez-vous à votre compte Enora (Réglages) pour écouter à plusieurs.');
  await leaveRoom();
  const code = newCode();
  room = { code, host: true, offset: 0, last: '' };
  try { await write(code, snapshot()); } catch (e) { room = null; throw e; }
  room.timer = setInterval(() => pushState(false), 8000);
  emit();
  return code;
}

/** Hôte : publie l'état (à chaque changement, et toutes les 8 secondes). */
export async function pushState(force = true) {
  if (!room?.host) return;
  const snap = snapshot();
  const sig = JSON.stringify([snap.track?.key, snap.playing]);
  if (!force && sig === room.last && !snap.playing) return;
  room.last = sig;
  try { await write(room.code, snap); room.error = ''; } catch (e) { room.error = e.message; emit(); }
}

/** Rejoint un salon : cet appareil suit l'hôte. */
export async function joinRoom(input) {
  if (!cloud.isLoggedIn()) throw new Error('Connectez-vous à votre compte Enora (Réglages) pour écouter à plusieurs.');
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new Error('Le code du salon comporte 6 caractères.');
  await leaveRoom();
  const doc = await cloud.authFetch(`rooms/${code}`).catch((e) => { if (e.status === 404) throw new Error('Aucun salon avec ce code.'); throw e; });
  room = { code, host: false, offset: 0, last: '' };
  // Une petite écriture pour mesurer le décalage entre l'horloge de l'appareil et celle du serveur
  const probe = `${code}-${cloud.getSession().uid.slice(0, 8)}`;
  try { await write(probe, { v: 1, member: true }); cloud.authFetch(`rooms/${probe}`, { method: 'DELETE' }).catch(() => {}); } catch (_) {}
  follow(doc);
  room.timer = setInterval(async () => {
    if (!room || room.host) return;
    try { follow(await cloud.authFetch(`rooms/${room.code}`)); room.error = ''; }
    catch (e) { if (e.status === 404) { hooks.onStatus?.('Le salon a été fermé.'); leaveRoom(); } else { room.error = e.message; emit(); } }
  }, POLL);
  emit();
  return code;
}

function follow(doc) {
  const p = parse(doc);
  if (!p || !room) return;
  if (p.data.closed) { hooks.onStatus?.('Le salon a été fermé.'); leaveRoom(); return; }
  const serverNow = Date.now() + (room.offset || 0);
  const age = Math.max(0, (serverNow - p.updateTime) / 1000);
  if (age > 40 && p.data.playing) return; // l'hôte ne répond plus : on laisse la lecture continuer
  room.hostName = p.data.name || '';
  hooks.apply({ track: p.data.track, playing: p.data.playing, position: p.data.pos + (p.data.playing ? age : 0) });
}

export async function leaveRoom() {
  if (!room) return;
  const r = room;
  clearInterval(r.timer);
  room = null;
  emit();
  if (r.host) { try { await cloud.authFetch(`rooms/${r.code}`, { method: 'DELETE' }); } catch (_) {} }
}
