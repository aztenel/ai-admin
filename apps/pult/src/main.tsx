import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// На сайте (/app/) после выкладки файлы прежней сборки удалены: раздел, который ещё не открывали, не подгрузится, и пульт
// остался бы пустым. Тогда один раз перезагружаем страницу — она всегда свежая (no-store). Не вышло и после этого —
// ошибка как есть, без перезагрузки по кругу. Нет связи — не перезагружаем: страница браузера «нет интернета» осталась бы и после
// возвращения связи (в приложении с экрана «Домой» нет кнопки «обновить»); ошибку покажет сам раздел — «не загрузился, Повторить»
// (components/boundary.tsx; находка проверки 19.10.2026).
window.addEventListener("vite:preloadError", (e) => {
  if (!navigator.onLine) return;
  const key = "pult.reloadAt";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key)) || 0;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return; // хранилище недоступно — не перезагружаем, чтобы не уйти в круг
  }
  if (Date.now() - last < 60_000) return;
  e.preventDefault();
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
