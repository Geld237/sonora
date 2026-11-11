import { db, uid } from './db.js';
import { iaSearch, musicQuery, filmQuery, iaAlbum, iaFilm, radioSearch, ytTrending, ytNewReleases, ytSearch, ytStyle, ytCategory, ytForYou, ytRadio, ytFindOne, ytDiagnostic, getYtApiKey, getUserYtApiKey, hasBuiltInYtKey, setYtApiKey, ytMode } from './api.js';
import { ytMedia } from './youtube-player.js';
import { getSettings, setSetting, markSettingsChanged, settingsChangedAt, SETTINGS_TS_KEY, dataSaverActive } from './settings.js';
import { fetchLyrics } from './lyrics.js';
import { recordListen, recap, tastes, drawRecap, statsData, setStatsData } from './recap.js';
import { encodePlaylist, decodePlaylist, parseTrackList } from './share.js';
import { podcastSearch, podcastTop, podcastLookup, podcastFeed, getSubscriptions, setSubscriptions, isSubscribed, toggleSubscription, getPosition, setPosition } from './podcasts.js';
import { initRooms, createRoom, joinRoom, leaveRoom, pushState, currentRoom, onRoom } from './rooms.js';
import { applyLanguage, tr } from './i18n.js';
import qrcode from './qrcode.js';
import * as cloud from './cloud.js';
import { BUILD } from './build-info.js';
import { I, ic } from './icons.js';
import { checkForUpdate, skipVersion, currentVersion } from './updates.js';
import { player, videoElement, EQ_PRESETS, setAudioEffects } from './player.js';
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
const FALLBACK_AUDIO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2c2c2e"/><g fill="none" stroke="#8e8e93" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M42 66V36l24-5v30"/><circle cx="36" cy="66" r="6"/><circle cx="60" cy="61" r="6"/></g></svg>');
const FALLBACK_VIDEO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2c2c2e"/><g fill="none" stroke="#8e8e93" stroke-width="4" stroke-linejoin="round"><rect x="26" y="32" width="48" height="36" rx="6"/><path d="M45 43l12 7-12 7z" fill="#8e8e93"/></g></svg>');

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function modal(html) {
  $('#modal-card').className = 'modal-card';
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
  if (/\.(lrc|txt)$/i.test(file.name)) return null;
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name) ? 'video' : /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name) ? 'audio' : null;
}

/** Paroles synchronisées (format .lrc) ou texte simple : [{ t: secondes, text }] */
function parseLyrics(raw) {
  const lines = [];
  let timed = false;
  for (const line of String(raw || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (stamps.length) {
      timed = true;
      for (const m of stamps) lines.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text });
    } else if (text && !/^\[[a-z]+:/i.test(line)) lines.push({ t: null, text });
  }
  return { timed, lines: timed ? lines.filter((l) => l.t != null).sort((a, b) => a.t - b.t) : lines };
}
const baseName = (n) => n.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim().toLowerCase();

async function importFiles(files) {
  let ok = 0;
  // Fichiers de paroles (.lrc / .txt) déposés avec la musique : associés par nom de fichier
  const lyricFiles = new Map();
  for (const f of files) if (/\.(lrc|txt)$/i.test(f.name)) lyricFiles.set(baseName(f.name), f);
  let lyricsAdded = 0;
  for (const [key, f] of lyricFiles) {
    const m = state.media.find((x) => baseName(x.fileName || '') === key || `${x.artist} - ${x.title}`.toLowerCase() === key || x.title.toLowerCase() === key);
    if (m && !files.some((x) => !/\.(lrc|txt)$/i.test(x.name) && baseName(x.name) === key)) { m.lyrics = await f.text(); await db.put('media', m); lyricsAdded++; }
  }
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
      const lrc = lyricFiles.get(baseName(file.name));
      await db.put('media', { id, title, artist, kind, origin: 'local', size: file.size, addedAt: Date.now(), fileName: file.name, lyrics: lrc ? await lrc.text() : '' });
      if (lrc) lyricsAdded++;
      ok++;
    } catch (e) {
      console.error(e);
      toast(`Erreur d'import : ${file.name}`);
    }
  }
  await loadState();
  toast(ok || lyricsAdded ? [ok ? `${ok} fichier(s) ajouté(s)` : '', lyricsAdded ? `paroles ajoutées à ${lyricsAdded} titre(s)` : ''].filter(Boolean).join(' · ') : 'Aucun fichier audio/vidéo reconnu');
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
    toast(`« ${track.title} » est disponible hors ligne`);
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
    toast('Ajouté aux favoris');
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
  const list = state.playlists.map((p) => `<button class="pl-pick" data-pl="${p.id}">${esc(p.name)} <span class="muted small">(${p.tracks.length})</span></button>`).join('');
  const card = modal(`<h3>Ajouter à une playlist</h3>${list || '<p class="muted">Aucune playlist pour le moment.</p>'}
    <button class="pl-pick" id="pl-new">Nouvelle playlist…</button>
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

function trackRows(tracks, { removable = false, playlistId = null, numbered = false, ranked = false, hideable = false, rankStart = 0 } = {}) {
  const base = rowTracks.length;
  rowTracks.push(...tracks);
  if (!tracks.length) return '';
  return `<div class="list">${tracks.map((t, j) => {
    const i = base + j;
    const playing = player.current && player.current.key === t.key;
    const offline = isOffline(t);
    const canDl = !t.live && (t.origin === 'archive' || t.origin === 'podcast') && !offline;
    const cover = t.cover || (t.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO);
    return `<div class="row ${playing ? 'playing' : ''}">${ranked ? `<span class="rank${rankStart + j < 3 ? ' top' : ''}">${rankStart + j + 1}</span>` : ''}
      <div class="rc${t.kind === 'youtube' ? ' wide' : ''}">${numbered ? `<span class="muted small">${j + 1}</span>` : `<img src="${esc(cover)}" loading="lazy" onerror="this.src='${t.kind === 'video' ? FALLBACK_VIDEO : FALLBACK_AUDIO}'">`}</div>
      <div class="ri" data-act="play" data-i="${i}">
        <div class="rt ellipsis">${esc(t.title)}${t.live ? '<span class="badge">EN DIRECT</span>' : ''}${t.kind === 'video' ? '<span class="badge">VIDÉO</span>' : ''}${offline ? '<span class="badge ok">HORS-LIGNE</span>' : ''}${t.quality === 'Sans perte' ? '<span class="badge">SANS PERTE</span>' : ''}</div>
        <div class="ra ellipsis">${esc(t.sub || t.artist || '')}${t.duration ? ' · ' + fmtTime(t.duration) : ''}</div>
      </div>
      <div class="acts">
        <button class="icon-btn ${isFav(t.key) ? 'on' : ''}" data-act="fav" data-i="${i}" title="Favori">${isFav(t.key) ? I.heartFill : I.heart}</button>
        ${canDl ? `<button class="icon-btn" data-act="dl" data-i="${i}" title="Télécharger pour écouter hors ligne">${I.download}</button>` : ''}
        <button class="icon-btn" data-act="queue" data-i="${i}" title="Lire ensuite">${I.queue}</button>
        ${t.live ? '' : `<button class="icon-btn" data-act="addpl" data-i="${i}" title="Ajouter à une playlist">${I.plus}</button>`}
        ${removable && t.mediaId ? `<button class="icon-btn" data-act="del" data-i="${i}" title="Supprimer">${I.trash}</button>` : ''}
        ${playlistId ? `<button class="icon-btn" data-act="plrm" data-i="${i}" data-pl="${playlistId}" title="Retirer de la playlist">${I.close}</button>` : ''}
        ${hideable ? `<button class="icon-btn hide-btn" data-act="hide" data-i="${i}" title="Retirer ce titre des résultats">${I.minus}</button>` : ''}
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
    case 'hide': {
      hideTrack(t);
      const undo = () => { unhideTrack(t.ytId || t.key); refreshMusicList(); };
      toastAction(`« ${t.title} » retiré des résultats`, 'Annuler', undo);
      refreshMusicList();
      break;
    }
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
   Recherche globale (Ctrl+K / ⌘K) : bibliothèque, favoris, playlists, sites, historique
   ========================================================================= */
function openGlobalSearch() {
  const card = modal(`<div class="gs"><div class="gs-in">${I.search}<input id="gs-q" placeholder="Rechercher dans Enora…" autocomplete="off" /></div><div id="gs-res" class="gs-res"></div>
    <p class="muted small" style="margin:10px 2px 0">Entrée : chercher le titre en ligne dans Musique · Échap : fermer</p></div>`);
  card.classList.add('gs-card');
  const input = $('#gs-q', card);
  const res = $('#gs-res', card);
  let items = [];
  const run = () => {
    const q = fold(input.value.trim());
    if (!q) { res.innerHTML = ''; items = []; return; }
    const hit = (txt) => fold(txt).includes(q);
    const tracks = [
      ...state.media.map(mediaToTrack),
      ...[...state.favs.values()].filter((f) => f.type === 'track' || f.type === 'radio').map((f) => hydrate(f.data)),
      ...getHistory().map((x) => hydrate(x.track)),
    ];
    const seen = new Set();
    const t = tracks.filter((x) => hit(`${x.title} ${x.artist}`) && !seen.has(x.key) && seen.add(x.key)).slice(0, 8);
    const pls = state.playlists.filter((p) => hit(p.name)).slice(0, 4);
    const sites = [...builtInSites(), ...loadSites()].filter((x) => hit(`${x.name} ${x.url}`)).slice(0, 4);
    items = [...t.map((x) => ({ type: 'track', x })), ...pls.map((x) => ({ type: 'pl', x })), ...sites.map((x) => ({ type: 'site', x }))];
    res.innerHTML = items.length ? items.map((it, i) => {
      if (it.type === 'track') return `<button class="gs-item" data-g="${i}"><span class="gs-ic">${I.music}</span><span><b>${esc(it.x.title)}</b><small>${esc(it.x.artist || '')}</small></span></button>`;
      if (it.type === 'pl') return `<button class="gs-item" data-g="${i}"><span class="gs-ic">${I.list}</span><span><b>${esc(it.x.name)}</b><small>Playlist · ${it.x.tracks.length} titre(s)</small></span></button>`;
      return `<button class="gs-item" data-g="${i}"><span class="gs-ic">${I.globe}</span><span><b>${esc(it.x.name)}</b><small>Site · ${esc(hostOf(it.x.url))}</small></span></button>`;
    }).join('') : `<p class="muted" style="padding:10px 4px">Rien dans votre bibliothèque. Appuyez sur Entrée pour chercher « ${esc(input.value.trim())} » en ligne.</p>`;
  };
  const choose = (it) => {
    closeModal();
    if (it.type === 'track') { player.playTrack(it.x); if (it.x.kind === 'video' || (it.x.kind === 'youtube' && !getAudioOnly())) openNowPlaying(); }
    else if (it.type === 'pl') go('playlist', { id: it.x.id, tab: 'library' });
    else openSite(it.x.url);
  };
  input.oninput = run;
  input.onkeydown = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      closeModal();
      const m = cache.music || (cache.music = {});
      const y = m.yt || (m.yt = { mode: 'trend', region: 'FR', genre: '', term: '', items: null });
      const pq = parseQuery(q);
      Object.assign(y, { mode: 'search', term: pq.query || q, raw: q, exclude: pq.exclude, items: null, showAll: false });
      go('music');
    }
  };
  res.onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) choose(items[+b.dataset.g]); };
  setTimeout(() => input.focus(), 30);
}

/* =========================================================================
   Sauvegarde et restauration (fichier JSON)
   ========================================================================= */
async function exportBackup() {
  const data = {
    app: 'Enora', version: currentVersion(), date: new Date().toISOString(),
    favs: await db.all('favs'), playlists: await db.all('playlists'), sites: loadSites(),
    settings: getSettings(), audioOnly: getAudioOnly(), hidden: getHidden(), history: getHistory(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `enora-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Sauvegarde enregistrée');
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'Enora' && d.app !== 'Sonora') throw new Error('ce fichier n\'est pas une sauvegarde Enora');
    for (const f of d.favs || []) await db.put('favs', f);
    for (const p of d.playlists || []) await db.put('playlists', p);
    if (Array.isArray(d.sites)) {
      const mine = loadSites();
      const ids = new Set(mine.map((x) => x.id));
      saveSites([...mine, ...d.sites.filter((x) => !ids.has(x.id))]);
    }
    if (d.settings) { try { localStorage.setItem('sonora.settings', JSON.stringify({ ...getSettings(), ...d.settings })); } catch (_) {} markSettingsChanged(); }
    if (d.hidden) setHidden({ ...getHidden(), ...d.hidden });
    if (Array.isArray(d.history)) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify([...d.history, ...getHistory()].sort((a, b) => b.t - a.t).slice(0, 300))); } catch (_) {} }
    await loadState();
    cloud.touch();
    toast(`Sauvegarde restaurée : ${(d.favs || []).length} favori(s), ${(d.playlists || []).length} playlist(s)`);
    render(true);
  } catch (e) { toast('Restauration impossible : ' + e.message, 5000); }
}

