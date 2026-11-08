// Compte Sonora et synchronisation entre appareils (Windows, Android, iPhone).
// Service : Firebase (gratuit) — Authentication (e-mail + mot de passe) et Cloud Firestore.
// Les appels se font par les API REST officielles de Firebase : aucune bibliothèque à installer.
//
// Données synchronisées : favoris, playlists, sites de streaming, réglages.
// (Les fichiers audio/vidéo hors-ligne restent sur chaque appareil : ils sont trop volumineux.)

import { FIREBASE } from './cloud-config.js';
import { BUILD } from './build-info.js';

const SESSION_KEY = 'sonora.cloud.session';
const CONFIG_KEY = 'sonora.cloud.config';
const TOMB_KEY = 'sonora.cloud.tombstones';
const LAST_SYNC_KEY = 'sonora.cloud.lastSync';
const TOMB_TTL = 90 * 86400000; // les suppressions sont mémorisées 90 jours

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

/* ---------- Configuration du projet Firebase ---------- */
/** Identifiants Firebase : ceux de la publication (secrets GitHub), sinon cloud-config.js, sinon saisis pour un test. */
export function getConfig() {
  const b = BUILD.firebase || {};
  const custom = ls.get(CONFIG_KEY, {}) || {};
  return {
    apiKey: b.apiKey || FIREBASE.apiKey || custom.apiKey || '',
    projectId: b.projectId || FIREBASE.projectId || custom.projectId || '',
  };
}
export function setConfig(apiKey, projectId) { ls.set(CONFIG_KEY, { apiKey: (apiKey || '').trim(), projectId: (projectId || '').trim() }); }
export const isConfigured = () => { const c = getConfig(); return !!(c.apiKey && c.projectId); };
export const isBuiltInConfig = () => !!((BUILD.firebase?.apiKey && BUILD.firebase?.projectId) || (FIREBASE.apiKey && FIREBASE.projectId));

/* ---------- Session ---------- */
export const getSession = () => ls.get(SESSION_KEY);
export const isLoggedIn = () => !!getSession();
export const lastSync = () => ls.get(LAST_SYNC_KEY, 0);

const ERRORS = {
  EMAIL_EXISTS: 'Un compte existe déjà avec cette adresse.',
  EMAIL_NOT_FOUND: 'Aucun compte avec cette adresse.',
  INVALID_PASSWORD: 'Mot de passe incorrect.',
  INVALID_LOGIN_CREDENTIALS: 'Adresse ou mot de passe incorrect.',
  INVALID_EMAIL: 'Adresse e-mail invalide.',
  WEAK_PASSWORD: 'Mot de passe trop court (6 caractères minimum).',
  USER_DISABLED: 'Ce compte est désactivé.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives. Réessayez dans quelques minutes.',
  OPERATION_NOT_ALLOWED: 'La connexion par e-mail n\'est pas activée dans Firebase (Authentication → Sign-in method → E-mail/Mot de passe).',
  PERMISSION_DENIED: 'Accès refusé par Firestore : vérifiez les règles de sécurité.',
  API_KEY_INVALID: 'Clé Firebase invalide.',
};
function niceError(code, fallback) {
  const key = String(code || '').split(' ')[0].split(':')[0].trim();
  return new Error(ERRORS[key] || fallback || code || 'Erreur de connexion');
}

async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw niceError(data?.error?.message, `HTTP ${res.status}`);
  return data;
}

function saveSession(d) {
  const s = {
    uid: d.localId || d.user_id,
    email: d.email || getSession()?.email || '',
    idToken: d.idToken || d.id_token,
    refreshToken: d.refreshToken || d.refresh_token,
    expiresAt: Date.now() + (parseInt(d.expiresIn || d.expires_in || '3600', 10) - 60) * 1000,
  };
  ls.set(SESSION_KEY, s);
  return s;
}

export async function signUp(email, password) {
  if (!isConfigured()) throw new Error('Compte non configuré');
  const d = await postJSON(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${getConfig().apiKey}`, { email, password, returnSecureToken: true });
  saveSession(d);
  return syncNow();
}

export async function signIn(email, password) {
  if (!isConfigured()) throw new Error('Compte non configuré');
  const d = await postJSON(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${getConfig().apiKey}`, { email, password, returnSecureToken: true });
  saveSession(d);
  return syncNow();
}

