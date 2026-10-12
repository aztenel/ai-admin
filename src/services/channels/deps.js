// @ts-check
// Обработчики каналов (controllers/chat.js, controllers/webhooks/*): то, что им нужно из хранилища и адаптеров. Слой controllers не подключает db и integrations напрямую (CLAUDE.md §4), поэтому берёт через services.
export { readHist, putHist, logTurns } from "../../db/kv/chats.js";
export { kvRetry } from "../../db/kv/retry.js";
export { waErr } from "../integrations/meta/client.js";
export { notify } from "../integrations/telegram/client.js";
export { gaShared } from "../integrations/greenapi/webhook.js";
export { gaRoute, gaHook } from "../integrations/greenapi/webhook.js";
