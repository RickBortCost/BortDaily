// API di BortDaily (stessa origine del sito: /api/...). Unico punto che parla con le API esterne.
//
//   GET  /api/status                     stato pubblico (nessun dato sensibile)
//   POST /api/login | /api/logout        accesso con codice personale
//   GET  /api/me                         utente, layout, impostazioni, account collegati
//   PUT  /api/layout | /api/settings     salvataggio per utente (validato)
//   GET  /api/widget/<tipo>              dati di un widget (?size=S|M|L, ?cat=…, ?refresh=1)
//   GET  /api/geocode?q=…                ricerca città (Open-Meteo)
//   GET  /api/google/connect|callback    OAuth Google · POST /api/google/disconnect
//   POST /api/telegram/code|signin|password|disconnect
import { json, err, HttpError, readJson } from "./http.js";
import { makeStore } from "./store.js";
import { makeCache } from "./cache.js";
import { log } from "./log.js";
import { login, logout, session } from "./auth.js";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, validateLayout, validateSettings } from "./settings.js";
import { runAdapter } from "./adapters/base.js";
import { weather, geocode } from "./adapters/weather.js";
import { news, DEFAULT_CATEGORIES } from "./adapters/news.js";
import { gmail } from "./adapters/gmail.js";
import { calendar } from "./adapters/calendar.js";
import { tasks } from "./adapters/tasks.js";
import { telegram } from "./adapters/telegram.js";
import * as google from "./google.js";
import * as tgs from "./telegram/session.js";

export const ADAPTERS = Object.fromEntries([weather, news, gmail, calendar, tasks, telegram].map((a) => [a.id, a]));
const LIMIT_BY_SIZE = { S: 3, M: 6, L: 12 }, TG_LIMIT_BY_SIZE = { S: 2, M: 4, L: 8 };

// Limite di richieste per utente (per istanza, indicativo): 120 al minuto
const hits = new Map();
function allow(user, limit = 120) {
  const slot = Math.floor(Date.now() / 60000), k = `${user}:${slot}`;
  const n = (hits.get(k) ?? 0) + 1;
  hits.set(k, n);
  if (hits.size > 5000) hits.clear();
  return n <= limit;
}

