// Écoute à plusieurs : un salon = un document Firestore « rooms/{CODE} » que l'hôte met à jour
// (titre, position, lecture/pause) et que les invités relisent toutes les 3 secondes.
import * as cloud from './cloud.js';
import { getProfileName } from './profile.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join('');
const POLL = 3000;

let joining = false;
let room = null;      // { code, host: bool, timer, offset, last }
let hooks = null;     // { getState, apply, onStatus }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(room); } catch (_) {} });

export const currentRoom = () => room;
export function onRoom(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function initRooms(h) { hooks = h; }

// « owner » = identité de l'auteur du document : la règle Firestore n'autorise que lui à le modifier
function fields(obj) { return { fields: { data: { stringValue: JSON.stringify(obj) }, at: { integerValue: String(Date.now()) }, owner: { stringValue: cloud.getSession()?.uid || '' } } }; }
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
/** Piste allégée pour le salon (jamais de fichier de l'appareil). */
function strip(track) {
  if (!shareable(track)) return null;
  const t = { ...track };
  delete t.mediaId; delete t.sub; delete t.note;
  if (t.cover && !/^https?:/.test(t.cover)) delete t.cover;
  return t;
}

/** Droits des invités, choisis par l'hôte. */
export const ROOM_PERMS = ['none', 'add', 'next', 'dj'];
const ALLOWED = { add: ['add', 'next', 'dj'], next: ['next', 'dj'], play: ['dj'], toggle: ['dj'], skip: ['dj'] };
export const guestCan = (type) => !!room && !room.host && (ALLOWED[type] || []).includes(room.perm || 'none');

function snapshot() {
  const s = hooks.getState();
  const t = strip(s.track);
  return {
    v: 2, track: t, pos: Math.round((s.position || 0) * 10) / 10, playing: !!s.playing && !!t, name: getProfileName() || 'Anonyme', // jamais l'adresse e-mail
    perm: room?.perm || 'none', queue: (s.queue || []).map(strip).filter(Boolean).slice(0, 25),
  };
}

/** Crée un salon : cet appareil devient l'hôte. */
export async function createRoom(perm = 'none') {
  if (!cloud.isLoggedIn()) throw new Error('Connectez-vous à votre compte Enora (Réglages) pour écouter à plusieurs.');
  await leaveRoom();
  const code = newCode();
  room = { code, host: true, offset: 0, last: '', perm: ROOM_PERMS.includes(perm) ? perm : 'none', handled: new Set(), members: 0 };
  try { await write(code, snapshot()); } catch (e) { room = null; throw e; }
  room.timer = setInterval(() => pushState(false), 8000);
  room.reqTimer = setInterval(pollRequests, POLL);
  emit();
  return code;
}

/** Hôte : change les droits des invités. */
export async function setRoomPerm(perm) {
  if (!room?.host || !ROOM_PERMS.includes(perm)) return;
  room.perm = perm;
  emit();
  await pushState(true);
}

/** Hôte : publie l'état (à chaque changement, et toutes les 8 secondes). */
export async function pushState(force = true) {
  const r = room;
  if (!r?.host) return;
  const snap = snapshot();
  const sig = JSON.stringify([snap.track?.key, snap.playing, snap.perm, snap.queue.map((t) => t.key)]);
  if (!force && sig === r.last && !snap.playing) return;
  r.last = sig;
  try { await write(r.code, snap); r.error = ''; } catch (e) { if (room === r) { r.error = e.message; emit(); } }
}

/** Hôte : lit les demandes des invités (ajouter un titre, choisir le suivant, piloter la lecture). */
async function pollRequests() {
  const r = room;
  if (!r?.host || r.polling) return;
  r.polling = true;
  try {
    const res = await cloud.authFetch(':runQuery', { method: 'POST', body: { structuredQuery: {
      from: [{ collectionId: 'rooms' }], limit: 60,
      where: { fieldFilter: { field: { fieldPath: 'room' }, op: 'EQUAL', value: { stringValue: r.code } } },
    } } });
    const docs = (Array.isArray(res) ? res : []).map((x) => x.document).filter(Boolean);
    if (room !== r) return;
    if (docs.length !== r.members) { r.members = docs.length; emit(); }
    for (const d of docs) {
      const p = parse(d);
      for (const q of p?.data?.reqs || []) {
        if (!q?.id || r.handled.has(q.id)) continue;
        r.handled.add(q.id);
        if (!(ALLOWED[q.type] || []).includes(r.perm)) continue; // droit retiré entre-temps
        try { await hooks.request({ type: q.type, track: q.track || null }, String(p.data.name || 'Un invité').slice(0, 20)); } catch (_) {}
      }
    }
  } catch (_) {} finally { r.polling = false; }
}

/** Rejoint un salon : cet appareil suit l'hôte. */
export async function joinRoom(input) {
  if (!cloud.isLoggedIn()) throw new Error('Connectez-vous à votre compte Enora (Réglages) pour écouter à plusieurs.');
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new Error('Le code du salon comporte 6 caractères.');
  if (joining) throw new Error('Connexion au salon en cours…');
  joining = true;
  let doc;
  try {
    await leaveRoom();
    doc = await cloud.authFetch(`rooms/${code}`).catch((e) => { if (e.status === 404) throw new Error('Aucun salon avec ce code.'); throw e; });
  } finally { joining = false; }
  room = { code, host: false, offset: 0, last: '', perm: 'none', queue: [], reqs: [], member: `${code}-${cloud.getSession().uid.slice(0, 8)}` };
  // La fiche de l'invité : elle porte ses demandes, et sert à mesurer le décalage d'horloge avec le serveur
  try { await writeMember(); } catch (_) {}
  follow(doc);
  const r = room;
  r.timer = setInterval(async () => {
    if (room !== r) { clearInterval(r.timer); return; }
    try { const d = await cloud.authFetch(`rooms/${r.code}`); if (room !== r) return; follow(d); r.error = ''; }
    catch (e) { if (room !== r) return; if (e.status === 404) { hooks.onStatus?.('Le salon a été fermé.'); leaveRoom(); } else { r.error = e.message; emit(); } }
  }, POLL);
  emit();
  return code;
}

async function writeMember() {
  const r = room;
  const t0 = Date.now();
  const body = fields({ v: 2, name: getProfileName() || 'Anonyme', reqs: r.reqs });
  body.fields.room = { stringValue: r.code };
  const doc = await cloud.authFetch(`rooms/${r.member}`, { method: 'PATCH', body });
  const server = Date.parse(doc.updateTime);
  if (server && room === r) r.offset = server - (t0 + Date.now()) / 2;
}

/** Invité : envoie une demande à l'hôte. type = add | next | play | toggle | skip */
export async function sendRequest(type, track = null) {
  if (!guestCan(type)) throw new Error('L\'hôte n\'a pas autorisé cette action.');
  const t = track ? strip(track) : null;
  if (track && !t) throw new Error('Seuls les titres en ligne peuvent être proposés au salon.');
  const r = room;
  const before = r.reqs;
  r.reqs = [...before, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, type, track: t }].slice(-8);
  try { await writeMember(); } catch (e) { r.reqs = before; throw e; } // envoi raté : la demande n'est pas rejouée plus tard
}

function follow(doc) {
  const p = parse(doc);
  if (!p || !room) return;
  if (p.data.closed) { hooks.onStatus?.('Le salon a été fermé.'); leaveRoom(); return; }
  const serverNow = Date.now() + (room.offset || 0);
  const age = Math.max(0, (serverNow - p.updateTime) / 1000);
  const changed = room.perm !== (p.data.perm || 'none') || room.hostName !== (p.data.name || '');
  room.hostName = p.data.name || '';
  room.perm = p.data.perm || 'none';
  room.queue = Array.isArray(p.data.queue) ? p.data.queue : [];
  if (changed) emit();
  if (age > 40 && p.data.playing) return; // l'hôte ne répond plus : on laisse la lecture continuer
  hooks.apply({ track: p.data.track, playing: p.data.playing, position: p.data.pos + (p.data.playing ? age : 0), queue: room.queue });
}

export async function leaveRoom() {
  if (!room) return;
  const r = room;
  clearInterval(r.timer); clearInterval(r.reqTimer);
  room = null;
  emit();
  try { await cloud.authFetch(`rooms/${r.host ? r.code : r.member}`, { method: 'DELETE' }); } catch (_) {}
}
