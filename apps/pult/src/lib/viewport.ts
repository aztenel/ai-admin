// Клавиатура на iPhone. Safari не сжимает страницу под клавиатуру, а сдвигает видимую область: поле ответа уезжает под клавиатуру,
// шапка — за край экрана. Поэтому на сенсорных экранах корень пульта повторяет visualViewport: высота — видимая часть,
// сдвиг — на смещение видимой области. Тот же приём работает в рабочем пульте (pult/app.js, fitViewport) с 2026 года.
// На Android (Chrome) достаточно interactive-widget=resizes-content в index.html, но и там это не мешает.
import { useEffect } from "react";

export function useVisualViewport(el: HTMLElement | null) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!el || !vv || !matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
        el.style.transform = vv.offsetTop > 0 ? `translateY(${Math.round(vv.offsetTop)}px)` : "";
        const kb = window.innerHeight - vv.height > 120;
        // клавиатура открыта: без нижнего отступа «полоски Домой» (index.css, .pb-safe-kb). Ленту внизу держит Messages
        if (kb !== (el.dataset.kb === "1")) el.dataset.kb = kb ? "1" : "0";
      });
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    fit();
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      el.style.removeProperty("--app-h");
      el.style.transform = "";
    };
  }, [el]);
}

/** Сенсорный экран без мыши: Enter в поле ответа — новая строка, отправка — кнопкой. */
export const isTouch = () => matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
