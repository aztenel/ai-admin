// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Фоновые задачи Worker: раз в минуту (cron в wrangler.jsonc) и ручной вызов резервной копии для проверок.
import { backupRun } from "../services/notifications/telegram.js";
import { digestRun, dayStatsRun } from "../services/digest.js";
import { remindRun } from "../services/reminders/send.js";
import { cronRun } from "./cron.js";
import { qualityRun } from "../services/broadcast/quality.js";

/** @param {any} env */
export const backup = (env) => backupRun(env, true); // для проверок
/** @param {any} controller @param {any} env @param {any} ctx */
export async function scheduled(controller, env, ctx) {
  ctx.waitUntil(Promise.all([cronRun(env), backupRun(env), digestRun(env, (controller && controller.scheduledTime) || Date.now()), remindRun(env, (controller && controller.scheduledTime) || Date.now()), qualityRun(env, (controller && controller.scheduledTime) || Date.now()), dayStatsRun(env, (controller && controller.scheduledTime) || Date.now())]).catch(e => console.log("cron", String((e && e.stack) || e))));
}
