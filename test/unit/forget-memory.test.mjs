// «Очистить память бота» в пульте не действовала: живая проверка владельца 19.10.2026, Winchester, номер бота (Green-API), переписка с его
// телефона. Владелец несколько раз очистил память в новом пульте, написал «меня зовут Азамат» — бот продолжил прошлый разговор: «К сожалению,
// у Тони комплекс «Premium» … не помещается… Могу записать вас к другому мастеру», на «привет» — «Здравствуйте, Азамат! Хотите записаться
// на «Premium» к другому мастеру…». Его слова: «бот не может забыть меня, сколько раз бы я не очищал ему память в пульте».
// Причины (повторены здесь на заглушках, потом исправлены; вживую после правки не проверено):
// 1) Cloudflare KV согласован не сразу: вебхук Green-API обрабатывается в другом месте сети, чем пульт, и там до ~60 с читается копия чата
//    до очистки. Бот отвечал по ней и записывал её обратно поверх очистки — очистка пропадала навсегда, пульт снова показывал старую переписку.
// 2) Очистку нажали, пока бот готовил ответ (ИИ — до 20 с): ответ по старой памяти сохранялся в чат, а слияние профиля возвращало старые
//    заявки и вопросы бота.
// 3) Пульт очищал по своей устаревшей копии чата: счётчик n у очистки и у бота совпадал, слияние не срабатывало, бот затирал очистку.
// Записи из журнала Altegio после очистки возвращаются нарочно: CRM — правда о записях (CLAUDE.md §5.1); здесь проверяется только переписка.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, worker, D1, gaPass } from "../harness.mjs";
import { altCache } from "../../src/services/integrations/altegio/booking-api.js";
import { keepAfterForget, applyForget } from "../../src/db/kv/chats.js";

const INST = { id: "7105000077", token: "ga-tok-w" };
const SV = [
  { id: 201, title: "Мужская стрижка", category_id: 1, price_min: 7000, price_max: 7000, active: 1 },
  { id: 205, title: "Комплекс «Premium»", category_id: 1, price_min: 12000, price_max: 12000, active: 1 }];
const STAFF = [{ id: 31, name: "Тони", bookable: true }, { id: 32, name: "Рауан", bookable: true }];
const DATA = { services: SV, category: [{ id: 1, title: "Мужские стрижки" }], staff: STAFF, times: { 0: ["10:00", "12:00"], 31: [], 32: ["10:00", "12:00"] } };
let LOC = 8800;
const reset = () => { net.reset(); Object.assign(net, { altGone: [], altBusy: false, altCheckBusy: false, altJournalFail: 0 }); net.altData = () => DATA; altCache.clear(); LOC++; };
const ENV = () => ({ ALTEGIO_PARTNER: "partner-key", ALTEGIO_USER_WINCHESTER: "usr-tok", ALTEGIO_LOC_WINCHESTER: String(LOC), GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, BOT_GA_WINCHESTER: "1" });
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" }); return b; };
const gaSent = to => net.ga.filter(x => x.op === "sendMessage" && x.body && x.body.chatId === to + "@c.us").map(x => x.body.message);
const asked = () => JSON.stringify(net.gemini.at(-1).contents); // переписка, которую ИИ получил с последним сообщением (факты компании — отдельно, в них есть и Тони, и Premium)
const OLD = /Premium|Тони/;
// одно место сети Cloudflare: KV отдаёт копию ключа, которую это место уже читало или само записало (вживую — до ~60 с), а не свежую
const colo = kv => {
  const cache = new Map();
  return {
    api: {
      get: async k => { if (cache.has(k)) return cache.get(k); const v = await kv.api.get(k); cache.set(k, v); return v; },
      put: async (k, v, o) => { await kv.api.put(k, v, o); cache.set(k, v); },
      delete: async k => { await kv.api.delete(k); cache.set(k, null); },
      list: o => kv.api.list(o)
    },
    expire() { cache.clear(); } // прошла минута: копии этого места устарели
  };
};
// очистка из пульта отдельным запросом, пока вебхук ещё обрабатывается (h.call ждал бы сам вебхук)
const forgetFrom = (s, cookie, id) => worker.fetch(new Request("https://bot.test/api/inbox/act", { method: "POST", headers: { cookie, origin: "https://bot.test", "content-type": "application/json" },
  body: JSON.stringify({ c: "winchester", ch: "ga", id, act: "forget" }) }), s.env, { waitUntil() {} });
