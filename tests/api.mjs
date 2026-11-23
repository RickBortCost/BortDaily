// Test dell'API (router completo con KV in memoria e sorgenti finte). Uso: node tests/api.mjs
import { check, done, testEnv, fakeFetch } from "./helpers.mjs";
import { handle } from "../lib/router.js";

const logs = [];
console.log = ((orig) => (...a) => { if (String(a[0]).startsWith('{"t":')) logs.push(a[0]); else orig(...a); })(console.log);

const ORIGIN = "https://daily.example.com";
const env = testEnv({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", TELEGRAM_API_ID: "1", TELEGRAM_API_HASH: "h", APP_VERSION: "0.1.0" });
const upstream = fakeFetch([
  [/oauth2\.googleapis\.com\/token/, (u, init) => {
    const p = new URLSearchParams(init.body);
    if (p.get("grant_type") === "authorization_code") {
      return p.get("code") === "buono" && p.get("code_verifier")?.length > 40
        ? { body: { access_token: "ya29.a", refresh_token: "1//rt-segreto", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly" } }
        : { status: 400, body: { error: "invalid_grant" } };
    }
    return { body: { access_token: "ya29.b", expires_in: 3600 } };
  }],
  [/oauth2\.googleapis\.com\/revoke/, { body: {} }],
  [/gmail\/v1\/users\/me\/profile/, { body: { emailAddress: "anna@example.com" } }],
  [/labels\/INBOX/, { body: { messagesUnread: 1 } }],
  [/messages\?/, { body: { messages: [{ id: "m1" }] } }],
  [/messages\/m1/, { body: { id: "m1", threadId: "t1", snippet: "contenuto riservato della mail", payload: { headers: [{ name: "Subject", value: "Oggetto segreto" }] } } }],
  [/\/\/api\.open-meteo\.com/, { body: { current: { temperature_2m: 20, weather_code: 0 }, daily: { time: [] } } }],
  [/geocoding-api/, { body: { results: [{ name: "Torino", country_code: "IT", latitude: 45.07, longitude: 7.68 }] } }],
]);

// Telegram finto: sendCode → codice → password
const tgState = { loggedOut: 0 };
const telegramFactory = async ({ session }) => ({
  async sendCode({ phone }) { return phone === "+390000000000" ? Promise.reject(Object.assign(new Error(), { text: "PHONE_NUMBER_INVALID" })) : { phoneCodeHash: "hash1", type: "app", length: 5 }; },
  async signIn({ phoneCode, phoneCodeHash }) {
    if (phoneCodeHash !== "hash1") throw new Error("hash");
    if (phoneCode === "11111") throw Object.assign(new Error(), { text: "SESSION_PASSWORD_NEEDED" });
    if (phoneCode !== "22222") throw Object.assign(new Error(), { text: "PHONE_CODE_INVALID" });
    return { displayName: "Anna R." };
  },
  async checkPassword(pw) { if (pw !== "giusta") throw Object.assign(new Error(), { text: "PASSWORD_HASH_INVALID" }); return { displayName: "Anna R." }; },
  async getPasswordHint() { return "solita"; },
  async exportSession() { return `sessione-mtproto-${session ?? "nuova"}`; },
  async logOut() { tgState.loggedOut++; },
  async *iterDialogs() {},
  async destroy() {},
});

const deps = { fetch: upstream, telegramFactory, cacheApi: null, cacheMem: new Map(), loginDelay: 0, rateLimit: 1000 };
let cookie = "";
async function call(method, path, { body, origin = ORIGIN, headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (body !== undefined) { h["content-type"] = "application/json"; h["x-bortdaily"] ??= "1"; }
  if (auth && cookie) h.cookie = cookie;
  const res = await handle(new Request(`${ORIGIN}/api/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non JSON */ }
  return { status: res.status, json, headers: res.headers };
}

// ---------------- accesso e sessione
check("stato pubblico senza sessione", (await call("GET", "status")).json.authenticated === false);
check("dati protetti senza sessione → 401", (await call("GET", "me")).status === 401);
check("codice errato → 401", (await call("POST", "login", { body: { code: "sbagliato-sbagliato" } })).status === 401);
const csrf = await call("POST", "login", { body: { code: "codice-di-prova-anna" }, headers: { "x-bortdaily": "0" } });
check("CSRF: manca l'intestazione X-BortDaily → 403", csrf.status === 403);
check("CSRF: origine diversa → 403", (await call("POST", "login", { body: { code: "codice-di-prova-anna" }, origin: "https://evil.example" })).status === 403);
check("CSRF: POST senza Origin → 403", (await call("POST", "login", { body: { code: "codice-di-prova-anna" }, origin: null })).status === 403);
const li = await call("POST", "login", { body: { code: "codice-di-prova-anna" } });
const setCookie = li.headers.get("set-cookie") ?? "";
check("accesso riuscito", li.status === 200 && li.json.user === "anna");
check("cookie di sessione sicuro", /^__Host-bd_sid=[\w-]{43};/.test(setCookie) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Path=\//.test(setCookie));
cookie = setCookie.split(";")[0];
check("in KV solo l'hash della sessione", ![...env.DATA.map.keys()].some((k) => k.includes(cookie.split("=")[1])));
check("stato con sessione", (await call("GET", "status")).json.user === "anna");

// ---------------- profilo, layout, impostazioni
const me = await call("GET", "me");
check("profilo: layout e impostazioni predefiniti", me.json.layout.widgets.length === 6 && me.json.settings.refreshMinutes === 10);
check("profilo: account non collegati, server configurato", me.json.accounts.google.configured && !me.json.accounts.google.connected && me.json.accounts.telegram.configured);
const lay = { widgets: [{ id: "n", type: "news", size: "L", cat: "economia" }, { id: "m", type: "weather", size: "S" }] };
check("layout salvato", (await call("PUT", "layout", { body: lay })).status === 200);
check("layout riletto per utente", JSON.stringify((await call("GET", "me")).json.layout) === JSON.stringify(lay));
check("layout non valido → 400", (await call("PUT", "layout", { body: { widgets: [{ id: "x", type: "eval", size: "M" }] } })).status === 400);
check("impostazioni: città salvata", (await call("PUT", "settings", { body: { weather: { name: "Torino", lat: 45.07, lon: 7.68 }, refreshMinutes: 5 } })).json.settings.weather.name === "Torino");
check("impostazioni non valide → 400 con messaggio", /Frequenza/.test((await call("PUT", "settings", { body: { refreshMinutes: 2 } })).json.error.message));
check("PUT senza JSON → 415", (await handle(new Request(`${ORIGIN}/api/settings`, { method: "PUT", headers: { origin: ORIGIN, "x-bortdaily": "1", "content-type": "text/plain", cookie }, body: "{}" }), env, deps)).status === 415);
check("ricerca città", (await call("GET", "geocode?q=Torino")).json.results[0].name === "Torino, IT");

// ---------------- widget
const w = await call("GET", "widget/weather?size=S");
check("widget meteo", w.json.status === "ok" && w.json.data.current.temp === 20 && w.json.data.place === "Torino");
check("widget sconosciuto → 404", (await call("GET", "widget/shell")).status === 404);
const gm = await call("GET", "widget/gmail");
check("widget Gmail senza account → da collegare (non blocca)", gm.status === 200 && gm.json.status === "disconnected");

// ---------------- Google OAuth
const conn = await call("GET", "google/connect");
const auth = new URL(conn.headers.get("location"));
check("OAuth: reindirizzamento a Google", conn.status === 302 && auth.origin === "https://accounts.google.com");
check("OAuth: scope minimi in sola lettura", auth.searchParams.get("scope").split(" ").every((s) => /\.readonly$/.test(s)) && auth.searchParams.get("scope").split(" ").length === 3);
check("OAuth: PKCE S256, state, offline", auth.searchParams.get("code_challenge_method") === "S256" && auth.searchParams.get("state").length >= 30 && auth.searchParams.get("access_type") === "offline");
check("OAuth: redirect sulla stessa origine", auth.searchParams.get("redirect_uri") === `${ORIGIN}/api/google/callback`);
const state = auth.searchParams.get("state");
const bad = await call("GET", `google/callback?state=${"x".repeat(32)}&code=buono`);
check("OAuth: state sconosciuto rifiutato", bad.headers.get("location").endsWith("google=state"));
const cb = await call("GET", `google/callback?state=${state}&code=buono`);
check("OAuth: ritorno riuscito", cb.headers.get("location") === "/#/impostazioni?google=ok");
check("OAuth: state monouso", (await call("GET", `google/callback?state=${state}&code=buono`)).headers.get("location").endsWith("google=state"));
const raw = env.DATA.map.get("t:anna:google").v;
check("OAuth: refresh token cifrato a riposo", raw.startsWith("v1.") && !raw.includes("rt-segreto"));
const me2 = await call("GET", "me");
check("OAuth: account collegato con email e permessi", me2.json.accounts.google.connected && me2.json.accounts.google.email === "anna@example.com" && me2.json.accounts.google.scopes.length === 3);
check("API: nessun token di terze parti verso il browser", !JSON.stringify(me2.json).match(/ya29|1\/\/rt|refresh_token|"refresh"/));
const gm2 = await call("GET", "widget/gmail?size=S");
check("widget Gmail collegato", gm2.json.status === "ok" && gm2.json.data.items[0].subject === "Oggetto segreto" && !JSON.stringify(gm2.json).includes("ya29"));
check("log senza contenuti di mail né token", !logs.some((l) => /segreto|riservato|ya29|rt-/.test(l)) && logs.some((l) => l.includes('"adapter":"gmail"')));
const sessione = await call("GET", "google/callback?state=x&code=y", { auth: false });
check("OAuth: ritorno senza sessione gestito", sessione.headers.get("location").endsWith("google=sessione"));
await call("POST", "google/disconnect", { body: {} });
check("scollega Google: token revocato e cancellato", !env.DATA.map.has("t:anna:google") && upstream.calls.some((c) => /revoke/.test(c.url)));

// ---------------- Telegram
check("Telegram: numero non valido", (await call("POST", "telegram/code", { body: { phone: "123" } })).status === 400);
check("Telegram: errore di Telegram tradotto", /Numero di telefono non valido/.test((await call("POST", "telegram/code", { body: { phone: "+390000000000" } })).json.error.message));
check("Telegram: codice senza richiesta → 409", (await call("POST", "telegram/signin", { body: { code: "22222" } })).status === 409);
const sc = await call("POST", "telegram/code", { body: { phone: "+39 333 1234567" } });
check("Telegram: codice inviato nell'app", sc.json.next === "code" && sc.json.via === "app");
check("Telegram: passaggio intermedio cifrato", !env.DATA.map.get("p:anna:telegram").v.includes("hash1"));
check("Telegram: codice errato", /Codice non corretto/.test((await call("POST", "telegram/signin", { body: { code: "33333" } })).json.error.message));
const pw = await call("POST", "telegram/signin", { body: { code: "11111" } });
check("Telegram: richiesta password 2FA con suggerimento", pw.json.next === "password" && pw.json.hint === "solita");
check("Telegram: password errata", (await call("POST", "telegram/password", { body: { password: "no" } })).status === 400);
const ok = await call("POST", "telegram/password", { body: { password: "giusta" } });
check("Telegram: account collegato", ok.json.next === "done" && ok.json.name === "Anna R.");
const tgRaw = env.DATA.map.get("t:anna:telegram").v;
check("Telegram: sessione cifrata a riposo, passaggio intermedio rimosso", !tgRaw.includes("sessione-mtproto") && !env.DATA.map.has("p:anna:telegram"));
check("Telegram: stato nel profilo", (await call("GET", "me")).json.accounts.telegram.name === "Anna R.");
check("Telegram: widget collegato", (await call("GET", "widget/telegram")).json.status === "ok");
await call("POST", "telegram/disconnect", { body: {} });
check("Telegram: scollega con revoca della sessione", !env.DATA.map.has("t:anna:telegram") && tgState.loggedOut === 1);

// ---------------- isolamento tra utenti e uscita
const annaCookie = cookie; cookie = "";
const bob = await call("POST", "login", { body: { code: "codice-di-prova-bob" } });
cookie = bob.headers.get("set-cookie").split(";")[0];
check("utenti separati: Bob non vede il layout di Anna", (await call("GET", "me")).json.layout.widgets.length === 6);
cookie = annaCookie;
const lo = await call("POST", "logout", { body: {} });
check("uscita: cookie azzerato", /Max-Age=0/.test(lo.headers.get("set-cookie")));
check("uscita: sessione non più valida", (await call("GET", "me")).status === 401);
env.ACCESS_CODES = "anna:codice-di-prova-anna";
cookie = bob.headers.get("set-cookie").split(";")[0];
check("codice rimosso da ACCESS_CODES → sessioni revocate", (await call("GET", "me")).status === 401);

// ---------------- limite di tentativi
cookie = "";
for (let i = 0; i < 20; i++) await call("POST", "login", { body: { code: `tentativo-errato-${i}` } });
check("dopo 20 tentativi falliti → 429", (await call("POST", "login", { body: { code: "codice-di-prova-anna" } })).status === 429);
const limited = await handle(new Request(`${ORIGIN}/api/status`, { headers: { cookie: annaCookie } }), env, { ...deps, rateLimit: 0 });
check("limite di richieste per utente", limited.status === 200); // status è pubblico
check("risposte API mai in cache", (await call("GET", "status")).headers.get("cache-control") === "no-store");

done();