/* =========================================================================
   Historique d'écoute et statistiques
   ========================================================================= */
const HISTORY_KEY = 'sonora.history';
function getHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (_) { return []; } }
function addToHistory(t) {
  if (!t) return;
  const h = getHistory().filter((x) => !(x.track.key === t.key && Date.now() - x.t < 60000));
  const track = { ...t };
  if (track.cover && track.cover.startsWith('blob:')) delete track.cover;
  h.unshift({ track, t: Date.now() });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 300))); } catch (_) {}
  recordListen(t, t.style || '');
}
function historyStats() {
  const h = getHistory();
  const byArtist = new Map();
  for (const x of h) { const a = x.track.artist || 'Inconnu'; byArtist.set(a, (byArtist.get(a) || 0) + 1); }
  const top = [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const weekAgo = Date.now() - 7 * 86400000;
  return { total: h.length, week: h.filter((x) => x.t > weekAgo).length, top };
}
// Un titre compte comme écouté après 15 secondes de lecture
let listenTimer = null;

/* =========================================================================
   Titres retirés des résultats (bouton « − ») et recherche « -mot »
   ========================================================================= */
const HIDDEN_KEY = 'sonora.hidden';
function getHidden() { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY)) || {}; } catch (_) { return {}; } }
function setHidden(h) { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(h)); } catch (_) {} markSettingsChanged(); cloud.touch(); }
function hideTrack(t) { const h = getHidden(); h[t.ytId || t.key] = { title: t.title, artist: t.artist || '', t: Date.now() }; setHidden(h); }
function unhideTrack(id) { const h = getHidden(); delete h[id]; setHidden(h); }

/** Sépare « afro -live -remix » en { query: 'afro', exclude: ['live', 'remix'] } */
function parseQuery(raw) {
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const exclude = words.filter((w) => w.length > 1 && w.startsWith('-')).map((w) => w.slice(1).toLowerCase());
  const query = words.filter((w) => !(w.length > 1 && w.startsWith('-'))).join(' ');
  return { query, exclude };
}
const fold = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Applique les titres retirés et les mots exclus à une liste de résultats. */
function filterResults(items, exclude = []) {
  const h = getHidden();
  const ex = exclude.map(fold);
  return items.filter((t) => !h[t.ytId || t.key] && !ex.some((w) => fold(`${t.title} ${t.artist}`).includes(w)));
}

let refreshMusicList = () => {};

/** Message avec un bouton (ex. « Annuler »). */
function toastAction(msg, label, fn, ms = 5000) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span> <button class="toast-btn" id="toast-act">${esc(label)}</button>`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  $('#toast-act').onclick = () => { t.classList.add('hidden'); fn(); };
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* =========================================================================
   Navigation
   ========================================================================= */
let current = { name: 'library', params: {} };
const cache = { music: null, films: null, radio: null, pod: null, feeds: null };

function go(name, params = {}) {
  current = { name, params };
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === (params.tab || name)));
  render();
}

document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
// Le logo et le nom « Enora » ramènent à la Bibliothèque
$('.brand').addEventListener('click', () => { libTab = 'offline'; go('library'); });

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
  const views = { library: viewLibrary, music: viewMusic, album: viewAlbum, films: viewFilms, film: viewFilm, radio: viewRadio, youtube: viewYouTube, playlist: viewPlaylist, podcast: viewPodcast, web: viewWeb, settings: viewSettings, about: viewAbout };
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
    <button data-lib="playlists" class="${libTab === 'playlists' ? 'active' : ''}">Playlists</button>
    <button data-lib="history" class="${libTab === 'history' ? 'active' : ''}">Historique</button></div>`;
  let body = '';

  if (libTab === 'offline') {
    const items = state.media.filter((m) => libFilter === 'all' || m.kind === libFilter);
    const total = state.media.reduce((s, m) => s + (m.size || 0), 0);
    body = `
      <div class="drop" id="drop">
        <div class="drop-ic">${I.upload}</div>
        <div style="margin:6px 0 12px">Importez votre musique et vos vidéos pour les écouter <b>sans internet</b>.</div>
        <button class="btn" id="import-btn">Importer des fichiers</button>
        <div class="small" style="margin-top:10px">${platform === 'electron' ? 'Vous pouvez aussi glisser-déposer des fichiers ici.' : 'MP3, M4A, WAV, FLAC, MP4, MOV…'}</div>
      </div>
      <div class="chips">
        ${[['all', 'Tout'], ['audio', 'Musique'], ['video', 'Vidéos']].map(([k, l]) => `<button class="chip ${libFilter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
      </div>
      ${items.length ? `<p class="muted small">${items.length} élément(s) · ${fmtSize(total)} utilisés</p>${trackRows(items.map(mediaToTrack), { removable: true })}`
        : '<div class="empty"><div class="big">${I.note}</div>Rien ici pour l\'instant.<br>Importez des fichiers ou téléchargez des titres depuis l\'onglet Films &amp; TV.</div>'}`;
  } else if (libTab === 'history') {
    const h = getHistory();
    const st = historyStats();
    // Récemment écoutés : un seul exemplaire par titre
    const seen = new Set();
    const recent = h.filter((x) => !seen.has(x.track.key) && seen.add(x.track.key)).slice(0, 50).map((x) => hydrate(x.track));
    body = !h.length ? `<div class="empty"><div class="big">${I.clock}</div>Aucune écoute pour l'instant.<br>Les titres écoutés plus de 15 secondes apparaîtront ici.</div>` : `
      <div class="stats">
        <div class="stat"><b>${st.week}</b><span>écoutes cette semaine</span></div>
        <div class="stat"><b>${st.total}</b><span>écoutes au total</span></div>
        <div class="stat wide"><span>Artistes les plus écoutés</span><b class="small-b">${st.top.map(([a, n]) => `${esc(a)} <i>${n}</i>`).join(' · ')}</b></div>
      </div>
      <button class="btn" id="open-recap" style="margin:4px 0 6px">${ic('chart', 'Ma rétrospective')}</button>
      <div class="h2row"><h2>Récemment écoutés</h2><button class="btn ghost" id="hist-clear">Effacer l'historique</button></div>
      ${trackRows(recent)}`;
  } else if (libTab === 'favs') {
    const favs = [...state.favs.values()].sort((a, b) => b.addedAt - a.addedAt);
    const tracks = favs.filter((f) => f.type === 'track' || f.type === 'radio').map((f) => hydrate(f.data));
    const albums = favs.filter((f) => f.type === 'album');
    const films = favs.filter((f) => f.type === 'film');
    body = !favs.length ? `<div class="empty"><div class="big">${I.heart}</div>Aucun favori.<br>Touchez le cœur à côté d'un titre, d'une radio, d'un album ou d'un film.</div>` : `
      ${tracks.length ? `<h2>Titres et radios</h2>${trackRows(tracks)}` : ''}
      ${albums.length ? `<h2>Albums</h2><div class="grid">${albums.map((f) => card(f.data, 'album')).join('')}</div>` : ''}
      ${films.length ? `<h2>Films</h2><div class="grid">${films.map((f) => card(f.data, 'film')).join('')}</div>` : ''}`;
  } else {
    body = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px"><button class="btn" id="new-pl">Nouvelle playlist</button><button class="btn ghost" id="imp-pl">${ic('download', 'Importer')}</button></div>
      ${state.playlists.length ? `<div class="list">${state.playlists.map((p) => `
        <div class="row"><div class="rc">${I.music}</div>
          <div class="ri" data-open-pl="${p.id}"><div class="rt">${esc(p.name)}</div><div class="ra">${p.tracks.length} titre(s)</div></div>
          <div class="acts"><button class="icon-btn" data-play-pl="${p.id}" title="Lire">${I.play}</button><button class="icon-btn" data-del-pl="${p.id}" title="Supprimer">${I.trash}</button></div>
        </div>`).join('')}</div>` : `<div class="empty"><div class="big">${I.music}</div>Créez votre première playlist.</div>`}`;
  }

  view.innerHTML = `<div class="h1row"><h1>Bibliothèque</h1><span style="display:flex;gap:4px"><button class="icon-btn" id="open-search" title="Rechercher (Ctrl+K)">${I.search}</button><button class="icon-btn" id="open-settings" title="Réglages">${I.settings}</button></span></div><p class="sub">Votre musique, vos vidéos, vos favoris — toujours sans publicité.</p>${seg}${body}`;

  view.querySelectorAll('[data-lib]').forEach((b) => (b.onclick = () => { libTab = b.dataset.lib; render(); }));
  const hc = $('#hist-clear');
  if (hc) hc.onclick = async () => { if (await confirmBox('Effacer tout l\'historique d\'écoute ?', 'Effacer')) { try { localStorage.removeItem(HISTORY_KEY); } catch (_) {} render(true); } };
  $('#open-search').onclick = openGlobalSearch;
  const rc = $('#open-recap'); if (rc) rc.onclick = () => openRecap();
  const ip = $('#imp-pl'); if (ip) ip.onclick = () => openImportModal();
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
  view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Playlists</span></button>
    <div class="detail"><div class="dc" style="display:grid;place-items:center;background:var(--bg3);color:var(--accent)">${I.note}</div>
      <div class="di"><div class="muted small">PLAYLIST</div><h1>${esc(p.name)}</h1><div class="muted">${tracks.length} titre(s)</div>
        <div class="actions"><button class="btn" id="pl-play" ${tracks.length ? '' : 'disabled'}>${ic('play', 'Tout lire')}</button>
        <button class="btn ghost" id="pl-shuffle" ${tracks.length ? '' : 'disabled'}>Aléatoire</button>
        <button class="btn ghost" id="pl-rename">Renommer</button>
        <button class="btn ghost" id="pl-share" ${tracks.length ? '' : 'disabled'}>${ic('share', 'Partager')}</button></div></div></div>
    ${tracks.length ? trackRows(tracks, { playlistId: p.id }) : '<div class="empty">Ajoutez des titres avec le bouton « Ajouter à une playlist ».</div>'}`;
  $('#back').onclick = () => { libTab = 'playlists'; go('library'); };
  $('#pl-play').onclick = () => player.playList(tracks);
  $('#pl-shuffle').onclick = () => { player.shuffle = true; player.playList(tracks, Math.floor(Math.random() * tracks.length)); };
  $('#pl-share').onclick = () => sharePlaylist(p);
  $('#pl-rename').onclick = async () => {
    const name = await ask('Renommer la playlist', '', p.name);
    if (!name) return;
    p.name = name;
    await savePlaylist(p);
    render(true);
  };
}

/* =========================================================================
   Partage d'une playlist (lien + QR code) et import (lien, liste de titres, CSV)
   ========================================================================= */
const webAppUrl = () => { const [owner, name] = (BUILD.repo || 'Geld237/sonora').split('/'); return `https://${owner.toLowerCase()}.github.io/${name}/`; };

