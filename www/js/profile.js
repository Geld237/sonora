// Nom d'utilisateur : un pseudonyme (aléatoire ou choisi) montré aux autres à la place de l'adresse e-mail.
const KEY = 'sonora.profile';
const NOUNS = ['Lynx', 'Renard', 'Faucon', 'Panda', 'Tigre', 'Colibri', 'Dauphin', 'Loup', 'Phénix', 'Koala', 'Okapi', 'Gazelle', 'Toucan', 'Jaguar', 'Lion', 'Zèbre', 'Hibou', 'Caméléon', 'Flamant', 'Guépard'];
const ADJS = ['Solaire', 'Lunaire', 'Mélomane', 'Électrique', 'Vibrant', 'Cosmique', 'Nomade', 'Rythmé', 'Secret', 'Doré', 'Zen', 'Funky', 'Mystère', 'Turbo', 'Velours', 'Néon', 'Sauvage', 'Astral'];
const pick = (l) => l[crypto.getRandomValues(new Uint32Array(1))[0] % l.length];

export const randomName = () => `${pick(NOUNS)}${pick(ADJS)}${10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90)}`;
export function getProfile() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } }
export const getProfileName = () => getProfile().name || '';

/** Nettoie un nom choisi : 3 à 20 caractères, jamais une adresse e-mail. Renvoie '' s'il est refusé. */
export function cleanName(raw) {
  const n = String(raw || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n.length >= 3 ? n : '';
}
export function setProfileName(name, at = Date.now()) {
  try { localStorage.setItem(KEY, JSON.stringify({ name, at })); } catch (_) {}
}
/** Donne un pseudonyme aléatoire s'il n'y en a pas encore. */
export function ensureProfileName() {
  if (!getProfileName()) setProfileName(randomName());
  return getProfileName();
}
