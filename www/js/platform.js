// Détection de la plateforme : Windows (Electron), iPhone / Android (Capacitor) ou simple navigateur.
const cap = window.Capacitor;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

export const platform = window.sonora?.platform === 'electron'
  ? 'electron'
  : native
    ? (typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android' ? 'android' : 'ios')
    : 'web';

/** Téléphone (iPhone ou Android) */
export const isMobile = platform === 'ios' || platform === 'android';

/** iPhone / Android : ouvre une page (YouTube ou un site) dans un navigateur natif équipé du bloqueur de pub (plugin Swift). */
export async function openWebNative(url = 'https://m.youtube.com', options = {}) {
  if (!cap) throw new Error('Capacitor indisponible');
  const args = { url, audioOnly: !!options.audioOnly, adblock: options.adblock !== false };
  if (typeof cap.nativePromise === 'function') return cap.nativePromise('YouTubeAdblock', 'open', args);
  const plugin = cap.Plugins?.YouTubeAdblock || (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('YouTubeAdblock') : null);
  if (!plugin) throw new Error('Module YouTube indisponible');
  return plugin.open(args);
}

export const openYouTubeNative = openWebNative;