async function sharePlaylist(p) {
  const { code, count, skipped } = await encodePlaylist(p);
  if (!count) { toast('Cette playlist ne contient que des fichiers de votre appareil : ils ne peuvent pas être partagés par lien.', 5000); return; }
  const link = `${webAppUrl()}#pl=${code}`;
  let qr = '';
  if (link.length <= 2200) {
    try { const q = qrcode(0, 'L'); q.addData(link); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (_) {}
  }
  const c = modal(`<h3>Partager « ${esc(p.name)} »</h3>
    <p class="muted">${count} titre(s). La personne ouvre le lien (ou scanne le code) et la playlist s'ajoute dans son Enora.${skipped ? ` ${skipped} fichier(s) de votre appareil ne sont pas inclus.` : ''}</p>
    ${qr ? `<div class="qr">${qr}</div>` : '<p class="muted small">Playlist trop longue pour un QR code : utilisez le lien.</p>'}
    <input id="sh-link" readonly value="${esc(link)}" />
    <div class="modal-actions"><button class="btn ghost" id="sh-close">Fermer</button>${navigator.share ? '<button class="btn ghost" id="sh-native">Partager…</button>' : ''}<button class="btn" id="sh-copy">Copier le lien</button></div>`);
  $('#sh-close', c).onclick = closeModal;
  $('#sh-copy', c).onclick = () => copyText(link, 'Lien copié');
  $('#sh-link', c).onclick = (e) => e.target.select();
  const nat = $('#sh-native', c);
  if (nat) nat.onclick = () => navigator.share({ title: `Playlist ${p.name}`, text: `Ma playlist « ${p.name} » sur Enora`, url: link }).catch(() => {});
}

async function addSharedPlaylist(input) {
  const d = await decodePlaylist(input);
  if (!d.tracks.length) throw new Error('Cette playlist est vide.');
  const p = { id: uid(), name: d.name, tracks: d.tracks.map(storableTrack), createdAt: Date.now() };
  await savePlaylist(p);
  state.playlists.push(p);
  return p;
}

const looksLikeShare = (t) => /[#&?]pl=[zj][A-Za-z0-9_-]+/.test(t) || /^[zj][A-Za-z0-9_-]{24,}$/.test(t.trim());

function openImportModal(prefill = '') {
  const c = modal(`<h3>Importer une playlist</h3>
    <p class="muted">Collez un <b>lien de partage Enora</b>, ou une <b>liste de titres</b> (un par ligne, « Artiste - Titre »). Vous pouvez aussi choisir un fichier texte ou CSV exporté d'un autre service : Enora retrouve chaque titre.</p>
    <textarea id="imp-text" rows="7" placeholder="Fally Ipupa - Eloko Oyo&#10;Charlotte Dipanda - Coucou&#10;…">${esc(prefill)}</textarea>
    <input id="imp-name" placeholder="Nom de la playlist (pour une liste de titres)" />
    <div id="imp-prog" class="muted small" style="min-height:18px;margin-top:8px"></div>
    <div class="modal-actions"><button class="btn ghost" id="imp-file">Choisir un fichier</button><button class="btn ghost" id="imp-cancel">Annuler</button><button class="btn" id="imp-go">Importer</button></div>`);
  let cancelled = false;
  const close = () => { cancelled = true; closeModal(); };
  $('#imp-cancel', c).onclick = close;
  const fi = $('#list-input');
  $('#imp-file', c).onclick = () => fi.click();
  fi.onchange = async () => {
    const f = fi.files[0]; fi.value = '';
    if (!f) return;
    $('#imp-text', c).value = await f.text();
    if (!$('#imp-name', c).value) $('#imp-name', c).value = f.name.replace(/\.[^.]+$/, '');
  };
  $('#imp-go', c).onclick = async () => {
    const raw = $('#imp-text', c).value.trim();
    const prog = $('#imp-prog', c);
    if (!raw) { prog.textContent = 'Collez un lien ou une liste de titres.'; return; }
    const btn = $('#imp-go', c);
    btn.disabled = true;
    try {
      if (looksLikeShare(raw)) {
        const p = await addSharedPlaylist(raw);
        closeModal(); toast(`Playlist « ${p.name} » ajoutée (${p.tracks.length} titres)`, 4000);
        libTab = 'playlists'; go('library');
        return;
      }
      const wanted = parseTrackList(raw);
      if (!wanted.length) throw new Error('Aucun titre reconnu dans cette liste.');
      const max = platform === 'web' ? 30 : 200; // version web : chaque recherche consomme le quota de la clé YouTube
      const list = wanted.slice(0, max);
      const found = [];
      const seen = new Set();
      let missed = 0;
      for (let i = 0; i < list.length && !cancelled; i++) {
        prog.textContent = `Recherche ${i + 1} / ${list.length} : ${list[i].artist ? list[i].artist + ' - ' : ''}${list[i].title}`;
        try {
          const t = await ytFindOne(`${list[i].artist} ${list[i].title}`.trim());
          if (t && !seen.has(t.key)) { seen.add(t.key); found.push(t); } else if (!t) missed++;
        } catch (e) { missed++; if (i === 0 && /clé API/.test(e.message)) throw e; }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (cancelled) return;
      if (!found.length) throw new Error('Aucun titre n\'a été retrouvé.');
      const p = { id: uid(), name: $('#imp-name', c).value.trim() || 'Playlist importée', tracks: found.map(storableTrack), createdAt: Date.now() };
      await savePlaylist(p);
      state.playlists.push(p);
      closeModal();
      toast(`Playlist « ${p.name} » créée : ${found.length} titre(s)${missed ? `, ${missed} introuvable(s)` : ''}${wanted.length > max ? ` (limité à ${max})` : ''}`, 6000);
      libTab = 'playlists'; go('library');
    } catch (e) { prog.textContent = e.message || String(e); btn.disabled = false; }
  };
}

/** Lien de partage ouvert dans la version web : …/#pl=CODE */
async function importFromHash() {
  const m = location.hash.match(/[#&]pl=([zj][A-Za-z0-9_-]+)/);
  if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  try {
    const d = await decodePlaylist(m[1]);
    if (!(await confirmBox(`Ajouter la playlist partagée « ${d.name} » (${d.tracks.length} titres) ?`, 'Ajouter'))) return;
    const p = await addSharedPlaylist(m[1]);
    toast(`Playlist « ${p.name} » ajoutée`);
    go('playlist', { id: p.id, tab: 'library' });
  } catch (e) { toast(e.message || 'Lien de playlist invalide', 4000); }
}

/* =========================================================================
   Rétrospective : bilan d'écoute en image
   ========================================================================= */
function openRecap(period = 'month') {
  const r = recap(period);
  const canvas = drawRecap(r, tr);
  const c = modal(`<h3>Ma rétrospective</h3>
    <div class="seg" style="margin-bottom:12px">${[['month', 'Ce mois-ci'], ['year', 'Cette année'], ['all', 'Depuis le début']].map(([k, l]) => `<button data-rp="${k}" class="${k === period ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="recap-wrap" id="recap-wrap"></div>
    ${r.listens ? '' : '<p class="muted small">Pas encore d\'écoute sur cette période.</p>'}
    <div class="modal-actions"><button class="btn ghost" id="rc-close">Fermer</button>${navigator.canShare ? '<button class="btn ghost" id="rc-share">Partager…</button>' : ''}<button class="btn" id="rc-save">Enregistrer l'image</button></div>`);
  c.classList.add('recap-card');
  $('#recap-wrap', c).appendChild(canvas);
  c.querySelectorAll('[data-rp]').forEach((b) => (b.onclick = () => openRecap(b.dataset.rp)));
  const done = () => { c.classList.remove('recap-card'); closeModal(); };
  $('#rc-close', c).onclick = done;
  const blob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
  const name = `Enora-retrospective-${period}.png`;
  $('#rc-save', c).onclick = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await blob()); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Image enregistrée');
  };
  const sh = $('#rc-share', c);
  if (sh) sh.onclick = async () => {
    const file = new File([await blob()], name, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'Ma rétrospective Enora' }).catch(() => {}); else $('#rc-save', c).click();
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
  WW: ['Pop', 'Hip-hop', 'Afrobeats', 'Latino', 'Reggaeton', 'K-pop', 'R&B', 'Électro', 'Amapiano', 'Rock', 'Gospel'],
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
  KM: ['Twarab', 'Musique comorienne', 'M\'godro', 'Rap comorien', 'Afrobeats', 'Gospel'],
  TG: ['Musique togolaise', 'Rap togolais', 'Afrobeats', 'Agbadja', 'Gospel togolais', 'Coupé-décalé'],
};
const YT_MUSIC_CHIPS = STYLES_BY_COUNTRY.FR;

// Musique organisée par style : catégories puis sous-catégories
const MUSIC_CATEGORIES = [
  ['Afro', ['Afrobeats', 'Amapiano', 'Makossa', 'Bikutsi', 'Coupé-décalé', 'Zouglou', 'Ndombolo', 'Rumba congolaise', 'Mbalax', 'Afro pop', 'Highlife']],
  ['Rap & Hip-hop', ['Rap français', 'Rap africain', 'Afro trap', 'Drill', 'Trap', 'Rap US', 'Rap belge', 'Rap québécois']],
  ['Pop & Variété', ['Pop française', 'Variété française', 'Pop internationale', 'K-pop', 'Chanson française']],
  ['R&B & Soul', ['R&B', 'R&B français', 'Soul', 'Neo soul', 'Afro R&B']],
  ['Caraïbes', ['Zouk', 'Kompa', 'Dancehall', 'Reggae', 'Shatta', 'Soca']],
  ['Latino', ['Reggaeton', 'Salsa', 'Bachata', 'Latin pop']],
  ['Électro', ['Afro house', 'House', 'Techno', 'EDM', 'Lo-fi']],
  ['Gospel', ['Gospel africain', 'Gospel francophone', 'Louange et adoration', 'Gospel US']],
  ['Musiques du monde', ['Raï', 'Chaabi', 'Gnaoua', 'Twarab', 'Musique mandingue', 'Musique arabe', 'Musique indienne']],
  ['Jazz, Blues & Classique', ['Jazz', 'Blues', 'Musique classique', 'Piano', 'Musique de film']],
  ['Rock & Métal', ['Rock', 'Rock français', 'Métal', 'Indie']],
];
const subsOf = (cat) => (MUSIC_CATEGORIES.find((c) => c[0] === cat) || [null, []])[1];
const stylesFor = (region) => STYLES_BY_COUNTRY[region] || STYLES_BY_COUNTRY.FR;

const YT_REGIONS = [['WW', 'Monde'], ['FR', 'France'], ['CI', "Côte d'Ivoire"], ['SN', 'Sénégal'], ['CM', 'Cameroun'], ['CD', 'RD Congo'], ['BE', 'Belgique'], ['CA', 'Canada'], ['MA', 'Maroc'], ['ML', 'Mali'], ['NG', 'Nigeria'], ['HT', 'Haïti'], ['KM', 'Comores'], ['TG', 'Togo'], ['US', 'États-Unis'], ['GB', 'Royaume-Uni']];


/** Onglet Musique : YouTube (titres récents, streaming) + Musique libre (albums téléchargeables) réunis. */
async function viewMusic(_p, seq) {
  const s = cache.music || (cache.music = {});
  const y = s.yt || (s.yt = { mode: 'trend', region: 'WW', cat: '', genre: '', term: '', items: null, error: null });
  y.region = 'WW'; // la musique est organisée par style, plus par pays
  const a = getAudioOnly();
  const title = { foryou: 'Pour vous', trend: 'Tendances', new: 'Nouveautés', cat: y.cat, genre: y.genre, search: `Résultats pour « ${y.term} »` }[y.mode];
  const subs = subsOf(y.cat);
  view.innerHTML = `<h1>Musique</h1>
    <p class="sub">Les titres récents et populaires, par style musical, lus directement dans Enora sans publicité.</p>
    <form class="searchbar" id="ysf">
      <input id="ysq" placeholder="Titre, artiste… (ajoutez -mot pour exclure)" value="${esc(y.raw || (y.mode === 'search' ? y.term : ''))}" />
      <button class="btn">Rechercher</button></form>
    <div class="seg"><button data-mode="video" class="${a ? '' : 'active'}">${ic('video', 'Vidéo')}</button><button data-mode="audio" class="${a ? 'active' : ''}">${ic('headphones', 'Audio seul')}</button></div>
    <div class="chips catchips">
      <button class="chip ${y.mode === 'foryou' ? 'active' : ''}" data-ym="foryou">${ic('sparkle', 'Pour vous')}</button>
      <button class="chip ${y.mode === 'trend' ? 'active' : ''}" data-ym="trend">Tendances</button>
      <button class="chip ${y.mode === 'new' ? 'active' : ''}" data-ym="new">Nouveautés</button>
      ${MUSIC_CATEGORIES.map(([c]) => `<button class="chip ${y.cat === c && (y.mode === 'cat' || y.mode === 'genre') ? 'active' : ''}" data-yc="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    ${subs.length && (y.mode === 'cat' || y.mode === 'genre') ? `<div class="chips subchips">
      <button class="chip ${y.mode === 'cat' ? 'active' : ''}" data-yc="${esc(y.cat)}">Tout ${esc(y.cat)}</button>
      ${subs.map((g) => `<button class="chip ${y.mode === 'genre' && y.genre === g ? 'active' : ''}" data-yg="${esc(g)}">${esc(g)}</button>`).join('')}
    </div>` : ''}
    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${esc(title)}
      <button class="btn" id="yt-playall" style="font-size:14px" disabled>${ic('play', 'Tout lire')}</button><button class="btn ghost" id="yt-shuffle" style="font-size:14px" disabled>${ic('shuffle', 'Aléatoire')}</button></h2>
    <div id="res">${y.items ? '' : loadingHtml()}</div>
`;

  const reload = () => { y.items = null; y.page = 0; render(true); };
  view.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
    if (b.dataset.mode === 'video' && dataSaverActive()) { toast('Économie de données active : audio seul (Réglages → Lecture)', 4000); return; }
    setAudioOnly(b.dataset.mode === 'audio'); updateNowPlaying(); render(true);
  }));
  view.querySelectorAll('[data-ym]').forEach((b) => (b.onclick = () => { y.mode = b.dataset.ym; reload(); }));
  view.querySelectorAll('[data-yc]').forEach((b) => (b.onclick = () => { y.mode = 'cat'; y.cat = b.dataset.yc; reload(); }));
  view.querySelectorAll('[data-yg]').forEach((b) => (b.onclick = () => { y.mode = 'genre'; y.genre = b.dataset.yg; reload(); }));
  $('#ysf').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#ysq').value.trim();
    const pq = parseQuery(q);
    y.exclude = pq.exclude;
    if (pq.query) { y.mode = 'search'; y.term = pq.query; y.raw = q; } else if (y.mode === 'search' || pq.exclude.length) { if (!pq.exclude.length) y.mode = 'trend'; }
    reload();
  };

  // Les deux sources sont chargées en parallèle ; chacune s'affiche dès qu'elle est prête.
  const loadYt = y.items ? Promise.resolve(y.items) : (
    y.mode === 'foryou' ? forYou()
      : y.mode === 'trend' ? ytTrending(y.region)
      : y.mode === 'new' ? ytNewReleases(y.region)
      : y.mode === 'genre' ? ytStyle('WW', y.genre)
      : y.mode === 'cat' ? ytCategory(y.cat, subsOf(y.cat))
      : ytSearch(y.term, y.region));

  const showYt = (all) => {
    const res = $('#res');
    if (!res) return;
    const items = filterResults(all, y.exclude || []);
    refreshMusicList = () => showYt(all);
    const styleNow = y.mode === 'genre' ? y.genre : y.mode === 'cat' ? y.cat : '';
    if (styleNow) for (const t of all) t.style = styleNow; // sert aux suggestions et à la radio d'un titre
    if (!items.length) {
      res.innerHTML = y.mode === 'foryou'
        ? `<div class="empty"><div class="big">${I.sparkle}</div>Écoutez quelques titres : vos suggestions apparaîtront ici.<br>Elles sont calculées sur cet appareil, à partir de votre historique et de vos favoris.</div>`
        : '<div class="empty">Aucun titre trouvé pour le moment. Réessayez dans quelques minutes ou choisissez un style.</div>';
      return;
    }
    // Classement en pages de 20 titres, numérotées
    const PER = 20;
    const pages = Math.max(1, Math.ceil(items.length / PER));
    y.page = Math.min(Math.max(0, y.page || 0), pages - 1);
    const start = y.page * PER;
    const shown = items.slice(start, start + PER);
    rowTracks = [];
    const pager = pages > 1 ? `<nav class="pager" aria-label="Pages de résultats">
        <button class="pg" data-pg="${y.page - 1}" ${y.page === 0 ? 'disabled' : ''} title="Page précédente">${I.chevronLeft}</button>
        ${Array.from({ length: pages }, (_, i) => `<button class="pg ${i === y.page ? 'on' : ''}" data-pg="${i}">${i + 1}</button>`).join('')}
        <button class="pg" data-pg="${y.page + 1}" ${y.page === pages - 1 ? 'disabled' : ''} title="Page suivante">${I.chevronRight}</button>
        <span class="pg-info">${start + 1}–${start + shown.length} sur ${items.length}</span></nav>` : '';
    res.innerHTML = trackRows(shown, { ranked: true, hideable: true, rankStart: start }) + pager;
    res.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => {
      y.page = +b.dataset.pg;
      showYt(all);
      $('h2', view)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
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
  view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Retour</span></button>${loadingHtml()}`;
  $('#back').onclick = () => go(from === 'library' ? 'library' : 'music');
  try {
    const a = await iaAlbum(id);
    if (stale(seq)) return;
    const favData = { id: a.id, title: a.title, creator: a.artist, cover: a.cover };
    view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Retour</span></button>
      <div class="detail"><div class="dc" style="background-image:url('${esc(a.cover)}')"></div>
        <div class="di"><div class="muted small">ALBUM</div><h1>${esc(a.title)}</h1><div class="muted">${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''} · ${a.tracks.length} titre(s)</div>
          <div class="actions">
            <button class="btn" id="a-play" ${a.tracks.length ? '' : 'disabled'}>▶ Lire</button>
            <button class="btn ghost" id="a-dl" ${a.tracks.length ? '' : 'disabled'}>${ic('download', 'Tout télécharger')}</button>
            <button class="btn ghost" id="a-fav">${isFav('album:' + a.id) ? ic('heartFill', 'Favori') : ic('heart', 'Favori')}</button>
          </div>
          ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}</div></div>
      ${a.tracks.length ? trackRows(a.tracks, { numbered: true }) : '<div class="empty">Aucune piste MP3 dans cet album.</div>'}`;
    $('#back').onclick = () => go(from === 'library' ? 'library' : 'music');
    $('#a-play').onclick = () => player.playList(a.tracks);
    $('#a-dl').onclick = async () => { for (const t of a.tracks) await downloadTrack(t); };
    $('#a-fav').onclick = async () => { await toggleFav('album', 'album:' + a.id, favData); render(true); };
  } catch (e) {
    if (stale(seq)) return;
    view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Retour</span></button>${errorHtml(e)}`;
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
  view.innerHTML = `<h1>Films, séries et TV en direct</h1>
    <p class="sub">Vos sites de films, de séries et de TV en direct, ouverts dans Enora avec le bloqueur de publicités et de pop-ups, et des films classiques gratuits.</p>
    <h2>Mes sites : films, séries et TV en direct</h2>
    ${sitesSectionHtml()}
    <h2>Films classiques <span class="badge ok">GRATUITS · TÉLÉCHARGEABLES</span></h2>
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
  view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Retour</span></button>${loadingHtml()}`;
  $('#back').onclick = () => go(from === 'library' ? 'library' : 'films');
  try {
    const f = await iaFilm(id);
    if (stale(seq)) return;
    const t = f.track;
    const offline = t && isOffline(t);
    view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Retour</span></button>
      <div class="detail film"><div class="dc" style="background-image:url('${esc(f.cover)}')"></div>
        <div class="di"><div class="muted small">FILM</div><h1>${esc(f.title)}</h1>
          <div class="muted">${[f.year, f.creator, f.runtime].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="actions">
            <button class="btn" id="f-play" ${t ? '' : 'disabled'}>▶ Regarder</button>
            ${t ? `<button class="btn ghost" id="f-dl" ${offline ? 'disabled' : ''}>${offline ? ic('check', 'Hors ligne') : ic('download', 'Télécharger' + (t.size ? ' (' + fmtSize(t.size) + ')' : ''))}</button>` : ''}
            <button class="btn ghost" id="f-fav">${isFav('film:' + f.id) ? ic('heartFill', 'Favori') : ic('heart', 'Favori')}</button>
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
    view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Retour</span></button>${errorHtml(e)}`;
    $('#back').onclick = () => go('films');
  }
}

/* =========================================================================
   Vue : Radio
   ========================================================================= */
const COUNTRIES = [['', 'Monde'], ['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['CA', 'Canada'], ['CI', "Côte d'Ivoire"], ['SN', 'Sénégal'], ['CM', 'Cameroun'],
  ['CD', 'RD Congo'], ['ML', 'Mali'], ['BF', 'Burkina Faso'], ['MA', 'Maroc'], ['DZ', 'Algérie'], ['TN', 'Tunisie'], ['HT', 'Haïti'], ['US', 'États-Unis'], ['GB', 'Royaume-Uni'], ['NG', 'Nigeria'], ['JM', 'Jamaïque']];
const RADIO_TAGS = [['', 'Tout'], ['pop', 'Pop'], ['hip hop', 'Hip-hop'], ['afrobeats', 'Afrobeats'], ['jazz', 'Jazz'], ['classical', 'Classique'], ['rock', 'Rock'], ['electronic', 'Électro'], ['news', 'Info'], ['zouk', 'Zouk'], ['reggae', 'Reggae']];

/** Suggestions personnelles : calculées sur l'appareil (historique, statistiques, favoris), sans serveur. */
function forYou() {
  const t = tastes();
  const favArtists = [...state.favs.values()].filter((f) => f.type === 'track' && f.data?.kind !== 'video').map((f) => f.data?.artist).filter((a) => a && !/^(youtube|inconnu|artiste inconnu|vidéo locale|fichier local)$/i.test(a));
  const artists = [...new Set([...t.artists, ...favArtists])].slice(0, 6);
  return ytForYou(artists, t.styles);
}

/** Radio d'un titre : la file d'attente est remplie de titres proches, sans couper la lecture en cours. */
let radioBusy = false;
async function startRadio(track, { auto = false } = {}) {
  if (!track || track.live || track.origin === 'podcast' || track.kind === 'video' || radioBusy) return;
  radioBusy = true;
  if (!auto) toast('Création de la radio…', 0);
  try {
    const list = await ytRadio(track, track.style || '');
    if (!list.length) { if (!auto) toast('Aucun titre proche trouvé pour le moment.'); return; }
    if (player.current?.key === track.key && !auto) {
      player.queue = [player.current, ...list];
      player.index = 0;
      player.emit('change');
      toast(`Radio lancée : ${list.length} titres à suivre`);
    } else {
      if (ytDirect(list, 0)) return;
      await player.playList(auto ? list : [track, ...list], 0);
      if (!auto) toast(`Radio lancée : ${list.length} titres à suivre`);
    }
  } catch (e) { if (!auto) toast('Radio indisponible : ' + (e.message || e)); } finally { radioBusy = false; }
}

let radioTab = 'radio';
const radioSeg = () => `<div class="seg"><button data-rt="radio" class="${radioTab === 'radio' ? 'active' : ''}">Radios</button><button data-rt="podcasts" class="${radioTab === 'podcasts' ? 'active' : ''}">Podcasts</button></div>`;
const bindRadioSeg = () => view.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => { radioTab = b.dataset.rt; render(); }));

