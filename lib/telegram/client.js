// Client Telegram (MTProto) con mtcute, piattaforma web: WebSocket + WebCrypto + WASM.
// Funziona su Cloudflare Workers/Pages Functions (verificato con workerd) e su Node ≥ 22 (WebSocket globale).
// Ogni richiesta crea un client a vita breve: la sessione (chiave di autorizzazione) è importata dalla stringa
// salvata cifrata in KV e il client viene chiuso al termine.
import { TelegramClient, WebCryptoProvider } from "@mtcute/web";
import { MemoryStorage } from "@mtcute/core";

// wasm: WebAssembly.Module precompilato (Workers non consente di compilare WASM a runtime)
export function makeTelegramFactory(wasm) {
  return async function createClient({ apiId, apiHash, session = null }) {
    const tg = new TelegramClient({
      apiId: +apiId, apiHash, storage: new MemoryStorage(), crypto: new WebCryptoProvider({ wasmInput: wasm }),
      disableUpdates: true, logLevel: 1, // solo errori; mtcute non registra contenuti dei messaggi a questo livello
    });
    if (session) await tg.importSession(session);
    await tg.connect();
    return tg;
  };
}
