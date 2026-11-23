// Utilità comuni dell'interfaccia.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// Testo sempre con escape; link esterni solo http(s)
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? String(u) : "#");
export const ext = (u, inner, cls = "item") => `<a class="${cls}" href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
export const icon = (name, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Chiamate all'API del sito: solo stessa origine, intestazione anti-CSRF sulle modifiche
export class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export async function api(path, { method = "GET", body, signal } = {}) {
  const init = { method, credentials: "same-origin", signal, headers: {} };
  if (body !== undefined) { init.headers = { "content-type": "application/json", "x-bortdaily": "1" }; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api/${path}`, init); }
  catch (e) { if (e.name === "AbortError") throw e; throw new ApiError(0, "Connessione non disponibile.", "offline"); }
  let j = null;
  try { j = await res.json(); } catch { /* risposta vuota */ }
  if (res.status === 401 && path !== "login") onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, j?.error?.message ?? `Errore ${res.status}`, j?.error?.code);
  return j;
}

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3500);
}

// Date in italiano
const fmt = (o) => new Intl.DateTimeFormat("it-IT", o);
export const timeHM = (d) => fmt({ hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const dayLong = (d) => fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(d));
export const dayShort = (d) => fmt({ weekday: "short", day: "numeric" }).format(new Date(d));
export const dateShort = (d) => fmt({ day: "numeric", month: "short" }).format(new Date(d));
export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// "AAAA-MM-GG" → Date a mezzogiorno locale (evita salti di giorno per fuso)
export const fromYmd = (s) => new Date(`${s}T12:00:00`);

export function ago(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "ora";
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h fa`;
  return dateShort(iso);
}
export function relDay(s) {
  const today = ymd(), d = new Date(); d.setDate(d.getDate() + 1);
  if (s === today) return "Oggi";
  if (s === ymd(d)) return "Domani";
  return fmt({ weekday: "long", day: "numeric", month: "short" }).format(fromYmd(s));
}
