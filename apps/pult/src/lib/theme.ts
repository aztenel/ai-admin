// Тема: как в системе, светлая или тёмная. Выбор хранится в браузере под тем же ключом, что у рабочего пульта (pult.theme:
// auto | light | dark), и действует сразу во всех открытых вкладках. Первую отрисовку без мигания делает скрипт в index.html.
// Оформление (ТЗ v3.0, 31.10.2026): Winchester (цвета сайта winchester.kz) или нейтральное. По умолчанию — как у компании
// (у Winchester фирменное, у остальных нейтральное); выбор на устройстве — pult.brand: auto | winchester | neutral.
// Фон переписки — pult.chatbg: plain | pattern | leather.
import { useEffect, useSyncExternalStore } from "react";

export type ThemePref = "auto" | "light" | "dark";
export type BrandPref = "auto" | "winchester" | "neutral";
export type ChatBg = "plain" | "pattern" | "leather";
const KEY = "pult.theme";
const BRAND = "pult.brand";
const CO = "pult.brand.co"; // оформление выбранной компании — чтобы скрипт index.html отрисовал первый кадр без мигания
const BG = "pult.chatbg";
const media = matchMedia("(prefers-color-scheme: dark)");

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* частный режим: выбор действует до перезагрузки */
  }
};
const read = (): ThemePref => {
  const v = get(KEY);
  return v === "light" || v === "dark" ? v : "auto";
};
const readBrand = (): BrandPref => {
  const v = get(BRAND);
  return v === "winchester" || v === "neutral" ? v : "auto";
};
const readBg = (): ChatBg => {
  const v = get(BG);
  return v === "pattern" || v === "leather" ? v : "plain";
};

let pref = read();
let brandPref = readBrand();
let company: string | null = get(CO);
let bg = readBg();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const brandOf = () => (brandPref === "auto" ? company : brandPref === "neutral" ? null : brandPref);
const BAR: Record<string, [string, string]> = { winchester: ["#fbf7f0", "#210f0f"], neutral: ["#ffffff", "#16191e"] };

function apply() {
  const dark = pref === "dark" || (pref === "auto" && media.matches);
  const r = document.documentElement;
  const brand = brandOf();
  r.setAttribute("data-theme", dark ? "dark" : "light");
  if (brand) r.setAttribute("data-brand", brand);
  else r.removeAttribute("data-brand");
  r.setAttribute("data-chatbg", bg);
  r.style.colorScheme = dark ? "dark" : "light";
  // цвет полосы состояния и заголовка окна — как у панелей пульта
  const bar = BAR[brand || "neutral"] || BAR.neutral;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? bar[1] : bar[0]);
}

export function setTheme(p: ThemePref) {
  pref = p;
  put(KEY, p === "auto" ? null : p);
  apply();
  emit();
}
export function setBrand(p: BrandPref) {
  brandPref = p;
  put(BRAND, p === "auto" ? null : p);
  apply();
  emit();
}
export function setChatBg(p: ChatBg) {
  bg = p;
  put(BG, p === "plain" ? null : p);
  apply();
  emit();
}
/** Оформление выбранной компании (из ответа сервера): Winchester — «winchester», остальные — null. */
export function setCompanyBrand(b: string | null) {
  if (b === company) return;
  company = b;
  put(CO, b);
  apply();
  emit();
}

media.addEventListener("change", () => {
  if (pref === "auto") apply();
  emit();
});
window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== KEY && e.key !== BRAND && e.key !== BG) return;
  pref = read();
  brandPref = readBrand();
  bg = readBg();
  apply();
  emit();
});

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useTheme(): { pref: ThemePref; dark: boolean; setTheme: (p: ThemePref) => void } {
  const p = useSyncExternalStore(subscribe, () => pref);
  const dark = useSyncExternalStore(subscribe, () => p === "dark" || (p === "auto" && media.matches));
  return { pref: p, dark, setTheme };
}
export function useLook(): { brand: BrandPref; company: string | null; active: string | null; bg: ChatBg } {
  const brand = useSyncExternalStore(subscribe, () => brandPref);
  const co = useSyncExternalStore(subscribe, () => company);
  const b = useSyncExternalStore(subscribe, () => bg);
  return { brand, company: co, active: brand === "auto" ? co : brand === "neutral" ? null : brand, bg: b };
}

/** Применить тему при запуске (скрипт index.html уже это сделал, здесь — на случай, если его не было). */
export function useThemeBoot() {
  useEffect(apply, []);
}
