// F. redact (phone followed by a time/number; IIN and card numbers must still be hidden), detectLang markers.
import * as dev from "./worker.x.mjs";
import * as main from "./worker.main.x.mjs";

const cases = [
  // [text, what must be hidden]
  ["+7 702 800 00 03 10:00", null],
  ["Азамат +7 702 800 00 03 завтра в 10", null],
  ["87011234567 15 октября", null],
  ["мой ИИН 990101300123", "990101300123"],
  ["ИИН 850101300123", "850101300123"],
  ["карта 4400 4301 2345 6789", "4400 4301 2345 6789"],
  ["карта 4400430123456789", "4400430123456789"],
  ["87011234567 990101300123", "990101300123"],                 // phone, then IIN (one space)
  ["87011234567\n990101300123", "990101300123"],                // two lines (the worker turns \n into a space before redact)
  ["+7 701 123 45 67 990101300123", "990101300123"],
  ["8 701 123 45 67 4400 4301 2345 6789", "4400 4301 2345 6789"], // phone, then card
  ["87011234567 4400430123456789", "4400430123456789"],
  ["Азамат 87011234567, ИИН 990101300123", "990101300123"],
  ["990101300123 87011234567", "990101300123"],
  ["ИИН: 990101300123, тел 8 701 123 45 67 в 15:00", "990101300123"],
  ["7 701 123 45 67 1 2 3 4 5 6 7 8 9 0 1 2", "1 2 3 4 5 6 7 8 9 0 1 2"],
];
const prep = s => s.replace(/[\u0000-\u001f]/g, " ").trim(); // same as think()
console.log("text → main | dev   (LEAK = the digits that must be hidden are still in the text sent to the LLM / stored in history)");
for (const [t, secret] of cases) {
  const a = main.redact(prep(t)), b = dev.redact(prep(t));
  const hid = s => !secret || !s.replace(/\D/g, "").includes(secret.replace(/\D/g, ""));
  const ph = s => dev.findPhone(s) || "-";
  console.log(`\n${JSON.stringify(t)}\n   main: ${JSON.stringify(a)}  phone=${ph(a)} ${hid(a) ? "" : "LEAK"}\n   dev : ${JSON.stringify(b)}  phone=${ph(b)} ${hid(b) ? "" : "LEAK  <<<<"}`);
}

console.log("\n\n=== detectLang: main | dev");
const L = [
  "salem, tis tazalau qansha turady?", "men's haircut price?", "men jazylgym keledi", "men erten kelemin", "Sizde bos uaqyt bar ma?", "bugin jazyluga bola ma",
  "kun saiyn jumys isteisizder me?", "tis emdeu kansha turady", "tisimdi tazalau kerek", "rakhmet", "Azamat +7 701 123 45 67", "Kaspi Red есть?", "ok", "Hi", "skolko stoit strizhka",
  "shash aldyru qansha", "Сәлем", "Can I book a haircut for tomorrow?", "erteng saghat 10-ga jazylamyn", "men kelmeimin", "keshiriniz, baga qandai", "10 men 11 arasynda",
];
for (const t of L) { const a = main.detectLang(t), b = dev.detectLang(t); console.log(`${a === b ? "    " : "DIFF"} ${a} | ${b}   ${t}`); }
