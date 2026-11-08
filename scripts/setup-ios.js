// Prépare le projet iPhone :
//  1. Copie le script anti-pub (adblock/youtube-adblock.js) dans le plugin Swift
//  2. Ajoute à Info.plist : lecture audio en arrière-plan + autorisation des radios en http
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'adblock', 'youtube-adblock.js'), 'utf8');

const BLOCK_PATTERNS = [
  '.*doubleclick\\.net',
  '.*googlesyndication\\.com',
  '.*googleadservices\\.com',
  '.*googletagservices\\.com',
  '.*adservice\\.google\\.',
  '.*2mdn\\.net',
  '.*youtube\\.com/pagead/',
  '.*youtube\\.com/api/stats/ads',
  '.*youtube\\.com/ptracking',
  '.*youtube\\.com/get_midroll_',
  '.*youtube\\.com/youtubei/v1/player/ad_break',
  '.*youtube\\.com/pcs/activeview',
  '.*adnxs\\.com',
  '.*amazon-adsystem\\.com',
  '.*moatads\\.com',
  '.*scorecardresearch\\.com',
  '.*popads\\.net',
  '.*popcash\\.net',
  '.*propellerads\\.com',
  '.*propellerclick\\.com',
  '.*exoclick\\.com',
  '.*exosrv\\.com',
  '.*adsterra\\.com',
  '.*juicyads\\.com',
  '.*hilltopads\\.net',
  '.*onclickads\\.net',
  '.*clickadu\\.com',
  '.*adcash\\.com',
  '.*monetag\\.com',
  '.*mgid\\.com',
  '.*admaven\\.com',
];
const rules = BLOCK_PATTERNS.map((p) => ({ trigger: { 'url-filter': p }, action: { type: 'block' } }));
rules.push({
  trigger: { 'url-filter': '.*', 'if-domain': ['*youtube.com'] },
  action: {
    type: 'css-display-none',
    selector: '.video-ads, .ytp-ad-module, .ytp-ad-overlay-container, ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-banner-promo-renderer, ytd-companion-slot-renderer, #player-ads, #masthead-ad, ad-slot-renderer, ytm-promoted-sparkles-web-renderer, ytm-promoted-video-renderer, ytm-companion-ad-renderer, ytm-companion-slot',
  },
});

if (js.includes('"""#')) throw new Error('Le script contient une séquence incompatible avec Swift');
const swift = `// Fichier généré automatiquement par scripts/setup-ios.js — ne pas modifier à la main.
// Source : adblock/youtube-adblock.js
import Foundation

enum AdblockScripts {
    static let youtubeScript: String = #"""
${js}
"""#

    /// Mode « audio seul » : ajoute/retire une feuille de style qui masque la vidéo.
    static let audioOnlyScript: String = #"""
(function () {
  var id = 'sonora-audio-only';
  var css = 'video { opacity: 0 !important; } .html5-video-player, #movie_player, #player-container-inner, ytm-player, .player-container { background: linear-gradient(135deg, #8b5cf6, #ec4899) !important; }';
  var s = document.getElementById(id);
  if (window.__sonoraAudioOnly) {
    if (!s) { s = document.createElement('style'); s.id = id; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  } else if (s) { s.remove(); }
})();
"""#

    static let contentRules: String = #"""
${JSON.stringify(rules, null, 2)}
"""#
}
`;
const swiftPath = path.join(ROOT, 'plugins', 'youtube-adblock', 'ios', 'Sources', 'YouTubeAdblockPlugin', 'AdblockScripts.swift');
fs.writeFileSync(swiftPath, swift);
console.log('✓ Script anti-pub copié dans le plugin iOS');

const plist = path.join(ROOT, 'ios', 'App', 'App', 'Info.plist');
if (fs.existsSync(plist)) {
  let s = fs.readFileSync(plist, 'utf8');
  const add = [];
  if (!s.includes('<key>UIBackgroundModes</key>')) {
    add.push('\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>');
  }
  if (!s.includes('<key>NSAppTransportSecurity</key>')) {
    add.push('\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t\t<key>NSAllowsArbitraryLoadsForMedia</key>\n\t\t<true/>\n\t\t<key>NSAllowsArbitraryLoadsInWebContent</key>\n\t\t<true/>\n\t</dict>');
  }
  if (add.length) {
    const idx = s.lastIndexOf('</dict>');
    s = s.slice(0, idx) + add.join('\n') + '\n' + s.slice(idx);
    fs.writeFileSync(plist, s);
    console.log('✓ Info.plist : audio en arrière-plan + radios http autorisées');
  } else {
    console.log('✓ Info.plist déjà configuré');
  }
} else {
  console.log('(i) Pas encore de projet iOS : lancez « npm run ios:add » sur un Mac.');
}
