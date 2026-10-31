// Уведомления «клиент ждёт ответа» — как в рабочем пульте: в программе для Windows (Tauri) — уведомления Windows,
// в браузере — уведомления браузера после разрешения. Пульт должен быть открыт (можно в свёрнутой вкладке);
// уведомления на закрытый телефон — push, фаза 5 REFACTORING.md.
import type { ConversationSummary } from "@/model/types";

type TauriNotify = { notification?: { sendNotification(o: { title: string; body: string }): void } };
const tauri = () => (window as unknown as { __TAURI__?: TauriNotify }).__TAURI__ ?? null;

export type NotifyState = "on" | "ask" | "denied" | "unsupported";
export function notifyState(): NotifyState {
  if (tauri()?.notification) return "on";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "denied" : "ask";
}
export async function askNotify(): Promise<NotifyState> {
  if (!("Notification" in window)) return "unsupported";
  await Notification.requestPermission();
  return notifyState();
}

// push на этом устройстве включён (lib/push.ts): уведомления приходят от сервера — эта вкладка их не дублирует
let pushHere = false;
export const setPushHere = (on: boolean) => {
  pushHere = on;
};
/** Число на значке приложения (iPhone с экрана «Домой», установленный пульт на компьютере) — сколько ждут ответа. */
function badge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) nav.setAppBadge?.(n)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* значок не поддерживается */
  }
}

let seen: Map<string, string> | null = null;
/** Сравнить ждущих с прошлой проверкой и сообщить о новых. Открытый перед глазами чат не уведомляет. */
export function notifyWaiting(list: ConversationSummary[], openKey: string | null, onOpen: (key: string) => void) {
  const cur = new Map<string, string>();
  for (const c of list) if (c.attention) cur.set(c.key, `${c.lastInboundAt || c.lastAt}|${c.attention.reason}`);
  const prev = seen;
  seen = cur;
  badge(cur.size);
  if (!prev || pushHere || notifyState() !== "on") return;
  const looking = (k: string) => !document.hidden && document.hasFocus() && k === openKey;
  const fresh = list.filter((c) => c.attention && prev.get(c.key) !== cur.get(c.key) && !looking(c.key));
  if (!fresh.length) return;
  const who = (c: ConversationSummary) => c.contact.name || c.contact.phone || "Гость сайта";
  const title = fresh.length > 1 ? `Ждут ответа: ${fresh.length}` : "Клиент ждёт ответа";
  const body = fresh.length > 1 ? fresh.slice(0, 4).map(who).join(", ") : `${who(fresh[0])}: ${fresh[0].attention!.label}`;
  const t = tauri();
  if (t?.notification) {
    try {
      t.notification.sendNotification({ title, body });
    } catch {
      /* программа без разрешения на уведомления */
    }
    return;
  }
  try {
    const n = new Notification(title, { body, tag: "pult-need" });
    n.onclick = () => {
      window.focus();
      if (fresh.length === 1) onOpen(fresh[0].key);
      n.close();
    };
  } catch {
    /* браузер запретил уведомления из этой вкладки */
  }
}
/** Новая компания — новая точка отсчёта, иначе её ждущие пришли бы уведомлением как «новые». */
export const resetNotify = () => {
  seen = null;
};