export async function resetPassword(email) {
  await postJSON(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${getConfig().apiKey}`, { requestType: 'PASSWORD_RESET', email });
}

export function signOut() {
  ls.del(SESSION_KEY);
  ls.del(LAST_SYNC_KEY);
  emit('status');
}

async function token() {
  let s = getSession();
  if (!s) throw new Error('Non connecté');
  if (Date.now() < s.expiresAt) return s;
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${getConfig().apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }).toString(),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(d?.error?.message || '')) signOut();
    throw niceError(d?.error?.message, 'Session expirée');
  }
  s = saveSession(d);
  return s;
}

/* ---------- Document Firestore : users/{uid} ---------- */
const docUrl = (uid) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getConfig().projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;

async function readRemote() {
  const s = await token();
  const res = await fetch(docUrl(s.uid), { headers: { Authorization: `Bearer ${s.idToken}` } });
  if (res.status === 404) return null;
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw niceError(d?.error?.status, d?.error?.message || `HTTP ${res.status}`);
  const raw = d?.fields?.data?.stringValue;
  try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}

async function writeRemote(data) {
  const s = await token();
  const body = { fields: { data: { stringValue: JSON.stringify(data) }, updatedAt: { integerValue: String(Date.now()) }, email: { stringValue: s.email || '' } } };
  const res = await fetch(docUrl(s.uid), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${s.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw niceError(d?.error?.status, d?.error?.message || `HTTP ${res.status}`);
  }
}

/* ---------- Suppressions (pour qu'un élément supprimé sur un appareil le soit partout) ---------- */
export function markDeleted(collection, id) {
  const t = ls.get(TOMB_KEY, {}) || {};
  t[`${collection}:${id}`] = Date.now();
  ls.set(TOMB_KEY, t);
  touch();
}

/* ---------- Fusion ---------- */
const ts = (x) => (x && (x.updatedAt || x.addedAt || x.createdAt)) || 0;

export function mergeData(local, remote) {
  remote = remote || {};
  const tombs = { ...(remote.tombstones || {}) };
  for (const [k, v] of Object.entries(local.tombstones || {})) tombs[k] = Math.max(tombs[k] || 0, v);
  const now = Date.now();
  for (const k of Object.keys(tombs)) if (now - tombs[k] > TOMB_TTL) delete tombs[k];

  const out = { v: 1, tombstones: tombs, updatedAt: now };
  for (const col of ['favs', 'playlists', 'sites']) {
    const merged = { ...(remote[col] || {}) };
    for (const [id, item] of Object.entries(local[col] || {})) {
      if (!merged[id] || ts(item) >= ts(merged[id])) merged[id] = item;
    }
    for (const [k, when] of Object.entries(tombs)) {
      if (!k.startsWith(col + ':')) continue;
      const id = k.slice(col.length + 1);
      if (merged[id] && ts(merged[id]) <= when) delete merged[id];
    }
    out[col] = merged;
  }
  const ls1 = local.settings || {}, rs = remote.settings || {};
  out.settings = (rs.updatedAt || 0) > (ls1.updatedAt || 0) ? rs : ls1;
  return out;
}

/* ---------- Synchronisation ---------- */
let adapter = null;     // { exportLocal(), applyLocal(data) } fourni par l'application
let syncing = null;
let timer = null;
const listeners = new Set();
function emit(type, detail) { listeners.forEach((fn) => { try { fn(type, detail); } catch (_) {} }); }
export function onCloud(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function init(a) {
  adapter = a;
  if (isLoggedIn()) setTimeout(() => syncNow().catch(() => {}), 1500);
  setInterval(() => { if (isLoggedIn()) syncNow().catch(() => {}); }, 60000);
  window.addEventListener('focus', () => { if (isLoggedIn()) syncNow().catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isLoggedIn()) syncNow().catch(() => {}); });
}

/** À appeler après chaque modification locale : synchronise quelques secondes plus tard. */
export function touch() {
  if (!isLoggedIn()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), 2500);
}

export function syncNow() {
  if (!adapter || !isLoggedIn()) return Promise.resolve(false);
  if (syncing) return syncing;
  emit('syncing');
  syncing = (async () => {
    try {
      const local = await adapter.exportLocal();
      local.tombstones = ls.get(TOMB_KEY, {}) || {};
      const remote = await readRemote();
      const merged = mergeData(local, remote);
      await adapter.applyLocal(merged);
      ls.set(TOMB_KEY, merged.tombstones);
      await writeRemote(merged);
      ls.set(LAST_SYNC_KEY, Date.now());
      emit('synced');
      return true;
    } catch (e) {
      emit('error', e);
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
