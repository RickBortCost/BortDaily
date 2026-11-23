// Pagina Impostazioni: account collegati, città meteo, categorie e fonti delle notizie, frequenza di aggiornamento.
import { $, $$, esc, icon, api, toast, dateShort } from "./util.js";

let ctx = { me: null, onChange: () => {} };
const REFRESH = [5, 10, 15, 30, 60];
const GOOGLE_MSG = {
  ok: "Account Google collegato.", denied: "Autorizzazione annullata.", state: "Richiesta scaduta o non valida: riprova.",
  exchange: "Google non ha confermato l'accesso: riprova.", no_refresh: "Google non ha concesso l'accesso continuativo: scollega l'app dal tuo account Google e riprova.",
  sessione: "Sessione scaduta: accedi di nuovo e ricollega Google.", code: "Risposta di Google non valida.",
};

export function initSettings({ onChange }) {
  ctx.onChange = onChange;
  $("#city-form").addEventListener("submit", searchCity);
  $("#city-results").addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) saveWeather(cityResults[+b.dataset.i]); });
  $("#geo-btn").addEventListener("click", useLocation);
  $("#weather-clear").addEventListener("click", () => saveSettings({ weather: null }, "Località rimossa."));
  $("#cat-add").addEventListener("click", () => { const c = readCats(); c.push({ name: "", feeds: [] }); renderCats(c); $$("#cats .cat input").at(-1)?.focus(); });
  $("#cat-reset").addEventListener("click", resetCats);
  $("#cat-save").addEventListener("click", () => saveSettings({ news: { categories: readCats().map((c) => ({ ...c, feeds: c.feeds })) } }, "Notizie salvate."));
  $("#cats").addEventListener("click", (e) => { const b = e.target.closest("[data-del]"); if (b) { const c = readCats(); c.splice(+b.dataset.del, 1); renderCats(c); } });
  $("#general-save").addEventListener("click", () => saveSettings({
    refreshMinutes: +$("#refresh-sel").value, timezone: $("#tz-input").value.trim(), telegram: { includeMuted: $("#tg-muted").checked },
  }, "Impostazioni salvate."));
  $("#refresh-sel").innerHTML = REFRESH.map((m) => `<option value="${m}">Ogni ${m} minuti</option>`).join("");
  try { $("#tz-list").innerHTML = Intl.supportedValuesOf("timeZone").map((z) => `<option value="${esc(z)}">`).join(""); } catch { /* elenco facoltativo */ }
  $("#acct-google").addEventListener("click", onGoogle);
  $("#acct-telegram").addEventListener("click", onTelegramClick);
  $("#acct-telegram").addEventListener("submit", onTelegramSubmit);
}

export function renderSettings(me, query) {
  ctx.me = me;
  const s = me.settings;
  renderAccounts();
  $("#weather-current").textContent = s.weather ? `Località attuale: ${s.weather.name}` : "Nessuna località impostata.";
  renderCats(s.news.categories);
  $("#refresh-sel").value = String(s.refreshMinutes);
  $("#tz-input").value = s.timezone;
  $("#tg-muted").checked = !!s.telegram?.includeMuted;
  $("#session-user").textContent = `Accesso come ${me.user}.`;
  const g = query?.get("google");
  if (g) { toast(GOOGLE_MSG[g] ?? "Collegamento Google non riuscito."); history.replaceState(null, "", "#/impostazioni"); }
}

// ---------- account
function renderAccounts() {
  const { google: g, telegram: t } = ctx.me.accounts;
  const scopes = { gmail: "Gmail", calendar: "Calendar", tasks: "Tasks" };
  $("#acct-google").innerHTML = `<div class="info"><div class="name">${icon("mail")} Google</div>
    ${!g.configured ? `<p class="meta">Non configurato sul server (vedi README).</p>`
      : g.connected ? `<p class="meta"><span class="ok">Collegato</span>${g.email ? ` · ${esc(g.email)}` : ""} · sola lettura: ${g.scopes.map((x) => scopes[x]).join(", ") || "nessun permesso"}</p>`
      : `<p class="meta">Gmail, Calendar e Tasks in sola lettura.</p>`}</div>
    ${g.configured ? (g.connected ? `<button class="ghost danger" data-g="off">Scollega</button>` : `<a class="primary" href="/api/google/connect" data-g="on">Connetti</a>`) : ""}`;
  $("#acct-telegram").innerHTML = `<div class="info"><div class="name">${icon("send")} Telegram</div>
    ${!t.configured ? `<p class="meta">Non configurato sul server (vedi README).</p>`
      : t.connected ? `<p class="meta"><span class="ok">Collegato</span>${t.name ? ` · ${esc(t.name)}` : ""}${t.connectedAt ? ` · dal ${esc(dateShort(t.connectedAt))}` : ""}</p>`
      : `<p class="meta">Messaggi non letti (sola lettura, non segna i messaggi come letti).</p>`}</div>
    ${t.configured ? (t.connected ? `<button class="ghost danger" data-t="off">Scollega</button>` : tgStep("phone")) : ""}`;
}

async function onGoogle(e) {
  const b = e.target.closest("[data-g=off]");
  if (!b) return;
  if (!confirm("Scollegare l'account Google? L'autorizzazione verrà revocata.")) return;
  b.disabled = true;
  try { await api("google/disconnect", { method: "POST", body: {} }); toast("Google scollegato."); await ctx.onChange(); }
  catch (err) { toast(err.message); b.disabled = false; }
}

