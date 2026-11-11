// Rétrospective : compteurs d'écoute par mois (gardés sur l'appareil) et bilan en image.
const STORE = 'sonora.stats';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (_) { return {}; } };
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function prune(map, keep, n = (v) => v) {
  const keys = Object.keys(map);
  if (keys.length <= keep * 2) return;
  keys.sort((a, b) => n(map[b]) - n(map[a])).slice(keep).forEach((k) => delete map[k]);
}

/** Enregistre une écoute (appelé après 15 secondes de lecture). */
export function recordListen(track, style = '') {
  if (!track) return;
  const all = load();
  const m = all[monthOf()] || (all[monthOf()] = { n: 0, s: 0, a: {}, t: {}, g: {} });
  m.n++;
  m.s += track.live ? 0 : Math.min(track.duration || 200, 3600);
  const artist = track.artist && !/^(youtube|inconnu|artiste inconnu|vidéo locale)$/i.test(track.artist) ? track.artist : '';
  if (artist) m.a[artist] = (m.a[artist] || 0) + 1;
  if (!track.live) { const e = m.t[track.key] || (m.t[track.key] = [track.title, artist, 0]); e[2]++; }
  if (style) m.g[style] = (m.g[style] || 0) + 1;
  // Heure d'écoute et humeur du titre : servent au nuage de mots
  const h = new Date().getHours();
  (m.h || (m.h = {}))[h] = (m.h[h] || 0) + 1;
  if (track.mood) (m.m || (m.m = {}))[track.mood] = (m.m[track.mood] || 0) + 1;
  prune(m.a, 40); prune(m.t, 40, (v) => v[2]); prune(m.g, 20);
  const months = Object.keys(all).sort();
  for (const k of months.slice(0, Math.max(0, months.length - 36))) delete all[k];
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (_) {}
}

export const statsData = () => load();
export function setStatsData(d) { try { localStorage.setItem(STORE, JSON.stringify(d || {})); } catch (_) {} }

/** Totaux d'une période : 'month' (mois en cours), 'year' (année en cours) ou 'all'. */
export function recap(period = 'month') {
  const all = load();
  const now = new Date();
  const keys = Object.keys(all).filter((k) => period === 'all' || (period === 'year' ? k.startsWith(String(now.getFullYear())) : k === monthOf(now)));
  const out = { n: 0, s: 0, a: {}, t: {}, g: {}, h: {}, m: {} };
  for (const k of keys) {
    const m = all[k];
    for (const [x, n] of Object.entries(m.h || {})) out.h[x] = (out.h[x] || 0) + n;
    for (const [x, n] of Object.entries(m.m || {})) out.m[x] = (out.m[x] || 0) + n;
    out.n += m.n || 0; out.s += m.s || 0;
    for (const [a, n] of Object.entries(m.a || {})) out.a[a] = (out.a[a] || 0) + n;
    for (const [g, n] of Object.entries(m.g || {})) out.g[g] = (out.g[g] || 0) + n;
    for (const [key, v] of Object.entries(m.t || {})) { const e = out.t[key] || (out.t[key] = [v[0], v[1], 0]); e[2] += v[2]; }
  }
  const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n);
  const label = period === 'all' ? 'Depuis le début' : period === 'year' ? `Année ${now.getFullYear()}` : now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
  return {
    period, label, listens: out.n, minutes: Math.round(out.s / 60),
    artists: top(out.a, 5), styles: top(out.g, 3),
    allArtists: top(out.a, 14), allStyles: top(out.g, 10), hours: out.h, moods: out.m, distinctArtists: Object.keys(out.a).length,
    titles: Object.values(out.t).sort((x, y) => y[2] - x[2]).slice(0, 5),
  };
}

/** Styles et artistes préférés (pour la page « Pour vous »). */
export function tastes() {
  const all = load();
  const keys = Object.keys(all).sort().slice(-6);
  const a = {}, g = {};
  keys.forEach((k, i) => {
    const w = i + 1; // les mois récents comptent plus
    for (const [x, n] of Object.entries(all[k].a || {})) a[x] = (a[x] || 0) + n * w;
    for (const [x, n] of Object.entries(all[k].g || {})) g[x] = (g[x] || 0) + n * w;
  });
  const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map((x) => x[0]);
  return { artists: top(a, 6), styles: top(g, 3) };
}

