// Notizie dal mondo da feed RSS/Atom configurabili per categoria (Impostazioni → Notizie).
// Parsing senza librerie, come in BortEconomy (scripts/lib/news.mjs).
import { AdapterError } from "./base.js";
import { fetchText, safeFeedUrl, safeLink, decodeEntities, clip } from "../http.js";

const MAX_FEEDS = 8, MAX_ITEMS = 40;
const UA = "BortDaily/1.0 (+lettore RSS)";

const gn = (topic) => `https://news.google.com/rss/headlines/section/topic/${topic}?hl=it&gl=IT&ceid=IT:it`;
export const DEFAULT_CATEGORIES = [
  { id: "mondo", name: "Mondo", feeds: [gn("WORLD")] },
  { id: "italia", name: "Italia", feeds: [gn("NATION")] },
  { id: "economia", name: "Economia", feeds: [gn("BUSINESS")] },
  { id: "tecnologia", name: "Tecnologia", feeds: [gn("TECHNOLOGY")] },
  { id: "scienza", name: "Scienza", feeds: [gn("SCIENCE")] },
  { id: "salute", name: "Salute", feeds: [gn("HEALTH")] },
  { id: "sport", name: "Sport", feeds: [gn("SPORTS")] },
];

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i")); return m ? decodeEntities(m[1]).replace(/<[^>]+>/g, "").trim() : ""; };
const attr = (xml, t, a) => { const m = xml.match(new RegExp(`<${t}\\b[^>]*\\b${a}="([^"]*)"`, "i")); return m ? decodeEntities(m[1]) : ""; };

export function parseFeed(xml, feedUrl) {
  if (!xml) return [];
  const host = (() => { try { return new URL(feedUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const channel = clip(tag(xml.replace(/<(item|entry)[\s>][\s\S]*$/i, ""), "title"), 60);
  const blocks = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
  return blocks.map((it) => {
    const source = tag(it, "source") || channel || host;
    let title = tag(it, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)); // stile Google News
    const link = safeLink(tag(it, "link") || attr(it, "link", "href"));
    const date = new Date(tag(it, "pubDate") || tag(it, "updated") || tag(it, "published") || tag(it, "dc:date"));
    return { title: clip(title, 200), link, source: clip(source, 60), date: isNaN(date) ? null : date.toISOString() };
  }).filter((n) => n.title && n.link);
}

export function categoriesOf(settings) {
  const c = settings?.news?.categories;
  return Array.isArray(c) && c.length ? c : DEFAULT_CATEGORIES;
}

export const news = {
  id: "news",
  title: "Notizie",
  defaultTtl: 900,
  requires: null,
  async fetch(ctx, params = {}) {
    const cats = categoriesOf(ctx.settings);
    const cat = cats.find((c) => c.id === params.cat) ?? cats[0];
    if (!cat) throw new AdapterError("not_configured", "Aggiungi almeno una categoria nelle Impostazioni.");
    const feeds = (cat.feeds ?? []).map(safeFeedUrl).filter(Boolean).slice(0, MAX_FEEDS);
    if (!feeds.length) throw new AdapterError("not_configured", `La categoria "${cat.name}" non ha fonti valide.`);
    const results = await Promise.allSettled(feeds.map(async (url) => {
      const { res, text } = await fetchText(ctx.fetch, url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, timeout: 8000 });
      if (!res.ok) throw new Error(String(res.status));
      return parseFeed(text, url);
    }));
    const ok = results.filter((r) => r.status === "fulfilled");
    if (!ok.length) throw new AdapterError("upstream", "Nessuna fonte di notizie raggiungibile.");
    const seen = new Set();
    const items = ok.flatMap((r) => r.value)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .filter((n) => { const k = n.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, MAX_ITEMS);
    return {
      category: cat.id,
      categories: cats.map((c) => ({ id: c.id, name: c.name })),
      failedFeeds: results.length - ok.length,
      items,
    };
  },
};
