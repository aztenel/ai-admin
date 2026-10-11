// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Отправка шаблона Meta (рассылки): один вызов Graph API.
import { clean } from "../../../lib/text.js";
import { GRAPH } from "../../../config/constants.js";
import { waCreds } from "./client.js";

export const bcParam = (t, name, fallback) => clean(String(t).replace(/\{\s*(имя|name)\s*\}/gi, name || fallback || "клиент").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   "), 300) || "—"; // Meta не принимает пустые подстановки, переводы строк, табуляцию и больше четырёх пробелов подряд
export async function sendTemplate(env, to, b, name, route) {
  const cr = waCreds(env, route), params = (b.params || []).map(t => ({ type: "text", text: bcParam(t, name, b.fallback) }));
  const comps = [].concat(b.img ? [{ type: "header", parameters: [{ type: "image", image: { link: b.img } }] }] : [], params.length ? [{ type: "body", parameters: params }] : []);
  let r;
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 15000);
  try {
    r = await fetch(`${GRAPH}/${cr.pnid}/messages`, { method: "POST", headers: { authorization: "Bearer " + cr.token, "content-type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: b.tpl, language: { code: b.lang }, ...(comps.length ? { components: comps } : {}) } }) });
  } catch (e) { return { ok: false, code: 0, error: "Meta не ответила" }; } // ушло сообщение или нет — неизвестно
  finally { clearTimeout(timer); }
  if (r.ok) return { ok: true };
  let e = {}; try { e = (await r.json()).error || {}; } catch (x) {}
  return { ok: false, status: r.status, code: +e.code || r.status, error: clean(e.message || "", 160) };
}
