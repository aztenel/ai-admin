// /altegio diagnostics page for HTTP failures; chat behaviour for the same failures at snapshot time.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4300" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const pre = t => t.slice(t.indexOf("<pre>") + 5, t.indexOf("</pre>"));
let n = 0;
for (const [label, hook] of [
  ["401 everywhere", () => J({ success: false, data: null, meta: { message: "Необходима авторизация" } }, 401)],
  ["403 everywhere", () => J({ success: false, data: null, meta: { message: "Нет прав на управление филиалом" } }, 403)],
  ["404 everywhere", () => J({ success: false, data: null, meta: { message: "Филиал не найден" } }, 404)],
  ["429 everywhere", () => J({ success: false, meta: { message: "Too Many Requests" } }, 429)],
  ["500 HTML", () => new Response("<html><h1>502 Bad Gateway</h1></html>", { status: 502 })],
  ["200 but not JSON (HTML challenge)", () => new Response("<html>Just a moment...</html>", { status: 200 })],
  ["200 {success:false} without message", () => J({ success: false })],
  ["network error", () => { throw new Error("connect failed"); }]]) {
  h.ALT.hook = hook; h.calls.tg.length = 0; h.env.ALTEGIO_LOC_ALT = String(4300 + (++n));
  const t0 = Date.now();
  const page = pre(await (await h.call("/altegio?key=lk")).text()).split("\n").slice(2).join(" ⏎ ");
  h.gemini = ["Сейчас не вижу расписание. Оставьте, пожалуйста, имя и телефон."];
  const d = await h.chat("alt", "dh" + n, "Есть время завтра?");
  const sys = h.sys();
  _log(`${label}\n   /altegio: ${page}\n   chat: schedule rules in prompt=${sys.includes("Запись в расписание")} | windows: ${(sys.match(/Свободные окна для записи[^\n]*\n([^\n]*)/) || ["", ""])[1]} | services: ${(sys.match(/Услуги для записи[^\n]*\n([^\n]*)/) || ["", "-"])[1]} | TG: ${JSON.stringify(h.calls.tg.map(x => x.split("\n")[1]))} | ${Date.now() - t0} ms`);
}
h.ALT.hook = null;
delete h.env.ALTEGIO_PARTNER; h.calls.tg.length = 0;
h.gemini = ["Оставьте имя и телефон."]; const d = await h.chat("alt", "dh99", "Есть время завтра?");
_log("no ALTEGIO_PARTNER secret, chat /?c=alt (location is hard-coded in CLIENTS.alt): TG: " + JSON.stringify(h.calls.tg));