/** Dessine le bilan (image 1080 × 1350, format portrait à partager). */
export function drawRecap(r, tr = (s) => s) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const FONT = '-apple-system, "SF Pro Display", Inter, "Segoe UI", sans-serif';
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const glow = (cx, cy, rad, col) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); };
  glow(940, 120, 620, 'rgba(255,55,95,.55)');
  glow(80, 1300, 560, 'rgba(94,92,230,.45)');
  const fit = (s, max) => { s = String(s); if (x.measureText(s).width <= max) return s; while (s.length > 1 && x.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; };
  const txt = (s, px, py, size, weight = 600, col = '#f5f5f7', max = W - 160) => { x.font = `${weight} ${size}px ${FONT}`; x.fillStyle = col; x.fillText(fit(s, max), px, py); };
  x.textBaseline = 'alphabetic';
  // En-tête
  x.fillStyle = '#ff375f'; x.beginPath(); x.roundRect(80, 80, 72, 72, 18); x.fill();
  txt('E', 99, 134, 52, 800, '#fff');
  txt('Enora', 172, 132, 44, 700);
  txt(tr('Ma rétrospective'), 80, 250, 76, 800);
  txt(r.label, 80, 306, 36, 500, '#8e8e93');
  // Chiffres
  const box = (bx, by, w, big, small) => {
    x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.roundRect(bx, by, w, 190, 28); x.fill();
    txt(big, bx + 32, by + 100, 84, 800, '#fff', w - 64);
    txt(small, bx + 32, by + 152, 30, 500, '#aeaeb2', w - 64);
  };
  const hours = r.minutes >= 120 ? `${Math.round(r.minutes / 60)} h` : `${r.minutes} min`;
  box(80, 360, 440, String(r.listens), tr(r.listens > 1 ? 'écoutes' : 'écoute'));
  box(560, 360, 440, hours, tr('de musique'));
  // Classements
  const list = (title, rows, py) => {
    txt(title, 80, py, 34, 700, '#ff375f');
    rows.forEach((row, i) => {
      const y = py + 62 + i * 58;
      txt(String(i + 1), 80, y, 34, 700, '#8e8e93');
      txt(row[0], 130, y, 36, 600, '#f5f5f7', 660);
      if (row[1]) txt(row[1], 820, y, 28, 500, '#8e8e93', 180);
    });
    return py + 62 + Math.max(rows.length, 1) * 58 + 26;
  };
  let y = 640;
  y = list(tr('Artistes les plus écoutés'), r.artists.length ? r.artists.map(([a, n]) => [a, `${n} ${tr(n > 1 ? 'écoutes' : 'écoute')}`]) : [['—', '']], y);
  y = list(tr('Titres les plus écoutés'), r.titles.length ? r.titles.slice(0, Math.max(1, Math.min(5, Math.floor((H - y - 240) / 58)))).map((t) => [t[1] ? `${t[0]} · ${t[1]}` : t[0], `${t[2]}×`]) : [['—', '']], y);
  if (r.styles.length && y < H - 150) { txt(tr('Style préféré'), 80, y, 34, 700, '#ff375f'); txt(r.styles.map((s) => s[0]).join(' · '), 80, y + 56, 40, 700); }
  txt(tr('Fait avec Enora · sans publicité'), 80, H - 60, 26, 500, '#8e8e93');
  return c;
}

/* =========================================================================
   Nuage de mots : l'humeur musicale déduite des écoutes (styles, humeurs, rythme, heures, durée)
   ========================================================================= */
