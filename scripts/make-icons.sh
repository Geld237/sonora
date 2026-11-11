#!/usr/bin/env bash
# Régénère toutes les icônes de l'application à partir de resources/logo.svg.
# Outils nécessaires : rsvg-convert (librsvg) et convert (ImageMagick). À lancer depuis la racine du projet.
set -euo pipefail
SRC=resources/logo.svg
TMP=$(mktemp -d)
GLYPH='<path d="M700 290H350V734H670M350 512H590" fill="none" stroke="#fff" stroke-width="100" stroke-linecap="round" stroke-linejoin="round"/>'
png() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }
flat() { convert "$1" -background '#ff375f' -alpha remove -alpha off "$1"; }

# Ordinateur, site web, iPhone
png $SRC 1024 resources/icon.png; flat resources/icon.png
png $SRC 256 www/icon.png; flat www/icon.png
png $SRC 192 www/icons/icon-192.png; png $SRC 512 www/icons/icon-512.png; png $SRC 180 www/icons/apple-touch-icon.png
for f in www/icons/icon-192.png www/icons/icon-512.png www/icons/apple-touch-icon.png; do flat $f; done
png $SRC 1024 ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png; flat ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png

# Icône « maskable » (Android, PWA) : le dessin tient dans la zone centrale
sed 's#<path d="M700#<g transform="translate(512 512) scale(.72) translate(-512 -512)"><path d="M700#; s#stroke-linejoin="round"/>#stroke-linejoin="round"/></g>#' $SRC > $TMP/mask.svg
png $TMP/mask.svg 512 www/icons/icon-maskable-512.png; flat www/icons/icon-maskable-512.png

# Android : icônes classiques (coins arrondis / rondes) et premier plan de l'icône adaptative
sed 's#<rect width="1024" height="1024" fill="url(\#g)"/>#<rect width="1024" height="1024" rx="190" fill="url(\#g)"/>#' $SRC > $TMP/square.svg
sed 's#<rect width="1024" height="1024" fill="url(\#g)"/>#<circle cx="512" cy="512" r="512" fill="url(\#g)"/>#; s#<path d="M700#<g transform="translate(512 512) scale(.86) translate(-512 -512)"><path d="M700#; s#stroke-linejoin="round"/>#stroke-linejoin="round"/></g>#' $SRC > $TMP/round.svg
echo "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><g transform=\"translate(512 512) scale(.5) translate(-512 -512)\">$GLYPH</g></svg>" > $TMP/fg.svg
RES=android/app/src/main/res
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read name s fg <<< "$d"
  png $TMP/square.svg $s $RES/mipmap-$name/ic_launcher.png
  png $TMP/round.svg $s $RES/mipmap-$name/ic_launcher_round.png
  png $TMP/fg.svg $fg $RES/mipmap-$name/ic_launcher_foreground.png
done
rm -rf "$TMP"
echo "✓ icônes régénérées"
