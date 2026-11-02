// Push-уведомления на это устройство (ТЗ v2.0 §3, 31.10.2026): Service Worker /app/sw.js, подписка браузера, сервер /api/push/*.
// Уведомление приходит и при закрытом пульте. Ограничения платформ, без обещаний сверх них:
//   iPhone и iPad — только пульт, добавленный на экран «Домой» (iOS 16.4+), и только после разрешения; во вкладке Safari push нет;
//   Android и компьютер — Chrome, Edge, Firefox; доставляют Apple и Google, время доставки они не обещают.
// Подписка — на компанию: владелец может включить уведомления для нескольких компаний на одном устройстве.
import { call, enc } from "@/data/live";
import { getOperator } from "@/lib/operator";
import { setPushHere } from "@/lib/notify";

export type PushKind = "inbound" | "campaign_reply" | "booking_change" | "unassigned" | "send_failed" | "channel_down";
export type PushPrefs = { kinds: Record<PushKind, boolean>; quiet: { from: number; to: number } | null; text: boolean };
export type PushSupport = "ok" | "ios-tab" | "ios-old" | "unsupported";
export type PushState = { support: PushSupport; permission: NotificationPermission | "unsupported"; on: boolean; prefs: PushPrefs | null; op: string; error?: string };

export const PUSH_KINDS: { id: PushKind; label: string; note?: string }[] = [
  { id: "inbound", label: "Новое сообщение клиента" },
  { id: "campaign_reply", label: "Ответ на рассылку или напоминание" },
  { id: "booking_change", label: "Перенос, отмена, опоздание" },
  { id: "unassigned", label: "Новый чат без ответственного" },
  { id: "send_failed", label: "Сообщение не доставлено" },
  { id: "channel_down", label: "Номер WhatsApp перестал работать", note: "приходит и в часы «не беспокоить»" },
];
export const DEFAULT_PREFS: PushPrefs = { kinds: Object.fromEntries(PUSH_KINDS.map((k) => [k.id, true])) as Record<PushKind, boolean>, quiet: null, text: false };

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const full = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !standalone()) return "ios-tab"; // во вкладке Safari push нет — только с экрана «Домой»
  if (full) return "ok";
  return isIOS() ? "ios-old" : "unsupported";
}

// отметка «на этом устройстве включено» — по компаниям (в браузере; сервер — главный, отметка только для экрана и перепроверки)
const MARK = "pult.push";
function marks(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(MARK) || "{}");
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function mark(ws: string, on: boolean) {
  const m = marks();
  if (on) m[ws] = Date.now();
  else delete m[ws];
  try {
    localStorage.setItem(MARK, JSON.stringify(m));
  } catch {
    /* частный режим */
  }
}

let reg: Promise<ServiceWorkerRegistration | null> | null = null;
/** Service Worker пульта (один раз на страницу). Нет поддержки — null. */
export function swRegister(): Promise<ServiceWorkerRegistration | null> {
  if (!reg) reg = "serviceWorker" in navigator ? navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => null) : Promise.resolve(null);
  return reg;
}
async function currentSub(): Promise<PushSubscription | null> {
  if (!(await swRegister())) return null;
  const r = await navigator.serviceWorker.ready;
  return r.pushManager.getSubscription();
}
function keyBytes(k: string): Uint8Array<ArrayBuffer> {
  const b = atob(k.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((k.length + 3) % 4));
  const u = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
const sameKey = (a: ArrayBuffer | null | undefined, k: string) => {
  if (!a) return false;
  const x = new Uint8Array(a), y = keyBytes(k);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
type Config = { enabled: boolean; key: string; devices: number; why?: string };
type SubAnswer = { ok: true; prefs: PushPrefs; op: string };

/** Подписка браузера на ключ сервера (старая на другой ключ — заменяется) → отправка на сервер. */
async function subscribe(ws: string, prefs?: PushPrefs): Promise<SubAnswer> {
  if (!(await swRegister())) throw new Error("Браузер не дал включить уведомления (Service Worker).");
  const cfg = await call<Config>(`/api/push/config?c=${enc(ws)}`);
  if (!cfg.enabled) throw new Error(cfg.why || "Push на сервере не настроен.");
  const r = await navigator.serviceWorker.ready;
  let sub = await r.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, cfg.key)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.key) });
  const res = await call<SubAnswer>("/api/push/subscribe", { c: ws, sub: sub.toJSON() as unknown as Record<string, unknown>, op: getOperator(), ...(prefs ? { prefs } : {}) });
  mark(ws, true);
  setPushHere(true);
  return res;
}

