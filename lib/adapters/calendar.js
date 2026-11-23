// Calendario (Google Calendar API, scope calendar.readonly): eventi di oggi e dei prossimi 3 giorni.
import { SCOPE_OF, gget } from "../google.js";
import { safeLink, clip } from "../http.js";
import { startOfDay, localDate } from "../time.js";

const API = "https://www.googleapis.com/calendar/v3";
const MAX_CALENDARS = 10;

export const calendar = {
  id: "calendar",
  title: "Calendario",
  defaultTtl: 300,
  requires: "google",
  async fetch(ctx) {
    const tz = ctx.settings?.timezone ?? "Europe/Rome";
    const now = ctx.now ?? Date.now();
    const timeMin = new Date(startOfDay(now, tz)).toISOString();
    const timeMax = new Date(startOfDay(now, tz, 4)).toISOString();
    const list = await gget(ctx, SCOPE_OF.calendar, `${API}/users/me/calendarList?minAccessRole=reader&maxResults=50`, "Google Calendar");
    const cals = (list.items ?? []).filter((c) => c.selected !== false && !c.hidden).slice(0, MAX_CALENDARS);
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50", timeZone: tz });
    const per = await Promise.allSettled(cals.map(async (c) => {
      const j = await gget(ctx, SCOPE_OF.calendar, `${API}/calendars/${encodeURIComponent(c.id)}/events?${q}`, "Google Calendar");
      return (j.items ?? []).filter((e) => e.status !== "cancelled").map((e) => {
        const allDay = !!e.start?.date;
        return {
          id: clip(e.id, 120),
          title: clip(e.summary || "(senza titolo)", 160),
          start: allDay ? e.start.date : e.start?.dateTime,
          end: allDay ? e.end?.date : e.end?.dateTime,
          allDay,
          location: clip(e.location ?? "", 120),
          calendar: clip(c.summaryOverride || c.summary || "", 60),
          color: /^#[\da-f]{6}$/i.test(c.backgroundColor ?? "") ? c.backgroundColor : null,
          link: safeLink(e.htmlLink),
        };
      });
    }));
    if (cals.length && per.every((p) => p.status === "rejected")) throw per[0].reason;
    const items = per.filter((p) => p.status === "fulfilled").flatMap((p) => p.value)
      // ordine: per giorno locale, prima gli eventi di giornata intera, poi per orario
      .map((e) => ({ ...e, day: e.allDay ? e.start : localDate(e.start, tz) }))
      .sort((a, b) => a.day.localeCompare(b.day) || (b.allDay - a.allDay) || (a.allDay ? a.title.localeCompare(b.title, "it") : Date.parse(a.start) - Date.parse(b.start)));
    return { timezone: tz, from: timeMin, to: timeMax, items };
  },
};

