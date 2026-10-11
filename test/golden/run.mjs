// «Золотые» переписки (REFACTORING.md, шаг 0): что решает КОД на заданный ответ ИИ — до и после переноса think() в модули.
// ИИ подменён: на каждое сообщение клиента — заранее записанный ответ (с [ЗАЯВКА], [ОТМЕНА] и т. п.).
// Запоминается то, что делает код: текст, который ушёл клиенту, заявки, запросы к Altegio, сообщения в Telegram,
// сколько раз спросили ИИ (повтор после защиты), записи и просьбы в профиле чата.
// Ожидания — test/golden/expected.json. Запуск: node test/golden/run.mjs [часть id]. SHOW=1 — показать каждый шаг.
// Поведение изменили намеренно — UPDATE=1 node test/golden/run.mjs и проверить разницу в git (это и есть «что поменялось»).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mk, net, D0, D1, D2, ALT_DEFAULT } from "../harness.mjs";
import { CASES } from "./cases.mjs";

const FILE = fileURLToPath(new URL("./expected.json", import.meta.url));
const only = process.argv.slice(2).find(a => !a.startsWith("-")) || "";
const OWNER = "owner-key-123456";

// всё, что меняется от запуска к запуску или от места сценария в списке, заменяем метками
const norm = (v, key) => typeof v === "string" ? (key === "at" && /^\d{1,2}:\d{2} /.test(v) ? "<время>" + v.slice(v.indexOf(" ")) : v) // время создания заявки: часы идут по-настоящему
  .split(D0).join("<D0>").split(D1).join("<D1>").split(D2).join("<D2>").replace(/\b1[78]\d{11}\b/g, "<ts>").replace(/wamid\.[\w.]+/g, "<wamid>")
  : typeof v === "number" && v > 1.7e12 && v < 1.9e12 ? "<ts>" // время в мс
  : key === "loc" && (typeof v === "number" || typeof v === "string") ? "<loc>" // своя локация Altegio у каждого сценария
  : Array.isArray(v) ? v.map(x => norm(x))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x, k)])) : v;

const chOf = cs => cs.ch === "ga" ? "ga" : cs.ch ? "wa" : "web";
// состояние чата: пауза, «ждёт ответа», «стоп», отказ от рассылок (только WhatsApp: веб-чат — без номера)
const stateOf = (S, cs, p, who) => ({ paused: !!(p.pausedUntil && p.pausedUntil > Date.now()), need: p.need ? p.need.why : null, stop: !!p.stop, ...(cs.ch ? { optout: S.kv.mem.has(`optout:${cs.c}:${who}`) } : {}) });
// номера заявок (случайные) — метками <заявка1>, <заявка2>… во всех строках результата
const maskLeadIds = (v, ids) => typeof v === "string" ? ids.reduce((x, id, i) => x.split(id).join(`<заявка${i + 1}>`), v)
  : Array.isArray(v) ? v.map(x => maskLeadIds(x, ids)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskLeadIds(x, ids)])) : v;
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));

