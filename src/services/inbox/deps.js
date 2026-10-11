// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Пульт чатов: то, что контроллеру нужно из хранилища и адаптеров. Слой controllers не подключает db и integrations напрямую (CLAUDE.md §4), поэтому берёт их через services.
export { loadLeads, allLeads, leadTs } from "../../db/kv/leads.js";
export { logTurns } from "../../db/kv/chats.js";
export { gaShared, gaRoute } from "../integrations/greenapi/webhook.js";
export { gaWhy } from "../integrations/greenapi/client.js";
export { waCreds, WA_HINT } from "../integrations/meta/client.js";
