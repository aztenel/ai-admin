// Заглушка Meta Graph API и помощники подписанных вебхуков Meta — для проверок номера Meta (ТЗ Winchester v4 §5, план Meta шаг 1,
// 09.11.2026). Без неё заглушка в test/harness.mjs на любой адрес Graph отвечает как на отправку сообщения: чтение сведений о номере,
// WABA и списка шаблонов проверить нечем. metaStub(net, …) ставит net.graphReply — разбор по методу и пути, как у Graph: сведения
// номера и WABA по полю fields, подписанные приложения, номера WABA, шаблоны страницами (paging.next / after), подача и удаление
// шаблона, отправка текста и шаблона со сверкой имени, языка и параметров с одобренным шаблоном (тело, шапка — текст или файл, кнопки-
// ссылки с {{1}}). Ключ компании проверяется по умолчанию, у каждой компании свои номер, WABA, ключ и секрет (metaIds). Отказы вставляются
// правилами (st.fail): код ошибки Meta, «висит» до AbortSignal, обрыв связи (TypeError), задержка, и любое из них после того, как Meta
// запрос выполнила (lost: сообщение ушло, а до нас дошла ошибка, срок или обрыв). В paging.next — ключ запроса, как у Graph.
// net.reset() убирает заглушку. Коды и тексты ошибок — по документации Meta (WhatsApp Cloud API, Graph API), вживую не проверены.
// Номера и ключи — вымышленные.

/** вымышленный номер Meta компании: id номера, WABA, ключ, секрет приложения, номер для показа */
export const META = Object.freeze({ pnid: "900333", waba: "800333", token: "test-meta-token-w", secret: "test-app-secret-w", display: "+7 700 000 03 33", name: "Winchester (тест)", app: "100000000000001" });

// вымышленные номер, WABA, ключ и секрет каждой компании: у Winchester — META, у остальных — свои, постоянные для cid (находка проверки
// шага 1, 09.11.2026: раньше metaEnv давал всем компаниям значения Winchester — подпись Winchester проходила на адресе другой компании,
// а по phone_number_id компании было не различить, и проверки изоляции прошли бы или упали не по той причине). Номер — от хэша cid;
// совпал с уже выданным — следующий свободный
/** @type {Map<string, Readonly<{ pnid: string, waba: string, token: string, secret: string, display: string, name: string, app: string }>>} */
const IDS = new Map([["winchester", META]]);
/** @param {string} [cid] */
export function metaIds(cid = "winchester") {
  const k = String(cid).toLowerCase(), have = IDS.get(k);
  if (have) return { ...have };
  let h = 2166136261; for (const ch of k) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const used = new Set([...IDS.values()].map(x => x.pnid));
  let n = h % 8000; while (used.has(String(910000 + n))) n = (n + 1) % 8000;
  const d = String(1000 + n); // номер для показа — +7 700 000 10 00 … 89 99: не совпадает ни с META, ни с номерами st.add без cid
  const ids = Object.freeze({ pnid: String(910000 + n), waba: String(810000 + n), token: "test-meta-token-" + k, secret: "test-app-secret-" + k,
    display: `+7 700 000 ${d.slice(0, 2)} ${d.slice(2)}`, name: k + " (тест)", app: META.app });
  IDS.set(k, ids);
  return { ...ids };
}

/** переменные номера Meta компании для mk(): ключ, секрет приложения, номер, WABA (WABA_ID_<ID> читают metaIds и адаптеры Graph — план, шаг 2);
 * у каждой компании свои (metaIds), явные o важнее
 * @param {string} [cid] @param {{ token?: string, secret?: string, pnid?: string, waba?: string }} [o] */
export function metaEnv(cid = "winchester", o = {}) {
  const up = String(cid).toUpperCase(), d = metaIds(cid);
  return { ["WA_TOKEN_" + up]: o.token || d.token, ["APP_SECRET_" + up]: o.secret || d.secret, ["PHONE_NUMBER_ID_" + up]: o.pnid || d.pnid, ["WABA_ID_" + up]: o.waba || d.waba };
}

// ---- ошибки Graph: код ответа и текст по коду ошибки Meta
/** @type {Record<number, number>} */
const ERR_HTTP = { 0: 401, 190: 401, 10: 403, 200: 403, 368: 403, 131005: 403, 131031: 403, 3: 500, 131000: 500, 2: 503, 131016: 503, 132001: 404 };
/** @type {Record<number, string>} */
const ERR_TEXT = {
  1: "An unknown error occurred", 2: "Service temporarily unavailable", 3: "Unknown method", 4: "Application request limit reached", 10: "Application does not have permission for this action",
  100: "Invalid parameter", 104: "An access token is required to request this resource.", 190: "Error validating access token: Session has expired", 200: "Permissions error",
  368: "Temporarily blocked for policies violations", 80007: "Rate limit issues", 80008: "There have been too many calls to this WhatsApp Business account", 130429: "Rate limit hit",
  131000: "Something went wrong", 131005: "Access denied", 131008: "Required parameter is missing", 131009: "Parameter value is not valid", 131016: "Service unavailable",
  131021: "Recipient cannot be sender", 131026: "Message undeliverable", 131031: "Business Account locked", 131042: "Business eligibility payment issue", 131047: "Re-engagement message",
  131048: "Spam rate limit hit", 131049: "This message was not delivered to maintain healthy ecosystem engagement.", 131050: "Unable to deliver the message. This recipient has chosen to stop receiving marketing messages on WhatsApp from your business",
  131051: "Unsupported message type", 131056: "(Business Account, Consumer Account) pair rate limit hit", 132000: "Number of parameters does not match the expected number of params",
  132001: "Template name does not exist in the translation", 132005: "Translated text too long", 132007: "Template Format Character Policy Violated", 132012: "Parameter format does not match format in the created template",
  132015: "Template is Paused", 132016: "Template is Disabled", 133010: "Phone number Not Registered"
};
/** тело ошибки, как у Graph: { error: { message, type, code, error_subcode?, error_user_msg?, error_data?, fbtrace_id } }
 * @param {number} code @param {{ status?: number, message?: string, subcode?: number, details?: string, userMsg?: string }} [o] */
