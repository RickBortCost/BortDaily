// Cifratura a riposo: AES-256-GCM (WebCrypto), IV casuale di 12 byte a ogni scrittura.
// La chiave arriva dalla variabile d'ambiente/secret BORT_DATA_KEY (32 byte in base64), mai dal repository.
// Il nome del record è usato come dato autenticato (AAD): un valore cifrato non può essere spostato su un altro record.
// Rotazione: impostare la nuova chiave in BORT_DATA_KEY e la vecchia in BORT_DATA_KEY_PREVIOUS (solo lettura).
const enc = new TextEncoder(), dec = new TextDecoder();

export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const randomId = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Confronto a tempo costante (sugli hash, così anche la lunghezza non trapela)
export async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(v))))));
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const cache = new Map();
async function importKey(secret) {
  if (cache.has(secret)) return cache.get(secret);
  const raw = unb64u(secret);
  if (raw.length !== 32) throw new Error("BORT_DATA_KEY deve essere di 32 byte in base64");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  cache.set(secret, key);
  return key;
}
export async function dataKeys(env) {
  if (!env.BORT_DATA_KEY) throw new Error("BORT_DATA_KEY non configurata");
  const keys = [await importKey(env.BORT_DATA_KEY)];
  if (env.BORT_DATA_KEY_PREVIOUS) keys.push(await importKey(env.BORT_DATA_KEY_PREVIOUS));
  return keys;
}

export async function seal(value, keys, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, keys[0], enc.encode(JSON.stringify(value)));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}
export async function open(box, keys, aad) {
  const [v, iv, ct] = String(box).split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("formato cifrato non valido");
  for (const key of keys) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: enc.encode(aad) }, key, unb64u(ct));
      return JSON.parse(dec.decode(pt));
    } catch { /* prova la chiave precedente */ }
  }
  throw new Error("decifratura non riuscita");
}
