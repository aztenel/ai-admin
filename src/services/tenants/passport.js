// @ts-check
// Паспорт бота: сборка клиента из паспорта (compileClient) и загрузка паспортов из KV (syncClients).
/** @import { Env } from "../../lib/types.js" */
import { money } from "../../lib/money.js";
import { normPhone, fmtPhone } from "../../lib/phone.js";
import { clean, lowE } from "../../lib/text.js";
import { NICHES } from "../../config/niches.js";
import { CLIENTS, BUILTIN } from "../../config/builtin-clients.js";
import { hStr } from "../schedule/slots.js";
import { altText } from "../integrations/altegio/client.js";
import { parseSchedule, DAY_SHORT } from "./parse-schedule.js";
import { parseServices } from "./parse-services.js";
import { parseRepairs } from "./parse-repairs.js";

const ID_RE = /^[a-z][a-z0-9]{1,15}$/;

const repairLine = /** @param {any} r */ r => `${r.model} | ${r.work} | ${r.min === null ? "цену назовёт мастер после диагностики" : r.min === 0 && r.max === 0 ? "бесплатно" : r.max > r.min ? `от ${money(r.min)} до ${money(r.max)} ₸` : `${r.from ? "от " : ""}${money(r.min)} ₸`}${r.term ? " | " + r.term : ""}`;
const priceText = /** @param {any} s */ s => s.min === null ? "цену называет администратор" : s.min === 0 && s.max === 0 ? "бесплатно" : (s.max > s.min ? `от ${money(s.min)} до ${money(s.max)} ₸` : `${s.from ? "от " : ""}${money(s.min)} ₸`) + (s.unit ? " " + s.unit : "");
/** @param {any} src */
function parseStaff(src) {
  return String(src || "").replace(/\r/g, "").split("\n").map(x => x.replace(/^\s*(?:[-•*·]|\d{1,2}[.)])\s+/, "").trim()).filter(Boolean).slice(0, 30).map(line => {
    const [n, ...r] = line.split(/\s+[—–-]\s+|\s*[:(]\s*/);
    return { name: altText(n, 40), role: altText(r.join(" ").replace(/\)\s*$/, ""), 60) };
  }).filter(m => m.name && /\p{L}/u.test(m.name));
}
/** @type {Record<string, number>} */
const CFG_TEXT = { repairs: 20000, pay: 500, upsell: 1200, name: 60, address: 160, kind: 60, greeting: 300, safe: 200, extra: 3000, services: 6000, staff: 1500, schedule: 400, tg: 120 };