async function runCase(cs) {
  net.reset(); net.altGone = []; net.altBusy = false; net.altCheckBusy = false; net.altGetFail = 0; net.altGetPlain = false; net.altJournalFail = 0;
  net.altData = cs.alt ? (() => cs.alt(ALT_DEFAULT())) : null;
  const loc = String(3000 + CASES.indexOf(cs)); // своя локация Altegio у каждого сценария: кэш расписания и лимиты не переходят из сценария в сценарий
  const env = { ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_ALT: loc, ...(cs.env || {}) };
  if (cs.ch === "wa") Object.assign(env, { ["WA_TOKEN_" + cs.c.toUpperCase()]: "tok-" + cs.c, ["APP_SECRET_" + cs.c.toUpperCase()]: "sec-" + cs.c });
  if (cs.ch === "ga") Object.assign(env, { ["GA_ID_" + cs.c.toUpperCase()]: "7105000001", ["GA_TOKEN_" + cs.c.toUpperCase()]: "ga-tok-" + cs.c, ["GA_URL_" + cs.c.toUpperCase()]: "https://7105.api.green-api.com" });
  const S = mk(env);
  const who = cs.from || "77011234567", sid = "golden-" + cs.id, ip = `10.200.${CASES.indexOf(cs)}.1`, hid = cs.ch ? who : sid;
  let mid = 0;
  const owner = S.browser();
  const steps = [];
  if (cs.passport) { // бот из паспорта: владелец сохраняет его на странице «Мои боты»
    await owner.go("/studio?key=" + OWNER);
    const r = await owner.post("/api/studio/save", { ...cs.passport, isNew: true });
    if (r.status !== 200) throw new Error("паспорт не сохранён: " + r.status + " " + (await r.text()).slice(0, 300));
  }
  for (const st of cs.steps) {
    const g0 = net.gemini.length, t0 = net.tg.length, a0 = net.alt.length, w0 = net.graph.length, ga0 = net.ga.length;
    if (st.ai !== undefined) net.ai = Array.isArray(st.ai) ? st.ai.slice() : [st.ai];
    const rec = {};
    if (st.in !== undefined) {
      rec.in = st.in;
      if (cs.ch === "wa" || cs.ch === "wa-shared") { // свой номер клиента (подпись Meta) или общий номер воркера без APP_SECRET
        await S.waText(cs.ch === "wa" ? "/wa/" + cs.c : "/", who, st.in, { secret: cs.ch === "wa" ? "sec-" + cs.c : undefined, names: { [who]: cs.waName || "" } });
        rec.out = net.graph.slice(w0).filter(g => g.body && g.body.to === who).map(g => (g.body.text && g.body.text.body) || (g.body.template ? "[шаблон " + g.body.template.name + "]" : "[" + g.body.type + "]"));
      } else if (cs.ch === "ga") {
        await S.gaText(cs.c, { id: "7105000001", token: "ga-tok-" + cs.c }, who, st.in, { idMessage: `IN-${cs.id}-${++mid}`, name: cs.waName });
        rec.out = net.ga.slice(ga0).filter(x => x.op === "sendMessage").map(x => x.body.message);
      } else {
        const r = await S.call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ c: cs.c, sid, text: st.in }) });
        const d = await r.json();
        rec.out = [d.reply];
        rec.flags = { ...pick(d, ["cancel", "cancelDone", "guard"]), ...(d.lead ? { lead: Object.keys(d.lead).sort().join(","), kind: d.lead.kind || "" } : {}), ...(d.offer ? { offer: d.offer } : {}) };
      }
    }
    if (st.net) { st.net(net); rec.net = st.note || "снаружи"; }
    if (st.admin) { // действие администратора в пульте
      if (!owner.cookie) await owner.go("/studio?key=" + OWNER);
      const ch = chOf(cs), id = hid;
      const body = typeof st.admin.body === "function" ? st.admin.body({ leads: S.leads(cs.c) }) : st.admin.body; // функция — когда нужен номер заявки
      const r = await owner.post(st.admin.path, { c: cs.c, ch, id, ...body });
      rec.admin = st.admin.path + " " + JSON.stringify({ ...body, ...(body.lead ? { lead: "<заявка>" } : {}) });
      rec.adminStatus = r.status;
      if (r.status !== (st.admin.status || 200)) rec.adminUnexpected = true; // ждали другой ответ пульта (по умолчанию 200)
      rec.out = net.graph.slice(w0).filter(g => g.body && g.body.to === who).map(g => g.body.text && g.body.text.body).concat(net.ga.slice(ga0).filter(x => x.op === "sendMessage").map(x => x.body.message));
    }
    rec.ai = net.gemini.length - g0;
    rec.altegio = net.alt.slice(a0).filter(x => !/^GET /.test(x)).map(x => x.replace(/\/\d{4,}/g, "/<n>"));
    rec.tg = net.tg.slice(t0).map(x => x.text || x.caption || "");
    rec.state = stateOf(S, cs, (S.hist(chOf(cs), cs.c, hid) || {}).profile || {}, who); // после шага (в конце сценария может быть уже другим)
    steps.push(rec);
  }
  const h = S.hist(chOf(cs), cs.c, hid) || {}, p = h.profile || {};
  const leads = S.leads(cs.c).map(l => { const { id, ts, ...rest } = l; return rest; });
  const end = {
    leads,
    bookings: (p.bookings || []).map(b => pick(b, ["name", "services", "staffName", "date", "time", "rq", "j"])),
    pend: (p.pend || []).length,
    req: p.req ? { key: p.req.key || "", ids: (p.req.ids || []).length } : null, // одна просьба — одна заявка (ключ — от текста просьбы, постоянный)
    ...stateOf(S, cs, p, who),
    turns: (h.turns || []).length,
    altRecords: net.altRecords.length, altDeleted: net.altDeleted.length
  };
  return norm(maskLeadIds({ title: cs.title, steps, end }, S.leads(cs.c).map(l => l.id).filter(Boolean)));
}

