// Test degli adapter con risposte registrate (nessuna rete). Uso: node tests/adapters.mjs
import { check, rejects, done, testEnv, fakeFetch } from "./helpers.mjs";
import { runAdapter } from "../lib/adapters/base.js";
import { weather, geocode } from "../lib/adapters/weather.js";
import { news, parseFeed } from "../lib/adapters/news.js";
import { gmail, senderName } from "../lib/adapters/gmail.js";
import { calendar } from "../lib/adapters/calendar.js";
import { tasks } from "../lib/adapters/tasks.js";
import { telegram } from "../lib/adapters/telegram.js";
import { tokenProvider, SCOPE_OF } from "../lib/google.js";
import { clientProvider } from "../lib/telegram/session.js";
import { makeStore } from "../lib/store.js";
import { DEFAULT_SETTINGS } from "../lib/settings.js";

console.log = ((orig) => (...a) => { if (!String(a[0]).startsWith('{"t":')) orig(...a); })(console.log); // niente log strutturati nell'output
const NOW = Date.parse("2026-11-23T09:00:00Z");
const base = (extra = {}) => ({ user: "anna", now: NOW, settings: { ...DEFAULT_SETTINGS, ...extra } });

// ---------------- meteo
{
  const fx = { current: { temperature_2m: 12.34, apparent_temperature: 10.1, relative_humidity_2m: 80, weather_code: 61, wind_speed_10m: 9.5, is_day: 1 },
    daily: { time: ["2026-11-23", "2026-11-24"], weather_code: [61, 0], temperature_2m_max: [14, 16], temperature_2m_min: [8, 7], precipitation_probability_max: [90, 5] } };
  const f = fakeFetch([[/api\.open-meteo\.com\/v1\/forecast/, { body: fx }]]);
  const d = await weather.fetch({ ...base({ weather: { name: "Milano", lat: 45.464, lon: 9.19 } }), fetch: f });
  check("meteo: condizioni attuali in italiano", d.current.temp === 12.3 && d.current.desc === "Pioggia debole" && d.current.icon === "rain");
  check("meteo: previsioni giornaliere", d.daily.length === 2 && d.daily[1].desc === "Sereno" && d.daily[0].rain === 90);
  check("meteo: coordinate nella richiesta", /latitude=45\.464&longitude=9\.190/.test(f.calls[0].url));
  const r = await runAdapter(weather, { ...base(), fetch: f });
  check("meteo: senza località → da configurare", r.status === "unconfigured" && /Impostazioni/.test(r.error.message));
  const e = await runAdapter(weather, { ...base({ weather: { name: "X", lat: 1, lon: 1 } }), fetch: fakeFetch([[/./, { status: 500 }]]) });
  check("meteo: errore della sorgente gestito", e.status === "error" && e.error.code === "upstream");
  const g = await geocode(fakeFetch([[/geocoding/, { body: { results: [{ name: "Roma", admin1: "Lazio", country_code: "IT", latitude: 41.89193, longitude: 12.51133 }] } }]]), "Roma");
  check("geocoding: nome completo e coordinate arrotondate", g[0].name === "Roma, Lazio, IT" && g[0].lat === 41.892);
  check("geocoding: testo troppo corto", (await geocode(fakeFetch([]), "R")).length === 0);
}

