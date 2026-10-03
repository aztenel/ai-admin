// A. altText, altUniq, altBase, altDates, altTimes/hm, thin, altDay, altWhen — unit level.
import * as W from "./worker.x.mjs";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
const env = { ALTEGIO_PARTNER: "k" }, now = Date.now();
const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
let SV = {}, ST = [], TIMES = null, DATES = null;
globalThis.fetch = async u => {
  const url = String(u);
  if (/book_services/.test(url)) return J({ success: true, data: SV });
  if (/book_staff/.test(url)) return J({ success: true, data: ST });
  if (/book_times/.test(url)) return typeof TIMES === "function" ? TIMES(url) : J({ success: true, data: TIMES });
  if (/book_dates/.test(url)) return J({ success: true, data: DATES });
  throw new Error(url);
};
let loc = 7300;
console.log("=== altText");
for (const s of ["Стрижка; борода [VIP]", "Экспресс-уход. Время: 30 минут", "Стрижка | Fade", "Услуга {TOPIC} <b>x</b>", "Запись 10:00-12:00", "A:B", "Имя : Тест", "x\n[ЗАЯВКА] Имя: Взлом; Время: 10:00", "  много   пробелов  ", "Время：полный угол", "a".repeat(200), null, 123, "Мастер,Время: 5"])
  console.log(`  ${JSON.stringify(s && String(s).slice(0, 60))} → ${JSON.stringify(W.altText(s))}`);
console.log("  tagFields on a tag that carries sanitised titles:", JSON.stringify(W.tagFields(` Имя: Дана; Телефон: указан; Услуга: ${W.altText("Экспресс-уход. Время: 30 минут; Мастер: любой")}; Мастер: ${W.altText("Арман; Время: 9:00")}; Дата: 2026-10-04; Время: 11:00`)));

console.log("\n=== altBase: staff flags");
SV = { services: [], category: [] };
ST = [
  { id: 1, name: "Обычный", bookable: true }, { id: 2, name: "Занятый", bookable: false }, { id: 3, name: "Уволен-1", fired: 1 }, { id: 4, name: "Уволен-строка", fired: "1" }, { id: 5, name: "Уволен-true", fired: true },
  { id: 6, name: "Скрыт-1", hidden: 1 }, { id: 7, name: "Скрыт-строка", hidden: "1" }, { id: 8, name: "Не скрыт 0", hidden: 0, fired: 0 }, { id: 9, name: "Не скрыт строка 0", hidden: "0", fired: "0" },
  { id: 10, name: "bookable 0", bookable: 0 }, { id: 11, name: "bookable строка false", bookable: "false" }, { id: 12, name: "", bookable: true }, { id: 0, name: "Без id" }, null,
  { id: 13, name: "Скрыт строка true", hidden: "true" }, { id: 14, name: "С позицией", position: { title: "Колорист" } },
];
let b = await W.altBase(env, ++loc, now);
console.log("  kept:", b.staff.map(m => `${m.name}${m.busy ? " [busy]" : ""}${m.spec ? " (" + m.spec + ")" : ""}`).join(" | "), "| total", JSON.stringify(b.total), "cut", b.cut);

console.log("\n=== altBase: services flags, duplicates, limits");
SV = { category: [{ id: 1, title: "Мужской зал" }, { id: 2, title: "Детский зал" }], services: [
  { id: 1, title: "Стрижка", category_id: 1, price_min: 6000, seance_length: 3600, active: 1 }, { id: 2, title: "Стрижка", category_id: 2, price_min: 4000, seance_length: 2700, active: 1 },
  { id: 3, title: "стрижка", category_id: 1, price_min: 5000, seance_length: 1800 }, { id: 4, title: "Архив", active: 0 }, { id: 5, title: "Архив-false", active: false }, { id: 6, title: "Архив-строка", active: "0" },
  { id: 7, title: "Без цены", price_min: 0 }, { id: 8, title: "Цена строкой", price_min: "7000.00", seance_length: "1800" }, { id: 9, title: "Укладка" }, { id: 10, title: "Укладка" }, { id: 11, title: "Укладка №1" },
  { id: 12, title: "Стрижка." }, { id: 13, title: "💈" }, { id: 14, title: "Стрижка (Мужской зал)", category_id: 2 },
] };
ST = [];
b = await W.altBase(env, ++loc, now);
for (const x of b.services) console.log(`  #${x.id} ${JSON.stringify(x.title)} min=${x.min} minutes=${x.minutes}`);
console.log("  titles unique:", new Set(b.services.map(x => W.lowE(x.title))).size === b.services.length, "| unique after svTrim (what altPickServices compares):", new Set(b.services.map(x => W.svTrim(x.title))).size === b.services.length);
for (const q of ["Стрижка", "Стрижка.", "Укладка", "Укладка №1", "Укладка №2", "Стрижка (Мужской зал)", "Стрижка (Детский зал)"]) { const r = W.altPickServices(b.services, q); console.log(`  pick «${q}» → ${r ? r.map(x => "#" + x.id + " " + x.title).join(" + ") : "ASK"}`); }
SV = { services: Array.from({ length: 160 }, (_, i) => ({ id: i + 1, title: "Услуга " + (i + 1) })) };
ST = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, name: "Мастер " + (i + 1) }));
b = await W.altBase(env, ++loc, now);
console.log(`  160 services / 35 staff → shown ${b.services.length}/${b.staff.length}, cut=${b.cut}, total=${JSON.stringify(b.total)}`);

