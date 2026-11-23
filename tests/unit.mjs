// Test unitari del nucleo del backend (senza rete). Uso: node tests/unit.mjs
import { check, rejects, done, testEnv, TEST_KEY } from "./helpers.mjs";
import { seal, open, dataKeys, randomId, same } from "../lib/crypto.js";
import { makeStore, MemoryKV } from "../lib/store.js";
import { makeCache } from "../lib/cache.js";
import { log } from "../lib/log.js";
import { safeFeedUrl, safeLink, decodeEntities, clip, readJson } from "../lib/http.js";
import { startOfDay, localDate } from "../lib/time.js";
import { validateLayout, validateSettings, DEFAULT_SETTINGS, DEFAULT_LAYOUT } from "../lib/settings.js";
import { users, whoIs } from "../lib/auth.js";
import { runAdapter, AdapterError, ttlFor } from "../lib/adapters/base.js";

// --- cifratura
const env = testEnv();
const keys = await dataKeys(env);
const box = await seal({ refresh: "1//segreto" }, keys, "t:anna:google");
check("il valore cifrato non contiene il segreto in chiaro", !box.includes("segreto"));
check("decifratura con lo stesso record", (await open(box, keys, "t:anna:google")).refresh === "1//segreto");
await rejects("il valore non si può spostare su un altro record (AAD)", () => open(box, keys, "t:bob:google"));
const tampered = box.slice(0, -3) + (box.endsWith("A") ? "BBB" : "AAA");
await rejects("valore manomesso rifiutato", () => open(tampered, keys, "t:anna:google"));
check("IV diverso a ogni cifratura", (await seal(1, keys, "x")) !== (await seal(1, keys, "x")));
const newKey = Buffer.alloc(32, 9).toString("base64");
const rotated = await dataKeys({ BORT_DATA_KEY: newKey, BORT_DATA_KEY_PREVIOUS: TEST_KEY });
check("rotazione: i dati cifrati con la chiave precedente restano leggibili", (await open(box, rotated, "t:anna:google")).refresh === "1//segreto");
await rejects("chiave mancante", () => dataKeys({}), /BORT_DATA_KEY/);
await rejects("chiave di lunghezza errata", () => dataKeys({ BORT_DATA_KEY: "YWJj" }), /32 byte/);
check("identificativi casuali lunghi e diversi", randomId().length === 43 && randomId() !== randomId());
check("confronto a tempo costante", (await same("abc", "abc")) && !(await same("abc", "abd")));

// --- archivio KV
const store = makeStore(env);
await store.putSecret("t:anna:telegram", { session: "sessione-segreta" });
const raw = await env.DATA.get("t:anna:telegram");
check("KV contiene solo il valore cifrato", raw.startsWith("v1.") && !raw.includes("sessione-segreta"));
check("lettura del segreto", (await store.getSecret("t:anna:telegram")).session === "sessione-segreta");
await store.put("u:anna:layout", { a: 1 }, 1);
check("TTL minimo di 60 s (vincolo KV)", env.DATA.map.get("u:anna:layout").exp - Date.now() > 50_000);
const kv = new MemoryKV(); await kv.put("x", "1", { expirationTtl: -1 });
check("KV in memoria: scadenza", (await kv.get("x")) === null);

// --- cache
const mem = new Map();
const cache = makeCache(env, { mem, cacheApi: null });
await cache.put("anna:gmail:{}", { items: ["oggetto riservato"] }, 60);
check("cache: lettura", (await cache.get("anna:gmail:{}")).value.items[0] === "oggetto riservato");
check("cache: contenuto cifrato anche in memoria", !JSON.stringify([...mem.values()]).includes("riservato"));
mem.get("anna:gmail:{}").exp = Date.now() - 1;
check("cache: scadenza TTL", (await cache.get("anna:gmail:{}")) === null);

// --- log: solo metadati
const lines = [];
log("adapter", { user: "anna", adapter: "gmail", status: "ok", subject: "Segreto", text: "messaggio", token: "ya29" }, (l) => lines.push(l));
check("log: campi non ammessi scartati", !/Segreto|messaggio|ya29/.test(lines[0]) && lines[0].includes('"adapter":"gmail"'));

// --- http
check("feed: https pubblico accettato", safeFeedUrl("https://www.ansa.it/rss.xml") === "https://www.ansa.it/rss.xml");
for (const u of ["http://example.com/rss", "https://127.0.0.1/rss", "https://localhost/rss", "https://[::1]/", "https://user:pw@example.com/", "https://intranet/rss", "https://x.internal/rss", "javascript:alert(1)", "https://example.com:8443/rss"]) {
  check(`feed rifiutato: ${u}`, safeFeedUrl(u) === null);
}
check("link solo http(s)", safeLink("javascript:alert(1)") === null && safeLink("https://a.it") === "https://a.it");
check("entità HTML", decodeEntities("L&#39;Aquila &amp; &#x41; &lt;b&gt;") === "L'Aquila & A <b>");
check("testo troncato", clip("a".repeat(20), 10).length === 10);
await rejects("JSON troppo grande", () => readJson(new Request("https://x/", { method: "POST", body: "x".repeat(200) }), 100), /too_large/);
await rejects("JSON non oggetto", () => readJson(new Request("https://x/", { method: "POST", body: "[1]" })), /bad_json/);