let podCards = [];
function podCard(p) {
  podCards.push(p);
  return `<div class="card" data-pod="${podCards.length - 1}">
    <div class="thumb"><img src="${esc(p.cover)}" loading="lazy" alt="" onerror="this.src='${FALLBACK_AUDIO}'"></div>
    <div class="t ellipsis">${esc(p.title)}</div><div class="a ellipsis">${esc(p.author || 'Podcast')}</div></div>`;
}
const bindPodCards = () => view.querySelectorAll('[data-pod]').forEach((c) => (c.onclick = () => go('podcast', { pod: podCards[+c.dataset.pod], tab: 'radio' })));

async function viewPodcasts(seq) {
  const s = cache.pod || (cache.pod = { term: '', items: null });
  const subs = getSubscriptions();
  podCards = [];
  view.innerHTML = `<h1>Radio</h1><p class="sub">Des milliers de podcasts, avec reprise là où vous vous étiez arrêté.</p>${radioSeg()}
    <form class="searchbar" id="pf"><input id="pq" placeholder="Nom du podcast, sujet…" value="${esc(s.term)}" /><button class="btn">Rechercher</button></form>
    ${subs.length ? `<h2>Mes abonnements</h2><div class="grid">${subs.map(podCard).join('')}</div>` : ''}
    <h2>${s.term ? `Résultats pour « ${esc(s.term)} »` : 'Les plus écoutés'}</h2>
    <div id="res">${s.items ? '' : loadingHtml()}</div>`;
  bindRadioSeg();
  $('#pf').onsubmit = (e) => { e.preventDefault(); s.term = $('#pq').value.trim(); s.items = null; render(); };
  bindPodCards();
  try {
    if (!s.items) {
      const items = s.term ? await podcastSearch(s.term) : await podcastTop();
      if (stale(seq)) return;
      s.items = items;
    }
    $('#res').innerHTML = s.items.length ? `<div class="grid">${s.items.map(podCard).join('')}</div>` : '<div class="empty">Aucun podcast trouvé.</div>';
    bindPodCards();
  } catch (e) {
    if (stale(seq)) return;
    s.items = null;
    $('#res').innerHTML = errorHtml(e);
  }
}