const facts0Len = /** @param {any} F */ F => F.join("\n").length; // длина описания без прайса ремонта: у прайса свой предел (300 строк)
// паспорт → { errors, warnings, client }: client — объект для движка (как запись в CLIENTS). С ошибками бот не сохраняется
/** @param {Record<string, any>} cfg */
export function compileClient(cfg) {
  const errors = [], warnings = [], str = /** @param {any} k */ (k) => String(cfg[k] ?? "").replace(/\r/g, "").trim().slice(0, CFG_TEXT[k] || 200);
  const id = String(cfg.id || "").trim();
  if (!ID_RE.test(id)) errors.push("идентификатор: латинские буквы и цифры, от 2 до 16 знаков, начинается с буквы (например, acme)");
  else if (BUILTIN.has(id)) errors.push(`идентификатор «${id}» занят демо-ботом — выберите другой`);
  const name = clean(str("name"), 60);
  if (name.length < 2) errors.push("название компании не указано");
  if (/[«»"<>\[\]{}]/.test(name)) errors.push("в названии не должно быть кавычек и скобок — они добавятся сами");
  const nz = /** @type {Record<string, any>} */ (NICHES)[cfg.niche] || null;
  if (!nz) errors.push("ниша не выбрана");
  const N = nz || NICHES.other;
  const kind = cfg.niche === "other" && str("kind") ? clean(str("kind"), 60) : N.kind;
  const sch = parseSchedule(str("schedule"));
  errors.push(...sch.errors.map(e => "график: " + e));
  if (!sch.errors.length && sch.missing.length) warnings.push(`в графике не указаны дни: ${sch.missing.map(d => DAY_SHORT[d]).join(", ")} — бот считает их выходными`);
  const booking = ["altegio", "manual", "none"].includes(cfg.booking) ? cfg.booking : "";
  if (!booking) errors.push("не выбран способ записи");
  const loc = String(cfg.altegioLoc ?? "").trim();
  if (booking === "altegio" && !/^\d{1,12}$/.test(loc)) errors.push("запись через Altegio: укажите номер филиала (только цифры)");
  const sv = parseServices(str("services"));
  errors.push(...sv.errors);
  if (sv.list.length > 80) errors.push(`услуг ${sv.list.length} — бот уверенно работает со списком до 80 строк: объедините похожие`);
  if (booking !== "altegio" && !sv.list.length) errors.push("услуги и цены не указаны — без них бот будет отвечать «уточните у администратора»");
  if (booking === "altegio" && sv.list.length) warnings.push("услуги и цены бот берёт из Altegio — список в паспорте не используется");
  if (booking !== "altegio" && sv.list.length && sv.list.every(s => s.min === null)) warnings.push("ни у одной услуги нет цены — бот не сможет отвечать на вопрос «сколько стоит»");
  const staff = parseStaff(str("staff"));
  const rp = parseRepairs(String(cfg.repairs ?? "").slice(0, 20000));
  errors.push(...rp.errors);
  // допродажи: «Мужская стрижка → Оформление бороды». Без Altegio обе услуги должны быть в списке услуг паспорта
  const upRaw = str("upsell").split("\n").map(x => x.replace(/^\s*(?:[•*·]|\d{1,2}[.)])\s+/, "").replace(/^\s*-\s+/, "").trim()).filter(Boolean), /** @type {string[]} */ upsell = [];
  if (upRaw.length > 10) errors.push(`допродажи: ${upRaw.length} строк — оставьте не больше 10`);
  else upRaw.forEach((line, i) => {
    const m = line.split(/\s*(?:→|->|=>)\s*|\s+[—–-]\s+/);
    if (m.length !== 2 || !m[0].trim() || !m[1].trim()) { errors.push(`допродажи, строка ${i + 1}: напишите «Услуга → что предложить», например «Мужская стрижка → Оформление бороды»`); return; }
    const fix = /** @param {any} n */ n => { const t = altText(n, 80); if (booking === "altegio") return t; const f = sv.list.find(x => lowE(x.name) === lowE(t)); return f ? f.name : null; };
    const a = fix(m[0]), b = fix(m[1]);
    if (!a || !b) { errors.push(`допродажи, строка ${i + 1}: услуги «${(!a ? m[0] : m[1]).trim()}» нет в списке услуг`); return; }
    if (lowE(a) === lowE(b)) { errors.push(`допродажи, строка ${i + 1}: услуга предлагает сама себя`); return; }
    upsell.push(`${a} → ${b}`);
  });
  let phone = "";
  if (str("phone")) { phone = normPhone(str("phone")); if (!phone) errors.push("телефон компании: нужен номер полностью, например +7 701 123 45 67"); }
  else warnings.push("телефон компании не указан — бот не сможет его назвать");
  const address = clean(str("address"), 160);
  if (!address) warnings.push("адрес не указан — бот не сможет его назвать");
  const step = Math.round(+cfg.step || 60);
  if (booking === "manual" && !(step >= 15 && step <= 240)) errors.push("шаг записи — от 15 до 240 минут");
  const tg = str("tg").split(/[,\s]+/).filter(Boolean);
  if (tg.some(x => !/^-?\d{5,20}$/.test(x))) errors.push("Telegram: номер чата — это число (можно несколько через запятую), например 123456789");
  const bookDays = Math.min(7, Math.max(1, Math.round(+cfg.bookDays || 3)));
  const digest = String(cfg.digest ?? "").trim();
  const remind = ["", "day", "off"].includes(String(cfg.remind ?? "").trim()) ? String(cfg.remind ?? "").trim() : "";
  const review = String(cfg.review ?? "").trim();
  if (review && !/^https:\/\/[^\s<>"]{4,300}$/.test(review)) errors.push("ссылка на отзывы: целиком, начиная с https:// (например, ссылка на 2ГИС или Google Карты)");
  if (digest && digest !== "off" && !(/^\d{1,2}$/.test(digest) && +digest >= 6 && +digest <= 23)) errors.push("дневная сводка: час от 6 до 23 или «не присылать»");
  const payRaw = String(cfg.pay ?? "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (payRaw.length > 500) errors.push(`реквизиты для оплаты: ${payRaw.length} знаков — оставьте не больше 500`);
  else if (payRaw && /\[|\]/.test(payRaw)) errors.push("реквизиты для оплаты: без квадратных скобок");
  const extra = str("extra").split("\n").map(x => x.replace(/^\s*[-•*·]\s*/, "").trim()).filter(Boolean);
  if (/https?:\/\/|www\./i.test(extra.join(" "))) warnings.push("в «Дополнительно» есть ссылка — бот сможет называть ссылки клиентам");
  // расписание для записи заявкой: время начала через «шаг» от открытия до закрытия
  const slots = sch.hours.map(h => {
    if (!h || booking !== "manual") return [];
    const out = [];
    for (let m = Math.round(h[0] * 60); m + step <= Math.round(h[1] * 60) && out.length < 40; m += step) out.push(hStr(m / 60));
    return out;
  });
  // факты — в том же виде, что у демо-клиентов: по этому тексту отвечает ИИ и по нему же защита сверяет цены и телефон
  const F = [];
  if (address || phone) F.push("- " + [address && `Адрес: ${address}`, phone && `Телефон: ${fmtPhone(phone)}`].filter(Boolean).join(". ") + ".");
  if (booking !== "altegio" && sv.list.length) {
    F.push(`- Услуги (других нет): ${sv.list.map(s => s.name).join(", ")}.`);
    F.push(`- Цены: ${sv.list.map(s => `${s.name} — ${priceText(s)}${s.minutes ? `, около ${s.minutes} мин` : ""}`).join("; ")}.`);
  }
  if (booking !== "altegio" && staff.length) F.push(`- ${N.staffWord}: ${staff.map(m => m.role ? `${m.name} — ${m.role}` : m.name).join(", ")}.`);
  if (booking === "none") F.push("- Запись через чат не ведётся: если клиент хочет записаться, возьми имя и телефон — администратор перезвонит.");
  for (const line of extra) F.push("- " + line);
  if (facts0Len(F) > 7000) errors.push("слишком длинное описание — сократите «Дополнительно» или список услуг");
  if (rp.list.length) F.push(`- Прайс ремонта (модель | работа | цена | срок; других цен на ремонт нет):\n${rp.list.map(r => "  " + repairLine(r)).join("\n")}`);
  const facts = F.join("\n");
  const client = {
    id, name, kind, niche: cfg.niche, topic: N.topic, goal: booking === "none" ? "ответить на вопросы и взять имя и телефон для звонка администратора" : N.goal,
    greeting: clean(str("greeting"), 300) || `Здравствуйте! Я AI-администратор «${name}», отвечаю круглосуточно. ${N.hello}`,
    chips: N.chips, ...(N.medical ? { medical: true, redFlags: N.redFlags } : {}),
    hours: sch.hours, hoursText: sch.text || "уточняйте у администратора", slots, safe: clean(str("safe"), 200) || N.safe, facts,
    hidden: true, dynamic: true, real: true, bookDays, booking, services: sv.list, staffList: staff, phone, address,
    ...(booking === "altegio" && /^\d{1,12}$/.test(loc) ? { altegio: { location: +loc } } : {}),
    ...(tg.length ? { tg: tg.join(",") } : {}),
    ...(payRaw && payRaw.length <= 500 ? { pay: payRaw } : {}), ...(upsell.length ? { upsell } : {}), ...(rp.list.length ? { repairs: rp.list.length } : {}), ...(digest ? { digest } : {}), ...(remind ? { remind } : {}), ...(review && /^https:\/\/[^\s<>"]{4,300}$/.test(review) ? { review } : {}),
    ...(cfg.waPhoneId && /^\d{5,20}$/.test(String(cfg.waPhoneId).trim()) ? { waPhoneId: String(cfg.waPhoneId).trim() } : {}),
    ...(cfg.keyHash ? { keyHash: String(cfg.keyHash) } : {}), off: !!cfg.off, v: +cfg.v || 0, updated: +cfg.updated || 0
  };
  if (cfg.waPhoneId && !client.waPhoneId) errors.push("WhatsApp: «Phone number ID» — это число из кабинета Meta (не сам номер телефона)");
  return { errors, warnings, client };
}

// загрузка паспортов: раз в минуту на экземпляр воркера — одно чтение KV. Паспорт с ошибкой не загружается (остаётся прежняя версия бота)
/** @type {{ at: number, raw: string | null, ids: string[] }} */
export const DYN = { at: 0, raw: null, ids: [] };
/** @param {Env} env @param {boolean} [force] */
export async function syncClients(env, force) {
  const now = Date.now();
  if (!force && DYN.at && Math.abs(now - DYN.at) < 60e3) return;
  let raw;
  try { raw = (await env.KV.get("cfg:all")) || ""; } catch (e) { console.log("cfg read", String(e)); return; } // хранилище не читается — работаем с тем, что уже загружено
  DYN.at = now;
  if (raw === DYN.raw) return;
  let all = {};
  try { all = raw ? JSON.parse(raw) || {} : {}; } catch (e) { console.log("cfg parse", String(e)); return; }
  const next = [];
  for (const [id, cfg] of Object.entries(all)) {
    if (BUILTIN.has(id)) continue;
    try { const r = compileClient({ ...cfg, id }); if (!r.errors.length) { CLIENTS[id] = r.client; next.push(id); } else console.log("cfg errors", id, r.errors.join("; ")); }
    catch (e) { console.log("cfg compile", id, String(e)); }
  }
  for (const id of DYN.ids) if (!next.includes(id)) delete CLIENTS[id];
  DYN.ids = next; DYN.raw = raw;
}
