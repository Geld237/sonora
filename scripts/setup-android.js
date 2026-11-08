// Prépare le projet Android :
//  1. Copie le script anti-pub et la liste de blocage dans le plugin Android (assets)
//  2. Autorise les radios en http (cleartext) dans AndroidManifest.xml
//  3. Ajoute la signature (clé du Play Store) et le numéro de version à android/app/build.gradle
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'plugins', 'youtube-adblock', 'android', 'src', 'main', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// --- 1. scripts et liste de blocage ---
fs.copyFileSync(path.join(ROOT, 'adblock', 'youtube-adblock.js'), path.join(ASSETS, 'sonora-adblock.js'));
fs.writeFileSync(path.join(ASSETS, 'sonora-audio-only.js'), `(function () {
  var id = 'sonora-audio-only';
  var css = 'video { opacity: 0 !important; } .html5-video-player, #movie_player, ytm-player, .player-container { background: linear-gradient(135deg, #8b5cf6, #ec4899) !important; }';
  var s = document.getElementById(id);
  if (window.__sonoraAudioOnly) {
    if (!s) { s = document.createElement('style'); s.id = id; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  } else if (s) { s.remove(); }
})();
`);
// Même liste que Windows (electron/main.js) : domaines bloqués, puis chemins bloqués (contenant « / »)
const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const filters = [...main.matchAll(/'\*:\/\/([^']+)'/g)].map((m) => m[1]);
const lines = ['# Généré par scripts/setup-android.js depuis electron/main.js'];
for (const f of filters) {
  const host = f.split('/')[0].replace(/^\*\./, '');
  const rest = f.slice(f.indexOf('/')).replace(/\*+$/, '').replace(/\*/g, '');
  lines.push(rest && rest !== '/' ? host + rest : host);
}
fs.writeFileSync(path.join(ASSETS, 'sonora-block.txt'), [...new Set(lines)].join('\n') + '\n');
console.log(`✓ Bloqueur Android : ${lines.length - 1} règles`);

// --- 2. AndroidManifest : radios http ---
const manifest = path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifest)) {
  let m = fs.readFileSync(manifest, 'utf8');
  if (!m.includes('usesCleartextTraffic')) {
    m = m.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
    fs.writeFileSync(manifest, m);
    console.log('✓ AndroidManifest : radios http autorisées');
  }
}

// --- 3. build.gradle : version + signature ---
const gradle = path.join(ROOT, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradle)) {
  let g = fs.readFileSync(gradle, 'utf8');
  if (!g.includes('SONORA_SIGNING')) {
    g = g.replace(/versionCode \d+/, 'versionCode((System.getenv("VERSION_CODE") ?: "1") as Integer)');
    g = g.replace(/versionName "[^"]*"/, 'versionName(System.getenv("VERSION_NAME") ?: "1.0.0")');
    g = g.replace('    buildTypes {', `    // SONORA_SIGNING : signature de la version Play Store / GitHub (clé fournie par les secrets GitHub)
    signingConfigs {
        release {
            def ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {`);
    g = g.replace(/release \{\n\s*minifyEnabled false/, (m) => m.replace('release {', 'release {\n            if (System.getenv("ANDROID_KEYSTORE_PATH")) signingConfig signingConfigs.release'));
    fs.writeFileSync(gradle, g);
    console.log('✓ build.gradle : version et signature configurées');
  }
} else {
  console.log('(i) Pas encore de projet Android : lancez « npx cap add android ».');
}
