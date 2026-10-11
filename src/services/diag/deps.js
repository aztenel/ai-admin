// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Служебные страницы владельца (/altegio): то, что контроллеру нужно из адаптера Altegio. Слой controllers не подключает integrations напрямую (CLAUDE.md §4), поэтому берёт через services.
export { altText, altCall } from "../integrations/altegio/client.js";
export { altCache, altBase, altDates, altDropTimes, altTimes, altRecord } from "../integrations/altegio/booking-api.js";
export { altEmailErr, ALT_EMAIL_TIP } from "../integrations/altegio/errors.js";
