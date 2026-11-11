// Requêtes vers des services ouverts (paroles, podcasts) : natif sur téléphone, direct ailleurs.
export async function getText(url, { timeout = 15000, headers = {} } = {}) {
  const cap = window.Capacitor;
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé')), timeout))]);
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.nativePromise === 'function') {
    const r = await withTimeout(cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', headers, responseType: 'text' }));
    if (r.status >= 400) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  const res = await withTimeout(fetch(url, { headers }));
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.text();
}
export async function getJSON(url, opts) { return JSON.parse(await getText(url, opts)); }
