// Meteo da Open-Meteo (nessuna chiave API). Località dalle impostazioni (città o posizione del browser).
import { AdapterError, expectOk } from "./base.js";

const API = "https://api.open-meteo.com/v1/forecast";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";

// Codici meteo WMO → descrizione e icona
const WMO = {
  0: ["Sereno", "sun"], 1: ["Prevalentemente sereno", "sun"], 2: ["Parzialmente nuvoloso", "cloud-sun"], 3: ["Coperto", "cloud"],
  45: ["Nebbia", "fog"], 48: ["Nebbia con brina", "fog"],
  51: ["Pioviggine leggera", "drizzle"], 53: ["Pioviggine", "drizzle"], 55: ["Pioviggine intensa", "drizzle"],
  56: ["Pioviggine gelata", "drizzle"], 57: ["Pioviggine gelata intensa", "drizzle"],
  61: ["Pioggia debole", "rain"], 63: ["Pioggia", "rain"], 65: ["Pioggia forte", "rain"],
  66: ["Pioggia gelata", "rain"], 67: ["Pioggia gelata forte", "rain"],
  71: ["Neve debole", "snow"], 73: ["Neve", "snow"], 75: ["Neve forte", "snow"], 77: ["Granelli di neve", "snow"],
  80: ["Rovesci deboli", "rain"], 81: ["Rovesci", "rain"], 82: ["Rovesci violenti", "rain"],
  85: ["Rovesci di neve", "snow"], 86: ["Rovesci di neve forti", "snow"],
  95: ["Temporale", "storm"], 96: ["Temporale con grandine", "storm"], 99: ["Temporale con grandine forte", "storm"],
};
export const describe = (code) => { const [desc, icon] = WMO[code] ?? ["Non disponibile", "cloud"]; return { desc, icon }; };

const num = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export const weather = {
  id: "weather",
  title: "Meteo",
  defaultTtl: 900,
  requires: null,
  async fetch(ctx) {
    const loc = ctx.settings?.weather;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
      throw new AdapterError("not_configured", "Imposta la città o usa la tua posizione nelle Impostazioni.");
    }
    const q = new URLSearchParams({
      latitude: loc.lat.toFixed(3), longitude: loc.lon.toFixed(3), timezone: "auto", forecast_days: "4",
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    });
    const res = await expectOk(await ctx.fetch(`${API}?${q}`, { signal: AbortSignal.timeout(8000) }), "Open-Meteo");
    const j = await res.json();
    const c = j.current ?? {};
    const d = j.daily ?? {};
    return {
      place: String(loc.name ?? "").slice(0, 80),
      current: {
        temp: num(c.temperature_2m), feels: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
        wind: num(c.wind_speed_10m), isDay: c.is_day === 1, ...describe(c.weather_code),
      },
      daily: (d.time ?? []).map((date, i) => ({
        date, max: num(d.temperature_2m_max?.[i]), min: num(d.temperature_2m_min?.[i]),
        rain: num(d.precipitation_probability_max?.[i]), ...describe(d.weather_code?.[i]),
      })),
    };
  },
};

// Ricerca città per le impostazioni
export async function geocode(fetchImpl, name) {
  const q = String(name ?? "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const res = await fetchImpl(`${GEO}?${new URLSearchParams({ name: q, count: "6", language: "it", format: "json" })}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new AdapterError("upstream", "Ricerca città non disponibile.");
  const j = await res.json();
  return (j.results ?? []).map((r) => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", ").slice(0, 80),
    lat: Math.round(r.latitude * 1000) / 1000, lon: Math.round(r.longitude * 1000) / 1000,
  }));
}
