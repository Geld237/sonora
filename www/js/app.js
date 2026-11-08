import { db, uid } from './db.js';
import { iaSearch, musicQuery, filmQuery, iaAlbum, iaFilm, radioSearch, ytTrending, ytNewReleases, ytSearch, getYtApiKey, getUserYtApiKey, hasBuiltInYtKey, setYtApiKey, ytMode } from './api.js';
import { ytMedia } from './youtube-player.js';
import { getSettings, setSetting, markSettingsChanged, settingsChangedAt, SETTINGS_TS_KEY } from './settings.js';
import * as cloud from './cloud.js';
import { BUILD } from './build-info.js';
import { checkForUpdate, skipVersion, currentVersion } from './updates.js';
import { player, videoElement } from './player.js';
import { platform, isMobile, openYouTubeNative, openWebNative } from './platform.js';

/* =========================================================================
   Outils
   ========================================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => {
  if (!isFinite(s) || s <= 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' Go' : b > 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : Math.max(1, Math.round(b / 1e3)) + ' Ko');
const FALLBACK_AUDIO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="64" font-size="44" text-anchor="middle" fill="white">♪</text></svg>');
const FALLBACK_VIDEO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1f2230"/><text x="50" y="62" font-size="38" text-anchor="middle" fill="#9097ad">🎬</text></svg>');

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function modal(html) {
  $('#modal-card').innerHTML = html;
  $('#modal').classList.remove('hidden');
  return $('#modal-card');
}
let modalCancel = null;
function closeModal() {
  $('#modal').classList.add('hidden');
  const c = modalCancel; modalCancel = null;
  if (c) c();
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/** Boîte de saisie (window.prompt n'existe pas dans toutes les plateformes). */
function ask(title, placeholder = '', value = '') {
  return new Promise((resolve) => {
    const card = modal(`<h3>${esc(title)}</h3><input id="ask-in" placeholder="${esc(placeholder)}" value="${esc(value)}" />
      <div class="modal-actions"><button class="btn ghost" id="ask-no">Annuler</button><button class="btn" id="ask-ok">OK</button></div>`);
    const input = $('#ask-in', card);
    setTimeout(() => input.focus(), 50);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; modalCancel = null; closeModal(); resolve(v); };
    modalCancel = () => { if (!settled) { settled = true; resolve(null); } };
    $('#ask-ok', card).onclick = () => done(input.value.trim() || null);
    $('#ask-no', card).onclick = () => done(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); };
  });
}

function confirmBox(title, okLabel = 'Supprimer') {
  return new Promise((resolve) => {
    const card = modal(`<h3>${esc(title)}</h3><div class="modal-actions"><button class="btn ghost" id="c-no">Annuler</button><button class="btn" id="c-ok">${esc(okLabel)}</button></div>`);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; modalCancel = null; closeModal(); resolve(v); };
    modalCancel = () => { if (!settled) { settled = true; resolve(false); } };
    $('#c-ok', card).onclick = () => done(true);
    $('#c-no', card).onclick = () => done(false);
  });
}

/* =========================================================================
   État local : médias hors-ligne, favoris, playlists
   ========================================================================= */
const state = {
  media: [],          // infos des fichiers hors-ligne
  favs: new Map(),    // key -> {key, type, data}
  playlists: [],
  coverUrls: new Map(),
  downloading: new Set(),
};

async function loadState() {
  const [media, favs, playlists] = await Promise.all([db.all('media'), db.all('favs'), db.all('playlists')]);
  state.media = media.sort((a, b) => b.addedAt - a.addedAt);
  state.favs = new Map(favs.map((f) => [f.key, f]));
  state.playlists = playlists.sort((a, b) => a.createdAt - b.createdAt);
  player.offlineIndex = new Map(state.media.filter((m) => m.sourceKey).map((m) => [m.sourceKey, m.id]));
}

function coverOf(m) {
  if (m.coverBlob) {
    if (!state.coverUrls.has(m.id)) state.coverUrls.set(m.id, URL.createObjectURL(m.coverBlob));
    return state.coverUrls.get(m.id);
  }
  return m.cover || (m.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO);
}

/** Transforme un média hors-ligne en piste jouable. */
const mediaToTrack = (m) => ({
  key: m.sourceKey || `local:${m.id}`,
  mediaId: m.id,
  title: m.title,
  artist: m.artist,
  album: m.album || '',
  cover: coverOf(m),
  kind: m.kind,
  origin: m.origin,
  src: m.src || '',
});

const isOffline = (t) => !!(t.mediaId || player.offlineIndex.has(t.key));

/* ---------- Import de fichiers locaux ---------- */
const fileInput = $('#file-input');
fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length) await importFiles(files);
});

function guessKind(file) {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name) ? 'video' : /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name) ? 'audio' : null;
}

async function importFiles(files) {
  let ok = 0;
  for (const file of files) {
    const kind = guessKind(file);
    if (!kind) continue;
    const base = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    let artist = kind === 'video' ? 'Vidéo locale' : 'Artiste inconnu';
    let title = base;
    const parts = base.split(' - ');
    if (parts.length >= 2) { artist = parts.shift().trim(); title = parts.join(' - ').trim(); }
    const id = uid();
    try {
      await db.put('blobs', { id, blob: file });
      await db.put('media', { id, title, artist, kind, origin: 'local', size: file.size, addedAt: Date.now() });
      ok++;
    } catch (e) {
      console.error(e);
      toast(`Erreur d'import : ${file.name}`);
    }
  }
  await loadState();
  toast(ok ? `${ok} fichier(s) ajouté(s) à votre bibliothèque` : 'Aucun fichier audio/vidéo reconnu');
  if (current.name === 'library') render();
}

/* ---------- Téléchargement pour écoute hors-ligne ---------- */
async function downloadTrack(track) {
  if (isOffline(track)) { toast('Déjà disponible hors-ligne'); return; }
  if (state.downloading.has(track.key)) return;
  if (isMobile && (track.size || 0) > 700e6) { toast('Film trop volumineux pour être téléchargé sur le téléphone (regardez-le en streaming).', 4000); return; }
  state.downloading.add(track.key);
  toast(`Téléchargement : ${track.title}…`, 0);
  try {
    const res = await fetch(track.dlSrc || track.src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let blob;
    const total = parseInt(res.headers.get('content-length') || '0', 10) || track.size || 0;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0, lastShown = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (Date.now() - lastShown > 400) {
          lastShown = Date.now();
          toast(`Téléchargement : ${track.title} — ${total ? Math.round((got / total) * 100) + ' %' : fmtSize(got)}`, 0);
        }
      }
      blob = new Blob(chunks, { type: res.headers.get('content-type') || (track.kind === 'video' ? 'video/mp4' : 'audio/mpeg') });
    } else {
      blob = await res.blob();
    }
    let coverBlob = null;
    if (track.cover && /^https?:/.test(track.cover)) {
      try { const c = await fetch(track.cover); if (c.ok) coverBlob = await c.blob(); } catch (_) {}
    }
    const id = uid();
    await db.put('blobs', { id, blob });
    await db.put('media', {
      id, title: track.title, artist: track.artist, album: track.album || '', kind: track.kind, origin: track.origin || 'archive',
      sourceKey: track.key, src: track.src, cover: track.cover, coverBlob, size: blob.size, addedAt: Date.now(),
    });
    await loadState();
    toast(`✓ « ${track.title} » est disponible hors-ligne`);
    render(true);
  } catch (e) {
    console.error(e);
    toast(`Échec du téléchargement (${e.message})`);
  } finally {
    state.downloading.delete(track.key);
  }
}

async function deleteMedia(id) {
  const m = state.media.find((x) => x.id === id);
  if (!m || !(await confirmBox(`Supprimer « ${m.title} » de l'appareil ?`))) return;
  await db.del('blobs', id);
  await db.del('media', id);
  if (state.coverUrls.has(id)) { URL.revokeObjectURL(state.coverUrls.get(id)); state.coverUrls.delete(id); }
  await loadState();
  toast('Supprimé');
  render(true);
}

/* ---------- Favoris ---------- */
const isFav = (key) => state.favs.has(key);
async function toggleFav(type, key, data) {
  if (isFav(key)) {
    await db.del('favs', key);
    cloud.markDeleted('favs', key);
    state.favs.delete(key);
    toast('Retiré des favoris');
  } else {
    const clean = { ...data };
    if (clean.cover && clean.cover.startsWith('blob:')) delete clean.cover;
    const f = { key, type, data: clean, addedAt: Date.now(), updatedAt: Date.now() };
    await db.put('favs', f);
    cloud.touch();
    state.favs.set(key, f);
    toast('♥ Ajouté aux favoris');
  }
  updateNowPlaying();
}

/* ---------- Playlists ---------- */
async function savePlaylist(p) {
  p.updatedAt = Date.now();
  await db.put('playlists', p);
  cloud.touch();
}
const storableTrack = (t) => {
  const c = { ...t };
  if (c.cover && c.cover.startsWith('blob:')) delete c.cover;
  return c;
};

async function addToPlaylist(track) {
  const list = state.playlists.map((p) => `<button class="pl-pick" data-pl="${p.id}">🎶 ${esc(p.name)} <span class="muted small">(${p.tracks.length})</span></button>`).join('');
  const card = modal(`<h3>Ajouter à une playlist</h3>${list || '<p class="muted">Aucune playlist pour le moment.</p>'}
    <button class="pl-pick" id="pl-new">＋ Nouvelle playlist</button>
    <div class="modal-actions"><button class="btn ghost" id="pl-cancel">Fermer</button></div>`);
  $('#pl-cancel', card).onclick = closeModal;
  card.querySelectorAll('[data-pl]').forEach((b) => {
    b.onclick = async () => {
      const p = state.playlists.find((x) => x.id === b.dataset.pl);
      if (p.tracks.some((t) => t.key === track.key)) { closeModal(); toast('Déjà dans cette playlist'); return; }
      p.tracks.push(storableTrack(track));
      await savePlaylist(p);
      closeModal();
      toast(`Ajouté à « ${p.name} »`);
    };
  });
  $('#pl-new', card).onclick = async () => {
    const name = await ask('Nom de la playlist', 'Ma playlist');
    if (!name) return;
    const p = { id: uid(), name, tracks: [storableTrack(track)], createdAt: Date.now() };
    await savePlaylist(p);
    state.playlists.push(p);
    toast(`Playlist « ${name} » créée`);
  };
}