// Chaque famille de styles donne un niveau d'énergie (1 à 3) et deux traits d'humeur
const TRAITS = [
  [/amapiano|afrobeats|coupé|ndombolo|makossa|bikutsi|mbalax|zouglou|afro house|dancehall|soca|shatta|reggaeton|salsa|house|techno|edm|danse|fête|afro$/i, 3, ['Festif', 'Dansant']],
  [/rap|drill|trap|métal|metal|rock|sport|motivation|colère|hip-hop/i, 3, ['Énergique', 'Intense']],
  [/r&b|soul|zouk|kompa|rumba|romantique|bachata|sensual/i, 2, ['Romantique', 'Sensuel']],
  [/gospel|louange|devotional/i, 2, ['Spirituel', 'Lumineux']],
  [/lo-?fi|ambient|classi|piano|jazz|blues|calme|détente|sommeil|concentration|travail|acoust/i, 1, ['Posé', 'Rêveur']],
  [/triste|nostalgie|chanson|variété|années/i, 2, ['Nostalgique', 'Sentimental']],
  [/nuit|soirée/i, 2, ['Nocturne', 'Feutré']],
  [/pop|joyeux|tendances|latin|highlife|matin|réveil|cuisine|voiture|électro|electronic|world|monde/i, 2, ['Joyeux', 'Solaire']],
];
const AUDIUS_MOODS = {
  Upbeat: [3, 'Joyeux'], Excited: [3, 'Énergique'], Energizing: [3, 'Énergique'], Rowdy: [3, 'Festif'], Aggressive: [3, 'Intense'], Fiery: [3, 'Intense'], Defiant: [3, 'Intense'],
  Empowering: [2, 'Inspirant'], Stirring: [2, 'Inspirant'], Cool: [2, 'Élégant'], Sophisticated: [2, 'Élégant'], Romantic: [2, 'Romantique'], Sensual: [2, 'Sensuel'], Gritty: [2, 'Brut'],
  Peaceful: [1, 'Posé'], Tender: [1, 'Tendre'], Easygoing: [1, 'Détendu'], Melancholy: [1, 'Mélancolique'], Sentimental: [1, 'Sentimental'], Yearning: [1, 'Nostalgique'], Brooding: [1, 'Nocturne'], Serious: [2, 'Sérieux'],
};

/** Portrait musical d'une période : mots pondérés + phrase de résumé. `history` sert aux heures des écoutes plus anciennes. */
export function musicProfile(period = 'month', history = [], tr = (s) => s) {
  const r = recap(period);
  const mood = {};
  let energy = 0, eW = 0;
  const addMood = (w, n) => { mood[w] = (mood[w] || 0) + n; };
  for (const [style, n] of r.allStyles) {
    const t = TRAITS.find((x) => x[0].test(style));
    if (!t) continue;
    energy += t[1] * n; eW += n;
    addMood(t[2][0], n); addMood(t[2][1], n * 0.6);
  }
  for (const [m, n] of Object.entries(r.moods)) {
    const t = AUDIUS_MOODS[m];
    if (!t) continue;
    energy += t[0] * n; eW += n; addMood(t[1], n);
  }
  // Heures d'écoute : compteurs du mois + historique récent
  const hours = { ...r.hours };
  if (!Object.keys(hours).length) for (const x of history) { const h = new Date(x.t).getHours(); hours[h] = (hours[h] || 0) + 1; }
  const slot = (a, b) => { let n = 0; for (let h = a; h !== b; h = (h + 1) % 24) n += hours[h] || 0; return n; };
  const slots = [['Noctambule', slot(23, 5)], ['Lève-tôt', slot(5, 9)], ['Auditeur du matin', slot(9, 12)], ['Auditeur de l\'après-midi', slot(12, 18)], ['Auditeur du soir', slot(18, 23)]].sort((a, b) => b[1] - a[1]);
  const moods = Object.entries(mood).sort((a, b) => b[1] - a[1]);
  const avg = eW ? energy / eW : 0;
  const tempo = !avg ? '' : avg >= 2.5 ? 'Rythme soutenu' : avg >= 1.7 ? 'Rythme modéré' : 'Rythme lent';
  const words = [];
  const top = Math.max(1, moods[0]?.[1] || 1);
  moods.slice(0, 6).forEach(([w, n]) => words.push({ t: tr(w), w: 0.55 + 0.45 * (n / top), kind: 'mood' }));
  const sTop = Math.max(1, r.allStyles[0]?.[1] || 1);
  r.allStyles.forEach(([w, n]) => words.push({ t: tr(w), w: 0.3 + 0.4 * (n / sTop), kind: 'style' }));
  const aTop = Math.max(1, r.allArtists[0]?.[1] || 1);
  r.allArtists.forEach(([w, n]) => words.push({ t: w, w: 0.22 + 0.4 * (n / aTop), kind: 'artist' }));
  if (tempo) words.push({ t: tr(tempo), w: 0.5, kind: 'fact' });
  if (slots[0][1]) words.push({ t: tr(slots[0][0]), w: 0.46, kind: 'fact' });
  const hrs = r.minutes >= 90 ? `${Math.round(r.minutes / 60)} h` : `${r.minutes} min`;
  if (r.minutes) words.push({ t: `${hrs} ${tr('d\'écoute')}`, w: 0.42, kind: 'fact' });
  if (r.listens) words.push({ t: `${r.listens} ${tr(r.listens > 1 ? 'écoutes' : 'écoute')}`, w: 0.3, kind: 'fact' });
  if (r.listens >= 8) {
    const div = r.distinctArtists / r.listens;
    words.push({ t: tr(div > 0.6 ? 'Explorateur' : div < 0.25 ? 'Fidèle' : 'Curieux'), w: 0.38, kind: 'fact' });
  }
  if (r.minutes >= 600) words.push({ t: tr('Marathonien'), w: 0.36, kind: 'fact' });
  const headline = moods.length
    ? [`${tr(moods[0][0])}${moods[1] ? ` · ${tr(moods[1][0])}` : ''}`, tempo && tr(tempo), slots[0][1] ? tr(slots[0][0]) : '', r.minutes ? `${hrs} ${tr('d\'écoute')}` : ''].filter(Boolean).join(' · ')
    : '';
  // Un même mot (ex. « Romantique » comme humeur et comme catégorie) n'apparaît qu'une fois
  const uniq = new Map();
  for (const w of words) { const k = w.t.toLowerCase(); if (!uniq.has(k) || uniq.get(k).w < w.w) uniq.set(k, w); }
  return { label: r.label, listens: r.listens, words: [...uniq.values()], headline };
}