// ---------------- notizie
{
  const rss = `<?xml version="1.0"?><rss><channel><title>Fonte RSS</title>
    <item><title>Primo titolo - ANSA</title><link>https://ansa.it/1</link><source url="https://ansa.it">ANSA</source><pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Secondo & "virgolette"]]></title><link>https://x.it/2</link><pubDate>Mon, 23 Nov 2026 07:00:00 GMT</pubDate></item>
    <item><title>Link pericoloso</title><link>javascript:alert(1)</link></item>
  </channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog Atom</title>
    <entry><title>Voce Atom</title><link href="https://blog.it/a"/><updated>2026-11-23T08:30:00Z</updated></entry>
    <entry><title>primo titolo</title><link href="https://blog.it/dup"/><updated>2026-11-22T08:30:00Z</updated></entry></feed>`;
  const items = parseFeed(rss, "https://feeds.example.com/rss");
  check("RSS: titolo ripulito dalla fonte (stile Google News)", items[0].title === "Primo titolo" && items[0].source === "ANSA");
  check("RSS: CDATA ed entità", items[1].title === 'Secondo & "virgolette"' && items[1].source === "Fonte RSS");
  check("RSS: link non http scartati", items.length === 2);
  check("Atom: link da attributo href", parseFeed(atom, "https://blog.it/feed")[0].link === "https://blog.it/a");
  const settings = { news: { categories: [{ id: "mix", name: "Mix", feeds: ["https://feeds.example.com/rss", "https://blog.it/feed", "https://down.example.com/rss"] }, { id: "vuota", name: "Vuota", feeds: ["https://down.example.com/rss"] }] } };
  const f = fakeFetch([[/feeds\.example/, { body: rss, type: "application/rss+xml" }], [/blog\.it/, { body: atom, type: "application/atom+xml" }], [/down\.example/, { status: 503 }]]);
  const d = await news.fetch({ ...base(settings), fetch: f }, { cat: "mix" });
  check("notizie: più fonti unite e ordinate per data", d.items.map((n) => n.title).join("|") === "Voce Atom|Primo titolo|Secondo & \"virgolette\"");
  check("notizie: duplicati tra fonti rimossi", !d.items.some((n) => n.link === "https://blog.it/dup"));
  check("notizie: fonte non raggiungibile segnalata, non bloccante", d.failedFeeds === 1);
  check("notizie: elenco categorie per i filtri", d.categories.length === 2);
  const r = await runAdapter(news, { ...base(settings), fetch: f }, { cat: "vuota" });
  check("notizie: nessuna fonte raggiungibile → errore del widget", r.status === "error" && /Nessuna fonte/.test(r.error.message));
  const big = fakeFetch([[/./, { body: "x".repeat(2_100_000), type: "text/xml" }]]);
  const rb = await runAdapter(news, { ...base({ news: { categories: [{ id: "a", name: "A", feeds: ["https://big.example.com/rss"] }] } }), fetch: big }, { cat: "a" });
  check("notizie: risposta troppo grande scartata", rb.status === "error");
  const d2 = await news.fetch({ ...base(), fetch: fakeFetch([[/news\.google\.com/, { body: rss }]]) }, {});
  check("notizie: categorie predefinite (Google News in italiano)", d2.category === "mondo" && d2.items.length === 2);
}

// ---------------- Google: token
const env = testEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
const store = makeStore(env);
await store.putSecret("t:anna:google", { refresh: "1//rt", scopes: Object.values(SCOPE_OF), email: "anna@example.com" });
const tokenRoute = [/oauth2\.googleapis\.com\/token/, { body: { access_token: "ya29.token", expires_in: 3600 } }];
const googleCtx = (routes, extra = {}) => {
  const f = fakeFetch([tokenRoute, ...routes]);
  return { ...base(extra), fetch: f, google: tokenProvider({ env, store, user: "anna", fetchImpl: f }) };
};

// ---------------- Gmail
{
  check("mittente: solo il nome", senderName('"Rossi, Mario" <mario@x.it>') === "Rossi, Mario" && senderName("info@x.it") === "info@x.it");
  const msg = (id, from, subject) => ({ id, threadId: `t${id}`, internalDate: String(NOW), snippet: "Ciao, ecco l&#39;anteprima", payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } });
  const ctx = googleCtx([
    [/labels\/INBOX/, { body: { messagesUnread: 42 } }],
    [/messages\?/, { body: { messages: [{ id: "a" }, { id: "b" }] } }],
    [/messages\/a\?/, { body: msg("a", "Mario <m@x.it>", "Fattura") }],
    [/messages\/b\?/, { body: msg("b", "b@x.it", "") }],
  ]);
  const d = await gmail.fetch(ctx, { limit: 5 });
  check("Gmail: conteggio non lette dalla casella", d.unread === 42);
  check("Gmail: mittente, oggetto, anteprima decodificata", d.items[0].from === "Mario" && d.items[0].subject === "Fattura" && d.items[0].snippet === "Ciao, ecco l'anteprima");
  check("Gmail: oggetto mancante", d.items[1].subject === "(senza oggetto)");
  check("Gmail: link alla conversazione", d.items[0].link === "https://mail.google.com/mail/#inbox/ta");
  const q = ctx.fetch.calls.find((c) => /messages\?/.test(c.url)).url;
  check("Gmail: solo non lette in arrivo, formato metadati", /is%3Aunread\+in%3Ainbox/.test(q) && ctx.fetch.calls.some((c) => /format=metadata/.test(c.url)));
  check("Gmail: token nell'intestazione, mai nell'URL", ctx.fetch.calls.filter((c) => /gmail/.test(c.url)).every((c) => c.init.headers.authorization === "Bearer ya29.token" && !c.url.includes("ya29")));
  const expired = await runAdapter(gmail, googleCtx([[/gmail/, { status: 401 }]]));
  check("Gmail: token revocato → ricollega", expired.status === "disconnected" && /ricollega/i.test(expired.error.message));
  const noRefresh = { ...base(), fetch: fakeFetch([[/token/, { status: 400, body: { error: "invalid_grant" } }]]) };
  noRefresh.google = tokenProvider({ env, store, user: "bob", fetchImpl: noRefresh.fetch });
  const r = await runAdapter(gmail, noRefresh);
  check("Gmail: account non collegato", r.status === "disconnected" && /Collega/.test(r.error.message));
}

