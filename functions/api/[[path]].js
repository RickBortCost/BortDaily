// API di BortDaily su Cloudflare Pages Functions (stessa origine del sito: /api/...). Logica in lib/router.js.
//
// Variabili del progetto (impostate da scripts/cf-deploy.mjs a partire dai secret di GitHub):
//   ACCESS_CODES                          "nome:codice,nome2:codice2" – chi può accedere
//   BORT_DATA_KEY [, BORT_DATA_KEY_PREVIOUS]  chiave AES-256 (32 byte base64) per i dati cifrati a riposo
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET [, GOOGLE_REDIRECT_URI]
//   TELEGRAM_API_ID, TELEGRAM_API_HASH
//   TTL_<SORGENTE>                        facoltative: durata della cache in secondi (es. TTL_GMAIL=120)
//   DATA                                  KV (sessioni, layout, impostazioni, token cifrati)
import { handle } from "../../lib/router.js";
import { makeTelegramFactory } from "../../lib/telegram/client.js";
import wasm from "../../lib/telegram/wasm-cf.js";

const telegramFactory = makeTelegramFactory(wasm);

export const onRequest = ({ request, env }) => handle(request, env, { telegramFactory });
