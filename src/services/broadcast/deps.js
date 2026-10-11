// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Рассылки: то, что контроллеру нужно из хранилища и адаптеров. Слой controllers не подключает db и integrations напрямую (CLAUDE.md §4), поэтому берёт через services.
export { kvRetry } from "../../db/kv/retry.js";
export { bcKey, bcChunkKey, bcPut, bcGet } from "../../db/kv/broadcasts.js";
export { bcParam, sendTemplate } from "../integrations/meta/templates.js";
export { gaRoute } from "../integrations/greenapi/webhook.js";
export { gaWhy, gaInfo } from "../integrations/greenapi/client.js";