/** Dessine le nuage (image carrée 1080 × 1080) : les mots les plus importants sont au centre et plus gros. */
export function drawCloud(profile, tr = (s) => s) {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const FONT = '-apple-system, "SF Pro Display", Inter, "Segoe UI", "Noto Sans", sans-serif';
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const glow = (cx, cy, rad, col) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); };
  glow(920, 140, 600, 'rgba(255,55,95,.5)'); glow(120, 1000, 560, 'rgba(94,92,230,.45)');
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#ff375f'; x.beginPath(); x.roundRect(64, 56, 60, 60, 15); x.fill();
  x.font = `800 44px ${FONT}`; x.fillStyle = '#fff'; x.fillText('E', 79, 102);
  x.font = `700 38px ${FONT}`; x.fillStyle = '#f5f5f7'; x.fillText(tr('Mon nuage musical'), 142, 86);
  x.font = `500 26px ${FONT}`; x.fillStyle = '#8e8e93'; x.fillText(profile.label, 142, 120);
  const COLORS = { mood: ['#ffffff', '#ff6482', '#ff375f'], style: ['#bf5af2', '#da8fff', '#9d8cff'], artist: ['#d1d1d6', '#aeaeb2', '#e5e5ea'], fact: ['#ff9f0a', '#ffd60a', '#64d2ff'] };
  const placed = [];
  const hit = (r) => placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
  const words = profile.words.slice().sort((a, b) => b.w - a.w).slice(0, 38);
  const cx = W / 2, cy = H / 2 + 50;
  words.forEach((wd, i) => {
    let size = Math.round(34 + 118 * Math.pow(wd.w, 1.5));
    const weight = wd.kind === 'mood' ? 800 : wd.kind === 'artist' ? 600 : 700;
    for (let attempt = 0; attempt < 4; attempt++) {
      x.font = `${weight} ${size}px ${FONT}`;
      const w = Math.min(x.measureText(wd.t).width, W - 120) + 22, h = size * 1.08 + 10;
      for (let t = 0; t < 900; t++) {
        const a = t * 0.31 + i, rad = 3.6 * t * 0.9;
        const r = { x: cx + Math.cos(a) * rad * 1.15 - w / 2, y: cy + Math.sin(a) * rad * 0.82 - h / 2, w, h };
        if (r.x < 40 || r.y < 170 || r.x + w > W - 40 || r.y + h > H - 70 || hit(r)) continue;
        placed.push(r);
        x.fillStyle = COLORS[wd.kind][i % 3];
        x.globalAlpha = wd.kind === 'artist' ? 0.9 : 1;
        x.fillText(wd.t, r.x + 11, r.y + h - size * 0.24 - 5, W - 120);
        x.globalAlpha = 1;
        return;
      }
      size = Math.round(size * 0.78); // pas de place : on réessaie plus petit
    }
  });
  x.font = `500 24px ${FONT}`; x.fillStyle = '#8e8e93'; x.fillText(tr('Fait avec Enora · sans publicité'), 64, H - 34);
  return c;
}
