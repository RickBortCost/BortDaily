# BortDaily

Web app (PWA installabile su iPhone e iPad) con la tua giornata in una pagina. Dashboard a widget personalizzabili:

- **Mail non lette** (Gmail): mittente, oggetto, anteprima, link alla mail.
- **Meteo** (Open-Meteo, nessuna chiave): città dalle Impostazioni o posizione del browser; condizioni attuali e 4 giorni.
- **Promemoria** (Google Tasks): attività in scadenza oggi e scadute.
- **Calendario** (Google Calendar): eventi di oggi e dei prossimi 3 giorni, da tutti i calendari visibili.
- **Notizie dal mondo**: feed RSS/Atom per categoria; categorie e fonti configurabili.
- **Telegram**: chat con messaggi non letti e ultimi messaggi (Client API/MTProto, sola lettura: non segna nulla come letto).

Personalizzazione: aggiungi/rimuovi widget, riordina trascinando (o con le frecce, accessibile da tastiera), dimensione S/M/L. Il layout è salvato per utente sul server. Aggiornamento automatico (5–60 minuti), pulsante "Aggiorna tutto" e trascinamento verso il basso (pull-to-refresh). Un widget in errore mostra il proprio stato senza bloccare gli altri. Tema chiaro/scuro come BortEconomy.

## Come funziona

