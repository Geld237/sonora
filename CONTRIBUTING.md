# Contribuer à Enora

Merci de vouloir améliorer Enora ! Ce guide explique comment installer le projet, comment il est organisé et comment proposer une modification.

## Sommaire
1. [Démarrer en 5 minutes](#démarrer-en-5-minutes)
2. [Organisation du code](#organisation-du-code)
3. [Proposer une modification](#proposer-une-modification)
4. [Règles du projet](#règles-du-projet)
5. [Tester sur Android, iPhone et le web](#tester-sur-android-iphone-et-le-web)

## Démarrer en 5 minutes

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent et Git.

```bash
git clone https://github.com/Geld237/sonora.git
cd sonora
npm install
npm start          # lance l'application de bureau (Electron)
npm run check      # vérifications rapides (à lancer avant chaque proposition)
```

L'application fonctionne **sans aucune clé ni compte**. La clé YouTube, le compte Firebase et la clé de signature Android ne servent qu'aux versions publiées. Ils sont stockés dans les secrets GitHub du dépôt et ne sont jamais transmis aux contributeurs.

## Organisation du code

Toute l'interface est écrite **une seule fois** en HTML, CSS et JavaScript (modules ES, sans framework ni étape de compilation) dans `www/`. Elle est ensuite empaquetée pour chaque plateforme.

| Dossier / fichier | Rôle |
|---|---|
| `www/index.html`, `www/css/style.css` | Structure et style (thème « système Apple » à la fin du fichier CSS) |
| `www/js/app.js` | Vues (Bibliothèque, Musique, Films & TV, Radio, YouTube, Infos, Réglages) et navigation |
| `www/js/player.js`, `www/js/youtube-player.js` | Lecteur audio/vidéo, file d'attente, lecteur officiel YouTube |
| `www/js/api.js` | Sources en ligne : YouTube (API officielle + méthode interne), Internet Archive, Radio Browser |
| `www/js/db.js` | Stockage local (IndexedDB) |
| `www/js/cloud.js` | Compte et synchronisation (Firebase, API REST) |
| `www/js/icons.js` | Icônes SVG de l'application |
| `www/js/updates.js`, `www/sw.js` | Mises à jour (applications et version web) |
| `adblock/youtube-adblock.js` | Script anti-publicité partagé par toutes les plateformes |
| `electron/` | Application Windows (Electron) |
| `plugins/youtube-adblock/` | Module natif Android (Java) et iPhone (Swift) |
| `android/`, `ios/` | Projets natifs générés par Capacitor |
| `scripts/` | Préparation des builds (versions, scripts copiés dans les plugins…) |
| `.github/workflows/` | Vérifications, publication (Release) et site web (PWA) |

Les fichiers `electron/webview-preload.js`, `electron/adblock-fn.js`, `www/js/build-info.js` et `AdblockScripts.swift` sont **générés** par les scripts : modifiez leur source (`adblock/youtube-adblock.js`…), pas ces fichiers.

## Proposer une modification

1. **Ouvrez d'abord une issue** (onglet *Issues*) pour un bug ou une idée importante, afin d'en discuter avant de coder. Les issues marquées `good first issue` sont idéales pour commencer.
2. **Forkez** le dépôt (bouton *Fork*), puis créez une branche : `git checkout -b correction-radio-vide`.
3. Faites des **commits courts et clairs**, en français ou en anglais : `Radio : ignorer les stations sans flux`.
4. Lancez `npm run check` et testez votre modification dans l'application (`npm start`).
5. Ouvrez une **Pull Request** vers la branche `main` et remplissez le modèle. Une vérification automatique se lance. Le mainteneur relit, commente, puis fusionne.

Seul le mainteneur publie les nouvelles versions (branche `release`).

## Règles du projet

- **Sources légales uniquement.** Enora n'intègre que des contenus que l'on a le droit de diffuser : le lecteur officiel YouTube, le domaine public, les flux publics des radios, les fichiers de l'utilisateur. Les propositions qui ajoutent des sites de streaming non autorisés, du téléchargement depuis YouTube ou le contournement de paywalls seront refusées.
- **Pas de nouvelle dépendance lourde** sans en discuter : l'interface reste en JavaScript simple, sans framework.
- **Accessibilité et lisibilité** : textes en français clair, boutons avec un attribut `title`, contrastes suffisants.
- **Vie privée** : aucun pisteur ni outil d'analyse. Les données de l'utilisateur restent sur son appareil ou dans son propre compte.
- **Style de code** : 2 espaces, guillemets simples, point-virgule, noms en anglais, commentaires en français.

## Tester sur Android, iPhone et le web

- **Version web** : `npx http-server www` (ou tout serveur statique), puis ouvrez l'adresse affichée.
- **Android** : Android Studio et JDK 21, puis `npm run android:sync` et `npx cap open android`.
- **iPhone** : un Mac avec Xcode, puis `npm run ios:sync` et `npx cap open ios`.
- Sans Mac ni Android Studio, chaque Pull Request peut aussi être compilée par les workflows GitHub du mainteneur.

Merci ! Chaque contribution, même petite (une faute corrigée, une radio qui ne marche pas signalée), aide le projet.
