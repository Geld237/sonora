// Lecteur YouTube officiel (API IFrame) présenté comme un élément <audio>/<video>.
// Il permet au lecteur de Enora (file d'attente, suivant, précédent…) de lire des titres YouTube.
// La lecture passe par le lecteur officiel de YouTube : c'est ce qui la rend légale.

import { BUILD } from './build-info.js';

const HOST_ID = 'yt-host';

class YouTubeMedia extends EventTarget {
  constructor() {
    super();
    this.player = null;
    this.ready = false;
    this.pendingId = null;
    this.state = -1;          // -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 prêt
    this.wantPlay = false;
    this.lastError = 0;
    this._volume = 1;
    this.preload = 'auto';
    this._timer = null;
    this._apiPromise = null;
  }

  /* ---------- Chargement de l'API ---------- */
  loadApi() {
    if (this._apiPromise) return this._apiPromise;
    this._apiPromise = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) { resolve(); return; }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (_) {} resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { this._apiPromise = null; reject(new Error('Lecteur YouTube indisponible')); };
      document.head.appendChild(s);
    });
    return this._apiPromise;
  }

  async ensurePlayer() {
    if (this.player) return;
    await this.loadApi();
    if (this.player) return;
    await new Promise((resolve) => {
      const inner = document.createElement('div');
      inner.id = 'yt-host-inner';
      document.getElementById(HOST_ID).appendChild(inner);
      this.player = new window.YT.Player('yt-host-inner', {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 1, fs: 1, iv_load_policy: 3 },
        events: {
          onReady: () => {
            this.ready = true;
            try { this.player.setVolume(Math.round(this._volume * 100)); } catch (_) {}
            resolve();
          },
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => {
            this.lastError = e.data;
            this.emit('error');
          },
        },
      });
    });
  }

  emit(type) { this.dispatchEvent(new Event(type)); }

  onState(s) {
    this.state = s;
    if (s === 1) { this.emit('play'); this.emit('playing'); this.emit('durationchange'); this.startTimer(); }
    else if (s === 2) { this.emit('pause'); this.stopTimer(); }
    else if (s === 3) { this.emit('waiting'); }
    else if (s === 0) { this.stopTimer(); this.emit('pause'); this.emit('ended'); }
    else if (s === 5 && this.wantPlay) { try { this.player.playVideo(); } catch (_) {} }
    this.emit('timeupdate');
  }

  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => this.emit('timeupdate'), 500);
  }
  stopTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  /* ---------- Interface de type HTMLMediaElement ---------- */
  set src(id) {
    this.lastError = 0;
    if (!id) { this.stop(); return; }
    this.pendingId = id;
    this.state = 3;
    this.ensurePlayer()
      .then(() => {
        if (this.pendingId !== id) return;
        this.player.loadVideoById(id);
        if (!this.wantPlay) setTimeout(() => { try { if (!this.wantPlay) this.player.pauseVideo(); } catch (_) {} }, 300);
      })
      .catch(() => { this.lastError = -1; this.emit('error'); });
  }
  get src() { return this.pendingId || ''; }

  play() {
    this.wantPlay = true;
    if (this.ready) { try { this.player.playVideo(); } catch (_) {} }
    return Promise.resolve();
  }
  pause() {
    this.wantPlay = false;
    if (this.ready) { try { this.player.pauseVideo(); } catch (_) {} }
  }
  stop() {
    this.wantPlay = false;
    this.pendingId = null;
    this.stopTimer();
    if (this.ready) { try { this.player.stopVideo(); } catch (_) {} }
    this.state = -1;
  }
  removeAttribute(name) { if (name === 'src') this.stop(); }
  load() {}

  get paused() { return !(this.state === 1 || (this.state === 3 && this.wantPlay)); }
  get currentTime() { try { return this.ready ? this.player.getCurrentTime() || 0 : 0; } catch (_) { return 0; } }
  set currentTime(v) { try { if (this.ready) this.player.seekTo(v, true); } catch (_) {} }
  get duration() { try { const d = this.ready ? this.player.getDuration() : 0; return d > 0 ? d : NaN; } catch (_) { return NaN; } }
  get volume() { return this._volume; }
  set volume(v) { this._volume = v; try { if (this.ready) this.player.setVolume(Math.round(v * 100)); } catch (_) {} }
  set playbackRate(_) {}
  get error() { return this.lastError ? { code: this.lastError } : null; }

  /** Erreurs « vidéo non intégrable » : le titre doit être ouvert sur YouTube. */
  get notEmbeddable() { return [100, 101, 150, 152, 153].includes(this.lastError); }
}

