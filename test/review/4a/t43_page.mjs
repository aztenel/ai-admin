// Скрипт страницы чата: исполняем его на самодельном DOM и смотрим, какие карточки рисуются для lead / leads / cancel.
import { call, env, G, ALT, days, tag, mem } from "./h.mjs";
const html = await (await call("/?c=alt")).text();
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// ---- минимальный DOM
const mk = tag => ({ tag, children: [], className: "", textContent: "", _html: "", appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, remove() { this.removed = true; }, set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html; }, set onclick(f) { this._click = f; }, set onsubmit(f) { this._submit = f; }, scrollTop: 0, scrollHeight: 0, value: "" });
const els = { ch: mk("main"), cp: mk("div"), in: mk("input"), f: mk("form"), rs: mk("button") };
const document = { getElementById: id => els[id], createElement: mk };
const store = new Map();
const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
let nextResponse = null;
const fetchStub = async (url, init) => { if (String(url).startsWith("/api/history")) return { json: async () => ({ turns: [] }) }; return { json: async () => nextResponse }; };
const run = new Function("document", "localStorage", "fetch", "crypto", "performance", script + "\n;return { send };");
const api = run(document, localStorage, fetchStub, { randomUUID: () => "sid-1" }, { now: () => 0 });
await new Promise(s => setTimeout(s, 10));
const cards = () => els.ch.children.filter(c => c.className === "lead" && !c.removed).map(c => c.children.map(x => x.textContent).join(" | "));
const show = async (name, resp) => { els.ch.children = []; nextResponse = resp; await api.send("тест"); console.log(`\n${name}\n   ответ бота: ${els.ch.children.filter(c => c.className === "m b" && !c.removed).map(c => c.textContent).join(" / ")}\n   карточки: ${JSON.stringify(cards(), null, 0)}`); };
await show("1. одна запись в расписании", { reply: "Записала вас…", lead: { name: "Тимур", phone: "+7702", service: "Мужская стрижка", time: "завтра, в 10:00", altegio: { record_id: 1 } }, offer: [] });
await show("2. две записи (leads) + lead", { reply: "Записала…", lead: { name: "Алихан", altegio: { record_id: 2 } }, leads: [{ name: "Тимур", phone: "+7702", service: "A", time: "t1", altegio: { record_id: 1 } }, { name: "Алихан", phone: "+7702", service: "B", time: "t2", altegio: { record_id: 2 } }] });
await show("3. запись + заявка администратору", { reply: "…", lead: { name: "Данияр" }, leads: [{ name: "Тимур", altegio: { record_id: 1 } }, { name: "Данияр", phone: "+7702", service: "A", time: "t" }] });
await show("4. перенос: cancel + cancelDone + новая запись", { reply: "Перенесла…", cancel: true, cancelDone: true, lead: { name: "Тимур", altegio: { record_id: 3 } } });
await show("5. отмена передана администратору", { reply: "Передала администратору…", cancel: true, cancelDone: false, lead: null });
await show("6. заявка на звонок", { reply: "…", lead: { name: "имя не указано", phone: "+7702", service: "Перезвонить клиенту — бот не видит расписание Altegio", time: "как можно скорее" } });
await show("7. пробная запись автотеста (record_id 0) и поля с пустыми значениями", { reply: "…", lead: { name: "", phone: "", service: "", time: "", altegio: { record_id: 0 } } });
await show("8. leads: пустой массив + lead", { reply: "…", lead: { name: "Тимур", altegio: { record_id: 1 } }, leads: [] });
await show("9. попытка HTML в полях (должен остаться текстом)", { reply: "<img src=x onerror=alert(1)>", lead: { name: "<b>x</b>", service: "<script>1</script>", altegio: { record_id: 1 } } });
