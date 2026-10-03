// /altegio?loc=<mistyped>: the page silently checks (and the trial button books in) the DEFAULT location, labelled «из адреса страницы».
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "1398319" } }); // default location of the test client
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const pre = t => t.slice(t.indexOf("<pre>") + 5, t.indexOf("</pre>"));
for (const loc of ["1 234 567", "1234567 ", "№1234567", "12345O7", "1234567,", "https://n1234567.alteg.io"]) {
  h.ALT.calls.length = 0; h.ALT.records.length = 0;
  let t = await (await h.call(`/altegio?key=lk&loc=${encodeURIComponent(loc)}`)).text();
  const line = pre(t).split("\n")[1], hidden = (t.match(/name="loc" value="([^"]*)"/) || [])[1];
  t = await (await h.call("/altegio", h.form({ key: "lk", c: "", loc: hidden.replace(/&quot;/g, '"').replace(/&amp;/g, "&"), phone: "+7 701 123 45 67" }))).text();
  const where = [...new Set(h.ALT.calls.filter(x => x.startsWith("POST /book_record/")))];
  _log(`loc=${JSON.stringify(loc)} → page: «${line}» | trial button → ${where.join(", ") || "no record"} | ${(pre(t).match(/Пробная запись:[^\n]*/) || [""])[0]}`);
}