const redirect = (to, extra = {}) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", ...extra } });

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;
  const t0 = Date.now();
  const fetchImpl = deps.fetch ?? fetch;
  let user = null;
  try {
    // Origine e CSRF: tutto ciò che modifica dati arriva solo dal sito stesso
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Origine non ammessa.", "origin");
    if (!["GET", "HEAD"].includes(method)) {
      if (origin !== url.origin || request.headers.get("x-bortdaily") !== "1") throw new HttpError(403, "Richiesta non ammessa.", "csrf");
      if (!/^application\/json\b/.test(request.headers.get("content-type") ?? "")) throw new HttpError(415, "Formato non supportato.", "content_type");
    }
    const store = makeStore(env);

    if (path === "status" && method === "GET") {
      const s = await session({ request, env, store, url });
      return json({ authenticated: !!s, user: s?.user ?? null, version: env.APP_VERSION ?? null });
    }
    if (path === "login" && method === "POST") {
      const r = await login({ request, env, store, url, body: await readJson(request, 1000), delay: deps.loginDelay });
      return json({ user: r.user }, 200, { "set-cookie": r.setCookie });
    }

    const sess = await session({ request, env, store, url });
    if (!sess) {
      if (path === "google/callback") return redirect("/#/impostazioni?google=sessione");
      throw new HttpError(401, "Accesso richiesto.", "unauthenticated");
    }
    user = sess.user;
    if (!allow(user, deps.rateLimit)) throw new HttpError(429, "Troppe richieste. Riprova tra un minuto.", "rate_limited");

    const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...((await store.get(`u:${user}:settings`)) ?? {}) });
    const telegramFactory = deps.telegramFactory;

    if (path === "logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": await logout({ store, sess, url }) });

    if (path === "me" && method === "GET") {
      const [layout, settings, g, t] = await Promise.all([
        store.get(`u:${user}:layout`), getSettings(), google.accountInfo(store, user), tgs.accountInfo(store, user),
      ]);
      return json({
        user, layout: layout ?? DEFAULT_LAYOUT, settings, defaults: { newsCategories: DEFAULT_CATEGORIES },
        accounts: {
          google: { configured: google.googleConfigured(env), ...g },
          telegram: { configured: tgs.telegramConfigured(env) && !!telegramFactory, ...t },
        },
      });
    }
    if (path === "layout" && method === "PUT") {
      const layout = validateLayout(await readJson(request));
      await store.put(`u:${user}:layout`, layout);
      return json({ layout });
    }
    if (path === "settings" && method === "PUT") {
      const settings = validateSettings(await readJson(request, 30_000), await getSettings());
      await store.put(`u:${user}:settings`, settings);
      return json({ settings });
    }

    if (path.startsWith("widget/") && method === "GET") {
      const adapter = ADAPTERS[path.slice(7)];
      if (!adapter) throw new HttpError(404, "Widget sconosciuto.", "not_found");
      const settings = await getSettings();
      const size = ["S", "M", "L"].includes(url.searchParams.get("size")) ? url.searchParams.get("size") : "M";
      const params = { limit: (adapter.id === "telegram" ? TG_LIMIT_BY_SIZE : LIMIT_BY_SIZE)[size] };
      if (adapter.id === "news") params.cat = (url.searchParams.get("cat") ?? "").slice(0, 30);
      if (adapter.id === "weather") params.loc = settings.weather; // la cache cambia con la località
      if (["calendar", "tasks"].includes(adapter.id)) params.tz = settings.timezone;
      const ctx = { fetch: fetchImpl, settings, user, now: Date.now() };
      if (adapter.requires === "google") {
        if (!google.googleConfigured(env)) {
          return json({ type: adapter.id, status: "unconfigured", data: null, error: { code: "not_configured", message: "Google non è configurato sul server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." }, updated: null });
        }
        ctx.google = google.tokenProvider({ env, store, user, fetchImpl });
      }
      if (adapter.requires === "telegram") {
        if (!telegramFactory) return json({ type: adapter.id, status: "unconfigured", data: null, error: { code: "not_configured", message: "Telegram non è disponibile su questo server." }, updated: null });
        ctx.telegram = tgs.clientProvider({ env, store, user, factory: telegramFactory });
      }
      const cache = makeCache(env, { mem: deps.cacheMem, cacheApi: deps.cacheApi });
      const out = await runAdapter(adapter, ctx, params, { cache, force: url.searchParams.get("refresh") === "1", env });
      return json(out);
    }

    if (path === "geocode" && method === "GET") return json({ results: await geocode(fetchImpl, url.searchParams.get("q")) });

    if (path === "google/connect" && method === "GET") {
      if (!google.googleConfigured(env)) throw new HttpError(503, "Google non è configurato sul server.", "not_configured");
      return redirect(await google.startAuth({ env, store, user, origin: url.origin }));
    }
    if (path === "google/callback" && method === "GET") {
      const r = await google.finishAuth({ env, store, user, origin: url.origin, params: url.searchParams, fetchImpl });
      log("google_connect", { user, status: r.ok ? "ok" : "fail", reason: r.reason });
      return redirect(`/#/impostazioni?google=${r.ok ? "ok" : r.reason}`);
    }
    if (path === "google/disconnect" && method === "POST") {
      await google.disconnect({ store, user, fetchImpl });
      return json({ ok: true });
    }

    if (path.startsWith("telegram/") && method === "POST") {
      if (!tgs.telegramConfigured(env) || !telegramFactory) throw new HttpError(503, "Telegram non è configurato sul server.", "not_configured");
      const body = await readJson(request, 2000);
      const a = { env, store, user, factory: telegramFactory };
      const step = path.slice(9);
      if (step === "code") return json(await tgs.sendCode({ ...a, phone: body.phone }));
      if (step === "signin") return json(await tgs.signIn({ ...a, code: body.code }));
      if (step === "password") return json(await tgs.checkPassword({ ...a, password: body.password }));
      if (step === "disconnect") { await tgs.disconnect(a); return json({ ok: true }); }
    }

    throw new HttpError(404, "Percorso non disponibile.", "not_found");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    log("api", { user, route: path.split("/").slice(0, 2).join("/"), method, status, code: e instanceof HttpError ? e.code : "internal", ms: Date.now() - t0 });
    return e instanceof HttpError ? err(e.status, e.message, e.code) : err(500, "Errore interno.", "internal");
  }
}
