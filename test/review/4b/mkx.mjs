// копии worker.js с экспортом внутренних функций; имён, которых в версии нет, не экспортируем
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const D = import.meta.dirname;
const NAMES = "CLIENTS, hasClient, systemPrompt, checkReply, allowedTimes, offers, redact, normPhone, findPhone, maskPhones, wantsHuman, HANDOFF, detectLang, altText, altUniq, altBase, altDates, altTimes, altDropTimes, altDay, altWhen, thin, altNamed, altSnapshot, svTrim, svNoTail, svStems, altPickServices, altPickStaff, ANY_STAFF, nameForms, altBook, ipKey, altCall, altCache, hm, tagFields, altDateOf, altSay, altDiag, altPage, think, tooMany, esc, mins, isoDay, local, freeSlots, getSlots, clean, lowE, samePerson, caseName, exactName, ATTACK, JOKE, STOP, altLoc, notify, ALT_CLAIM, ALT_CHANGE, altFlat, altClaims, nameToks, mergeProfile".split(", ");
// копия лежит в другой папке: относительные импорты бота (./src/…, ./pult.gen.js) переводим в абсолютные
const absImports = (src, file) => src.replace(/(\bfrom\s*["'])\.\//g, "$1" + new URL("./", pathToFileURL(file)).href);
// функция есть в версии: объявлена в файле или подключена из src/ (её тоже можно экспортировать дальше)
const imported = src => [...src.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)].flatMap(m => m[1].split(",").map(x => x.trim().split(/\s+as\s+/).pop()));
const mk = (src, out) => {
  const imp = imported(src);
  const has = n => imp.includes(n) || new RegExp("(^|\\n)(async function|function|const|let) " + n + "\\b").test(src);
  let have = NAMES.filter(has), extra = "";
  if (has("altClaims")) { // новая версия: подбор услуги и мастера возвращает объект — сценариям отдаём прежний вид (список | null)
    have = have.filter(n => n !== "altPickServices" && n !== "altPickStaff");
    extra = "\nconst __svc = (s, raw) => { const r = altPickServices(s, raw); return r.list || null; };\nconst __stf = (s, raw) => { const r = altPickStaff(s, raw); return r.ask ? null : r; };\nexport { __svc as altPickServices, __stf as altPickStaff, altPickServices as altPickServicesNew, altPickStaff as altPickStaffNew };\n";
  }
  writeFileSync(out, src + "\nexport { " + have.join(", ") + " };\n" + extra);
};
const SRC = process.env.WORKER || new URL("../../../worker.js", import.meta.url).pathname;
mk(absImports(readFileSync(SRC, "utf8"), SRC), D + "/worker.x.mjs");
mk(execSync("git -C " + new URL("../../..", import.meta.url).pathname + " show e1a5fdc:worker.js", { maxBuffer: 1 << 26 }).toString(), D + "/worker.main.x.mjs");
console.log("ok");
