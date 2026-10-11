// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Рассылки: сигналы «остановиться» от Meta и Green-API (bchold), состояния номера Green-API, разбор сигналов Meta (waSignal, waFailed, gaStateSignal).
import { clean } from "../../lib/text.js";
import { isoDay } from "../../lib/time.js";
import { kvRetry } from "../../db/kv/retry.js";
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { notify } from "../integrations/telegram/client.js";
import { notifyOnce } from "../notifications/telegram.js";
import { BC_HINT, BC_ACCOUNT } from "./errors.js";
export const bcClientOf = (env, wx) => (wx && wx.client) || (hasClient(env.WA_CLIENT) ? env.WA_CLIENT : ""); // чей это номер WhatsApp
// сигнал Meta «остановиться»: { all: { at, why }, tpl: { <шаблон>: { at, why } } }
export const bcHold = async (env, cid) => { try { return JSON.parse((await env.KV.get("bchold:" + cid)) || "null"); } catch (e) { return null; } };
export const bcHoldFor = (h, b) => (h && (b.ch === "ga" ? h.ga : h.all || (h.tpl && h.tpl[b.tpl]))) || null; // сигналы Meta не касаются номера Green-API, и наоборот
export const bcFrom = b => b.ch === "ga" ? "Green-API" : "Meta";
export async function bcHoldEdit(env, cid, edit) {
  await kvRetry(async () => {
    const h = (await bcHold(env, cid)) || {};
    edit(h);
    if (h.tpl && !Object.keys(h.tpl).length) delete h.tpl;
    if (!h.all && !h.tpl && !h.ga) await env.KV.delete("bchold:" + cid); else await env.KV.put("bchold:" + cid, JSON.stringify(h), { expirationTtl: 14 * 86400 });
  });
}
export const GA_STATE_TEXT = { notAuthorized: "WhatsApp не привязан к Green-API — отсканируйте QR-код в кабинете Green-API телефоном с этим номером", blocked: "WhatsApp заблокировал этот номер",
  suspended: "WhatsApp временно ограничил этот номер (жалобы на спам)", yellowCard: "WhatsApp временно ограничил этот номер (жалобы на спам)", sleepMode: "WhatsApp на телефоне не на связи: телефон выключен или без интернета", starting: "Green-API перезапускает инстанс — это до 5 минут" };
// WhatsApp заблокировал или ограничил номер: тревога администратору, рассылки через Green-API встают до подтверждения
export const GA_STATE_BAD = { blocked: "WhatsApp заблокировал номер", suspended: "WhatsApp временно ограничил номер (жалобы на спам)", yellowCard: "WhatsApp временно ограничил номер (жалобы на спам)" };
export async function gaStateSignal(env, r, state) {
  const cid = r.client;
  if (!hasClient(cid)) { console.log("ga state", state); return; }
  const who = CLIENTS[cid].name;
  if (GA_STATE_BAD[state]) {
    const why = GA_STATE_BAD[state];
    try { await bcHoldEdit(env, cid, h => { h.ga = { at: Date.now(), why }; }); } catch (e) { console.log("bchold", String(e)); } // тревога важнее пометки: сбой хранилища её не отменяет (перед отправкой состояние номера проверяется заново)
    await notifyOnce(env, "gastate:" + cid + ":" + state, `🚨 WhatsApp (Green-API) — ${who}\n${why}.\nРассылки остановлены.${state === "blocked" ? " Бот на этом номере не отвечает клиентам." : " Пару дней не делайте рассылок и пишите только тем, кто пишет вам сам."}`, cid);
  } else if (state === "notAuthorized") await notifyOnce(env, "gastate:" + cid + ":" + state, `⚠️ WhatsApp (Green-API) — ${who}\nWhatsApp отвязан от Green-API: бот не получает и не отправляет сообщения. Отсканируйте QR-код в кабинете Green-API телефоном с этим номером.`, cid);
}
// сигналы Meta, которые приходят на тот же вебхук, что и сообщения: шаблон приостановлен, аккаунт ограничен, человек запретил рекламу
const TPL_EVENT = { APPROVED: "одобрен — его можно отправлять", REINSTATED: "снова работает", UNARCHIVED: "возвращён из архива", REJECTED: "отклонён Meta", PAUSED: "приостановлен Meta: клиенты жаловались на сообщения",
  DISABLED: "отключён Meta из-за жалоб", FLAGGED: "под угрозой отключения: клиенты жалуются на сообщения", PENDING_DELETION: "удаляется", DELETED: "удалён", ARCHIVED: "отправлен в архив" };
