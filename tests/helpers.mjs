// Utilità comuni dei test (senza rete).
import { MemoryKV } from "../lib/store.js";

let failed = 0, passed = 0;
export function check(name, cond) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  cond ? passed++ : failed++;
}
export async function rejects(name, fn, match) {
  try { await fn(); check(`${name} (nessun errore)`, false); }
  catch (e) { check(name, !match || match.test(`${e.code ?? ""} ${e.message}`)); }
}
export function done() {
  console.log(`\n${passed}/${passed + failed} controlli superati`);
  process.exit(failed ? 1 : 0);
}

export const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
export const testEnv = (extra = {}) => ({ DATA: new MemoryKV(), BORT_DATA_KEY: TEST_KEY, ACCESS_CODES: "anna:codice-di-prova-anna,bob:codice-di-prova-bob", ...extra });

// fetch finto: elenco di [regex | funzione, risposta | (url, init) => risposta]; registra le chiamate
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    for (const [match, reply] of routes) {
      if (typeof match === "function" ? match(url, init) : match.test(url)) {
        const r = typeof reply === "function" ? await reply(url, init) : reply;
        if (r instanceof Response) return r;
        if (r instanceof Error) throw r;
        const { status = 200, body = {}, type = "application/json" } = r;
        return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
      }
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}