function errOf(code, o = {}) {
  const text = o.message || ERR_TEXT[code] || "Error";
  const error = { message: code === 190 || code === 104 ? text : `(#${code}) ${text}`, type: "OAuthException", code,
    ...(o.subcode ? { error_subcode: o.subcode } : {}), ...(o.userMsg ? { error_user_title: text, error_user_msg: o.userMsg } : {}),
    ...(o.details ? { error_data: { messaging_product: "whatsapp", details: o.details } } : {}), fbtrace_id: "StubTrace" + code };
  return new Response(JSON.stringify({ error }), { status: o.status || ERR_HTTP[code] || 400, headers: { "content-type": "application/json" } });
}
/** @param {any} o @param {number} [status] */
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
/** @param {string} kind @param {string} id */
const noObject = (kind, id) => errOf(100, { subcode: 33, message: `Unsupported ${kind} request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.` });

// ---- поля узлов: известные Graph (неизвестное поле — код 100, как у Graph) и что отдаётся без fields
const PHONE_FIELDS = ["id", "display_phone_number", "verified_name", "quality_rating", "whatsapp_business_manager_messaging_limit", "messaging_limit_tier", "status", "name_status", "new_name_status",
  "code_verification_status", "platform_type", "account_mode", "throughput", "is_official_business_account", "is_pin_enabled", "health_status", "last_onboarded_time", "webhook_configuration", "quality_score", "search_visibility"];
const PHONE_DEFAULT = ["id", "display_phone_number", "verified_name", "quality_rating", "code_verification_status", "platform_type", "throughput"];
const WABA_FIELDS = ["id", "name", "account_review_status", "business_verification_status", "currency", "timezone_id", "message_template_namespace", "ownership_type", "country", "health_status",
  "primary_business_location", "on_behalf_of_business_info", "owner_business_info", "is_enabled_for_insights", "marketing_messages_lite_api_status"];
const WABA_DEFAULT = ["id", "name", "timezone_id", "message_template_namespace"];
const TPL_FIELDS = ["id", "name", "language", "status", "category", "previous_category", "sub_category", "parameter_format", "components", "quality_score", "rejected_reason", "correct_category",
  "cta_url_link_tracking_opted_out", "library_template_name", "message_send_ttl_seconds"];
const TPL_DEFAULT = ["id", "name", "parameter_format", "components", "language", "status", "category"];
/** выбор полей по fields; «quality_score{score}» — по имени поля. Отсутствующее значение Graph не отдаёт
 * @param {any} obj @param {string|undefined} fields @param {string[]} known @param {string[]} dflt @param {string} node @param {string[]} [hidden] поля, которых «нет» в этой версии API */
