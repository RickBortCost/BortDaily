// OAuth 2.0 Google lato server (Authorization Code + PKCE S256 + state).
// Il refresh token resta cifrato in KV; il browser non riceve mai token di Google.
import { b64u, randomId } from "./crypto.js";
import { AdapterError } from "./adapters/base.js";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";

// Scope minimi, in sola lettura
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks.readonly",
];
export const SCOPE_OF = { gmail: SCOPES[0], calendar: SCOPES[1], tasks: SCOPES[2] };
const STATE_TTL = 600;

export const googleConfigured = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const redirectUri = (env, origin) => env.GOOGLE_REDIRECT_URI || `${origin}/api/google/callback`;
const recordKey = (user) => `t:${user}:google`;

export async function startAuth({ env, store, user, origin }) {
  const state = randomId(24), verifier = randomId(48);
  const challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await store.putSecret(`o:${state}`, { user, verifier }, STATE_TTL);
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, origin), response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "false",
    state, code_challenge: challenge, code_challenge_method: "S256",
  });
  return `${AUTH}?${q}`;
}

// → { ok: true } oppure { ok: false, reason }
export async function finishAuth({ env, store, user, origin, params, fetchImpl = fetch }) {
  const state = params.get("state") ?? "";
  if (!/^[\w-]{20,64}$/.test(state)) return { ok: false, reason: "state" };
  const pending = await store.getSecret(`o:${state}`);
  await store.del(`o:${state}`); // monouso
  if (!pending || pending.user !== user) return { ok: false, reason: "state" };
  if (params.get("error")) return { ok: false, reason: "denied" };
  const code = params.get("code");
  if (!code || code.length > 1000) return { ok: false, reason: "code" };
  const res = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env, origin), grant_type: "authorization_code", code_verifier: pending.verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { ok: false, reason: "exchange" };
  const tok = await res.json();
  if (!tok.refresh_token) return { ok: false, reason: "no_refresh" };
  const granted = String(tok.scope ?? "").split(" ").filter((s) => SCOPES.includes(s));
  let email = null;
  if (granted.includes(SCOPE_OF.gmail)) {
    const p = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (p?.ok) email = (await p.json()).emailAddress ?? null;
  }
  await store.putSecret(recordKey(user), { refresh: tok.refresh_token, scopes: granted, email, connectedAt: new Date().toISOString() });
  tokenMem.delete(user);
  return { ok: true };
}

export async function accountInfo(store, user) {
  const r = await store.getSecret(recordKey(user));
  return r ? { connected: true, email: r.email, scopes: Object.keys(SCOPE_OF).filter((k) => r.scopes.includes(SCOPE_OF[k])), connectedAt: r.connectedAt } : { connected: false };
}

export async function disconnect({ store, user, fetchImpl = fetch }) {
  const r = await store.getSecret(recordKey(user));
  tokenMem.delete(user);
  await store.del(recordKey(user));
  if (r?.refresh) {
    await fetchImpl(REVOKE, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: r.refresh }), signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
}

// Access token di breve durata: solo in memoria dell'istanza
const tokenMem = new Map();
export function tokenProvider({ env, store, user, fetchImpl = fetch }) {
  let record;
  return {
    async scopes() { record ??= await store.getSecret(recordKey(user)); return record?.scopes ?? []; },
    async token(scope) {
      record ??= await store.getSecret(recordKey(user));
      if (!record) throw new AdapterError("not_connected", "Collega l'account Google nelle Impostazioni.");
      if (scope && !record.scopes.includes(scope)) throw new AdapterError("not_connected", "Permesso non concesso: ricollega Google e autorizza questa sorgente.");
      const m = tokenMem.get(user);
      if (m && m.exp > Date.now() + 60_000) return m.token;
      const res = await fetchImpl(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: record.refresh, grant_type: "refresh_token" }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 400 || res.status === 401) throw new AdapterError("auth_expired", "Accesso a Google scaduto o revocato: ricollega l'account nelle Impostazioni.");
      if (!res.ok) throw new AdapterError("upstream", `Google ha restituito un errore (${res.status}).`);
      const j = await res.json();
      tokenMem.set(user, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
      return j.access_token;
    },
  };
}

// GET autenticato verso un'API Google
export async function gget(ctx, scope, url, source) {
  const token = await ctx.google.token(scope);
  const res = await ctx.fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (res.ok) return res.json();
  if (res.status === 401) throw new AdapterError("auth_expired", "Accesso a Google scaduto: ricollega l'account nelle Impostazioni.");
  if (res.status === 403) throw new AdapterError("forbidden", `${source}: permesso negato o API non abilitata nel progetto Google Cloud.`);
  if (res.status === 429) throw new AdapterError("rate_limited", "Troppe richieste a Google. Riprova tra qualche minuto.");
  throw new AdapterError("upstream", `${source} ha restituito un errore (${res.status}).`);
}