/** Restaure la pochette locale si la piste d'une playlist est hors-ligne. */
function hydrate(t) {
  const id = t.mediaId || player.offlineIndex.get(t.key);
  if (id) {
    const m = state.media.find((x) => x.id === id);
    if (m) return { ...t, mediaId: m.id, cover: coverOf(m) };
  }
  return { ...t, cover: t.cover || (t.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO) };
}

/* =========================================================================
   Rendu des listes de pistes (utilisé partout)
   ========================================================================= */
let rowTracks = [];   // pistes affichées dans la vue courante

function trackRows(tracks, { removable = false, playlistId = null, numbered = false } = {}) {
  const base = rowTracks.length;
  rowTracks.push(...tracks);
  if (!tracks.length) return '';
  return `<div class="list">${tracks.map((t, j) => {
    const i = base + j;
    const playing = player.current && player.current.key === t.key;
    const offline = isOffline(t);
    const canDl = !t.live && t.origin === 'archive' && !offline;
    const cover = t.cover || (t.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO);
    return `<div class="row ${playing ? 'playing' : ''}">
      <div class="rc${t.kind === 'youtube' ? ' wide' : ''}">${numbered ? `<span class="muted small">${j + 1}</span>` : `<img src="${esc(cover)}" loading="lazy" onerror="this.src='${t.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO}'">`}</div>
      <div class="ri" data-act="play" data-i="${i}">
        <div class="rt ellipsis">${esc(t.title)}${t.live ? '<span class="badge">EN DIRECT</span>' : ''}${t.kind === 'video' ? '<span class="badge">VIDÉO</span>' : ''}${offline ? '<span class="badge ok">HORS-LIGNE</span>' : ''}${t.quality === 'Sans perte' ? '<span class="badge">SANS PERTE</span>' : ''}</div>
        <div class="ra ellipsis">${esc(t.artist || '')}${t.duration ? ' · ' + fmtTime(t.duration) : ''}</div>
      </div>
      <div class="acts">
        <button class="icon-btn ${isFav(t.key) ? 'on' : ''}" data-act="fav" data-i="${i}" title="Favori">${isFav(t.key) ? '♥' : '♡'}</button>
        ${canDl ? `<button class="icon-btn" data-act="dl" data-i="${i}" title="Télécharger pour le hors-ligne">⬇</button>` : ''}
        <button class="icon-btn" data-act="queue" data-i="${i}" title="Lire ensuite">⤵</button>
        ${t.live ? '' : `<button class="icon-btn" data-act="addpl" data-i="${i}" title="Ajouter à une playlist">＋</button>`}
        ${removable && t.mediaId ? `<button class="icon-btn" data-act="del" data-i="${i}" title="Supprimer">🗑</button>` : ''}
        ${playlistId ? `<button class="icon-btn" data-act="plrm" data-i="${i}" data-pl="${playlistId}" title="Retirer de la playlist">✕</button>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

/** Liste lue quand on clique sur une piste : les pistes du même bloc. */
function siblingList(i) {
  const el = view.querySelector(`[data-act="play"][data-i="${i}"]`);
  const list = el?.closest('.list');
  if (!list) return { tracks: [rowTracks[i]], start: 0 };
  const idx = [...list.querySelectorAll('[data-act="play"]')].map((n) => +n.dataset.i);
  return { tracks: idx.map((k) => rowTracks[k]), start: idx.indexOf(i) };
}

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const t = rowTracks[+el.dataset.i];
  switch (act) {
    case 'play': {
      const { tracks, start } = siblingList(+el.dataset.i);
      if (ytDirect(tracks, start)) break;
      await player.playList(tracks, start);
      if (tracks[start].kind === 'video' || (tracks[start].kind === 'youtube' && !getAudioOnly())) openNowPlaying();
      break;
    }
    case 'fav': await toggleFav(t.live ? 'radio' : 'track', t.key, t); render(true); break;
    case 'dl': downloadTrack(t); break;
    case 'queue': player.addToQueue(t); toast('Sera lu ensuite'); break;
    case 'addpl': addToPlaylist(t); break;
    case 'del': deleteMedia(t.mediaId); break;
    case 'plrm': {
      const p = state.playlists.find((x) => x.id === el.dataset.pl);
      p.tracks = p.tracks.filter((x) => x.key !== t.key);
      await savePlaylist(p);
      render(true);
      break;
    }
    default: break;
  }
});

/* =========================================================================
   Navigation
   ========================================================================= */
let current = { name: 'library', params: {} };
const cache = { music: null, films: null, radio: null };

function go(name, params = {}) {
  current = { name, params };
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === (params.tab || name)));
  render();
}

document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));

let renderSeq = 0;
const stale = (seq) => seq !== renderSeq;

async function render(keepScroll = false) {
  const seq = ++renderSeq;
  const scroll = view.scrollTop;
  rowTracks = [];
  const isYt = current.name === 'youtube' && platform === 'electron';
  const isWebPanel = current.name === 'web' && platform === 'electron' && !!webOpen;
  $('#yt-container').classList.toggle('hidden', !isYt);
  $('#web-container').classList.toggle('hidden', !isWebPanel);
  view.classList.toggle('hidden', isYt || isWebPanel);
  const views = { library: viewLibrary, music: viewMusic, album: viewAlbum, films: viewFilms, film: viewFilm, radio: viewRadio, youtube: viewYouTube, playlist: viewPlaylist, web: viewWeb, settings: viewSettings };
  await views[current.name](current.params, seq);
  if (stale(seq)) return;
  if (keepScroll) view.scrollTop = scroll; else view.scrollTop = 0;
}

/* =========================================================================
   Vue : Bibliothèque (hors-ligne, favoris, playlists)
   ========================================================================= */
let libTab = 'offline';
let libFilter = 'all';

async function viewLibrary() {
  const seg = `<div class="seg">
    <button data-lib="offline" class="${libTab === 'offline' ? 'active' : ''}">Hors-ligne</button>
    <button data-lib="favs" class="${libTab === 'favs' ? 'active' : ''}">Favoris</button>
    <button data-lib="playlists" class="${libTab === 'playlists' ? 'active' : ''}">Playlists</button></div>`;
  let body = '';

  if (libTab === 'offline') {
    const items = state.media.filter((m) => libFilter === 'all' || m.kind === libFilter);
    const total = state.media.reduce((s, m) => s + (m.size || 0), 0);
    body = `
      <div class="drop" id="drop">
        <div style="font-size:30px">📥</div>
        <div style="margin:6px 0 12px">Importez votre musique et vos vidéos pour les écouter <b>sans internet</b>.</div>
        <button class="btn" id="import-btn">Importer des fichiers</button>
        <div class="small" style="margin-top:10px">${platform === 'electron' ? 'Vous pouvez aussi glisser-déposer des fichiers ici.' : 'MP3, M4A, WAV, FLAC, MP4, MOV…'}</div>
      </div>
      <div class="chips">
        ${[['all', 'Tout'], ['audio', 'Musique'], ['video', 'Vidéos']].map(([k, l]) => `<button class="chip ${libFilter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
      </div>
      ${items.length ? `<p class="muted small">${items.length} élément(s) · ${fmtSize(total)} utilisés</p>${trackRows(items.map(mediaToTrack), { removable: true })}`
        : '<div class="empty"><div class="big">🎧</div>Rien ici pour l\'instant.<br>Importez des fichiers ou téléchargez des titres depuis l\'onglet Musique ou Films (bouton ⬇).</div>'}`;
  } else if (libTab === 'favs') {
    const favs = [...state.favs.values()].sort((a, b) => b.addedAt - a.addedAt);
    const tracks = favs.filter((f) => f.type === 'track' || f.type === 'radio').map((f) => hydrate(f.data));
    const albums = favs.filter((f) => f.type === 'album');
    const films = favs.filter((f) => f.type === 'film');
    body = !favs.length ? '<div class="empty"><div class="big">♡</div>Aucun favori.<br>Touchez ♡ sur un titre, une radio, un album ou un film.</div>' : `
      ${tracks.length ? `<h2>Titres et radios</h2>${trackRows(tracks)}` : ''}
      ${albums.length ? `<h2>Albums</h2><div class="grid">${albums.map((f) => card(f.data, 'album')).join('')}</div>` : ''}
      ${films.length ? `<h2>Films</h2><div class="grid">${films.map((f) => card(f.data, 'film')).join('')}</div>` : ''}`;
  } else {
    body = `<button class="btn" id="new-pl" style="margin-bottom:16px">＋ Nouvelle playlist</button>
      ${state.playlists.length ? `<div class="list">${state.playlists.map((p) => `
        <div class="row"><div class="rc">🎶</div>
          <div class="ri" data-open-pl="${p.id}"><div class="rt">${esc(p.name)}</div><div class="ra">${p.tracks.length} titre(s)</div></div>
          <div class="acts"><button class="icon-btn" data-play-pl="${p.id}" title="Lire">▶</button><button class="icon-btn" data-del-pl="${p.id}" title="Supprimer">🗑</button></div>
        </div>`).join('')}</div>` : '<div class="empty"><div class="big">🎶</div>Créez votre première playlist.</div>'}`;
  }

  view.innerHTML = `<div class="h1row"><h1>Bibliothèque</h1><button class="icon-btn" id="open-settings" title="Réglages">⚙️</button></div><p class="sub">Votre musique, vos vidéos, vos favoris — toujours sans publicité.</p>${seg}${body}`;

  view.querySelectorAll('[data-lib]').forEach((b) => (b.onclick = () => { libTab = b.dataset.lib; render(); }));
  $('#open-settings').onclick = () => go('settings', { tab: isMobile ? 'library' : 'settings' });
  view.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { libFilter = b.dataset.filter; render(true); }));
  bindCards();
  const imp = $('#import-btn', view);
  if (imp) imp.onclick = () => fileInput.click();
  const drop = $('#drop', view);
  if (drop) {
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]); };
  }
  const np = $('#new-pl', view);
  if (np) np.onclick = async () => {
    const name = await ask('Nom de la playlist', 'Ma playlist');
    if (!name) return;
    const p = { id: uid(), name, tracks: [], createdAt: Date.now() };
    await savePlaylist(p);
    state.playlists.push(p);
    render(true);
  };
  view.querySelectorAll('[data-open-pl]').forEach((b) => (b.onclick = () => go('playlist', { id: b.dataset.openPl, tab: 'library' })));
  view.querySelectorAll('[data-play-pl]').forEach((b) => (b.onclick = () => {
    const p = state.playlists.find((x) => x.id === b.dataset.playPl);
    if (p.tracks.length) player.playList(p.tracks.map(hydrate)); else toast('Playlist vide');
  }));
  view.querySelectorAll('[data-del-pl]').forEach((b) => (b.onclick = async () => {
    const p = state.playlists.find((x) => x.id === b.dataset.delPl);
    if (!(await confirmBox(`Supprimer la playlist « ${p.name} » ?`))) return;
    await db.del('playlists', p.id);
    cloud.markDeleted('playlists', p.id);
    state.playlists = state.playlists.filter((x) => x.id !== p.id);
    render(true);
  }));
}

