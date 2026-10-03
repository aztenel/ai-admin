// Altegio answers fine, but there is no free time at all (fully booked / no schedule for 3 weeks).
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4110" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const leads = async () => JSON.parse((await h.KV.get("leads:alt")) || "[]");
const windows = () => (h.sys().match(/Свободные окна для записи[^\n]*\n((?:- [^\n]*\n?)+)/) || ["", ""])[1].trim();

for (const [loc, label, prep] of [
  ["4111", "book_dates returns NO dates", D => { D.dates = []; }],
  ["4112", "dates exist but every day is fully booked", D => { D.times = { 0: [], 11: [], 12: [] }; }]]) {
  _log(`\n################ ${label} (loc ${loc})`);
  h.env.ALTEGIO_LOC_ALT = loc; prep(h.dataFor(loc)); h.calls.tg.length = 0;
  // (a) the LLM follows the prompt line «Свободных окон нет — предложи оставить имя и телефон для обратного звонка»
  h.gemini = ["К сожалению, свободных окон сейчас нет. Оставьте, пожалуйста, имя и телефон — администратор перезвонит и подберёт время."];
  let d = await h.chat("alt", "ns-a" + loc, "Хочу записаться на мужскую стрижку");
  _log("prompt windows: " + windows());
  _log("bot: " + d.reply);
  h.gemini = ["Спасибо, Азамат! Администратор перезвонит вам в ближайшее время."];
  d = await h.chat("alt", "ns-a" + loc, "Азамат, +7 777 123 45 67");
  _log("client: Азамат, +7 777 123 45 67\nbot: " + d.reply);
  _log(`(a) no tag from the LLM → lead: ${JSON.stringify(d.lead)} | leads in KV: ${(await leads()).length} | Telegram: ${JSON.stringify(h.calls.tg)}`);

  // (b) the LLM adds the booking tag in the Altegio format (rule «В») with the date the client asked for
  h.calls.tg.length = 0;
  h.gemini = ["К сожалению, свободных окон сейчас нет. Оставьте, пожалуйста, имя и телефон — администратор перезвонит."];
  d = await h.chat("alt", "ns-b" + loc, "Хочу записаться на мужскую стрижку завтра в 10:00");
  h.gemini = ["Спасибо, Азамат! Передала вашу просьбу.\n" + h.tag("Азамат", "Мужская стрижка", "любой", D1, "10:00")];
  d = await h.chat("alt", "ns-b" + loc, "Азамат, +7 777 123 45 68");
  _log(`(b) tag with a date → bot: ${d.reply}\n    lead: ${JSON.stringify(d.lead)} | leads in KV: ${(await leads()).length} | Telegram: ${JSON.stringify(h.calls.tg)}`);

  // (c) the LLM adds the old-style tag (rule 12) without a date
  h.calls.tg.length = 0;
  h.gemini = ["Спасибо, Азамат! Администратор перезвонит.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Время: обратный звонок"];
  d = await h.chat("alt", "ns-c" + loc, "Азамат, +7 777 123 45 69, хочу на мужскую стрижку, перезвоните");
  _log(`(c) old-style tag → bot: ${d.reply}\n    lead: ${d.lead ? d.lead.note : null} | Telegram: ${JSON.stringify(h.calls.tg).slice(0, 200)}`);
}