// --- fusi orari
const t = Date.parse("2026-03-29T10:00:00Z"); // giorno del passaggio all'ora legale in Italia
check("mezzanotte locale (Roma, cambio ora)", new Date(startOfDay(t, "Europe/Rome")).toISOString() === "2026-03-28T23:00:00.000Z");
check("mezzanotte locale +1 giorno (ora legale)", new Date(startOfDay(t, "Europe/Rome", 1)).toISOString() === "2026-03-29T22:00:00.000Z");
check("data locale (New York)", localDate(Date.parse("2026-11-23T03:00:00Z"), "America/New_York") === "2026-11-22");

// --- impostazioni e layout
check("layout predefinito valido", validateLayout(DEFAULT_LAYOUT).widgets.length === 6);
await rejects("layout: tipo sconosciuto", () => validateLayout({ widgets: [{ id: "a", type: "script", size: "M" }] }), /Tipo/);
await rejects("layout: id duplicati", () => validateLayout({ widgets: [{ id: "a", type: "news", size: "M" }, { id: "a", type: "news", size: "S" }] }), /Identificativo/);
await rejects("layout: dimensione non valida", () => validateLayout({ widgets: [{ id: "a", type: "news", size: "XL" }] }), /Dimensione/);
await rejects("layout: troppi widget", () => validateLayout({ widgets: Array.from({ length: 13 }, (_, i) => ({ id: `w${i}`, type: "news", size: "S" })) }));
const s1 = validateSettings({ weather: { name: "Milano", lat: 45.46427, lon: 9.18951 }, refreshMinutes: 15 }, DEFAULT_SETTINGS);
check("impostazioni: coordinate arrotondate", s1.weather.lat === 45.464 && s1.weather.lon === 9.19 && s1.refreshMinutes === 15);
check("impostazioni: aggiornamento parziale", s1.timezone === "Europe/Rome" && s1.news.categories.length === 7);
await rejects("impostazioni: coordinate fuori intervallo", () => validateSettings({ weather: { lat: 100, lon: 0 } }), /Coordinate/);
await rejects("impostazioni: frequenza non ammessa", () => validateSettings({ refreshMinutes: 1 }), /Frequenza/);
await rejects("impostazioni: fuso non valido", () => validateSettings({ timezone: "Marte/Olympus" }), /Fuso/);
await rejects("impostazioni: fonte non https", () => validateSettings({ news: { categories: [{ name: "X", feeds: ["http://a.it/rss"] }] } }), /Fonte non valida/);
const s2 = validateSettings({ news: { categories: [{ name: "Città & Società", feeds: ["https://a.it/rss", "https://a.it/rss"] }, { name: "Città & Società", feeds: ["https://b.it/rss"] }] } });
check("impostazioni: id categoria generato e univoco", s2.news.categories[0].id === "citta-societa" && s2.news.categories[1].id !== s2.news.categories[0].id);
check("impostazioni: fonti duplicate rimosse", s2.news.categories[0].feeds.length === 1);

// --- codici di accesso
check("codici: formato nome:codice, codici corti ignorati", users({ ACCESS_CODES: "anna:codice-lungo-123, bob:corto, :x" }).map((u) => u.name).join() === "anna");
check("codice valido", (await whoIs("codice-di-prova-bob", env)) === "bob");
check("codice errato", (await whoIs("codice-di-prova-xxx", env)) === null && (await whoIs(undefined, env)) === null);

// --- adapter base: stato, errori, cache
const ok = { id: "demo", defaultTtl: 60, async fetch() { return { n: 1 }; } };
const ko = { id: "demo", defaultTtl: 60, async fetch() { throw new AdapterError("not_connected", "Collega l'account."); } };
const boom = { id: "demo", defaultTtl: 60, async fetch() { throw new Error("dettaglio interno con dati"); } };
const c2 = makeCache(env, { mem: new Map(), cacheApi: null });
const r1 = await runAdapter(ok, { user: "anna" }, {}, { cache: c2 });
const r2 = await runAdapter(ok, { user: "anna" }, {}, { cache: c2 });
check("adapter: risultato ok e poi dalla cache", r1.status === "ok" && !r1.cached && r2.cached);
const r3 = await runAdapter(ko, { user: "anna" }, {}, {});
check("adapter: non collegato → disconnected con messaggio", r3.status === "disconnected" && r3.error.message === "Collega l'account.");
const r4 = await runAdapter(boom, { user: "anna" }, {}, {});
check("adapter: errore imprevisto senza dettagli interni", r4.status === "error" && r4.error.code === "internal" && !r4.error.message.includes("dati"));
const r5 = await runAdapter(boom, { user: "anna" }, {}, { cache: c2, force: true });
check("adapter: aggiornamento forzato ravvicinato usa la cache", r5.status === "ok" && r5.cached);
check("TTL configurabile da variabile d'ambiente", ttlFor(ok, { TTL_DEMO: "300" }) === 300 && ttlFor(ok, { TTL_DEMO: "5" }) === 60);

done();
