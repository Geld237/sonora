// Blind test en soirée : l'hôte diffuse le son, les joueurs répondent sur leur téléphone (QR code).
// Un document Firestore « rooms/P{CODE} » porte l'état de la partie ; chaque joueur écrit « rooms/P{CODE}-{id} ».
import * as cloud from './cloud.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => ALPHA[b % ALPHA.length]).join('');
export const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
const doc = (code) => `rooms/P${code}`;
// « owner » = identité de l'auteur : la règle Firestore n'autorise que lui à modifier son document
const wrap = (data, owner, extra = {}) => ({ fields: { data: { stringValue: JSON.stringify(data) }, at: { integerValue: String(Date.now()) }, owner: { stringValue: owner }, ...extra } });
const unwrap = (d) => { try { return JSON.parse(d.fields.data.stringValue); } catch (_) { return null; } };
const opt = { guest: true };

export const myId = async () => (await cloud.anyToken()).uid;

/* ---------- Hôte ---------- */
export async function hostWrite(code, state) { await cloud.authFetch(doc(code), { method: 'PATCH', body: wrap(state, await myId()), ...opt }); }
export async function hostClose(code) { try { await cloud.authFetch(doc(code), { method: 'DELETE', ...opt }); } catch (_) {} }
/** Joueurs de la partie : { id, name, team, i, pick, ms } */
export async function hostPlayers(code) {
  const res = await cloud.authFetch(':runQuery', { method: 'POST', ...opt, body: { structuredQuery: {
    from: [{ collectionId: 'rooms' }], limit: 80,
    where: { fieldFilter: { field: { fieldPath: 'game' }, op: 'EQUAL', value: { stringValue: code } } },
  } } });
  return (Array.isArray(res) ? res : []).map((r) => r.document).filter(Boolean).map((d) => ({ ...(unwrap(d) || {}), id: d.name.split('-').pop() })).filter((p) => p.name && /^[A-Za-z0-9]{6,}$/.test(p.id) && p.id !== 'host');
}

/* ---------- Joueur ---------- */
export async function readParty(code) {
  try { return unwrap(await cloud.authFetch(doc(code), opt)); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
export async function playerWrite(code, id, data) {
  await cloud.authFetch(`${doc(code)}-${id}`, { method: 'PATCH', body: wrap(data, id, { game: { stringValue: code } }), ...opt });
}
export async function playerLeave(code, id) { try { await cloud.authFetch(`${doc(code)}-${id}`, { method: 'DELETE', ...opt }); } catch (_) {} }