async function viewPlaylist({ id }) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) { libTab = 'playlists'; return go('library'); }
  const tracks = p.tracks.map(hydrate);
  view.innerHTML = `<button class="back" id="back">← Playlists</button>
    <div class="detail"><div class="dc" style="display:grid;place-items:center;font-size:70px;background:var(--grad)">🎶</div>
      <div class="di"><div class="muted small">PLAYLIST</div><h1>${esc(p.name)}</h1><div class="muted">${tracks.length} titre(s)</div>
        <div class="actions"><button class="btn" id="pl-play" ${tracks.length ? '' : 'disabled'}>▶ Tout lire</button>
        <button class="btn ghost" id="pl-shuffle" ${tracks.length ? '' : 'disabled'}>🔀 Aléatoire</button>
        <button class="btn ghost" id="pl-rename">✎ Renommer</button></div></div></div>
    ${tracks.length ? trackRows(tracks, { playlistId: p.id }) : '<div class="empty">Ajoutez des titres avec le bouton ＋.</div>'}`;
  $('#back').onclick = () => { libTab = 'playlists'; go('library'); };
  $('#pl-play').onclick = () => player.playList(tracks);
  $('#pl-shuffle').onclick = () => { player.shuffle = true; player.playList(tracks, Math.floor(Math.random() * tracks.length)); };
  $('#pl-rename').onclick = async () => {
    const name = await ask('Renommer la playlist', '', p.name);
    if (!name) return;
    p.name = name;
    await savePlaylist(p);
    render(true);
  };
}

/* =========================================================================
   Cartes (albums / films)
   ========================================================================= */
function card(item, type) {
  return `<div class="card ${type === 'film' ? 'poster' : ''}" data-open="${type}" data-id="${esc(item.id)}">
    <div class="thumb"><img src="${esc(item.cover)}" loading="lazy" alt="" onerror="this.src='${type === 'film' ? FALLBACK_VIDEO : FALLBACK_AUDIO}'"></div>
    <div class="t ellipsis">${esc(item.title)}</div>
    <div class="a ellipsis">${esc(type === 'film' ? item.year || item.creator : item.creator || 'Artiste inconnu')}</div></div>`;
}

function bindCards() {
  view.querySelectorAll('[data-open]').forEach((c) => (c.onclick = () => {
    const type = c.dataset.open;
    go(type, { id: c.dataset.id, tab: type === 'album' ? 'music' : 'films', from: current.name });
  }));
}

function loadingHtml() { return '<div class="loader"></div>'; }
function errorHtml(e) {
  return `<div class="error">Impossible de charger le contenu en ligne. Vérifiez votre connexion internet.<br><span class="small">(${esc(e.message || e)})</span></div>`;
}

/* =========================================================================
   Vue : Musique en ligne (Internet Archive)
   ========================================================================= */
const GENRES = [['', 'Populaires'], ['electronic', 'Électro'], ['hip hop', 'Hip-hop'], ['rock', 'Rock'], ['jazz', 'Jazz'], ['ambient', 'Ambient'], ['classical', 'Classique'], ['reggae', 'Reggae'], ['afro', 'Afro'], ['pop', 'Pop'], ['lofi', 'Lo-fi'], ['metal', 'Metal']];

// Styles musicaux propres à chaque pays (affichés quand on choisit le pays)
const STYLES_BY_COUNTRY = {
  FR: ['Rap français', 'Variété française', 'Pop française', 'Afro trap', 'Électro française', 'R&B français', 'Zouk', 'Drill française'],
  CI: ['Coupé-décalé', 'Zouglou', 'Rap ivoire', 'Afrobeats', 'Gospel ivoirien', 'Ambiance facile'],
  SN: ['Mbalax', 'Rap sénégalais', 'Afrobeats', 'Musique mandingue', 'Gospel'],
  CM: ['Makossa', 'Bikutsi', 'Mbolé', 'Rap camerounais', 'Afrobeats', 'Gospel camerounais'],
  CD: ['Rumba congolaise', 'Ndombolo', 'Afrobeats', 'Rap congolais', 'Gospel congolais'],
  BE: ['Rap belge', 'Pop belge', 'Électro', 'Variété'],
  CA: ['Musique québécoise', 'Rap québécois', 'Pop', 'Country', 'Folk'],
  MA: ['Raï', 'Chaabi', 'Rap marocain', 'Gnaoua', 'Pop arabe'],
  ML: ['Musique mandingue', 'Wassoulou', 'Rap malien', 'Blues touareg', 'Afrobeats'],
  NG: ['Afrobeats', 'Amapiano', 'Highlife', 'Fuji', 'Afro gospel', 'Street pop'],
  HT: ['Kompa', 'Rabòday', 'Rap kreyòl', 'Twoubadou', 'Zouk'],
  US: ['Hip-hop', 'R&B', 'Pop', 'Country', 'Rock', 'Latino', 'Gospel'],
  GB: ['UK rap', 'UK drill', 'Pop britannique', 'Grime', 'Rock britannique', 'House'],
};
const YT_MUSIC_CHIPS = STYLES_BY_COUNTRY.FR;
const stylesFor = (region) => STYLES_BY_COUNTRY[region] || STYLES_BY_COUNTRY.FR;

const YT_REGIONS = [['FR', 'France'], ['CI', "Côte d'Ivoire"], ['SN', 'Sénégal'], ['CM', 'Cameroun'], ['CD', 'RD Congo'], ['BE', 'Belgique'], ['CA', 'Canada'], ['MA', 'Maroc'], ['ML', 'Mali'], ['NG', 'Nigeria'], ['HT', 'Haïti'], ['US', 'États-Unis'], ['GB', 'Royaume-Uni']];


/** Onglet Musique : YouTube (titres récents, streaming) + Musique libre (albums téléchargeables) réunis. */
async function viewMusic(_p, seq) {
  const s = cache.music || (cache.music = {});
  const y = s.yt || (s.yt = { mode: 'trend', region: 'FR', genre: '', term: '', items: null, error: null });
  const a = getAudioOnly();
  const title = { trend: '🔥 Tendances', new: '🆕 Nouveautés', genre: y.genre, search: `Résultats pour « ${y.term} »` }[y.mode];
  view.innerHTML = `<h1>Musique</h1>
    <p class="sub">Les titres récents et populaires, par pays et par style, lus directement dans Sonora sans publicité.</p>
    <form class="searchbar" id="ysf">
      <input id="ysq" placeholder="Titre, artiste, album…" value="${esc(y.mode === 'search' ? y.term : '')}" />
      <select id="yreg" title="Pays">${YT_REGIONS.map(([c, l]) => `<option value="${c}" ${y.region === c ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn">Rechercher</button></form>
    <div class="seg"><button data-mode="video" class="${a ? '' : 'active'}">🎬 Vidéo</button><button data-mode="audio" class="${a ? 'active' : ''}">🎧 Audio seul</button></div>
    <div class="chips">
      <button class="chip ${y.mode === 'trend' ? 'active' : ''}" data-ym="trend">🔥 Tendances</button>
      <button class="chip ${y.mode === 'new' ? 'active' : ''}" data-ym="new">🆕 Nouveautés</button>
      ${stylesFor(y.region).map((c) => `<button class="chip ${y.mode === 'genre' && y.genre === c ? 'active' : ''}" data-yg="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${esc(title)}
      <button class="btn" id="yt-playall" style="font-size:14px" disabled>▶ Tout lire</button><button class="btn ghost" id="yt-shuffle" style="font-size:14px" disabled>🔀 Aléatoire</button></h2>
    <div id="res">${y.items ? '' : loadingHtml()}</div>
    <details class="yt-settings">
      <summary>⚙️ Source des titres : ${getUserYtApiKey() ? '✅ API officielle YouTube (votre clé)' : hasBuiltInYtKey() ? '✅ API officielle YouTube (clé intégrée)' : 'mode sans clé'}</summary>
      <p class="muted small">Facultatif. Avec une clé gratuite, Sonora utilise l'API officielle de YouTube (classement officiel des tendances, plus fiable). Sans clé, il utilise l'interface interne de YouTube.</p>
      <input id="yt-key" placeholder="Collez votre clé API YouTube (AIza…)" value="${esc(getUserYtApiKey())}" />
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="yt-key-save">Enregistrer</button><button class="btn ghost" id="yt-key-del">Supprimer la clé</button></div>
      <ol>
        <li>Allez sur console.cloud.google.com et connectez-vous avec un compte Google.</li>
        <li>Créez un projet (bouton « Nouveau projet »).</li>
        <li>Menu « API et services » → « Bibliothèque » → cherchez « YouTube Data API v3 » → « Activer ».</li>
        <li>« API et services » → « Identifiants » → « Créer des identifiants » → « Clé API ». Copiez la clé ici.</li>
      </ol>
    </details>`;

  const reload = () => { y.items = null; render(true); };
  view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { setAudioOnly(b.dataset.mode === 'audio'); updateNowPlaying(); render(true); }));
  view.querySelectorAll('[data-ym]').forEach((b) => (b.onclick = () => { y.mode = b.dataset.ym; reload(); }));
  view.querySelectorAll('[data-yg]').forEach((b) => (b.onclick = () => { y.mode = 'genre'; y.genre = b.dataset.yg; reload(); }));
  $('#yreg').onchange = () => {
    y.region = $('#yreg').value;
    if (y.mode === 'genre' && !stylesFor(y.region).includes(y.genre)) y.mode = 'trend';
    y.items = null;
    render(true);
  };
  $('#ysf').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#ysq').value.trim();
    y.region = $('#yreg').value;
    if (q) { y.mode = 'search'; y.term = q; } else if (y.mode === 'search') y.mode = 'trend';
    reload();
  };
  $('#yt-key-save').onclick = () => { setYtApiKey($('#yt-key').value); toast(getUserYtApiKey() ? '✅ Clé enregistrée : API officielle activée' : hasBuiltInYtKey() ? 'Clé vide : la clé intégrée de Sonora est utilisée' : 'Clé vide : mode sans clé'); y.items = null; render(true); };
  $('#yt-key-del').onclick = () => { setYtApiKey(''); toast(hasBuiltInYtKey() ? 'Clé supprimée : la clé intégrée de Sonora est utilisée' : 'Clé supprimée : mode sans clé'); y.items = null; render(true); };

  // Les deux sources sont chargées en parallèle ; chacune s'affiche dès qu'elle est prête.
  const loadYt = y.items ? Promise.resolve(y.items) : (
    y.mode === 'trend' ? ytTrending(y.region)
      : y.mode === 'new' ? ytNewReleases(y.region)
      : y.mode === 'genre' ? ytSearch(`${y.genre} ${YT_REGIONS.find((r) => r[0] === y.region)?.[1] || ''} ${new Date().getFullYear()}`, y.region)
      : ytSearch(y.term, y.region));

  const showYt = (items) => {
    const res = $('#res');
    if (!res) return;
    res.innerHTML = items.length ? trackRows(items) : '<div class="empty">Aucun titre YouTube trouvé.</div>';
    if (!items.length) return;
    $('#yt-playall').disabled = false;
    $('#yt-shuffle').disabled = false;
    $('#yt-playall').onclick = () => { player.shuffle = false; if (ytDirect(items, 0)) return; player.playList(items, 0); if (!getAudioOnly()) openNowPlaying(); };
    $('#yt-shuffle').onclick = () => { player.shuffle = true; const r = Math.floor(Math.random() * items.length); if (ytDirect(items, r)) return; player.playList(items, r); if (!getAudioOnly()) openNowPlaying(); };
  };

  await Promise.all([
    loadYt.then((items) => { if (stale(seq)) return; y.items = items; showYt(items); })
      .catch((e) => { if (stale(seq)) return; y.items = null; const r = $('#res'); if (r) r.innerHTML = errorHtml(e); }),
  ]);
}

