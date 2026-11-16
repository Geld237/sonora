// Préchargement des titres suivants de la file d'attente, pour éviter les coupures.
// Seulement les fichiers audio servis directement (Audius, Internet Archive, podcasts) :
// le son de YouTube ne peut pas être récupéré à l'avance (règles de YouTube).
// Les fichiers restent en mémoire, jamais enregistrés, et sont oubliés dès qu'ils ne sont plus dans la file.

const MAX_FILE = 60e6;   // un fichier plus gros (long podcast) n'est pas préchargé
const MAX_TOTAL = 160e6; // mémoire maximale utilisée par le préchargement

const cache = new Map(); // clé du titre -> { blob, size, ctrl, failed }
let queue = [];          // titres à précharger, dans l'ordre
let running = false;
let delayTimer = null;

export function canPrefetch(t) {
  return !!t && t.kind === 'audio' && !t.live && !t.mediaId && typeof t.src === 'string' && /^https?:/.test(t.src);
}

/** Fichier déjà préchargé pour ce titre, ou null. */
export function prefetched(t) {
  const e = t && cache.get(t.key);
  return e && e.blob ? e.blob : null;
}

function totalSize() { let s = 0; for (const e of cache.values()) s += e.size || 0; return s; }

/**
 * Précharge `tracks` (titres à venir) en gardant aussi `keep` (titre en cours).
 * Tout le reste est oublié ; les téléchargements devenus inutiles sont annulés.
 */
export function prefetchTracks(tracks, keep = null, delay = 0) {
  const wanted = tracks.filter(canPrefetch);
  const keepKeys = new Set(wanted.map((t) => t.key));
  if (keep?.key) keepKeys.add(keep.key);
  for (const [k, e] of cache) {
    if (keepKeys.has(k)) continue;
    try { e.ctrl?.abort(); } catch (_) {}
    cache.delete(k);
  }
  queue = wanted.filter((t) => !cache.has(t.key));
  clearTimeout(delayTimer);
  // Petit délai : le titre en cours démarre d'abord sans partager la connexion
  delayTimer = setTimeout(pump, delay);
}

export function clearPrefetch() { prefetchTracks([], null); }

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const t = queue.shift();
      if (cache.has(t.key)) continue;
      if (totalSize() > MAX_TOTAL - 5e6) break;
      await fetchOne(t);
    }
  } finally { running = false; }
}

async function fetchOne(t) {
  const ctrl = new AbortController();
  const entry = { blob: null, size: 0, ctrl, failed: false };
  cache.set(t.key, entry);
  try {
    const res = await fetch(t.src, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const announced = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    if (announced > MAX_FILE) throw new Error('trop gros');
    const type = res.headers.get('content-type') || 'audio/mpeg';
    const chunks = [];
    let got = 0;
    const reader = res.body?.getReader?.();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (got > MAX_FILE || totalSize() + got > MAX_TOTAL) { ctrl.abort(); throw new Error('trop gros'); }
      }
    } else {
      const b = await res.blob();
      chunks.push(b); got = b.size;
    }
    if (cache.get(t.key) !== entry) return; // oublié entre-temps
    entry.blob = new Blob(chunks, { type });
    entry.size = entry.blob.size;
    entry.ctrl = null;
  } catch (_) {
    // Échec (serveur qui refuse, réseau, fichier trop gros) : on garde la trace pour ne pas réessayer en boucle
    if (cache.get(t.key) === entry) { entry.failed = true; entry.ctrl = null; entry.size = 0; }
  }
}
