// Server di sviluppo locale: sito statico (site/) + API (lib/router.js) con KV in memoria.
// Uso: npm run serve  → http://localhost:8000
// Variabili da .dev.vars (non versionato, formato NOME=valore) o dall'ambiente; stesse chiavi della produzione.
// Le intestazioni di sicurezza sono lette da site/_headers, come su Cloudflare Pages.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { handle } from "../lib/router.js";
import { MemoryKV } from "../lib/store.js";

const ROOT = new URL("../site/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

// Intestazioni globali da site/_headers (blocco "/*")
export function securityHeaders() {
  const out = {};
  let on = false;
  for (const line of readFileSync(join(ROOT, "_headers"), "utf8").split("\n")) {
    if (/^\S/.test(line)) on = line.trim() === "/*";
    else if (on && line.includes(":")) { const i = line.indexOf(":"); out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  delete out["Strict-Transport-Security"];
  if (out["Content-Security-Policy"]) out["Content-Security-Policy"] = out["Content-Security-Policy"].replace(/;\s*upgrade-insecure-requests/, "");
  return out;
}

export async function nodeTelegramFactory() {
  const { makeTelegramFactory } = await import("../lib/telegram/client.js");
  const require = createRequire(import.meta.url);
  const wasm = await WebAssembly.compile(readFileSync(require.resolve("@mtcute/wasm/mtcute.wasm")));
  return makeTelegramFactory(wasm);
}

export function startServer({ env, deps = {}, port = 8000 }) {
  const headers = securityHeaders();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
        const r = await handle(request, env, deps);
        const h = Object.fromEntries(r.headers);
        if (r.headers.getSetCookie) h["set-cookie"] = r.headers.getSetCookie();
        res.writeHead(r.status, { ...headers, ...h });
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      const file = join(ROOT, path.endsWith("/") ? `${path}index.html` : path);
      if (!file.startsWith(ROOT) || file.endsWith("_headers")) throw new Error("fuori dalla cartella");
      const body = await readFile(file);
      res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404, headers); res.end("Not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const vars = {};
  if (existsSync(".dev.vars")) {
    for (const l of readFileSync(".dev.vars", "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) vars[m[1]] = m[2].replace(/^"(.*)"$/, "$1"); }
  }
  const env = { ...vars, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(ACCESS_CODES|BORT_DATA_KEY|GOOGLE_|TELEGRAM_|TTL_)/.test(k))), DATA: new MemoryKV() };
  if (!env.BORT_DATA_KEY) {
    env.BORT_DATA_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    console.log("BORT_DATA_KEY non impostata: uso una chiave temporanea (i dati si perdono al riavvio).");
  }
  if (!env.ACCESS_CODES) { env.ACCESS_CODES = "sviluppo:codice-sviluppo-locale"; console.log("ACCESS_CODES non impostata: codice di accesso \"codice-sviluppo-locale\"."); }
  const port = +(process.env.PORT ?? 8000);
  await startServer({ env, port, deps: { telegramFactory: await nodeTelegramFactory() } });
  console.log(`BortDaily in sviluppo: http://localhost:${port}`);
}