// прошлый разговор о «Premium» у Тони — как у владельца до очистки
const talk = async (s, from) => {
  net.ai = ["Комплекс «Premium» идёт 1 ч 30 мин. У Тони завтра он не помещается. Записать вас к другому мастеру?"];
  await s.gaText("winchester", INST, from, "Хочу комплекс Premium к Тони на завтра");
  net.ai = ["У Тони на Premium свободного времени завтра нет. Могу предложить Рауана."];
  await s.gaText("winchester", INST, from, "а точно у Тони нельзя?");
};

test("Cloudflare KV в месте вебхука отдаёт копию до очистки: очистка не пропадает навсегда, старая переписка не возвращается ни боту, ни в пульт", async () => {
  reset();
  const s = mk(ENV()), from = "77780000010", hook = colo(s.kv), pult = colo(s.kv), hk = `h:ga:winchester:${from}`;
  s.env.KV = hook.api; await talk(s, from); // вебхуки Green-API — в одном месте сети
  s.env.KV = pult.api; const own = await login(s); // пульт владельца — в другом
  const r = await own.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "forget" });
  assert.equal(r.status, 200);
  const at = s.kv.json(hk).profile.forgot;
  assert.ok(at && !s.kv.json(hk).turns.length, "очистка записана");
  // владелец сразу пишет боту: место вебхука ещё отдаёт копию до очистки — этот ответ по старой памяти KV не исправить (ограничение, см. CLAUDE.md §2.2)
  s.env.KV = hook.api; net.ai = ["Азамат, у Тони комплекс «Premium» завтра не помещается. Записать вас к другому мастеру?"];
  await s.gaText("winchester", INST, from, "меня зовут Азамат");
  // прошла минута: копии устарели. Пульт не показывает переписку до очистки и ответ, написанный по ней
  pult.expire(); s.env.KV = pult.api;
  const view = await (await own.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.ok(!view.turns.some(t => OLD.test(t.x)), "пульт: " + JSON.stringify(view.turns));
  assert.ok(view.turns.some(t => /меня зовут Азамат/.test(t.x)), "слова клиента после очистки видны: " + JSON.stringify(view.turns));
  // следующее сообщение боту: ИИ не видит ни прошлого разговора, ни ответа по старой памяти; очистка снова на месте
  hook.expire(); s.env.KV = hook.api; net.ai = ["Здравствуйте, Азамат! Чем могу помочь?"];
  await s.gaText("winchester", INST, from, "привет");
  assert.ok(!OLD.test(asked()), "ИИ получил: " + asked());
  assert.ok(/Азамат/.test(asked()), "имя, которое клиент назвал после очистки, бот знает: " + asked());
  const h = s.kv.json(hk);
  assert.ok((h.profile.forgot || 0) >= at, "отметка очистки на месте: " + JSON.stringify(h.profile));
  assert.ok(!h.turns.some(t => (t.t || 0) < at || OLD.test(t.text)), JSON.stringify(h.turns));
});

test("очистку нажали, пока бот готовил ответ: ответ уходит клиенту, но не запоминается; старые заявки и вопросы не возвращаются", async () => {
  reset();
  const s = mk(ENV()), from = "77780000011", hk = `h:ga:winchester:${from}`, own = await login(s);
  await talk(s, from);
  { // в чате ещё заявка администратору и начатый вопрос о переносе — как бывает после разговора о записи
    const h = s.kv.json(hk);
    h.profile.pend = [{ key: "k1", at: Date.now() - 60e3, name: "Азамат", service: "Комплекс «Premium» · Тони", date: D1, time: "16:30", raw: "завтра 16:30", leadId: "L1" }];
    h.profile.cxWish = { at: Date.now() - 60e3, text: "перенесите Premium у Тони" }; h.profile.name = "Азамат";
    s.kv.mem.set(hk, JSON.stringify(h));
  }
  let done = false;
  net.ai = [async () => { if (!done) { done = true; await forgetFrom(s, own.cookie, from); } return "Азамат, у Тони комплекс «Premium» завтра не помещается. Записать вас к другому мастеру?"; },
    "Здравствуйте! Чем могу помочь?"];
  await s.gaText("winchester", INST, from, "меня зовут Азамат");
  assert.ok(done, "очистка прошла во время ответа");
  assert.ok(gaSent(from).some(t => /к другому мастеру\?$/.test(t)), "клиент не остался без ответа: " + JSON.stringify(gaSent(from)));
  const h = s.kv.json(hk);
  assert.ok(h.profile.forgot, "очистка не затёрта: " + JSON.stringify(h.profile));
  assert.ok(!h.turns.some(t => OLD.test(t.text)), "ответ по старой памяти не запомнен: " + JSON.stringify(h.turns));
  assert.equal(h.profile.pend, undefined, "заявка до очистки не вернулась");
  assert.equal(h.profile.cxWish, undefined, "вопрос о переносе до очистки не вернулся");
  assert.ok(h.profile.li > 0, "окно WhatsApp помнит");
  await s.gaText("winchester", INST, from, "привет");
  assert.ok(!OLD.test(asked()), "ИИ получил: " + asked());
});

