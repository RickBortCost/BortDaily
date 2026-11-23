// Log strutturati con soli metadati: mai contenuti di mail, eventi, attività, messaggi, token o codici.
// Sono ammessi solo i campi in elenco; le stringhe vengono troncate.
const ALLOWED = new Set(["user", "route", "method", "status", "adapter", "code", "ms", "cached", "reason"]);

export function log(event, meta = {}, sink = console.log) {
  const out = { t: new Date().toISOString(), event };
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED.has(k) || v == null) continue;
    out[k] = typeof v === "string" ? v.slice(0, 80) : typeof v === "number" || typeof v === "boolean" ? v : undefined;
  }
  sink(JSON.stringify(out));
}