async function viewAlbum({ id, from }, seq) {
  view.innerHTML = `<button class="back" id="back">← Retour</button>${loadingHtml()}`;
  $('#back').onclick = () => go(from === 'library' ? 'library' : 'music');
  try {
    const a = await iaAlbum(id);
    if (stale(seq)) return;
    const favData = { id: a.id, title: a.title, creator: a.artist, cover: a.cover };
    view.innerHTML = `<button class="back" id="back">← Retour</button>
      <div class="detail"><div class="dc" style="background-image:url('${esc(a.cover)}')"></div>
        <div class="di"><div class="muted small">ALBUM</div><h1>${esc(a.title)}</h1><div class="muted">${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''} · ${a.tracks.length} titre(s)</div>
          <div class="actions">
            <button class="btn" id="a-play" ${a.tracks.length ? '' : 'disabled'}>▶ Lire</button>
            <button class="btn ghost" id="a-dl" ${a.tracks.length ? '' : 'disabled'}>⬇ Tout télécharger</button>
            <button class="btn ghost" id="a-fav">${isFav('album:' + a.id) ? '♥ Favori' : '♡ Favori'}</button>
          </div>
          ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}</div></div>
      ${a.tracks.length ? trackRows(a.tracks, { numbered: true }) : '<div class="empty">Aucune piste MP3 dans cet album.</div>'}`;
    $('#back').onclick = () => go(from === 'library' ? 'library' : 'music');
    $('#a-play').onclick = () => player.playList(a.tracks);
    $('#a-dl').onclick = async () => { for (const t of a.tracks) await downloadTrack(t); };
    $('#a-fav').onclick = async () => { await toggleFav('album', 'album:' + a.id, favData); render(true); };
  } catch (e) {
    if (stale(seq)) return;
    view.innerHTML = `<button class="back" id="back">← Retour</button>${errorHtml(e)}`;
    $('#back').onclick = () => go('music');
  }
}

/* =========================================================================
   Vue : Films (domaine public, Internet Archive)
   ========================================================================= */
const FILM_CATS = [
  ['collection:feature_films', 'Longs-métrages'],
  ['collection:classic_cartoons', 'Dessins animés'],
  ['collection:short_films', 'Courts-métrages'],
  ['collection:feature_films AND subject:(horror)', 'Horreur'],
  ['collection:feature_films AND subject:(comedy)', 'Comédie'],
  ['collection:feature_films AND subject:(science fiction)', 'Science-fiction'],
  ['collection:feature_films AND subject:(western)', 'Western'],
  ['collection:film_noir', 'Film noir'],
];

async function viewFilms(_p, seq) {
  const s = cache.films || (cache.films = { term: '', cat: FILM_CATS[0][0], items: null });
  view.innerHTML = `<h1>Films et séries</h1>
    <p class="sub">Vos sites de streaming, ouverts dans Sonora avec le bloqueur de publicités et de pop-ups, et des films classiques gratuits.</p>
    <h2>🌐 Mes sites de streaming</h2>
    ${sitesSectionHtml()}
    <h2>🎬 Films classiques <span class="badge ok">GRATUITS · TÉLÉCHARGEABLES</span></h2>
    <form class="searchbar" id="sf"><input id="sq" placeholder="Titre, réalisateur, acteur…" value="${esc(s.term)}" /><button class="btn">Rechercher</button></form>
    <div class="chips">${FILM_CATS.map(([q, l]) => `<button class="chip ${s.cat === q && !s.term ? 'active' : ''}" data-c="${esc(q)}">${l}</button>`).join('')}</div>
    <div id="res">${s.items ? '' : loadingHtml()}</div>`;
  bindSites();
  $('#sf').onsubmit = (e) => { e.preventDefault(); s.term = $('#sq').value.trim(); s.items = null; render(true); };
  view.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { s.cat = b.dataset.c; s.term = ''; s.items = null; render(true); }));
  const res = $('#res');
  try {
    if (!s.items) {
      const items = await iaSearch(filmQuery(s.term, s.term ? 'collection:(feature_films OR short_films OR classic_cartoons OR film_noir)' : s.cat));
      if (stale(seq)) return;
      s.items = items;
    }
    res.innerHTML = s.items.length ? `<div class="grid">${s.items.map((it) => card(it, 'film')).join('')}</div>` : '<div class="empty">Aucun résultat.</div>';
    bindCards();
  } catch (e) {
    if (stale(seq)) return;
    s.items = null;
    res.innerHTML = errorHtml(e);
  }
}

async function viewFilm({ id, from }, seq) {
  view.innerHTML = `<button class="back" id="back">← Retour</button>${loadingHtml()}`;
  $('#back').onclick = () => go(from === 'library' ? 'library' : 'films');
  try {
    const f = await iaFilm(id);
    if (stale(seq)) return;
    const t = f.track;
    const offline = t && isOffline(t);
    view.innerHTML = `<button class="back" id="back">← Retour</button>
      <div class="detail film"><div class="dc" style="background-image:url('${esc(f.cover)}')"></div>
        <div class="di"><div class="muted small">FILM</div><h1>${esc(f.title)}</h1>
          <div class="muted">${[f.year, f.creator, f.runtime].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="actions">
            <button class="btn" id="f-play" ${t ? '' : 'disabled'}>▶ Regarder</button>
            ${t ? `<button class="btn ghost" id="f-dl" ${offline ? 'disabled' : ''}>${offline ? '✓ Hors-ligne' : '⬇ Télécharger' + (t.size ? ' (' + fmtSize(t.size) + ')' : '')}</button>` : ''}
            <button class="btn ghost" id="f-fav">${isFav('film:' + f.id) ? '♥ Favori' : '♡ Favori'}</button>
          </div>
          ${t ? '' : '<p class="error" style="margin-top:12px">Ce film n\'a pas de version MP4 compatible.</p>'}
          ${f.description ? `<div class="desc">${esc(f.description)}</div>` : ''}</div></div>`;
    $('#back').onclick = () => go(from === 'library' ? 'library' : 'films');
    if (t) {
      $('#f-play').onclick = async () => { await player.playTrack(t); openNowPlaying(); };
      const dl = $('#f-dl');
      if (dl && !offline) dl.onclick = () => downloadTrack(t);
    }
    $('#f-fav').onclick = async () => { await toggleFav('film', 'film:' + f.id, { id: f.id, title: f.title, year: f.year, creator: f.creator, cover: f.cover }); render(true); };
  } catch (e) {
    if (stale(seq)) return;
    view.innerHTML = `<button class="back" id="back">← Retour</button>${errorHtml(e)}`;
    $('#back').onclick = () => go('films');
  }
}

/* =========================================================================
   Vue : Radio
   ========================================================================= */
