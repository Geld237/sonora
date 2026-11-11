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
  const out = { n: 0, s: 0, a: {}, t: {}, g: {} };
  for (const k of keys) {
    const m = all[k];
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
