// Version anglaise : l'interface est écrite en français ; ce module traduit les textes affichés.
import { EN, EN_PATTERNS } from './i18n-en.js';

let lang = 'fr';
let observer = null;

export const currentLang = () => lang;
/** Traduit une phrase connue (sinon la renvoie telle quelle). */
export function tr(s) {
  if (lang !== 'en' || !s) return s;
  const raw = s.trim();
  const k = raw.replace(/\s+/g, ' ');
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

/** 'auto' : anglais si l'appareil est en anglais, français sinon. */
export function applyLanguage(setting = 'auto') {
  const want = setting === 'en' || (setting === 'auto' && /^en\b/i.test(navigator.language || '')) ? 'en' : 'fr';
  if (want === lang) return false;
  const wasEnglish = lang === 'en';
  lang = want;
  document.documentElement.lang = lang;
  if (observer) { observer.disconnect(); observer = null; }
  if (lang === 'en') {
    translateNode(document.body);
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
        else for (const n of m.addedNodes) translateNode(n);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  } else if (wasEnglish) {
    location.reload(); // retour au français : la page est simplement rechargée
  }
  return true;
}
