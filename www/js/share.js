// Partage de playlist par lien / QR code, et import d'une liste de titres (texte ou CSV).
const b64u = {
  enc: (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; },
};
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Une piste partageable est une piste en ligne (YouTube, radio, podcast, archive) : pas un fichier de l'appareil. */
function pack(t) {
  if (t.kind === 'youtube' && t.ytId) return ['y', t.ytId, t.title || '', t.artist || '', t.duration || 0];
  if (/^https?:/.test(t.src || '')) return ['s', t.src, t.title || '', t.artist || '', /^https?:/.test(t.cover || '') ? t.cover : '', t.kind || 'audio', t.duration || 0, t.origin || '', t.live ? 1 : 0, t.key || ''];
  return null;
}
function unpack(a) {
  if (a[0] === 'y') return { key: `yt:${a[1]}`, ytId: a[1], title: a[2], artist: a[3] || 'YouTube', cover: `https://i.ytimg.com/vi/${a[1]}/hqdefault.jpg`, kind: 'youtube', origin: 'youtube', duration: a[4] || 0 };
  if (a[0] === 's' && /^https?:/.test(a[1])) return { key: a[9] || `url:${a[1]}`, src: a[1], title: a[2], artist: a[3], cover: a[4] || '', kind: a[5] === 'video' ? 'video' : 'audio', duration: a[6] || 0, origin: a[7] || '', live: !!a[8] };
  return null;
}

export async function encodePlaylist(p) {
  const tracks = p.tracks.map(pack).filter(Boolean);
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, n: p.name, t: tracks }));
  let code;
  if (typeof CompressionStream === 'function') { try { code = 'z' + b64u.enc(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (_) {} }
  if (!code) code = 'j' + b64u.enc(bytes);
  return { code, count: tracks.length, skipped: p.tracks.length - tracks.length };
}

export async function decodePlaylist(input) {
  let code = String(input || '').trim();
  const m = code.match(/[#&?]pl=([A-Za-z0-9_-]+)/);
  if (m) code = m[1];
  if (!/^[zj][A-Za-z0-9_-]+$/.test(code)) throw new Error('Lien de playlist invalide');
  let bytes = b64u.dec(code.slice(1));
  if (code[0] === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('Cet appareil ne peut pas lire ce lien');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (!d || !Array.isArray(d.t)) throw new Error('Lien de playlist invalide');
  return { name: String(d.n || 'Playlist partagée').slice(0, 80), tracks: d.t.slice(0, 500).map(unpack).filter(Boolean) };
}

/* ---------- Import d'une liste de titres ---------- */
function csvRow(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Texte (« Artiste - Titre » par ligne) ou CSV (colonnes titre / artiste) -> [{ title, artist }]. */
export function parseTrackList(raw) {
  const lines = String(raw || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const sep = [',', ';', '\t'].map((s) => [s, lines[0].split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = csvRow(lines[0], sep).map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ti = col(/^(track name|title|titre|name|nom|track|song|chanson)$/);
  const ai = col(/^(artist name\(s\)|artist name|artist|artiste|artists|artistes|interprète)$/);
  const out = [];
  if (ti >= 0) {
    for (const l of lines.slice(1)) {
      const c = csvRow(l, sep);
      if (c[ti]) out.push({ title: c[ti], artist: ai >= 0 ? (c[ai] || '').split(/[;,]/)[0].trim() : '' });
    }
  } else {
    for (const l of lines) {
      const s = l.replace(/^\s*\d+\s*[.)\-:]\s*/, '').replace(/^[-•*]\s*/, '').trim();
      if (!s || /^https?:\/\//.test(s)) continue;
      const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      out.push(m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: s });
    }
  }
  return out.slice(0, 200);
}
