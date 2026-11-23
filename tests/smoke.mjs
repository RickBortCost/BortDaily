// Test end-to-end dell'interfaccia (Playwright, iPhone e iPad) con il server di sviluppo e sorgenti finte.
// Uso: node tests/smoke.mjs   (CHROMIUM_PATH=… per un Chromium diverso; DEBUG=1 per gli stack)
import { chromium, devices } from "playwright";
import { startServer } from "../scripts/dev.mjs";
import { testEnv, fakeFetch } from "./helpers.mjs";

console.log = ((orig) => (...a) => { if (!String(a[0]).startsWith('{"t":')) orig(...a); })(console.log);

const now = new Date(), iso = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const rss = (n) => `<rss><channel><title>Fonte</title>${Array.from({ length: n }, (_, i) => `<item><title>Notizia numero ${i + 1}</title><link>https://example.com/${i}</link><pubDate>${new Date(Date.now() - i * 60000).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
let feedDown = false;
const upstream = fakeFetch([
  [/geocoding-api\.open-meteo/, { body: { results: [{ name: "Milano", admin1: "Lombardia", country_code: "IT", latitude: 45.46, longitude: 9.19 }] } }],
  [/\/\/api\.open-meteo\.com/, { body: { current: { temperature_2m: 17.6, apparent_temperature: 16, relative_humidity_2m: 60, weather_code: 2, wind_speed_10m: 8, is_day: 1 },
    daily: { time: [0, 1, 2, 3].map((i) => new Date(Date.now() + i * 864e5).toISOString().slice(0, 10)), weather_code: [2, 61, 0, 3], temperature_2m_max: [18, 15, 19, 17], temperature_2m_min: [9, 8, 7, 10], precipitation_probability_max: [10, 80, 0, 20] } } }],
  [/news\.google\.com.*WORLD/, () => (feedDown ? { status: 500 } : { body: rss(20), type: "application/rss+xml" })],
  [/news\.google\.com/, { body: rss(5), type: "application/rss+xml" }],
  [/oauth2\.googleapis\.com\/token/, (u, init) => ({ body: new URLSearchParams(init.body).get("grant_type") === "authorization_code"
    ? { access_token: "ya29.x", refresh_token: "1//r", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly" }
    : { access_token: "ya29.y", expires_in: 3600 } })],
  [/oauth2\.googleapis\.com\/revoke/, { body: {} }],
  [/gmail.*\/profile/, { body: { emailAddress: "utente@example.com" } }],
  [/labels\/INBOX/, { body: { messagesUnread: 3 } }],
  [/gmail.*messages\?/, { body: { messages: [{ id: "m1" }, { id: "m2" }] } }],
  [/gmail.*messages\/m\d/, (u) => ({ body: { id: u.match(/m\d/)[0], threadId: "t1", internalDate: String(Date.now()), snippet: "Anteprima <script>alert(1)</script>", payload: { headers: [{ name: "From", value: "Mario Rossi <m@x.it>" }, { name: "Subject", value: "Riunione di domani" }] } } })],
  [/calendarList/, { body: { items: [{ id: "primary", summary: "Personale", backgroundColor: "#16a34a" }] } }],
  [/calendars\/primary\/events/, { body: { items: [{ id: "e1", summary: "Dentista", start: { dateTime: iso(15) }, end: { dateTime: iso(16) }, htmlLink: "https://calendar.google.com/x" }, { id: "e2", summary: "Compleanno", start: { date: today }, end: { date: today } }] } }],
  [/users\/@me\/lists/, { body: { items: [{ id: "L", title: "Casa" }] } }],
  [/lists\/L\/tasks/, { body: { items: [{ id: "t1", title: "Pagare bolletta", due: "2020-01-01T00:00:00.000Z", status: "needsAction" }, { id: "t2", title: "Chiamare Luca", due: `${today}T00:00:00.000Z`, status: "needsAction" }] } }],
]);
const telegramFactory = async () => ({
  async sendCode() { return { phoneCodeHash: "h", type: "app" }; },
  async signIn() { return { displayName: "Utente Prova" }; },
  async exportSession() { return "sessione"; },
  async logOut() {}, async destroy() {},
  async *iterDialogs() { yield { peer: { id: 1, displayName: "Giulia", type: "user", username: "giulia" }, unreadCount: 2, isMuted: false }; },
  async getHistory() { return [{ text: "Ci sei stasera?", date: new Date(), isOutgoing: false }]; },
});

const env = testEnv({ ACCESS_CODES: "prova:codice-prova-smoke", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs", TELEGRAM_API_ID: "1", TELEGRAM_API_HASH: "h", APP_VERSION: "0.1.0" });
const server = await startServer({ env, port: 0, deps: { fetch: upstream, telegramFactory, cacheApi: null, cacheMem: new Map(), loginDelay: 0 } });
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [], errors = [];
let page, ctx;
async function test(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(true); console.log(`✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(false); console.log(`✗ ${name}\n    ${String(e.message).split("\n")[0]}`); if (process.env.DEBUG) console.log(e.stack); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function open(device) {
  ctx = await browser.newContext({ ...devices[device], serviceWorkers: "block" });
  // Google OAuth finto: la pagina di consenso torna subito al sito con un codice
  // (Playwright non intercetta le richieste raggiunte tramite redirect: si intercetta /api/google/connect)
  await ctx.route("**/api/google/connect", async (r) => {
    const res = await r.fetch({ maxRedirects: 0 });
    const auth = new URL(res.headers().location);
    assert(auth.origin === "https://accounts.google.com", "redirect OAuth");
    await r.fulfill({ status: 302, headers: { location: `${BASE}api/google/callback?state=${auth.searchParams.get("state")}&code=ok` } });
  });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE);
}
// SHOTS=cartella salva schermate per il controllo visivo
const shot = async (name, opts = {}) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, ...opts }); };
const widget = (type) => page.locator(`.w[data-id="${type}"]`);

// ================= iPhone
await open("iPhone 13");

await test("accesso: codice errato, poi corretto", async () => {
  await page.waitForSelector("#view-login:not([hidden])");
  await page.fill("#login-code", "codice-sbagliato-123");
  await page.click("#login-form button");
  await page.waitForSelector("#login-error:has-text('non valido')");
  await page.fill("#login-code", "codice-prova-smoke");
  await page.click("#login-form button");
  await page.waitForSelector("#view-dash:not([hidden])");
  assert(/Buon/.test(await page.textContent("#dash-title")), "saluto assente");
  assert((await page.textContent("#foot")).includes("v0.1.0"), "versione assente");
});

await test("widget indipendenti: stati da collegare/configurare e notizie caricate", async () => {
  await page.waitForSelector('.w[data-id="notizie"] .list li');
  await page.waitForSelector('.w[data-id="meteo"] .w-state:has-text("Imposta la città")');
  await page.waitForSelector('.w[data-id="posta"] .w-state:has-text("Collega")');
  await page.waitForSelector('.w[data-id="telegram"] .w-state:has-text("Collega")');
  assert(await widget("notizie").locator(".chips button").count() === 7, "categorie notizie");
});

await test("notizie: cambio categoria salvato", async () => {
  await page.click('.w[data-id="notizie"] .chips button:has-text("Economia")');
  await page.waitForSelector('.w[data-id="notizie"] .chips button[aria-pressed="true"]:has-text("Economia")');
  await page.waitForFunction(() => document.querySelectorAll('.w[data-id="notizie"] .list li').length === 5);
});

await test("impostazioni: città meteo e widget aggiornato", async () => {
  await page.click("#settings-btn");
  await page.waitForSelector("#view-settings:not([hidden])");
  await page.fill("#city-q", "Milano");
  await page.click("#city-form button");
  await page.click("#city-results button");
  await page.waitForSelector("#weather-current:has-text('Milano')");
  await page.click('a[aria-label="Torna alla dashboard"]');
  await page.waitForSelector('.w[data-id="meteo"] .wx-temp');
  assert((await widget("meteo").locator(".wx-temp").textContent()).trim() === "18°", "temperatura");
  assert(await widget("meteo").locator(".wx-days > div").count() === 4, "previsioni");
});

await test("Google: connetti (OAuth) e widget Gmail, Calendar, Tasks", async () => {
  await page.goto(`${BASE}#/impostazioni`);
  await page.click('#acct-google a:has-text("Connetti")');
  await page.waitForSelector("#acct-google .ok");
  assert((await page.textContent("#acct-google")).includes("utente@example.com"), "email");
  await page.goto(BASE);
  await page.waitForSelector('.w[data-id="posta"] .list li');
  assert((await widget("posta").locator(".badge").textContent()).trim() === "3", "conteggio non lette");
  const html = await widget("posta").innerHTML();
  assert(html.includes("&lt;script&gt;") && !html.includes("<script>"), "anteprima non sanificata");
  assert(await widget("posta").locator("a.item").first().getAttribute("rel") === "noopener noreferrer", "rel dei link");
  await page.waitForSelector('.w[data-id="agenda"] .cal-day:has-text("Oggi")');
  assert(await widget("agenda").locator(".cal-ev").count() === 2, "eventi");
  await page.waitForSelector('.w[data-id="promemoria"] .due.over');
  assert((await widget("promemoria").locator(".sum").textContent()).includes("1 in scadenza oggi"), "riepilogo promemoria");
});

await test("Telegram: collegamento con codice e messaggi non letti", async () => {
  await page.goto(`${BASE}#/impostazioni`);
  await page.fill('#acct-telegram input[name="phone"]', "+39 333 1234567");
  await page.click('#acct-telegram button[type="submit"]');
  await page.fill('#acct-telegram input[name="code"]', "12345");
  await page.click('#acct-telegram button[type="submit"]');
  await page.waitForSelector("#acct-telegram .ok");
  await page.goto(BASE);
  await page.waitForSelector('.w[data-id="telegram"] .tg-chat');
  assert((await widget("telegram").textContent()).includes("Ci sei stasera?"), "messaggio");
  await page.waitForTimeout(300);
  await shot("iphone-dashboard", { fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await shot("iphone-dashboard-dark");
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
});

await test("errore di una sorgente isolato nel suo widget", async () => {
  feedDown = true;
  await page.click('.w[data-id="notizie"] .chips button:has-text("Mondo")');
  await page.waitForSelector('.w[data-id="notizie"] .w-state.err');
  assert(await widget("meteo").locator(".wx-temp").count() === 1 && await widget("posta").locator(".list li").count() > 0, "altri widget coinvolti");
  feedDown = false;
  await page.click('.w[data-id="notizie"] [data-retry]');
  await page.waitForSelector('.w[data-id="notizie"] .list li');
});

await test("trascina per aggiornare (pull-to-refresh)", async () => {
  await page.evaluate(() => scrollTo(0, 0));
  const forced = [];
  const onReq = (r) => { if (/\/api\/widget\/.*refresh=1/.test(r.url())) forced.push(r.url()); };
  page.on("request", onReq);
  const cdp = await ctx.newCDPSession(page);
  const tp = (y) => [{ x: 200, y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(150) });
  for (let y = 160; y <= 300; y += 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(y) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => !document.querySelector("#ptr.busy"));
  await page.waitForTimeout(300);
  page.off("request", onReq);
  assert(forced.length >= 4, `aggiornamenti forzati: ${forced.length}`);
});

await test("personalizza: dimensione, ordine con frecce, rimozione e aggiunta salvati sul server", async () => {
  await page.click("#edit-btn");
  await page.waitForSelector("body.editing");
  await page.click('.w[data-id="meteo"] [data-size="L"]');
  await page.click('.w[data-id="agenda"] [data-move="-1"]');
  await page.click('.w[data-id="telegram"] [data-remove]');
  await page.selectOption("#add-type", "telegram");
  await page.click("#add-btn");
  await page.click("#done-btn");
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('.w[data-id="meteo"].size-L');
  const order = await page.$$eval(".w", (l) => l.map((w) => w.dataset.id));
  assert(order[0] === "agenda" && order.at(-1) === "telegram", `ordine ${order}`);
});

await test("tocchi da almeno 44 px (dashboard in modifica e impostazioni)", async () => {
  await page.click("#edit-btn");
  const small = async () => page.$$eval("button:not([hidden]), a.primary, a.ghost, a.icon-btn, input:not([type=checkbox]), select, .list a.item", (els) =>
    els.filter((e) => e.offsetParent && !e.closest("[hidden]")).map((e) => [e, e.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.height < 43.5 || r.width < 43.5)).map(([e, r]) => `${e.tagName}.${e.className} ${e.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`));
  await shot("iphone-edit");
  const a = await small();
  await page.click("#edit-btn");
  await page.goto(`${BASE}#/impostazioni`);
  await page.waitForSelector("#view-settings:not([hidden])");
  await shot("iphone-settings", { fullPage: true });
  const b = await small();
  assert(!a.length && !b.length, [...a, ...b].join(" | "));
});

await test("contrasto del testo (AA) in tema chiaro e scuro", async () => {
  await page.goto(BASE);
  await page.waitForSelector('.w[data-id="posta"] .list li');
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const bad = await page.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      // sfondo effettivo: composizione dei livelli semitrasparenti fino a uno opaco
      const rgba = (c) => { const v = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
      const bgOf = (el) => {
        const layers = [];
        for (; el; el = el.parentElement) { const c = rgba(getComputedStyle(el).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
        let out = layers.length && layers.at(-1)[3] >= 1 ? layers.pop() : [255, 255, 255, 1];
        while (layers.length) { const [r, g, b, a] = layers.pop(); out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a), 1]; }
        return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
      };
      const out = [];
      for (const sel of [".meta", ".item .s", ".item .t", ".w-foot", ".badge", ".w-head h2", ".sum", ".due", "#dash-title", ".chips button"]) {
        for (const el of [...document.querySelectorAll(sel)].slice(0, 3)) {
          const fg = getComputedStyle(el).color, bg = bgOf(el);
          if (/gradient/.test(getComputedStyle(el).backgroundImage)) continue;
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < 4.5) out.push(`${sel} ${ratio.toFixed(2)}`);
        }
      }
      return out;
    });
    assert(!bad.length, `${theme}: ${bad.join(", ")}`);
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
});

await test("tema scuro dal pulsante", async () => {
  await page.click("#theme-btn"); await page.click("#theme-btn");
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "tema scuro non applicato");
  await page.click("#theme-btn");
});

await test("nessuno scorrimento orizzontale (iPhone)", async () => {
  for (const h of ["#/", "#/impostazioni"]) {
    await page.goto(BASE + h); await page.waitForTimeout(300);
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `overflow in ${h}`);
  }
});

await test("intestazioni di sicurezza e CSP", async () => {
  const r = await page.request.get(BASE);
  const h = r.headers();
  assert(/default-src 'none'/.test(h["content-security-policy"]) && /frame-ancestors 'none'/.test(h["content-security-policy"]), "CSP");
  assert(h["x-content-type-options"] === "nosniff" && h["referrer-policy"] === "no-referrer" && h["x-frame-options"] === "DENY", "intestazioni");
  const api = await page.request.get(`${BASE}api/me`);
  assert(api.headers()["cache-control"] === "no-store", "API in cache");
});

await test("uscita", async () => {
  await page.goto(`${BASE}#/impostazioni`);
  await page.click("#logout-btn");
  await page.waitForSelector("#view-login:not([hidden])");
  await page.goto(BASE);
  await page.waitForSelector("#view-login:not([hidden])");
});
await ctx.close();

// ================= iPad
await open("iPad Pro 11");
await test("iPad: griglia a 4 colonne e trascinamento dei widget", async () => {
  await page.fill("#login-code", "codice-prova-smoke");
  await page.click("#login-form button");
  await page.waitForSelector('.w[data-id="agenda"]');
  const cols = await page.$eval("#dash", (d) => getComputedStyle(d).gridTemplateColumns.split(" ").length);
  assert(cols === 4, `colonne: ${cols}`);
  await page.click("#edit-btn");
  const first = await page.$$eval(".w", (l) => l.map((w) => w.dataset.id));
  const grip = page.locator(`.w[data-id="${first[0]}"] [data-grip]`);
  const target = await page.locator(`.w[data-id="${first[2]}"] .w-head`).boundingBox();
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(g.x + (target.x + 40 - g.x) * i / 10, g.y + (target.y + 20 - g.y) * i / 10);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.$$eval(".w", (l) => l.map((w) => w.dataset.id));
  assert(after.indexOf(first[0]) === 2, `ordine dopo il trascinamento: ${after}`);
  await page.click("#done-btn");
  await page.waitForTimeout(500);
  await shot("ipad-dashboard");
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "overflow iPad");
});
await ctx.close();

await test("nessun errore JavaScript né violazioni CSP", async () => assert(!errors.length, errors.join(" | ")));

await browser.close();
server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} test superati`);
process.exit(failed ? 1 : 0);
