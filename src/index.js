// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Точка входа Worker: fetch / scheduled. Страницы пульта (pult.gen.js и pult-app.gen.js лежат вне src/) приходят из worker.js параметром.
import { jsonP } from "./lib/http.js";
import { route } from "./routes/index.js";
import { backup, scheduled } from "./jobs/scheduled.js";

/** @param {any} pult { PULT_LIVE, PULT_DEMO, PULT_ICONS } из pult.gen.js и { PULT_APP } из pult-app.gen.js (новый пульт, /app/) */
export function createWorker(pult) {
  return {
    /** @param {any} request @param {any} env @param {any} ctx */
    async fetch(request, env, ctx) {
      try { return await route(request, env, ctx, pult); }
      catch (e) { // необработанный сбой (чаще всего — хранилище): страницы пульта и рассылок получают понятный ответ, а не пустую ошибку
        console.log("fatal", String((e && /** @type {any} */ (e).stack) || e).slice(0, 800));
        let P = ""; try { P = new URL(request.url).pathname; } catch (x) {}
        if (P.startsWith("/api/") && P !== "/api/chat") return jsonP({ error: "Сбой на сервере — попробуйте ещё раз через минуту." }, 500);
        throw e;
      }
    },
    // раз в минуту (cron в wrangler.jsonc): фоновая отправка рассылок
    backup,
    scheduled
  };
}
