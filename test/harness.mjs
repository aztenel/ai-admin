// Обвязка для проверок на заглушках: хранилище KV в памяти (со списком ключей и метаданными), подменённые Gemini, Telegram, Meta, Green-API и Altegio.
// Используется в test/platform.mjs и в локальном сервере для проверки страниц в браузере (test/devserver.mjs).
import "./clock.mjs"; // до загрузки бота: проверки идут по одним и тем же часам
import worker from "../worker.js";
import { createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";

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
  aiUsage: null,               // usageMetadata в ответе Gemini (учёт расходов на ИИ); null — без него, как раньше
  ai: [],                      // очередь ответов ИИ: строка, число (код ошибки), Error или функция (тело запроса) → ответ. Последний ответ повторяется
  gemini: [], tg: [], graph: [], alt: [], other: [],
  tgStatus: 200,               // что отвечает Telegram
  graphReply: null,            // функция (url, init) → Response | null: свой ответ Meta (ошибка отправки, сведения о номере)
  altData: null,               // функция (loc) → { services, staff, category, times, dates } — расписание Altegio
  altRecords: [], altDeleted: [], altGone: [], altBusy: false, altGetFail: 0, altGetPlain: false, altCheckBusy: false, altAuth: [], altJournalFail: 0, // altGetPlain — чтение записи «успешно», но без поля deleted (как может быть вживую); altGone — записи, удалённые администратором прямо в Altegio
  altClients: [],              // справочник клиентов (POST /locations/{локация}/clients/search): { id, name, surname, phone, first_visit_date, last_visit_date, visits_count, nl (разрешил рассылки), pd }
  altCreated: [],
  mediaReply: null,            // (url, init) → Response | null: файлы по ссылкам провайдеров (inbox-v2.test.mjs)              // попытки «Добавить клиента» (POST /clients/{локация}) — в пробах и синхронизации их быть не должно
  altClientsNoVisits: false,   // Altegio не принимает поле visits_count (400)
  altJournal: null,            // массив сырых записей журнала (/records): с ним заглушка фильтрует по start_date/end_date и отдаёт страницами (count, page), как Altegio; null — журнал из altRecords, как раньше
  ga: [],                      // запросы к Green-API: { url, inst, op, token, body }
  gaState: "authorized",       // что отвечает getStateInstance
  gaSettings: {},              // настройки инстансов по номеру (getSettings/setSettings); как у настоящего инстанса, reset() их не стирает
  gaReply: null,               // функция (rec) → Response | null: свой ответ Green-API (ошибка отправки); может бросить исключение — «связь оборвалась»
  wz: [],                      // запросы к API Wazzapo (партнёр Meta): { url, path, method, key, body }
  wzReply: null,               // функция (rec) → Response | null: свой ответ Wazzapo
  img: [],                     // запросы картинок Altegio (фото мастеров, assets.alteg.io и др.): адреса
  imgReply: null,              // функция (url, init) → Response | null: свой ответ на запрос картинки (не картинка, большая, перенаправление)
  reset() { this.img.length = 0; this.imgReply = null; this.ai = []; this.aiUsage = null; this.gemini.length = 0; this.tg.length = 0; this.graph.length = 0; this.alt.length = 0; this.other.length = 0; this.tgStatus = 200; this.graphReply = null; this.altRecords.length = 0; this.altDeleted.length = 0; this.ga.length = 0; this.gaState = "authorized"; this.gaReply = null; this.wz.length = 0; this.wzReply = null; this.altJournal = null; this.altClients = []; this.altClientsNoVisits = false; this.altCreated = []; this.mediaReply = null; }
};
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
export const D0 = iso(Date.now()), D1 = iso(Date.now() + 86400e3), D2 = iso(Date.now() + 2 * 86400e3);
// PNG 220×220 «силуэт на цветном фоне» — фото мастера на заглушке (цвет — от адреса картинки); у no-master — серый
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
export function pngFace(key, size = 220) {
  let h = 0; for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const PAL = [[91, 107, 122], [109, 95, 85], [79, 107, 93], [122, 92, 102], [94, 90, 122]]; // спокойные тона, как у фото на тёмном фоне
  const grey = /no-master/.test(key), bg = grey ? [200, 200, 200] : PAL[h % PAL.length], fg = grey ? [235, 235, 235] : [233, 226, 216];
  const raw = Buffer.alloc((size * 3 + 1) * size), c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const head = (x - c) ** 2 + (y - size * 0.4) ** 2 < (size * 0.2) ** 2, body = ((x - c) / (size * 0.38)) ** 2 + ((y - size) / (size * 0.36)) ** 2 < 1;
      const px = head || body ? fg : bg, o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
export const ALT_DEFAULT = () => ({
  services: [
    { id: 101, title: "Мужская стрижка", category_id: 1, price_min: 6000, price_max: 6000, active: 1, seance_length: 3600 },
    { id: 102, title: "Оформление бороды", category_id: 1, price_min: 4000, price_max: 5000, active: 1, seance_length: 1800 },
    { id: 103, title: "Детская стрижка", category_id: 1, price_min: 4000, price_max: 4000, active: 1, seance_length: 2700 }],
  category: [{ id: 1, title: "Барбершоп" }],
  staff: [{ id: 11, name: "Арман", bookable: true, specialization: "топ-барбер" }, { id: 12, name: "Ерлан", bookable: true, specialization: "барбер" }],
  times: { 0: ["09:30", "10:00", "11:00", "13:00"], 11: ["11:00", "13:00"], 12: ["09:30", "10:00"] }
});
// Как настоящий Altegio без услуги: свободные начала мастера сеткой по 30 мин (у Ерлана свободно 9:30–11:30). Нужно клиентам с проверкой
// длительности (altegio.fitCheck — Winchester): в общей заглушке у Ерлана только 9:30 и 10:00, а по сетке это «в 10:30 уже занято»
export const ALT_GRID = () => { const d = ALT_DEFAULT(); return { ...d, times: { ...d.times, 12: ["09:30", "10:00", "10:30", "11:00"] } }; };
function altStub(url, init) {
  const path = url.slice("https://api.alteg.io/api/v1".length), method = init.method || "GET";
  net.alt.push(method + " " + path);
  const loc = (path.match(/^\/[a-z_]+\/(\d+)/) || [])[1];
  const D = (net.altData && net.altData(loc)) || ALT_DEFAULT();
  if (D.down) return J({ success: false, data: null, meta: { message: "Server error" } }, 500);
  let m;
  // услуги, даты и время по мастеру (servicesFor, lenFor, datesFor — test/fixtures/winchester-altegio.mjs): как Altegio с ?staff_id=.
  // Без этих полей — как раньше (параметры запроса заглушка не смотрит)
  const qs = new URL(url).searchParams, sidQ = qs.get("staff_id");
  const openDays = staff => D.datesFor ? (D.datesFor(staff) || []) : (D.dates || [D1, D2]);
  if (/^\/book_services\/\d+/.test(path)) {
    if (D.servicesFor && sidQ) return J({ success: true, data: { events: [], services: D.servicesFor(sidQ).map(s => ({ ...s, seance_length: (D.lenFor && D.lenFor(sidQ, s.id)) ?? s.seance_length })), category: D.category }, meta: [] });
    return J({ success: true, data: { events: [], services: D.services, category: D.category }, meta: [] });
  }
  if (/^\/book_staff\/\d+/.test(path)) return J({ success: true, data: D.staff, meta: [] });
  if (/^\/book_dates\/\d+/.test(path)) {
    let dd = D.datesFor && sidQ ? D.datesFor(sidQ) || [] : D.dates || [D1, D2];
    if (D.datesFor) { const f = qs.get("date_from"), t = qs.get("date_to"); dd = dd.filter(d => (!f || d >= f) && (!t || d <= t)); } // период запроса — как Altegio
    return J({ success: true, data: { booking_days: {}, booking_dates: dd, working_days: {}, working_dates: dd }, meta: [] });
  }
  if ((m = path.match(/^\/book_times\/\d+\/(\d+)\/(\d{4}-\d{2}-\d{2})/))) {
    const sids = [...qs.getAll("service_ids[]")]; // timesFor(мастер, день, услуги) — время с учётом длительности услуги, как в Altegio; ошибка — объект { error: код }
    if (D.timesFor && openDays(m[1]).includes(m[2])) { const r = D.timesFor(m[1], m[2], sids); if (r && r.error) return J({ success: false, data: null, meta: { message: "The service is not available" } }, r.error); }
    let t = openDays(m[1]).includes(m[2]) ? (D.timesFor ? D.timesFor(m[1], m[2], sids) : D.times[m[1]]) || [] : [];
    if (net.altBusy) { // занятое записями время у мастера не показываем (записи, удалённые администратором, время освобождают)
      const busy = net.altRecords.map((r, i) => ({ id: String(777001 + i), a: (r.appointments || [])[0] || {} })).filter(x => !net.altDeleted.includes(x.id) && !(net.altGone || []).includes(x.id) && String(x.a.staff_id) === m[1] && String(x.a.datetime || "").startsWith(m[2])).map(x => String(x.a.datetime).slice(11, 16));
      t = t.filter(x => !busy.includes(x));
    }
    return J({ success: true, data: t.map(x => ({ time: x, seance_length: 3600, sum_length: 3600, datetime: `${m[2]}T${x}:00+05:00` })), meta: [] });
  }
  if (path === "/auth" && method === "POST") { const b = JSON.parse(init.body || "{}"); net.altAuth.push({ login: b.login, auth: init.headers && init.headers.authorization }); return b.password === "right-pass" ? J({ success: true, data: { user_token: "usr-tok", name: "Азамат" }, meta: [] }) : J({ success: false, data: null, meta: { message: "Неверный логин или пароль" } }, 401); }
  if ((m = path.match(/^\/clients\/(\d+)$/)) && method === "POST") { // «Добавить клиента», как Altegio: без имени и номера — 422 (30.10.2026 так ответил настоящий)
    const b = JSON.parse(init.body || "{}");
    net.altCreated.push(b);
    if (!b.name || !b.phone) return J({ success: false, data: null, meta: { message: "Name and phone are required" } }, 422);
    return J({ success: true, data: { id: 990000 + net.altCreated.length, name: b.name, phone: b.phone }, meta: [] }, 201);
  }
  if ((m = path.match(/^\/locations\/(\d+)\/clients\/search$/)) && method === "POST") { // справочник клиентов: страницы, поля, фильтры флагов, meta.total_count — как Altegio
    if (!/User usr-tok/.test((init.headers && init.headers.authorization) || "")) return J({ success: false, data: null, meta: { message: "Unauthorized" } }, 401);
    if (net.altJournalFail) return J({ success: false, data: null, meta: { message: "Unauthorized" } }, net.altJournalFail);
    const b = JSON.parse(init.body || "{}"), fields = Array.isArray(b.fields) ? b.fields : ["id"];
    if (net.altClientsNoVisits && fields.includes("visits_count")) return J({ success: false, data: null, meta: { message: "Unknown field visits_count" } }, 400);
    let all = [...net.altClients].sort((a, c) => a.id - c.id);
    for (const f of b.filters || []) if (f.type === "is_newsletter_allowed") all = all.filter(x => !!x.nl === !!f.state.value); else if (f.type === "is_personal_data_processing_allowed") all = all.filter(x => !!x.pd === !!f.state.value);
    const size = Math.min(200, +b.page_size || 25), pg = Math.max(1, +b.page || 1);
    return J({ success: true, data: all.slice((pg - 1) * size, pg * size).map(x => Object.fromEntries(["id", ...fields].filter(k => k in x).map(k => [k, x[k]]))), meta: { total_count: all.length } });
  }
  if ((m = path.match(/^\/client\/(\d+)\/(\d+)$/)) && method === "GET") { // карточка клиента
    const x = net.altClients.find(c => String(c.id) === m[2]);
    return x ? J({ success: true, data: { id: x.id, name: x.name, phone: x.phone, sms_not: 0, sms_check: 1, is_newsletter_allowed: !!x.nl, visits: x.visits_count || 0 }, meta: [] }) : J({ success: false, data: null, meta: { message: "Not found" } }, 404);
  }
  if ((m = path.match(/^\/records\/(\d+)/)) && method === "GET") {
    if (!/User usr-tok/.test((init.headers && init.headers.authorization) || "")) return J({ success: false, data: null, meta: { message: "Unauthorized" } }, 401);
    if (net.altJournalFail) return J({ success: false, data: null, meta: { message: "Unauthorized" } }, net.altJournalFail);
    if (net.altJournal) { // журнал за период (база клиентов): записи с датой в [start_date, end_date], страница page по count штук
      const q = new URL(url).searchParams, sd = q.get("start_date") || "", ed = q.get("end_date") || "", cnt = Math.max(1, +q.get("count") || 200), pg = Math.max(1, +q.get("page") || 1);
      const all = net.altJournal.filter(r => { const d = String(r.datetime || "").slice(0, 10); return (!sd || d >= sd) && (!ed || d <= ed); });
      return J({ success: true, data: all.slice((pg - 1) * cnt, pg * cnt), meta: { count: all.length } });
    }
    // журнал как вживую: удалённая через API запись помечена deleted, удалённая администратором — пропадает из списка
    const data = net.altRecords.map((r, i) => { const a = (r.appointments || [])[0] || {}, st = D.staff.find(x => x.id === a.staff_id) || D.staff[0], id = String(777001 + i);
      return (net.altGone || []).includes(id) ? null : { id: +id, company_id: +m[1], staff_id: st.id, datetime: a.datetime, staff: { id: st.id, name: st.name }, client: { phone: r.phone, name: r.fullname },
        services: (a.services || []).map(sid => ({ id: sid, title: (D.services.find(x => x.id === sid) || {}).title || "?" })), comment: r.comment || "", deleted: net.altDeleted.includes(id), attendance: 0 }; }).filter(Boolean); // comment — как в настоящем журнале (пометка пробной записи бота)
    return J({ success: true, data, meta: { count: data.length } });
  }
  if (/^\/book_check\/\d+/.test(path)) {
    if (net.altCheckBusy) return J({ success: false, data: null, meta: { message: "The service is not available at the selected time." } }, 422);
    if (net.altBusy) { // как вживую: время мастера с записью проверку не проходит (422)
      const a = (JSON.parse(init.body || "{}").appointments || [])[0] || {};
      const taken = net.altRecords.some((r, i) => { const x = (r.appointments || [])[0] || {}, id = String(777001 + i); return !net.altDeleted.includes(id) && !(net.altGone || []).includes(id) && String(x.staff_id) === String(a.staff_id) && x.datetime === a.datetime; });
      if (taken) return J({ success: false, data: null, meta: { message: "The service is not available at the selected time." } }, 422);
    }
    return J({ success: true, data: null, meta: { message: "Created" } }, 201);
  }
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
    if (next && typeof next.then === "function") { // ответ с задержкой (промис): как настоящий fetch, обрывается по AbortSignal
      const p = next, sig = init.signal;
      next = await new Promise((res, rej) => { p.then(res, rej); if (sig) sig.addEventListener("abort", () => rej(new DOMException("The operation was aborted", "AbortError"))); });
    }
    if (next === undefined) next = "Хорошо.";
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response("err", { status: next });
    return J({ candidates: [{ content: { parts: [{ text: next }] }, finishReason: "STOP" }], ...(net.aiUsage ? { usageMetadata: net.aiUsage } : {}) });
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
  if (/^https?:\/\/([a-z0-9-]+\.)*alteg\.io\//.test(url)) { // картинки Altegio (фото мастеров): PNG, свой цвет у каждого адреса
    net.img.push(url);
    const own = net.imgReply && net.imgReply(url, init);
    if (own) return own;
    if (/\/(masters|images)\//.test(url)) return new Response(pngFace(url), { headers: { "content-type": "image/png" } });
    return new Response("not found", { status: 404 });
  }
  if (net.mediaReply) { const own = net.mediaReply(url, init); if (own) return own; } // файлы провайдеров (ссылки Green-API на голосовые и фото)
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
  if (url.startsWith("https://wazzapo.kz/api/v2/external/")) { // Wazzapo: ключ в заголовке X-API-Key
    const h = init.headers || {}, rec = { url, path: url.slice("https://wazzapo.kz/api/v2/external".length), method: init.method || "GET", key: h["x-api-key"] || "", body: init.body ? JSON.parse(init.body) : null }; net.wz.push(rec);
    const own = net.wzReply && net.wzReply(rec);
    if (own) return own;
    if (rec.path === "/messages/send" && rec.method === "POST") return J({ message_id: "wzm-" + net.wz.length, provider_message_id: "wamid.wz." + net.wz.length, status: "accepted" });
    if (rec.path.startsWith("/phone-numbers/")) return J({ data: { phone_number_id: rec.path.split("/")[2], display_phone_number: "+7 700 000 00 99", verified_name: "Тест", quality_rating: "GREEN", messaging_limit_tier: "TIER_250" } });
    return J({ error: "not found" }, 404);
  }
  net.other.push(url);
  throw new Error("unexpected fetch " + url);
};

// пароль вебхука Green-API клиента — как gaHook в worker.js: HMAC токена инстанса от «ga-hook:<клиент>:<номер инстанса>»
export const gaPass = (c, inst) => createHmac("sha256", inst.token).update(`ga-hook:${c}:${inst.id}`).digest("hex").slice(0, 32);

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
  // вебхук Green-API клиента c (/ga/<c>?t=<пароль>): inst — { id, token } его инстанса (GA_ID_<C>, GA_TOKEN_<C>)
  const gaText = (c, inst, from, text, { idMessage = "IN-" + (++waId), name = "" } = {}) => call(`/ga/${c}?t=${gaPass(c, inst)}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeWebhook: "incomingMessageReceived", instanceData: { idInstance: +inst.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), idMessage,
      senderData: { chatId: from + "@c.us", sender: from + "@c.us", senderName: name }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: text } } }) });
  const sentTo = to => net.graph.filter(g => g.body && g.body.to === to).map(g => (g.body.text && g.body.text.body) || (g.body.template && "[шаблон " + g.body.template.name + "]") || "");
  const hist = (ch, c, id) => kv.json(`h:${ch}:${c}:${id}`);
  const leads = c => kv.json("leads:" + c) || [];
  const cron = async at => { await worker.scheduled({ cron: "* * * * *", ...(at ? { scheduledTime: at } : {}) }, env, ctx); await settle(); }; // фоновая задача (раз в минуту); at — время запуска, мс
  return { env, kv, call, settle, browser, chat, waPost, waText, gaText, sentTo, hist, leads, cron };
}

// ---- счёт проверок
export const T = { pass: 0, fail: 0, failed: [] };
export function ok(name, cond, info = "") {
  if (cond) { T.pass++; if (process.env.SHOW) console.log("  ok   " + name); }
  else { T.fail++; T.failed.push(name); console.log("  FAIL " + name + (info ? "  → " + String(info).slice(0, 1500) : "")); }
  return !!cond;
}
export const section = s => { if (process.env.SHOW) console.log("\n== " + s); };
