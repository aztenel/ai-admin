// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Общий CSS служебных страниц (светлая и тёмная тема) — нужен страницам владельца и пульту рассылок.

export const BASE_CSS = `:root{--bg:#e6eeef;--panel:#fff;--ink:#12303a;--muted:#5e7780;--line:#d3dfe2;--head:#0f3d4c;--bot:#dcf4ea;--acc:#159a7a;--lead:#fff8e6;--leadl:#e8c766;--bad:#b3261e;--good:#1b7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#0b1a1f;--panel:#12252b;--ink:#e4f0ee;--muted:#8fa9ae;--line:#23393f;--head:#0e2f39;--bot:#15463c;--acc:#2bbf98;--lead:#2e2811;--leadl:#9c8436;--bad:#ff8a80;--good:#6fd39c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}`;
