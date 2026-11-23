// Impostazioni e layout per utente: valori predefiniti e validazione rigorosa di ogni campo in ingresso.
import { HttpError, safeFeedUrl } from "./http.js";
import { DEFAULT_CATEGORIES } from "./adapters/news.js";
import { validTz } from "./time.js";

export const WIDGET_TYPES = ["weather", "calendar", "tasks", "gmail", "news", "telegram"];
export const SIZES = ["S", "M", "L"];
export const REFRESH_MINUTES = [5, 10, 15, 30, 60];
const MAX_WIDGETS = 12, MAX_CATEGORIES = 10, MAX_FEEDS = 8;

export const DEFAULT_LAYOUT = {
  widgets: [
    { id: "meteo", type: "weather", size: "M" },
    { id: "agenda", type: "calendar", size: "L" },
    { id: "promemoria", type: "tasks", size: "M" },
    { id: "posta", type: "gmail", size: "M" },
    { id: "notizie", type: "news", size: "L" },
    { id: "telegram", type: "telegram", size: "M" },
  ],
};

export const DEFAULT_SETTINGS = {
  weather: null,
  timezone: "Europe/Rome",
  refreshMinutes: 10,
  news: { categories: DEFAULT_CATEGORIES },
  telegram: { includeMuted: false },
};

const bad = (msg) => new HttpError(400, msg, "invalid");
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function validateLayout(body) {
  const list = body?.widgets;
  if (!Array.isArray(list) || list.length > MAX_WIDGETS) throw bad(`Layout non valido (al massimo ${MAX_WIDGETS} widget).`);
  const ids = new Set();
  return {
    widgets: list.map((w) => {
      if (!w || typeof w !== "object") throw bad("Widget non valido.");
      const id = str(w.id, 20);
      if (!/^[a-z0-9-]{1,20}$/.test(id) || ids.has(id)) throw bad("Identificativo del widget non valido.");
      ids.add(id);
      if (!WIDGET_TYPES.includes(w.type)) throw bad("Tipo di widget sconosciuto.");
      if (!SIZES.includes(w.size)) throw bad("Dimensione del widget non valida.");
      const out = { id, type: w.type, size: w.size };
      if (w.type === "news" && w.cat != null) {
        const cat = str(w.cat, 30);
        if (!/^[a-z0-9-]{1,30}$/.test(cat)) throw bad("Categoria non valida.");
        out.cat = cat;
      }
      return out;
    }),
  };
}

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);

// Aggiornamento parziale: solo i campi presenti vengono validati e sostituiti
export function validateSettings(body, current = DEFAULT_SETTINGS) {
  const out = structuredClone(current);
  if ("weather" in body) {
    const w = body.weather;
    if (w === null) out.weather = null;
    else {
      const lat = +w?.lat, lon = +w?.lon, name = str(w?.name, 80);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw bad("Coordinate non valide.");
      // precisione ridotta (~100 m): basta per il meteo e protegge la posizione esatta
      out.weather = { name: name || "Posizione attuale", lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
    }
  }
  if ("timezone" in body) {
    const tz = str(body.timezone, 60);
    if (!tz || !validTz(tz)) throw bad("Fuso orario non valido.");
    out.timezone = tz;
  }
  if ("refreshMinutes" in body) {
    if (!REFRESH_MINUTES.includes(+body.refreshMinutes)) throw bad("Frequenza di aggiornamento non valida.");
    out.refreshMinutes = +body.refreshMinutes;
  }
  if ("news" in body) {
    const cats = body.news?.categories;
    if (!Array.isArray(cats) || !cats.length || cats.length > MAX_CATEGORIES) throw bad(`Da 1 a ${MAX_CATEGORIES} categorie di notizie.`);
    const ids = new Set();
    out.news = {
      categories: cats.map((c) => {
        const name = str(c?.name, 30);
        if (!name) throw bad("Ogni categoria deve avere un nome.");
        let id = /^[a-z0-9-]{1,30}$/.test(c?.id ?? "") ? c.id : slug(name) || "categoria";
        while (ids.has(id)) id = `${id.slice(0, 27)}-${ids.size}`;
        ids.add(id);
        if (!Array.isArray(c.feeds) || c.feeds.length > MAX_FEEDS) throw bad(`Al massimo ${MAX_FEEDS} fonti per categoria.`);
        const feeds = c.feeds.map((f) => {
          const u = safeFeedUrl(f);
          if (!u) throw bad(`Fonte non valida: usa un indirizzo https pubblico (${String(f).slice(0, 60)}).`);
          return u;
        });
        if (!feeds.length) throw bad(`La categoria "${name}" non ha fonti.`);
        return { id, name, feeds: [...new Set(feeds)] };
      }),
    };
  }
  if ("telegram" in body) out.telegram = { includeMuted: body.telegram?.includeMuted === true };
  return out;
}
