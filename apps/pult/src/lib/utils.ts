// Склеивает классы Tailwind и убирает конфликтующие. Свои размеры шрифта (text-md) tailwind-merge должен знать,
// иначе спутает их с цветом текста (text-fg) и выкинет одно из двух.
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { useEffect, useState } from "react";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["xs", "sm", "ui", "base", "md", "lg", "xl", "2xl"] }],
      "text-color": [{ text: ["fg", "fg-2", "fg-3", "accent", "accent-fg", "accent-ink", "selected-fg", "critical", "positive", "bubble-op-fg", "surface", "white", "black", "inherit", "current", "transparent"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Совпадает ли медиа-запрос — для раскладок, которые нельзя описать одним CSS (что держать на странице). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

/** Текущее время, обновляется раз в минуту: «ждёт 5 мин» не застывает. */
export function useNow(step = 30e3): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(t);
  }, [step]);
  return now;
}
