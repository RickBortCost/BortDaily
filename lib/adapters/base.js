// Interfaccia comune delle sorgenti (adapter).
//
// Un adapter è un oggetto:
//   { id, title, defaultTtl (secondi), requires: null | "google" | "telegram", async fetch(ctx, params) → dati }
// ctx: { fetch, settings, user, now, google?: { token() }, telegram?: { client() } }
// Gli errori si segnalano con AdapterError: il widget mostra lo stato senza bloccare il resto della dashboard.
//
// runAdapter restituisce sempre (mai eccezioni):
//   { type, status: "ok" | "error" | "disconnected" | "unconfigured", data, error: { code, message } | null,
//     updated (ISO), cached (bool), stale (bool) }
import { log } from "../log.js";

export class AdapterError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const STATUS_BY_CODE = { not_connected: "disconnected", auth_expired: "disconnected", not_configured: "unconfigured", bad_config: "unconfigured" };
const MESSAGES = {
  timeout: "La sorgente non risponde. Riprova più tardi.",
  upstream: "La sorgente ha restituito un errore.",
  rate_limited: "Troppe richieste alla sorgente. Riprova tra qualche minuto.",
  internal: "Errore imprevisto.",
};
const MIN_FORCE_AGE = 30_000; // aggiornamento forzato: al massimo uno ogni 30 secondi per sorgente

export function ttlFor(adapter, env = {}) {
  const v = +env[`TTL_${adapter.id.toUpperCase()}`];
  return Number.isFinite(v) && v >= 30 ? Math.min(v, 86400) : adapter.defaultTtl;
}

export async function runAdapter(adapter, ctx, params = {}, { cache, cacheKey, force = false, env = {} } = {}) {
  const t0 = Date.now();
  const key = cacheKey ?? `${ctx.user}:${adapter.id}:${JSON.stringify(params)}`;
  const hit = cache ? await cache.get(key) : null;
  if (hit && (!force || Date.now() - hit.at < MIN_FORCE_AGE)) {
    return { type: adapter.id, status: "ok", data: hit.value, error: null, updated: new Date(hit.at).toISOString(), cached: true, stale: false };
  }
  try {
    const data = await adapter.fetch(ctx, params);
    if (cache) await cache.put(key, data, ttlFor(adapter, env));
    log("adapter", { user: ctx.user, adapter: adapter.id, status: "ok", ms: Date.now() - t0 });
    return { type: adapter.id, status: "ok", data, error: null, updated: new Date().toISOString(), cached: false, stale: false };
  } catch (e) {
    const code = e instanceof AdapterError ? e.code : e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "internal";
    const message = e instanceof AdapterError ? e.message : MESSAGES[code];
    log("adapter", { user: ctx.user, adapter: adapter.id, status: "error", code, ms: Date.now() - t0 });
    return {
      type: adapter.id, status: STATUS_BY_CODE[code] ?? "error", data: hit?.value ?? null, error: { code, message },
      updated: hit ? new Date(hit.at).toISOString() : null, cached: !!hit, stale: !!hit,
    };
  }
}

// Errori HTTP delle API esterne → AdapterError
export async function expectOk(res, source) {
  if (res.ok) return res;
  if (res.status === 401) throw new AdapterError("auth_expired", `Accesso a ${source} scaduto: ricollega l'account nelle Impostazioni.`);
  if (res.status === 403) throw new AdapterError("forbidden", `Permesso negato da ${source}: controlla le autorizzazioni concesse.`);
  if (res.status === 429) throw new AdapterError("rate_limited", MESSAGES.rate_limited);
  throw new AdapterError("upstream", `${source} ha restituito un errore (${res.status}).`);
}
