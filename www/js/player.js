// Lecteur audio/vidéo : file d'attente, aléatoire, répétition, minuterie, commandes écran verrouillé.
import { db } from './db.js';
import { ytMedia } from './youtube-player.js';

const audio = document.getElementById('audio-el');
const video = document.getElementById('video-el');
const audioFx = document.getElementById('audio-fx'); // fichiers locaux / hors ligne : égaliseur + normalisation

/* ---------- Égaliseur et normalisation du volume (Web Audio) ----------
   Uniquement pour les fichiers stockés sur l'appareil : le navigateur interdit de traiter
   le son des radios et de YouTube (autres sites), qui gardent donc leur son d'origine. */
export const EQ_BANDS = [60, 230, 910, 3600, 14000];
export const EQ_PRESETS = {
  off: { label: 'Désactivé', gains: [0, 0, 0, 0, 0] },
  bass: { label: 'Basses renforcées', gains: [6, 3, 0, 0, 1] },
  vocal: { label: 'Voix', gains: [-2, 0, 3, 4, 1] },
  treble: { label: 'Aigus renforcés', gains: [0, 0, 0, 3, 6] },
  party: { label: 'Soirée', gains: [5, 2, -1, 2, 4] },
  acoustic: { label: 'Acoustique', gains: [3, 1, 1, 2, 3] },
};
const fx = { ctx: null, filters: [], comp: null, gain: null, preset: 'off', normalize: false };
function ensureFx() {
  if (fx.ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    fx.ctx = new AC();
    const src = fx.ctx.createMediaElementSource(audioFx);
    fx.filters = EQ_BANDS.map((f, i) => {
      const b = fx.ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1;
      return b;
    });
    fx.comp = fx.ctx.createDynamicsCompressor();
    fx.gain = fx.ctx.createGain();
    let node = src;
    for (const f of fx.filters) { node.connect(f); node = f; }
    node.connect(fx.comp);
    fx.comp.connect(fx.gain);
    fx.gain.connect(fx.ctx.destination);
    applyFx();
    return true;
  } catch (e) { console.warn('Égaliseur indisponible', e); fx.ctx = null; return false; }
}
function applyFx() {
  if (!fx.ctx) return;
  const gains = (EQ_PRESETS[fx.preset] || EQ_PRESETS.off).gains;
  fx.filters.forEach((f, i) => { f.gain.value = gains[i]; });
  // Normalisation : compresseur doux qui rapproche les titres trop forts et trop faibles
  const c = fx.comp;
  if (fx.normalize) { c.threshold.value = -24; c.knee.value = 24; c.ratio.value = 4; c.attack.value = 0.01; c.release.value = 0.25; fx.gain.gain.value = 1.4; }
  else { c.threshold.value = 0; c.knee.value = 0; c.ratio.value = 1; fx.gain.gain.value = 1; }
}
export function setAudioEffects({ preset, normalize }) {
  if (preset != null) fx.preset = preset;
  if (normalize != null) fx.normalize = !!normalize;
  applyFx();
}

class Player extends EventTarget {
  constructor() {
    super();
    this.queue = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.el = audio;
    this.objectUrl = null;
    this.sleepTimer = null;
    this.sleepAtEnd = false;
    this.offlineIndex = new Map(); // clé source -> id du média hors-ligne
    for (const el of [audio, audioFx, video, ytMedia]) {
      el.addEventListener('timeupdate', () => el === this.el && this.emit('time'));
      el.addEventListener('durationchange', () => el === this.el && this.emit('time'));
      el.addEventListener('play', () => el === this.el && this.emit('state'));
      el.addEventListener('pause', () => el === this.el && this.emit('state'));
      el.addEventListener('waiting', () => el === this.el && this.emit('state'));
      el.addEventListener('playing', () => el === this.el && this.emit('state'));
      el.addEventListener('ended', () => el === this.el && this.onEnded());
      el.addEventListener('error', () => el === this.el && this.onError());
    }
    this.setupMediaSession();
  }