/** Что сейчас на этом устройстве (для экрана настроек). */
export async function pushState(ws: string): Promise<PushState> {
  const support = pushSupport();
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const base: PushState = { support, permission, on: false, prefs: null, op: getOperator() };
  if (support !== "ok" || permission !== "granted" || !marks()[ws]) return base;
  try {
    const sub = await currentSub();
    if (!sub) return base;
    const r = await subscribe(ws); // заодно обновить подписку на сервере (браузер мог её сменить, сервер — сменить ключ)
    return { ...base, on: true, prefs: r.prefs, op: r.op };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

/** Включить: сначала разрешение (на iPhone — прямо по нажатию, без ожиданий до него), потом подписка. */
export async function pushEnable(ws: string, prefs: PushPrefs): Promise<PushState> {
  const p = await Notification.requestPermission();
  if (p !== "granted") return { support: pushSupport(), permission: p, on: false, prefs: null, op: getOperator() };
  const r = await subscribe(ws, prefs);
  return { support: "ok", permission: "granted", on: true, prefs: r.prefs, op: r.op };
}
export async function pushSave(ws: string, prefs: PushPrefs): Promise<SubAnswer> {
  const sub = await currentSub();
  if (!sub) throw new Error("Уведомления на этом устройстве выключены. Включите их заново.");
  return call<SubAnswer>("/api/push/prefs", { c: ws, endpoint: sub.endpoint, prefs, op: getOperator() });
}
export async function pushTest(ws: string): Promise<void> {
  const sub = await currentSub();
  if (!sub) throw new Error("Уведомления на этом устройстве выключены. Включите их заново.");
  await call("/api/push/test", { c: ws, endpoint: sub.endpoint });
}
/** Выключить для этой компании; других компаний на устройстве не осталось — отписать браузер совсем. */
export async function pushDisable(ws: string): Promise<void> {
  const sub = await currentSub();
  if (sub) await call("/api/push/unsubscribe", { c: ws, endpoint: sub.endpoint });
  mark(ws, false);
  setPushHere(false);
  if (sub && !Object.keys(marks()).length) await sub.unsubscribe().catch(() => false);
}

/** Выход из пульта: сначала выключаем уведомления этого устройства (иначе после выхода они приходили бы и дальше — проверка
 *  безопасности 31.10.2026), не дольше 2 секунд, потом — на /logout. */
export async function logoutWith(url: string, ws: string | null) {
  if (ws) await Promise.race([pushDisable(ws).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  location.href = url;
}

/** При открытии пульта: Service Worker, переход к чату по нажатию на уведомление, отметка «push включён здесь». */
export function pushBoot(ws: string | null) {
  if (!("serviceWorker" in navigator)) return;
  const on = !!ws && !!marks()[ws] && "Notification" in window && Notification.permission === "granted";
  setPushHere(on);
  void swRegister();
  if (on && ws) void subscribe(ws).catch(() => setPushHere(false)); // подписку сменил браузер или сервер — обновить тихо
}
let listening = false;
export function pushListen() {
  if (listening || !("serviceWorker" in navigator)) return;
  listening = true;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null;
    if (!d || d.type !== "pult-open" || typeof d.url !== "string") return;
    let u: URL;
    try {
      u = new URL(d.url, location.origin);
    } catch {
      return;
    }
    if (u.origin !== location.origin || !u.pathname.startsWith("/app/")) return;
    if (u.pathname === location.pathname && u.search === location.search) location.hash = u.hash; // тот же пульт и компания — без перезагрузки
    else location.href = u.href;
  });
}
