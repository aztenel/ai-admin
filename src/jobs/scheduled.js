// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Фоновые задачи Worker: раз в минуту (cron в wrangler.jsonc) и ручной вызов резервной копии для проверок.
import { backupRun } from "../services/notifications/telegram.js";
import { digestRun, dayStatsRun } from "../services/digest.js";
import { remindRun } from "../services/reminders/send.js";
import { jrRun } from "../services/reminders/journal.js";
import { cronRun } from "./cron.js";
import { qualityRun } from "../services/broadcast/quality.js";
import { crmRun } from "../services/crm/snapshot.js";
import { autoRun } from "../services/crm/auto.js";

/** @param {any} env */
export const backup = (env) => backupRun(env, true); // для проверок
/** @param {any} controller @param {any} env @param {any} ctx */
export async function scheduled(controller, env, ctx) {
  const at = (controller && controller.scheduledTime) || Date.now();
  ctx.waitUntil(Promise.all([cronRun(env), backupRun(env), digestRun(env, at), remindRun(env, at), jrRun(env, at), qualityRun(env, at), dayStatsRun(env, at), crmRun(env, at), autoRun(env, at)]).catch(e => console.log("cron", String((e && e.stack) || e))));
}
