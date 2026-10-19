// Адреса внутри пульта — после «#»: так пульт одинаково открывается с любого пути сайта, в программе для Windows (Tauri)
// и в будущем приложении (Capacitor). Открытие чата и карточки клиента — новые записи истории: жест «назад» на iPhone
// и кнопка «Назад» в Android возвращают к списку, как в мессенджере.
import { useSyncExternalStore } from "react";

export type Route =
  | { name: "inbox"; conv?: string; contact?: boolean }
  | { name: "requests" }
  | { name: "campaigns" }
  | { name: "settings"; section?: string };

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (p[0] === "requests") return { name: "requests" };
  if (p[0] === "campaigns") return { name: "campaigns" };
  if (p[0] === "settings") return { name: "settings", section: p[1] };
  if (p[0] === "inbox" && p[1] && p[1].includes(":")) return { name: "inbox", conv: p[1], contact: p[2] === "contact" };
  return { name: "inbox" };
}

export function href(r: Route): string {
  if (r.name === "inbox") return "#/inbox" + (r.conv ? "/" + encodeURIComponent(r.conv) + (r.contact ? "/contact" : "") : "");
  if (r.name === "settings") return "#/settings" + (r.section ? "/" + r.section : "");
  return "#/" + r.name;
}

const subs = new Set<() => void>();
let cur = parse(location.hash);
let curKey = location.hash;
const emit = () => {
  if (location.hash === curKey) return;
  curKey = location.hash;
  cur = parse(location.hash);
  subs.forEach((f) => f());
};
window.addEventListener("popstate", emit);
window.addEventListener("hashchange", emit);

const depth = () => (history.state && typeof history.state.pultDepth === "number" ? history.state.pultDepth : 0);

/** replace — сменить адрес без новой записи истории (переключение разделов, фильтров). */
export function navigate(r: Route, opts: { replace?: boolean } = {}) {
  const h = href(r);
  if (h === location.hash) return;
  if (opts.replace) history.replaceState({ ...history.state, pultDepth: depth() }, "", h);
  else history.pushState({ pultDepth: depth() + 1 }, "", h);
  emit();
}

/** Назад: если пришли сюда изнутри пульта — по истории (как жест «назад»), иначе — на указанный экран. */
export function back(fallback: Route) {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => cur,
  );
}
