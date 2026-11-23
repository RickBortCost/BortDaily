// Archivio su Cloudflare KV (binding DATA). Prefissi:
//   s:<hash sessione>      sessione (utente, creazione)          TTL 30 giorni
//   u:<utente>:layout      layout della dashboard
//   u:<utente>:settings    impostazioni
//   t:<utente>:google      token OAuth Google                    cifrato
//   t:<utente>:telegram    sessione Telegram                     cifrata
//   p:<utente>:telegram    accesso Telegram in corso             cifrato, TTL 10 minuti
//   o:<state>              stato OAuth (PKCE)                    TTL 10 minuti
//   f:<ip>:<ora>           tentativi di accesso falliti          TTL 2 ore
// Le risposte delle sorgenti NON vanno in KV (limite di scritture): cache.js usa memoria e Cache API, cifrate.
import { dataKeys, seal, open } from "./crypto.js";

export function makeStore(env) {
  const kv = env.DATA;
  if (!kv) throw new Error("Binding KV DATA non configurato");
  const ttlOpt = (ttl) => (ttl ? { expirationTtl: Math.max(60, Math.round(ttl)) } : undefined);
  return {
    kv,
    async get(k) { const v = await kv.get(k); if (v == null) return null; try { return JSON.parse(v); } catch { return null; } },
    put: (k, v, ttl) => kv.put(k, JSON.stringify(v), ttlOpt(ttl)),
    del: (k) => kv.delete(k),
    async getSecret(k) {
      const v = await kv.get(k);
      if (v == null) return null;
      try { return await open(v, await dataKeys(env), k); } catch { return null; }
    },
    async putSecret(k, v, ttl) { await kv.put(k, await seal(v, await dataKeys(env), k), ttlOpt(ttl)); },
  };
}

// KV in memoria con la stessa interfaccia (test e server di sviluppo)
export class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(k) {
    const e = this.map.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { this.map.delete(k); return null; }
    return e.v;
  }
  async put(k, v, opts) { this.map.set(k, { v: String(v), exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 }); }
  async delete(k) { this.map.delete(k); }
}
