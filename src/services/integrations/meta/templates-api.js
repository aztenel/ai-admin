// @ts-check
// Шаблоны WhatsApp в Meta (план Meta, шаг 2, 09.11.2026): список шаблонов WABA (tplList) и подача нового (tplCreate). Только обращение
// к Graph и разбор ответа во внутренний вид (tplView); что подавать, как привязывать к сценариям и хранить статусы — реестр
// services/meta (шаг 4). Список — страницами по курсору after: в paging.next Graph кладёт ключ (access_token), поэтому next целиком
// не используется и никуда не сохраняется. Подача — запись: на черновике 409 preview, без повтора (metaWrite).
// Поля шаблона (parameter_format, quality_score, rejected_reason, previous_category) — по документации Meta, вживую не проверены.
/** @import { Env } from "../../../lib/types.js" */
/** @import { MetaCreds, MetaOpts, MetaRes } from "./graph.js" */
import { clean } from "../../../lib/text.js";
import { metaNode, metaNeed, metaWrite, metaFail } from "./graph.js";

const TPL_F = ["id", "name", "language", "status", "category", "previous_category", "parameter_format", "components", "quality_score", "rejected_reason"];
const TPL_BASE = ["id", "name", "language", "status", "category", "components"];
export const TPL_PAGES = 5, TPL_LIMIT = 100;
const CATS = ["UTILITY", "MARKETING", "AUTHENTICATION"];

/** переменные текста по порядку, без повторов: «{{date}} … {{date}}» → ["date"], «{{1}}» → ["1"] @param {any} text */
const varsOf = text => [...new Set([...String(text || "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1]))];
/** @param {any} v */
const upw = v => clean(String(v || ""), 40).toUpperCase();

/**
 * @typedef {{ id: string, name: string, lang: string, status: string, category: string, prev: string, quality: string, reason: string,
 *   pf: "named" | "positional", body: string, params: string[], header: null | { format: string, text?: string, params?: string[] },
 *   footer: string, buttons: { type: string, text: string, url?: string, param?: boolean }[] }} TplView
 */
/**
 * Шаблон Graph → внутренний вид. Тело — как есть (с переводами строк: по нему потом сверяется, не изменён ли текст), параметры —
 * имена переменных тела. Пропуски терпятся: нет поля — пустая строка.
 * @param {any} t @returns {TplView}
 */
export function tplView(t) {
  const x = t && typeof t === "object" ? t : {}, comps = Array.isArray(x.components) ? x.components : [];
  const part = (/** @type {string} */ type) => comps.find((/** @type {any} */ c) => c && String(c.type || "").toUpperCase() === type);
  const B = part("BODY"), H = part("HEADER"), F = part("FOOTER"), K = part("BUTTONS");
  const body = String((B && B.text) || "").slice(0, 2000), params = varsOf(body), pf0 = String(x.parameter_format || "").toLowerCase();
  /** @type {"named" | "positional"} */
  const pf = pf0 === "named" || pf0 === "positional" ? pf0 : params.length && !params.every(v => /^\d+$/.test(v)) ? "named" : "positional";
  /** @type {TplView["header"]} */ let header = null;
  if (H) { const fmt = upw(H.format || "TEXT"); header = fmt === "TEXT" ? { format: "TEXT", text: String(H.text || "").slice(0, 200), params: varsOf(H.text) } : { format: fmt }; }
  const buttons = ((K && Array.isArray(K.buttons) && K.buttons) || []).map((/** @type {any} */ b) => {
    const type = upw(b && b.type), text = clean((b && b.text) || "", 40);
    return type === "URL" ? { type, text, url: String(b.url || "").slice(0, 2000), param: /\{\{\s*\d+\s*\}\}/.test(String(b.url || "")) } : { type, text };
  });
  const q = x.quality_score && typeof x.quality_score === "object" ? x.quality_score.score : x.quality_score, rr = upw(x.rejected_reason);
  return { id: clean(x.id || "", 32), name: clean(x.name || "", 512), lang: clean(x.language || "", 16), status: upw(x.status), category: upw(x.category), prev: upw(x.previous_category),
    quality: upw(q), reason: rr === "NONE" ? "" : rr, pf, body, params, header, footer: String((F && F.text) || "").slice(0, 60), buttons };
}

/**
 * Все шаблоны WABA компании: не больше o.pages страниц (5) по o.limit (100). Больше — more: true. Сбой любой страницы — ошибка, а не
 * половина списка: иначе непрочитанные шаблоны выглядели бы удалёнными.
 * @param {Env} env @param {MetaCreds} ids @param {MetaOpts & { pages?: number, limit?: number }} [o]
 * @returns {Promise<{ ok: true, list: TplView[], more: boolean } | MetaRes>}
 */
export async function tplList(env, ids, o = {}) {
  const miss = metaNeed(ids, ["token", "waba"]);
  if (miss) return miss;
  const pages = o.pages || TPL_PAGES, limit = o.limit || TPL_LIMIT, list = [];
  let fields = TPL_F, after = "", more = false;
  for (let p = 0; p < pages; p++) {
    const r = await metaNode(env, ids.token, `${ids.waba}/message_templates`, fields,
      { ...o, ctx: "waba", up: ids.up, ladder: [TPL_BASE], query: { limit: String(limit), ...(after ? { after } : {}) } });
    if (!r.ok) { const { fields: _f, j, ...e } = r; return e; }
    fields = r.fields;
    for (const t of (r.j && Array.isArray(r.j.data) && r.j.data) || []) list.push(tplView(t));
    const pg = r.j && r.j.paging, cur = pg && pg.cursors && pg.cursors.after;
    if (!pg || !pg.next || !cur) break;
    after = String(cur).slice(0, 500);
    if (p === pages - 1) more = true;
  }
  return { ok: true, list, more };
}

/**
 * Подать шаблон в Meta: POST /{WABA}/message_templates ровно с этим телом (name, language, category, parameter_format, components).
 * Проверка здесь — только чтобы не слать заведомо неверное; правила текста Meta (переменная в начале или в конце и т. п.) — реестр
 * (шаг 4). Meta отказала — её текст в user. Ответа нет — unsure: шаблон мог податься, сначала перечитать список.
 * @param {Env} env @param {MetaCreds} ids @param {any} spec @param {MetaOpts} [o]
 * @returns {Promise<{ ok: true, id: string, status: string, category: string } | MetaRes>}
 */
export async function tplCreate(env, ids, spec, o = {}) {
  const miss = metaNeed(ids, ["token", "waba"]);
  if (miss) return miss;
  const s = spec && typeof spec === "object" ? spec : {};
  const bad = !/^[a-z0-9_]{1,512}$/.test(String(s.name || "")) ? "имя шаблона — только строчные латинские буквы, цифры и «_»"
    : !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(String(s.language || "")) ? "не указан язык шаблона (ru, kk, en)"
    : !CATS.includes(String(s.category || "").toUpperCase()) ? "категория — UTILITY, MARKETING или AUTHENTICATION"
    : !Array.isArray(s.components) || !s.components.some((/** @type {any} */ c) => c && String(c.type || "").toUpperCase() === "BODY" && String(c.text || "").trim()) ? "у шаблона нет текста"
    : "";
  if (bad) return { ...metaFail("bad", "Шаблон не подан: " + bad), unsure: false };
  const r = await metaWrite(env, ids.token, "POST", `${ids.waba}/message_templates`, s, { ...o, ctx: "waba", up: ids.up });
  if (!r.ok) return r;
  const j = r.j || {};
  return { ok: true, id: clean(j.id || "", 32), status: upw(j.status), category: upw(j.category) };
}