Stesso stack di [BortEconomy](https://github.com/RickBortCost/BortEconomy): sito statico in `site/` (JavaScript ES modules, nessun framework) e API su **Cloudflare Pages Functions** (`functions/api/[[path]].js` → `lib/router.js`) con un KV per i dati.

```
browser ──(cookie di sessione)──▶ /api/*  ──▶ Gmail · Calendar · Tasks · Open-Meteo · RSS · Telegram (MTProto)
                                    │
                                    └─ KV "DATA": sessioni, layout, impostazioni, token cifrati (AES-256-GCM)
```

- Il backend è l'unico punto che parla con le API esterne: il browser non riceve mai token di terze parti.
- Ogni sorgente è un adapter (`lib/adapters/*.js`) con interfaccia comune: `fetch`, stato (`ok`, `error`, `disconnected`, `unconfigured`), errore, data di aggiornamento. Cache con TTL per sorgente (`TTL_<SORGENTE>` in secondi), in memoria e Cache API, cifrata.
- Telegram usa [mtcute](https://mtcute.dev) (`@mtcute/web`: WebSocket + WebCrypto + WASM), compatibile con il runtime dei Workers.

| Cartella | Contenuto |
|---|---|
| `site/` | PWA: `index.html`, `style.css`, `app.js` (avvio, viste, aggiornamento), `dashboard.js` (griglia e personalizzazione), `widgets.js` (rendering), `settings.js`, `sw.js` |
| `functions/api/` | Ingresso Cloudflare Pages Functions |
| `lib/` | Router, autenticazione, cifratura, KV, cache, log, OAuth Google, adapter, Telegram |
| `scripts/` | `dev.mjs` (server locale), `cf-deploy.mjs` (pubblicazione), `bump.mjs`, `vendor.mjs`, `icons.mjs` |
| `tests/` | `unit.mjs` (nucleo), `adapters.mjs` (un gruppo di test per adapter), `api.mjs` (API completa), `smoke.mjs` (Playwright iPhone/iPad) |

## Variabili d'ambiente

In produzione sono **secret del repository GitHub** (Settings → Secrets and variables → Actions); il workflow **Pubblica su Cloudflare Pages** le copia come secret del progetto Cloudflare. In locale vanno in `.dev.vars` (non versionato, vedi `.dev.vars.example`). Mai nel repository.

| Nome | Obbligatoria | Uso |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | per la pubblicazione | Token con Cloudflare Pages: Edit, Workers KV Storage: Edit, Account Settings: Read |
| `BORT_ACCESS_CODES` | sì | Utenti e codici di accesso: `nome:codice,nome2:codice2` (codici di almeno 12 caratteri, lunghi e casuali). In locale: `ACCESS_CODES` |
| `BORT_DATA_KEY` | sì | Chiave AES-256 per i dati cifrati a riposo: 32 byte casuali in base64 |
| `BORT_DATA_KEY_PREVIOUS` | no | Chiave precedente durante una rotazione (solo lettura) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | per Gmail/Calendar/Tasks | Client OAuth Google (vedi sotto) |
| `GOOGLE_REDIRECT_URI` | no | Variabile (non secret) se il sito non è su `*.pages.dev`; predefinito `https://<dominio>/api/google/callback` |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | per Telegram | Credenziali dell'app Telegram (vedi sotto) |
| `TTL_WEATHER`, `TTL_NEWS`, `TTL_GMAIL`, `TTL_CALENDAR`, `TTL_TASKS`, `TTL_TELEGRAM` | no | Durata della cache in secondi (predefiniti 900, 900, 120, 300, 300, 120; minimo 30) |

Generare una chiave e un codice di accesso:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BORT_DATA_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))" # codice di accesso
```

Revocare un utente: togliere la sua voce da `BORT_ACCESS_CODES` e ripubblicare (le sue sessioni smettono subito di valere). Rotazione della chiave: spostare la chiave attuale in `BORT_DATA_KEY_PREVIOUS`, impostare la nuova in `BORT_DATA_KEY`, ripubblicare; i nuovi salvataggi usano la nuova chiave.

## Google Cloud Console (Gmail, Calendar, Tasks)

1. [console.cloud.google.com](https://console.cloud.google.com) → crea un progetto (es. "BortDaily").
2. **API e servizi → Libreria**: abilita **Gmail API**, **Google Calendar API** e **Google Tasks API**.
3. **API e servizi → Schermata consenso OAuth** (Google Auth Platform):
   - Tipo utente **Esterno** (o Interno con Google Workspace), nome app, email di assistenza.
   - **Accesso ai dati → Aggiungi ambiti**: solo `.../auth/gmail.readonly`, `.../auth/calendar.readonly`, `.../auth/tasks.readonly`.
   - **Pubblico**: aggiungi il tuo indirizzo tra gli utenti di test.
4. **Client → Crea client**: tipo **Applicazione web**.
   - URI di reindirizzamento autorizzati: `https://bortdaily.pages.dev/api/google/callback` (o il tuo dominio) e, per lo sviluppo, `http://localhost:8000/api/google/callback`.
   - Copia ID client e client secret in `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
5. Nell'app: **Impostazioni → Account collegati → Google → Connetti**.

> **Importante:** `gmail.readonly` è un ambito "riservato". Con l'app in stato **Test** i refresh token scadono dopo 7 giorni (dovrai ricollegare Google ogni settimana). Per uso personale imposta **Pubblico → Pubblica app** ("In produzione") senza verifica: comparirà l'avviso "app non verificata" (Avanzate → Vai a BortDaily) e l'accesso resterà valido; il limite è di 100 utenti. Un'app pubblica per molti utenti richiede la verifica di Google e una valutazione di sicurezza.

Scollegando l'account da BortDaily il token viene revocato presso Google. Puoi revocarlo anche da [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Telegram (api_id e api_hash)

1. Accedi a [my.telegram.org](https://my.telegram.org) con il tuo numero → **API development tools**.
2. Crea un'applicazione (titolo e nome breve a piacere, piattaforma "Web"), poi copia **App api_id** e **App api_hash** in `TELEGRAM_API_ID` e `TELEGRAM_API_HASH`.
3. Nell'app: **Impostazioni → Account collegati → Telegram**: numero di telefono → codice ricevuto nell'app Telegram → eventuale password della verifica in due passaggi.

La sessione MTProto è salvata cifrata nel KV; equivale a un dispositivo collegato al tuo account (visibile in Telegram → Impostazioni → Dispositivi). "Scollega" chiude la sessione anche su Telegram. Non condividere `api_hash`: identifica la tua app.

## Pubblicazione su Cloudflare Pages

1. Imposta i secret elencati sopra nel repository GitHub.
2. Merge su `main` (o Actions → **Pubblica su Cloudflare Pages** → Run workflow): `scripts/cf-deploy.mjs` crea il progetto Pages `bortdaily` e il KV `bortdaily-data` se mancano, imposta i secret e pubblica `site/` con le Pages Functions.
3. Apri `https://bortdaily.pages.dev` da Safari → Condividi → **Aggiungi alla schermata Home**.

## Sviluppo locale

```bash
npm ci
cp .dev.vars.example .dev.vars   # completa i valori
npm run serve                    # http://localhost:8000 (API comprese, KV in memoria)
npm test                         # nucleo, adapter, API e interfaccia (Playwright)
```

Senza `.dev.vars` il server usa una chiave temporanea e il codice `codice-sviluppo-locale`. Con `SHOTS=cartella node tests/smoke.mjs` i test salvano schermate di iPhone e iPad.

## Sicurezza

Vedi [SECURITY.md](SECURITY.md). In breve: accesso con codice personale e cookie di sessione `HttpOnly; Secure; SameSite=Lax`; protezione CSRF (origine + intestazione dedicata); limiti sui tentativi e sulle richieste; token OAuth e sessione Telegram cifrati a riposo; scope Google in sola lettura; CSP restrittiva e intestazioni di sicurezza; log solo con metadati (mai contenuti di mail, eventi o messaggi).

## Versioni e release

Come BortEconomy: SemVer, modifiche in `CHANGELOG.md` (`## [Non rilasciato]`), poi `npm run release:patch|minor|major` e merge su `main`; il workflow `release.yml` crea tag e GitHub Release.
