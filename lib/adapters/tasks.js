// Promemoria (Google Tasks API, scope tasks.readonly): attività in scadenza oggi e scadute.
import { SCOPE_OF, gget } from "../google.js";
import { safeLink, clip } from "../http.js";
import { localDate, startOfDay } from "../time.js";

const API = "https://tasks.googleapis.com/tasks/v1";
const MAX_LISTS = 20;

export const tasks = {
  id: "tasks",
  title: "Promemoria",
  defaultTtl: 300,
  requires: "google",
  async fetch(ctx) {
    const tz = ctx.settings?.timezone ?? "Europe/Rome";
    const now = ctx.now ?? Date.now();
    const today = localDate(now, tz);
    // La scadenza di Google Tasks è solo una data (salvata come mezzanotte UTC): filtro largo, poi confronto per data
    const dueMax = new Date(startOfDay(now, tz, 2)).toISOString();
    const lists = await gget(ctx, SCOPE_OF.tasks, `${API}/users/@me/lists?maxResults=${MAX_LISTS}`, "Google Tasks");
    const q = new URLSearchParams({ showCompleted: "false", showHidden: "false", dueMax, maxResults: "100" });
    const per = await Promise.all((lists.items ?? []).map(async (l) => {
      const j = await gget(ctx, SCOPE_OF.tasks, `${API}/lists/${encodeURIComponent(l.id)}/tasks?${q}`, "Google Tasks");
      return (j.items ?? []).filter((t) => t.due && t.status !== "completed" && !t.deleted).map((t) => {
        const due = t.due.slice(0, 10);
        return {
          id: clip(t.id, 120), title: clip(t.title || "(senza titolo)", 160), due, list: clip(l.title ?? "", 60),
          overdue: due < today, link: safeLink(t.webViewLink) ?? "https://tasks.google.com/",
        };
      }).filter((t) => t.due <= today);
    }));
    const items = per.flat().sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title, "it"));
    return { today, overdue: items.filter((t) => t.overdue).length, dueToday: items.filter((t) => !t.overdue).length, items };
  },
};
