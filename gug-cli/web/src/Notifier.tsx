// Watches the inbox while GUG-cli is open and announces new flow results and
// price alerts: a toast always, a desktop notification when switched on.
import { useEffect, useRef } from "react";
import { api } from "./api";
import { play } from "./sfx";

interface Item { id: string; title: string; body: string; at: string; read: boolean }

export function Notifier({ toast, go }: { toast: (t: string) => void; go: (r: "flows") => void }) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const check = async () => {
      let items: Item[];
      try {
        items = await api<Item[]>("/api/inbox/latest");
      } catch {
        return;
      }
      if (!seen.current) {
        seen.current = new Set(items.map((i) => i.id));
        return;
      }
      const fresh = items.filter((i) => !i.read && !seen.current!.has(i.id));
      for (const i of fresh) seen.current.add(i.id);
      if (!fresh.length) return;
      play("success");
      toast(fresh.length === 1 ? `New in your inbox: ${fresh[0].title}` : `${fresh.length} new items in your inbox`);
      if (localStorage.getItem("gug-notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const i of fresh.slice(0, 3)) {
          const n = new Notification(i.title, { body: i.body.replace(/[*_`#>]/g, ""), icon: "/icon-192.png", tag: i.id });
          n.onclick = () => (window.focus(), go("flows"), n.close());
        }
      }
    };
    void check();
    const t = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return null;
}