function pick(obj, fields, known, dflt, node, hidden = []) {
  const want = fields ? fields.split(",").map(f => f.trim().replace(/\{.*$/, "")).filter(Boolean) : dflt;
  const bad = want.find(f => !known.includes(f) || hidden.includes(f));
  if (bad) return { err: errOf(100, { message: `Tried accessing nonexisting field (${bad}) on node type (${node})` }) };
  /** @type {Record<string, any>} */ const out = { id: obj.id };
  for (const f of want) if (obj[f] !== undefined) out[f] = JSON.parse(JSON.stringify(obj[f]));
  return { out };
}

// ---- шаблоны: сокращённая запись { name, body, header, footer, buttons } → вид Graph с components
/** имена переменных текста по порядку, без повторов: «{{date}}» → date, «{{1}}» → 1 @param {string} text */
const varsOf = text => [...new Set([...String(text || "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1]))];
/** @param {string[]} v */
const positional = v => v.length > 0 && v.every(x => /^\d+$/.test(x));
/** @param {string} type @param {string} text @param {string} fmt */
function textComp(type, text, fmt) {
  const v = varsOf(text), c = /** @type {any} */ ({ type, ...(type === "HEADER" ? { format: "TEXT" } : {}), text });
  const key = type === "HEADER" ? "header_text" : "body_text";
  if (v.length) c.example = fmt === "POSITIONAL" ? { [key]: type === "HEADER" ? v.map(() => "пример") : [v.map(() => "пример")] } : { [key + "_named_params"]: v.map(n => ({ param_name: n, example: "пример" })) };
  return c;
}
/** шапка-файл: { format: "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION" } — пример, как у поданного шаблона (у места примера нет) @param {any} h */
function mediaComp(h) {
  const format = String(h.format || "IMAGE").toUpperCase();
  return { type: "HEADER", format, ...(format === "LOCATION" ? {} : { example: h.example || { header_handle: ["4::stub-header-" + format.toLowerCase()] } }) };
}
/** кнопка: строка — быстрый ответ; ссылка с {{1}} — с примером, как требует Meta @param {any} b */
function btnOf(b) {
  if (typeof b === "string") return { type: "QUICK_REPLY", text: b };
  const x = { ...b, type: String(b.type || "QUICK_REPLY").toUpperCase() };
  if (x.type === "URL" && URL_VAR.test(String(x.url || "")) && !x.example) x.example = [String(x.url).replace(URL_VAR, "example")];
  return x;
}
const URL_VAR = /\{\{\s*1\s*\}\}/;
let tplSeq = 0;
/** @param {any} t */
function tplOf(t) {
  const comps = t.components ? JSON.parse(JSON.stringify(t.components)) : null;
  const bodyText = comps ? ((comps.find((/** @type {any} */ c) => String(c.type).toUpperCase() === "BODY") || {}).text || "") : t.body || "";
  const fmt = String(t.parameter_format || (positional(varsOf(bodyText)) ? "POSITIONAL" : "NAMED")).toUpperCase();
  const components = comps || [
    ...(t.header ? [typeof t.header === "string" ? textComp("HEADER", t.header, fmt) : mediaComp(t.header)] : []), textComp("BODY", t.body || "", fmt), ...(t.footer ? [{ type: "FOOTER", text: t.footer }] : []),
    ...(t.buttons && t.buttons.length ? [{ type: "BUTTONS", buttons: t.buttons.map(btnOf) }] : [])];
  const { body, header, footer, buttons, lang, quality, ...rest } = t;
  return { ...rest, id: String(t.id || 7100000000000000 + ++tplSeq), name: String(t.name), language: String(t.language || lang || "ru"), status: String(t.status || "APPROVED").toUpperCase(),
    category: String(t.category || "UTILITY").toUpperCase(), parameter_format: fmt, components, quality_score: t.quality_score || { score: quality || "UNKNOWN" }, rejected_reason: t.rejected_reason || "NONE" };
}
/** текст и переменные части шаблона (BODY или HEADER) @param {any} tpl @param {string} type */
function partOf(tpl, type) {
  const c = (tpl.components || []).find((/** @type {any} */ x) => String(x.type).toUpperCase() === type && (type !== "HEADER" || String(x.format || "TEXT").toUpperCase() === "TEXT"));
  return c ? { text: String(c.text || ""), vars: varsOf(c.text) } : null;
}

// ---- сверка отправки шаблона с одобренным, как у Meta: шапка (текст или файл), тело, кнопки. Находки проверки шага 1, 09.11.2026:
// именованный параметр дважды проходил и оставлял переменную пустой («Вы записаны 11 ноября в . Ждём вас.»), шапка-картинка не
// узнавалась (верная отправка прежнего кода рассылок получала отказ, а без картинки — проходила), кнопка-ссылка с {{1}} проходила без
// параметра. Настоящая Meta во всех этих случаях отказывает — заглушка тоже
const PARAM_SUB = /** @type {Record<string, string>} */ ({ url: "URL", quick_reply: "QUICK_REPLY", copy_code: "COPY_CODE", flow: "FLOW", catalog: "CATALOG" });
/** ошибка — Response, иначе null; в out — текст, который увидит клиент (text), файл шапки (header), ссылки кнопок (buttons)
 * @param {any} tpl @param {any[]} comps @param {any} out */
function checkParams(tpl, comps, out) {
  /** @param {string} t */
  const ofType = t => comps.filter(c => c && String(c.type).toLowerCase() === t);
  /** @param {string} t @returns {any[]} */
  const params = t => (ofType(t)[0] || {}).parameters || [];
  /** @param {string} t */
  const comp = t => (tpl.components || []).find((/** @type {any} */ c) => String(c.type).toUpperCase() === t);
  const named = tpl.parameter_format === "NAMED", hdr = comp("HEADER");
  // шапка-файл (картинка, видео, документ, место): ровно один параметр того же вида со ссылкой или id (у места — координаты)
  const media = hdr && String(hdr.format || "TEXT").toUpperCase() !== "TEXT" ? String(hdr.format).toLowerCase() : "";
  if (media) {
    const got = params("header");
    if (!got.length) return errOf(131008, { details: `header: parameter of type ${media} is missing` });
    if (got.length > 1) return errOf(132000, { details: `header: number of params (${got.length}) does not match the expected number of params (1)` });
    const p = got[0] || {}, v = p[media] || {};
    if (String(p.type || "").toLowerCase() !== media) return errOf(132012, { details: `header: parameter type (${p.type || "—"}) does not match the format in the template (${media})` });
    const ref = media === "location" ? (v.latitude != null && v.longitude != null ? v.latitude + "," + v.longitude : "") : String(v.link || v.id || "");
    if (!ref) return errOf(131008, { details: `header: ${media} needs ${media === "location" ? "latitude and longitude" : "link or id"}` });
    out.header = ref;
  }
  /** @type {Record<string, string>} */ const filled = {};
  for (const [type, label] of [["BODY", "body"], ["HEADER", "header"]]) {
    if (type === "HEADER" && media) continue;
    const part = partOf(tpl, type), got = params(label);
    if (!part) { if (got.length) return errOf(132000, { details: `${label}: number of localizable_params (${got.length}) does not match the expected number of params (0)` }); continue; }
    if (got.length !== part.vars.length) return errOf(132000, { details: `${label}: number of localizable_params (${got.length}) does not match the expected number of params (${part.vars.length})` });
    for (let i = 0; i < got.length; i++) {
      const p = got[i] || {}, key = named ? String(p.parameter_name || "") : part.vars[i], kind = String(p.type || "text").toLowerCase();
      // в тексте — только text (в теле ещё currency и date_time с fallback_value); картинка вместо текста — не тот вид (имени у неё нет)
      if (!(kind === "text" || (type === "BODY" && (kind === "currency" || kind === "date_time")))) return errOf(132012, { details: `${label}: parameter ${i + 1} of type ${kind} does not match the format in the template (text)` });
      if (named && !part.vars.includes(key)) return errOf(132000, { details: `${label}: parameter name (${key || "—"}) is missing or invalid` });
      if (named && (label + ":" + key) in filled) return errOf(132000, { details: `${label}: parameter name (${key}) is given twice` });
      const txt = kind === "text" ? String(p.text ?? "") : String((p[kind] || {}).fallback_value ?? "");
      if (!txt.trim()) return errOf(131008, { details: `${label}: parameter (${key}) text is empty` });
      if (/[\n\t]| {5,}/.test(txt)) return errOf(100, { details: "Param text cannot have new-line/tab characters or more than 4 consecutive spaces" });
      filled[label + ":" + key] = txt;
    }
    const miss = part.vars.find(v => !((label + ":" + v) in filled));
    if (miss) return errOf(131008, { details: `${label}: parameter (${miss}) is missing` });
    if (type === "BODY") out.text = part.text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => filled["body:" + k] ?? "");
  }
  // кнопки: { type: "button", sub_type, index } — вид как у кнопки шаблона с этим номером; ссылке с {{1}} — ровно один текст,
  // ссылке без переменной параметры не нужны, быстрому ответу — только payload (необязателен)
  const btns = /** @type {any[]} */ ((comp("BUTTONS") || {}).buttons || []), urlAt = /** @type {Record<number, string>} */ ({}), seen = new Set();
  for (const c of ofType("button")) {
    const i = Number(c.index), btn = Number.isInteger(i) ? btns[i] : null, sub = String(c.sub_type || "").toLowerCase(), bt = btn ? String(btn.type).toUpperCase() : "", ps = c.parameters || [];
    if (!btn) return errOf(131009, { details: `button: index (${c.index ?? "—"}) is not valid` });
    if (PARAM_SUB[sub] !== bt) return errOf(131009, { details: `button at index ${i} is of type ${bt}, not ${sub || "—"}` });
    if (seen.has(i)) return errOf(132000, { details: `button at index ${i} is given twice` });
    seen.add(i);
    if (bt === "URL") {
      if (!URL_VAR.test(String(btn.url || ""))) { if (ps.length) return errOf(132000, { details: `button at index ${i} of type Url does not require parameters` }); continue; }
      if (ps.length !== 1) return errOf(132000, { details: `button at index ${i}: number of params (${ps.length}) does not match the expected number of params (1)` });
      const p = ps[0] || {}, t = String(p.text ?? "");
      if (String(p.type || "text").toLowerCase() !== "text") return errOf(132012, { details: `button at index ${i}: parameter must be text` });
      if (!t.trim()) return errOf(131008, { details: `button at index ${i}: parameter text is empty` });
      urlAt[i] = String(btn.url).replace(URL_VAR, t);
    } else if (bt === "QUICK_REPLY" && ps.some((/** @type {any} */ p) => !p || String(p.type).toLowerCase() !== "payload")) return errOf(132012, { details: `button at index ${i}: quick reply takes only payload` });
  }
  /** @type {string[]} */ const urls = [];
  for (let i = 0; i < btns.length; i++) {
    if (String(btns[i].type).toUpperCase() !== "URL") continue;
    if (URL_VAR.test(String(btns[i].url || "")) && !(i in urlAt)) return errOf(131008, { details: `button at index ${i} (url): parameter is missing` });
    urls.push(i in urlAt ? urlAt[i] : String(btns[i].url || ""));
  }
  if (urls.length) out.buttons = urls;
  return null;
}

// ---- правила отказов: { on?, times?, status?, code?, subcode?, message?, details?, userMsg?, raw?, hang?, drop?, lost?, delay? }
// on — «POST /messages» (метод и конец пути; без метода — любой), RegExp по «МЕТОД путь?запрос» или функция (rec) → да/нет; без on — все запросы.
// Без lost Meta запрос не выполнила: status/code/raw — отказ, hang — «висит» до AbortSignal, drop — обрыв, delay — ответ позже (оборвали
// во время задержки — не отправлено). lost — Meta выполнила, а ответ потерян; сочетается с остальными: { status: 500, lost: true } —
// отправлено, а мы видим 500; { hang: true, lost: true } и { delay, lost: true } с AbortSignal — отправлено, а у нас срок
/** @param {any} r @param {any} rec */
function hits(r, rec) {
  const on = r.on;
  if (on == null || on === true) return true;
  if (typeof on === "function") return !!on(rec);
  const q = rec.url.includes("?") ? "?" + rec.url.split("?").slice(1).join("?") : "";
  if (on instanceof RegExp) return on.test(rec.method + " " + rec.path + q);
  const s = String(on), sp = /^[A-Z]+ /.test(s) ? s.indexOf(" ") : -1, m = sp > 0 ? s.slice(0, sp) : "*", p = sp > 0 ? s.slice(sp + 1) : s;
  return (m === "*" || m === rec.method) && rec.path.endsWith(p);
}
/** ответ отказа по правилу: код ответа без кода ошибки — как Graph при сбое (500 → 131000, 503 → 2) @param {any} r */
function failOf(r) {
  if (r.raw !== undefined) return new Response(String(r.raw), { status: r.status || 502, headers: { "content-type": "text/html" } });
  const code = r.code ?? (r.status === 500 ? 131000 : r.status === 503 ? 2 : r.status >= 500 ? 1 : 100);
  return errOf(code, { status: r.status, message: r.message, subcode: r.subcode, details: r.details, userMsg: r.userMsg });
}

/**
 * Заглушка Graph: ставит net.graphReply и net.meta, возвращает состояние st (его можно менять по ходу проверки).
 * Первая компания — из o (cid, pnid, wabaId, token, display, name, phone, waba, apps, numbers, templates, unknownFields), следующие — st.add({...}).
 * token — ключ, который принимает Graph для этой компании: по умолчанию META.token у первой, ключ metaIds(cid) у компании с cid, свой
 * вымышленный у остальных; token: null (или anyToken: true) — любой ключ. checkTemplates: false — шаблоны при отправке не сверяются.
 * @param {any} net объект net из test/harness.mjs
 * @param {any} [o]
 */
export function metaStub(net, o = {}) {
  /** @type {any} */
  const st = {
    accounts: /** @type {any[]} */ ([]), fails: /** @type {any[]} */ ([]),
    sent: /** @type {any[]} */ ([]), created: /** @type {any[]} */ ([]), deleted: /** @type {string[]} */ ([]), subscribed: /** @type {any[]} */ ([]), seq: 0,
    checkTemplates: o.checkTemplates !== false, pageMax: o.pageMax || 100, hangMs: o.hangMs || 20000,
    /** ещё одна компания (свой номер, WABA, ключ) @param {any} a */
    add(a = {}) { const acc = account(a); st.accounts.push(acc); return acc; },
    /** правило отказа @param {any} rule */
    fail(rule) { st.fails.push({ ...rule, left: rule.times ?? Infinity }); return st; },
    /** шаблон по имени (и языку) в любой компании @param {string} name @param {string} [lang] */
    template(name, lang) { for (const a of st.accounts) { const t = a.templates.find((/** @type {any} */ x) => x.name === name && (!lang || x.language === lang)); if (t) return t; } return null; },
    /** добавить шаблон (сокращённая запись или вид Graph) первой компании или указанной @param {any} t @param {any} [acc] */
    addTemplate(t, acc) { const x = tplOf(t); (acc || st.accounts[0]).templates.push(x); return x; },
    /** решение Meta по шаблону: статус, причина отказа, смена категории, качество
     * @param {string} name @param {string} status @param {{ lang?: string, reason?: string, category?: string, quality?: string }} [x] */
    review(name, status, x = {}) {
      const t = st.template(name, x.lang);
      if (!t) throw new Error("заглушка Meta: нет шаблона " + name);
      t.status = String(status).toUpperCase(); t.rejected_reason = x.reason || (t.status === "REJECTED" ? "INVALID_FORMAT" : "NONE");
      if (x.category && x.category.toUpperCase() !== t.category) { t.previous_category = t.category; t.category = x.category.toUpperCase(); }
      if (x.quality) t.quality_score = { score: x.quality.toUpperCase() };
      return t;
    }
  };
  /** @param {any} a */
  // ключ проверяется всегда: первая компания — META.token (его же пишет metaEnv), компания по cid — её ключ из metaIds, остальные —
  // свой вымышленный ключ. Любой ключ — только явно (token: null или anyToken: true). Находка проверки шага 1, 09.11.2026: заглушка
  // принимала любой ключ, и код, читающий номер или WABA Winchester чужим ключом (общий WA_TOKEN, WA_TOKEN другой компании), проходил проверки
  function account(a) {
    const n = st.accounts.length, first = !n, base = a.cid ? metaIds(a.cid) : first ? META : null;
    const pnid = String(a.pnid || (base ? base.pnid : 900000 + n)), wabaId = String(a.wabaId || (base ? base.waba : 800000 + n));
    const display = a.display || (base ? base.display : `+7 700 000 9${n % 10} 00`), name = a.name || (base ? base.name : META.name);
    const token = a.token === null || a.anyToken ? "" : String(a.token || (base ? base.token : "test-meta-token-acc" + n));
    return {
      pnid, wabaId, token, display, unknown: a.unknownFields || [],
      phone: { display_phone_number: display, verified_name: name, quality_rating: "GREEN", whatsapp_business_manager_messaging_limit: "TIER_250", status: "CONNECTED", name_status: "APPROVED",
        code_verification_status: "VERIFIED", platform_type: "CLOUD_API", account_mode: "LIVE", throughput: { level: "STANDARD" }, is_official_business_account: false, ...(a.phone || {}) },
      waba: { name, account_review_status: "APPROVED", business_verification_status: "verified", currency: "USD", timezone_id: "137", message_template_namespace: "stub_ns_" + wabaId,
        ownership_type: "SELF", country: "KZ", ...(a.waba || {}) },
      apps: a.apps ? a.apps.slice() : [{ whatsapp_business_api_data: { id: META.app, link: "https://www.facebook.com/games/?app_id=" + META.app, name: "Bot Flow (тест)" } }],
      numbers: a.numbers || null, templates: (a.templates || []).map(tplOf)
    };
  }
  st.add(o);
  for (const [k, f] of /** @type {[string, (a: any) => any][]} */ ([["pnid", a => a.pnid], ["wabaId", a => a.wabaId], ["token", a => a.token], ["display", a => a.display], ["phone", a => a.phone],
    ["waba", a => a.waba], ["apps", a => a.apps], ["numbers", a => a.numbers], ["templates", a => a.templates]])) Object.defineProperty(st, k, { get: () => f(st.accounts[0]), enumerable: true });
  for (const r of [].concat(o.fail || [])) st.fail(r);
  if (o.hang) st.fail({ on: o.hang === true ? undefined : o.hang, hang: true });

  /** запрос «висит»: ответа нет, пока его не оборвут по AbortSignal (как настоящий fetch — ошибка signal.reason). Без срока — через
   * hangMs ошибка «без срока» и пометка rec.noSignal: проверка не зависает навсегда. Что код поставил срок, видно по rec.aborted
   * @param {any} rec @param {any} init */
  const hang = (rec, init) => new Promise((_, rej) => {
    const sig = init && init.signal;
    /** @type {any} */ let tm = null;
    const abort = () => { rec.aborted = true; if (tm) clearTimeout(tm); rej(sig.reason ?? new DOMException("The operation was aborted", "AbortError")); };
    if (sig && sig.aborted) return abort();
    if (sig) sig.addEventListener("abort", abort, { once: true }); else rec.noSignal = true;
    tm = setTimeout(() => { if (sig) sig.removeEventListener("abort", abort); rej(new TypeError(sig ? `заглушка Meta: запрос висел дольше ${st.hangMs} мс` : "заглушка Meta: запрос без срока (AbortSignal) висел бы вечно")); }, st.hangMs);
  });
  /** @param {number} ms @param {any} init */
  const pause = (ms, init) => new Promise((res, rej) => { const sig = init && init.signal, tm = setTimeout(res, ms); if (sig) sig.addEventListener("abort", () => { clearTimeout(tm); rej(sig.reason); }, { once: true }); });

  /** @param {string} url @param {any} init @param {any} rec */
  async function reply(url, init, rec) {
    const u = new URL(url);
    if (!rec.path) rec.path = u.pathname.replace(/^\/v\d+\.\d+(?=\/|$)/, "") || "/"; // запись не из test/harness.mjs
    if (!rec.query) rec.query = Object.fromEntries(u.searchParams);
    // номер запроса (из него — wamid) — при записи, до задержки: одновременные отправки с delay получали один wamid (номер брался из
    // длины net.graph уже после задержки), и отчёты о доставке и отметки двух клиентов сливались (находка проверки шага 1, 09.11.2026).
    // Обычно номер — место в net.graph, как у прежней заглушки; проверка обрезала net.graph — номер всё равно не повторяется
    rec.seq = st.seq = Math.max(net.graph.indexOf(rec) + 1, st.seq + 1);
    const rule = st.fails.find((/** @type {any} */ r) => r.left > 0 && hits(r, rec));
    if (rule && --rule.left <= 0) st.fails.splice(st.fails.indexOf(rule), 1);
    if (!rule) return route(u, rec);
    // lost — Meta запрос выполнила (сообщение ушло и записано в st.sent, шаблон подан), а до нас дошёл не её ответ: с кодом ответа или
    // raw — этот отказ, с hang — «висит», с delay — срок или обрыв, одно lost — обрыв. Поэтому route() — до любого из них. Находка
    // второй проверки шага 1, 09.11.2026: route() шёл после отказа, и { status: 500, lost: true } ничего не отправлял — двойную платную
    // отправку (5xx или срок после того, как Meta приняла шаблон, и повтор вслепую) было не показать. Без lost Meta до отправки не дошла
    if (rule.lost) route(u, rec); // отклонённое Meta (не тот шаблон, ключ) и с lost не отправлено — ответ всё равно по правилу
    if (rule.hang) return hang(rec, init);
    if (rule.drop) throw new TypeError("Network connection lost.");
    if (rule.delay) await pause(rule.delay, init); // ответ с задержкой (одновременные запросы перекрываются), дальше — как обычно или отказ
    if (rule.code !== undefined || rule.status !== undefined || rule.raw !== undefined || !(rule.lost || rule.delay)) return failOf(rule);
    if (rule.lost) throw new TypeError("Network connection lost."); // Meta запрос выполнила, а ответ до нас не дошёл
    return route(u, rec);
  }

  /** @param {URL} u @param {any} rec */
  function route(u, rec) {
    const ver = (u.pathname.match(/^\/v\d+\.\d+/) || [""])[0], parts = rec.path.split("/").filter(Boolean), q = rec.query, m = rec.method;
    const bearer = (/^Bearer\s+(.+)$/i.exec(rec.auth || "") || [])[1] || "", token = bearer || q.access_token || "";
    if (!token) return errOf(104);
    rec.tokenVia = bearer ? "header" : "query"; // ключ в адресе попадает в журналы — проверки шагов плана видят, как он ушёл
    const id = parts[0] || "", byPhone = st.accounts.find((/** @type {any} */ a) => a.pnid === id), byWaba = st.accounts.find((/** @type {any} */ a) => a.wabaId === id), acc = byPhone || byWaba;
    const kind = m === "GET" ? "get" : m === "DELETE" ? "delete" : "post";
    if (!acc) return noObject(kind, id);
    if (acc.token && token !== acc.token) return st.accounts.some((/** @type {any} */ a) => a.token && a.token === token) ? noObject(kind, id) : errOf(190); // ключ другой компании — объект «не виден», как у Graph
    const edge = parts.slice(1).join("/");
    if (byPhone) {
      if (!edge && m === "GET") { const r = pick({ id: acc.pnid, ...acc.phone }, q.fields, PHONE_FIELDS, PHONE_DEFAULT, "WhatsAppBusinessPhoneNumber", acc.unknown); return r.err || J(r.out); }
      if (edge === "messages" && m === "POST") return send(acc, rec);
      return noObject(kind, id);
    }
    if (!edge && m === "GET") { const r = pick({ id: acc.wabaId, ...acc.waba }, q.fields, WABA_FIELDS, WABA_DEFAULT, "WhatsAppBusinessAccount"); return r.err || J(r.out); }
    if (edge === "subscribed_apps") {
      if (m === "GET") return J({ data: JSON.parse(JSON.stringify(acc.apps)) });
      st.subscribed.push({ method: m, waba: acc.wabaId });
      if (m === "POST") { if (!acc.apps.some((/** @type {any} */ x) => x.whatsapp_business_api_data && x.whatsapp_business_api_data.id === META.app)) acc.apps.push({ whatsapp_business_api_data: { id: META.app, link: "https://www.facebook.com/games/?app_id=" + META.app, name: "Bot Flow (тест)" } }); return J({ success: true }); }
      if (m === "DELETE") { acc.apps.length = 0; return J({ success: true }); }
    }
    if (edge === "phone_numbers" && m === "GET") {
      const list = acc.numbers || [{ id: acc.pnid, ...Object.fromEntries(["display_phone_number", "verified_name", "quality_rating", "code_verification_status", "platform_type", "throughput", "status", "name_status"].filter(k => acc.phone[k] !== undefined).map(k => [k, acc.phone[k]])) }];
      return J({ data: JSON.parse(JSON.stringify(list)), paging: { cursors: { before: "QVFIUmJl", after: "QVFIUmFm" } } });
    }
    if (edge === "message_templates") {
      if (m === "GET") return list(acc, q, ver, token);
      if (m === "POST") return create(acc, rec);
      if (m === "DELETE") {
        const name = String(q.name || ""), hsm = String(q.hsm_id || ""), keep = acc.templates.filter((/** @type {any} */ t) => !(t.name === name && (!hsm || t.id === hsm)));
        if (!name || keep.length === acc.templates.length) return errOf(100, { message: "Message template not found" });
        acc.templates = keep; st.deleted.push(name);
        return J({ success: true });
      }
    }
    return noObject(kind, id);
  }

  // список шаблонов WABA страницами: limit (Graph по умолчанию 25), не больше pageMax; курсор after; next — полный адрес следующей
  // страницы с параметрами запроса и ключом access_token, как у Graph (и когда ключ пришёл заголовком). Находка второй проверки шага 1,
  // 09.11.2026: заглушка ключ из next убирала — код, который кладёт next целиком в KV, журнал или ответ пульту, проходил бы проверки,
  // а на боевом ключ WA_TOKEN_<ID> оказался бы там; хранить можно только курсор after. Ключ в next — по поведению Graph, для списка
  // шаблонов вживую не проверено. Фильтры запроса (name, status, category) заглушка не применяет — код должен отбирать сам
  /** @param {any} acc @param {any} q @param {string} ver @param {string} token ключ, с которым пришёл запрос */
  function list(acc, q, ver, token) {
    const size = Math.max(1, Math.min(+q.limit || 25, st.pageMax)), cur = (/** @type {string} */ s) => Buffer.from("tpl:" + s).toString("base64");
    const from = q.after ? +(Buffer.from(String(q.after), "base64").toString().replace(/^tpl:/, "")) || 0 : 0, page = acc.templates.slice(from, from + size), to = from + page.length;
    /** @type {any[]} */ const data = [];
    for (const t of page) { const r = pick(t, q.fields, TPL_FIELDS, TPL_DEFAULT, "WhatsAppMessageTemplate"); if (r.err) return r.err; data.push(r.out); }
    const next = to < acc.templates.length ? (() => { const n = new URL(`https://graph.facebook.com${ver}/${acc.wabaId}/message_templates`); n.searchParams.set("access_token", token); for (const [k, v] of Object.entries(q)) if (k !== "after" && k !== "access_token") n.searchParams.set(k, String(v)); n.searchParams.set("limit", String(size)); n.searchParams.set("after", cur(String(to))); return n.toString(); })() : "";
    return J({ data, ...(page.length ? { paging: { cursors: { before: cur(String(from)), after: cur(String(to)) }, ...(next ? { next } : {}) } } : {}) });
  }

  // подача шаблона, с теми правилами Meta, на которых спотыкаются тексты сценариев: имя — строчные латинские, цифры, «_»; переменная
  // в начале или в конце текста — отказ (подкод 2388299); у каждой переменной — пример; то же имя на том же языке — отказ (2388024)
  /** @param {any} acc @param {any} rec */
  function create(acc, rec) {
    const b = rec.body && typeof rec.body === "object" ? rec.body : null;
    if (!b) return errOf(100, { message: "Invalid parameter", details: "тело запроса — не JSON" });
    const name = String(b.name || ""), lang = String(b.language || ""), cat = String(b.category || "").toUpperCase(), comps = Array.isArray(b.components) ? b.components : [];
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return errOf(100, { subcode: 2388042, userMsg: "Имя шаблона: только строчные латинские буквы, цифры и подчёркивание." });
    if (!lang) return errOf(100, { message: "The parameter language is required" });
    if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(cat)) return errOf(100, { message: "Invalid parameter", details: "category" });
    const body = comps.find((/** @type {any} */ c) => String(c.type).toUpperCase() === "BODY");
    if (!body || !String(body.text || "").trim()) return errOf(100, { message: "Message template 'components' param is missing expected field(s)" });
    const text = String(body.text), vars = varsOf(text), fmt = String(b.parameter_format || "positional").toUpperCase();
    if (/^\s*\{\{[^}]*\}\}/.test(text) || /\{\{[^}]*\}\}\s*$/.test(text)) return errOf(100, { subcode: 2388299, userMsg: "Variables can't be at the start or end of the template." });
    if (vars.length && fmt === "POSITIONAL" && (!positional(vars) || vars.some((v, i) => +v !== i + 1))) return errOf(100, { subcode: 2388043, userMsg: "Переменные позиционного шаблона — {{1}}, {{2}}… по порядку." });
    if (vars.length && fmt === "NAMED" && (positional(vars) || vars.some(v => !/^[a-z_][a-z0-9_]*$/.test(v)))) return errOf(100, { subcode: 2388043, userMsg: "Имена переменных — строчные латинские буквы, цифры и подчёркивание." });
    const ex = body.example || {};
    const have = fmt === "NAMED" ? new Set((ex.body_text_named_params || []).map((/** @type {any} */ p) => p && p.param_name)) : null;
    if (vars.length && (have ? vars.some(v => !have.has(v)) : !(Array.isArray(ex.body_text) && Array.isArray(ex.body_text[0]) && ex.body_text[0].length === vars.length)))
      return errOf(100, { subcode: 2388043, message: "Message template 'components' param is missing expected field(s)", userMsg: "У каждой переменной нужен пример." });
    if (acc.templates.some((/** @type {any} */ t) => t.name === name && t.language === lang)) return errOf(100, { subcode: 2388024, userMsg: "Content in this language already exists" });
    const t = tplOf({ name, language: lang, category: cat, parameter_format: fmt, components: comps, status: "PENDING" });
    acc.templates.push(t);
    st.created.push({ ...JSON.parse(JSON.stringify(b)), id: t.id, waba: acc.wabaId });
    return J({ id: t.id, status: "PENDING", category: cat });
  }

  // отправка: текст, шаблон (сверка с одобренным: имя и язык, статус, число и имена параметров, пустые и многострочные параметры),
  // прочие виды (файл, реакция, кнопки) — без проверки. Ответ — messages[0].id и message_status, как у Cloud API
  /** @param {any} acc @param {any} rec */
  function send(acc, rec) {
    const b = rec.body && typeof rec.body === "object" ? rec.body : null;
    if (!b || b.messaging_product !== "whatsapp") return errOf(100, { details: "messaging_product" });
    const to = String(b.to || "").replace(/\D/g, ""), type = String(b.type || "text");
    if (!/^\d{8,15}$/.test(to)) return errOf(100, { details: "to" });
    /** @type {any} */ const out = { to, type, pnid: acc.pnid, at: Date.now() };
    if (type === "text") {
      const t = String((b.text && b.text.body) || "");
      if (!t.trim() || t.length > 4096) return errOf(100, { details: "text.body" });
      out.text = t;
    } else if (type === "template") {
      const name = String((b.template && b.template.name) || ""), lang = String((b.template && b.template.language && b.template.language.code) || "");
      out.name = name; out.lang = lang;
      const comps = (b.template && b.template.components) || [];
      /** @param {string} type */
      const params = type => ((comps.find((/** @type {any} */ c) => String(c.type).toLowerCase() === type) || {}).parameters || []);
      out.params = params("body");
      if (st.checkTemplates) {
        const tpl = acc.templates.find((/** @type {any} */ t) => t.name === name && t.language === lang);
        if (tpl && tpl.status === "PAUSED") return errOf(132015);
        if (tpl && tpl.status === "DISABLED") return errOf(132016);
        if (!tpl || tpl.status !== "APPROVED") return errOf(132001, { details: `template name (${name}) does not exist in ${lang || "?"}` });
        const bad = checkParams(tpl, comps, out);
        if (bad) return bad;
      }
    }
    out.id = "wamid.out." + rec.seq; // номер записи запроса (reply), как у прежней заглушки отправки
    out.body = JSON.parse(JSON.stringify(b));
    st.sent.push(out);
    return J({ messaging_product: "whatsapp", contacts: [{ input: String(b.to), wa_id: to }], messages: [{ id: out.id, message_status: "accepted" }] });
  }

  net.meta = st;
  net.graphReply = (/** @type {string} */ url, /** @type {any} */ init, /** @type {any} */ rec) => reply(url, init || {}, rec || { url, method: String((init && init.method) || "GET").toUpperCase(), auth: "", body: null });
  return st;
}

// ---- подписанные вебхуки Meta (как waPost в test/harness.mjs и signal в test/platform.mjs): тело — как у Meta, подпись —
// x-hub-signature-256 секретом приложения (secret: null — без подписи, чтобы проверить отказ 403)
/** @param {any[]} changes @param {{ entryId?: string }} [o] */
function payload(changes, o = {}) {
  const signal = changes.some(c => c && c.field !== "messages"); // у сигналов WABA (шаблоны, аккаунт, качество) в записи есть время
  return { object: "whatsapp_business_account", entry: [{ id: String(o.entryId || META.waba), ...(signal ? { time: Math.floor(Date.now() / 1000) } : {}), changes }] };
}
/** событие из нескольких изменений @param {any} S сайт из mk() @param {string} path «/wa/<id>» @param {any[]} changes @param {{ secret?: string|null, entryId?: string }} [o] */
export function metaEvent(S, path, changes, o = {}) {
  const secret = o.secret === undefined ? META.secret : o.secret;
  return S.waPost(path, [], { ...(secret ? { secret } : {}), raw: JSON.stringify(payload(changes, o)) });
}
metaEvent.body = payload;
/** сигнал WABA: field — message_template_status_update, account_update, phone_number_quality_update…
 * @param {any} S @param {string} path @param {string} field @param {any} value @param {{ secret?: string|null, entryId?: string }} [o] */
export function metaSignal(S, path, field, value, o = {}) { return metaEvent(S, path, [{ field, value }], o); }
metaSignal.body = (/** @type {string} */ field, /** @type {any} */ value, /** @type {any} */ o) => payload([{ field, value }], o);

/** изменение «messages» с отчётами о доставке: { id, status, to, code?, details?, ts?, … } → вид Meta (recipient_id, timestamp, errors)
 * @param {any[]} statuses @param {{ pnid?: string, display?: string }} [o] */
function statusChange(statuses, o = {}) {
  const list = statuses.map(s => {
    const { to, code, title, message, details, ts, ...rest } = s || {};
    return { ...rest, id: String(s.id || "wamid.out.0"), status: String(s.status || "sent"), timestamp: String(ts ?? s.timestamp ?? Math.floor(Date.now() / 1000)), recipient_id: String(to ?? s.recipient_id ?? ""),
      ...(code ? { errors: [{ code, title: title || ERR_TEXT[code] || "Error", message: message || title || ERR_TEXT[code] || "Error", error_data: { details: details || ERR_TEXT[code] || "" } }] } : {}) };
  });
  return { field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: String(o.display || META.display).replace(/\D/g, ""), phone_number_id: String(o.pnid || META.pnid) }, statuses: list } };
}
/** отчёты о доставке номера компании @param {any} S @param {string} path @param {any[]} statuses @param {{ secret?: string|null, pnid?: string, display?: string, entryId?: string }} [o] */
export function metaStatuses(S, path, statuses, o = {}) { return metaEvent(S, path, [statusChange(statuses, o)], o); }
metaStatuses.body = (/** @type {any[]} */ statuses, /** @type {any} */ o = {}) => payload([statusChange(statuses, o)], o);

let inSeq = 0;
/** входящие сообщения на номер компании (с entry.id — WABA и metadata — номер): { from, type, text… }, имена — names
 * @param {any} S @param {string} path @param {any[]|any} msgs @param {{ secret?: string|null, pnid?: string, display?: string, entryId?: string, names?: Record<string, string> }} [o] */
export function metaMessages(S, path, msgs, o = {}) {
  const list = (Array.isArray(msgs) ? msgs : [msgs]).map(m => ({ id: "wamid.in.m" + ++inSeq, timestamp: String(Math.floor(Date.now() / 1000)), ...m }));
  const value = { messaging_product: "whatsapp", metadata: { display_phone_number: String(o.display || META.display).replace(/\D/g, ""), phone_number_id: String(o.pnid || META.pnid) },
    contacts: [...new Set(list.map(m => m.from))].map(f => ({ wa_id: f, profile: { name: (o.names || {})[f] || "" } })), messages: list };
  return metaEvent(S, path, [{ field: "messages", value }], o);
}
