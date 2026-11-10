// Réglages de l'application (enregistrés sur l'appareil).
const KEY = 'sonora.settings';
const DEFAULTS = {
  streamQuality: 'normal',   // low | normal | high  — musique libre en streaming
  downloadQuality: 'high',   // low | normal | high  — musique libre téléchargée
  filmDownload: 'light',     // light | high         — films téléchargés
  eq: 'off',                 // égaliseur (fichiers sur l'appareil)
  normalize: 'off',          // normalisation du volume : on | off
};

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
