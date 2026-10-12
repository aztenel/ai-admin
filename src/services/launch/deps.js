// @ts-check
// Проверка запуска: то, что контроллеру нужно из адаптеров. Слой controllers не подключает integrations напрямую (CLAUDE.md §4), поэтому берёт через services.
export { altBase } from "../integrations/altegio/booking-api.js";
export { tgProbe } from "../integrations/telegram/client.js";
export { gaRoute, gaSecret, gaHook } from "../integrations/greenapi/webhook.js";
export { gaCall, gaCode, gaWhy, gaInfo } from "../integrations/greenapi/client.js";
export { WA_HINT } from "../integrations/meta/client.js";
