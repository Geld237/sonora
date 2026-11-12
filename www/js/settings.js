// Réglages de l'application (enregistrés sur l'appareil).
const KEY = 'sonora.settings';
const DEFAULTS = {
  streamQuality: 'normal',   // low | normal | high  — musique libre en streaming
  downloadQuality: 'high',   // low | normal | high  — musique libre téléchargée
  filmDownload: 'light',     // light | high         — films téléchargés
  eq: 'off',                 // égaliseur (fichiers sur l'appareil)
  normalize: 'off',          // normalisation du volume : on | off
  crossfade: '0',            // fondu enchaîné entre deux fichiers de l'appareil : secondes (0 = désactivé)
  dataSaver: 'auto',         // économie de données : auto (réseau mobile) | on | off
  theme: 'auto',             // auto (comme l'appareil) | dark | light
  lang: 'auto',              // auto | fr | en
  autoRadio: 'on',           // lecture continue : radio du dernier titre à la fin de la file d'attente
  autoLyrics: 'on',          // paroles automatiques (LRCLIB)
  lyricsShow: 'on',          // paroles affichées dans le lecteur : on | off
  lyricsPos: 'side',         // sur grand écran : à droite du lecteur (side) ou en dessous (below)
  showMixes: 'off',          // compilations et mix dans les listes de musique : on | off
};

/** Économie de données active ? « auto » = réseau mobile ou mode économie du téléphone. */
export function dataSaverActive() {
  const v = getSettings().dataSaver;
  if (v === 'on') return true;
  if (v === 'off') return false;
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return !!c && (c.saveData === true || c.type === 'cellular');
}

export function getSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch (_) { return { ...DEFAULTS }; }
}
export function setSetting(name, value) {
  const s = getSettings();
  s[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
  markSettingsChanged();
  return s;
}

/** Date de la dernière modification des réglages (pour la synchronisation du compte). */
export const SETTINGS_TS_KEY = 'sonora.cloud.settingsTs';
export function markSettingsChanged() { try { localStorage.setItem(SETTINGS_TS_KEY, String(Date.now())); } catch (_) {} }
export function settingsChangedAt() { try { return +localStorage.getItem(SETTINGS_TS_KEY) || 0; } catch (_) { return 0; } }
