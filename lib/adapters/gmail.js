// Mail non lette (Gmail API, scope gmail.readonly): mittente, oggetto, anteprima, link alla mail.
import { SCOPE_OF, gget } from "../google.js";
import { decodeEntities, clip } from "../http.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

// "Mario Rossi <mario@example.com>" → "Mario Rossi"
export function senderName(from) {
  const s = String(from ?? "").trim();
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return clip(m ? m[1] : s.replace(/[<>]/g, ""), 80);
}

export const gmail = {
  id: "gmail",
  title: "Mail non lette",
  defaultTtl: 120,
  requires: "google",
  async fetch(ctx, params = {}) {
    const limit = Math.min(Math.max(+params.limit || 8, 1), 20);
    const [label, list] = await Promise.all([
      gget(ctx, SCOPE_OF.gmail, `${API}/labels/INBOX`, "Gmail"),
      gget(ctx, SCOPE_OF.gmail, `${API}/messages?${new URLSearchParams({ q: "is:unread in:inbox", maxResults: String(limit) })}`, "Gmail"),
    ]);
    const meta = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "Subject", "Date"]) meta.append("metadataHeaders", h);
    const msgs = await Promise.all((list.messages ?? []).map((m) => gget(ctx, SCOPE_OF.gmail, `${API}/messages/${encodeURIComponent(m.id)}?${meta}`, "Gmail")));
    return {
      unread: label.messagesUnread ?? msgs.length,
      items: msgs.map((m) => {
        const h = Object.fromEntries((m.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
        return {
          id: m.id,
          from: senderName(h.from),
          subject: clip(h.subject || "(senza oggetto)", 200),
          snippet: clip(decodeEntities(m.snippet), 160),
          date: m.internalDate ? new Date(+m.internalDate).toISOString() : null,
          link: `https://mail.google.com/mail/#inbox/${encodeURIComponent(m.threadId ?? m.id)}`,
        };
      }),
    };
  },
};