async function viewPodcast({ pod }, seq) {
  if (!pod) { radioTab = 'podcasts'; return go('radio'); }
  view.innerHTML = `<button class="back" id="back">${I.chevronLeft}<span>Podcasts</span></button>
    <div class="detail"><div class="dc"><img src="${esc(pod.cover)}" alt="" onerror="this.src='${FALLBACK_AUDIO}'"></div>
      <div class="di"><div class="muted small">PODCAST</div><h1>${esc(pod.title)}</h1><div class="muted">${esc(pod.author || '')}</div>
        <div class="actions"><button class="btn" id="pod-play" disabled>${ic('play', 'Dernier épisode')}</button><button class="btn ghost" id="pod-sub" disabled>S'abonner</button></div></div></div>
    <div id="res">${loadingHtml()}</div>`;
  $('#back').onclick = () => { radioTab = 'podcasts'; go('radio'); };
  try {
    if (!pod.feed) { const full = await podcastLookup(pod.id); if (!full?.feed) throw new Error('Flux du podcast introuvable'); Object.assign(pod, { feed: full.feed, cover: pod.cover || full.cover }); }
    const cached = cache.feeds?.[pod.feed];
    const f = cached || await podcastFeed(pod.feed);
    (cache.feeds || (cache.feeds = {}))[pod.feed] = f;
    if (stale(seq)) return;
    const eps = f.episodes.map((e) => {
      const pos = getPosition(e.key);
      const date = e.date ? new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      return hydrate({ ...e, cover: e.cover || pod.cover, sub: [date, pos > 10 ? `reprise à ${fmtTime(pos)}` : ''].filter(Boolean).join(' · ') });
    });
    rowTracks = [];
    $('#res').innerHTML = `${f.description ? `<p class="muted pod-desc">${esc(f.description)}</p>` : ''}<h2>${eps.length} épisode(s)</h2>${eps.length ? trackRows(eps) : '<div class="empty">Aucun épisode.</div>'}`;
    const sub = $('#pod-sub');
    const paint = () => { const on = isSubscribed(pod.feed); sub.textContent = on ? 'Abonné' : 'S\'abonner'; sub.classList.toggle('on', on); };
    sub.disabled = false; paint();
    sub.onclick = () => { const on = toggleSubscription({ ...pod, title: pod.title || f.title, cover: pod.cover || f.cover }); markSettingsChanged(); cloud.touch(); paint(); toast(on ? 'Abonnement ajouté' : 'Abonnement retiré'); };
    const pl = $('#pod-play');
    pl.disabled = !eps.length;
    pl.onclick = () => player.playList([eps[0]], 0);
  } catch (e) {
    if (stale(seq)) return;
    $('#res').innerHTML = `<div class="error">Impossible de lire ce podcast pour le moment.${platform === 'web' ? ' Certains podcasts ne sont lisibles que dans l\'application (ordinateur ou téléphone).' : ''}<br><span class="small">(${esc(e.message || e)})</span></div>`;
  }
}