const COUNTRIES = [['', 'Monde'], ['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['CA', 'Canada'], ['CI', "Côte d'Ivoire"], ['SN', 'Sénégal'], ['CM', 'Cameroun'],
  ['CD', 'RD Congo'], ['ML', 'Mali'], ['BF', 'Burkina Faso'], ['MA', 'Maroc'], ['DZ', 'Algérie'], ['TN', 'Tunisie'], ['HT', 'Haïti'], ['US', 'États-Unis'], ['GB', 'Royaume-Uni'], ['NG', 'Nigeria'], ['JM', 'Jamaïque']];
const RADIO_TAGS = [['', 'Tout'], ['pop', 'Pop'], ['hip hop', 'Hip-hop'], ['afrobeats', 'Afrobeats'], ['jazz', 'Jazz'], ['classical', 'Classique'], ['rock', 'Rock'], ['electronic', 'Électro'], ['news', 'Info'], ['zouk', 'Zouk'], ['reggae', 'Reggae']];

async function viewRadio(_p, seq) {
  const s = cache.radio || (cache.radio = { name: '', country: 'FR', tag: '', items: null });
  view.innerHTML = `<h1>Radio</h1><p class="sub">Plus de 40 000 radios du monde entier, en direct.</p>
    <form class="searchbar" id="sf">
      <input id="sq" placeholder="Nom de la radio…" value="${esc(s.name)}" />
      <select id="sc">${COUNTRIES.map(([c, l]) => `<option value="${c}" ${s.country === c ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn">Rechercher</button></form>
    <div class="chips">${RADIO_TAGS.map(([t, l]) => `<button class="chip ${s.tag === t ? 'active' : ''}" data-t="${t}">${l}</button>`).join('')}</div>
    <div id="res">${s.items ? '' : loadingHtml()}</div>`;
  $('#sf').onsubmit = (e) => { e.preventDefault(); s.name = $('#sq').value.trim(); s.country = $('#sc').value; s.items = null; render(); };
  $('#sc').onchange = () => { s.country = $('#sc').value; s.items = null; render(); };
  view.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { s.tag = b.dataset.t; s.items = null; render(); }));
  const res = $('#res');
  try {
    if (!s.items) {
      const items = await radioSearch({ name: s.name, country: s.country, tag: s.tag });
      if (stale(seq)) return;
      s.items = items;
    }
    res.innerHTML = s.items.length ? trackRows(s.items) : '<div class="empty">Aucune radio trouvée.</div>';
  } catch (e) {
    if (stale(seq)) return;
    s.items = null;
    res.innerHTML = errorHtml(e);
  }
}

/* =========================================================================
   Vue : YouTube avec bloqueur de publicités
   ========================================================================= */
let ytBuilt = false;
let ytPending = null;   // adresse à ouvrir quand le panneau est créé
const YT_AUDIO_KEY = 'sonora.ytAudioOnly';
const getAudioOnly = () => { try { return localStorage.getItem(YT_AUDIO_KEY) === '1'; } catch (_) { return false; } };
const setAudioOnly = (v) => { try { localStorage.setItem(YT_AUDIO_KEY, v ? '1' : '0'); } catch (_) {} markSettingsChanged(); cloud.touch(); };

// « Audio seul » : la vidéo est masquée (le son continue), via le lecteur officiel de YouTube.
const AUDIO_ONLY_CSS = 'video { opacity: 0 !important; } .html5-video-player, #movie_player, #player-container-inner, #song-video, ytm-player, .player-container { background: linear-gradient(135deg, #8b5cf6, #ec4899) !important; }';
const audioOnlyScript = (on) => `(function(){var id='sonora-audio-only';var s=document.getElementById(id);
  if(${on ? 'true' : 'false'}){ if(!s){ s=document.createElement('style'); s.id=id; s.textContent=${JSON.stringify(AUDIO_ONLY_CSS)}; (document.head||document.documentElement).appendChild(s);} }
  else if(s){ s.remove(); } })(); 1`;

const YT_HOME = 'https://www.youtube.com/';
const YTM_HOME = 'https://music.youtube.com/';
const ytSearchUrl = (q, music) => (music ? `${YTM_HOME}search?q=${encodeURIComponent(q)}` : `${YT_HOME}results?search_query=${encodeURIComponent(q)}`);

/** Ouvre une adresse dans le panneau YouTube (Windows). */
function ytOpen(url) {
  if (ytBuilt) {
    const wv = $('#yt-container webview');
    wv.loadURL(url).catch(() => {});
  } else {
    ytPending = url;
  }
}

function buildElectronYouTube() {
  if (ytBuilt) return;
  ytBuilt = true;
  const c = $('#yt-container');
  c.innerHTML = `<div class="yt-bar">
      <button class="icon-btn" id="yt-back" title="Retour">←</button>
      <button class="icon-btn" id="yt-fwd" title="Suivant">→</button>
      <button class="icon-btn" id="yt-reload" title="Recharger">⟳</button>
      <div class="seg" style="margin:0"><button id="yt-site-yt">YouTube</button><button id="yt-site-ytm">YT Music</button></div>
      <form id="yt-form" style="flex:1;display:flex"><input id="yt-q" placeholder="Rechercher…" /></form>
      <button class="pill" id="yt-audio" title="Masquer la vidéo et garder le son">🎧 Audio seul</button>
      <span class="yt-shield">🛡 Sans pub</span>
    </div>`;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:youtube');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', ytPending || YT_HOME);
  ytPending = null;
  c.appendChild(wv);

  const isMusic = () => { try { return wv.getURL().startsWith(YTM_HOME); } catch (_) { return false; } };
  const syncUi = () => {
    const m = isMusic();
    $('#yt-site-yt').classList.toggle('active', !m);
    $('#yt-site-ytm').classList.toggle('active', m);
    $('#yt-q').placeholder = m ? 'Rechercher un titre, un artiste…' : 'Rechercher sur YouTube…';
    const a = getAudioOnly();
    $('#yt-audio').textContent = a ? '🎧 Audio seul' : '🎬 Vidéo';
    $('#yt-audio').classList.toggle('on', a);
  };
  const applyAudio = () => { try { wv.executeJavaScript(audioOnlyScript(getAudioOnly())).catch(() => {}); } catch (_) {} };

  $('#yt-back').onclick = () => { try { if (wv.canGoBack()) wv.goBack(); } catch (_) {} };
  $('#yt-fwd').onclick = () => { try { if (wv.canGoForward()) wv.goForward(); } catch (_) {} };
  $('#yt-reload').onclick = () => { try { wv.reload(); } catch (_) {} };
  $('#yt-site-yt').onclick = () => wv.loadURL(YT_HOME).catch(() => {});
  $('#yt-site-ytm').onclick = () => wv.loadURL(YTM_HOME).catch(() => {});
  $('#yt-audio').onclick = () => { setAudioOnly(!getAudioOnly()); applyAudio(); syncUi(); toast(getAudioOnly() ? '🎧 Audio seul : la vidéo est masquée' : '🎬 Vidéo affichée'); };
  $('#yt-form').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#yt-q').value.trim();
    if (q) wv.loadURL(ytSearchUrl(q, isMusic())).catch(() => {});
  };
  wv.addEventListener('dom-ready', () => { applyAudio(); syncUi(); });
  wv.addEventListener('did-navigate', syncUi);
  wv.addEventListener('did-navigate-in-page', () => { applyAudio(); syncUi(); });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) toast('YouTube ne répond pas. Vérifiez votre connexion internet puis touchez ⟳.', 5000);
  });
  // Quand une vidéo YouTube démarre, on met en pause la musique de l'appli.
  wv.addEventListener('media-started-playing', () => { if (player.playing) player.toggle(); });
  syncUi();
}

/** Ouvre YouTube / YouTube Music, sur Windows (panneau intégré) ou iPhone (navigateur natif). */
async function openYouTubeAt({ query = '', music = false } = {}) {
  if (platform === 'electron') {
    ytOpen(query ? ytSearchUrl(query, music) : music ? YTM_HOME : YT_HOME);
    go('youtube', { tab: music ? 'music' : 'youtube' });
    return;
  }
  // iPhone : version mobile de YouTube (YouTube Music web n'est pas fiable dans Safari mobile)
  const url = query ? `https://m.youtube.com/results?search_query=${encodeURIComponent(query)}` : 'https://m.youtube.com/';
  if (isMobile) {
    if (player.playing) player.toggle();
    try { await openYouTubeNative(url, { audioOnly: getAudioOnly(), adblock: !isStoreBuild }); } catch (e) { toast('Erreur : ' + e.message); }
  } else {
    window.open(url, '_blank');
  }
}

async function viewYouTube() {
  if (platform === 'electron') { buildElectronYouTube(); return; }
  const a = getAudioOnly();
  view.innerHTML = `<div class="yt-card">
      <div class="big">▶️</div><h1>YouTube sans pub</h1>
      <p class="sub">Regardez YouTube avec le bloqueur de publicités intégré à Sonora.</p>
      <form class="searchbar" id="yt-form"><input id="yt-q" placeholder="Rechercher une vidéo, un clip…" /><button class="btn">Rechercher</button></form>
      <div class="seg"><button data-mode="video" class="${a ? '' : 'active'}">🎬 Vidéo</button><button data-mode="audio" class="${a ? 'active' : ''}">🎧 Audio seul</button></div>
      <button class="btn ghost" id="yt-open" style="width:100%">🛡 Ouvrir YouTube</button>
      ${platform === 'web' ? '<p class="muted" style="margin-top:16px">Version web : YouTube s\'ouvre dans un nouvel onglet. Le bloqueur de publicités est disponible dans les applications Windows, Android et iPhone.</p>' : ''}
    </div>`;
  view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { setAudioOnly(b.dataset.mode === 'audio'); render(true); }));
  $('#yt-open').onclick = () => openYouTubeAt();
  $('#yt-form').onsubmit = (e) => { e.preventDefault(); openYouTubeAt({ query: $('#yt-q').value.trim() }); };
}

/* =========================================================================
   Vue : Sites de streaming (liens ajoutés par l'utilisateur)
   ========================================================================= */
const SITES_KEY = 'sonora.sites';
const DEFAULT_SITES = [
  { id: 'arte', name: 'Arte.tv — films, séries, documentaires', url: 'https://www.arte.tv/fr/' },
  { id: 'archive', name: 'Internet Archive — films classiques', url: 'https://archive.org/details/feature_films' },
];
let webOpen = null;     // adresse du site ouvert (Windows)
let webBuilt = false;
let webLoaded = null;

function loadSites() {
  try {
    const s = JSON.parse(localStorage.getItem(SITES_KEY));
    if (Array.isArray(s)) return s;
  } catch (_) {}
  return DEFAULT_SITES.map((x) => ({ ...x }));
}
function saveSites(list, { fromCloud = false } = {}) {
  if (!fromCloud) {
    const before = new Map(loadSites().map((x) => [x.id, x]));
    const now = Date.now();
    list = list.map((x) => {
      const old = before.get(x.id);
      const changed = !old || old.url !== x.url || old.name !== x.name;
      return changed ? { ...x, createdAt: x.createdAt || old?.createdAt || now, updatedAt: now } : { ...x, createdAt: x.createdAt || old?.createdAt || 0, updatedAt: x.updatedAt || old?.updatedAt || 0 };
    });
    const ids = new Set(list.map((x) => x.id));
    for (const id of before.keys()) if (!ids.has(id)) cloud.markDeleted('sites', id);
    cloud.touch();
  }
  try { localStorage.setItem(SITES_KEY, JSON.stringify(list)); } catch (_) {}
}
function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const url = new URL(u); return url.hostname.includes('.') ? url.href : null; } catch (_) { return null; }
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };

function siteForm(site = null) {
  return new Promise((resolve) => {
    const card = modal(`<h3>${site ? 'Modifier le site' : 'Ajouter un site'}</h3>
      <div class="site-form">
        <label>Lien du site</label><input id="s-url" placeholder="https://…" value="${esc(site?.url || '')}" />
        <label>Nom (facultatif)</label><input id="s-name" placeholder="Mon site de films" value="${esc(site?.name || '')}" />
      </div>
      <div class="modal-actions"><button class="btn ghost" id="s-no">Annuler</button><button class="btn" id="s-ok">Enregistrer</button></div>`);
    setTimeout(() => $('#s-url', card).focus(), 50);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; modalCancel = null; closeModal(); resolve(v); };
    modalCancel = () => { if (!settled) { settled = true; resolve(null); } };
    $('#s-no', card).onclick = () => done(null);
    $('#s-ok', card).onclick = () => {
      const url = normalizeUrl($('#s-url', card).value);
      if (!url) { toast('Lien invalide'); return; }
      done({ id: site?.id || uid(), url, name: $('#s-name', card).value.trim() || hostOf(url) });
    };
  });
}

