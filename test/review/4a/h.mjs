// Обвязка для независимой проверки (review4a). Сети нет: KV, Gemini, Telegram, Meta, Altegio — заглушки.
// Worker импортируется по абсолютному пути. WORKER=<путь> — прогнать на другой версии.
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";

export const DIR = import.meta.dirname;
export const SRC = process.env.WORKER || new URL("../../../worker.js", import.meta.url).pathname;

// ---- управляемые часы (только Date.now; таймеры настоящие)
export const T = { real: Date.now.bind(Date), fake: null };
Date.now = () => (T.fake ?? T.real());
// время по Астане (UTC+5)
export const at = (y, mo, d, hh, mm = 0, ss = 0) => { T.fake = Date.UTC(y, mo - 1, d, hh - 5, mm, ss); return T.fake; };
export const tick = ms => { T.fake = (T.fake ?? T.real()) + ms; };
at(2026, 10, 3, 12, 0); // по умолчанию: суббота 3 октября 2026, 12:00 по Астане

const worker = (await import(SRC)).default;

// ---- копия worker.js с экспортом внутренних функций (для таблиц по отдельным функциям)
export async function internals() {
  const names = ["think", "tagFields", "tagField", "altDateOf", "hm", "altWhen", "nameForms", "samePerson", "exactName", "caseName", "altSay", "altLabel", "altFlat",
    "ALT_CLAIM", "ALT_CHANGE", "ALT_NEG", "ALT_WANT_CHANGE", "altOverLimit", "altCount", "altLimKeys", "ipKey", "noteDue", "mergeProfile", "detectLang", "checkReply",
    "altPickServices", "altPickStaff", "normPhone", "findPhone", "maskPhones", "redact", "CLIENTS", "altCache", "lastNote", "wantsHuman", "nameKey", "altDay", "isoDay"];
  const p = DIR + "/worker_x.mjs";
  const src = readFileSync(SRC, "utf8"), have = names.filter(n => new RegExp("(^|\\n)(async function|function|const|let) " + n + "\\b").test(src)); // имён, которых в новой версии нет, не экспортируем
  const compat = /\nfunction altClaims\b/.test(src) ? "\nexport const altFlat = s => { const c = altClaims(s); return (c.book ? \"[утверждает: записала] \" : \"\") + (c.change ? \"[утверждает: отменила/перенесла] \" : \"\") + \"остаток: \" + c.keep; };\nexport { altClaims };\n" : "";
  writeFileSync(p, src + "\nexport { " + have.join(", ") + " };\n" + compat);
  return import(p + "?v=" + Math.random());
}

