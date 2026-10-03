// F/G. notify with a 6 s timeout; KV failures for a client WITHOUT Altegio (leads write, history write, history read); LLM failure notification.
import { mk } from "./lib.mjs";
const h = await mk({ env: { TG_CHAT: "1,2" } }); const log = h.quiet();
delete h.env.ALTEGIO_PARTNER;
const TAG = "Забронировала вас на завтра в 10:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: чистка; Время: завтра, 10:00";
const run = async (name, sid, text, prep) => {
  h.calls.tg.length = 0; if (prep) prep();
  const t0 = Date.now(); let r, err = null;
  try { r = await h.chat("dent", sid, text); } catch (e) { err = e; }
  log(`--- ${name} (${Date.now() - t0} ms)\n    ${err ? "THROWS " + err.message : `status ${r.__status} reply: ${r.reply} | lead: ${r.lead ? r.lead.name + " " + r.lead.phone : null}${r.error ? " | error: " + r.error : ""}`}\n    telegram: ${JSON.stringify(h.calls.tg.map(x => x.split("\n")[0]))}\n    leads in KV: ${h.leads("dent").length} | history saved: ${h.mem.has("h:web:dent:" + sid)}`);
  h.kvFail = null; h.kvGetFail = null; h.tgHook = null;
};
h.gemini = [TAG];
await run("1. Telegram hangs (honours abort), two chat ids", "n1", "Азамат, 8 701 500 10 01, чистка завтра в 10:00", () => { h.tgHook = (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))); });
await run("2. Telegram answers 500", "n2", "Азамат, 8 701 500 10 02, чистка завтра в 10:00", () => { h.tgHook = () => new Response("err", { status: 500 }); });
await run("3. leads write fails (KV), Telegram works", "n3", "Азамат, 8 701 500 10 03, чистка завтра в 10:00", () => { h.kvFail = k => k.startsWith("leads:"); });
await run("4. leads write fails, Telegram NOT configured", "n4", "Азамат, 8 701 500 10 04, чистка завтра в 10:00", () => { h.kvFail = k => k.startsWith("leads:"); h.env.TG_TOKEN = ""; });
h.env.TG_TOKEN = "tg";
await run("5. leads write fails AND Telegram delivery fails", "n5", "Азамат, 8 701 500 10 05, чистка завтра в 10:00", () => { h.kvFail = k => k.startsWith("leads:"); h.tgHook = () => Promise.reject(new Error("net")); });
await run("6. history write fails", "n6", "Азамат, 8 701 500 10 06, чистка завтра в 10:00", () => { h.kvFail = k => k.startsWith("h:web:"); });
await run("7. leads READ fails at save time", "n7", "Азамат, 8 701 500 10 07, чистка завтра в 10:00", () => { let n = 0; h.kvGetFail = k => k.startsWith("leads:"); });
await run("8. history READ fails (first read in think)", "n8", "Привет", () => { h.kvGetFail = k => k.startsWith("h:web:"); });
h.gemini = [500];
await run("9. LLM fails → administrator is told", "n9", "Сколько стоит чистка?");
await run("10. LLM fails again in the same chat within 10 min → no second note", "n9", "Алло?");
process.exit(0);