function tgStep(step, extra = {}) {
  if (step === "phone") return `<form data-step="phone" class="row"><label class="field grow"><span>Numero di telefono</span>
    <input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="+39 333 1234567" required maxlength="20"></label>
    <button class="primary" type="submit">Invia codice</button><p class="form-error" role="alert"></p></form>`;
  if (step === "code") return `<form data-step="code" class="row"><label class="field grow"><span>Codice ricevuto ${extra.via === "app" ? "nell'app Telegram" : "via SMS"}</span>
    <input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="8" pattern="[0-9 ]*"></label>
    <button class="primary" type="submit">Conferma</button><button class="ghost" type="button" data-t="restart">Annulla</button><p class="form-error" role="alert"></p></form>`;
  return `<form data-step="password" class="row"><label class="field grow"><span>Password della verifica in due passaggi${extra.hint ? ` (suggerimento: ${esc(extra.hint)})` : ""}</span>
    <input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
    <button class="primary" type="submit">Accedi</button><button class="ghost" type="button" data-t="restart">Annulla</button><p class="form-error" role="alert"></p></form>`;
}

async function onTelegramClick(e) {
  const b = e.target.closest("[data-t]");
  if (!b) return;
  if (b.dataset.t === "restart") { renderAccounts(); return; }
  if (b.dataset.t === "off") {
    if (!confirm("Scollegare Telegram? La sessione verrà chiusa anche su Telegram.")) return;
    b.disabled = true;
    try { await api("telegram/disconnect", { method: "POST", body: {} }); toast("Telegram scollegato."); await ctx.onChange(); }
    catch (err) { toast(err.message); b.disabled = false; }
  }
}

async function onTelegramSubmit(e) {
  e.preventDefault();
  const form = e.target, step = form.dataset.step, btn = form.querySelector("[type=submit]"), out = form.querySelector(".form-error");
  const v = Object.fromEntries(new FormData(form));
  btn.disabled = true; out.textContent = "";
  try {
    const path = { phone: "telegram/code", code: "telegram/signin", password: "telegram/password" }[step];
    const r = await api(path, { method: "POST", body: v });
    if (r.next === "done") { toast(`Telegram collegato${r.name ? `: ${r.name}` : ""}.`); await ctx.onChange(); return; }
    form.outerHTML = tgStep(r.next, r);
    $("#acct-telegram input")?.focus();
  } catch (err) {
    out.textContent = err.message; btn.disabled = false;
    if (err.code === "expired") setTimeout(renderAccounts, 1500);
  }
}

// ---------- meteo
let cityResults = [];
async function searchCity(e) {
  e.preventDefault();
  const q = $("#city-q").value.trim();
  if (q.length < 2) return;
  try {
    cityResults = (await api(`geocode?q=${encodeURIComponent(q)}`)).results;
    $("#city-results").innerHTML = cityResults.length
      ? cityResults.map((c, i) => `<li><button data-i="${i}">${icon("pin", "ic sm")} ${esc(c.name)}</button></li>`).join("")
      : `<li class="meta">Nessuna città trovata.</li>`;
  } catch (err) { toast(err.message); }
}
async function saveWeather(loc) {
  await saveSettings({ weather: loc }, `Meteo: ${loc.name}`);
  $("#city-results").innerHTML = ""; $("#city-q").value = "";
}
function useLocation() {
  if (!navigator.geolocation) { toast("Geolocalizzazione non disponibile su questo dispositivo."); return; }
  $("#geo-btn").disabled = true;
  navigator.geolocation.getCurrentPosition(
    (p) => { $("#geo-btn").disabled = false; saveWeather({ name: "Posizione attuale", lat: p.coords.latitude, lon: p.coords.longitude }); },
    (err) => { $("#geo-btn").disabled = false; toast(err.code === 1 ? "Permesso di posizione negato." : "Posizione non disponibile."); },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

// ---------- notizie
function renderCats(cats) {
  $("#cats").innerHTML = cats.map((c, i) => `<div class="cat" data-id="${esc(c.id ?? "")}">
    <div class="head"><label class="field"><span>Nome categoria</span><input name="name" value="${esc(c.name)}" maxlength="30" required></label>
      <button class="icon-btn" type="button" data-del="${i}" aria-label="Elimina categoria ${esc(c.name)}">${icon("x")}</button></div>
    <label class="field"><span>Fonti (una per riga)</span><textarea name="feeds" rows="3" spellcheck="false" autocapitalize="off">${esc((c.feeds ?? []).join("\n"))}</textarea></label>
  </div>`).join("");
}
function readCats() {
  return $$("#cats .cat").map((el) => ({
    ...(el.dataset.id ? { id: el.dataset.id } : {}),
    name: $("[name=name]", el).value.trim(),
    feeds: $("[name=feeds]", el).value.split(/\s+/).map((s) => s.trim()).filter(Boolean),
  }));
}
async function resetCats() {
  if (!confirm("Ripristinare le categorie predefinite? Le fonti personalizzate andranno perse.")) return;
  renderCats(ctx.me.defaults.newsCategories); // elenco predefinito fornito dal server; si applica con "Salva notizie"
}

async function saveSettings(patch, okMsg) {
  try {
    await api("settings", { method: "PUT", body: patch });
    toast(okMsg);
    await ctx.onChange();
  } catch (err) { toast(err.message); }
}
