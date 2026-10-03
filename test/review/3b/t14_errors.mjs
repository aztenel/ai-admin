// altCall: Altegio error shapes and HTTP failures on the booking call (book_record) and on the fresh re-check (book_times with service_ids).
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4140" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
async function tryBook(label, hook) {
  n++; h.ALT.hook = hook; h.ALT.records.length = 0; h.calls.tg.length = 0; h.env.ALTEGIO_LOC_ALT = String(4140 + n);
  h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
  const t0 = Date.now();
  const d = await h.chat("alt", "e" + n, `Тимур, +7 702 5${String(10 + n).padStart(2, "0")} 22 33, мужская стрижка завтра в 10:00`);
  const kind = d.lead ? (d.lead.altegio ? "BOOKED" : "ADMIN LEAD") : "no lead (asks client)";
  _log(`${label}\n   → ${kind} | ${Date.now() - t0} ms | reply: ${d.reply.slice(0, 150)}\n   → note: ${d.lead ? d.lead.note : "-"} | TG: ${h.calls.tg.map(x => x.split("\n")[0]).join(" || ")}`);
  h.ALT.hook = null;
  return d;
}
const rec = p => p.startsWith("/book_record/");
const fresh = p => /^\/book_times\/.*service_ids/.test(p);
const E = (errors, status = 422, extra = {}) => J({ success: false, data: null, meta: { message: "Произошла ошибка", errors, ...extra } }, status);

_log("=== error shapes on book_record");
await tryBook("433 as list            ", p => rec(p) ? E([{ code: 433, message: "Время занято" }]) : null);
await tryBook("433 as object          ", p => rec(p) ? E({ code: 433, message: "Время занято" }) : null);
await tryBook("433 as string code     ", p => rec(p) ? E([{ code: "433", message: "Время занято" }]) : null);
await tryBook("433 in dictionary      ", p => rec(p) ? E({ datetime: [{ code: 433, message: "Время занято" }] }) : null);
await tryBook("433 in top-level errors", p => rec(p) ? J({ success: false, errors: [{ code: 433, message: "Время занято" }], meta: [] }, 422) : null);
await tryBook("433 only in meta.code  ", p => rec(p) ? J({ success: false, meta: { code: 433, message: "Время занято" } }, 422) : null);
await tryBook("meta.errors=[] + errors", p => rec(p) ? J({ success: false, errors: { code: 433, message: "Время занято" }, meta: { errors: [] } }, 422) : null);
await tryBook("dictionary field→[str] ", p => rec(p) ? E({ phone: ["Неверный формат телефона"] }) : null);
await tryBook("errors = plain string  ", p => rec(p) ? E("Что-то пошло не так") : null);
await tryBook("432 (SMS code)         ", p => rec(p) ? E([{ code: 432, message: "Код подтверждения неверен" }]) : null);
await tryBook("431                    ", p => rec(p) ? E([{ code: 431, message: "Не указан код подтверждения" }]) : null);
await tryBook("436 (no staff free)    ", p => rec(p) ? E([{ code: 436, message: "Нет сотрудников доступных для записи" }]) : null);
await tryBook("437                    ", p => rec(p) ? E([{ code: 437, message: "Пересечение времени записей" }]) : null);
await tryBook("438 (service n/a)      ", p => rec(p) ? E([{ code: 438, message: "Запись на услугу недоступна" }]) : null);
_log("\n=== HTTP failures on book_record");
for (const s of [401, 403, 404, 500, 502]) await tryBook(`HTTP ${s} JSON              `, p => rec(p) ? J({ success: false, meta: { message: "msg " + s } }, s) : null);
await tryBook("HTTP 500 with HTML body    ", p => rec(p) ? new Response("<html>Bad gateway</html>", { status: 502 }) : null);
await tryBook("HTTP 200 with HTML body    ", p => rec(p) ? new Response("<html>challenge</html>", { status: 200 }) : null);
await tryBook("HTTP 200 success:false     ", p => rec(p) ? J({ success: false, meta: { message: "Ошибка внутри 200" } }, 200) : null);
await tryBook("HTTP 201, data: []         ", p => rec(p) ? J({ success: true, data: [], meta: [] }, 201) : null);
await tryBook("HTTP 201, data: null       ", p => rec(p) ? J({ success: true, data: null, meta: [] }, 201) : null);
{ let k = 0; await tryBook("429 once then OK           ", p => rec(p) && k++ === 0 ? J({ success: false, meta: { message: "Too Many Requests" } }, 429) : null); _log("   → book_record calls: " + h.ALT.calls.filter(x => x.startsWith("POST /book_record")).slice(-2).length + ", records: " + h.ALT.records.length); }
await tryBook("429 twice                  ", p => rec(p) ? J({ success: false, meta: { message: "Too Many Requests" } }, 429) : null);
await tryBook("network error / timeout    ", p => { if (rec(p)) throw new Error("aborted"); return null; });
_log("\n=== failures on the fresh re-check (book_times with service_ids)");
for (const s of [401, 403, 404, 500]) await tryBook(`re-check HTTP ${s}          `, p => fresh(p) ? J({ success: false, meta: { message: "msg " + s } }, s) : null);
await tryBook("re-check 429 twice         ", p => fresh(p) ? J({ success: false, meta: { message: "Too Many Requests" } }, 429) : null);
await tryBook("re-check network error     ", p => { if (fresh(p)) throw new Error("aborted"); return null; });
await tryBook("re-check says slot is gone ", p => fresh(p) ? J({ success: true, data: [{ time: "11:00", datetime: `${D1}T11:00:00+05:00` }], meta: [] }) : null);
await tryBook("re-check returns 'time' as 10:00:00", p => fresh(p) ? J({ success: true, data: [{ time: "10:00:00", datetime: `${D1}T10:00:00+05:00` }], meta: [] }) : null);
