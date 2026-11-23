# Sicurezza e privacy

## Segnalare una vulnerabilità

Non aprire una issue pubblica: usa **Security → Report a vulnerability** (segnalazione privata di GitHub) su questo repository.

## Come sono protetti i dati

| Dato | Dove resta | Protezione |
|---|---|---|
| Codici di accesso | Secret di GitHub e del progetto Cloudflare | Confronto a tempo costante; 20 tentativi falliti all'ora per IP, poi blocco; ritardo su ogni errore |
| Sessione | Cookie `__Host-bd_sid` (HttpOnly, Secure, SameSite=Lax) e KV | In KV solo l'hash SHA-256 dell'identificativo; durata 30 giorni; revocata togliendo il codice dell'utente |
| Token OAuth Google | KV | AES-256-GCM, chiave `BORT_DATA_KEY` da secret; nome del record come dato autenticato; mai inviati al browser |
| Sessione Telegram (MTProto) | KV | Come sopra; passaggi di accesso intermedi cifrati e validi 10 minuti |
| Mail, eventi, attività, messaggi | Solo cache temporanea (memoria/Cache API) | Cifrati come i token, con scadenza (TTL); mai in KV né nei log |
| Layout e impostazioni | KV | Validati lato server (tipi, dimensioni, URL https pubblici) |
| Tema | `localStorage` del browser | Nessun dato personale |

## Protezioni tecniche

- **Autorizzazioni minime**: Google `gmail.readonly`, `calendar.readonly`, `tasks.readonly`; OAuth con PKCE (S256) e `state` monouso legato all'utente; revoca allo scollegamento. Telegram in sola lettura (dialoghi e cronologia).
- **CSRF**: tutte le richieste che modificano dati richiedono `Origin` uguale al sito, l'intestazione `X-BortDaily: 1` e `Content-Type: application/json` (non inviabili da altri siti senza preflight CORS, che il server non concede).
- **Limiti**: 120 richieste al minuto per utente (per istanza), aggiornamento forzato di una sorgente al massimo ogni 30 secondi, corpi JSON limitati, risposte dei feed limitate a 2 MB con timeout.
- **SSRF**: le fonti RSS accettano solo `https` verso nomi di dominio pubblici (niente IP, `localhost`, domini interni, credenziali o porte non standard).
- **Content Security Policy** (`site/_headers` e `index.html`): solo script del sito, connessioni solo verso `/api` dello stesso sito, nessun plugin, `frame-ancestors 'none'`; HSTS, nosniff, `Referrer-Policy: no-referrer`, Permissions-Policy (posizione solo per il sito), COOP/CORP.
- **Output**: testi delle sorgenti sempre con escape HTML; link esterni solo `http(s)` con `noopener noreferrer`.
- **Log**: JSON con soli metadati in elenco chiuso (utente, percorso, stato, sorgente, codice di errore, durata); mai contenuti, token o codici.
- **Supply chain**: carattere ospitato sul sito, versioni bloccate, azioni dei workflow bloccate per SHA, Dependabot, TruffleHog e Trivy (`security.yml`).

## Limiti noti

- Chi conosce un codice di accesso entra come quell'utente: usa codici lunghi, uno per persona, e revocali togliendoli da `BORT_ACCESS_CODES`.
- Il limite di richieste per utente è per istanza del Worker: per limiti globali usa le regole di rate limiting di Cloudflare.
- La chiave `BORT_DATA_KEY` protegge i dati in KV, non da chi controlla l'account Cloudflare o i secret di GitHub.
- La sessione Telegram dà accesso completo all'account a chi ottiene sia il KV sia la chiave: proteggi entrambi e scollega Telegram se non lo usi.