// ---------------- Calendar
{
  const ctx = googleCtx([
    [/calendarList/, { body: { items: [{ id: "primary", summary: "Personale", backgroundColor: "#4f46e5" }, { id: "lavoro@x", summary: "Lavoro", backgroundColor: "red" }, { id: "nascosto", summary: "N", hidden: true }] } }],
    [/calendars\/primary\/events/, { body: { items: [
      { id: "1", summary: "Riunione", start: { dateTime: "2026-11-23T15:00:00+01:00" }, end: { dateTime: "2026-11-23T16:00:00+01:00" }, htmlLink: "https://calendar.google.com/e1" },
      { id: "2", summary: "Ferie", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } },
      { id: "3", summary: "Annullato", status: "cancelled", start: { date: "2026-11-24" } },
    ] } }],
    [/lavoro%40x\/events/, { body: { items: [{ id: "4", start: { dateTime: "2026-11-23T08:30:00+01:00" }, end: { dateTime: "2026-11-23T09:00:00+01:00" } }] } }],
  ]);
  const d = await calendar.fetch(ctx);
  check("Calendar: eventi ordinati per giorno e ora, annullati esclusi", d.items.map((e) => e.id).join() === "4,1,2");
  check("Calendar: titolo mancante e colore non valido gestiti", d.items[0].title === "(senza titolo)" && d.items[0].color === null && d.items[1].color === "#4f46e5");
  check("Calendar: evento di giornata intera", d.items[2].allDay && d.items[2].day === "2026-11-24");
  check("Calendar: calendari nascosti esclusi", !ctx.fetch.calls.some((c) => c.url.includes("nascosto")));
  const ev = ctx.fetch.calls.find((c) => /primary\/events/.test(c.url)).url;
  check("Calendar: intervallo oggi + 3 giorni nel fuso dell'utente", ev.includes("timeMin=2026-11-22T23%3A00%3A00.000Z") && ev.includes("timeMax=2026-11-26T23%3A00%3A00.000Z"));
  const partial = googleCtx([[/calendarList/, { body: { items: [{ id: "a" }, { id: "b" }] } }], [/calendars\/a\//, { body: { items: [] } }], [/calendars\/b\//, { status: 500 }]]);
  check("Calendar: un calendario in errore non blocca gli altri", (await calendar.fetch(partial)).items.length === 0);
}

// ---------------- Tasks
{
  const ctx = googleCtx([
    [/users\/@me\/lists/, { body: { items: [{ id: "L1", title: "Casa" }, { id: "L2", title: "Lavoro" }] } }],
    [/lists\/L1\/tasks/, { body: { items: [
      { id: "a", title: "Bollette", due: "2026-11-20T00:00:00.000Z", status: "needsAction", webViewLink: "https://tasks.google.com/task/a" },
      { id: "b", title: "Spesa", due: "2026-11-23T00:00:00.000Z", status: "needsAction" },
      { id: "c", title: "Domani", due: "2026-11-24T00:00:00.000Z", status: "needsAction" },
      { id: "d", title: "Senza data", status: "needsAction" },
    ] } }],
    [/lists\/L2\/tasks/, { body: { items: [{ id: "e", title: "Fatto", due: "2026-11-21T00:00:00.000Z", status: "completed" }] } }],
  ]);
  const d = await tasks.fetch(ctx);
  check("Tasks: solo scadute e in scadenza oggi", d.items.map((t) => t.id).join() === "a,b");
  check("Tasks: conteggi scadute / oggi", d.overdue === 1 && d.dueToday === 1 && d.items[0].overdue && !d.items[1].overdue);
  check("Tasks: link all'attività o a Google Tasks", d.items[0].link === "https://tasks.google.com/task/a" && d.items[1].link === "https://tasks.google.com/");
  check("Tasks: solo attività non completate", ctx.fetch.calls.some((c) => /showCompleted=false/.test(c.url)));
  const limited = googleCtx([]);
  await store.putSecret("t:carla:google", { refresh: "x", scopes: [SCOPE_OF.gmail] });
  limited.google = tokenProvider({ env, store, user: "carla", fetchImpl: limited.fetch });
  const r = await runAdapter(tasks, limited);
  check("Tasks: permesso non concesso in fase di consenso", r.status === "disconnected" && /Permesso non concesso/.test(r.error.message));
}

// ---------------- Telegram (client finto con la stessa interfaccia di mtcute)
{
  const tgEnv = testEnv({ TELEGRAM_API_ID: "123", TELEGRAM_API_HASH: "hash" });
  const tgStore = makeStore(tgEnv);
  const peer = (id, displayName, type, username = null) => ({ id, displayName, type, username });
  const dialogs = [
    { peer: peer(1, "Giulia", "user", "giulia"), unreadCount: 2, isMuted: false },
    { peer: peer(2, "Letto", "user"), unreadCount: 0, isMuted: false },
    { peer: peer(3, "Gruppo silenziato", "chat"), unreadCount: 50, isMuted: true },
    { peer: peer(4, "Famiglia", "chat"), unreadCount: 1, isMuted: false },
  ];
  const history = {
    1: [{ text: "Ci vediamo alle 8?", date: new Date(NOW), isOutgoing: false, sender: peer(1, "Giulia", "user") }, { text: "", media: { type: "photo" }, date: new Date(NOW - 1000), isOutgoing: false }],
    4: [{ text: "x".repeat(300), date: new Date(NOW), isOutgoing: false, sender: peer(9, "Papà", "user") }],
  };
  let destroyed = 0, lastSession = null;
  const factory = async ({ session }) => {
    lastSession = session;
    if (session === "revocata") return { async *iterDialogs() { throw Object.assign(new Error("x"), { text: "AUTH_KEY_UNREGISTERED" }); }, async destroy() { destroyed++; } };
    return {
      async *iterDialogs() { yield* dialogs; },
      async getHistory(p, { limit }) { return (history[p.id] ?? []).slice(0, limit); },
      async destroy() { destroyed++; },
    };
  };
  const ctxFor = (user, settings = {}) => ({ ...base(settings), user, telegram: clientProvider({ env: tgEnv, store: tgStore, user, factory }) });
  await tgStore.putSecret("t:anna:telegram", { session: "sessione-anna" });
  const d = await telegram.fetch(ctxFor("anna"), { limit: 5 });
  check("Telegram: solo chat con non letti, silenziate escluse", d.items.map((i) => i.chat).join() === "Giulia,Famiglia" && d.unreadChats === 2 && d.unreadTotal === 3);
  check("Telegram: ultimi messaggi, media come etichetta", d.items[0].messages.length === 2 && d.items[0].messages[1].text === "[Foto]");
  check("Telegram: mittente nei gruppi, testo troncato", d.items[1].messages[0].from === "Papà" && d.items[1].messages[0].text.length === 160);
  check("Telegram: link solo per chat pubbliche", d.items[0].link === "https://t.me/giulia" && d.items[1].link === null);
  check("Telegram: sessione decifrata e client chiuso", lastSession === "sessione-anna" && destroyed === 1);
  const muted = await telegram.fetch(ctxFor("anna", { telegram: { includeMuted: true } }), {});
  check("Telegram: chat silenziate se richiesto", muted.unreadChats === 3);
  const nc = await runAdapter(telegram, ctxFor("bob"));
  check("Telegram: non collegato", nc.status === "disconnected" && /Collega/.test(nc.error.message));
  await tgStore.putSecret("t:carla:telegram", { session: "revocata" });
  const rv = await runAdapter(telegram, ctxFor("carla"));
  check("Telegram: sessione revocata → ricollega, client chiuso comunque", rv.status === "disconnected" && /ricollega/i.test(rv.error.message) && destroyed === 3);
  const off = await runAdapter(telegram, { ...base(), user: "anna", telegram: clientProvider({ env: testEnv(), store: tgStore, user: "anna", factory }) });
  check("Telegram: server senza api_id → da configurare", off.status === "unconfigured");
}

await rejects("token Google senza account", () => tokenProvider({ env, store, user: "zeta", fetchImpl: fakeFetch([]) }).token(), /not_connected|Collega/);
done();
