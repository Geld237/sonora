# Benchmark : projets open source similaires

Comparaison réalisée en novembre 2026 avec cinq projets publics nommés « Sonora », pour améliorer Enora.

| Projet | Type | Plateformes | Technologies | Contenu | Licence |
|---|---|---|---|---|---|
| [sonorahq/sonora](https://github.com/sonorahq/sonora) | Client de streaming de bureau | macOS, Windows, Linux | Rust, GPUI | Spotify, Apple Music, YouTube Music, Deezer, Tidal, Subsonic, fichiers locaux | GPL-3.0 |
| [Ayushpanditmoto/Sonora](https://github.com/Ayushpanditmoto/Sonora) | Lecteur de streaming web + mobile | Web, Android | Next.js, Flutter | JioSaavn | non précisée |
| [sonoramac/Sonora](https://github.com/sonoramac/Sonora) | Lecteur de musique locale | macOS | Objective-C, Cocoa | Fichiers locaux | BSD-3 (code) |
| [yurtemre7/sonora](https://github.com/yurtemre7/sonora) | Lecteur de musique locale | Android, iOS, Windows | Flutter | Fichiers locaux uniquement | MIT |
| [dignifiedquire/sonora](https://github.com/dignifiedquire/sonora) | Bibliothèque de traitement audio (WebRTC) | Toutes | Rust | Aucun (traitement du micro) | BSD-3 |

`dignifiedquire/sonora` n'est pas un lecteur. C'est un module d'annulation d'écho et de réduction de bruit pour la voix, donc hors sujet pour Enora.

## Repris dans Enora (1.3.0)

| Idée | Inspirée de | Dans Enora |
|---|---|---|
| Versions macOS et Linux | sonorahq | `Enora-Mac.dmg` (Intel + Apple Silicon), `Enora-Linux.AppImage` et `.deb` |
| Paroles synchronisées depuis des fichiers `.lrc` | yurtemre7, sonorahq | Importez `Titre.mp3` + `Titre.lrc` ensemble ; ligne active surlignée, clic pour se déplacer |
| Égaliseur et normalisation du volume (ReplayGain) | yurtemre7, sonorahq | Réglages → Égaliseur (6 préréglages) et normalisation |
| Historique et statistiques d'écoute | Ayushpanditmoto, yurtemre7 | Bibliothèque → Historique |
| Enregistrer la file d'attente comme playlist (« mix ») | sonoramac | Lecteur → « Enregistrer en playlist » |
| Recherche globale avec raccourci clavier | sonoramac | Ctrl+K (⌘K sur Mac) |
| Sauvegarde et restauration JSON | yurtemre7 | Réglages → Sauvegarde |
| Lancement instantané depuis le cache | yurtemre7 | Listes en cache 6 h (1.1.0) |
| Publication automatique par GitHub Actions | Ayushpanditmoto | Déjà en place (workflow Release) |

## Pistes pour les contributeurs

- **Traduction de l'interface** (sonorahq en propose 15) : issue « Traduire l'interface en anglais ».
- **Scrobbling Last.fm / ListenBrainz** (sonorahq, sonoramac) : demande une clé Last.fm propre au projet.
- **Lecture sans blanc entre deux titres (« gapless »)** et préchargement du titre suivant.
- **Signature du code Windows** gratuite pour les projets open source via SignPath (utilisée par sonorahq).
- **Distribution** via winget, Homebrew, Flathub et l'AUR (utilisés par sonorahq).
- **Statistiques détaillées** (temps d'écoute, top titres par mois) et **thèmes** (couleur d'accent).

## Méthodes volontairement non reprises

- **Extraction des flux YouTube inspirée de yt-dlp** (sonorahq) : elle contourne le lecteur officiel et les conditions d'utilisation de YouTube. Enora utilise le lecteur officiel.
- **Accès non officiel à un catalogue sous licence** (JioSaavn chez Ayushpanditmoto, Spotify via librespot chez sonorahq) : il dépend d'interfaces non publiques et des conditions des services.
- **APK signé avec la clé de débogage** (Ayushpanditmoto) : il provoque des conflits de mise à jour. Enora signe avec une vraie clé stockée dans les secrets GitHub.
