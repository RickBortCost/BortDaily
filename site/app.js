// Avvio dell'app: accesso, navigazione (#/ e #/impostazioni), tema, aggiornamento periodico e a trascinamento.
import { $, api, toast, dayLong, setUnauthorizedHandler } from "./util.js";
import { initDashboard, setLayout, refreshAll } from "./dashboard.js";
import { initSettings, renderSettings } from "./settings.js";

const app = { me: null, timer: null, lastRefresh: 0 };

// ---------- tema (come BortEconomy: automatico, chiaro, scuro)
const THEMES = ["auto", "light", "dark"], THEME_LABEL = { auto: "automatico", light: "chiaro", dark: "scuro" }, THEME_ICON = { auto: "i-auto", light: "i-sun", dark: "i-moon" };
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#070b16" : "#f3f5fa";
  const b = $("#theme-btn");
  b.setAttribute("aria-label", `Tema: ${THEME_LABEL[t]}`);
  b.querySelector("use").setAttribute("href", `#${THEME_ICON[t]}`);
}
const getTheme = () => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } };
$("#theme-btn").addEventListener("click", () => {
  const t = THEMES[(THEMES.indexOf(getTheme()) + 1) % 3];
  try { localStorage.setItem("theme", t); } catch { /* solo per questa sessione */ }
  applyTheme(t); toast(`Tema ${THEME_LABEL[t]}`);
});
applyTheme(getTheme());

// ---------- viste
function show(view) {
  for (const v of ["login", "dash", "settings"]) $(`#view-${v}`).hidden = v !== view;
  $("#top-actions").hidden = view === "login";
  $("#edit-btn").hidden = view !== "dash";
  $("#refresh-btn").hidden = view !== "dash";
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
}

async function loadMe(reset = false) {
  app.me = await api("me");
  setLayout(app.me.layout, { reset });
  return app.me;
}

async function route() {
  if (!app.me) return;
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  if (path === "/impostazioni") {
    show("settings");
    renderSettings(app.me, new URLSearchParams(qs ?? ""));
    document.title = "Impostazioni · BortDaily";
  } else {
    show("dash");
    $("#dash-title").textContent = greeting();
    const d = dayLong(new Date());
    $("#dash-date").textContent = d.charAt(0).toUpperCase() + d.slice(1);
    document.title = "BortDaily";
  }
  $("#main").focus({ preventScroll: true });
}

// ---------- accesso
function showLogin() {
  app.me = null;
  clearInterval(app.timer);
  show("login");
  setTimeout(() => $("#login-code").focus(), 50);
}
setUnauthorizedHandler(showLogin);

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button"), err = $("#login-error");
  btn.disabled = true; err.textContent = "";
  try {
    await api("login", { method: "POST", body: { code: $("#login-code").value } });
    $("#login-code").value = "";
    await start();
  } catch (x) { err.textContent = x.message; $("#login-code").select(); }
  finally { btn.disabled = false; }
});

$("#logout-btn").addEventListener("click", async () => {
  try { await api("logout", { method: "POST", body: {} }); } catch { /* la sessione scade comunque */ }
  location.hash = "#/";
  showLogin();
});

// ---------- aggiornamento
function schedule() {
  clearInterval(app.timer);
  const ms = (app.me?.settings.refreshMinutes ?? 10) * 60000;
  app.timer = setInterval(() => { if (document.visibilityState === "visible") doRefresh(false); }, ms);
}
async function doRefresh(force) {
  if (!app.me || $("#view-dash").hidden) return;
  app.lastRefresh = Date.now();
  const b = $("#refresh-btn");
  b.classList.add("spin");
  try { await refreshAll(force); } finally { b.classList.remove("spin"); }
}
$("#refresh-btn").addEventListener("click", () => doRefresh(true));
document.addEventListener("visibilitychange", () => {
  // al ritorno sull'app (es. dalla schermata Home) aggiorna se i dati sono vecchi
  if (document.visibilityState === "visible" && Date.now() - app.lastRefresh > (app.me?.settings.refreshMinutes ?? 10) * 60000) doRefresh(false);
});

// Trascina verso il basso per aggiornare (in cima alla pagina, solo touch)
(function pullToRefresh() {
  const ptr = $("#ptr"), THRESHOLD = 80;
  let y0 = null, dy = 0;
  addEventListener("touchstart", (e) => {
    y0 = scrollY <= 0 && e.touches.length === 1 && !$("#view-dash").hidden && !document.body.classList.contains("editing") ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(dy / THRESHOLD, 1.4);
    ptr.style.opacity = String(Math.min(p, 1));
    ptr.style.transform = `translateY(${Math.min(dy, 120) - 50}px) rotate(${p * 270}deg)`;
    ptr.classList.toggle("ready", dy > THRESHOLD);
  }, { passive: true });
  addEventListener("touchend", async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy > THRESHOLD) {
      ptr.classList.add("busy"); ptr.style.transform = "translateY(10px)";
      await doRefresh(true);
      ptr.classList.remove("busy");
    }
    ptr.style.opacity = "0"; ptr.style.transform = ""; ptr.classList.remove("ready");
  });
})();

// ---------- offline e service worker
const net = () => document.body.classList.toggle("offline", !navigator.onLine);
addEventListener("online", () => { net(); doRefresh(false); });
addEventListener("offline", net);
net();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- avvio
async function start() {
  await loadMe();
  schedule();
  app.lastRefresh = Date.now();
  await route();
}

initDashboard();
initSettings({ onChange: async () => { await loadMe(true); schedule(); await route(); } });
addEventListener("hashchange", route);

(async () => {
  try {
    const s = await api("status");
    if (s.version) $("#foot").textContent = `BortDaily v${s.version}`;
    if (!s.authenticated) { showLogin(); return; }
    await start();
  } catch (e) {
    if (e.status !== 401) { show("login"); $("#login-error").textContent = e.message; }
  }
})();
