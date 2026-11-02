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
import { contactsRun } from "../services/contacts/sync.js";
import { stopSweep, syncFix } from "../services/contacts/stops.js";
import { isPreview } from "../lib/stage.js";
import { chatEnv, chatPurgeRun } from "../services/chatstore/index.js";
import { walCron } from "../services/chatstore/wal.js";

/** @param {any} env */
export const backup = (env) => backupRun(env, true); // для проверок
/** @param {any} controller @param {any} env @param {any} ctx */
export async function scheduled(controller, env, ctx) {
  // черновик фоновых задач не делает вовсе — ни рассылок, ни напоминаний, ни синхронизаций (аудит 31.10.2026). Cloudflare черновикам
  // cron и так не запускает, а это — защита на случай, если запустит или задачу вызовут руками
  if (isPreview(env)) return;
  const at = (controller && controller.scheduledTime) || Date.now();
  // у каждой задачи своя обёртка хранилища переписок (services/chatstore): копии чатов, прочитанные одной задачей, не смешиваются с другой
  const E = () => chatEnv(env);
  ctx.waitUntil(Promise.all([cronRun(E()), backupRun(E()), digestRun(E(), at), remindRun(E(), at), jrRun(E(), at), qualityRun(E(), at), dayStatsRun(E(), at), crmRun(E(), at), autoRun(E(), at), contactsRun(E(), at), stopSweep(E(), at), syncFix(E(), at),
    chatPurgeRun(env, at), walCron(env, at)]).catch(e => console.log("cron", String((e && e.stack) || e))));
}