const exp = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const got = {};
let pass = 0, fail = 0, ran = 0;
const broken = [];
for (const cs of CASES) {
  if (!cs.id.includes(only)) { if (exp[cs.id]) got[cs.id] = exp[cs.id]; continue; }
  ran++;
  let r;
  try { r = await runCase(cs); } catch (e) { r = { title: cs.title, error: String((e && e.message) || e).slice(0, 300) }; console.log(`  СБОЙ ${cs.id}: ${(e && e.stack) || e}`); }
  if (r.error || r.steps.some(x => x.adminUnexpected)) broken.push(cs.id); // сбой сценария или неожиданный ответ пульта — не ожидание, а ошибка
  got[cs.id] = r;
  if (process.env.SHOW) console.log(`\n== ${cs.id}: ${cs.title}\n` + JSON.stringify(r, null, 1));
  if (process.env.UPDATE === "1") continue;
  if (!exp[cs.id]) { fail++; console.log(`  НЕТ ОЖИДАНИЯ ${cs.id} — запустите с UPDATE=1`); continue; }
  const a = JSON.stringify(exp[cs.id]), b = JSON.stringify(r);
  if (a === b) { pass++; continue; }
  fail++;
  console.log(`  ИЗМЕНИЛОСЬ ${cs.id}: ${cs.title}`);
  diff(exp[cs.id], r, "    ");
}
for (const id of Object.keys(exp)) if (!CASES.some(c => c.id === id)) { if (process.env.UPDATE === "1") continue; fail++; console.log(`  ЛИШНЕЕ ОЖИДАНИЕ ${id} — сценария больше нет`); }
if (!ran) { console.log(`Золотые переписки: ни один сценарий не подходит под «${only}»`); process.exit(1); }
if (process.env.UPDATE === "1") {
  if (broken.length) { console.log(`Золотые переписки: ожидания НЕ записаны — сбой или отказ пульта в сценариях: ${broken.join(", ")}`); process.exit(1); }
  writeFileSync(FILE, JSON.stringify(got, null, 1) + "\n");
  console.log(`Золотые переписки: ожидания записаны (${ran}) — проверьте разницу в git`);
} else console.log(`Золотые переписки (${ran}${ran < CASES.length ? " из " + CASES.length : ""}): прошло ${pass}, не прошло ${fail}`);
process.exit(fail ? 1 : 0);

// первые расхождения по путям
function diff(a, b, pad, path = "", out = { n: 0 }) {
  if (out.n >= 8) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], pad, path + "." + k, out);
    return;
  }
  out.n++;
  console.log(`${pad}${path || "."}: было ${JSON.stringify(a)}\n${pad}${" ".repeat((path || ".").length)}  стало ${JSON.stringify(b)}`);
}
