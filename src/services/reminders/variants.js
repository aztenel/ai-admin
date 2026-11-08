// @ts-check
// Варианты текстов сервисных сообщений компании с действующими по умолчанию (ТЗ v4, 08.11.2026): у Winchester — тексты как уведомления
// Altegio (c.svActive). Выбор владельца в пульте важнее; Text SV_DEFAULT_<ID> = 0 — умолчания нет (первый встроенный вариант, как раньше),
// 1 — есть. Хранилище (svtpl:<клиент>:var) не меняется: умолчание накладывается при чтении.
/** @import { Env, Client } from "../../lib/types.js" */
import { svVariants } from "../../db/kv/reminders.js";
import { withActive } from "./templates.js";

/** действующие по умолчанию для компании или null @param {Env} env @param {Client} c @returns {Record<string, string> | null} */
export function svDefaults(env, c) {
  const v = String(env["SV_DEFAULT_" + String(c.id).toUpperCase()] ?? "").trim();
  if (v === "0") return null;
  const d = /** @type {any} */ (c).svActive;
  return d && typeof d === "object" ? d : null;
}
/** варианты владельца с умолчаниями компании @param {Env} env @param {Client} c */
export const svOwn = async (env, c) => withActive(await svVariants(env, c.id), svDefaults(env, c));
