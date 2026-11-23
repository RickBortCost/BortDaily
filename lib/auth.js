// Accesso con codice personale (come il proxy di BortEconomy: ACCESS_CODES "nome:codice,nome2:codice2")
// e sessione lato server con cookie HttpOnly.
//
// - Confronto dei codici a tempo costante; al massimo 20 tentativi falliti all'ora per IP, con rallentamento.
// - Cookie "__Host-bd_sid": HttpOnly, Secure, SameSite=Lax (Lax è necessario per il ritorno da Google OAuth),
//   Path=/. In KV si salva solo l'hash SHA-256 dell'identificativo, mai l'identificativo stesso.
// - CSRF: le richieste che modificano dati richiedono Origin uguale al sito e l'intestazione X-BortDaily
//   (non inviabile da altri siti senza preflight CORS, che il server non concede). Vedi router.js.
import { randomId, same, sha256hex } from "./crypto.js";
import { HttpError, clientIp } from "./http.js";
import { log } from "./log.js";

export const SESSION_TTL = 30 * 86400;
const MAX_FAILS = 20;

export const cookieName = (secure) => (secure ? "__Host-bd_sid" : "bd_sid");
const isSecure = (url) => url.protocol === "https:";

export function users(env) {
  const out = [];
  for (const entry of String(env.ACCESS_CODES ?? "").split(",")) {
    const i = entry.indexOf(":");
    if (i < 1) continue;
    const name = entry.slice(0, i).trim(), code = entry.slice(i + 1).trim();
    if (/^[\w.-]{1,40}$/.test(name) && code.length >= 12) out.push({ name, code });
  }
  return out;
}

export async function whoIs(code, env) {
  if (typeof code !== "string" || !code || code.length > 200) return null;
  let who = null;
  for (const u of users(env)) if (await same(code, u.code)) who = u.name; // nessuna uscita anticipata
  return who;
}

function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookie = (url, value, maxAge) => `${cookieName(isSecure(url))}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(url) ? "; Secure" : ""}`;

export async function login({ request, env, store, url, body, delay = 600 }) {
  const ip = clientIp(request), fk = `f:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const fails = +((await store.kv.get(fk)) ?? 0);
  if (fails >= MAX_FAILS) throw new HttpError(429, "Troppi tentativi non validi. Riprova più tardi.", "rate_limited");
  const who = await whoIs(body.code, env);
  if (!who) {
    await store.kv.put(fk, String(fails + 1), { expirationTtl: 7200 });
    if (delay) await new Promise((r) => setTimeout(r, delay)); // rallenta i tentativi di indovinare il codice
    log("login", { status: "fail" });
    throw new HttpError(401, "Codice di accesso non valido.", "bad_code");
  }
  const sid = randomId(32);
  await store.put(`s:${await sha256hex(sid)}`, { user: who, created: Date.now() }, SESSION_TTL);
  log("login", { user: who, status: "ok" });
  return { user: who, setCookie: cookie(url, sid, SESSION_TTL) };
}

export async function session({ request, env, store, url }) {
  const sid = parseCookies(request)[cookieName(isSecure(url))];
  if (!sid || !/^[\w-]{40,60}$/.test(sid)) return null;
  const s = await store.get(`s:${await sha256hex(sid)}`);
  // l'utente deve esistere ancora in ACCESS_CODES: togliere un codice revoca subito le sue sessioni
  if (!s || !users(env).some((u) => u.name === s.user)) return null;
  return { user: s.user, key: `s:${await sha256hex(sid)}` };
}

export async function logout({ store, sess, url }) {
  if (sess) await store.del(sess.key);
  return cookie(url, "", 0);
}
