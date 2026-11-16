#!/usr/bin/env node
// Source SideStore / AltStore d'Enora : liste la dernière version de l'application iPhone,
// pour que SideStore propose chaque mise à jour avec un bouton « Mettre à jour ».
// Utilisation (dans la publication) : node scripts/make-altsource.js <version> <fichier.ipa> <numéro de build>
// Adresse à ajouter dans SideStore : https://github.com/<dépôt>/releases/latest/download/enora-source.json
const fs = require('fs');
const path = require('path');

const [version, ipa, build = '1'] = process.argv.slice(2);
if (!version || !ipa || !fs.existsSync(ipa)) { console.error('usage : make-altsource.js <version> <fichier.ipa> [build]'); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY || 'Geld237/sonora';
const [owner, name] = repo.split('/');
const site = `https://${owner.toLowerCase()}.github.io/${name}/`;
const tint = '#FF375F';

const source = {
  name: 'Enora',
  identifier: `io.github.${owner.toLowerCase()}.${name}.source`,
  subtitle: 'Musique, films et radio, sans publicité',
  description: 'Source officielle d\'Enora pour SideStore et AltStore : chaque nouvelle version y apparaît avec un bouton de mise à jour.',
  iconURL: `${site}icons/icon-512.png`,
  website: `https://github.com/${repo}`,
  tintColor: tint,
  apps: [{
    name: 'Enora',
    bundleIdentifier: 'com.sonora.app',
    developerName: owner,
    subtitle: 'Musique, films et radio, sans publicité',
    localizedDescription: pkg.description || 'Enora : musique, films et radio, sans publicité, avec bibliothèque hors ligne.',
    iconURL: `${site}icons/icon-512.png`,
    tintColor: tint,
    category: 'entertainment',
    screenshots: [],
    versions: [{
      version,
      buildVersion: String(build),
      date: new Date().toISOString().slice(0, 10),
      localizedDescription: `Enora ${version}. Nouveautés : https://github.com/${repo}/releases/tag/v${version}`,
      downloadURL: `https://github.com/${repo}/releases/download/v${version}/${path.basename(ipa)}`,
      size: fs.statSync(ipa).size,
      minOSVersion: '15.0',
    }],
    appPermissions: { entitlements: [], privacy: {} },
  }],
  news: [],
};
fs.writeFileSync('enora-source.json', JSON.stringify(source, null, 2) + '\n');
console.log(`✓ enora-source.json (Enora ${version}, ${source.apps[0].versions[0].size} octets)`);
