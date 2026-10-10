// Обвязка для проверок на заглушках: хранилище KV в памяти (со списком ключей и метаданными), подменённые Gemini, Telegram, Meta, Green-API и Altegio.
// Используется в test/platform.mjs и в локальном сервере для проверки страниц в браузере (test/devserver.mjs).
import "./clock.mjs"; // до загрузки бота: проверки идут по одним и тем же часам
import worker from "../worker.js";
import { createHmac } from "node:crypto";

export { worker };
export const wait = ms => new Promise(s => setTimeout(s, ms));

// ---- KV как в Cloudflare: get/put/delete/list, метаданные ключа, срок хранения
export function mkKV() {
  const mem = new Map(), meta = new Map(), ttl = new Map(), ops = { get: 0, put: 0, del: 0, list: 0 };
  const fail = { put: null, get: null, list: null };
  const strict = { on: !!process.env.KV_STRICT, last: new Map(), hits: 0 }; // строгий режим: вторая запись того же ключа за секунду — отказ 429, как у настоящего KV
  const tooFast = k => { if (!strict.on) return false; const now = performance.now(), prev = strict.last.get(k); if (prev !== undefined && now - prev < 1000) { strict.hits++; return true; } strict.last.set(k, now); return false; };
  const api = {
    get: async k => { ops.get++; if (fail.get && fail.get(k)) throw new Error("KV GET failed: 500 Internal Server Error"); return mem.get(k) ?? null; },
    put: async (k, v, o) => {
      ops.put++;
      if ((fail.put && fail.put(k)) || tooFast(k)) throw new Error("KV PUT failed: 429 Too Many Requests");
      if (typeof v !== "string") throw new Error("KV PUT: значение должно быть строкой");
      if (o && o.metadata !== undefined && JSON.stringify(o.metadata).length > 1024) throw new Error("KV PUT failed: 413 metadata too large");
      if (o && o.expirationTtl !== undefined && !(o.expirationTtl >= 60)) throw new Error("KV PUT failed: 400 Invalid expiration_ttl");
      mem.set(k, v);
      if (o && o.metadata !== undefined) meta.set(k, JSON.parse(JSON.stringify(o.metadata))); else meta.delete(k); // запись без metadata её стирает — как в настоящем KV
      if (o && o.expirationTtl) ttl.set(k, o.expirationTtl); else ttl.delete(k);
    },
    delete: async k => { ops.del++; if (tooFast(k)) throw new Error("KV DELETE failed: 429 Too Many Requests"); mem.delete(k); meta.delete(k); ttl.delete(k); },
    list: async ({ prefix = "", limit = 1000, cursor } = {}) => {
      ops.list++;
      if (fail.list && fail.list(prefix)) throw new Error("KV LIST failed: 500");
      const all = [...mem.keys()].filter(k => k.startsWith(prefix)).sort(), from = cursor ? +cursor : 0, done = from + limit >= all.length;
      return { keys: all.slice(from, from + limit).map(name => meta.has(name) ? { name, metadata: meta.get(name) } : { name }), list_complete: done, ...(done ? {} : { cursor: String(from + limit) }) };
    }
  };
  return { api, mem, meta, ttl, ops, fail, strict, json: k => JSON.parse(mem.get(k) || "null") };
}

