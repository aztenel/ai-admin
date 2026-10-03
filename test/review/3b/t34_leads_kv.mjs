// Non-Altegio client: the KV write of the leads list fails (1 write/sec per key or daily quota). v7.3 vs v7.4.
import w74 from "../../../worker.js";
import w73 from "./worker73.mjs";
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini|leads)/.test(String(a[0]))) _log(...a); };
const TAG = "[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: стрижка + борода; Время: завтра, 12:00";
for (const [name, worker] of [["v7.3", w73], ["v7.4", w74]]) for (const tgOn of [true, false]) {
  const mem = new Map(), tg = [];
  const env = { KV: { get: async k => mem.get(k) ?? null, put: async (k, v) => { if (k.startsWith("leads:")) throw new Error("KV PUT failed: 429 Too Many Requests"); mem.set(k, v); }, delete: async k => { mem.delete(k); } }, GEMINI_KEY: "k", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", ...(tgOn ? { TG_TOKEN: "tg", TG_CHAT: "1" } : {}) };
  globalThis.fetch = async (u, init = {}) => { const url = String(u); if (url.includes("telegram")) { tg.push(JSON.parse(init.body).text.split("\n")[0]); return new Response("{}"); } return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n" + TAG }] }, finishReason: "STOP" }] })); };
  let out;
  try { const r = await worker.fetch(new Request("https://x.test/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.6.6.6" }, body: JSON.stringify({ c: "barber", sid: "kv1", text: "Азамат, 8 777 123 45 67, стрижка и борода завтра в 12:00" }) }), env, { waitUntil() {} }); const j = await r.json(); out = `HTTP ${r.status} reply=«${j.reply}» lead=${!!j.lead}`; }
  catch (e) { out = "UNHANDLED EXCEPTION (client sees «Нет связи, попробуйте ещё раз»): " + e.message; }
  const hist = JSON.parse(mem.get("h:web:barber:kv1") || "null");
  _log(`${name}, Telegram ${tgOn ? "on " : "off"} → ${out}\n      lead stored for /leads: ${mem.has("leads:barber")} | Telegram: ${JSON.stringify(tg)} | chat state saved: ${!!hist}${hist ? ", profile.leadId set: " + !!hist.profile.leadId : ""}`);
}
