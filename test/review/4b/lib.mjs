// Harness for worker.js (dev 8b4c156) — stubs only, no network. Based on review3b/lib.mjs.
// One worker instance per process: const h = await mk();  Fresh location number per scenario: h.loc(4101, d => {...})
export const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
export const D0 = iso(Date.now()), D1 = iso(Date.now() + 86400e3), D2 = iso(Date.now() + 2 * 86400e3), D3 = iso(Date.now() + 3 * 86400e3);
export const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
export const sv = (id, title, price = 5000, min = 60, cat = 1) => ({ id, title, category_id: cat, price_min: price, price_max: price, active: 1, seance_length: min * 60 });

export function baseData() {
  return {
    services: [sv(101, "Мужская стрижка", 6000, 60), sv(102, "Оформление бороды", 4000, 30), sv(103, "Детская стрижка", 4000, 45)],
    category: [{ id: 1, title: "Барбершоп" }],
    staff: [{ id: 11, name: "Арман", bookable: true, specialization: "топ-барбер" }, { id: 12, name: "Ерлан", bookable: true, specialization: "барбер" }],
    dates: [D1, D2],
    times: { 0: ["09:30", "10:00", "11:00", "13:00"], 11: ["11:00", "13:00"], 12: ["09:30", "10:00"] }
  };
}

