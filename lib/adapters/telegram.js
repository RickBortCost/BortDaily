// Telegram: chat con messaggi non letti e ultimi messaggi (Client API / MTProto, sola lettura).
// Non segna nulla come letto: legge solo dialoghi e cronologia.
import { clip } from "../http.js";

const MAX_DIALOGS = 100, MAX_CHATS = 6, PER_CHAT = 3;

const mediaLabel = (m) => (m.media ? `[${{ photo: "Foto", video: "Video", voice: "Messaggio vocale", audio: "Audio", document: "File", sticker: "Sticker", location: "Posizione", contact: "Contatto", poll: "Sondaggio" }[m.media.type] ?? "Contenuto multimediale"}]` : "");

export const telegram = {
  id: "telegram",
  title: "Telegram",
  defaultTtl: 120,
  requires: "telegram",
  async fetch(ctx, params = {}) {
    const includeMuted = !!ctx.settings?.telegram?.includeMuted;
    const maxChats = Math.min(Math.max(+params.limit || MAX_CHATS, 1), 12);
    return ctx.telegram.run(async (tg) => {
      const unread = [];
      let total = 0, chats = 0;
      for await (const d of tg.iterDialogs({ limit: MAX_DIALOGS, archived: "exclude" })) {
        if (!(d.unreadCount > 0) || (d.isMuted && !includeMuted)) continue;
        chats++; total += d.unreadCount;
        if (unread.length < maxChats) unread.push(d);
      }
      const items = await Promise.all(unread.map(async (d) => {
        const peer = d.peer;
        const hist = await tg.getHistory(peer, { limit: Math.min(d.unreadCount, PER_CHAT) });
        return {
          id: String(peer.id),
          chat: clip(peer.displayName || "Chat", 80),
          kind: peer.type === "user" ? "user" : "group",
          unread: d.unreadCount,
          muted: !!d.isMuted,
          link: peer.username ? `https://t.me/${encodeURIComponent(peer.username)}` : null,
          messages: [...hist].filter((m) => !m.isOutgoing).map((m) => ({
            from: peer.type === "user" ? null : clip(m.sender?.displayName ?? "", 60),
            text: clip(m.text || mediaLabel(m) || "[Messaggio]", 160),
            date: m.date instanceof Date ? m.date.toISOString() : null,
          })),
        };
      }));
      return { unreadChats: chats, unreadTotal: total, items };
    });
  },
};
