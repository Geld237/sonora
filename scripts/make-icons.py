#!/usr/bin/env python3
"""Régénère toutes les icônes d'Enora (ordinateur, web, iPhone, Android) à partir du dessin du logo ci-dessous.
Outils nécessaires : rsvg-convert (librsvg) et convert (ImageMagick). Lancer depuis la racine : python3 scripts/make-icons.py"""
import os, subprocess, tempfile

# Le logo : un « e » dont la boucle forme la tête d'une note ; une hampe monte de son côté droit, avec deux crochets (double croche).
GLYPH = """<g transform="translate(-16 -6)" fill="none" stroke="#fff" stroke-width="80" stroke-linecap="round" stroke-linejoin="round">
<path d="M262 650H586A162 162 0 1 0 538 765"/>
<path d="M586 650V214"/>
<path d="M586 214C630 268 704 290 752 336C788 370 794 414 776 456"/>
<path d="M586 376C628 418 690 440 730 478C756 504 762 536 750 566"/>
</g>"""
GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5c7a"/><stop offset=".55" stop-color="#ff375f"/><stop offset="1" stop-color="#c2255c"/></linearGradient></defs>'

def svg(bg, scale=1.0):
    g = GLYPH if scale == 1 else f'<g transform="translate(512 512) scale({scale}) translate(-512 -512)">{GLYPH}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{GRAD}{bg}{g}</svg>'

FULL = '<rect width="1024" height="1024" fill="url(#g)"/>'
tmp = tempfile.mkdtemp()
def render(src, size, out, flat=False):
    p = os.path.join(tmp, 'x.svg')
    open(p, 'w').write(src)
    subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), p, '-o', out], check=True)
    if flat: subprocess.run(['convert', out, '-background', '#ff375f', '-alpha', 'remove', '-alpha', 'off', out], check=True)

open('resources/logo.svg', 'w').write(svg(FULL).replace('><defs>', '>\n  <!-- Logo d\'Enora (généré par scripts/make-icons.py) -->\n  <defs>', 1))
for size, out in [(1024, 'resources/icon.png'), (256, 'www/icon.png'), (192, 'www/icons/icon-192.png'), (512, 'www/icons/icon-512.png'),
                  (180, 'www/icons/apple-touch-icon.png'), (1024, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')]:
    render(svg(FULL), size, out, flat=True)
render(svg(FULL, .74), 512, 'www/icons/icon-maskable-512.png', flat=True)   # PWA « maskable » : dessin dans la zone sûre
RES = 'android/app/src/main/res'
for name, s, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    render(svg('<rect width="1024" height="1024" rx="190" fill="url(#g)"/>'), s, f'{RES}/mipmap-{name}/ic_launcher.png')
    render(svg('<circle cx="512" cy="512" r="512" fill="url(#g)"/>', .86), s, f'{RES}/mipmap-{name}/ic_launcher_round.png')
    render(svg('', .56), fg, f'{RES}/mipmap-{name}/ic_launcher_foreground.png')   # icône adaptative (fond rose défini à part)
print('✓ icônes régénérées')
