// @ts-check
// Сервисные сообщения по журналу Altegio с основного номера одобренными шаблонами Meta (Winchester, 19.11.2026: «дальше только по Meta,
// через Wazzapo», второй номер на Green-API отключён). Клиенту, который не писал последние 24 часа, WhatsApp разрешает только одобренный
// шаблон — поэтому текст не наш вариант S-каталога, а шаблон из кабинета (c.waTpl, у Winchester — builtin-clients.js), с подстановками
// из записи журнала. Отправка — sendTemplate (channels/templates.js: Meta напрямую, Wazzapo или Pushon — как у рассылок).
/** @import { Env, Client } from "../../lib/types.js" */
import { svVars, firstName } from "./templates.js";
import { BC_TEMP, BC_ACCOUNT, BC_PARAM, bcWhy } from "../broadcast/errors.js";

/** с какого номера уходят сервисные сообщения: "wa" — основной, шаблонами Meta (c.jr.via = "wa"); "ga" — второй номер (Green-API).
 *  Text REMIND_VIA_<ID> = wa / ga важнее паспорта (проверки второго номера ставят ga) @param {any} c @param {Env} [env] @returns {"wa" | "ga"} */
export const jrVia = (c, env) => {
  const v = env && c ? String(env["REMIND_VIA_" + String(c.id).toUpperCase()] || "").trim().toLowerCase() : "";
  return v === "wa" || v === "ga" ? v : c && c.jr && c.jr.via === "wa" ? "wa" : "ga";
};

/** шаблон Meta для вида сообщения (s01, d1, h2, s06, rv, bi, bo; у отмены cx шаблона нет). Имя и язык можно заменить без выкладки —
 *  Text TPL_<ВИД>_<ID> = «имя» или «имя:язык» (подстановки и текст — из паспорта). → { name, lang, params, body } или null
 *  @param {Env} env @param {Client} c @param {string} k */
export function jrTpl(env, c, k) {
  const t = /** @type {any} */ (c).waTpl && /** @type {any} */ (c).waTpl[k];
  if (!t || !t.name) return null;
  const raw = String(env["TPL_" + String(k).toUpperCase() + "_" + String(c.id).toUpperCase()] || "").trim();
  const m = /^([a-z0-9_]{1,512})(?::([a-zA-Z_]{2,5}))?$/.exec(raw);
  return { name: m ? m[1] : String(t.name), lang: m && m[2] ? m[2] : String(t.lang || "ru"), params: Array.isArray(t.params) ? t.params.map(String) : [], body: String(t.body || "") };
}

// Meta не принимает пустые подстановки, переводы строк и 4+ пробела подряд (как bcParam в integrations/meta/templates.js)
/** @param {any} v */
const one = v => String(v ?? "").replace(/[\n\t\r]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 300);

/** подстановки шаблона по записи: b — как msgOf в journal.js (name, date, time, services, staffName, amount, balance).
 *  Без имени — «дорогой гость» (обращение в шаблоне обязательное); другой пустой подстановки — miss (такое сообщение не шлём:
 *  «Барбер: —» клиенту хуже, чем ничего). → { params, text, miss }
 *  @param {Client} c @param {{ params: string[], body: string }} t @param {any} b */
export function jrTplFill(c, t, b) {
  const v = svVars(c, b, "ru");
  /** @type {string[]} */ const params = [];
  let miss = "";
  for (const p of t.params) {
    let s = one(p === "имя" ? firstName(b && b.name) || "дорогой гость" : (/** @type {any} */ (v))[p]);
    if (!s && !miss) miss = p;
    params.push(s || "—");
  }
  const text = t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[+n - 1] ?? "");
  return { params, text, miss };
}

/** ответ Meta (или Wazzapo) на шаблон → как поступить, как у второго номера (gaKind): "net" — неизвестно, ушло ли (второй раз не шлём);
 *  "temp" — точно не ушло, попробуем через минуту; "stop" — дело в номере, ключе или шаблоне (пауза 6 часов, сигнал владельцу);
 *  "fail" — этому клиенту не уйдёт (задача администратору) @param {any} r @returns {"net" | "temp" | "stop" | "fail"} */
export function waKind(r) {
  const code = +(r && r.code) || 0, st = +(r && r.status) || 0;
  if (BC_TEMP.has(code) || code === 429 || st === 429 || code === 131056) return "temp";
  if (BC_ACCOUNT.has(code) || BC_PARAM.has(code) || code === 401 || code === 403 || code === 404 || code === 409 || st === 401 || st === 403 || st === 409) return "stop";
  if (!code || !st || st === 408 || st === 499 || st >= 500 && !(code >= 1000) || code >= 500 && code < 600) return "net";
  return "fail";
}
/** причина словами (без номеров) @param {any} r */
export const waWhy = r => bcWhy({ code: (r && r.code) || (r && r.status) || 0, error: (r && r.error) || "" });
