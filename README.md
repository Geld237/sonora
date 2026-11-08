# Sonora — musique, films, radio et YouTube sans publicité

Application d'écoute **en ligne et hors-ligne** pour **Windows** et **iPhone** (un seul code).

## Fonctionnalités

| Onglet | Ce qu'il fait | Source |
|---|---|---|
| 📚 Bibliothèque | Musique et vidéos **hors-ligne** (import de fichiers, glisser-déposer sur Windows), **favoris**, **playlists** | Stockage local (IndexedDB) |
| 🎵 Musique | Des milliers d'albums d'artistes indépendants, recherche, genres, **téléchargement pour le hors-ligne (⬇)** | Internet Archive (gratuit, légal) |
| 🎬 Films | Films du domaine public en streaming, catégories, téléchargement | Internet Archive |
| 📻 Radio | Plus de 40 000 radios en direct, par pays et par genre | Radio Browser |
| ▶️ YouTube | YouTube complet avec **bloqueur de publicités** | youtube.com |
| 🌐 Sites | Vos **liens de sites de streaming** (ajout, modification, suppression), ouverts dans l'app avec **bloqueur de pubs et de pop-ups** | Liens ajoutés par l'utilisateur (Arte.tv et Internet Archive pré-remplis) |

Lecteur : lecture/pause, suivant/précédent, aléatoire, répétition (tout / un titre), barre de progression, volume, file d'attente, **minuterie de sommeil**, commandes sur l'écran verrouillé, lecture en arrière-plan (iPhone), raccourcis clavier (Espace, Ctrl+←/→).

**Aucune publicité, aucune clé API, aucun compte nécessaire.**

## Le bloqueur de publicités

1. **Blocage réseau** : les requêtes vers les serveurs publicitaires (doubleclick.net, googlesyndication.com, youtube.com/pagead, /api/stats/ads…) sont annulées avant de partir.
   - Windows : `session.webRequest.onBeforeRequest` d'Electron (`electron/main.js`)
   - iPhone : règles `WKContentRuleList` de WebKit, le même moteur que les bloqueurs Safari (`scripts/setup-ios.js`)
2. **Nettoyage des données** : le script `adblock/youtube-adblock.js` est injecté au début de chaque page YouTube. Il retire les champs `adPlacements`, `playerAds` et `adSlots` des réponses JSON avant que le lecteur ne les lise : la pub n'est jamais programmée.
3. **Bloqueur de pop-ups** (onglet Sites) : seules les fenêtres du même site s'ouvrent, et les régies de pop-ups (popads, propellerads, exoclick, adsterra…) sont bloquées.
4. **Filet de sécurité** : une feuille de style masque les emplacements publicitaires. Si une pub vidéo passe quand même, elle est coupée, avancée jusqu'à la fin et le bouton « Passer » est cliqué automatiquement.

## Lancer sur Windows