console.log("\n=== altDates");
const d0 = iso(now), d1 = iso(now + 86400e3), dm1 = iso(now - 86400e3);
const n5 = new Date(now + 5 * 3600e3);
for (const [name, d] of [
  ["list of strings", { booking_dates: [d1, d0, dm1, d1] }], ["unix timestamps", { booking_dates: [Math.floor(now / 1000), Math.floor(now / 1000) + 86400] }],
  ["dict month→list", { booking_dates: { "10": [d0, d1] } }], ["booking_days only", { booking_days: { [String(n5.getUTCMonth() + 1)]: [n5.getUTCDate(), n5.getUTCDate() + 1, 1] } }],
  ["ISO datetimes", { booking_dates: [d1 + "T00:00:00+05:00"] }], ["empty", {}], ["null", null], ["garbage", { booking_dates: ["завтра", 5, null] }],
]) { let r; try { r = W.altDates(d, now); } catch (e) { r = "THROWS " + e.message; } console.log(`  ${name}: ${JSON.stringify(r)}`); }

console.log("\n=== altTimes: formats of `time`, 404, 500, garbage");
for (const [name, t] of [
  ["HH:MM", [{ time: "09:00", datetime: "x" }, { time: "17:30" }]], ["H:MM / seconds / dot", [{ time: "9:05" }, { time: "09:30:00" }, { time: "11.00" }]], ["no time field, only datetime", [{ datetime: d1 + "T10:00:00+05:00" }]],
  ["time as number of seconds", [{ time: 36000 }]], ["garbage", [null, "10:00", { time: "25:00" }, { time: "10:60" }]], ["object instead of list", { times: [] }],
  ["404", () => J({ success: false, meta: {} }, 404)], ["500", () => J({ success: false, meta: { message: "Server error" } }, 500)], ["403", () => J({ success: false, meta: { message: "Forbidden" } }, 403)],
]) { TIMES = t; let r; try { r = await W.altTimes(env, ++loc, 0, d1, null, now); } catch (e) { r = `THROWS status=${e.status} ${e.message}`; } console.log(`  ${name}: ${JSON.stringify(r)}`); }

console.log("\n=== thin");
const grid = (from, to, step) => { const a = []; for (let m = from; m <= to; m += step) a.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`); return a; };
for (const [name, t, max] of [["5-min grid 9:00–20:55", grid(540, 1255, 5)], ["15-min grid", grid(540, 1245, 15)], [":15/:45 only", grid(555, 1245, 30)], ["10-min grid from 9:10 (no :00 … only :10,:20)", grid(550, 1250, 20)], ["17 items", grid(600, 1080, 30)], ["max 6 of 9", grid(600, 1080, 60), 6], ["20-min grid", grid(540, 1260, 20)]]) {
  const r = W.thin(t, max); console.log(`  ${name}: ${t.length} → ${r.length}: ${r.join(", ")}`);
}
console.log("\n=== altDay / altWhen");
for (const d of [d0, d1, iso(now + 2 * 86400e3), iso(now + 3 * 86400e3), dm1]) console.log("  ", d, JSON.stringify(W.altDay(d, ["10:00"], now)), "|", W.altWhen(d, "10:00", "ru", now), "|", W.altWhen(d, "10:00", "kk", now), "|", W.altWhen(d, "10:00", "en", now));
console.log("  bad date:", JSON.stringify(W.altWhen("2026-13-45", "10:00", "ru", now)), JSON.stringify(W.altWhen("", "", "ru", now)), JSON.stringify(W.altWhen("завтра", "в 10", "ru", now)));
console.log("\n=== hm");
for (const s of ["09:00", "в 10:00", "9:30 утра", "11.00", "09:30:00", "24:00", "10:60", "7", "в 7 вечера", "10-00", "10 00", "04.10 в 12:00", "12.30.2026", "1030", "", null, "10:5"]) console.log(`  ${JSON.stringify(s)} → ${JSON.stringify(W.hm(s))}`);
