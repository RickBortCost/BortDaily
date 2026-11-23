// Rendering dei widget: un renderer per tipo, che riceve i dati già filtrati dal server.
// Tutti i testi passano da esc(); i link esterni da safeUrl() con noopener/noreferrer.
import { esc, ext, icon, timeHM, dayShort, dateShort, ago, relDay, fromYmd } from "./util.js";

export const TYPES = {
  weather: { title: "Meteo", icon: "cloud-sun" },
  calendar: { title: "Calendario", icon: "calendar" },
  tasks: { title: "Promemoria", icon: "tasks" },
  gmail: { title: "Mail non lette", icon: "mail" },
  news: { title: "Notizie", icon: "news" },
  telegram: { title: "Telegram", icon: "send" },
};
const WX_ICONS = new Set(["sun", "cloud-sun", "cloud", "fog", "drizzle", "rain", "snow", "storm"]);
const wxIcon = (name) => icon(WX_ICONS.has(name) ? name : "cloud");
const deg = (v) => (v == null ? "–" : `${Math.round(v)}°`);
const empty = (msg) => `<div class="w-state">${icon("tasks")}<div>${esc(msg)}</div></div>`;

// badge nell'intestazione (conteggi)
export function badgeFor(type, data) {
  if (!data) return "";
  if (type === "gmail" && data.unread) return `<span class="badge" aria-label="${data.unread} non lette">${data.unread > 999 ? "999+" : data.unread}</span>`;
  if (type === "telegram" && data.unreadTotal) return `<span class="badge" aria-label="${data.unreadTotal} messaggi non letti">${data.unreadTotal > 999 ? "999+" : data.unreadTotal}</span>`;
  if (type === "tasks" && data.overdue) return `<span class="badge warn" aria-label="${data.overdue} scadute">${data.overdue}</span>`;
  return "";
}

const R = {
  weather(d) {
    const c = d.current;
    return `<div class="wx-now">${wxIcon(c.icon)}<div>
        <div class="wx-temp">${deg(c.temp)}</div>
        <div class="wx-desc">${esc(c.desc)}</div>
        <div class="wx-place">${esc(d.place)}</div></div></div>
      <div class="wx-extra"><span>Percepita ${deg(c.feels)}</span><span>Umidità ${c.humidity ?? "–"}%</span><span>Vento ${c.wind ?? "–"} km/h</span></div>
      <div class="wx-days">${d.daily.map((x, i) => `<div><span>${i === 0 ? "Oggi" : esc(dayShort(fromYmd(x.date)))}</span>${wxIcon(x.icon)}<span class="sr">${esc(x.desc)}</span>
        <b>${deg(x.max)}</b> / ${deg(x.min)}${x.rain != null ? `<div class="meta">☂ ${x.rain}%</div>` : ""}</div>`).join("")}</div>`;
  },

  gmail(d) {
    if (!d.items.length) return empty("Nessuna mail da leggere.");
    return `<p class="sum"><b>${d.unread}</b> non lette in Posta in arrivo</p><ul class="list">${d.items.map((m) => `<li>${ext(m.link,
      `<div class="top"><b>${esc(m.from)}</b>${m.date ? `<time datetime="${esc(m.date)}">${esc(ago(m.date))}</time>` : ""}</div>
       <div class="t">${esc(m.subject)}</div><div class="s">${esc(m.snippet)}</div>`)}</li>`).join("")}</ul>`;
  },

  tasks(d) {
    if (!d.items.length) return empty("Nessuna attività in scadenza oggi.");
    return `<p class="sum"><b>${d.dueToday}</b> in scadenza oggi · <b>${d.overdue}</b> scadute</p><ul class="list">${d.items.map((t) => `<li class="task">${ext(t.link,
      `<div class="t">${esc(t.title)}</div>
       <div class="s"><span class="due ${t.overdue ? "over" : "today"}">${t.overdue ? `Scaduta il ${esc(dateShort(fromYmd(t.due)))}` : "Oggi"}</span>${t.list ? ` · ${esc(t.list)}` : ""}</div>`)}</li>`).join("")}</ul>`;
  },

  calendar(d) {
    if (!d.items.length) return empty("Nessun evento oggi e nei prossimi 3 giorni.");
    let out = "", day = null;
    for (const e of d.items) {
      if (e.day !== day) { if (day) out += "</ul>"; day = e.day; out += `<h3 class="cal-day">${esc(relDay(day))}</h3><ul class="list">`; }
      const when = e.allDay ? "Tutto il giorno" : `${timeHM(e.start)}${e.end ? `<br>${timeHM(e.end)}` : ""}`;
      const dot = `<span class="dot"${e.color ? ` style="background:${esc(e.color)}"` : ""}></span>`;
      out += `<li>${ext(e.link, `<div class="cal-ev"><div class="when">${when}</div><div><div class="t">${dot}<span>${esc(e.title)}</span></div>
        <div class="s">${[e.location, e.calendar].filter(Boolean).map(esc).join(" · ")}</div></div></div>`)}</li>`;
    }
    return `${out}</ul>`;
  },

  news(d, w) {
    const chips = d.categories.length > 1 ? `<div class="chips" role="group" aria-label="Categoria">${d.categories.map((c) =>
      `<button data-cat="${esc(c.id)}" aria-pressed="${c.id === d.category}">${esc(c.name)}</button>`).join("")}</div>` : "";
    const warn = d.failedFeeds ? `<p class="meta">${d.failedFeeds} ${d.failedFeeds === 1 ? "fonte non raggiungibile" : "fonti non raggiungibili"}.</p>` : "";
    const limit = { S: 4, M: 8, L: 16 }[w.size] ?? 8;
    if (!d.items.length) return chips + empty("Nessuna notizia per questa categoria.");
    return `${chips}${warn}<ul class="list">${d.items.slice(0, limit).map((n) => `<li>${ext(n.link,
      `<div class="t">${esc(n.title)}</div><div class="s">${esc(n.source)}${n.date ? ` · ${esc(ago(n.date))}` : ""}</div>`)}</li>`).join("")}</ul>`;
  },

  telegram(d) {
    if (!d.items.length) return empty("Nessun messaggio non letto.");
    return `<p class="sum"><b>${d.unreadTotal}</b> non letti in <b>${d.unreadChats}</b> ${d.unreadChats === 1 ? "chat" : "chat"}</p><ul class="list">${d.items.map((c) => {
      const inner = `<div class="top"><b>${esc(c.chat)}</b><span class="badge">${c.unread}</span></div>${c.messages.map((m) =>
        `<div class="msg">${m.from ? `<b>${esc(m.from)}:</b> ` : ""}${esc(m.text)}</div>`).join("")}`;
      return `<li class="tg-chat">${c.link ? ext(c.link, inner) : `<div class="item">${inner}</div>`}</li>`;
    }).join("")}</ul>`;
  },
};

export function renderData(w, res) {
  return R[w.type](res.data, w);
}

export function renderState(res) {
  const msg = esc(res.error?.message ?? "Errore imprevisto.");
  if (res.status === "disconnected" || res.status === "unconfigured") {
    return `<div class="w-state">${icon("link")}<div>${msg}<div class="act"><a class="ghost" href="#/impostazioni">Apri Impostazioni</a></div></div></div>`;
  }
  return `<div class="w-state err">${icon("alert")}<div>${msg}<div class="act"><button class="ghost" data-retry>Riprova</button></div></div></div>`;
}

export const skeleton = () => `<div class="skel"></div><div class="skel s"></div><div class="skel"></div>`;
