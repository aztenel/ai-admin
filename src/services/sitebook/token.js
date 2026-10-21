// @ts-check
// Метка формы ft — «<мс выдачи>.<подпись>»: каталог выдаёт её форме, запись принимает только с ней. Защита от спама скриптами:
// заявку нельзя отправить, не загрузив форму (подпись — HMAC ключом владельца LEADS_KEY), быстрее чем за 4 секунды после загрузки
// (человек столько не заполнит четыре шага) и по метке старше 3 часов
/** @import { Env, Client } from "../../lib/types.js" */
import { hmacB64, eqSafe } from "../../lib/crypto.js";

export const FT_MIN_MS = 4000, FT_MAX_MS = 3 * 3600e3;
/** @param {Env} env @param {Client} c @param {number} ms */
const sign = async (env, c, ms) => (await hmacB64(String(env.LEADS_KEY || ""), `site:${c.id}:${ms}`)).slice(0, 22);

/** @param {Env} env @param {Client} c @param {number} nowMs @returns {Promise<string>} */
export async function ftMake(env, c, nowMs) { return `${nowMs}.${await sign(env, c, nowMs)}`; }

/** @param {any} ft @returns {number} мс выдачи или 0 */
export const ftTime = ft => { const m = /^(\d{10,16})\.[A-Za-z0-9_-]{22}$/.exec(String(ft || "")); return m ? +m[1] : 0; };

// "ok" | "fast" (моложе 4 с) | "old" (старше 3 ч) | "bad" (подпись не та, метка из будущего, нет ключа)
/** @param {Env} env @param {Client} c @param {any} ft @param {number} nowMs @returns {Promise<"ok" | "fast" | "old" | "bad">} */
export async function ftCheck(env, c, ft, nowMs) {
  const ms = ftTime(ft);
  if (!ms || !env.LEADS_KEY || ms > nowMs + 60e3) return "bad";
  if (!eqSafe(String(ft).split(".")[1], await sign(env, c, ms))) return "bad";
  const age = nowMs - ms;
  return age < FT_MIN_MS ? "fast" : age > FT_MAX_MS ? "old" : "ok";
}
