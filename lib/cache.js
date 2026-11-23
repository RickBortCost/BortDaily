// Cache delle risposte delle sorgenti, con TTL. Due livelli: memoria dell'istanza e Cache API di Cloudflare
// (nessuna scrittura su KV). I valori sono cifrati come i token: contengono dati personali (mail, eventi, messaggi).
import { dataKeys, seal, open } from "./crypto.js";

const MAX_MEM = 300;
const BASE = "https://cache.bortdaily.invalid/";

export function makeCache(env, { mem = new Map(), cacheApi = globalThis.caches?.default } = {}) {
  const url = (k) => `${BASE}${encodeURIComponent(k)}`;
  return {
    // → { value, at } oppure null
    async get(key) {
      const now = Date.now();
      let box = mem.get(key);
      if (box && box.exp < now) { mem.delete(key); box = null; }
      if (!box && cacheApi) {
        try {
          const res = await cacheApi.match(url(key));
          if (res) box = { exp: +res.headers.get("x-exp"), data: await res.text() };
          if (box && box.exp < now) box = null;
        } catch { box = null; }
      }
      if (!box) return null;
      try { return await open(box.data, await dataKeys(env), `c:${key}`); } catch { return null; }
    },
    async put(key, value, ttlSec) {
      const exp = Date.now() + ttlSec * 1000;
      const data = await seal({ value, at: Date.now() }, await dataKeys(env), `c:${key}`);
      if (mem.size >= MAX_MEM) mem.delete(mem.keys().next().value);
      mem.set(key, { exp, data });
      if (cacheApi) {
        try {
          await cacheApi.put(url(key), new Response(data, { headers: { "cache-control": `max-age=${ttlSec}`, "x-exp": String(exp) } }));
        } catch { /* la cache è facoltativa */ }
      }
    },
    async del(key) { mem.delete(key); try { await cacheApi?.delete(url(key)); } catch { /* facoltativa */ } },
  };
}