async function openSite(url) {
  if (player.playing && player.current?.kind !== 'audio') player.toggle();
  if (platform === 'electron') { webOpen = url; go('web', { tab: 'films' }); return; }
  if (isMobile) {
    try { await openWebNative(url); } catch (e) { toast('Erreur : ' + e.message); }
    return;
  }
  window.open(url, '_blank');
}

function showWebPanel(url) {
  const c = $('#web-container');
  if (!webBuilt) {
    webLoaded = url;
    webBuilt = true;
    c.innerHTML = `<div class="yt-bar">
        <button class="icon-btn" id="w-sites" title="Mes sites">☰</button>
        <button class="icon-btn" id="w-back" title="Retour">←</button>
        <button class="icon-btn" id="w-fwd" title="Suivant">→</button>
        <button class="icon-btn" id="w-reload" title="Recharger">⟳</button>
        <form id="w-form" style="flex:1;display:flex"><input id="w-addr" placeholder="Adresse du site" /></form>
        <button class="icon-btn" id="w-save" title="Ajouter à mes sites">☆</button>
        <span class="yt-shield">🛡 Pubs et pop-ups bloquées</span>
      </div>`;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:web');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', url);
    c.appendChild(wv);
    $('#w-sites').onclick = () => { webOpen = null; go('films'); };
    $('#w-back').onclick = () => { try { if (wv.canGoBack()) wv.goBack(); } catch (_) {} };
    $('#w-fwd').onclick = () => { try { if (wv.canGoForward()) wv.goForward(); } catch (_) {} };
    $('#w-reload').onclick = () => wv.reload();
    $('#w-form').onsubmit = (e) => {
      e.preventDefault();
      const u = normalizeUrl($('#w-addr').value);
      if (u) { webLoaded = u; wv.loadURL(u).catch(() => {}); } else toast('Adresse invalide');
    };
    $('#w-save').onclick = () => {
      let u = '', title = '';
      try { u = wv.getURL(); title = wv.getTitle(); } catch (_) { return; }
      if (!/^https?:/.test(u)) return;
      const list = loadSites();
      if (list.some((x) => hostOf(x.url) === hostOf(u))) { toast('Déjà dans vos sites'); return; }
      list.push({ id: uid(), url: u, name: title || hostOf(u) });
      saveSites(list);
      toast('☆ Ajouté à vos sites');
    };
    $('#w-addr').value = url;
    const syncAddr = () => { try { if (document.activeElement !== $('#w-addr')) $('#w-addr').value = wv.getURL(); } catch (_) {} };
    wv.addEventListener('did-navigate', syncAddr);
    wv.addEventListener('did-navigate-in-page', syncAddr);
    wv.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame && e.errorCode !== -3) toast('Le site ne répond pas. Vérifiez le lien ou votre connexion.', 5000);
    });
    wv.addEventListener('media-started-playing', () => { if (player.playing) player.toggle(); });
  }
  if (webLoaded !== url) {
    webLoaded = url;
    $('#w-addr').value = url;
    c.querySelector('webview').loadURL(url).catch(() => {});
  }
}

/** Section « Mes sites de streaming » (affichée dans l'onglet Films). */
function sitesSectionHtml() {
  const sites = loadSites();
  return `
    <form class="searchbar" id="web-go"><input id="web-url" placeholder="Coller un lien : https://…" /><button class="btn">Ouvrir</button></form>
    <button class="btn ghost" id="web-add" style="margin-bottom:16px">＋ Ajouter un site</button>
    ${sites.length ? `<div class="list">${sites.map((st) => `
      <div class="row">
        <div class="rc"><img src="https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostOf(st.url))}" alt="" onerror="this.parentNode.textContent='🌐'"></div>
        <div class="ri" data-site="${esc(st.id)}"><div class="rt ellipsis">${esc(st.name)}</div><div class="ra ellipsis">${esc(st.url)}</div></div>
        <div class="acts">
          <button class="icon-btn" data-site-open="${esc(st.id)}" title="Ouvrir">▶</button>
          <button class="icon-btn" data-site-edit="${esc(st.id)}" title="Modifier">✎</button>
          <button class="icon-btn" data-site-del="${esc(st.id)}" title="Supprimer">🗑</button>
        </div>
      </div>`).join('')}</div>` : '<div class="empty"><div class="big">🌐</div>Aucun site. Ajoutez un lien avec le bouton ＋.</div>'}
`;
}

function bindSites() {
  const byId = (id) => loadSites().find((x) => x.id === id);
  $('#web-go').onsubmit = (e) => {
    e.preventDefault();
    const u = normalizeUrl($('#web-url').value);
    if (u) openSite(u); else toast('Lien invalide');
  };
  $('#web-add').onclick = async () => {
    const site = await siteForm();
    if (!site) return;
    saveSites([...loadSites(), site]);
    render(true);
  };
  view.querySelectorAll('[data-site], [data-site-open]').forEach((b) => (b.onclick = () => {
    const st = byId(b.dataset.site || b.dataset.siteOpen);
    if (st) openSite(st.url);
  }));
  view.querySelectorAll('[data-site-edit]').forEach((b) => (b.onclick = async () => {
    const st = byId(b.dataset.siteEdit);
    const upd = await siteForm(st);
    if (!upd) return;
    saveSites(loadSites().map((x) => (x.id === upd.id ? upd : x)));
    render(true);
  }));
  view.querySelectorAll('[data-site-del]').forEach((b) => (b.onclick = async () => {
    const st = byId(b.dataset.siteDel);
    if (!(await confirmBox(`Retirer « ${st.name} » de vos sites ?`, 'Retirer'))) return;
    saveSites(loadSites().filter((x) => x.id !== st.id));
    render(true);
  }));
}

/** Panneau du site ouvert (Windows) ; sinon retour à l'onglet Films. */
async function viewWeb() {
  if (platform === 'electron' && webOpen) { showWebPanel(webOpen); return; }
  go('films');
}

/* =========================================================================
   Synchronisation du compte (voir cloud.js)
   ========================================================================= */
function localSettingsSnapshot() {
  // updatedAt = 0 sur un appareil où l'on n'a jamais touché aux réglages : ceux du compte s'appliquent alors.
  return { updatedAt: settingsChangedAt(), values: { settings: getSettings(), audioOnly: getAudioOnly(), ytKey: getUserYtApiKey() } };
}

cloud.init({
  async exportLocal() {
    const [favs, pls] = await Promise.all([db.all('favs'), db.all('playlists')]);
    return {
      favs: Object.fromEntries(favs.map((f) => [f.key, { ...f, updatedAt: f.updatedAt || f.addedAt || 0 }])),
      playlists: Object.fromEntries(pls.map((p) => [p.id, { ...p, updatedAt: p.updatedAt || p.createdAt || 0 }])),
      sites: Object.fromEntries(loadSites().map((x) => [x.id, { ...x, updatedAt: x.updatedAt || 0 }])),
      settings: localSettingsSnapshot(),
    };
  },
  async applyLocal(data) {
    const [favs, pls] = await Promise.all([db.all('favs'), db.all('playlists')]);
    for (const f of favs) if (!data.favs[f.key]) await db.del('favs', f.key);
    for (const f of Object.values(data.favs)) await db.put('favs', f);
    for (const p of pls) if (!data.playlists[p.id]) await db.del('playlists', p.id);
    for (const p of Object.values(data.playlists)) await db.put('playlists', p);
    saveSites(Object.values(data.sites).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), { fromCloud: true });
    const local = localSettingsSnapshot();
    if (data.settings && (data.settings.updatedAt || 0) > (local.updatedAt || 0) && data.settings.values) {
      const v = data.settings.values;
      try {
        localStorage.setItem('sonora.settings', JSON.stringify(v.settings || {}));
        localStorage.setItem(YT_AUDIO_KEY, v.audioOnly ? '1' : '0');
        if (typeof v.ytKey === 'string') setYtApiKey(v.ytKey, { silent: true });
        localStorage.setItem(SETTINGS_TS_KEY, String(data.settings.updatedAt));
      } catch (_) {}
    }
    await loadState();
    if (!['youtube', 'web'].includes(current.name) && !document.querySelector('#modal:not(.hidden)')) render(true);
  },
});

cloud.onCloud((type, detail) => {
  if (type === 'error' && current.name === 'settings') toast('Synchronisation : ' + (detail?.message || 'erreur'), 4000);
  if (current.name === 'settings' && (type === 'synced' || type === 'status')) render(true);
});

function accountBlockHtml() {
  const fmtDate = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');
  if (!cloud.isConfigured()) {
    return `<div class="set-block"><h3>👤 Compte et synchronisation</h3>
      <p class="muted">Bientôt : un compte Sonora pour retrouver vos favoris, playlists, sites et réglages sur l'ordinateur, Android et l'iPhone.</p>
      <p class="muted small">Le compte n'est pas encore activé dans cette version.</p></div>`;
  }
  const sess = cloud.getSession();
  if (!sess) {
    return `<div class="set-block"><h3>👤 Compte et synchronisation</h3>
      <p class="muted">Connectez-vous avec le même compte sur l'ordinateur, Android et l'iPhone pour retrouver partout vos favoris, playlists, sites et réglages.</p>
      <input class="set-input" id="ac-email" type="email" placeholder="Adresse e-mail" autocomplete="email" />
      <input class="set-input" id="ac-pass" type="password" placeholder="Mot de passe (6 caractères minimum)" autocomplete="current-password" />
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="ac-login">Se connecter</button>
        <button class="btn ghost" id="ac-signup">Créer un compte</button>
        <button class="btn ghost" id="ac-reset">Mot de passe oublié</button>
      </div>
      </div>`;
  }
  return `<div class="set-block"><h3>👤 Compte et synchronisation</h3>
    <p class="muted">Connecté : <b style="color:var(--text)">${esc(sess.email)}</b><br>Dernière synchronisation : ${fmtDate(cloud.lastSync())}</p>
    <p class="muted small">Synchronisés : favoris, playlists, sites de streaming et réglages. Les fichiers hors-ligne restent sur chaque appareil.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="ac-sync">🔄 Synchroniser maintenant</button>
      <button class="btn ghost" id="ac-logout">Se déconnecter</button>
    </div></div>`;
}

