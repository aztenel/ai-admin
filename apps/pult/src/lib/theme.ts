// Тема: как в системе, светлая или тёмная. Выбор хранится в браузере под тем же ключом, что у рабочего пульта (pult.theme:
// auto | light | dark), и действует сразу во всех открытых вкладках. Первую отрисовку без мигания делает скрипт в index.html.
import { useEffect, useSyncExternalStore } from "react";

export type ThemePref = "auto" | "light" | "dark";
const KEY = "pult.theme";
const media = matchMedia("(prefers-color-scheme: dark)");

const read = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
};

let pref = read();
const subs = new Set<() => void>();

function apply() {
  const dark = pref === "dark" || (pref === "auto" && media.matches);
  const r = document.documentElement;
  r.setAttribute("data-theme", dark ? "dark" : "light");
  r.style.colorScheme = dark ? "dark" : "light";
  // цвет полосы состояния и заголовка окна — как у панелей пульта
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#16191e" : "#ffffff");
}

export function setTheme(p: ThemePref) {
  pref = p;
  try {
    if (p === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* частный режим: тема действует до перезагрузки */
  }
  apply();
  subs.forEach((f) => f());
}

media.addEventListener("change", () => {
  if (pref === "auto") apply();
  subs.forEach((f) => f());
});
window.addEventListener("storage", (e) => {
  if (e.key !== KEY && e.key !== null) return;
  pref = read();
  apply();
  subs.forEach((f) => f());
});

export function useTheme(): { pref: ThemePref; dark: boolean; setTheme: (p: ThemePref) => void } {
  const p = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => pref,
  );
  const dark = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => p === "dark" || (p === "auto" && media.matches),
  );
  return { pref: p, dark, setTheme };
}

/** Применить тему при запуске (скрипт index.html уже это сделал, здесь — на случай, если его не было). */
export function useThemeBoot() {
  useEffect(apply, []);
}