// ---- KV
export const mem = new Map();
export const kvLog = [];             // [op, key]
export const KVFAIL = { put: null, get: null, hookGet: null, hookPut: null, delayPut: 0, delayGet: 0 };
export const KV = {
  get: async k => {
    if (KVFAIL.delayGet) await new Promise(s => setTimeout(s, KVFAIL.delayGet));
    if (KVFAIL.hookGet) await KVFAIL.hookGet(k);
    if (KVFAIL.get && KVFAIL.get(k)) { kvLog.push(["get!", k]); throw new Error("KV GET failed: 500 Internal Server Error"); }
    kvLog.push(["get", k]); return mem.get(k) ?? null;
  },
  put: async (k, v) => {
    if (KVFAIL.delayPut) await new Promise(s => setTimeout(s, KVFAIL.delayPut));
    if (KVFAIL.hookPut) await KVFAIL.hookPut(k, v);
    if (KVFAIL.put && KVFAIL.put(k)) { kvLog.push(["put!", k]); throw new Error("KV PUT failed: 429 Too Many Requests"); }
    mem.set(k, v); kvLog.push(["put", k]);
  },
  delete: async k => { mem.delete(k); kvLog.push(["del", k]); }, list: async ({ prefix = "", limit = 1000 } = {}) => ({ keys: [...mem.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit).map(name => ({ name })), list_complete: true })
};
export const env = { KV, GEMINI_KEY: "stub-key", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1", MODEL: "gemini-3.5-flash-lite", ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_ALT: "2001" };

// ---- Gemini / Telegram / Meta
export const G = { queue: [], calls: [], fn: null, delay: 0 };
export const TG = [];
export const TGCFG = { fail: false, hang: 0 };
export const WA = [];
export const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
export const days = () => ({ D0: iso(Date.now()), D1: iso(Date.now() + 86400e3), D2: iso(Date.now() + 2 * 86400e3), D3: iso(Date.now() + 3 * 86400e3) });

// ---- Altegio
export const ALT = { down: false, timesDown: false, timesFailFor: null, taken: false, needCode: false, postFail: 0, postThrow: false, postCode: 0, postDelay: 0, delFail: 0, delThrow: false, delDelay: 0,
  noHash: false, noId: false, emptyBody: false, realistic: false, dates: null, times: null, services: null, staff: null, loc: {}, hook: null,
  calls: [], records: [], deleted: [], nextId: 555000 };
export const altReset = () => Object.assign(ALT, { down: false, timesDown: false, timesFailFor: null, taken: false, needCode: false, postFail: 0, postThrow: false, postCode: 0, postDelay: 0, delFail: 0, delThrow: false, delDelay: 0,
  noHash: false, noId: false, emptyBody: false, realistic: false, dates: null, times: null, services: null, staff: null, hook: null });
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
function altData(loc) {
  const o = ALT.loc[loc] || {};
  return {
    services: o.services || ALT.services || [
      { id: 101, title: "Мужская стрижка", category_id: 1, price_min: 6000, price_max: 6000, active: 1, seance_length: 3600 },
      { id: 102, title: "Оформление бороды", category_id: 1, price_min: 4000, price_max: 5000, active: 1, seance_length: 1800 },
      { id: 103, title: "Детская стрижка", category_id: 1, price_min: 4000, price_max: 4000, active: 1, seance_length: 2700 }],
    category: o.category || [{ id: 1, title: "Барбершоп" }],
    staff: o.staff || ALT.staff || [{ id: 11, name: "Арман", bookable: true, specialization: "топ-барбер" }, { id: 12, name: "Ерлан", bookable: true, specialization: "барбер" }],
    times: o.times || ALT.times || { 0: ["09:30", "10:00", "11:00", "13:00", "15:00", "16:00"], 11: ["10:00", "11:00", "13:00", "15:00"], 12: ["09:30", "10:00", "11:00", "13:00", "16:00"] },
    dates: o.dates || ALT.dates
  };
}
async function altStub(url, init) {
  const path = url.slice("https://api.alteg.io/api/v1".length), method = init.method || "GET";
  ALT.calls.push(method + " " + path);
  if (ALT.hook) { const r = await ALT.hook(method, path, init); if (r) return r; }
  if (ALT.down) return J({ success: false, data: null, meta: { message: "Server error" } }, 500);
  if ((init.headers || {}).authorization !== "Bearer partner-key") return J({ success: false, data: null, meta: { message: "Authentication needed." } }, 401);
  let m;
  const loc = (path.match(/^\/[a-z_]+\/(\d+)/) || [])[1];
  const D = altData(loc), { D1, D2 } = days(), dates = D.dates || [D1, D2];
  if (/^\/book_services\/\d+/.test(path)) return J({ success: true, data: { events: [], services: D.services, category: D.category }, meta: [] });
  if (/^\/book_staff\/\d+/.test(path)) return J({ success: true, data: D.staff, meta: [] });
  if (/^\/book_dates\/\d+/.test(path)) return J({ success: true, data: { booking_days: {}, booking_dates: dates, working_days: {}, working_dates: dates }, meta: [] });
  if (ALT.timesDown && /^\/book_times\//.test(path)) return J({ success: false, data: null, meta: { message: "Too Many Requests" } }, 429);
  if ((m = path.match(/^\/book_times\/(\d+)\/(\d+)\/(\d{4}-\d{2}-\d{2})/))) {
    if (ALT.timesFailFor === m[3]) return J({ success: false, data: null, meta: { message: "Server error" } }, 500);
    let t = dates.includes(m[3]) ? D.times[m[2]] || [] : [];
    // realistic: «одно кресло» — время, занятое неудалённой записью, скрыто для всех мастеров
    if (ALT.realistic) t = t.filter(x => !ALT.records.some(r => !r.deleted && r.loc === m[1] && r.appointments[0].datetime.startsWith(`${m[3]}T${x}`)));
    return J({ success: true, data: t.map(x => ({ time: x, seance_length: 3600, sum_length: 3600, datetime: `${m[3]}T${x}:00+05:00` })), meta: [] });
  }
  if (/^\/book_check\/\d+/.test(path)) return J({ success: true, data: null, meta: { message: "Created" } }, 201);
  if (/^\/book_record\/\d+/.test(path) && method === "POST") {
    if (ALT.postDelay) await new Promise(s => setTimeout(s, ALT.postDelay));
    if (ALT.postThrow) throw new Error("network down");
    if (ALT.postFail) return J({ success: false, data: null, meta: { message: "Server error" } }, ALT.postFail);
    if (ALT.taken) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 433, message: "Selected time slot is already taken" }] } }, 422);
    if (ALT.needCode) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 432, message: "Incorrect SMS verification code" }] } }, 422);
    if (ALT.postCode) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: ALT.postCode, message: "error " + ALT.postCode }] } }, 422);
    const body = JSON.parse(init.body);
    const id = ++ALT.nextId;
    ALT.records.push({ id, loc, ...body });
    if (ALT.emptyBody) return new Response("", { status: 201 });
    if (ALT.noId) return J({ success: true, data: [{ id: 1 }], meta: [] }, 201);
    return J({ success: true, data: [ALT.noHash ? { id: 1, record_id: id } : { id: 1, record_id: id, record_hash: "hash" + id }], meta: [] }, 201);
  }
  if ((m = path.match(/^\/user\/records\/(\d+)\/(\w+)/)) && method === "DELETE") {
    if (ALT.delDelay) await new Promise(s => setTimeout(s, ALT.delDelay));
    if (ALT.delThrow) throw new Error("network down");
    if (ALT.delFail) return J({ success: false, data: null, meta: ALT.delFail === 404 ? {} : { message: "Server error" } }, ALT.delFail);
    const rec = ALT.records.find(r => String(r.id) === m[1]);
    if (!rec || rec.deleted) return J({ success: false, data: null, meta: {} }, 404);
    rec.deleted = true;
    ALT.deleted.push(m[1] + "/" + m[2]); return new Response(null, { status: 204 });
  }
  return J({ success: false, data: null, meta: {} }, 404);
}

globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.includes("generativelanguage.googleapis.com")) {
    const body = JSON.parse(init.body); G.calls.push(body);
    if (G.delay) await new Promise(s => setTimeout(s, typeof G.delay === "function" ? G.delay(body) : G.delay));
    const next = G.fn ? G.fn(body) : (G.queue.length > 1 ? G.queue.shift() : G.queue[0]);
    if (next === undefined) throw new Error("HARNESS: ответ ИИ не задан");
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response("err", { status: next });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: next }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.telegram.org")) {
    if (TGCFG.hang) await new Promise(s => setTimeout(s, TGCFG.hang));
    if (TGCFG.fail) throw new Error("telegram down");
    TG.push(JSON.parse(init.body).text); return new Response("{}", { status: 200 });
  }
  if (url.includes("graph.facebook.com")) { WA.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url.startsWith("https://api.alteg.io/")) return altStub(url, init);
  throw new Error("unexpected fetch " + url);
};

export const pending = [];
const ctx = { waitUntil: p => pending.push(p) };
export const call = async (path, init) => worker.fetch(new Request("https://x.test" + path, init), env, ctx);
let ipN = 0; const ips = new Map();
export const ipOf = sid => { if (!ips.has(sid)) { ++ipN; ips.set(sid, `10.${Math.floor(ipN / 250)}.${ipN % 250}.7`); } return ips.get(sid); };
export const LOG = { quiet: false };
// одно сообщение клиента; llm — ответ(ы) ИИ на это сообщение (строка или массив: черновик и повтор после защиты)
export async function chat(sid, text, llm, o = {}) {
  if (llm !== undefined) G.queue = Array.isArray(llm) ? llm.slice() : [llm];
  const c = o.c || "alt";
  const tg0 = TG.length;
  let res, r;
  try { res = await call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": o.ip || ipOf(sid) }, body: JSON.stringify({ c, sid, text }) }); }
  catch (e) { r = { thrown: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }; }
  if (res) { const status = res.status; const raw = await res.text(); try { r = JSON.parse(raw); } catch (e) { r = { httpStatus: status, body: raw.slice(0, 200) }; } }
  r.tg = TG.slice(tg0);
  if (!o.quiet && !LOG.quiet) console.log(`   клиент: ${text}\n   ИИ(заглушка): ${JSON.stringify(llm)}\n   → бот: ${r.thrown ? "ИСКЛЮЧЕНИЕ " + r.thrown : r.reply}`
    + (r.lead ? `\n     lead: ${JSON.stringify(r.lead)}` : "") + (r.leads ? `\n     leads: ${JSON.stringify(r.leads)}` : "")
    + (r.cancel ? `\n     cancel=${r.cancel} cancelDone=${r.cancelDone}` : "") + (r.guard ? `\n     guard=${r.guard}` : "") + (r.offer && r.offer.length ? `\n     offer=${JSON.stringify(r.offer)}` : "")
    + (r.tg.length ? `\n     Telegram: ${JSON.stringify(r.tg)}` : ""));
  return r;
}
export const hist = (sid, c = "alt") => JSON.parse(mem.get(`h:web:${c}:${sid}`) || "null");
export const prof = (sid, c = "alt") => (hist(sid, c) || {}).profile || null;
export const leads = (c = "alt") => JSON.parse(mem.get("leads:" + c) || "[]");
export const showState = (sid, c = "alt") => {
  const p = prof(sid, c) || {};
  console.log("   состояние чата: bookings=" + JSON.stringify((p.bookings || []).map(b => `${b.name} ${b.date} ${b.time} №${b.record_id}`)) + " pend=" + JSON.stringify((p.pend || []).map(x => x.key + (x.maybe ? " (maybe)" : ""))) + " booked=" + JSON.stringify(p.booked) + " adminLeads=" + JSON.stringify(p.adminLeads) + " cbAt=" + (p.cbAt ? "да" : "нет") + " name=" + JSON.stringify(p.name));
  console.log("   Altegio: создано=" + ALT.records.length + " " + JSON.stringify(ALT.records.map(r => `№${r.id}${r.deleted ? "(удалена)" : ""} ${r.fullname} ${r.phone} ${r.appointments[0].datetime.slice(0, 16)}`)));
};
export const showLeads = (c = "alt") => console.log("   /leads: " + JSON.stringify(leads(c).map(l => `${l.name} | ${l.service} | ${l.time} | ${l.status || "активна"} | ${l.note || ""}`)));
export const tag = (name, time, extra = {}) => { const { D1 } = days(); return `[ЗАЯВКА] Имя: ${name}; Телефон: ${extra.phone || "указан"}; Услуга: ${extra.service || "Мужская стрижка"}; Мастер: ${extra.staff || "любой"}; Дата: ${extra.date || D1}; Время: ${time}`; };
export const title = s => console.log("\n=== " + s + " ===");
let bad = 0, good = 0;
export const check = (name, cond, extra = "") => { if (cond) { good++; console.log("   [ok]      " + name); } else { bad++; console.log("   [ДЕФЕКТ]  " + name + (extra ? "  → " + extra : "")); } return cond; };
export const summary = () => console.log(`\nИтого: ok ${good}, дефектов ${bad}`);

// ---- WhatsApp (Meta) с подписью
export function waOn(client = "alt") { Object.assign(env, { WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: client, APP_SECRET: "sec" }); }
let waId = 0;
export async function wa(from, text, llm) {
  if (llm !== undefined) G.queue = Array.isArray(llm) ? llm.slice() : [llm];
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid." + (++waId), from, type: "text", text: { body: text } }] } }] }] });
  const sig = "sha256=" + createHmac("sha256", "sec").update(body).digest("hex");
  const w0 = WA.length, tg0 = TG.length;
  await call("/", { method: "POST", body, headers: { "x-hub-signature-256": sig } });
  await Promise.all(pending); pending.length = 0;
  const out = WA.slice(w0).map(x => x.text.body);
  if (!LOG.quiet) console.log(`   клиент(WA ${from}): ${text}\n   ИИ(заглушка): ${JSON.stringify(llm)}\n   → бот: ${JSON.stringify(out)}` + (TG.length > tg0 ? `\n     Telegram: ${JSON.stringify(TG.slice(tg0))}` : ""));
  return { out, tg: TG.slice(tg0) };
}
export const waHist = (from, c = "alt") => JSON.parse(mem.get(`h:wa:${c}:${from}`) || "null");
export { worker };