const TPL_BAD = new Set(["REJECTED", "PAUSED", "DISABLED", "FLAGGED", "PENDING_DELETION", "DELETED", "ARCHIVED"]), TPL_GOOD = new Set(["APPROVED", "REINSTATED", "UNARCHIVED"]);
export async function waSignal(env, wx, field, val) {
  const cid = bcClientOf(env, wx);
  if (!cid) return;
  const who = CLIENTS[cid].name, now = Date.now(), ev = String(val.event || "").toUpperCase(), s = (x, n) => clean(String(x ?? ""), n || 80);
  if (field === "user_preferences") { // человек в самом WhatsApp запретил или снова разрешил рекламные сообщения
    for (const p of val.user_preferences || []) {
      const d = String((p && p.wa_id) || "").replace(/\D/g, "");
      if (!/^\d{8,15}$/.test(d) || (p.category && p.category !== "marketing_messages")) continue;
      if (p.value === "stop") await env.KV.put(`optout:${cid}:${d}`, "meta:" + now);
      else if (p.value === "resume") { const cur = await env.KV.get(`optout:${cid}:${d}`); if (cur && String(cur).startsWith("meta:")) await env.KV.delete(`optout:${cid}:${d}`); } // «стоп», написанный боту, снимает только слово «старт»
    }
    return;
  }
  if (field === "message_template_status_update" || field === "message_template_quality_update") {
    const name = s(val.message_template_name, 100); if (!name) return;
    const q = String(val.new_quality_score || "").toUpperCase();
    const bad = field.endsWith("status_update") ? TPL_BAD.has(ev) : q === "RED", good = field.endsWith("status_update") ? TPL_GOOD.has(ev) : q === "GREEN";
    const why = field.endsWith("status_update") ? `шаблон «${name}» ${TPL_EVENT[ev] || "изменил статус: " + s(ev, 30)}${val.rejection_info && val.rejection_info.reason ? ` (${s(val.rejection_info.reason, 200)})` : val.reason && val.reason !== "NONE" ? ` (${s(val.reason, 40)})` : ""}`
      : `качество шаблона «${name}» — ${q === "RED" ? "низкое: клиенты жалуются, Meta может его отключить" : q === "YELLOW" ? "среднее: появились жалобы клиентов" : q === "GREEN" ? "высокое" : s(q, 20)}`;
    if (bad) await bcHoldEdit(env, cid, h => { (h.tpl = h.tpl || {})[name] = { at: now, why }; });
    else if (good) await bcHoldEdit(env, cid, h => { if (h.tpl) delete h.tpl[name]; });
    if (bad || good || q === "YELLOW") await notify(env, `${bad ? "⚠️" : good ? "✅" : "ℹ️"} WhatsApp — ${who}\n${why[0].toUpperCase() + why.slice(1)}.${bad ? "\nРассылки с этим шаблоном остановлены." : ""}`, cid);
    return;
  }
  if (field === "account_update") {
    const ban = String((val.ban_info && val.ban_info.waba_ban_state) || "").toUpperCase();
    const serious = ["DISABLED_UPDATE", "ACCOUNT_VIOLATION", "ACCOUNT_RESTRICTION", "ACCOUNT_DELETED"].includes(ev) && ban !== "REINSTATE";
    if (!serious) { console.log("wa account_update", ev); return; }
    const why = ev === "ACCOUNT_VIOLATION" ? `аккаунт WhatsApp нарушил правила${val.violation_info && val.violation_info.violation_type ? ` (${s(val.violation_info.violation_type, 60)})` : ""}`
      : ev === "ACCOUNT_RESTRICTION" ? `Meta ограничила аккаунт WhatsApp${Array.isArray(val.restriction_info) && val.restriction_info[0] ? ` (${s(val.restriction_info[0].restriction_type, 60)})` : ""}`
        : ev === "ACCOUNT_DELETED" ? "аккаунт WhatsApp удалён" : `аккаунт WhatsApp отключают${ban ? ` (${s(ban, 40)})` : ""}`;
    await bcHoldEdit(env, cid, h => { h.all = { at: now, why }; });
    await notify(env, `🚨 WhatsApp — ${who}\n${why[0].toUpperCase() + why.slice(1)}.\nРассылки остановлены. Откройте кабинет Meta → Business Support Home.`, cid);
    return;
  }
  if (field === "account_alerts" || field === "business_capability_update" || field === "phone_number_quality_update" || field === "account_review_update" || field === "phone_number_name_update") {
    if (field === "phone_number_quality_update" && ev === "ONBOARDING") return;
    const facts = Object.entries(val).filter(([k, v]) => ["string", "number"].includes(typeof v) && !/^(display_phone_number|messaging_product)$/.test(k)).slice(0, 6).map(([k, v]) => `${s(k, 40)}: ${s(v, 120)}`).join("\n");
    await notifyOnce(env, "wasig:" + cid + ":" + field + ":" + ev, `ℹ️ WhatsApp — ${who}\nСообщение от Meta (${field}):\n${facts || "без подробностей"}`, cid);
  }
}
// недоставленные сообщения (Meta сообщает о них позже, отдельным событием): считаем по дням, опасные причины останавливают рассылки
export async function waFailed(env, wx, fails) {
  const cid = bcClientOf(env, wx);
  if (!cid || !fails.length) return;
  const now = Date.now(), key = `bcf:${cid}:${isoDay(now)}`;
  try { // счётчик приблизительный: при плотном потоке событий часть может не записаться — на остановку рассылок это не влияет
    const f = JSON.parse((await env.KV.get(key)) || "{}") || {};
    f.n = (f.n || 0) + fails.length; f.codes = f.codes || {};
    for (const x of fails) f.codes[x.code] = (f.codes[x.code] || 0) + 1;
    await env.KV.put(key, JSON.stringify(f), { expirationTtl: 14 * 86400 });
  } catch (e) { console.log("bcf", String(e).slice(0, 120)); }
  for (const x of fails) if (x.code === 131050 && /^\d{8,15}$/.test(x.to)) { try { await env.KV.put(`optout:${cid}:${x.to}`, "meta:" + now); } catch (e) {} }
  const hard = fails.find(x => BC_ACCOUNT.has(x.code));
  if (hard) {
    const why = BC_HINT[hard.code] || "код " + hard.code;
    await bcHoldEdit(env, cid, h => { h.all = { at: now, why }; });
    await notifyOnce(env, "wafail:" + cid + ":" + hard.code, `⚠️ WhatsApp — ${CLIENTS[cid].name}\nСообщения не доходят: ${why}.\nРассылки остановлены.`, cid);
  }
}