// ---- внешние сервисы
export const net = {
  ai: [],                      // очередь ответов ИИ: строка, число (код ошибки), Error или функция (тело запроса) → ответ. Последний ответ повторяется
  gemini: [], tg: [], graph: [], alt: [], other: [],
  tgStatus: 200,               // что отвечает Telegram
  graphReply: null,            // функция (url, init) → Response | null: свой ответ Meta (ошибка отправки, сведения о номере)
  altData: null,               // функция (loc) → { services, staff, category, times, dates } — расписание Altegio
  altRecords: [], altDeleted: [], altGone: [], altBusy: false, altGetFail: 0, altGetPlain: false, // altGetPlain — чтение записи «успешно», но без поля deleted (как может быть вживую); altGone — записи, удалённые администратором прямо в Altegio
  ga: [],                      // запросы к Green-API: { url, inst, op, token, body }
  gaState: "authorized",       // что отвечает getStateInstance
  gaSettings: {},              // настройки инстансов по номеру (getSettings/setSettings); как у настоящего инстанса, reset() их не стирает
  gaReply: null,               // функция (rec) → Response | null: свой ответ Green-API (ошибка отправки); может бросить исключение — «связь оборвалась»
  reset() { this.ai = []; this.gemini.length = 0; this.tg.length = 0; this.graph.length = 0; this.alt.length = 0; this.other.length = 0; this.tgStatus = 200; this.graphReply = null; this.altRecords.length = 0; this.altDeleted.length = 0; this.ga.length = 0; this.gaState = "authorized"; this.gaReply = null; }
};
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
export const D0 = iso(Date.now()), D1 = iso(Date.now() + 86400e3), D2 = iso(Date.now() + 2 * 86400e3);
const ALT_DEFAULT = () => ({
  services: [
    { id: 101, title: "Мужская стрижка", category_id: 1, price_min: 6000, price_max: 6000, active: 1, seance_length: 3600 },
    { id: 102, title: "Оформление бороды", category_id: 1, price_min: 4000, price_max: 5000, active: 1, seance_length: 1800 },
    { id: 103, title: "Детская стрижка", category_id: 1, price_min: 4000, price_max: 4000, active: 1, seance_length: 2700 }],
  category: [{ id: 1, title: "Барбершоп" }],
  staff: [{ id: 11, name: "Арман", bookable: true, specialization: "топ-барбер" }, { id: 12, name: "Ерлан", bookable: true, specialization: "барбер" }],
  times: { 0: ["09:30", "10:00", "11:00", "13:00"], 11: ["11:00", "13:00"], 12: ["09:30", "10:00"] }
});
function altStub(url, init) {
  const path = url.slice("https://api.alteg.io/api/v1".length), method = init.method || "GET";
  net.alt.push(method + " " + path);
  const loc = (path.match(/^\/[a-z_]+\/(\d+)/) || [])[1];
  const D = (net.altData && net.altData(loc)) || ALT_DEFAULT();
  if (D.down) return J({ success: false, data: null, meta: { message: "Server error" } }, 500);
  let m;
  if (/^\/book_services\/\d+/.test(path)) return J({ success: true, data: { events: [], services: D.services, category: D.category }, meta: [] });
  if (/^\/book_staff\/\d+/.test(path)) return J({ success: true, data: D.staff, meta: [] });
  if (/^\/book_dates\/\d+/.test(path)) return J({ success: true, data: { booking_days: {}, booking_dates: D.dates || [D1, D2], working_days: {}, working_dates: D.dates || [D1, D2] }, meta: [] });
  if ((m = path.match(/^\/book_times\/\d+\/(\d+)\/(\d{4}-\d{2}-\d{2})/))) {
    let t = (D.dates || [D1, D2]).includes(m[2]) ? D.times[m[1]] || [] : [];
    if (net.altBusy) { // занятое записями время у мастера не показываем (записи, удалённые администратором, время освобождают)
      const busy = net.altRecords.map((r, i) => ({ id: String(777001 + i), a: (r.appointments || [])[0] || {} })).filter(x => !net.altDeleted.includes(x.id) && !(net.altGone || []).includes(x.id) && String(x.a.staff_id) === m[1] && String(x.a.datetime || "").startsWith(m[2])).map(x => String(x.a.datetime).slice(11, 16));
      t = t.filter(x => !busy.includes(x));
    }
    return J({ success: true, data: t.map(x => ({ time: x, seance_length: 3600, sum_length: 3600, datetime: `${m[2]}T${x}:00+05:00` })), meta: [] });
  }
  if (/^\/book_check\/\d+/.test(path)) return J({ success: true, data: null, meta: { message: "Created" } }, 201);
  if (/^\/book_record\/\d+/.test(path) && method === "POST") {
    net.altRecords.push(JSON.parse(init.body));
    const id = 777000 + net.altRecords.length;
    return J({ success: true, data: [{ id: 1, record_id: id, record_hash: "hash" + id }], meta: [] }, 201);
  }
  if ((m = path.match(/^\/user\/records\/(\d+)\/(\w+)/)) && method === "DELETE") { net.altDeleted.push(m[1]); return new Response(null, { status: 204 }); }
  if ((m = path.match(/^\/user\/records\/(\d+)\/(\w+)/)) && method === "GET" && net.altGetFail) return J({ success: false, data: null, meta: { message: "Unauthorized" } }, net.altGetFail); // как будто чтение записи этим ключом недоступно
  if ((m = path.match(/^\/user\/records\/(\d+)\/(\w+)/)) && method === "GET" && net.altGetPlain) { // ответ без deleted, даже если запись удалена; мастер записи — из запроса
    const r = net.altRecords[+m[1] - 777001], sid = r && (r.appointments || [])[0] ? r.appointments[0].staff_id : 0, st = D.staff.find(x => x.id === sid);
    return J({ success: true, data: { id: +m[1], staff_id: sid, staff: st ? { id: st.id, name: st.name } : null }, meta: [] });
  }
  if ((m = path.match(/^\/user\/records\/(\d+)\/(\w+)/)) && method === "GET") return net.altDeleted.includes(m[1]) || (net.altGone || []).includes(m[1]) ? J({ success: false, data: null, meta: { message: "Запись не найдена" } }, 404) : J({ success: true, data: { id: +m[1], deleted: false }, meta: [] });
  return J({ success: false, data: null, meta: {} }, 404);
}
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.includes("generativelanguage.googleapis.com")) {
    const body = JSON.parse(init.body); net.gemini.push(body);
    let next = net.ai.length > 1 ? net.ai.shift() : net.ai[0];
    if (typeof next === "function") next = next(body);
    if (next === undefined) next = "Хорошо.";
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response("err", { status: next });
    return J({ candidates: [{ content: { parts: [{ text: next }] }, finishReason: "STOP" }] });
  }
  if (url.includes("api.telegram.org")) {
    if (init.body && typeof init.body !== "string") { const f = init.body, doc = f.get && f.get("document"); net.tg.push({ url: url.replace(/bot[^/]+/, "bot***"), doc: true, chat_id: f.get("chat_id"), caption: f.get("caption"), name: doc && doc.name, text: doc ? await doc.text() : "" }); return J({ ok: true, result: {} }); }
    const b = init.body ? JSON.parse(init.body) : {}; net.tg.push({ url: url.replace(/bot[^/]+/, "bot***"), ...b });
    return net.tgStatus === 200 ? J({ ok: true, result: {} }) : J({ ok: false, description: "err" }, net.tgStatus);
  }
  if (url.includes("graph.facebook.com")) {
    const rec = { url, method: init.method || "GET", auth: (init.headers || {}).authorization || "", body: init.body ? JSON.parse(init.body) : null }; net.graph.push(rec);
    const own = net.graphReply && net.graphReply(url, init, rec);
    if (own) return own;
    return J({ messaging_product: "whatsapp", messages: [{ id: "wamid.out." + net.graph.length }] });
  }
  if (url.startsWith("https://api.alteg.io/")) return altStub(url, init);
  const gm = /^https:\/\/[^/]*(?:green-api\.com|greenapi\.com)\/waInstance(\d+)\/(\w+)\/([^/?#]+)/.exec(url);
  if (gm) { // Green-API: {apiUrl}/waInstance{id}/{метод}/{token}
    const rec = { url, inst: gm[1], op: gm[2], token: gm[3], method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null }; net.ga.push(rec);
    const own = net.gaReply && net.gaReply(rec);
    if (own) return own;
    if (rec.op === "getStateInstance") return J({ stateInstance: net.gaState });
    const st = net.gaSettings[rec.inst] = net.gaSettings[rec.inst] || {};
    if (rec.op === "getSettings") return J({ wid: "77000000077@c.us", webhookUrl: "", webhookUrlToken: "", delaySendMessagesMilliseconds: 5000, incomingWebhook: "no", outgoingWebhook: "no", outgoingMessageWebhook: "no", outgoingAPIMessageWebhook: "no", stateWebhook: "no", ...st });
    if (rec.op === "setSettings") { Object.assign(st, rec.body); return J({ saveSettings: true }); }
    if (rec.op === "sendMessage" || rec.op === "sendFileByUrl") return J({ idMessage: "GA" + net.ga.length });
    return J({ message: "unknown method" }, 404);
  }
  net.other.push(url);
  throw new Error("unexpected fetch " + url);
};

// ---- один «сайт»: окружение воркера и помощники для запросов
export function mk(envExtra = {}) {
  const kv = mkKV();
  const env = { KV: kv.api, GEMINI_KEY: "stub-key", VERIFY_TOKEN: "vt", LEADS_KEY: "owner-key-123456", TG_TOKEN: "tgtoken", TG_CHAT: "1", MODEL: "gemini-3.5-flash-lite", ...envExtra };
  const pending = [], ctx = { waitUntil: p => pending.push(p) };
  const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
  const call = async (path, init = {}) => { const r = await worker.fetch(new Request("https://bot.test" + path, init), env, ctx); await settle(); return r; };
  // «браузер» с cookie
  const browser = () => {
    let cookie = "";
    const go = async (path, init = {}) => {
      const headers = { ...(init.headers || {}) };
      if (cookie) headers.cookie = cookie;
      if (init.method && init.method !== "GET" && !("origin" in headers)) headers.origin = "https://bot.test";
      const r = await call(path, { ...init, headers, redirect: "manual" });
      const sc = r.headers.get("set-cookie");
      if (sc) { const [pair] = sc.split(";"); const [k, v] = pair.split("="); cookie = /max-age=0/i.test(sc) || !v ? "" : `${k}=${v}`; }
      return r;
    };
    const post = (path, body, headers = {}) => go(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { go, post, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
  };
  let ipN = 0; const ips = new Map();
  const chat = async (c, sid, text, ai) => {
    if (ai !== undefined) net.ai = Array.isArray(ai) ? ai.slice() : [ai];
    if (!ips.has(sid)) ips.set(sid, `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`);
    const r = await call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ips.get(sid) }, body: JSON.stringify({ c, sid, text }) });
    return r.json();
  };
  // вебхук Meta: path — «/» (общий номер) или «/wa/<id>»; msgs — массив сообщений; secret — App secret для подписи
  let waId = 0;
  const waPost = async (path, msgs, { secret, pnid = "555000111", names = {}, raw } = {}) => {
    const list = (Array.isArray(msgs) ? msgs : [msgs]).map(m => ({ id: "wamid.in." + (++waId), ...m }));
    const body = raw || JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "77000000000", phone_number_id: pnid },
      contacts: [...new Set(list.map(m => m.from))].map(f => ({ wa_id: f, profile: { name: names[f] || "" } })), messages: list } }] }] });
    const headers = { "content-type": "application/json" };
    if (secret) headers["x-hub-signature-256"] = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    return call(path, { method: "POST", body, headers });
  };
  const waText = (path, from, text, o) => waPost(path, { from, type: "text", text: { body: text } }, o);
  const sentTo = to => net.graph.filter(g => g.body && g.body.to === to).map(g => (g.body.text && g.body.text.body) || (g.body.template && "[шаблон " + g.body.template.name + "]") || "");
  const hist = (ch, c, id) => kv.json(`h:${ch}:${c}:${id}`);
  const leads = c => kv.json("leads:" + c) || [];
  const cron = async at => { await worker.scheduled({ cron: "* * * * *", ...(at ? { scheduledTime: at } : {}) }, env, ctx); await settle(); }; // фоновая задача (раз в минуту); at — время запуска, мс
  return { env, kv, call, settle, browser, chat, waPost, waText, sentTo, hist, leads, cron };
}

// ---- счёт проверок
export const T = { pass: 0, fail: 0, failed: [] };
export function ok(name, cond, info = "") {
  if (cond) { T.pass++; if (process.env.SHOW) console.log("  ok   " + name); }
  else { T.fail++; T.failed.push(name); console.log("  FAIL " + name + (info ? "  → " + String(info).slice(0, 1500) : "")); }
  return !!cond;
}
export const section = s => { if (process.env.SHOW) console.log("\n== " + s); };