function bindAccountBlock() {
  const val = (id) => ($('#' + id)?.value || '').trim();
  const busy = (btn, on) => { if (btn) { btn.disabled = on; } };
  const fbSave = $('#fb-save');
  if (fbSave) fbSave.onclick = () => {
    if (!val('fb-key') || !val('fb-pid')) { toast('Renseignez les deux champs'); return; }
    cloud.setConfig(val('fb-key'), val('fb-pid'));
    toast('Configuration enregistrée');
    render(true);
  };
  const fbReset = $('#fb-reset');
  if (fbReset) fbReset.onclick = (e) => { e.preventDefault(); cloud.setConfig('', ''); render(true); };
  const run = async (btn, fn, okMsg) => {
    busy(btn, true);
    try {
      await fn();
      if (okMsg) toast(okMsg);
      render(true);
    } catch (e) {
      toast(e.message || 'Erreur', 4500);   // on garde le formulaire tel quel pour corriger
      busy(btn, false);
    }
  };
  const login = $('#ac-login');
  if (login) login.onclick = () => run(login, () => cloud.signIn(val('ac-email'), $('#ac-pass').value), '✅ Connecté : vos données sont synchronisées');
  const signup = $('#ac-signup');
  if (signup) signup.onclick = () => run(signup, () => cloud.signUp(val('ac-email'), $('#ac-pass').value), '✅ Compte créé et synchronisé');
  const reset = $('#ac-reset');
  if (reset) reset.onclick = () => {
    if (!val('ac-email')) { toast('Entrez votre adresse e-mail'); return; }
    run(reset, () => cloud.resetPassword(val('ac-email')), 'E-mail de réinitialisation envoyé');
  };
  const sync = $('#ac-sync');
  if (sync) sync.onclick = () => run(sync, () => cloud.syncNow(), '✅ Synchronisé');
  const logout = $('#ac-logout');
  if (logout) logout.onclick = async () => {
    if (!(await confirmBox('Se déconnecter ? Vos données restent sur cet appareil.', 'Se déconnecter'))) return;
    cloud.signOut();
    render(true);
  };
}

/* =========================================================================
   Mises à jour
   ========================================================================= */
const isStoreBuild = BUILD.channel === 'play';
let pendingUpdate = null;   // { version, url } ou { version, ready: true } (Windows automatique)

function updateBanner() {
  let bar = $('#update-bar');
  if (!pendingUpdate) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar';
    document.body.appendChild(bar);
  }
  const u = pendingUpdate;
  bar.innerHTML = u.web
    ? `<span>✨ Nouvelle version de Sonora disponible.</span><button class="btn" id="up-go">Recharger</button><button class="icon-btn" id="up-x" title="Plus tard">✕</button>`
    : u.ready
    ? `<span>✨ Sonora ${esc(u.version)} est prête.</span><button class="btn" id="up-go">Redémarrer et installer</button><button class="icon-btn" id="up-x" title="Plus tard">✕</button>`
    : u.downloading
      ? `<span>⬇ Téléchargement de Sonora ${esc(u.version)}…</span><button class="icon-btn" id="up-x" title="Masquer">✕</button>`
      : `<span>✨ Nouvelle version : Sonora ${esc(u.version)}</span><button class="btn" id="up-go">Mettre à jour</button><button class="icon-btn" id="up-x" title="Plus tard">✕</button>`;
  const go = $('#up-go', bar);
  if (go) go.onclick = () => {
    if (u.ready) { window.sonora.installUpdate(); return; }
    if (u.web) { u.worker?.postMessage('skipWaiting'); return; }
    window.open(u.url, '_blank');
    toast(platform === 'android' ? 'Ouvrez le fichier téléchargé pour installer la mise à jour.' : platform === 'ios' ? 'Téléchargez Sonora.ipa puis réinstallez-le avec Sideloadly.' : 'Téléchargement de la nouvelle version…', 6000);
  };
  $('#up-x', bar).onclick = () => { if (!u.ready && !u.downloading) skipVersion(u.version); pendingUpdate = null; updateBanner(); };
}

/** Version web (PWA) : service worker pour l'installation et les mises à jour. */
function registerServiceWorker() {
  if (platform !== 'web' || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => { pendingUpdate = { web: true, worker }; updateBanner(); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
  }).catch(() => {});
}

async function startUpdateChecks() {
  registerServiceWorker();
  if (platform === 'electron' && window.sonora?.onUpdate) {
    window.sonora.onUpdate((info) => {
      pendingUpdate = { version: info.version, ready: info.state === 'ready', downloading: info.state === 'downloading' };
      updateBanner();
    });
    const infoApp = await window.sonora.appInfo().catch(() => ({}));
    if (infoApp.autoUpdate) return; // l'installateur se met à jour tout seul
  }
  const run = async () => {
    try { const u = await checkForUpdate(); if (u) { pendingUpdate = u; updateBanner(); } } catch (_) {}
  };
  setTimeout(run, 6000);
  setInterval(run, 6 * 3600 * 1000);
}

function updatesBlockHtml() {
  const releases = BUILD.repo ? `https://github.com/${BUILD.repo}/releases/latest` : '';
  const others = platform === 'web' && releases
    ? `<p class="muted" style="margin-top:10px">Applications à installer : <a href="${releases}" target="_blank" rel="noopener" style="color:var(--accent2)">Windows, Android et iPhone sur GitHub</a>.</p>`
    : '';
  const where = platform === 'web' ? 'Version web : mise à jour automatique à chaque ouverture.' : isStoreBuild ? 'Les mises à jour arrivent automatiquement par le Play Store.'
    : !BUILD.repo ? 'Mises à jour : publiez Sonora sur GitHub pour les activer (voir README).'
      : platform === 'electron' ? 'Les nouvelles versions publiées sur GitHub sont téléchargées et installées automatiquement (version installée).'
        : 'Sonora vérifie GitHub et vous propose les nouvelles versions.';
  return `<div class="set-block"><h3>✨ Version et mises à jour</h3>
    <p class="muted">Sonora ${esc(currentVersion())} · ${esc(where)}</p>
    ${!isStoreBuild && BUILD.repo && platform !== 'web' ? '<button class="btn ghost" id="up-check">Rechercher une mise à jour</button>' : ''}${others}</div>`;
}

function bindUpdatesBlock() {
  const b = $('#up-check');
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try {
      if (platform === 'electron') {
        const r = await window.sonora.checkUpdate();
        if (r.auto) { toast(r.version && r.version !== currentVersion() ? `Téléchargement de la version ${r.version}…` : 'Sonora est à jour ✅'); return; }
      }
      const u = await checkForUpdate({ force: true });
      if (u) { pendingUpdate = u; updateBanner(); } else toast('Sonora est à jour ✅');
    } catch (e) { toast('Vérification impossible : ' + e.message); } finally { b.disabled = false; }
  };
}

/* =========================================================================
   Vue : Réglages
   ========================================================================= */
const QUALITY_OPTS = [
  ['low', 'Économie', '64 kbit/s · peu de données'],
  ['normal', 'Normale', 'MP3 VBR · 128 à 256 kbit/s'],
  ['high', 'Très haute', 'Sans perte (FLAC) si disponible'],
];

function viewSettings() {
  const st = getSettings();
  const opts = (name, list) => `<div class="opts">${list.map(([v, l, d]) => `<button class="opt ${st[name] === v ? 'active' : ''}" data-set="${name}" data-val="${v}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>`;
  const used = state.media.reduce((n, m) => n + (m.size || 0), 0);
  view.innerHTML = `${isMobile ? '<button class="back" id="back">← Bibliothèque</button>' : ''}<h1>Réglages</h1><p class="sub">Les réglages sont enregistrés sur cet appareil et synchronisés avec votre compte.</p>
    ${accountBlockHtml()}

    <div class="set-block"><h3>🎵 Qualité audio</h3>
      <p class="muted">Pour la musique libre. Une qualité plus haute utilise plus de données et d'espace.</p>
      <div class="set-row">Streaming</div>${opts('streamQuality', QUALITY_OPTS)}
      <div class="set-row">Téléchargements (hors-ligne)</div>${opts('downloadQuality', QUALITY_OPTS)}
      <p class="muted small" style="margin-top:12px">Les titres déjà téléchargés gardent leur qualité. Supprimez-les puis retéléchargez-les pour changer.</p>
    </div>

    <div class="set-block"><h3>▶️ YouTube</h3>
      <p class="muted">La qualité des titres YouTube est réglée automatiquement par le lecteur officiel de YouTube selon votre connexion. Vous pouvez la changer pendant la lecture avec l'icône ⚙ du lecteur, en mode vidéo.</p>
      <div class="set-row">Affichage par défaut</div>
      ${(() => { const a = getAudioOnly(); return `<div class="opts"><button class="opt ${a ? '' : 'active'}" data-yt-audio="0"><b>🎬 Vidéo</b><span>Le clip est affiché</span></button><button class="opt ${a ? 'active' : ''}" data-yt-audio="1"><b>🎧 Audio seul</b><span>Seulement le son</span></button></div>`; })()}
      <div class="set-row">Source des titres</div>
      <p class="muted">${getUserYtApiKey() ? '✅ API officielle YouTube (votre clé).' : hasBuiltInYtKey() ? '✅ API officielle YouTube (clé intégrée à Sonora).' : 'Mode sans clé. Pour utiliser l\'API officielle, ajoutez une clé dans Musique → « Source des titres ».'}</p>
    </div>

    <div class="set-block"><h3>🎬 Films</h3>
      <div class="set-row">Téléchargements</div>
      ${opts('filmDownload', [['light', 'Légère', 'Fichier plus petit (recommandé sur iPhone)'], ['high', 'Haute', 'Meilleure image, fichier plus gros']])}
    </div>

    <div class="set-block"><h3>💾 Stockage</h3>
      <p class="muted">${state.media.length} élément(s) hors-ligne · ${fmtSize(used)} utilisés sur cet appareil.</p>
      <button class="btn ghost" id="set-lib">Gérer dans la Bibliothèque</button>
    </div>

    ${updatesBlockHtml()}

    <div class="set-block"><h3>ℹ️ À propos</h3>
      <p class="muted">Sonora ${esc(currentVersion())} · Sans publicité · Sources : YouTube (lecteur officiel), Internet Archive, Radio Browser, vos fichiers.</p>
    </div>`;

  const back = $('#back');
  if (back) back.onclick = () => go('library');
  bindAccountBlock();
  bindUpdatesBlock();
  view.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => {
    setSetting(b.dataset.set, b.dataset.val);
    cloud.touch();
    // Les albums déjà affichés seront rechargés avec la nouvelle qualité
    toast('Réglage enregistré');
    render(true);
  }));
  view.querySelectorAll('[data-yt-audio]').forEach((b) => (b.onclick = () => { setAudioOnly(b.dataset.ytAudio === '1'); updateNowPlaying(); render(true); }));
  $('#set-lib').onclick = () => { libTab = 'offline'; go('library'); };
}

