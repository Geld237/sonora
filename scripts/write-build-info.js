// Écrit www/js/build-info.js (version, dépôt GitHub, canal) avant une compilation.
// Usage : node scripts/write-build-info.js github|play
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const channel = ['play', 'web'].includes(process.argv[2]) ? process.argv[2] : 'github';
const version = require(path.join(ROOT, 'package.json')).version;
const repo = process.env.GITHUB_REPOSITORY || '';
// Clé YouTube intégrée : version web seulement (secret GitHub YOUTUBE_API_KEY, jamais écrit dans le dépôt).
// Les applications Windows / Android / iPhone n'en ont pas besoin (méthode sans clé).
const ytKey = channel === 'web' ? (process.env.YOUTUBE_API_KEY || '').trim() : '';
const info = { version, repo, channel };
if (ytKey) info.ytKey = ytKey;
const out = `// Fichier généré par scripts/write-build-info.js — ne pas modifier à la main.
export const BUILD = ${JSON.stringify(info)};
`;
fs.writeFileSync(path.join(ROOT, 'www', 'js', 'build-info.js'), out);
console.log(`✓ build-info : version ${version}, dépôt « ${repo || '—'} », canal ${channel}${ytKey ? ', clé YouTube intégrée' : ''}`);
