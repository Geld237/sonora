// Vérifications rapides du projet : à lancer avant chaque proposition de modification (npm run check).
// Elles sont aussi lancées automatiquement par GitHub sur chaque Pull Request (workflow « Vérifications »).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let errors = 0;
const fail = (msg) => { errors++; console.error('✗ ' + msg); };
const ok = (msg) => console.log('✓ ' + msg);
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));

// 1. Syntaxe JavaScript
const modules = list('www/js', '.js');
const scripts = [...list('electron', '.js'), ...list('scripts', '.js'), 'adblock/youtube-adblock.js', 'www/sw.js'];
for (const f of modules) {
  try { execFileSync(process.execPath, ['--check', '--input-type=module'], { input: fs.readFileSync(path.join(ROOT, f)), stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { fail(`${f} : ${String(e.stderr).split('\n').find((l) => /Error/.test(l)) || 'erreur de syntaxe'}`); }
}
for (const f of scripts) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { fail(`${f} : ${String(e.stderr).split('\n').find((l) => /Error/.test(l)) || 'erreur de syntaxe'}`); }
}
ok(`syntaxe JavaScript : ${modules.length + scripts.length} fichiers`);

// 2. Fichiers JSON
for (const f of ['package.json', 'capacitor.config.json', 'www/manifest.webmanifest', 'plugins/youtube-adblock/package.json']) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { fail(`${f} : JSON invalide (${e.message})`); }
}
ok('fichiers JSON');

// 3. Tous les modules importés existent
for (const f of modules) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/from\s+'(\.\/[^']+)'/g)) {
    if (!fs.existsSync(path.join(ROOT, 'www/js', m[1]))) fail(`${f} importe ${m[1]}, introuvable`);
  }
}
ok('imports des modules');

// 4. Aucun secret dans le code (clés API, clés privées)
const SECRET = /(AIza[0-9A-Za-z_-]{35})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) return ['node_modules', '.git', 'dist', 'dist-exe', 'build', 'public', 'fonts', '.gradle'].includes(d.name) ? [] : walk(p);
  return /\.(js|json|html|css|md|yml|yaml|java|swift|gradle|xml|plist|txt)$/.test(d.name) ? [p] : [];
});
for (const f of walk('.')) {
  if (f.endsWith('build-info.js')) continue; // généré au moment de la publication
  if (SECRET.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) fail(`${f} semble contenir une clé secrète : utilisez les secrets GitHub`);
}
for (const f of walk('.').filter((x) => /\.(jks|keystore)$/.test(x))) fail(`${f} : une clé de signature ne doit jamais être dans le dépôt`);
ok('aucun secret dans le code');

if (errors) { console.error(`\n${errors} problème(s) à corriger.`); process.exit(1); }
console.log('\nTout est bon.');