/* =========================================================================
   Mini-lecteur et lecteur plein écran
   ========================================================================= */
const npSheet = $('#np');
function openNowPlaying() { if (player.current) { npSheet.classList.remove('hidden'); updateNowPlaying(); setTimeout(placeYtHost, 320); } }
function closeNowPlaying() { npSheet.classList.add('hidden'); placeYtHost(); }

/** Le lecteur YouTube reste toujours dans la page (pour continuer à jouer) : on le place sur l'emplacement du lecteur plein écran, sinon hors de l'écran. */
function placeYtHost() {
  const host = $('#yt-host');
  const slot = $('#np-yt-slot');
  const show = !npSheet.classList.contains('hidden') && !slot.classList.contains('hidden');
  if (show) {
    const r = slot.getBoundingClientRect();
    host.classList.remove('offscreen');
    Object.assign(host.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  } else {
    host.classList.add('offscreen');
    host.removeAttribute('style');
  }
}
npSheet.addEventListener('scroll', placeYtHost);
npSheet.addEventListener('animationend', placeYtHost);
window.addEventListener('resize', placeYtHost);
$('#np-video-toggle').onclick = () => {
  setAudioOnly(!getAudioOnly());
  updateNowPlaying();
  toast(getAudioOnly() ? '🎧 Audio seul' : '🎬 Vidéo affichée');
  if (current.name === 'music') render(true);
};

$('#mini-open').onclick = openNowPlaying;
$('#np-close').onclick = closeNowPlaying;
$('#mini-play').onclick = () => player.toggle();
$('#np-play').onclick = () => player.toggle();
$('#mini-next').onclick = () => player.next();
$('#np-next').onclick = () => player.next();
$('#mini-prev').onclick = () => player.prev();
$('#np-prev').onclick = () => player.prev();
$('#np-shuffle').onclick = () => player.toggleShuffle();
$('#np-repeat').onclick = () => player.cycleRepeat();
$('#mini-vol').oninput = (e) => player.setVolume(+e.target.value);
$('#np-range').oninput = (e) => player.seek(+e.target.value / 1000);
$('#np-sleep').onchange = (e) => {
  player.setSleep(e.target.value);
  if (e.target.value !== '0') toast(e.target.value === 'end' ? 'Arrêt à la fin du titre' : `Arrêt dans ${e.target.value} min`);
};
$('#np-fav').onclick = () => { const t = player.current; if (t) toggleFav(t.live ? 'radio' : 'track', t.key, t).then(() => current.name === 'library' && render(true)); };
$('#np-addpl').onclick = () => { const t = player.current; if (t && !t.live) addToPlaylist(t); };
$('#np-queue').addEventListener('click', (e) => { const r = e.target.closest('[data-q]'); if (r) player.jump(+r.dataset.q); });

function updateNowPlaying() {
  const t = player.current;
  const mini = $('#mini');
  mini.classList.toggle('hidden', !t);
  document.body.classList.toggle('no-mini', !t);
  if (!t) return;
  const cover = t.cover || (t.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO);
  $('#mini-cover').src = cover;
  $('#mini-cover').onerror = function () { this.src = FALLBACK_AUDIO; };
  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist || '';
  $('#np-cover').src = cover;
  $('#np-cover').onerror = function () { this.src = FALLBACK_AUDIO; };
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist || '';
  const isVideo = t.kind === 'video';
  const isYt = t.kind === 'youtube';
  const showYt = isYt && !getAudioOnly();
  videoElement.classList.toggle('hidden', !isVideo);
  $('#np-yt-slot').classList.toggle('hidden', !showYt);
  $('#np-cover').classList.toggle('hidden', isVideo || showYt);
  $('#np-video-toggle').classList.toggle('hidden', !isYt);
  $('#np-video-toggle').textContent = getAudioOnly() ? '🎬' : '🎧';
  $('#np-video-toggle').title = getAudioOnly() ? 'Afficher la vidéo' : 'Audio seul';
  requestAnimationFrame(placeYtHost);
  $('#np-shuffle').classList.toggle('on', player.shuffle);
  $('#np-repeat').classList.toggle('on', player.repeat !== 'off');
  $('#np-repeat').textContent = player.repeat === 'one' ? '🔂' : '🔁';
  $('#np-fav').textContent = isFav(t.key) ? '♥ Favori' : '♡ Favori';
  $('#np-fav').classList.toggle('on', isFav(t.key));
  $('#np-addpl').classList.toggle('hidden', !!t.live);
  $('#np-queue').innerHTML = player.queue.map((q, i) => `
    <div class="row ${i === player.index ? 'playing' : ''}" data-q="${i}" style="cursor:pointer">
      <div class="rc"><img src="${esc(q.cover || FALLBACK_AUDIO)}" onerror="this.src='${FALLBACK_AUDIO}'"></div>
      <div class="ri"><div class="rt ellipsis">${esc(q.title)}</div><div class="ra ellipsis">${esc(q.artist || '')}</div></div>
    </div>`).join('');
  updateState();
  updateTime();
}

function updateState() {
  const icon = player.playing ? '⏸' : '▶';
  $('#mini-play').textContent = icon;
  $('#np-play').textContent = icon;
}

function updateTime() {
  const el = player.el;
  const t = player.current;
  const live = !!t?.live || el.duration === Infinity;
  const frac = !live && el.duration > 0 ? el.currentTime / el.duration : 0;
  $('#mini-bar').style.width = live ? '100%' : `${frac * 100}%`;
  $('#mini-time').textContent = live ? `● EN DIRECT · ${fmtTime(el.currentTime)}` : `${fmtTime(el.currentTime)} / ${fmtTime(el.duration)}`;
  $('#np-cur').textContent = fmtTime(el.currentTime);
  $('#np-dur').textContent = live ? 'DIRECT' : fmtTime(el.duration);
  const range = $('#np-range');
  range.disabled = live;
  if (document.activeElement !== range) range.value = Math.round(frac * 1000);
}

player.addEventListener('change', () => {
  updateNowPlaying();
  // Met à jour la piste surlignée sans recharger la page
  view.querySelectorAll('.row').forEach((r) => {
    const i = r.querySelector('[data-act="play"]')?.dataset.i;
    if (i != null) r.classList.toggle('playing', rowTracks[+i]?.key === player.current?.key);
  });
});
player.addEventListener('state', () => {
  updateState();
  // Une seule source à la fois : si l'appli joue, on met en pause YouTube / les sites
  if (player.playing && platform === 'electron') {
    document.querySelectorAll('webview').forEach((w) => {
      try { w.executeJavaScript('document.querySelectorAll("video,audio").forEach(function(m){m.pause()})').catch(() => {}); } catch (_) {}
    });
  }
});
player.addEventListener('time', updateTime);
let ytEmbedBlocked = false;
/** Si le lecteur intégré a été refusé sur cet appareil, les titres YouTube s'ouvrent directement dans YouTube. */
function ytDirect(tracks, start) {
  if (!ytEmbedBlocked || tracks[start]?.kind !== 'youtube') return false;
  const ids = tracks.slice(start).filter((q) => q.kind === 'youtube').slice(0, 50).map((q) => q.ytId);
  openYouTubeUrl(`https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`);
  return true;
}
player.addEventListener('error', () => {
  const t = player.current;
  if (t?.kind === 'youtube') {
    const code = ytMedia.lastError;
    if (code === 152 || code === 153) {
      // Le lecteur intégré est refusé sur cet appareil : on lit la file d'attente directement sur YouTube (avec le bloqueur)
      ytEmbedBlocked = true;
      const ids = player.queue.slice(player.index).filter((q) => q.kind === 'youtube').slice(0, 50).map((q) => q.ytId);
      player.queue = [];
      player.index = -1;
      ytMedia.stop();
      updateNowPlaying();
      closeNowPlaying();
      toast('Lecture dans YouTube (bloqueur de pub actif)');
      openYouTubeUrl(`https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`);
      return;
    }
    if (code === 100 || code === 101 || code === 150) { toast('Ce titre ne peut pas être lu hors de YouTube : titre suivant…'); return; }
    toast('Lecteur YouTube indisponible : vérifiez votre connexion internet.');
    return;
  }
  toast(t?.live ? 'Cette radio ne répond pas, essayez-en une autre.' : 'Impossible de lire ce média.');
});

/** Ouvre une adresse YouTube dans le panneau (Windows) ou le navigateur natif (iPhone / Android). */
async function openYouTubeUrl(url) {
  if (isStoreBuild) { window.open(url, '_blank'); return; } // version Play Store : appli YouTube officielle
  if (platform === 'electron') { ytOpen(url); go('youtube'); return; }
  if (isMobile) { try { await openYouTubeNative(url.replace('https://www.', 'https://m.'), { audioOnly: getAudioOnly(), adblock: !isStoreBuild }); } catch (e) { toast('Erreur : ' + e.message); } return; }
  window.open(url, '_blank');
}
player.addEventListener('sleep', () => { $('#np-sleep').value = '0'; toast('⏾ Minuterie terminée : lecture arrêtée'); });

/* Raccourcis clavier (Windows) */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  if (e.code === 'ArrowRight' && e.ctrlKey) player.next();
  if (e.code === 'ArrowLeft' && e.ctrlKey) player.prev();
  if (e.code === 'Escape') { closeNowPlaying(); closeModal(); }
});

/* Glisser-déposer de fichiers n'importe où dans la fenêtre */
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
});

/* =========================================================================
   Démarrage
   ========================================================================= */
document.body.classList.add('no-mini', `platform-${platform}`);
if (isStoreBuild) document.body.classList.add('store-build');
startUpdateChecks();
loadState()
  .then(() => go('library'))
  .catch((e) => { console.error(e); view.innerHTML = errorHtml(e); });
