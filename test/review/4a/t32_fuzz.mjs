// Случайные служебные строки и ответы ИИ в разных состояниях чата: нет ли исключений, мусора в тексте, утечки служебных строк.
import { chat, mem, ALT, TG, days, env, LOG, G, hist, prof, leads, KVFAIL } from "./h.mjs";
const { D0, D1, D2 } = days();
LOG.quiet = true;
let seed = +process.env.SEED || 20261003;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const NAMES = ["Тимур", "тимур", "Тимур Ахметов", "Алихан", "Айгүл", "Жанар", "Жанат", "Timur", "", "…", "не указано", "Клиент", "Тимур и Алихан", "Тимур, Алихан", "Тимур.", "Тимура", "A", "Тест", "Тимур [VIP]", "Тимур; Алихан", "О'Нил", "Анна-Мария", "😀", "Тимур\tАхметов", "x".repeat(200), "Имя", "undefined", "null", "$&", "(.*)", "Тимур: сын"];
const PHONES = ["указан", "+7 702 111 22 33", "", "нет", "8 (702) 111-22-33", "702 111 22 33", "+7 700 000 00 40", "номер", "12345"];
const SERV = ["Мужская стрижка", "мужская стрижка", "Стрижка", "Оформление бороды", "Мужская стрижка | Оформление бороды", "Мужская стрижка + борода", "Маникюр", "", "стрижка, борода", "Детская стрижка — от 4 000 ₸, около 45 мин", "(.*)", "x".repeat(300), "Мужская стрижка: Время: 10:00"];
const STAFF = ["любой", "Арман", "Ерлан", "к Арману", "Арман (топ-барбер)", "", "Вася", "не важно", "any", "Арман или Ерлан", "—"];
const DATES = [D1, D2, D0, "завтра", "послезавтра", "сегодня", "04.10", "4 октября", "2026-13-45", "2026-11-31", "суббота", "", "2025-01-01", "2030-01-01", "31.12.2026", "вчера", "04/10/2026", "NaN", "0000-00-00"];
const TIMES = ["10:00", "9:30", "09:30", "11.00", "в 13:00", "15:00:00", "16:00", "12:00", "25:00", "утром", "", "10", "10:00-11:00", "завтра, 10:00", "04.10, 11.00", "23:59", "00:00", "7:5", "10:00 [уточнить]", "10:00; Имя: Вася"];
const KEYS = ["Имя", "Телефон", "Услуга", "Мастер", "Дата", "Время"];
const SEP = ["; ", "; ", "; ", ", ", ";", " ; ", ". ", " | "];
const TAGB = ["[ЗАЯВКА]", "[ЗАЯВКА]", "[заявка]", "[ ЗАЯВКА ]", "[Заявка]"], TAGC = ["[ОТМЕНА]", "[ОТМЕНА]", "[отмена]", "[ Отмена ]"];
const TEXTS = ["Записала вас.", "Переношу.", "Отменяю.", "Хорошо!", "", "Вы записаны на завтра.", "Отменила вашу запись.", "Перенесла.", "Что-то ещё?", "Мужская стрижка от 6 000 ₸.", "Администратор перезвонит вам."];
const bookLine = () => { const sep = pick(SEP); const vals = { "Имя": pick(NAMES), "Телефон": pick(PHONES), "Услуга": pick(SERV), "Мастер": pick(STAFF), "Дата": pick(DATES), "Время": pick(TIMES) }; let ks = KEYS.filter(() => rnd() > 0.12); if (rnd() < 0.15) ks = ks.sort(() => rnd() - 0.5); return pick(TAGB) + " " + ks.map(k => (rnd() < 0.1 ? k.toLowerCase() : k) + ": " + vals[k]).join(sep); };
const cancelLine = () => { const r = rnd(); if (r < 0.4) return pick(TAGC); const parts = []; if (rnd() < 0.7) parts.push("Имя: " + pick(NAMES)); if (rnd() < 0.5) parts.push("Дата: " + pick(DATES)); if (rnd() < 0.5) parts.push("Время: " + pick(TIMES)); return pick(TAGC) + " " + parts.join(pick(SEP)); };
const reply = () => { const lines = [pick(TEXTS)]; const nb = pick([0, 0, 1, 1, 1, 2, 3, 4]), nc = pick([0, 0, 0, 1, 1, 2]); for (let i = 0; i < nc; i++) lines.push(cancelLine()); for (let i = 0; i < nb; i++) lines.push(bookLine()); if (rnd() < 0.1) lines.push(pick(TEXTS)); if (rnd() < 0.08) return lines.join(" "); return lines.join("\n"); };
const USER = ["Тимур, +7 702 111 22 33, стрижка завтра в 10:00", "Отмените запись", "Перенесите на 13:00", "да", "и сына Алихана на 11:00", "yes please", "Иә, жазыңыз", "а сколько стоит?", "702 111 22 33", "Запишите меня на завтра"];
const STATES = ["none", "book", "book2", "pend", "down", "noslots", "past"];
let N = +process.env.N || 1500, exc = 0, junk = 0, leak = 0, empty = 0, n = 0, locN = 0;
const problems = new Map();
const note = (k, d) => { if (!problems.has(k)) problems.set(k, []); if (problems.get(k).length < 2) problems.get(k).push(d); };
for (let i = 0; i < N; i++) {
  const st = pick(STATES), sid = "z" + (++n);
  env.ALTEGIO_LOC_ALT = st === "down" ? String(5000 + (++locN)) : st === "noslots" ? "4999" : "4001";
  ALT.loc["4999"] = { dates: [] };
  ALT.down = st === "down";
  const profile = { phone: rnd() < 0.8 ? "+77021112233" : undefined, name: rnd() < 0.7 ? "Тимур" : undefined };
  const mk = (name, date, time, id) => ({ name, date, time, services: "Мужская стрижка", staffName: rnd() < 0.5 ? "Арман" : "", loc: +env.ALTEGIO_LOC_ALT, record_id: id, record_hash: rnd() < 0.9 ? "hash" + id : "", leadId: "L" + id });
  if (st === "book" || st === "down") profile.bookings = [mk("Тимур", D1, "10:00", 900001 + i)];
  if (st === "book2") profile.bookings = [mk("Тимур", D1, "10:00", 900001 + i), mk(pick(["Алихан", "Тимур", "Тимур Ахметов", "Жанар"]), pick([D1, D2]), pick(["11:00", "13:00"]), 800001 + i)];
  if (st === "past") profile.bookings = [mk("Тимур", D0, "11:45", 700001 + i), mk("Тимур", "2026-09-30", "10:00", 600001 + i)];
  if (st === "pend") { profile.pend = [{ key: `${D1}|11:00|тимур`, name: "Тимур", maybe: rnd() < 0.5, service: "Мужская стрижка", date: D1, time: "11:00", raw: "", leadId: "seedlead2" }, { key: "||тимур", name: "Тимур", service: "", date: "", time: "", raw: "" }]; profile.adminLeads = pick([1, 5, 6]); }
  mem.set(`h:web:alt:${sid}`, JSON.stringify({ n: 2, turns: [{ role: "user", text: "Здравствуйте" }, { role: "model", text: "Здравствуйте!" }], profile }));
  // лимиты локации не должны мешать: чистим счётчики
  for (const k of [...mem.keys()]) if (k.startsWith("bk:")) mem.delete(k);
  ALT.postFail = pick([0, 0, 0, 0, 500]); ALT.taken = rnd() < 0.08; ALT.needCode = rnd() < 0.06; ALT.delFail = pick([0, 0, 0, 404, 500]); ALT.noHash = rnd() < 0.05;
  const u = pick(USER), a = reply();
  const r = await chat(sid, u, a);
  const ctxInfo = { st, u, a, reply: r.reply, thrown: r.thrown };
  if (r.thrown || r.httpStatus) { exc++; note("исключение", ctxInfo); continue; }
  if (typeof r.reply !== "string" || !r.reply.trim()) { empty++; note("пустой ответ", ctxInfo); continue; }
  const lit = (r.reply.match(/undefined|null|NaN|\[object/g) || []).filter(w => !a.includes(w)); // «NaN» и «undefined» из самого ответа ИИ (так задан прогон) не считаем
  if (lit.length) { junk++; note("undefined/null/NaN в тексте (не из ответа ИИ)", ctxInfo); }
  { const m = r.reply.match(/: ,|: \.|\(\)| ,|  |\( |, \./); if (m) note("пустое место / лишние знаки в тексте: «" + m[0] + "» · состояние " + st + " · " + (r.reply.match(/^[^:]{0,40}/) || [""])[0], ctxInfo); }
  if (/\[\s*(ЗАЯВКА|ОТМЕНА)|Имя:|Телефон:|Мастер:/i.test(r.reply)) { leak++; note("служебная строка или её поля видны клиенту", ctxInfo); }
  const h = hist(sid);
  if (!h || !Array.isArray(h.turns)) note("история не сохранена", ctxInfo);
  const p = (h || {}).profile || {};
  if ((p.bookings || []).some(b => !b || !b.date || !b.time || !b.name)) note("битая запись в profile.bookings", { ...ctxInfo, bookings: p.bookings });
  if (r.lead && (JSON.stringify([r.lead.name, r.lead.service, r.lead.time, r.lead.phone]).match(/undefined|null|NaN/g) || []).some(w => !a.includes(w))) note("undefined/null в заявке (не из ответа ИИ)", { ...ctxInfo, lead: r.lead });
  if (r.lead && "note" in r.lead) note("note ушла в браузер", ctxInfo);
  if (JSON.stringify(r).includes("record_hash")) note("record_hash ушёл в браузер", ctxInfo);
}
ALT.down = false;
console.log(`прогонов ${N}: исключений ${exc}, пустых ответов ${empty}, undefined/null/NaN в тексте ${junk}, утечек служебных строк ${leak}`);
for (const [k, list] of problems) { console.log(`\n### ${k} — примеры (${list.length}):`); for (const d of list) console.log("   " + JSON.stringify(d).slice(0, 900)); }
