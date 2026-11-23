// Utilità HTTP comuni del backend (Cloudflare Pages Functions e server di sviluppo Node).

export const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
});
export const err = (status, message, code = "error") => json({ error: { message, code } }, status);

export class HttpError extends Error {
  constructor(status, message, code = "error") { super(message); this.status = status; this.code = code; }
}

// Corpo JSON con limite di dimensione; mai oggetti diversi da un oggetto semplice
export async function readJson(request, max = 20_000) {
  const len = +(request.headers.get("content-length") ?? 0);
  if (len > max) throw new HttpError(413, "Richiesta troppo grande.", "too_large");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "Richiesta troppo grande.", "too_large");
  let body;
  try { body = JSON.parse(text || "{}"); } catch { throw new HttpError(400, "JSON non valido.", "bad_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Formato non valido.", "bad_json");
  return body;
}

export const clientIp = (request) => request.headers.get("cf-connecting-ip") ?? "local";

// fetch con timeout e lettura limitata (difesa da risposte enormi)
export async function fetchText(fetchImpl, url, { headers = {}, timeout = 10_000, max = 2_000_000 } = {}) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeout), redirect: "follow" });
  if (!res.body) return { res, text: "" };
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw Object.assign(new Error("too_large"), { code: "too_large" }); }
    chunks.push(value);
  }
  const buf = new Uint8Array(size); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return { res, text: new TextDecoder().decode(buf) };
}

// URL esterni accettati dal server: solo https, niente indirizzi IP, host locali o interni (difesa SSRF)
export function safeFeedUrl(u) {
  let url;
  try { url = new URL(String(u ?? "").trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
  const h = url.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h)) return null;
  if (url.href.length > 500) return null;
  url.hash = "";
  return url.href;
}

// Solo link http(s) verso il browser
export const safeLink = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? String(u) : null);

export const decodeEntities = (s) => String(s ?? "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#x([\da-f]+);/gi, (_, n) => safeCp(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => safeCp(+n))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const safeCp = (n) => { try { return String.fromCodePoint(n); } catch { return ""; } };

export const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
