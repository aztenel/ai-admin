// altSnapshot: which master does the code consider «named by the client» (prefix match on the first word of the name)?
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4210" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
const block = () => { const m = h.sys().match(/Свободное время мастера ([^\n]*?) \(к нему[^\n]*\n((?:- [^\n]*\n?)+)/); return m ? `«${m[1]}» → ${m[2].trim().replace(/\n/g, " | ")}` : "(no master block)"; };
async function ask(loc, text) { h.env.ALTEGIO_LOC_ALT = loc; h.gemini = ["Здравствуйте!"]; await h.chat("alt", "n" + (++n), text); _log(`  «${text}»\n      named: ${block()}`); }

_log("=== A. staff Арман (free 11:00, 13:00), Ерлан (free 9:30); any master: 9:30, 10:00, 11:00, 13:00");
await ask("4210", "Хочу к Арману завтра");
await ask("4210", "Здравствуйте, меня зовут Арман, нужна стрижка завтра в 10:00");           // the CLIENT is called Арман
await ask("4210", "Запишите моего сына Ерлана на детскую стрижку завтра в 10:00");            // the client's son is called Ерлан
await ask("4210", "Я фармацевт, работаю допоздна");
await ask("4210", "Меня стриг Арман, но теперь хочу к Ерлану");
await ask("4210", "Хочу к Ерлану, хотя нет, лучше к любому мастеру");
await ask("4210", "к арманбеку");
await ask("4210", "армани костюм, ерланга университет");

_log("\n=== B. two masters with the same first name: «Айгерим Сериккызы» id 31 (free 10:00) and «Айгерим Ахметова» id 32 (free 15:00)");
let D = h.dataFor("4211"); D.staff = [{ id: 31, name: "Айгерим Сериккызы", bookable: true }, { id: 32, name: "Айгерим Ахметова", bookable: true }]; D.times = { 0: ["10:00", "15:00"], 31: ["10:00"], 32: ["15:00"] };
await ask("4211", "Хочу к Айгерим");
await ask("4211", "Хочу к Айгерим Ахметовой завтра");

_log("\n=== C. names with a prefix word: «Барбер Ерлан» id 41, «Барбер Арман» id 42; and short female names in oblique cases");
D = h.dataFor("4212"); D.staff = [{ id: 41, name: "Барбер Ерлан", bookable: true }, { id: 42, name: "Барбер Арман", bookable: true }, { id: 43, name: "Яна", bookable: true }, { id: 44, name: "Анна", bookable: true }]; D.times = { 0: ["10:00", "15:00"], 41: ["10:00"], 42: ["15:00"], 43: ["10:00"], 44: ["15:00"] };
await ask("4212", "Это барбершоп? Нужна стрижка");
await ask("4212", "Хочу к Арману");
await ask("4212", "Хочу к Яне");
await ask("4212", "Хочу к Анне");
await ask("4212", "Мастер Яна работает завтра?");
