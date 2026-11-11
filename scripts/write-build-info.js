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
// Compte Enora : identifiants Firebase (secrets GitHub FIREBASE_API_KEY et FIREBASE_PROJECT_ID), pour toutes les versions
const fbKey = (process.env.FIREBASE_API_KEY || '').trim();
const fbProject = (process.env.FIREBASE_PROJECT_ID || '').trim();
if (fbKey && fbProject) info.firebase = { apiKey: fbKey, projectId: fbProject };
// Sites de streaming préconfigurés (variable ou secret GitHub SONORA_SITES), un par ligne : « Nom | https://adresse »
const sites = (process.env.SONORA_SITES || '').split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.split('|').map((x) => x.trim());
  const url = (m.length > 1 ? m[1] : m[0]).replace(/^(?!https?:\/\/)/i, 'https://');
  try { const u = new URL(url); return { name: m.length > 1 && m[0] ? m[0] : u.hostname.replace(/^www\./, ''), url: u.href }; } catch (_) { return null; }
}).filter(Boolean);
if (sites.length) info.sites = sites;
if (ytKey) info.ytKey = ytKey;
// Audius (facultatif) : clé gratuite si le service en demande une (secret GitHub AUDIUS_API_KEY)
const audiusKey = (process.env.AUDIUS_API_KEY || '').trim();
if (audiusKey) info.audiusKey = audiusKey;
const out = `// Fichier généré par scripts/write-build-info.js — ne pas modifier à la main.
export const BUILD = ${JSON.stringify(info)};
`;
fs.writeFileSync(path.join(ROOT, 'www', 'js', 'build-info.js'), out);
console.log(`✓ build-info : version ${version}, dépôt « ${repo || '—'} », canal ${channel}${ytKey ? ', clé YouTube intégrée' : ''}${info.firebase ? ', compte activé' : ''}${info.sites ? `, ${info.sites.length} site(s) préconfiguré(s)` : ''}`);
