// Collegamento dell'account Telegram (Client API): telefono → codice → eventuale password 2FA.
// La sessione MTProto è salvata cifrata in KV; i passaggi intermedi hanno una durata di 10 minuti.
import { AdapterError } from "../adapters/base.js";
import { HttpError } from "../http.js";

const PENDING_TTL = 600;
const sessionKey = (user) => `t:${user}:telegram`;
const pendingKey = (user) => `p:${user}:telegram`;

export const telegramConfigured = (env) => !!(env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH);

const rpcText = (e) => String(e?.text ?? e?.message ?? "");
const LOGIN_ERRORS = {
  PHONE_NUMBER_INVALID: "Numero di telefono non valido.",
  PHONE_NUMBER_BANNED: "Questo numero è stato bloccato da Telegram.",
  PHONE_CODE_INVALID: "Codice non corretto.",
  PHONE_CODE_EXPIRED: "Codice scaduto: richiedine uno nuovo.",
  PASSWORD_HASH_INVALID: "Password non corretta.",
  API_ID_INVALID: "TELEGRAM_API_ID / TELEGRAM_API_HASH non validi sul server.",
};
function loginError(e) {
  const t = rpcText(e);
  if (/^FLOOD_WAIT/.test(t) || e?.code === 420) return new HttpError(429, "Troppi tentativi: Telegram chiede di attendere. Riprova più tardi.", "flood");
  for (const [k, msg] of Object.entries(LOGIN_ERRORS)) if (t.includes(k)) return new HttpError(400, msg, k.toLowerCase());
  return new HttpError(502, "Telegram non ha accettato la richiesta. Riprova.", "telegram");
}

async function withClient(factory, env, session, fn) {
  const tg = await factory({ apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH, session });
  try { return await fn(tg); } finally { await tg.destroy().catch(() => {}); }
}

async function saveAccount(store, user, tg, me) {
  await store.putSecret(sessionKey(user), {
    session: await tg.exportSession(), name: String(me?.displayName ?? "").slice(0, 80), connectedAt: new Date().toISOString(),
  });
  await store.del(pendingKey(user));
  return { next: "done", name: String(me?.displayName ?? "") };
}

export async function sendCode({ env, store, user, factory, phone }) {
  phone = String(phone ?? "").replace(/[\s()-]/g, "");
  if (!/^\+\d{7,15}$/.test(phone)) throw new HttpError(400, "Inserisci il numero in formato internazionale, es. +39…", "bad_phone");
  return withClient(factory, env, null, async (tg) => {
    let sent;
    try { sent = await tg.sendCode({ phone }); } catch (e) { throw loginError(e); }
    if (!sent?.phoneCodeHash) return saveAccount(store, user, tg, sent); // già autorizzato
    await store.putSecret(pendingKey(user), { phone, hash: sent.phoneCodeHash, session: await tg.exportSession(), step: "code" }, PENDING_TTL);
    return { next: "code", via: sent.type === "app" ? "app" : "sms", length: sent.length ?? null };
  });
}

export async function signIn({ env, store, user, factory, code }) {
  code = String(code ?? "").replace(/\D/g, "");
  if (code.length < 4 || code.length > 8) throw new HttpError(400, "Codice non valido.", "bad_code");
  const p = await store.getSecret(pendingKey(user));
  if (!p || p.step !== "code") throw new HttpError(409, "Richiesta scaduta: ricomincia dal numero di telefono.", "expired");
  return withClient(factory, env, p.session, async (tg) => {
    try {
      return await saveAccount(store, user, tg, await tg.signIn({ phone: p.phone, phoneCodeHash: p.hash, phoneCode: code }));
    } catch (e) {
      if (rpcText(e).includes("SESSION_PASSWORD_NEEDED")) {
        const hint = await tg.getPasswordHint().catch(() => null);
        await store.putSecret(pendingKey(user), { ...p, session: await tg.exportSession(), step: "password" }, PENDING_TTL);
        return { next: "password", hint: hint ? String(hint).slice(0, 60) : null };
      }
      throw loginError(e);
    }
  });
}

export async function checkPassword({ env, store, user, factory, password }) {
  password = String(password ?? "");
  if (!password || password.length > 256) throw new HttpError(400, "Password non valida.", "bad_password");
  const p = await store.getSecret(pendingKey(user));
  if (!p || p.step !== "password") throw new HttpError(409, "Richiesta scaduta: ricomincia dal numero di telefono.", "expired");
  return withClient(factory, env, p.session, async (tg) => {
    try { return await saveAccount(store, user, tg, await tg.checkPassword(password)); } catch (e) { throw loginError(e); }
  });
}

export async function accountInfo(store, user) {
  const r = await store.getSecret(sessionKey(user));
  const pending = await store.getSecret(pendingKey(user));
  return r ? { connected: true, name: r.name, connectedAt: r.connectedAt } : { connected: false, pending: pending?.step ?? null };
}

export async function disconnect({ env, store, user, factory }) {
  const r = await store.getSecret(sessionKey(user));
  await store.del(sessionKey(user));
  await store.del(pendingKey(user));
  if (r?.session && factory && telegramConfigured(env)) {
    await withClient(factory, env, r.session, (tg) => tg.logOut()).catch(() => {}); // revoca la sessione su Telegram
  }
}

// Client per l'adapter: errori tradotti in AdapterError
export function clientProvider({ env, store, user, factory }) {
  return {
    async run(fn) {
      if (!telegramConfigured(env)) throw new AdapterError("not_configured", "Telegram non è configurato sul server (TELEGRAM_API_ID / TELEGRAM_API_HASH).");
      const r = await store.getSecret(sessionKey(user));
      if (!r) throw new AdapterError("not_connected", "Collega l'account Telegram nelle Impostazioni.");
      try {
        return await withClient(factory, env, r.session, fn);
      } catch (e) {
        if (e instanceof AdapterError) throw e;
        const t = rpcText(e);
        if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_INVALID/.test(t)) {
          throw new AdapterError("auth_expired", "Sessione Telegram scaduta o revocata: ricollega l'account nelle Impostazioni.");
        }
        if (/^FLOOD_WAIT/.test(t)) throw new AdapterError("rate_limited", "Telegram chiede di attendere. Riprova tra qualche minuto.");
        throw new AdapterError("upstream", "Telegram non è raggiungibile in questo momento.");
      }
    },
  };
}