async function viewRadio(_p, seq) {
  if (radioTab === 'podcasts') return viewPodcasts(seq);
  const s = cache.radio || (cache.radio = { name: '', country: 'FR', tag: '', items: null });
  view.innerHTML = `<h1>Radio</h1><p class="sub">Plus de 40 000 radios du monde entier, en direct.</p>${radioSeg()}
    <form class="searchbar" id="sf">
      <input id="sq" placeholder="Nom de la radio…" value="${esc(s.name)}" />
      <select id="sc">${COUNTRIES.map(([c, l]) => `<option value="${c}" ${s.country === c ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn">Rechercher</button></form>
    <div class="chips">${RADIO_TAGS.map(([t, l]) => `<button class="chip ${s.tag === t ? 'active' : ''}" data-t="${t}">${l}</button>`).join('')}</div>
    <div id="res">${s.items ? '' : loadingHtml()}</div>`;
  bindRadioSeg();
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
const storedAudioOnly = () => { try { return localStorage.getItem(YT_AUDIO_KEY) === '1'; } catch (_) { return false; } };
// En économie de données (réseau mobile), le clip n'est pas affiché : le lecteur reste petit, donc en basse qualité
const getAudioOnly = () => dataSaverActive() || storedAudioOnly();
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
      <button class="icon-btn" id="yt-back" title="Retour">${I.chevronLeft}</button>
      <button class="icon-btn" id="yt-fwd" title="Suivant">→</button>
      <button class="icon-btn" id="yt-reload" title="Recharger">⟳</button>
      <div class="seg" style="margin:0"><button id="yt-site-yt">YouTube</button><button id="yt-site-ytm">YT Music</button></div>
      <form id="yt-form" style="flex:1;display:flex"><input id="yt-q" placeholder="Rechercher…" /></form>
      <button class="pill" id="yt-audio" title="Masquer la vidéo et garder le son">Audio seul</button>
      <span class="yt-shield">${I.shield}<span>Sans publicité</span></span>
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
    $('#yt-audio').textContent = a ? 'Audio seul' : 'Vidéo';
    $('#yt-audio').classList.toggle('on', a);
  };
  const applyAudio = () => { try { wv.executeJavaScript(audioOnlyScript(getAudioOnly())).catch(() => {}); } catch (_) {} };

  $('#yt-back').onclick = () => { try { if (wv.canGoBack()) wv.goBack(); } catch (_) {} };
  $('#yt-fwd').onclick = () => { try { if (wv.canGoForward()) wv.goForward(); } catch (_) {} };
  $('#yt-reload').onclick = () => { try { wv.reload(); } catch (_) {} };
  $('#yt-site-yt').onclick = () => wv.loadURL(YT_HOME).catch(() => {});
  $('#yt-site-ytm').onclick = () => wv.loadURL(YTM_HOME).catch(() => {});
  $('#yt-audio').onclick = () => { setAudioOnly(!getAudioOnly()); applyAudio(); syncUi(); toast(getAudioOnly() ? 'Audio seul : la vidéo est masquée' : 'Vidéo affichée'); };
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
      <div class="big">${I.youtube}</div><h1>YouTube sans pub</h1>
      <p class="sub">Regardez YouTube avec le bloqueur de publicités intégré à Enora.</p>
      <form class="searchbar" id="yt-form"><input id="yt-q" placeholder="Rechercher une vidéo, un clip…" /><button class="btn">Rechercher</button></form>
      <div class="seg"><button data-mode="video" class="${a ? '' : 'active'}">${ic('video', 'Vidéo')}</button><button data-mode="audio" class="${a ? 'active' : ''}">${ic('headphones', 'Audio seul')}</button></div>
      <button class="btn ghost" id="yt-open" style="width:100%">Ouvrir YouTube</button>
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
/** Sites préconfigurés par la publication (GitHub : SONORA_SITES). Toujours affichés, non modifiables. */
function builtInSites() {
  const mine = new Set(loadSites().map((x) => hostOf(x.url)));
  return (BUILD.sites || []).map((x, i) => ({ id: `builtin-${i}`, name: x.name, url: x.url, builtIn: true })).filter((x) => !mine.has(hostOf(x.url)));
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
        <button class="icon-btn" id="w-sites" title="Mes sites">${I.list}</button>
        <button class="icon-btn" id="w-back" title="Retour">${I.chevronLeft}</button>
        <button class="icon-btn" id="w-fwd" title="Suivant">→</button>
        <button class="icon-btn" id="w-reload" title="Recharger">⟳</button>
        <form id="w-form" style="flex:1;display:flex"><input id="w-addr" placeholder="Adresse du site" /></form>
        <button class="icon-btn" id="w-save" title="Ajouter à mes sites">${I.star}</button>
        <span class="yt-shield">${I.shield}<span>Publicités et pop-ups bloquées</span></span>
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
      toast('Ajouté à vos sites');
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
  const sites = [...builtInSites(), ...loadSites()];
  return `
    <form class="searchbar" id="web-go"><input id="web-url" placeholder="Coller un lien : https://…" /><button class="btn">Ouvrir</button></form>
    <button class="btn ghost" id="web-add" style="margin-bottom:16px">${ic('plus', 'Ajouter un site')}</button>
    ${sites.length ? `<div class="list">${sites.map((st) => `
      <div class="row">
        <div class="rc"><img src="https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostOf(st.url))}" alt="" onerror="this.remove()"></div>
        <div class="ri" data-site="${esc(st.id)}"><div class="rt ellipsis">${esc(st.name)}${st.builtIn ? '<span class="badge">SONORA</span>' : ''}</div><div class="ra ellipsis">${esc(st.url)}</div></div>
        <div class="acts">
          <button class="icon-btn" data-site-open="${esc(st.id)}" title="Ouvrir">▶</button>
          ${st.builtIn ? '' : `<button class="icon-btn" data-site-edit="${esc(st.id)}" title="Modifier">${I.edit}</button>
          <button class="icon-btn" data-site-del="${esc(st.id)}" title="Supprimer">${I.trash}</button>`}
        </div>
      </div>`).join('')}</div>` : `<div class="empty"><div class="big">${I.globe}</div>Aucun site. Ajoutez un lien avec « Ajouter un site ».</div>`}
`;
}

function bindSites() {
  const byId = (id) => [...builtInSites(), ...loadSites()].find((x) => x.id === id);
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
  return { updatedAt: settingsChangedAt(), values: { settings: getSettings(), audioOnly: storedAudioOnly(), ytKey: getUserYtApiKey(), hidden: getHidden(), podcasts: getSubscriptions(), stats: statsData() } };
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
        if (v.hidden && typeof v.hidden === 'object') localStorage.setItem(HIDDEN_KEY, JSON.stringify(v.hidden));
        if (Array.isArray(v.podcasts)) setSubscriptions(v.podcasts);
        if (v.stats && typeof v.stats === 'object' && !Object.keys(statsData()).length) setStatsData(v.stats);
        applyEffects();
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
    return `<div class="set-block"><h3>Compte et synchronisation</h3>
      <p class="muted">Bientôt : un compte Enora pour retrouver vos favoris, playlists, sites et réglages sur l'ordinateur, Android et l'iPhone.</p>
      <p class="muted small">Le compte n'est pas encore activé dans cette version.</p></div>`;
  }
  const sess = cloud.getSession();
  if (!sess) {
    return `<div class="set-block"><h3>Compte et synchronisation</h3>
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
  return `<div class="set-block"><h3>Compte et synchronisation</h3>
    <p class="muted">Connecté : <b style="color:var(--text)">${esc(sess.email)}</b><br>Dernière synchronisation : ${fmtDate(cloud.lastSync())}</p>
    <p class="muted small">Synchronisés : favoris, playlists, sites de streaming et réglages. Les fichiers hors-ligne restent sur chaque appareil.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="ac-sync">${ic('sync', 'Synchroniser maintenant')}</button>
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
  if (login) login.onclick = () => run(login, () => cloud.signIn(val('ac-email'), $('#ac-pass').value), 'Connecté : vos données sont synchronisées');
  const signup = $('#ac-signup');
  if (signup) signup.onclick = () => run(signup, () => cloud.signUp(val('ac-email'), $('#ac-pass').value), 'Compte créé et synchronisé');
  const reset = $('#ac-reset');
  if (reset) reset.onclick = () => {
    if (!val('ac-email')) { toast('Entrez votre adresse e-mail'); return; }
    run(reset, () => cloud.resetPassword(val('ac-email')), 'E-mail de réinitialisation envoyé');
  };
  const sync = $('#ac-sync');
  if (sync) sync.onclick = () => run(sync, () => cloud.syncNow(), 'Synchronisé');
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
    ? `<span>Une nouvelle version d'Enora est disponible.</span><button class="btn" id="up-go">Recharger</button><button class="icon-btn" id="up-x" title="Plus tard">${I.close}</button>`
    : u.ready
    ? `<span>Enora ${esc(u.version)} est prête.</span><button class="btn" id="up-go">Redémarrer et installer</button><button class="icon-btn" id="up-x" title="Plus tard">${I.close}</button>`
    : u.downloading
      ? `<span>Téléchargement d'Enora ${esc(u.version)}…</span><button class="icon-btn" id="up-x" title="Masquer">${I.close}</button>`
      : `<span>Nouvelle version : Enora ${esc(u.version)}</span><button class="btn" id="up-go">Mettre à jour</button><button class="icon-btn" id="up-x" title="Plus tard">${I.close}</button>`;
  const go = $('#up-go', bar);
  if (go) go.onclick = () => {
    if (u.ready) { window.sonora.installUpdate(); return; }
    if (u.web) { u.worker?.postMessage('skipWaiting'); return; }
    window.open(u.url, '_blank');
    toast(platform === 'android' ? 'Ouvrez le fichier téléchargé pour installer la mise à jour.' : platform === 'ios' ? 'Téléchargez Enora.ipa puis réinstallez-le avec Sideloadly.' : 'Téléchargement de la nouvelle version…', 6000);
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
    : !BUILD.repo ? 'Mises à jour : publiez Enora sur GitHub pour les activer (voir README).'
      : platform === 'electron' ? 'Les nouvelles versions publiées sur GitHub sont téléchargées et installées automatiquement (version installée).'
        : 'Enora vérifie GitHub et vous propose les nouvelles versions.';
  return `<div class="set-block"><h3>Version et mises à jour</h3>
    <p class="muted">Enora ${esc(currentVersion())} · ${esc(where)}</p>
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
        if (r.auto) { toast(r.version && r.version !== currentVersion() ? `Téléchargement de la version ${r.version}…` : 'Enora est à jour'); return; }
      }
      const u = await checkForUpdate({ force: true });
      if (u) { pendingUpdate = u; updateBanner(); } else toast('Enora est à jour');
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
  view.innerHTML = `${isMobile ? '<button class="back" id="back">${I.chevronLeft}<span>Bibliothèque</span></button>' : ''}<h1>Réglages</h1><p class="sub">Les réglages sont enregistrés sur cet appareil et synchronisés avec votre compte.</p>
    ${accountBlockHtml()}

    <div class="set-block"><h3>Apparence et langue</h3>
      <div class="set-row">Thème</div>
      ${opts('theme', [['auto', 'Automatique', 'Suit le réglage de l\'appareil'], ['dark', 'Sombre', ''], ['light', 'Clair', '']])}
      <div class="set-row">Langue</div>
      ${opts('lang', [['auto', 'Automatique', 'Langue de l\'appareil'], ['fr', 'Français', ''], ['en', 'English', '']])}
    </div>

    <div class="set-block"><h3>Lecture</h3>
      <div class="set-row">Lecture continue</div>
      ${opts('autoRadio', [['on', 'Activée', 'À la fin d\'une liste, des titres proches s\'enchaînent'], ['off', 'Désactivée', 'La lecture s\'arrête à la fin de la liste']])}
      <div class="set-row">Paroles automatiques</div>
      ${opts('autoLyrics', [['on', 'Activées', 'Affichées et synchronisées quand elles existent (LRCLIB)'], ['off', 'Désactivées', 'Seulement vos fichiers .lrc']])}
      <div class="set-row">Économie de données</div>
      ${opts('dataSaver', [['auto', 'Automatique', 'Sur réseau mobile : audio seul et qualité légère'], ['on', 'Toujours', 'Audio seul et qualité légère'], ['off', 'Jamais', '']])}
      ${dataSaverActive() ? '<p class="muted small" style="margin-top:10px">Économie de données active en ce moment.</p>' : ''}
    </div>

    <div class="set-block"><h3>Mes sites (Films &amp; TV)</h3>
      <p class="muted">Ajoutez, modifiez ou supprimez les sites qui apparaissent dans l'onglet Films &amp; TV. Ils sont synchronisés avec votre compte.</p>
      ${sitesSectionHtml()}
    </div>

    <div class="set-block"><h3>Qualité audio</h3>
      <p class="muted">Pour la musique libre. Une qualité plus haute utilise plus de données et d'espace.</p>
      <div class="set-row">Streaming</div>${opts('streamQuality', QUALITY_OPTS)}
      <div class="set-row">Téléchargements (hors-ligne)</div>${opts('downloadQuality', QUALITY_OPTS)}
      <p class="muted small" style="margin-top:12px">Les titres déjà téléchargés gardent leur qualité. Supprimez-les puis retéléchargez-les pour changer.</p>
    </div>

    <div class="set-block"><h3>YouTube</h3>
      <p class="muted">La qualité des titres YouTube est réglée automatiquement par le lecteur officiel de YouTube selon votre connexion. Vous pouvez la changer pendant la lecture avec l'icône Réglages du lecteur, en mode vidéo.</p>
      <div class="set-row">Affichage par défaut</div>
      ${(() => { const a = storedAudioOnly(); return `<div class="opts"><button class="opt ${a ? '' : 'active'}" data-yt-audio="0"><b>Vidéo</b><span>Le clip est affiché</span></button><button class="opt ${a ? 'active' : ''}" data-yt-audio="1"><b>Audio seul</b><span>Seulement le son</span></button></div>`; })()}
      <div class="set-row">Source des titres</div>
      <p class="muted">${getUserYtApiKey() ? 'API officielle YouTube (votre clé).' : hasBuiltInYtKey() ? 'API officielle YouTube.' : 'Mode sans clé.'}</p>
      <details class="yt-settings" style="margin-top:8px">
        <summary>Utiliser ma propre clé API YouTube (facultatif)</summary>
        <input id="yt-key" placeholder="Collez votre clé API YouTube (AIza…)" value="${esc(getUserYtApiKey())}" />
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="yt-key-save">Enregistrer</button><button class="btn ghost" id="yt-key-del">Supprimer ma clé</button></div>
        <ol>
          <li>console.cloud.google.com → créez un projet.</li>
          <li>« API et services » → « Bibliothèque » → « YouTube Data API v3 » → « Activer ».</li>
          <li>« Identifiants » → « Créer des identifiants » → « Clé API », puis collez-la ici.</li>
        </ol>
      </details>
      <div class="set-row">Diagnostic</div>
      <p class="muted">Si la musique en ligne ne se charge pas, lancez ce test et envoyez une capture d'écran du résultat.</p>
      <button class="btn ghost" id="yt-diag">Diagnostic YouTube</button>
      <div id="yt-diag-out" class="diag"></div>
    </div>

    <div class="set-block"><h3>Égaliseur</h3>
      <p class="muted">Pour vos fichiers et les titres téléchargés. Les radios et YouTube gardent leur son d'origine : les navigateurs ne permettent pas de modifier le son des autres sites.</p>
      <div class="opts">${Object.entries(EQ_PRESETS).map(([k, p]) => `<button class="opt ${st.eq === k ? 'active' : ''}" data-set="eq" data-val="${k}"><b>${p.label}</b></button>`).join('')}</div>
      <div class="set-row">Normalisation du volume</div>
      ${opts('normalize', [['off', 'Désactivée', 'Son d\'origine'], ['on', 'Activée', 'Tous les titres au même niveau']])}
      <div class="set-row">Fondu enchaîné</div>
      <p class="muted small">Le titre suivant commence pendant que le précédent se termine (fichiers de votre appareil).</p>
      ${opts('crossfade', [['0', 'Désactivé', ''], ['3', '3 secondes', ''], ['6', '6 secondes', ''], ['10', '10 secondes', '']])}
    </div>

    <div class="set-block"><h3>Sauvegarde</h3>
      <p class="muted">Enregistrez vos favoris, playlists, sites, réglages et historique dans un fichier, pour les garder ou les transférer sans compte.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="bk-export">Exporter une sauvegarde</button><button class="btn ghost" id="bk-import">Restaurer une sauvegarde</button></div>
      <input id="bk-file" type="file" accept=".json,application/json" class="hidden" />
    </div>

    <div class="set-block"><h3>Films</h3>
      <div class="set-row">Téléchargements</div>
      ${opts('filmDownload', [['light', 'Légère', 'Fichier plus petit (recommandé sur iPhone)'], ['high', 'Haute', 'Meilleure image, fichier plus gros']])}
    </div>

    ${(() => { const n = Object.keys(getHidden()).length; return `<div class="set-block"><h3>Titres retirés</h3>
      <p class="muted">${n ? `${n} titre(s) retiré(s) des résultats avec le bouton « − ».` : 'Aucun titre retiré. Le bouton « − » à côté d\'un titre le retire des résultats.'} Astuce : dans la recherche, ajoutez <b>-mot</b> pour exclure un mot (ex. <i>makossa -live</i>).</p>
      ${n ? '<button class="btn ghost" id="unhide-all">Tout réafficher</button>' : ''}</div>`; })()}

    <div class="set-block"><h3>Stockage</h3>
      <p class="muted">${state.media.length} élément(s) hors-ligne · ${fmtSize(used)} utilisés sur cet appareil.</p>
      <button class="btn ghost" id="set-lib">Gérer dans la Bibliothèque</button>
    </div>

    ${updatesBlockHtml()}

    <div class="set-block"><h3>À propos</h3>
      <p class="muted">Enora ${esc(currentVersion())} · Sans publicité · Sources : YouTube (lecteur officiel), Internet Archive, Radio Browser, vos fichiers.</p>
    </div>`;

  const back = $('#back');
  if (back) back.onclick = () => go('library');
  bindAccountBlock();
  bindUpdatesBlock();
  $('#bk-export').onclick = exportBackup;
  $('#bk-import').onclick = () => $('#bk-file').click();
  $('#bk-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
  const ua = $('#unhide-all');
  if (ua) ua.onclick = () => { setHidden({}); toast('Tous les titres sont réaffichés'); render(true); };
  bindSites();
  const afterKey = () => { if (cache.music?.yt) cache.music.yt.items = null; cloud.touch(); render(true); };
  $('#yt-key-save').onclick = () => { setYtApiKey($('#yt-key').value); toast(getUserYtApiKey() ? 'Clé enregistrée : API officielle activée' : 'Clé vide'); afterKey(); };
  $('#yt-key-del').onclick = () => { setYtApiKey(''); toast('Clé supprimée'); afterKey(); };
  $('#yt-diag').onclick = async () => {
    const out = $('#yt-diag-out'), btn = $('#yt-diag');
    btn.disabled = true; out.innerHTML = '<p class="muted">Test en cours (jusqu\'à 30 secondes)…</p>';
    try {
      const rows = await ytDiagnostic();
      out.innerHTML = `<p class="muted">Enora ${esc(currentVersion())} · ${esc(navigator.platform || '')}</p>` + rows.map((r) =>
        `<div class="diag-row ${r.ok ? 'ok' : r.ok === false ? 'ko' : ''}"><b>${r.ok ? 'OK' : r.ok === false ? 'Échec' : '—'}</b><span>${esc(r.name)}</span><small>${esc(r.detail)}</small></div>`).join('');
    } catch (e) { out.innerHTML = `<p class="muted">Erreur : ${esc(e.message || e)}</p>`; }
    btn.disabled = false;
  };
  view.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => {
    setSetting(b.dataset.set, b.dataset.val);
    applyEffects();
    if (b.dataset.set === 'dataSaver') updateNowPlaying();
    cloud.touch();
    // Les albums déjà affichés seront rechargés avec la nouvelle qualité
    toast('Réglage enregistré');
    render(true);
  }));
  view.querySelectorAll('[data-yt-audio]').forEach((b) => (b.onclick = () => { setAudioOnly(b.dataset.ytAudio === '1'); updateNowPlaying(); render(true); }));
  $('#set-lib').onclick = () => { libTab = 'offline'; go('library'); };
}

/* =========================================================================
   Vue : Infos (le projet et son auteur)
   ========================================================================= */
function viewAbout() {
  const repo = BUILD.repo || 'Geld237/sonora';
  view.innerHTML = `
    <div class="about-hero"><span class="logo">${I.note}</span>
      <div><h1>Enora</h1><div class="muted">Version ${esc(currentVersion())} · Musique, films et radio, sans publicité</div></div>
    </div>

    <div class="set-block about-block"><h3>Pourquoi Enora ?</h3>
      <p>Écouter de la musique et regarder des films ne devrait pas se faire au milieu des publicités, ni dépendre d'un seul appareil.
      Enora réunit en une seule application la musique récente de chaque pays et de chaque style, les films, des milliers de radios
      et vos propres fichiers, sur l'ordinateur, Android et l'iPhone.</p>
      <p>Le projet s'appuie uniquement sur des sources légales : le lecteur officiel de YouTube, les œuvres du domaine public d'Internet Archive,
      les flux publics des radios, et vos fichiers personnels. Les artistes restent ainsi rémunérés par les plateformes qui diffusent leurs œuvres.</p>
    </div>

    <div class="about-grid">
      <div class="set-block about-block"><h3>Ce que fait l'application</h3>
        <ul>
          <li>Tendances, nouveautés, styles musicaux et suggestions « Pour vous »</li>
          <li>Paroles synchronisées, radio d'un titre et écoute à plusieurs</li>
          <li>Podcasts avec reprise de lecture</li>
          <li>Films classiques gratuits et vos sites de streaming</li>
          <li>Plus de 40 000 radios du monde entier</li>
          <li>Bibliothèque hors-ligne, favoris et playlists</li>
          <li>Compte pour tout synchroniser entre vos appareils</li>
          <li>Bloqueur de publicités et de pop-ups</li>
        </ul>
      </div>
      <div class="set-block about-block"><h3>Comment elle est faite</h3>
        <ul>
          <li>Un seul code (HTML, CSS, JavaScript) pour toutes les plateformes</li>
          <li>Windows : Electron · Android et iPhone : Capacitor</li>
          <li>Version web installable (PWA) sur GitHub Pages</li>
          <li>Compte et synchronisation : Firebase</li>
          <li>Publication et mises à jour automatiques avec GitHub Actions</li>
        </ul>
      </div>
    </div>

    <div class="set-block about-block" style="margin-top:14px"><h3>Auteur</h3>
      <div class="author"><div class="av">G</div>
        <div><b style="color:var(--text)">Geld237</b><br>
          <a href="https://github.com/Geld237" target="_blank" rel="noopener">github.com/Geld237</a> ·
          <a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener">code source du projet</a></div>
      </div>
    </div>

    <div class="set-block about-block"><h3>Sources et remerciements</h3>
      <p>YouTube (lecteur officiel et API YouTube Data) · Internet Archive (films et musique du domaine public) · Radio Browser (annuaire libre des radios) · LRCLIB (paroles) · annuaire de podcasts d'Apple · Firebase (comptes).
      Enora n'est affiliée à aucun de ces services.</p>
    </div>`;
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
  toast(getAudioOnly() ? 'Audio seul' : 'Vidéo affichée');
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
$('#np-radio').onclick = () => startRadio(player.current);
$('#np-room').onclick = openRoomModal;
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
  $('#np-video-toggle').innerHTML = getAudioOnly() ? I.video : I.headphones;
  $('#np-video-toggle').title = getAudioOnly() ? 'Afficher la vidéo' : 'Audio seul';
  requestAnimationFrame(placeYtHost);
  $('#np-shuffle').classList.toggle('on', player.shuffle);
  $('#np-repeat').classList.toggle('on', player.repeat !== 'off');
  $('#np-repeat').innerHTML = player.repeat === 'one' ? I.repeatOne : I.repeat;
  $('#np-fav').innerHTML = isFav(t.key) ? ic('heartFill', 'Favori') : ic('heart', 'Favori');
  $('#np-fav').classList.toggle('on', isFav(t.key));
  $('#np-addpl').classList.toggle('hidden', !!t.live);
  $('#np-radio').classList.toggle('hidden', !!t.live || t.origin === 'podcast' || t.kind === 'video');
  $('#np-queue').innerHTML = player.queue.map((q, i) => `
    <div class="row ${i === player.index ? 'playing' : ''}" data-q="${i}" style="cursor:pointer">
      <div class="rc"><img src="${esc(q.cover || FALLBACK_AUDIO)}" onerror="this.src='${FALLBACK_AUDIO}'"></div>
      <div class="ri"><div class="rt ellipsis">${esc(q.title)}</div><div class="ra ellipsis">${esc(q.artist || '')}</div></div>
    </div>`).join('');
  updateState();
  updateTime();
}

function updateState() {
  const icon = player.playing ? I.pause : I.play;
  $('#mini-play').innerHTML = icon;
  $('#np-play').innerHTML = icon;
}

/* ---------- Paroles (fichiers .lrc de l'utilisateur) ---------- */
let lyricsState = { key: null, timed: false, lines: [], active: -1 };
function currentMedia() {
  const t = player.current;
  const id = t && (t.mediaId || player.offlineIndex.get(t.key));
  return id ? state.media.find((m) => m.id === id) : null;
}
function setLyrics(key, raw, source = '') {
  const box = $('#np-lyrics');
  const p = parseLyrics(raw);
  lyricsState = { key, timed: p.timed, lines: p.lines, active: -1 };
  box.innerHTML = `<h3 class="np-qh">Paroles${p.timed ? '' : ' (non synchronisées)'}${source ? ` <span class="muted small lyr-src">· ${esc(source)}</span>` : ''}</h3>` + p.lines.map((l, i) => `<p data-l="${i}"${l.t != null ? ` data-t="${l.t}"` : ''}>${esc(l.text) || '&nbsp;'}</p>`).join('');
  box.classList.remove('hidden');
}
function renderLyrics() {
  const box = $('#np-lyrics');
  const addBtn = $('#np-addlrc');
  const t = player.current;
  const m = currentMedia();
  addBtn.style.display = m && !m.lyrics && t.kind === 'audio' ? 'flex' : 'none';
  if (!t) { box.classList.add('hidden'); lyricsState = { key: null, timed: false, lines: [], active: -1 }; return; }
  // 1. Paroles ajoutées par l'utilisateur (fichier .lrc)
  if (m && m.lyrics) { if (lyricsState.key !== `m:${m.id}`) setLyrics(`m:${m.id}`, m.lyrics); return; }
  if (lyricsState.key === t.key) return; // déjà affichées ou recherche en cours
  box.classList.add('hidden');
  lyricsState = { key: t.key, timed: false, lines: [], active: -1 };
  // 2. Paroles automatiques (LRCLIB), cherchées une fois la lecture lancée
  if (getSettings().autoLyrics !== 'on' || navigator.onLine === false) return;
  const key = t.key;
  setTimeout(async () => {
    if (player.current?.key !== key) return;
    const d = player.el.duration;
    const r = await fetchLyrics(t, Math.round(t.duration || (isFinite(d) ? d : 0))).catch(() => null);
    if (!r || player.current?.key !== key || currentMedia()?.lyrics) return;
    setLyrics(key, r.text, 'LRCLIB');
  }, 1500);
}
function syncLyrics(time) {
  if (!lyricsState.timed || !lyricsState.lines.length) return;
  let i = -1;
  for (let k = 0; k < lyricsState.lines.length; k++) { if (lyricsState.lines[k].t <= time + 0.2) i = k; else break; }
  if (i === lyricsState.active) return;
  lyricsState.active = i;
  const box = $('#np-lyrics');
  box.querySelectorAll('p.on').forEach((p) => p.classList.remove('on'));
  const el = box.querySelector(`p[data-l="${i}"]`);
  if (el) { el.classList.add('on'); if (!npSheet.classList.contains('hidden')) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
$('#np-lyrics').addEventListener('click', (e) => { const p = e.target.closest('p[data-t]'); if (p) player.el.currentTime = +p.dataset.t; });
$('#np-addlrc').onclick = () => $('#lrc-input').click();
$('#lrc-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  const m = currentMedia();
  if (!f || !m) return;
  m.lyrics = await f.text();
  await db.put('media', m);
  lyricsState.key = null;
  renderLyrics();
  toast('Paroles ajoutées');
});

/* ---------- File d'attente -> playlist ---------- */
$('#np-saveq').onclick = async () => {
  if (!player.queue.length) return;
  const name = await ask('Nom de la playlist', 'Ma sélection', player.current?.artist ? `Sélection ${player.current.artist}` : 'Ma sélection');
  if (!name) return;
  const p = { id: uid(), name, tracks: player.queue.filter((t) => !t.live).map(storableTrack), createdAt: Date.now() };
  await savePlaylist(p);
  state.playlists.push(p);
  toast(`Playlist « ${name} » créée (${p.tracks.length} titres)`);
};

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
  renderLyrics();
  resumePodcast();
  roomPush();
  clearTimeout(listenTimer);
  const t = player.current;
  if (t) listenTimer = setTimeout(() => { if (player.current?.key === t.key) addToHistory(t); }, 15000);
  updateNowPlaying();
  // Met à jour la piste surlignée sans recharger la page
  view.querySelectorAll('.row').forEach((r) => {
    const i = r.querySelector('[data-act="play"]')?.dataset.i;
    if (i != null) r.classList.toggle('playing', rowTracks[+i]?.key === player.current?.key);
  });
});
player.addEventListener('state', () => {
  updateState();
  roomPush();
  // Une seule source à la fois : si l'appli joue, on met en pause YouTube / les sites
  if (player.playing && platform === 'electron') {
    document.querySelectorAll('webview').forEach((w) => {
      try { w.executeJavaScript('document.querySelectorAll("video,audio").forEach(function(m){m.pause()})').catch(() => {}); } catch (_) {}
    });
  }
});
player.addEventListener('time', () => { updateTime(); if (lyricsState.timed) syncLyrics(player.el.currentTime || 0); savePodcastPosition(); });
// Lecture continue : à la fin de la file d'attente, on enchaîne sur une radio du dernier titre
player.addEventListener('queueend', () => {
  const t = player.current;
  if (getSettings().autoRadio !== 'on' || !t || t.kind !== 'youtube' || navigator.onLine === false || (currentRoom() && !currentRoom().host)) return;
  startRadio(t, { auto: true });
});

/* ---------- Podcasts : reprise là où l'on s'était arrêté ---------- */
let podSaved = 0;
function resumePodcast() {
  const t = player.current;
  if (!t || t.origin !== 'podcast') return;
  const pos = getPosition(t.key);
  if (pos < 10) return;
  const el = player.el;
  const jump = () => { if (player.current?.key === t.key && el === player.el) { try { el.currentTime = pos; } catch (_) {} toast(`Reprise à ${fmtTime(pos)}`); } };
  if (el.readyState >= 1) jump(); else el.addEventListener('loadedmetadata', jump, { once: true });
}
function savePodcastPosition() {
  const t = player.current;
  if (!t || t.origin !== 'podcast' || Date.now() - podSaved < 5000) return;
  podSaved = Date.now();
  const el = player.el;
  if (el.currentTime > 5) setPosition(t.key, el.currentTime, isFinite(el.duration) ? el.duration : 0);
}

/* ---------- Écoute à plusieurs ---------- */
let roomPushTimer = null;
function roomPush() {
  if (!currentRoom()?.host) return;
  clearTimeout(roomPushTimer);
  roomPushTimer = setTimeout(() => pushState(true), 350);
}
initRooms({
  getState: () => ({ track: player.current, position: player.el.currentTime || 0, playing: player.playing }),
  onStatus: (msg) => toast(msg, 4000),
  async apply({ track, playing, position }) {
    if (!track) { if (player.playing) player.el.pause(); return; }
    if (player.current?.key !== track.key) { await player.playList([hydrate(track)], 0); return; } // la position est recalée au prochain passage
    const el = player.el;
    if (!track.live && isFinite(el.duration) && el.duration > 0 && Math.abs((el.currentTime || 0) - position) > 2.5) el.currentTime = Math.min(position, Math.max(0, el.duration - 1));
    if (playing && el.paused) el.play().catch(() => {}); else if (!playing && !el.paused) el.pause();
  },
});
onRoom((r) => {
  $('#np-room').innerHTML = r ? `<b>Salon ${esc(r.code)}</b>${r.host ? '' : ' · invité'}` : 'Écouter à plusieurs';
  $('#np-room').classList.toggle('on', !!r);
  document.body.classList.toggle('in-room', !!r);
});
$('#np-range').addEventListener('change', roomPush);

const FIRESTORE_ROOM_RULE = 'match /rooms/{room} {\n  allow read, write: if request.auth != null;\n}';
function openRoomModal() {
  const r = currentRoom();
  if (!cloud.isLoggedIn()) {
    const c = modal(`<h3>Écouter à plusieurs</h3><p class="muted">Plusieurs personnes écoutent le même titre au même moment, chacune sur son appareil. Il faut être connecté à son compte Enora.</p>
      <div class="modal-actions"><button class="btn ghost" id="rm-close">Fermer</button><button class="btn" id="rm-login">Se connecter</button></div>`);
    $('#rm-close', c).onclick = closeModal;
    $('#rm-login', c).onclick = () => { closeModal(); closeNowPlaying(); go('settings', { tab: isMobile ? 'library' : 'settings' }); };
    return;
  }
  const fail = (e) => {
    const denied = e.code === 'PERMISSION_DENIED' || e.status === 403;
    const box = $('#rm-err');
    if (!box) return;
    box.innerHTML = denied
      ? `Le salon n'a pas pu être ouvert : la base du projet n'autorise pas encore les salons. Dans Firebase → Firestore → Règles, ajoutez :<pre>${esc(FIRESTORE_ROOM_RULE)}</pre>`
      : esc(e.message || String(e));
    box.classList.remove('hidden');
  };
  if (r) {
    const c = modal(`<h3>${r.host ? 'Votre salon' : 'Salon rejoint'}</h3>
      <div class="room-code">${esc(r.code)}</div>
      <p class="muted">${r.host ? 'Donnez ce code à vos amis : ils entendent ce que vous écoutez, au même moment. Les fichiers de votre appareil ne sont pas partagés, seulement les titres en ligne.' : `Vous écoutez la même chose que ${esc(r.hostName || 'l\'hôte')}. C'est l'hôte qui choisit les titres.`}</p>
      ${r.error ? `<p class="error small">${esc(r.error)}</p>` : ''}
      <div class="modal-actions"><button class="btn ghost" id="rm-leave">${r.host ? 'Fermer le salon' : 'Quitter le salon'}</button>${r.host ? '<button class="btn ghost" id="rm-copy">Copier le code</button>' : ''}<button class="btn" id="rm-close">OK</button></div>`);
    $('#rm-close', c).onclick = closeModal;
    $('#rm-leave', c).onclick = async () => { await leaveRoom(); closeModal(); toast('Salon quitté'); };
    const cp = $('#rm-copy', c);
    if (cp) cp.onclick = () => copyText(r.code, 'Code copié');
    return;
  }
  const c = modal(`<h3>Écouter à plusieurs</h3>
    <p class="muted">Créez un salon et partagez son code, ou rejoignez celui d'un ami. Tout le monde entend le même titre au même moment, chacun sur son appareil.</p>
    <button class="btn" id="rm-create" style="width:100%">Créer un salon</button>
    <form id="rm-join" class="searchbar" style="margin-top:14px"><input id="rm-code" placeholder="Code du salon (6 caractères)" maxlength="8" autocomplete="off" style="text-transform:uppercase" /><button class="btn ghost">Rejoindre</button></form>
    <div id="rm-err" class="error small hidden" style="margin-top:12px"></div>
    <div class="modal-actions"><button class="btn ghost" id="rm-close">Fermer</button></div>`);
  $('#rm-close', c).onclick = closeModal;
  $('#rm-create', c).onclick = async (e) => {
    e.target.disabled = true;
    try { await createRoom(); openRoomModal(); } catch (err) { e.target.disabled = false; fail(err); }
  };
  $('#rm-join', c).onsubmit = async (e) => {
    e.preventDefault();
    try { await joinRoom($('#rm-code', c).value); closeModal(); toast('Salon rejoint : la lecture suit celle de l\'hôte', 4000); } catch (err) { fail(err); }
  };
}

async function copyText(text, msg = 'Copié') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg); } catch (__) { toast('Copie impossible'); }
    ta.remove();
  }
}
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
player.addEventListener('sleep', () => { $('#np-sleep').value = '0'; toast('Minuterie terminée : lecture arrêtée'); });

/* Raccourcis clavier (Windows) */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openGlobalSearch(); return; }
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
// Icônes de la barre d'onglets et du lecteur
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = I[el.dataset.icon] || ''; });
document.body.classList.add('no-mini', `platform-${platform}`);
if (isStoreBuild) document.body.classList.add('store-build');
startUpdateChecks();
const lightQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
function applyTheme() {
  const t = getSettings().theme;
  const light = t === 'light' || (t === 'auto' && !!lightQuery?.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f5f5f7' : '#000000');
}
if (lightQuery) (lightQuery.addEventListener ? lightQuery.addEventListener('change', applyTheme) : lightQuery.addListener(applyTheme));
function applyEffects() {
  const st = getSettings();
  setAudioEffects({ preset: st.eq, normalize: st.normalize === 'on' });
  player.crossfade = parseInt(st.crossfade, 10) || 0;
  applyTheme();
  applyLanguage(st.lang);
}
applyEffects();

/* ---------- Ordinateur : mini-lecteur flottant et touches multimédia du clavier ---------- */
if (platform === 'electron' && window.sonora?.setMini) {
  const btn = $('#mini-compact');
  btn.classList.remove('hidden');
  let compact = false;
  const set = (on) => {
    compact = on;
    if (on) closeNowPlaying();
    document.body.classList.toggle('compact', on);
    btn.innerHTML = on ? I.expand : I.pip;
    btn.title = on ? 'Revenir à la fenêtre complète' : 'Mini-lecteur flottant';
    window.sonora.setMini(on);
  };
  btn.onclick = (e) => { e.stopPropagation(); set(!compact); };
  $('#mini-open').addEventListener('click', (e) => { if (compact) { e.stopImmediatePropagation(); set(false); } }, true);
}
window.sonora?.onMedia?.((action) => { if (action === 'toggle') player.toggle(); else if (action === 'next') player.next(); else if (action === 'prev') player.prev(); });

// Première utilisation des statistiques : on reprend l'historique déjà enregistré
if (!Object.keys(statsData()).length) { for (const x of getHistory().slice().reverse()) recordListen(x.track, ''); }
loadState()
  .then(() => { go('library'); importFromHash(); })
  .catch((e) => { console.error(e); view.innerHTML = errorHtml(e); });