  emit(type) { this.dispatchEvent(new Event(type)); }
  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.el.paused; }

  /** Lance une liste de pistes à partir de l'index donné. */
  async playList(tracks, start = 0) {
    this.queue = tracks.slice();
    this.index = start;
    await this.load(true);
  }

  async playTrack(track) { return this.playList([track], 0); }

  addToQueue(track) {
    if (!this.current) return this.playTrack(track);
    this.queue.splice(this.index + 1, 0, track);
    this.emit('change');
  }

  async load(autoplay = true) {
    const t = this.current;
    if (!t) return;
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    let src = t.kind === 'youtube' ? t.ytId : t.src;
    const offlineId = t.kind !== 'youtube' && (t.mediaId || this.offlineIndex.get(t.key));
    if (offlineId) {
      const rec = await db.get('blobs', offlineId).catch(() => null);
      if (rec && rec.blob) { this.objectUrl = URL.createObjectURL(rec.blob); src = this.objectUrl; }
    }
    // Fichier sur l'appareil -> lecteur avec égaliseur ; sinon lecteur standard
    const local = t.kind === 'audio' && !!this.objectUrl && ensureFx();
    if (local && fx.ctx.state === 'suspended') fx.ctx.resume().catch(() => {});
    const next = t.kind === 'youtube' ? ytMedia : t.kind === 'video' ? video : local ? audioFx : audio;
    for (const other of [audio, audioFx, video, ytMedia]) {
      if (other === next) continue;
      other.pause();
      if (other.src) { other.removeAttribute('src'); other.load(); }
    }
    this.el = next;
    if (!src) { this.el.pause(); this.emit('change'); this.onError(); return; }
    this.el.src = src;
    this.el.preload = 'auto';
    this.emit('change');
    this.updateMediaSession();
    if (autoplay) {
      try { await this.el.play(); } catch (e) { if (e.name !== 'AbortError') console.warn('Lecture bloquée', e); }
    }
  }

  toggle() {
    if (!this.current) return;
    if (this.el.paused) this.el.play().catch(() => {}); else this.el.pause();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    if (this.shuffle && this.queue.length > 1) {
      let i;
      do { i = Math.floor(Math.random() * this.queue.length); } while (i === this.index);
      this.index = i;
    } else if (this.index < this.queue.length - 1) {
      this.index++;
    } else if (this.repeat === 'all' || !auto) {
      this.index = 0;
    } else {
      this.el.pause();
      this.emit('state');
      return;
    }
    this.load(true);
  }

  prev() {
    if (!this.queue.length) return;
    if (this.el.currentTime > 3) { this.el.currentTime = 0; return; }
    this.index = this.index > 0 ? this.index - 1 : this.queue.length - 1;
    this.load(true);
  }

  jump(i) { if (i >= 0 && i < this.queue.length) { this.index = i; this.load(true); } }

  seek(fraction) {
    const d = this.el.duration;
    if (isFinite(d) && d > 0) this.el.currentTime = fraction * d;
  }

  setVolume(v) { audio.volume = v; audioFx.volume = v; video.volume = v; ytMedia.volume = v; }

  toggleShuffle() { this.shuffle = !this.shuffle; this.emit('change'); }
  cycleRepeat() { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; this.emit('change'); }

  setSleep(value) {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.sleepAtEnd = value === 'end';
    const min = parseInt(value, 10);
    if (min > 0) this.sleepTimer = setTimeout(() => { this.el.pause(); this.emit('sleep'); }, min * 60000);
  }

  onEnded() {
    if (this.sleepAtEnd) { this.sleepAtEnd = false; this.emit('sleep'); return; }
    if (this.repeat === 'one') { this.el.currentTime = 0; this.el.play().catch(() => {}); return; }
    this.next(true);
  }

  onError() {
    this.emit('error');
    if (!this.current?.live && this.queue.length > 1 && this.index < this.queue.length - 1) {
      setTimeout(() => this.next(true), 1500);
    }
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const safe = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (_) {} };
    safe('play', () => this.el.play());
    safe('pause', () => this.el.pause());
    safe('previoustrack', () => this.prev());
    safe('nexttrack', () => this.next());
    safe('seekto', (d) => { if (d.seekTime != null) this.el.currentTime = d.seekTime; });
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const t = this.current;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || '',
        album: t.album || 'Enora',
        artwork: t.cover && !t.cover.startsWith('blob:') ? [{ src: t.cover, sizes: '512x512' }] : [],
      });
    } catch (_) {}
  }
}

export const player = new Player();
export const videoElement = video;
