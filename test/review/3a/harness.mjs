// Общая обвязка для сценариев проверки: заглушки KV, Gemini, Telegram, Altegio. Сети нет.
// Основана на test/smoke.mjs, но с дополнительными флагами сбоев.
// WORKER=<путь> позволяет прогнать тот же сценарий на другой версии worker.js (для сравнения)
const worker = (await import(process.env.WORKER || new URL("../../../worker.js", import.meta.url).pathname)).default;

export const mem = new Map();
export const putLog = [];            // ключи всех успешных put по порядку
export const KVFAIL = { put: null, get: null }; // функции (key) => true, если операция должна упасть
export const KV = {
  get: async k => { if (KVFAIL.get && KVFAIL.get(k)) throw new Error("KV GET failed: 500 Internal Server Error"); return mem.get(k) ?? null; },
  put: async (k, v) => { if (KVFAIL.put && KVFAIL.put(k)) throw new Error("KV PUT failed: 429 Too Many Requests"); mem.set(k, v); putLog.push(k); },
  delete: async k => { mem.delete(k); }, list: async ({ prefix = "", limit = 1000 } = {}) => ({ keys: [...mem.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit).map(name => ({ name })), list_complete: true })
};
export const env = { KV, GEMINI_KEY: "stub-key", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1", MODEL: "gemini-3.5-flash-lite", ALTEGIO_SELF_CANCEL: "1", ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_ALT: "2001" };

export const G = { queue: [], calls: [], fn: null, delay: 0 }; // delay — сколько мс «думает» ИИ
export const TG = [];
export const WA = [];
export const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
export const days = () => ({ D0: iso(Date.now()), D1: iso(Date.now() + 86400e3), D2: iso(Date.now() + 2 * 86400e3) });
export const ALT = { down: false, timesDown: false, taken: false, needCode: false, postFail: 0, postThrow: false, delFail: 0, delThrow: false, delDelay: 0, noHash: false, emptyBody: false,
  dates: null, times: null, calls: [], records: [], deleted: [], nextId: 555000 };
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

function altData() {
  return {
    services: [
      { id: 101, title: "Мужская стрижка", category_id: 1, price_min: 6000, price_max: 6000, active: 1, seance_length: 3600 },
      { id: 102, title: "Оформление бороды", category_id: 1, price_min: 4000, price_max: 5000, active: 1, seance_length: 1800 },
      { id: 103, title: "Детская стрижка", category_id: 1, price_min: 4000, price_max: 4000, active: 1, seance_length: 2700 }],
    category: [{ id: 1, title: "Барбершоп" }],
    staff: [{ id: 11, name: "Арман", bookable: true, specialization: "топ-барбер" }, { id: 12, name: "Ерлан", bookable: true, specialization: "барбер" }],
    times: ALT.times || { 0: ["09:30", "10:00", "11:00", "13:00"], 11: ["10:00", "11:00", "13:00"], 12: ["09:30", "10:00", "11:00", "13:00"] }
  };
}
async function altStub(url, init) {
  const path = url.slice("https://api.alteg.io/api/v1".length), method = init.method || "GET";
  ALT.calls.push(method + " " + path);
  if (ALT.down) return J({ success: false, data: null, meta: { message: "Server error" } }, 500);
  if ((init.headers || {}).authorization !== "Bearer partner-key") return J({ success: false, data: null, meta: { message: "Authentication needed." } }, 401);
  let m;
  const D = altData(), { D1, D2 } = days(), dates = ALT.dates || [D1, D2];
  if (/^\/book_services\/\d+/.test(path)) return J({ success: true, data: { events: [], services: D.services, category: D.category }, meta: [] });
  if (/^\/book_staff\/\d+/.test(path)) return J({ success: true, data: D.staff, meta: [] });
  if (/^\/book_dates\/\d+/.test(path)) return J({ success: true, data: { booking_days: {}, booking_dates: dates, working_days: {}, working_dates: dates }, meta: [] });
  if (ALT.timesDown && /^\/book_times\//.test(path)) return J({ success: false, data: null, meta: { message: "Too Many Requests" } }, 429);
  if ((m = path.match(/^\/book_times\/\d+\/(\d+)\/(\d{4}-\d{2}-\d{2})/))) {
    if (ALT.timesFailFor === m[2]) return J({ success: false, data: null, meta: { message: "Server error" } }, 500); // сбой только для одного дня
    const t = dates.includes(m[2]) ? D.times[m[1]] || [] : [];
    return J({ success: true, data: t.map(x => ({ time: x, seance_length: 3600, sum_length: 3600, datetime: `${m[2]}T${x}:00+05:00` })), meta: [] });
  }
  if (/^\/book_check\/\d+/.test(path)) return J({ success: true, data: null, meta: { message: "Created" } }, 201);
  if (/^\/book_record\/\d+/.test(path) && method === "POST") {
    if (ALT.postThrow) throw new Error("network down");
    if (ALT.postFail) return J({ success: false, data: null, meta: { message: "Server error" } }, ALT.postFail);
    if (ALT.taken) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 433, message: "Selected time slot is already taken" }] } }, 422);
    if (ALT.needCode) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 432, message: "Incorrect SMS verification code" }] } }, 422);
    const body = JSON.parse(init.body);
    const id = ++ALT.nextId;
    ALT.records.push({ id, ...body });
    if (ALT.emptyBody) return new Response("", { status: 201 });
    return J({ success: true, data: [ALT.noHash ? { id: 1, record_id: id } : { id: 1, record_id: id, record_hash: "hash" + id }], meta: [] }, 201);
  }
  if ((m = path.match(/^\/user\/records\/(\d+)\/(\w+)/)) && method === "DELETE") {
    if (ALT.delDelay) await new Promise(s => setTimeout(s, ALT.delDelay));
    if (ALT.delThrow) throw new Error("network down");
    if (ALT.delFail) return J({ success: false, data: null, meta: ALT.delFail === 404 ? {} : { message: "Server error" } }, ALT.delFail);
    ALT.deleted.push(m[1] + "/" + m[2]); return new Response(null, { status: 204 });
  }
  return J({ success: false, data: null, meta: {} }, 404);
}

globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.includes("generativelanguage.googleapis.com")) {
    const body = JSON.parse(init.body); G.calls.push(body);
    if (G.delay) await new Promise(s => setTimeout(s, G.delay));
    const next = G.fn ? G.fn(body) : (G.queue.length > 1 ? G.queue.shift() : G.queue[0]);
    if (next === undefined) throw new Error("HARNESS: ответ ИИ не задан");
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response("err", { status: next });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: next }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.telegram.org")) { TG.push(JSON.parse(init.body).text); return new Response("{}", { status: 200 }); }
  if (url.includes("graph.facebook.com")) { WA.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url.startsWith("https://api.alteg.io/")) return altStub(url, init);
  throw new Error("unexpected fetch " + url);
};

export const pending = [];
const ctx = { waitUntil: p => pending.push(p) };
export const call = async (path, init) => worker.fetch(new Request("https://x.test" + path, init), env, ctx);
let ipN = 0; const ips = new Map();
export const ipOf = sid => { if (!ips.has(sid)) ips.set(sid, `10.${Math.floor(++ipN / 250)}.${ipN % 250}.7`); return ips.get(sid); };
// одно сообщение клиента; llm — ответ(ы) ИИ на это сообщение (строка или массив: черновик и повтор после защиты)
export async function chat(sid, text, llm, o = {}) {
  if (llm !== undefined) G.queue = Array.isArray(llm) ? llm.slice() : [llm];
  const c = o.c || "alt";
  const res = await call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": o.ip || ipOf(sid) }, body: JSON.stringify({ c, sid, text }) });
  let r; const status = res.status; const raw = await res.text();
  try { r = JSON.parse(raw); } catch (e) { r = { httpStatus: status, body: raw.slice(0, 200) }; }
  if (!o.quiet) console.log(`   клиент: ${text}\n   ИИ(заглушка): ${JSON.stringify(llm)}\n   → бот: ${r.reply}${r.lead ? `\n     lead: ${JSON.stringify(r.lead)}` : ""}${r.cancel ? `\n     cancel=${r.cancel} cancelDone=${r.cancelDone}` : ""}${r.guard ? `\n     guard=${r.guard}` : ""}`);
  return r;
}
export const hist = (sid, c = "alt") => JSON.parse(mem.get(`h:web:${c}:${sid}`) || "null");
export const prof = (sid, c = "alt") => (hist(sid, c) || {}).profile || null;
export const leads = (c = "alt") => JSON.parse(mem.get("leads:" + c) || "[]");
export const showState = (sid, c = "alt") => {
  const p = prof(sid, c) || {};
  console.log("   состояние чата: bookings=" + JSON.stringify((p.bookings || []).map(b => `${b.name} ${b.date} ${b.time} №${b.record_id}`)) + " pending=" + JSON.stringify(p.pending) + " pendKey=" + JSON.stringify(p.pendKey) + " booked=" + JSON.stringify(p.booked) + " leadId=" + JSON.stringify(p.leadId));
  console.log("   Altegio: записей создано=" + ALT.records.length + " " + JSON.stringify(ALT.records.map(r => `№${r.id} ${r.fullname} ${r.phone} ${r.appointments[0].datetime.slice(0, 16)}`)) + " удалено=" + JSON.stringify(ALT.deleted));
};
export const tag = (name, time, extra = {}) => { const { D1 } = days(); return `[ЗАЯВКА] Имя: ${name}; Телефон: ${extra.phone || "указан"}; Услуга: ${extra.service || "Мужская стрижка"}; Мастер: ${extra.staff || "любой"}; Дата: ${extra.date || D1}; Время: ${time}`; };
export const title = s => console.log("\n=== " + s + " ===");
let bad = 0, good = 0;
export const check = (name, cond, extra = "") => { if (cond) { good++; console.log("   [как задумано] " + name); } else { bad++; console.log("   [НАРУШЕНИЕ]   " + name + (extra ? "  → " + extra : "")); } return cond; };
export const summary = () => console.log(`\nИтого: как задумано ${good}, нарушений ${bad}`);
export { worker };
