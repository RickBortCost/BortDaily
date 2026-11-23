// Date nel fuso orario dell'utente (Intl, senza librerie).

export function validTz(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// "AAAA-MM-GG" del giorno locale nel fuso indicato
export function localDate(ts, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

// Differenza (ms) tra l'ora locale del fuso e UTC all'istante dato
function offset(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}

// Istante (ms) della mezzanotte locale del giorno di `ts` più `addDays` giorni
export function startOfDay(ts, tz, addDays = 0) {
  const [y, m, d] = localDate(ts, tz).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d + addDays);
  let t = guess - offset(guess, tz);
  t = guess - offset(t, tz); // correzione nei giorni di cambio dell'ora legale
  return t;
}
