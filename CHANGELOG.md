# Changelog

Tutte le modifiche rilevanti sono documentate qui. Formato [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni [SemVer](https://semver.org/lang/it/).

## [Non rilasciato]

## [0.1.0] - 2026-11-23

### Aggiunto
- Dashboard a widget personalizzabili: aggiungi/rimuovi, riordina con trascinamento o frecce, dimensione S/M/L, layout salvato per utente sul server.
- Widget: mail non lette (Gmail), meteo (Open-Meteo, città o posizione), promemoria (Google Tasks), calendario (oggi e 3 giorni), notizie RSS per categoria, Telegram (messaggi non letti via MTProto).
- Pagina Impostazioni: account collegati (Google OAuth, Telegram con codice e 2FA), città meteo, categorie e fonti delle notizie, frequenza di aggiornamento, fuso orario.
- Aggiornamento periodico, "Aggiorna tutto" e trascinamento verso il basso; stato di errore per singolo widget.
- Accesso con codice personale e sessione lato server; token e sessione Telegram cifrati a riposo; CSRF, CSP, rate limiting, log senza contenuti.
- PWA installabile su iPhone e iPad, tema chiaro/scuro, interfaccia in italiano.

[Non rilasciato]: https://github.com/RickBortCost/BortDaily/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/RickBortCost/BortDaily/releases/tag/v0.1.0