**Version prête à l'emploi :** décompressez `Sonora-Windows.zip`, puis double-cliquez sur `Sonora.exe`.
Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même** (l'application n'est pas signée, c'est normal pour un projet étudiant).

**Depuis le code source** (Node.js 20+ requis) :
```bash
npm install
npm start            # lance l'application
npm run build:win    # recrée Sonora.exe dans dist/
```

## Lancer sur iPhone (Mac + Xcode obligatoires)

1. Sur un Mac, installez **Xcode** (App Store) et **Node.js** (nodejs.org).
2. Dans le dossier du projet :
   ```bash
   npm install
   npm run ios:sync
   npm run ios:open
   ```
3. Dans Xcode : cliquez sur **App** (à gauche), puis sur l'onglet **Signing & Capabilities**. Dans **Team**, choisissez votre identifiant Apple (bouton *Add Account* s'il n'y est pas ; un compte gratuit suffit). Si Xcode signale un conflit d'identifiant, remplacez `com.sonora.app` par `com.votrenom.sonora`.
4. Branchez l'iPhone en USB, sélectionnez-le en haut de Xcode, puis cliquez sur **▶ (Run)**.
5. Sur l'iPhone :
   - activez **Réglages → Confidentialité et sécurité → Mode développeur** (l'iPhone redémarre) ;
   - faites confiance au certificat dans **Réglages → Général → VPN et gestion de l'appareil**.

Le premier lancement de Xcode télécharge Capacitor (quelques minutes, internet nécessaire).

### Publication sur l'App Store (plus tard)
Elle demande un compte **Apple Developer** (99 $/an). Dans Xcode, passez par **Product → Archive**, puis **Distribute App → App Store Connect**. Remplissez ensuite la fiche dans App Store Connect et soumettez l'app : la validation par Apple prend de 1 à 3 jours.
⚠️ Apple refuse les applications qui bloquent les publicités de YouTube (règles 5.2.2 et 5.2.3). Pour une publication, il faudrait retirer l'onglet YouTube. Le reste de l'application (Internet Archive, radios, fichiers locaux) est conforme.

## Structure du projet

```
www/                     Interface commune (HTML/CSS/JavaScript)
  js/app.js              Vues : bibliothèque, musique, films, radio, YouTube
  js/player.js           Lecteur audio/vidéo, file d'attente, minuterie
  js/api.js              Internet Archive + Radio Browser
  js/db.js               Stockage hors-ligne (IndexedDB)
  js/platform.js         Détection Windows / iPhone
adblock/youtube-adblock.js   Script anti-pub (partagé Windows + iPhone)
electron/main.js         Application Windows + blocage réseau
plugins/youtube-adblock/ Plugin iOS en Swift (navigateur YouTube anti-pub)
ios/                     Projet Xcode (Capacitor)
scripts/setup-ios.js     Copie le script anti-pub dans le plugin + configure Info.plist
```

## Technologies
- **Electron** (Windows) et **Capacitor 8** (iPhone) : un seul code web pour les deux plateformes
- **HTML5 Audio/Video**, **Media Session API**, **IndexedDB**
- **Swift / WebKit** : `WKWebView`, `WKContentRuleList`, `WKUserScript`

## Installer sur iPhone depuis Windows (sans Mac)

1. **Compiler sur GitHub (gratuit)** : créez un dépôt GitHub (de préférence **public**, les minutes Mac y sont gratuites), puis envoyez-y tout le contenu du projet, y compris le dossier `.github`. Dans l'onglet **Actions**, ouvrez **Build iOS**, cliquez sur **Run workflow** et attendez 10 à 20 min. Téléchargez ensuite l'artefact **Sonora-ipa** et décompressez-le pour obtenir `Sonora.ipa`.
2. **Installer avec Sideloadly** : sur sideloadly.io, téléchargez et installez Sideloadly. Installez aussi **iTunes** et **iCloud** en version « web » (sur apple.com, pas celles du Microsoft Store). Branchez l'iPhone en USB et faites-lui confiance. Glissez `Sonora.ipa` dans Sideloadly, entrez votre identifiant Apple, puis cliquez sur **Start**.
3. **Sur l'iPhone** :
   - activez **Réglages → Confidentialité et sécurité → Mode développeur** (l'iPhone redémarre) ;
   - faites confiance à votre identifiant dans **Réglages → Général → VPN et gestion de l'appareil**.

Avec un identifiant Apple gratuit, l'app fonctionne **7 jours**. Il suffit ensuite de la réinstaller avec Sideloadly.

---

## Publier sur GitHub (Windows, Android, iPhone en une fois)

1. Envoyez tout le projet dans votre dépôt GitHub, y compris le dossier `.github`.
2. **Android** : ajoutez les 4 secrets de la clé de signature (**Settings → Secrets and variables → Actions**, voir `SECRETS-GITHUB.txt` dans `Sonora-cle-Android.zip`). **Ne mettez jamais la clé elle-même dans le dépôt.**
3. Ouvrez l'onglet **Actions**, puis **Release** → **Run workflow**. Entrez le numéro de version (ex. `1.0.0`). Comptez 20 à 30 minutes.
4. La page **Releases** du dépôt contient alors :
   - `Sonora-Setup-x.y.z.exe` et `Sonora-Portable-x.y.z.exe` (Windows)
   - `Sonora-Android-x.y.z.apk` (Android, à installer directement)
   - `Sonora-PlayStore-x.y.z.aab` (pour la Google Play Console)
   - `Sonora-iPhone-x.y.z.ipa` (iPhone, avec Sideloadly)

## Mises à jour

Pour publier une mise à jour, relancez **Release** avec un numéro plus grand (ex. `1.1.0`).

| Version installée | Mise à jour |
|---|---|
| Windows (installateur) | Automatique : téléchargée en arrière-plan, puis installée au redémarrage (bouton « Redémarrer et installer ») |
| Windows portable | Sonora affiche « Nouvelle version », un clic télécharge la nouvelle version |
| Android (APK GitHub) | Sonora affiche « Nouvelle version », un clic télécharge l'APK, il suffit de l'ouvrir pour l'installer |
| Android (Play Store) | Automatique, par le Play Store (envoyez le nouveau `.aab` dans la Play Console) |
| iPhone (Sideloadly) | Sonora affiche « Nouvelle version » : téléchargez le nouveau `.ipa` et réinstallez-le avec Sideloadly |

## iPhone depuis GitHub

Apple ne permet pas d'installer une application directement depuis GitHub ou depuis un site. Il y a deux façons de faire :
- **Gratuit** : téléchargez `Sonora-iPhone-x.y.z.ipa` depuis la page Releases, puis installez-le avec **Sideloadly** depuis Windows (voir plus haut). L'app doit être réinstallée tous les 7 jours avec un identifiant Apple gratuit.
- **App Store ou TestFlight** : il faut un compte Apple Developer (99 $/an), et l'onglet YouTube sans pub doit être retiré (règles d'Apple).

## Publier sur le Play Store

1. Créez un compte développeur sur **play.google.com/console** (25 $, une seule fois). Comptez quelques jours pour la vérification d'identité.
2. Cliquez sur **Créer une application**, choisissez le nom Sonora et la langue français, et cochez « Application » et « Gratuite ».
3. Remplissez la fiche : description, icône 512×512 (`resources/icon.png`), captures d'écran, catégorie Musique et audio. Ajoutez une **politique de confidentialité** (page web obligatoire) et remplissez le questionnaire de classification du contenu.
4. Allez dans **Tests → Tests internes** (ou Production) → **Créer une version**, puis importez `Sonora-PlayStore-x.y.z.aab`. Acceptez la « signature d'application par Google Play ».
5. Envoyez la version en examen : comptez quelques heures à quelques jours. Pour un nouveau compte personnel, Google demande d'abord un **test fermé avec 12 testeurs pendant 14 jours** avant la production.

ℹ️ La **version Play Store** (fichier `.aab`) est construite sans l'onglet YouTube sans pub, parce que Google refuse les applications qui bloquent les publicités de YouTube. Dans cette version, les liens YouTube s'ouvrent dans l'appli YouTube officielle. La musique (lecteur officiel YouTube), la radio, les films et vos sites restent disponibles. La version complète est l'APK publié sur GitHub.

## Compte et synchronisation (Firebase, gratuit)

Le compte permet de retrouver sur l'ordinateur, Android et l'iPhone les **favoris, playlists, sites de streaming et réglages**. Les fichiers hors-ligne restent sur chaque appareil.

**À faire une seule fois par le développeur :**
1. Sur **console.firebase.google.com**, cliquez sur **Créer un projet** (vous pouvez refuser Google Analytics).
2. **Authentication** → **Commencer** → **E-mail/Mot de passe** → Activer.
3. **Firestore Database** → **Créer une base de données** (choisissez la région la plus proche). Dans l'onglet **Règles**, collez le texte ci-dessous, puis cliquez sur **Publier** :
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
4. Dans **⚙ Paramètres du projet → Général**, copiez la **Clé d'API Web** et l'**ID du projet**. Ajoutez-les comme secrets du dépôt GitHub (**Settings → Secrets and variables → Actions**) : `FIREBASE_API_KEY` et `FIREBASE_PROJECT_ID`. Elles sont intégrées automatiquement à chaque publication (Windows, Android, iPhone, PWA) : les utilisateurs voient seulement « Créer un compte / Se connecter ».

**Pour les utilisateurs :** dans **Réglages → Compte et synchronisation**, cliquez sur **Créer un compte**, puis connectez-vous avec la même adresse sur chaque appareil.

## Version web installable (PWA) — gratuite, iPhone et Android

Adresse : **https://<votre-pseudo>.github.io/sonora/**. Elle est publiée automatiquement par GitHub Pages à chaque envoi sur `main` et à chaque Release.
- **iPhone** : ouvrez le lien dans **Safari**, puis **Partager → Sur l'écran d'accueil**.
- **Android** : ouvrez le lien dans Chrome, puis **⋮ → Installer l'application**.
- **Ordinateur** : dans Chrome ou Edge, cliquez sur l'icône « Installer » dans la barre d'adresse.

L'application s'ouvre même sans connexion et se met à jour toute seule. Ses limites, imposées par les navigateurs :
- pas de bloqueur de publicités (YouTube et les sites s'ouvrent dans un onglet) ;
- les titres YouTube nécessitent une clé API gratuite (Musique → « Source des titres ») ;
- seules les radios en https sont proposées.

**À activer une seule fois** : dans le dépôt GitHub, **Settings → Pages → Source : « GitHub Actions »**.

### Publier une nouvelle version (méthode simple)
1. Augmentez `"version"` dans `package.json` (ex. `1.1.0`).
2. Envoyez ce changement sur la branche **`release`**. Vous pouvez aussi passer par **Actions → Release → Run workflow**.

## Sites préconfigurés (onglet Films & TV)

Pour que des sites apparaissent chez tous les utilisateurs sans qu'ils aient à les ajouter, créez dans GitHub une **variable** (ou un secret) nommée `SONORA_SITES`, dans **Settings → Secrets and variables → Actions**, onglet « Variables » ou « Secrets ». Mettez un site par ligne :
```
France TV direct | https://www.france.tv/direct/
Arte en direct | https://www.arte.tv/fr/direct/
```
Ces sites s'affichent avec le badge « SONORA » et ne peuvent pas être supprimés. Les utilisateurs peuvent toujours ajouter leurs propres sites. Les adresses sont intégrées à l'application, donc visibles par tous ses utilisateurs.