/* ---------- iPhone : lecteur officiel via une page relais en https ----------
   L'application iPhone tourne sous « capacitor://localhost », adresse que YouTube refuse pour son lecteur intégré
   (erreur 153). Le lecteur est donc placé dans une page d'Enora servie en https (GitHub Pages), pilotée par messages. */
const RELAY_URL = (() => { const [owner, name] = (BUILD.repo || 'Geld237/sonora').split('/'); return `https://${owner.toLowerCase()}.github.io/${name}/yt-relay.html`; })();
const RELAY_ORIGIN = new URL(RELAY_URL).origin;

class RelayYouTubeMedia extends YouTubeMedia {
  constructor() {
    super();
    this.frame = null;
    this.t = 0;
    this.d = 0;
    this.connected = null;
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  send(m) { try { this.frame?.contentWindow?.postMessage({ enora: 'yt', ...m }, RELAY_ORIGIN); } catch (_) {} }

  ensurePlayer() {
    if (this.connected) return this.connected;
    this.connected = new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.src = RELAY_URL;
      f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      f.setAttribute('allowfullscreen', '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      Object.assign(f.style, { width: '100%', height: '100%', border: '0', display: 'block' });
      this.frame = f;
      this.onReady = () => { this.ready = true; this.send({ cmd: 'volume', v: this._volume * 100 }); resolve(); };
      let tries = 0;
      const hello = setInterval(() => {
        if (this.ready || ++tries > 60) { clearInterval(hello); if (!this.ready) { this.connected = null; f.remove(); reject(new Error('Lecteur YouTube indisponible')); } return; }
        this.send({ cmd: 'hello' });
      }, 500);
      document.getElementById(HOST_ID).appendChild(f);
    });
    return this.connected;
  }

  onMessage(e) {
    if (e.origin !== RELAY_ORIGIN || !this.frame || e.source !== this.frame.contentWindow) return;
    const m = e.data;
    if (!m || m.enora !== 'yt') return;
    if (m.ev === 'ready') { if (!this.ready) this.onReady?.(); }
    else if (m.ev === 'time') { this.t = +m.t || 0; if (+m.d > 0) this.d = +m.d; this.emit('timeupdate'); }
    else if (m.ev === 'state') { if (m.s === 3 || m.s === -1) { this.t = 0; } this.onState(m.s); }
    else if (m.ev === 'error') { this.lastError = +m.code || -1; this.emit('error'); }
  }

  onState(s) {
    this.state = s;
    if (s === 1) { this.emit('play'); this.emit('playing'); this.emit('durationchange'); }
    else if (s === 2) this.emit('pause');
    else if (s === 3) this.emit('waiting');
    else if (s === 0) { this.emit('pause'); this.emit('ended'); }
    else if (s === 5 && this.wantPlay) this.send({ cmd: 'play' });
    this.emit('timeupdate');
  }

  set src(id) {
    this.lastError = 0;
    if (!id) { this.stop(); return; }
    this.pendingId = id;
    this.state = 3; this.t = 0; this.d = 0;
    this.ensurePlayer()
      .then(() => { if (this.pendingId === id) this.send({ cmd: 'load', id, play: this.wantPlay }); })
      .catch(() => { this.lastError = -1; this.emit('error'); });
  }
  get src() { return this.pendingId || ''; }
  play() { this.wantPlay = true; if (this.ready) this.send({ cmd: 'play' }); return Promise.resolve(); }
  pause() { this.wantPlay = false; if (this.ready) this.send({ cmd: 'pause' }); }
  stop() { this.wantPlay = false; this.pendingId = null; if (this.ready) this.send({ cmd: 'stop' }); this.state = -1; this.t = 0; }
  get currentTime() { return this.t; }
  set currentTime(v) { this.t = +v || 0; if (this.ready) this.send({ cmd: 'seek', t: this.t }); }
  get duration() { return this.d > 0 ? this.d : NaN; }
  get volume() { return this._volume; }
  set volume(v) { this._volume = v; if (this.ready) this.send({ cmd: 'volume', v: v * 100 }); }
}

const needsRelay = /^(capacitor|ionic):$/.test(location.protocol);
export const ytMedia = needsRelay ? new RelayYouTubeMedia() : new YouTubeMedia();
export const ytHostId = HOST_ID;
