// Service worker: app installabile e interfaccia disponibile offline.
// - Interfaccia (HTML, CSS, JS, icone): prima la rete, in mancanza la copia salvata.
// - API (/api/...): mai in cache (dati personali e sessione).
const CACHE = "bortdaily-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "util.js", "dashboard.js", "widgets.js", "settings.js", "theme-init.js",
  "icon.svg", "icon-192.png", "icon-512.png", "icon-180.png", "manifest.webmanifest", "fonts/inter-latin-wght-normal.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(networkFirst(e.request));
});
