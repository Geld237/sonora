// Mises à jour de Enora.
//  - Windows (installateur) : téléchargement et installation automatiques (electron-updater, depuis GitHub Releases)
//  - Windows portable, Android (APK GitHub), iPhone : l'application vérifie GitHub et propose la nouvelle version
//  - Android Play Store : les mises à jour passent par le Play Store
import { BUILD } from './build-info.js';
import { platform } from './platform.js';

const SKIP_KEY = 'sonora.update.skip';

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

export function currentVersion() { return BUILD.version; }

/** Retourne { version, url, notes } si une nouvelle version existe, sinon null. */
export async function checkForUpdate({ force = false } = {}) {
  if (!BUILD.repo || BUILD.channel === 'play' || platform === 'web') return null; // web : mise à jour par le service worker
  const res = await fetch(`https://api.github.com/repos/${BUILD.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!version || !newer(version, BUILD.version)) return null;
  if (!force) { try { if (localStorage.getItem(SKIP_KEY) === version) return null; } catch (_) {} }
  const assets = rel.assets || [];
  const pick = (re) => assets.find((a) => re.test(a.name))?.browser_download_url;
  const url = platform === 'android' ? (pick(/\.apk$/i) || rel.html_url)
    : platform === 'electron' ? ({
      darwin: pick(/mac.*\.dmg$/i),
      linux: pick(/\.AppImage$/i) || pick(/\.deb$/i),
    }[window.sonora?.os] || pick(/portable.*\.exe$/i) || pick(/setup.*\.exe$/i) || rel.html_url)
    : rel.html_url; // iPhone : page de la version (fichier .ipa à réinstaller avec Sideloadly)
  return { version, url, page: rel.html_url, notes: (rel.body || '').slice(0, 400) };
}

export function skipVersion(v) { try { localStorage.setItem(SKIP_KEY, v); } catch (_) {} }
