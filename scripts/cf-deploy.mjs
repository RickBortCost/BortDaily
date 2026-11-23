// Pubblica BortDaily su Cloudflare Pages: sito (site/) + API (functions/, Pages Functions) + intestazioni di sicurezza.
//
// Variabili d'ambiente (dai secret di GitHub; i valori non vengono mai stampati):
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID       obbligatorie
//   BORT_ACCESS_CODES                                 obbligatoria: "nome:codice,…" – chi può accedere
//   BORT_DATA_KEY                                     obbligatoria: 32 byte casuali in base64 (cifratura a riposo)
//   BORT_DATA_KEY_PREVIOUS                            facoltativa: chiave precedente durante una rotazione
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET            facoltative: abilitano Gmail, Calendar e Tasks
//   GOOGLE_REDIRECT_URI                               facoltativa: se il dominio non è quello di Pages
//   TELEGRAM_API_ID, TELEGRAM_API_HASH                facoltative: abilitano Telegram
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const PROJECT = process.env.CF_PROJECT ?? "bortdaily";
const KV_TITLE = "bortdaily-data";
const WRANGLER = "wrangler@4.157.0";
const { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } = process.env;
if (!TOKEN || !ACCOUNT) { console.log("Secret CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID non configurati: pubblicazione saltata."); process.exit(0); }
for (const k of ["BORT_ACCESS_CODES", "BORT_DATA_KEY"]) {
  if (!process.env[k]) { console.error(`Secret ${k} mancante: vedi README (Variabili d'ambiente).`); process.exit(1); }
}
if (Buffer.from(process.env.BORT_DATA_KEY.trim(), "base64").length !== 32) { console.error("BORT_DATA_KEY deve essere di 32 byte in base64."); process.exit(1); }

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init.headers } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    const e = new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${(j.errors ?? []).map((x) => `${x.code} ${x.message}`).join("; ")}`);
    e.status = res.status; throw e;
  }
  return j.result;
}

// 1. Progetto Pages
let project;
try { project = await cf(`/pages/projects/${PROJECT}`); }
catch (e) {
  if (e.status !== 404) throw e;
  console.log(`Creo il progetto Pages "${PROJECT}"`);
  project = await cf("/pages/projects", { method: "POST", body: JSON.stringify({ name: PROJECT, production_branch: "main" }) });
}

// 2. KV per sessioni, layout, impostazioni e token cifrati
const spaces = await cf("/storage/kv/namespaces?per_page=100");
let kv = spaces.find((n) => n.title === KV_TITLE);
if (!kv) { console.log(`Creo il KV "${KV_TITLE}"`); kv = await cf("/storage/kv/namespaces", { method: "POST", body: JSON.stringify({ title: KV_TITLE }) }); }

// 3. Configurazione di produzione
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const env_vars = { APP_VERSION: { type: "plain_text", value: version } };
const SECRETS = [["ACCESS_CODES", "BORT_ACCESS_CODES"], ["BORT_DATA_KEY"], ["BORT_DATA_KEY_PREVIOUS"], ["GOOGLE_CLIENT_ID"], ["GOOGLE_CLIENT_SECRET"], ["GOOGLE_REDIRECT_URI"], ["TELEGRAM_API_ID"], ["TELEGRAM_API_HASH"]];
for (const [name, from] of SECRETS) {
  const v = process.env[from ?? name];
  if (v) env_vars[name] = { type: "secret_text", value: v.trim() };
}
for (const [k, v] of Object.entries(process.env)) if (/^TTL_[A-Z]+$/.test(k) && v) env_vars[k] = { type: "plain_text", value: v };
await cf(`/pages/projects/${PROJECT}`, {
  method: "PATCH",
  body: JSON.stringify({ deployment_configs: { production: { compatibility_date: "2026-11-01", kv_namespaces: { DATA: { namespace_id: kv.id } }, env_vars } } }),
});
console.log(`Configurazione aggiornata. Google: ${env_vars.GOOGLE_CLIENT_ID ? "sì" : "no"}; Telegram: ${env_vars.TELEGRAM_API_ID ? "sì" : "no"}.`);

// 4. Pubblicazione (site/ + functions/)
execFileSync("npx", ["-y", WRANGLER, "pages", "deploy", "site", "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"], {
  stdio: "inherit", env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
});
console.log(`Pubblicato su https://${project.subdomain ?? `${PROJECT}.pages.dev`}`);