test("пульт очищал по своей устаревшей копии чата (n совпал с ботом): ответ бота, начатый до очистки, её не затирает", async () => {
  reset();
  const s = mk(ENV()), from = "77780000012", hk = `h:ga:winchester:${from}`, pult = colo(s.kv);
  net.ai = ["Комплекс «Premium» идёт 1 ч 30 мин. У Тони завтра он не помещается. Записать вас к другому мастеру?"];
  await s.gaText("winchester", INST, from, "Хочу комплекс Premium к Тони на завтра");
  s.env.KV = pult.api; const own = await login(s);
  await own.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`); // владелец открыл чат: в его месте сети копия с n = 1
  s.env.KV = s.kv.api; net.ai = ["У Тони на Premium свободного времени завтра нет. Могу предложить Рауана."];
  await s.gaText("winchester", INST, from, "а точно у Тони нельзя?"); // n = 2 — в другом месте
  let done = false;
  net.ai = [async () => { if (!done) { done = true; s.env.KV = pult.api; await forgetFrom(s, own.cookie, from); s.env.KV = s.kv.api; } return "Азамат, у Тони Premium завтра не помещается. Записать к Рауану?"; }, "Здравствуйте! Чем могу помочь?"];
  await s.gaText("winchester", INST, from, "меня зовут Азамат");
  assert.ok(done);
  const h = s.kv.json(hk);
  assert.ok(h.profile.forgot, "очистка не затёрта: " + JSON.stringify(h.profile));
  assert.ok(!h.turns.some(t => OLD.test(t.text)), JSON.stringify(h.turns));
  await s.gaText("winchester", INST, from, "привет");
  assert.ok(!OLD.test(asked()), "ИИ получил: " + asked());
});

test("очистка без гонок: переписка забыта, окно WhatsApp, «стоп» и номер компании остаются; «сброс» клиента отметку очистки не снимает", async () => {
  reset();
  const s = mk(ENV()), from = "77780000013", hk = `h:ga:winchester:${from}`, own = await login(s);
  await talk(s, from);
  { const h = s.kv.json(hk); Object.assign(h.profile, { stop: true, pn: "555", waName: "Азамат WA", name: "Азамат" }); s.kv.mem.set(hk, JSON.stringify(h)); }
  await own.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "forget" });
  const p = s.kv.json(hk).profile;
  assert.deepEqual(Object.keys(p).sort(), ["forgot", "li", "pn", "stop", "waName"], JSON.stringify(p));
  assert.equal(s.kv.mem.get(`fg:ga:winchester:${from}`), String(p.forgot), "время очистки — и отдельным ключом");
  net.ai = ["Диалог начат заново."];
  await s.gaText("winchester", INST, from, "сброс");
  assert.equal(s.kv.json(hk).profile.forgot, p.forgot, JSON.stringify(s.kv.json(hk)));
  // удаление данных клиента (/privacy) стирает и отдельный ключ очистки: в его имени — номер чата
  assert.equal((await own.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "erase" })).status, 200);
  assert.ok(!s.kv.mem.has(`fg:ga:winchester:${from}`));
});

// ---- находки проверки исправления (19.10.2026): очистка не должна снимать то, что сделано после неё или что очистка обещает оставить
// ответ администратора с телефона номера бота (Green-API): событие outgoingMessageReceived ставит бота на паузу
const gaOut = (s, from, text, idMessage) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ typeWebhook: "outgoingMessageReceived", instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), idMessage,
    senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: text } } }) });

test("«стоп» клиента очистка памяти не снимает: бот молчит и после «Очистить память бота», «старт» возвращает бота", async () => {
  reset();
  const s = mk(ENV()), from = "77780000014", hk = `h:ga:winchester:${from}`, own = await login(s);
  await talk(s, from);
  await s.gaText("winchester", INST, from, "стоп");
  assert.ok(s.kv.json(hk).profile.stop && s.kv.json(hk).profile.pausedUntil > Date.now(), JSON.stringify(s.kv.json(hk).profile));
  await own.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "forget" });
  const n0 = gaSent(from).length;
  net.ai = ["Мужская стрижка — 7 000 ₸."];
  await s.gaText("winchester", INST, from, "а сколько стоит стрижка?");
  assert.equal(gaSent(from).length, n0, "клиент просил не писать — бот после очистки не отвечает: " + JSON.stringify(gaSent(from).slice(n0)));
  const chat = await (await own.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.ok(chat.stop && chat.paused > Date.now(), "пульт: «стоп» и пауза на месте");
  net.ai = ["Здравствуйте! Чем могу помочь?"];
  await s.gaText("winchester", INST, from, "старт");
  assert.ok(gaSent(from).length > n0 && !s.kv.json(hk).profile.stop && !(s.kv.json(hk).profile.pausedUntil > Date.now()), JSON.stringify(s.kv.json(hk).profile));
});

test("администратор ответил с телефона в первую минуту после очистки (вебхук видел копию до очистки): пауза бота остаётся", async () => {
  reset();
  const s = mk(ENV()), from = "77780000016", hook = colo(s.kv), pult = colo(s.kv), hk = `h:ga:winchester:${from}`;
  s.env.KV = hook.api; await talk(s, from);
  s.env.KV = pult.api; const own = await login(s);
  await own.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "forget" });
  s.env.KV = hook.api; await gaOut(s, from, "Добрый день! Это администратор, сейчас всё уточню", "OUT-16");
  hook.expire(); const n0 = gaSent(from).length;
  net.ai = ["Здравствуйте! Чем могу помочь?"];
  await s.gaText("winchester", INST, from, "хорошо, жду");
  assert.equal(gaSent(from).length, n0, "бот не отвечает поверх администратора: " + JSON.stringify(gaSent(from).slice(n0)));
  const h = s.kv.json(hk);
  assert.ok(h.profile.pausedUntil > Date.now(), JSON.stringify(h.profile));
  assert.ok(h.turns.some(t => t.by === "admin") && !h.turns.some(t => OLD.test(t.text)), JSON.stringify(h.turns));
});

test("переписка истекла (7 дней), отметка очистки (32 дня) осталась: то, что было после очистки, не стирается — пауза после ответа администратора с телефона", async () => {
  reset();
  const s = mk(ENV()), from = "77780000017", hk = `h:ga:winchester:${from}`, own = await login(s);
  await talk(s, from);
  await own.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "forget" });
  assert.ok(s.kv.mem.has(`fg:ga:winchester:${from}`));
  s.kv.mem.delete(hk); // прошла неделя без сообщений: хранилище удалило чат, отметка очистки ещё лежит
  await gaOut(s, from, "Здравствуйте! Это Winchester, напоминаем о себе", "OUT-17");
  assert.ok(s.kv.json(hk).profile.pausedUntil > Date.now());
  const n0 = gaSent(from).length;
  net.ai = ["Здравствуйте! Чем могу помочь?"];
  await s.gaText("winchester", INST, from, "Здравствуйте, да, хочу записаться");
  assert.equal(gaSent(from).length, n0, "бот не отвечает поверх администратора: " + JSON.stringify(gaSent(from).slice(n0)));
  const h = s.kv.json(hk);
  assert.ok(h.profile.pausedUntil > Date.now() && h.turns.some(t => t.by === "admin"), JSON.stringify(h));
});

test("очистка во время «стоп» или «старт»: пауза «стопа» идёт вместе с ним (keepAfterForget)", async () => {
  const now = Date.now(), at = now - 1000;
  // «стоп» обрабатывался, а память очистили: стоп и его пауза остаются
  let out = keepAfterForget({ forgot: at, li: at }, { li: now, stop: true, pausedUntil: now + 30 * 86400e3 }, { li: at - 5000 });
  assert.ok(out.stop && out.pausedUntil > now + 29 * 86400e3, JSON.stringify(out));
  // «старт» обрабатывался, а память очистили (очистка оставила «стоп» с паузой): бот снова отвечает
  out = keepAfterForget({ forgot: at, stop: true, pausedUntil: now + 20 * 86400e3 }, { li: now }, { stop: true, pausedUntil: now + 20 * 86400e3 });
  assert.ok(!out.stop && !out.pausedUntil, JSON.stringify(out));
  // старая копия с паузой администратора до очистки: пауза снимается (очистка возвращает бота); после очистки — остаётся
  const h1 = { n: 3, turns: [{ role: "user", text: "a", t: at - 9e3 }, { role: "model", text: "b", t: at - 8e3, by: "admin" }], profile: { pausedUntil: now + 3600e3 } };
  assert.ok(applyForget(h1, at) && !h1.profile.pausedUntil && !h1.turns.length, JSON.stringify(h1));
  const h2 = { n: 3, turns: [{ role: "user", text: "a", t: at - 9e3 }, { role: "model", text: "b", t: at + 10, by: "admin" }], profile: { pausedUntil: now + 3600e3 } };
  assert.ok(applyForget(h2, at) && h2.profile.pausedUntil && h2.turns.length === 1, JSON.stringify(h2));
});