export async function mk(opts = {}) {
  const worker = (await import(opts.worker || new URL("../../../worker.js", import.meta.url).pathname)).default;
  const mem = new Map();
  const KV = {
    get: async k => { if (h.kvGetFail && h.kvGetFail(k)) throw new Error("KV GET failed"); return mem.get(k) ?? null; },
    put: async (k, v) => { if (h.kvFail && h.kvFail(k)) throw new Error("KV PUT failed: 429 Too Many Requests"); mem.set(k, v); },
    delete: async k => { mem.delete(k); }, list: async ({ prefix = "", limit = 1000 } = {}) => ({ keys: [...mem.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit).map(name => ({ name })), list_complete: true })
  };
  const env = { KV, GEMINI_KEY: "stub-key", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1", MODEL: "gemini-3.5-flash-lite", ALTEGIO_PARTNER: "partner-key", ...(opts.env || {}) };
  const h = {
    worker, env, mem, KV, kvFail: null, kvGetFail: null,
    gemini: [], calls: { gemini: [], tg: [], wa: [] },
    ALT: { calls: [], records: [], deleted: [], data: {}, hook: null },
  };
  h.dataFor = loc => h.ALT.data[loc] || (h.ALT.data[loc] = baseData());
  h.loc = (n, fn) => { env.ALTEGIO_LOC_ALT = String(n); const d = h.dataFor(String(n)); if (fn) fn(d); return d; };
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u);
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(init.body);
      h.calls.gemini.push(body);
      let next = h.gemini.length > 1 ? h.gemini.shift() : h.gemini[0];
      if (typeof next === "function") next = next(body);
      if (next instanceof Error) throw next;
      if (typeof next === "number") return new Response("err", { status: next });
      return J({ candidates: [{ content: { parts: [{ text: next }] }, finishReason: "STOP" }] });
    }
    if (url.includes("api.telegram.org")) { if (h.tgHook) return h.tgHook(url, init); h.calls.tg.push(JSON.parse(init.body).text); return new Response("{}", { status: 200 }); }
    if (url.includes("graph.facebook.com")) { h.calls.wa.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
    if (url.startsWith("https://api.alteg.io/")) return altStub(url, init);
    throw new Error("unexpected fetch " + url);
  };
  async function altStub(url, init) {
    const path = url.slice("https://api.alteg.io/api/v1".length), method = init.method || "GET";
    h.ALT.calls.push(method + " " + path);
    if (h.ALT.hook) { const r = await h.ALT.hook(path, method, init); if (r) return r; }
    if ((init.headers || {}).authorization !== "Bearer partner-key") return J({ success: false, data: null, meta: { message: "Authentication needed." } }, 401);
    let m;
    const loc = (path.match(/^\/[a-z_]+\/(-?\d+)/) || [])[1];
    const D = h.dataFor(loc);
    if (D.missing) return J({ success: false, data: null, meta: { message: "Not found" } }, 404);
    if (/^\/book_services\//.test(path)) return J({ success: true, data: { events: [], services: D.services, category: D.category }, meta: [] });
    if (/^\/book_staff\//.test(path)) return J({ success: true, data: D.staff, meta: [] });
    if (/^\/book_dates\//.test(path)) return J({ success: true, data: { booking_days: {}, booking_dates: D.dates, working_days: {}, working_dates: D.dates }, meta: [] });
    if ((m = path.match(/^\/book_times\/\d+\/(\d+)\/(\d{4}-\d{2}-\d{2})(?:\?(.*))?/))) {
      if (D.timesHook) { const r = D.timesHook(m[1], m[2], m[3] || ""); if (r) return r; }
      const src = D.timesByDate && D.timesByDate[m[2]] ? D.timesByDate[m[2]] : D.times;
      const t = D.dates.includes(m[2]) ? (src[m[1]] || []) : [];
      return J({ success: true, data: t.map(x => ({ time: x, seance_length: 3600, sum_length: 3600, datetime: `${m[2]}T${x}:00+05:00` })), meta: [] });
    }
    if (/^\/book_check\//.test(path)) return J({ success: true, data: null, meta: { message: "Created" } }, 201);
    if (/^\/book_record\//.test(path) && method === "POST") {
      const body = JSON.parse(init.body);
      h.ALT.records.push(body);
      const id = 555000 + h.ALT.records.length;
      if (D.consume) { const ap = body.appointments[0], tm = ap.datetime.slice(11, 16); for (const k of Object.keys(D.times)) D.times[k] = D.times[k].filter(x => x !== tm); }
      return J({ success: true, data: [{ id: 1, record_id: id, record_hash: "hash" + id }], meta: [] }, 201);
    }
    if ((m = path.match(/^\/user\/records\/(\d+)\/(\w*)/)) && method === "DELETE") { h.ALT.deleted.push(m[1] + "/" + m[2]); return new Response(null, { status: 204 }); }
    return J({ success: false, data: null, meta: {} }, 404);
  }
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  h.pending = pending;
  h.call = (path, init) => worker.fetch(new Request("https://x.test" + path, init), env, ctx);
  h.chatIp = async (c, sid, text, ip) => {
    const headers = { "content-type": "application/json" };
    if (ip) headers["cf-connecting-ip"] = ip;
    const res = await h.call("/api/chat", { method: "POST", headers, body: JSON.stringify({ c, sid, text }) });
    const r = await res.json();
    r.__status = res.status;
    return r;
  };
  let ipn = 0; const ipOf = new Map();
  h.chat = (c, sid, text) => { if (!ipOf.has(sid)) { ++ipn; ipOf.set(sid, `10.${(ipn >> 16) & 255}.${(ipn >> 8) & 255}.${ipn & 255}`); } return h.chatIp(c, sid, text, ipOf.get(sid)); };
  h.sys = () => h.calls.gemini.at(-1).systemInstruction.parts[0].text;
  h.form = o => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
  h.tag = (name, svc, master, date, time) => `[ЗАЯВКА] Имя: ${name}; Телефон: указан; Услуга: ${svc}; Мастер: ${master}; Дата: ${date}; Время: ${time}`;
  h.leads = c => JSON.parse(mem.get("leads:" + c) || "[]");
  let phn = 0;
  h.phone = () => `+7 70${1 + (phn >> 14) % 8} ${String(100 + (phn >> 7) % 900)} ${String(10 + (phn++ % 90))} ${String(10 + ((phn * 7) % 90))}`; // unique KZ mobile numbers
  h.quiet = () => { const _log = console.log; console.log = (...a) => { if (!/^(guard|guard2|altegio|gemini|leads|history|limit|count|tg|altegio cancel)$/.test(String(a[0]))) _log(...a); }; return _log; };
  return h;
}
export const show = (title, o) => console.log(`\n=== ${title} ===\n` + (typeof o === "string" ? o : JSON.stringify(o, null, 1)));
