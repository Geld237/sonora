// Langues de l'interface. L'interface est écrite en français ; ce module traduit les textes affichés.
// Un texte absent d'une langue est repris de l'anglais, puis reste en français.
import { EN, EN_PATTERNS } from './i18n-en.js';

/** Les dix langues proposées : [code, nom dans la langue, écriture de droite à gauche] */
export const LANGS = [
  ['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['pt', 'Português'],
  ['zh', '中文'], ['ar', 'العربية', true], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['ru', 'Русский'],
];
const CODES = LANGS.map((l) => l[0]);

let lang = 'fr';
let dict = null;      // dictionnaire de la langue choisie (hors français et anglais)
let observer = null;
let applied = false;

export const currentLang = () => lang;
/** Langue de l'appareil si elle est proposée, sinon l'anglais (le français pour un appareil en français). */
export function deviceLang() {
  for (const l of [navigator.language, ...(navigator.languages || [])]) {
    const c = String(l || '').toLowerCase().slice(0, 2);
    if (CODES.includes(c)) return c;
  }
  return 'en';
}

/** Traduit une phrase connue (sinon la renvoie telle quelle). */
export function tr(s) {
  if (lang === 'fr' || !s) return s;
  const raw = s.trim();
  const k = raw.replace(/\s+/g, ' ');
  if (dict && dict[k] != null) return s.replace(raw, dict[k]);
  if (EN[k] != null) return s.replace(raw, EN[k]);
  for (const [re, out] of EN_PATTERNS) if (re.test(k)) return s.replace(raw, k.replace(re, out));
  return s;
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE']);
// Contenus de l'utilisateur ou des catalogues (titres, artistes, paroles) : jamais traduits
const CONTENT = '.rt, .ra, .card .t, .card .a, #mini-title, #mini-artist, #np-title, #np-artist, .lyrics p, .detail h1, .detail .muted, .room-code, .pod-desc, .gs-res *, [data-notr]';
function translateNode(node) {
  if (node.nodeType === 3) {
    const v = node.nodeValue;
    if (!v || v.trim().length < 2 || node.parentElement?.matches(CONTENT)) return;
    const t = tr(v);
    if (t !== v) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
  for (const a of ATTRS) { const v = node.getAttribute(a); if (v) { const t = tr(v); if (t !== v) node.setAttribute(a, t); } }
  for (const c of node.childNodes) translateNode(c);
}

/** Applique la langue choisie ('auto' = langue de l'appareil). Un changement en cours d'utilisation recharge la page. */
export async function applyLanguage(setting = 'auto') {
  const want = CODES.includes(setting) ? setting : deviceLang();
  if (want === lang) { applied = true; return; }
  if (applied && lang !== 'fr') { location.reload(); return; } // les textes déjà traduits repartent du français
  applied = true;
  let d = null;
  if (want !== 'fr' && want !== 'en') {
    try { d = (await import(`./i18n-${want}.js`)).DICT; } catch (_) { d = null; } // langue indisponible : anglais
  }
  lang = want; dict = d;
  document.documentElement.lang = lang;
  document.documentElement.dir = LANGS.find((l) => l[0] === lang)?.[2] ? 'rtl' : 'ltr';
  if (observer) { observer.disconnect(); observer = null; }
  if (lang === 'fr') return;
  translateNode(document.body);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
      else for (const n of m.addedNodes) translateNode(n);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
