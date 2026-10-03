// Случайные ПОСЛЕДОВАТЕЛЬНОСТИ действий в одном чате (запись, отмена, перенос, сбои Altegio) с проверкой согласованности:
//  И1: каждая живая запись Altegio, созданная этим чатом, числится в profile.bookings — либо об её «потере» сообщено администратору;
//  И2: каждая запись из profile.bookings жива в Altegio;
//  И3: заявка на /leads без статуса и с номером записи ↔ запись жива; «отменена … удалена» ↔ запись удалена;
//  И4: клиенту не говорят «Записала / Отменила / Перенесла», если в Altegio этого не произошло.
import { chat, mem, ALT, TG, days, env, LOG, G, hist, prof, leads, at, tick } from "./h.mjs";
LOG.quiet = true;
let seed = +process.env.SEED || 777;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const { D1, D2 } = days();
const PEOPLE = ["Тимур", "Алихан", "Жанар", "Жанат", "Тимур Ахметов"];
const TIMES = ["9:30", "10:00", "11:00", "13:00", "15:00", "16:00"];
const tagB = (name, date, time) => `[ЗАЯВКА] Имя: ${name}; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${date}; Время: ${time}`;
const problems = [];
const CH = +process.env.CHATS || 150, STEPS = 14;
let locN = 6000;
for (let c = 0; c < CH; c++) {
  env.ALTEGIO_LOC_ALT = String(++locN); const loc = env.ALTEGIO_LOC_ALT;
  const sid = "st" + c, phone = "+7702" + String(1000000 + c).slice(0, 7);
  const trace = [];
  await chat(sid, `Здравствуйте, мой номер ${phone}`, "Здравствуйте! Чем помочь?");
  for (let s = 0; s < STEPS; s++) {
    for (const k of [...mem.keys()]) if (k.startsWith("bk:")) mem.delete(k); // лимиты суток здесь не проверяем
    const p0 = prof(sid) || {}, books = p0.bookings || [];
    ALT.postFail = 0; ALT.taken = false; ALT.needCode = false; ALT.delFail = 0; ALT.noHash = false;
    const f = rnd(); if (f < 0.08) ALT.postFail = 500; else if (f < 0.14) ALT.taken = true; else if (f < 0.19) ALT.needCode = true; else if (f < 0.26) ALT.delFail = pick([500, 403]);
    const act = pick(["book", "book", "book2", "cancel", "cancelName", "cancelAll2", "move", "moveName", "dupBook", "dupCancel", "claim", "ask"]);
    let u, a; const b = books.length ? pick(books) : null, who = pick(PEOPLE), t = pick(TIMES), d = pick([D1, D1, D2]);
    if (act === "book") { u = `Запишите ${who} на ${t}`; a = "Записала.\n" + tagB(who, d, t); }
    else if (act === "book2") { const w2 = pick(PEOPLE), t2 = pick(TIMES); u = "Запишите двоих"; a = "Записала.\n" + tagB(who, d, t) + "\n" + tagB(w2, d, t2); }
    else if (act === "cancel") { u = "Отмените запись"; a = "Отменяю.\n[ОТМЕНА]"; }
    else if (act === "cancelName") { const nm = b ? b.name : who; u = `Отмените запись ${nm}`; a = `Отменяю.\n[ОТМЕНА] Имя: ${nm}` + (b && rnd() < 0.5 ? `; Дата: ${b.date}; Время: ${b.time}` : ""); }
    else if (act === "cancelAll2") { u = "Отмените все записи"; a = "Отменяю.\n" + books.slice(0, 3).map(x => `[ОТМЕНА] Имя: ${x.name}; Дата: ${x.date}; Время: ${x.time}`).join("\n") || "Отменяю.\n[ОТМЕНА]"; if (!books.length) a = "Отменяю.\n[ОТМЕНА]\n[ОТМЕНА]"; }
    else if (act === "move") { u = `Перенесите на ${t}`; a = "Переношу.\n[ОТМЕНА]\n" + tagB(b ? b.name : who, d, t); }
    else if (act === "moveName") { const nm = b ? b.name : who; u = `Перенесите ${nm} на ${t}`; a = `Переношу.\n[ОТМЕНА] Имя: ${nm}` + (b ? `; Время: ${b.time}` : "") + "\n" + tagB(nm, d, t); }
    else if (act === "dupBook") { if (!b) continue; u = "Я записан?"; a = "Да.\n" + tagB(b.name, b.date, b.time); }
    else if (act === "dupCancel") { u = "Точно отменили?"; a = "Да, отменила.\n[ОТМЕНА]"; }
    else if (act === "claim") { u = "Ну что?"; a = pick(["Записала вас на завтра в 10:00.", "Отменила вашу запись.", "Перенесла вашу запись на 13:00."]); }
    else { u = "Сколько стоит стрижка?"; a = "Мужская стрижка от 6 000 ₸."; }
    const rec0 = ALT.records.filter(x => x.loc === loc).length, del0 = ALT.records.filter(x => x.loc === loc && x.deleted).length, tg0 = TG.length;
    const r = await chat(sid, u, a);
    trace.push(`${act}${ALT.postFail ? "/post500" : ""}${ALT.taken ? "/taken" : ""}${ALT.needCode ? "/sms" : ""}${ALT.delFail ? "/del" + ALT.delFail : ""}: «${a.replace(/\n/g, " ⏎ ").slice(0, 150)}» → «${(r.reply || r.thrown || "").slice(0, 170)}»`);
    const recs = ALT.records.filter(x => x.loc === loc), aliveIds = new Set(recs.filter(x => !x.deleted).map(x => x.id));
    const created = recs.length - rec0, deleted = recs.filter(x => x.deleted).length - del0;
    const p = prof(sid) || {}, bk = p.bookings || [];
    const tgs = TG.slice(tg0).join("\n");
    const bad = (k, extra) => problems.push({ k, chat: c, step: s, extra, trace: trace.slice(-4) });
    if (r.thrown || r.httpStatus) { bad("исключение", r.thrown); continue; }
    // И2
    for (const x of bk) if (x.record_id && !aliveIds.has(x.record_id)) bad("И2: в чате числится запись, которой в Altegio уже нет", `№${x.record_id} ${x.name} ${x.time}`);
    // И1 (учитываем записи, о которых администратору сказано «удалите вручную», и «возможно, записан»)
    const told = new Set([...TG.join("\n").matchAll(/запись № (\d+)\n⚠️ в Altegio НЕ удалена/g)].map(m => +m[1]));
    for (const id of aliveIds) if (!bk.some(x => x.record_id === id) && !told.has(id) && !(ALT.postFail && created)) { const rec = recs.find(x => x.id === id); if (!rec.maybeNoted) bad("И1: живая запись в Altegio не числится в чате, администратор о ней не предупреждён", `№${id} ${rec.fullname} ${rec.appointments[0].datetime.slice(0, 16)}`); rec.maybeNoted = true; }
    // И4
    if (/Записала вас|You're booked|Сізді жаздым/.test(r.reply) && created < 1) bad("И4: «Записала вас», а запись не создана", r.reply);
    if (/^Отменила вашу запись|I've cancelled|болдырмадым/.test(r.reply) && deleted < 1 && ALT.delFail !== 404) bad("И4: «Отменила», а в Altegio ничего не удалено", r.reply);
    if (/Перенесла вашу запись/.test(r.reply) && (deleted < 1 && ALT.delFail !== 404)) bad("И4: «Перенесла», а старая запись не удалена", r.reply);
    if (/\[\s*(ЗАЯВКА|ОТМЕНА)/i.test(r.reply)) bad("служебная строка видна клиенту", r.reply);
    // И3
    for (const l of leads()) if (l.altegio && l.altegio.record_id && recs.some(x => x.id === l.altegio.record_id)) {
      const alive = aliveIds.has(l.altegio.record_id);
      if (!l.status && !alive) bad("И3: заявка активна, а запись в Altegio удалена", `№${l.altegio.record_id}`);
      if (l.status === "отменена" && /удалена$/.test(l.note || "") && !/НЕ удалена/.test(l.note) && alive && ALT.delFail !== 404) bad("И3: заявка «отменена, запись удалена», а запись жива", `№${l.altegio.record_id}`);
    }
  }
}
const by = new Map(); for (const p of problems) { if (!by.has(p.k)) by.set(p.k, []); by.get(p.k).push(p); }
console.log(`чатов ${CH} × ${STEPS} шагов; нарушений: ${problems.length}`);
for (const [k, list] of by) { console.log(`\n### ${k}: ${list.length}`); for (const p of list.slice(0, 3)) { console.log(`   чат ${p.chat}, шаг ${p.step}: ${p.extra}`); for (const t of p.trace) console.log("      " + t); } }

// сводка: какое действие шага дало нарушение
const acts = new Map(); for (const p of problems) { const a = p.k.slice(0, 2) + " ← " + p.trace.at(-1).split(":")[0].split("/")[0]; acts.set(a, (acts.get(a) || 0) + 1); }
console.log("\nпо действиям: " + JSON.stringify([...acts]));
const m = problems.filter(p => /Записала вас/.test(p.k)); for (const p of m.slice(0, 2)) { console.log("   " + p.extra); for (const t of p.trace) console.log("      " + t); }
