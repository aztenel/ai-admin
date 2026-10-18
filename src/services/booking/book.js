// @ts-check
// Запись в Altegio: снимок расписания для подсказки ИИ (altSnapshot) и создание записи (altBook); настройки клиента altLoc, altSelfCancel.
/** @import { Env, Client } from "../../lib/types.js" */
import { altBase, altCache, altDates, altTimes, altDropTimes, altRecord } from "../integrations/altegio/booking-api.js";
import { ALT_TTL, ALT_DAYS } from "../../config/constants.js";
import { altCall } from "../integrations/altegio/client.js";
import { isoDay, mins, hm, TZ, local } from "../../lib/time.js";
import { altUserKey } from "./journal.js";
import { altDay } from "./replies.js";
import { altNamed, altPickServices, altPickStaff, altServiceWanted, altServicesLike, altServiceHint } from "./pick.js";
import { gridStep, durGroups, askedTimes, fitBlock, fitStarts, nearest, durStr, withDurations } from "./fit.js";
import { money } from "../../lib/money.js";
import { clean } from "../../lib/text.js";
import { svTrim } from "../../lib/names.js";
import { altEmailErr, ALT_EMAIL_TIP } from "../integrations/altegio/errors.js";

// ================= Altegio: запись в расписание =================
// Кто отменяет и переносит записи. По умолчанию — администратор: бот в расписании ничего не удаляет, а передаёт ему просьбу клиента.
// Бот отменяет и переносит сам, только если это включено: altegio.selfCancel в блоке клиента или Text ALTEGIO_SELF_CANCEL = 1 (для одного клиента — ALTEGIO_SELF_CANCEL_<ID>)
/** @param {Env} env @param {Client} c */
export const altSelfCancel = (env, c) => {
  const v = env["ALTEGIO_SELF_CANCEL_" + String(c.id).toUpperCase()] ?? env.ALTEGIO_SELF_CANCEL;
  return v != null && String(v).trim() !== "" ? /^(1|true|yes|да)$/i.test(String(v).trim()) : !!(c.altegio && c.altegio.selfCancel);
};
// Режим «проверка без записи»: бот находит окно и проверяет запись через book_check, но в журнал Altegio ничего не пишет.
// Нужен для показов на настоящих данных чужого бизнеса (Winchester, 14.10.2026), чтобы чат не занимал им живые окна.
// Включается altegio.dry в блоке клиента; для одного клиента переопределяется Text ALTEGIO_DRY_<ID> = 1 или 0.
/** @param {Env} env @param {Client} c */
export const altDry = (env, c) => {
  const v = env["ALTEGIO_DRY_" + String(c.id).toUpperCase()];
  return v != null && String(v).trim() !== "" ? /^(1|true|yes|да)$/i.test(String(v).trim()) : !!(c.altegio && c.altegio.dry);
};
// Пробные записи — только в следующем месяце и только в дни, где в журнале нет ни одной записи: проба не занимает живые окна ближайших дней
// (условие владельца при включении настоящей записи Winchester, 19.10.2026). Это веб-чат (его клиенты не видят: кнопки сайта ведут в WhatsApp)
// и пробная запись на /altegio. Включается altegio.trialNextMonth; для одного клиента — Text ALTEGIO_TRIAL_<ID> = 1 или 0
/** @param {Env} env @param {Client} c */
export const altTrial = (env, c) => {
  const v = env["ALTEGIO_TRIAL_" + String(c.id).toUpperCase()];
  return v != null && String(v).trim() !== "" ? /^(1|true|yes|да)$/i.test(String(v).trim()) : !!(c.altegio && c.altegio.trialNextMonth);
};
// дни следующего месяца, открытые для записи, без единой записи в журнале (журнал читается ключом пользователя; без ключа — просто дни месяца)
// userKey — ключ пользователя, если его ещё нет в переменных (страница /altegio/user)
/** @param {Env} env @param {Client} c @param {number} loc @param {number} nowMs @param {number} [max] @param {string} [userKey] @returns {Promise<string[]>} */
export async function altTrialDates(env, c, loc, nowMs, max = ALT_DAYS, userKey = "") {
  const k = "dt:" + loc + ":" + max, hit = userKey ? null : altCache.get(k);
  if (hit && Math.abs(nowMs - hit.at) < ALT_TTL) return hit.v;
  const t = local(nowMs), y = t.getUTCMonth() === 11 ? t.getUTCFullYear() + 1 : t.getUTCFullYear(), m = (t.getUTCMonth() + 1) % 12; // m — следующий месяц, с нуля
  const mm = String(m + 1).padStart(2, "0"), from = `${y}-${mm}-01`, to = `${y}-${mm}-${String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  const dates = altDates(await altCall(env, "GET", `/book_dates/${loc}?date_from=${from}&date_to=${to}`), nowMs).filter(/** @param {string} d */ d => d >= from && d <= to);
  const user = userKey || altUserKey(env, c), busy = new Set();
  if (user) for (let pg = 1; pg <= 10; pg++) {
    const arr = await altCall(env, "GET", `/records/${loc}?start_date=${from}&end_date=${to}&count=200&page=${pg}`, null, user), list = Array.isArray(arr) ? arr : [];
    for (const r of list) if (r && r.deleted !== true && r.deleted !== 1) busy.add(String(r.datetime || r.date || "").slice(0, 10));
    if (list.length < 200) break;
  }
  const v = dates.filter(/** @param {string} d */ d => !busy.has(d)).slice(0, max);
  altCache.set(k, { at: nowMs, v });
  return v;
}

/** @param {Env} env @param {Client} c @returns {number} */
export const altLoc = (env, c) => {
  const v = env["ALTEGIO_LOC_" + String(c.id).toUpperCase()];
  if (v != null && String(v).trim() !== "") return /^\d{1,12}$/.test(String(v).trim()) && +v > 0 ? +v : -1; // опечатка в номере — это сбой настройки, а не «расписания нет»
  return +((c.altegio && c.altegio.location) || 0) || 0;
};

// Время без услуги — любое свободное начало. Если по услуге Altegio время не отдал, оставляем только начала, после которых мастер
// свободен всю длительность услуги: следующие начала с шагом расписания идут подряд (11:00 при записи в 11:30 на час — не подходит)
/** @param {any[]} v @param {number} m */
export function altFits(v, m) {
  if (!m || v.length < 2) return v;
  const set = new Set(v.map(x => mins(x.time))), all = [...set].sort((a, b) => a - b);
  let step = Infinity; for (let i = 1; i < all.length; i++) step = Math.min(step, all[i] - all[i - 1]);
  if (!(step >= 5 && step < m)) return v;
  return v.filter(x => { const t = mins(x.time); for (let k = step; k < m; k += step) if (!set.has(t + k)) return false; return true; });
}

// задачи по n одновременно, результат — как у Promise.allSettled. Altegio принимает не больше 5 запросов в секунду с одного адреса
// (developer.alteg.io): время каждого мастера на три дня одним залпом — это 20+ запросов и ответы 429
/** @template T @param {(() => Promise<T>)[]} tasks @param {number} n @returns {Promise<PromiseSettledResult<T>[]>} */
async function settledBy(tasks, n) {
  /** @type {PromiseSettledResult<T>[]} */
  const out = new Array(tasks.length);
  let i = 0;
  const run = async () => { while (i < tasks.length) { const k = i++; try { out[k] = { status: "fulfilled", value: await tasks[k]() }; } catch (e) { out[k] = { status: "rejected", reason: e }; } } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, run));
  return out;
}

// в подсказке ИИ хватает до 16 вариантов на день: ровные часы и половины, а если всё равно много — равномерно по всему дню
/** @param {string[]} times @param {number} [max] */
export function thin(times, max = 16) {
  let t = times;
  if (t.length > max) { const x = t.filter(v => /:(00|30)$/.test(v)); if (x.length >= 4) t = x; }
  if (t.length > max) { const x = t.filter(v => /:00$/.test(v)); if (x.length >= 4) t = x; }
  if (t.length > max) t = Array.from({ length: max }, (_, i) => t[Math.round(i * (t.length - 1) / (max - 1))]);
  return t;
}

// снимок расписания для одного сообщения: услуги, мастера, свободное время
// mode.trial — пробный чат: дни следующего месяца без записей (altTrialDates)
/** @param {Env} env @param {Client} c @param {number} nowMs @param {string} userText @param {{ trial?: boolean }} [mode] */
export async function altSnapshot(env, c, nowMs, userText, mode = {}) {
  const loc = altLoc(env, c);
  const base0 = await altBase(env, loc, nowMs), base = { ...base0, services: withDurations(base0.services, c.altegio && c.altegio.durations) }; // длительность — из кода, если задана
  const dk = "d:" + loc, hit = altCache.get(dk);
  let dates;
  if (mode.trial) dates = await altTrialDates(env, c, loc, nowMs);
  else if (hit && Math.abs(nowMs - hit.at) < ALT_TTL) dates = hit.v;
  else {
    dates = altDates(await altCall(env, "GET", `/book_dates/${loc}?date_from=${isoDay(nowMs)}&date_to=${isoDay(nowMs + 21 * 86400e3)}`), nowMs).slice(0, ALT_DAYS);
    altCache.set(dk, { at: nowMs, v: dates });
  }
  // услуга уже названа — время спрашиваем с ней (Altegio тогда учитывает её длительность); не вышло или пусто — как раньше, без услуги
  // Одно название у нескольких услуг (барбер и шеф-барбер) — спрашиваем по каждой отдельно и объединяем: мастеру, который эту услугу не оказывает, Altegio отвечает 404 (altTimes → пусто).
  // Длительности у них должны совпадать, иначе не угадываем.
  // Услуга не названа — время считаем по основной услуге бизнеса (altegio.mainService, у Winchester — «Мужская стрижка», 1 ч): без услуги
  // Altegio отдаёт любое свободное начало, и бот предлагал 11:00 при записи у мастера в 11:30 (живой показ Winchester, 18.10.2026)
  let svFound = altServiceWanted(base.services, userText), svMain = false;
  if (!svFound.length && c.altegio && c.altegio.mainService) { svFound = altServiceWanted(base.services, c.altegio.mainService); svMain = svFound.length > 0; }
  // каждую подходящую услугу спрашиваем отдельно: у каждой своя длительность, у мастера — свои услуги; список времени — объединение
  const svAsk = svFound.length ? altServicesLike(base.services, svFound).map(/** @param {any} x */ x => [x.id]) : [];
  // самая короткая длительность названной услуги; услуга не узнана (название в Altegio другое) — основная длительность бизнеса (altegio.mainMinutes)
  const svMins = svFound.map(/** @param {any} x */ x => x.minutes || 0).filter(Boolean);
  const svMin = svMins.length ? Math.min(...svMins) : +((c.altegio && c.altegio.mainMinutes) || 0) || 0;
  const read = async (/** @type {any} */ staffId, /** @type {string[]} */ list) => {
    const one = async (/** @type {string} */ d) => {
      if (!svAsk.length) return altTimes(env, loc, staffId, d, null, nowMs).then(v => altFits(v, svMin)); // без услуги — только окна на всю длительность
      // одна и та же услуга у барберов и у шеф-барбера — разные услуги в Altegio; мастер, который одну из них не оказывает, может ответить
      // ошибкой — это не повод выбросить ответ по другой и показать время без учёта длительности (18.10.2026: «Отец и сын» к Тони в 17:00 при записи в 17:30)
      const parts = await Promise.allSettled(svAsk.map(ids => altTimes(env, loc, staffId, d, ids, nowMs)));
      const ok = parts.filter(r => r.status === "fulfilled");
      if (!ok.length) throw /** @type {any} */ (parts[0]).reason;
      const seen = new Set();
      return ok.flatMap(r => /** @type {any} */ (r).value).filter(/** @param {any} x */ x => !seen.has(x.time) && seen.add(x.time)).sort(/** @param {any} a @param {any} b */ (a, b) => mins(a.time) - mins(b.time));
    };
    let rs = await Promise.allSettled(list.map(one));
    // время по услуге не читается совсем — как раньше, время без услуги (запись всё равно проверяется с услугой в altBook).
    // Пусто на все дни у выбранного мастера — это правда «нет окна на эту услугу», а не повод показать короткие промежутки
    if (svAsk.length && (rs.every(r => r.status === "rejected") || (!staffId && rs.every(r => r.status === "fulfilled" && !r.value.length)))) rs = await Promise.allSettled(list.map(d => altTimes(env, loc, staffId, d, null, nowMs).then(v => altFits(v, svMin))));
    return { days: rs.map((r, i) => r.status === "fulfilled" ? altDay(list[i], r.value.map(/** @param {any} x */ x => x.time), nowMs) : null).filter(d => d && d.times.length),
      failed: list.filter((d, i) => rs[i].status === "rejected"), error: (rs.find(r => r.status === "rejected") || {}).reason };
  };
  const any = await read(0, dates);
  if (dates.length && any.failed.length === dates.length) throw any.error; // время не читается совсем — это сбой, а не «свободных окон нет»
  let /** @type {any} */ named = altNamed(base.staff, userText), /** @type {any} */ own = null;
  /** @type {any[]} */
  let ownFailed = [];
  if (named) { own = await read(named.id, dates); ownFailed = own.failed; if (own.failed.length && !own.days.length) { own = null; named = null; } } // время мастера не читается — не выдаём это за «у него занято»

  // день, о котором речь («сегодня», «завтра», «послезавтра» в последних сообщениях клиента)
  const msgs = String(userText || "").split(" \n ");
  const relOf = /** @param {string} x */ x => /послезавтра|бүрсігүні|day after tomorrow/i.test(x) ? "послезавтра" : /завтра|ертең|tomorrow/i.test(x) ? "завтра" : /сегодня|бүгін|today/i.test(x) ? "сегодня" : "";
  const rel = relOf(msgs[msgs.length - 1]) || relOf(msgs[msgs.length - 2] || "");

  // Проверка длительности (altegio.fitCheck): свободные начала без услуги — у названного мастера или у каждого мастера, если клиент
  // мастера не назвал (тогда, если назван день, — только на этот день: у Altegio предел запросов). По ним код считает, какие начала
  // подходят услуге каждой длительности (fit.js). Нужно и для записи (altBook)
  /** @type {{ step: number, staff: Record<string, Record<string, string[]>> } | null} */
  let fit = null; /** @type {any[]} */ let fitDays = []; /** @type {Map<string, any> | null} */ let fitBad = null;
  if (c.altegio && c.altegio.fitCheck && base.services.some(/** @param {any} x */ x => x.minutes)) {
    const who = named ? [named] : base.staff.length <= 8 ? base.staff : [];
    const relDays = !named && rel ? dates.filter(/** @param {string} d */ d => altDay(d, [], nowMs).rel === rel) : [], days = relDays.length ? relDays : dates;
    const jobs = /** @type {{ d: string, id: string }[]} */ (days.flatMap(/** @param {string} d */ d => who.map(/** @param {any} m */ m => ({ d, id: String(m.id) }))));
    const rs = await settledBy(jobs.map(j => () => altTimes(env, loc, j.id, j.d, null, nowMs)), 3);
    /** @type {Record<string, Record<string, string[]>>} */
    const byStaff = {};
    rs.forEach((r, i) => { if (r.status === "fulfilled") (byStaff[jobs[i].id] = byStaff[jobs[i].id] || {})[jobs[i].d] = r.value.map(/** @param {any} x */ x => x.time); });
    for (const d of days) if (who.length && who.every(/** @param {any} m */ m => byStaff[String(m.id)] && byStaff[String(m.id)][d])) fitDays.push({ ...altDay(d, [], nowMs), lists: who.map(/** @param {any} m */ m => byStaff[String(m.id)][d]) });
    if (who.length) fit = { step: gridStep(Object.values(byStaff).flatMap(o => Object.values(o))), staff: byStaff };
  }

  // время, которое клиент назвал сам, показываем ИИ, даже если список на день сокращён
  const asked = new Set();
  for (const m of String(userText || "").matchAll(/(?:^|[^\d])(\d{1,2})(?:\s*[:.\s]\s*(\d{2}))?(?!\d)/g)) if (+m[1] < 24) asked.add(`${+m[1]}:${m[2] || "00"}`);
  const show = /** @param {any} d */ d => { const t = thin(d.times), extra = d.times.filter(/** @param {any} x */ x => asked.has(x) && !t.includes(x)); return extra.length ? [...t, ...extra].sort((a, b) => mins(a) - mins(b)) : t; };
  const dayName = /** @param {string} d */ d => (x => `${x.rel ? x.rel + ", " : ""}${x.label}`)(altDay(d, [], nowMs));
  const fmt = /** @param {any} d */ d => `- ${d.rel ? d.rel[0].toUpperCase() + d.rel.slice(1) + ", " : ""}${d.label} (${d.date}): ${show(d).join(", ")}`;
  const unread = /** @param {string[]} list */ list => list.length ? `\n- Расписание на ${list.map(dayName).join(" и на ")} сейчас не читается: время на этот день не называй. Предложи другой день, а если клиент хочет именно этот — узнай услугу, имя и телефон и добавь строку [ЗАЯВКА] с этим днём и желаемым временем: заявку получит администратор.` : "";

  const facts = (base.cut ? "- Услуги для записи (показана часть списка; если нужной услуги или мастера нет, предложи уточнить у администратора):\n" : "- Услуги для записи (других нет):\n") + (base.services.map(/** @param {any} x */ x => `  · ${x.title} — ${x.min ? `от ${money(x.min)} ₸` : "цену уточняет мастер"}${x.minutes ? `, около ${x.minutes} мин` : ""}`).join("\n") || "  · список услуг пуст") +
    "\n- Мастера" + (base.cut ? "" : " (других нет)") + ": " + (base.staff.map(/** @param {any} m */ m => (m.name === m.base && m.spec ? `${m.name} (${m.spec})` : m.name) + (m.busy ? " — сейчас без свободного времени" : "")).join(", ") || "список пуст") + ".";
  const selfCx = altSelfCancel(env, c);
  let prompt = `

Запись в расписание
А. У компании электронное расписание, запись создаётся сразу. Записывай только на услуги из списка «Услуги для записи», к мастерам из списка «Мастера» и только на время из блока «Свободные окна» — это время, когда свободен хотя бы один мастер.
Б. До записи узнай услугу, мастера (или любой свободный), день и время, имя и телефон, если он ещё не известен. Не переспрашивай то, что уже известно.
В. Когда всё известно, подтверди одной фразой («Записала вас: услуга, мастер, день, время») и добавь последней отдельной строкой:
[ЗАЯВКА] Имя: …; Телефон: …; Услуга: точное название из списка; Мастер: имя из списка или любой; Дата: ГГГГ-ММ-ДД; Время: ЧЧ:ММ
В поле «Мастер» пиши имя, только если клиент сам выбрал этого мастера; иначе пиши «любой». Одну и ту же запись не оформляй дважды: если запись уже есть в «Уже известно о клиенте», строку [ЗАЯВКА] для неё не повторяй.
Г. Не пиши «администратор подтвердит запись». Если услуг несколько, перечисли их в поле «Услуга» через « | ». Одна строка [ЗАЯВКА] — один человек: если записываются двое, добавь две строки [ЗАЯВКА], у каждого своё время или свой мастер. Исключение — услуга сразу на нескольких человек (в названии «+», «для двоих», «папа и сын», «пара», «семейный»): это одна запись на одно время — одна строка [ЗАЯВКА] на имя того, кто записывается; второго человека отдельной услугой не записывай и в «Услуга» не добавляй.
Д. Если клиент просит день, которого нет в «Свободных окнах», скажи, что через чат запись открыта на ближайшие дни, и предложи время из списка.
Е. Отмена записи из этого чата — только когда клиент сам об этом попросил: добавь последней строкой [ОТМЕНА] Имя: …; Дата: ГГГГ-ММ-ДД; Время: ЧЧ:ММ — имя, день и время той записи, которую клиент отменяет (его записи перечислены в «Уже известно о клиенте»). Если записей несколько и неясно, какую отменить, сначала уточни. Если клиент просит отменить запись, которой в этом списке нет (другой день, другое время, другой человек), не подставляй вместо неё запись из списка: впиши в строку [ОТМЕНА] то, что назвал клиент. На вопрос «отменили?» строку [ОТМЕНА] не ставь.${selfCx ? "" : " Саму отмену выполняет администратор: система передаст ему просьбу клиента. Не пиши, что запись отменена, — скажи, что передала просьбу администратору и он подтвердит."}
Ж. Перенос записи — только когда клиент просит другое время вместо прежнего: подбери новое время и в одном ответе добавь две строки — [ОТМЕНА] с именем, днём и временем старой записи и [ЗАЯВКА] для новой на то же имя.${selfCx ? "" : " Перенос выполняет администратор: система передаст ему просьбу. Не пиши, что запись перенесена."} Если клиент хочет ещё одну запись (себе на другую услугу или другому человеку) — это не перенос: добавь только строку [ЗАЯВКА].
З. Итог записи, отмены и переноса клиенту сообщает система по ответу расписания. Без строки [ЗАЯВКА] не пиши, что клиент записан, а без строки [ОТМЕНА] — что запись отменена или перенесена.
И. Время окончания услуги не называй: говори, во сколько начало и сколько минут занимает услуга.`;
  if (mode.trial) prompt += "\n\nЭто тестовый чат: запись открыта только на дни из «Свободных окон» — это дни следующего месяца, в которые нет других записей. Ближайшие дни и другие даты не предлагай; если клиент просит другой день, скажи, что в этом чате запись только на эти дни.";
  if (named && fit && fitDays.length) prompt += `\n\nКлиент хочет к мастеру ${named.name}: его время — в «Проверке длительности» ниже, к нему записывай только на это время.` + unread(own.failed);
  else if (named) prompt += `\n\nЕсли клиент хочет именно к мастеру ${named.name} — вот его свободное время (к нему записывай только на это время):\n` +
    (own.days.map(fmt).join("\n") || "- в ближайшие дни свободного времени нет — предложи другого мастера или время из «Свободных окон».") + unread(own.failed);
  else if (base.staff.length > 1) prompt += "\nК. Время конкретного мастера появится в подсказке, когда клиент назовёт его имя. Если клиент мастера не назвал, до записи один раз спроси, к кому записать: назови мастеров из списка или «к любому свободному». Не записывай, пока клиент не ответил про мастера.";
  if (base.staff.length > 1) prompt += "\nЛ. Если клиент выбрал «любого» мастера, мастера назначает система и сама называет его клиенту. Мастер записи указан в «Уже известно о клиенте» — называй его. Не говори, что мастер «не прикреплён» или «будет любой свободный», если запись уже создана.";
  if (fit && fitDays.length) {
    const asked = askedTimes(msgs[msgs.length - 1]).length ? askedTimes(msgs[msgs.length - 1]) : askedTimes(msgs[msgs.length - 2] || "");
    // какую услугу проверять: названную. Не названа — основную (altegio.mainService, у Winchester стрижка), если клиент не говорил
    // о другой услуге хотя бы словом её названия: «борода» короче — её время не запрещаем, «детскую» — у неё своя длительность
    // название без пояснения категории: «Мужская стрижка (Барберы)» → «Мужская стрижка» (клиент мог выбрать шеф-барбера)
    const dur = /** @param {any[]} l */ l => (ds => ds.length ? Math.min(...ds) : 0)(l.map(x => +x.minutes || 0).filter(Boolean)), bare = /** @param {any} x */ x => String(x.title).replace(/\s*\([^()]*\)\s*$/, "");
    /** @type {{ need: number, name: string, said: boolean } | null} */
    let want = null;
    if (svFound.length && !svMain) want = { need: dur(svFound), name: bare(svFound[0]), said: true };
    else {
      const hint = altServiceHint(base.services, userText);
      if (hint.length && !hint.some(/** @param {any} x */ x => svFound.includes(x))) want = { need: dur(hint), name: bare(hint[0]), said: false };
      else if (svMain) want = { need: dur(svFound), name: bare(svFound[0]), said: false };
      else if (c.altegio.mainService && +c.altegio.mainMinutes) want = { need: +c.altegio.mainMinutes, name: c.altegio.mainService, said: false };
    }
    prompt += fitBlock({ who: named ? named.name : "Любой мастер (время, когда свободен хотя бы один)", one: !!named, days: fitDays, groups: durGroups(base.services, fit.step), step: fit.step, asked,
      show: (t, keep) => { const x = thin(t), extra = t.filter(v => keep.includes(v) && !x.includes(v)); return extra.length ? [...x, ...extra].sort((a, b) => mins(a) - mins(b)) : x; } });
    if (want && !want.said && want.need > fit.step) prompt += `\nКлиент услугу точно не назвал — считай, что это «${want.name}» (${durStr(want.need)}): время бери из её строки. Назовёт другую услугу — из строки той услуги.`;
    // время, на которое эта услуга не помещается ни в один из дней (день назван — в этот день), бот не должен называть свободным (проверяет guard)
    if (want && want.need > fit.step) {
      const need = want.need, days = rel && fitDays.some(d => d.rel === rel) ? fitDays.filter(d => d.rel === rel) : fitDays;
      const bad = /** @type {Map<string, any>} */ (new Map()), ok = days.map(d => [...new Set(d.lists.flatMap(/** @param {string[]} l */ l => fitStarts(l, need, fit.step)))].sort((a, b) => mins(a) - mins(b)));
      const first = ok.find(l => l.length) || [];
      for (const t of new Set([...days.flatMap(d => d.lists.flat()), ...asked])) if (!ok.some(l => l.includes(t))) bad.set(t, { time: t, long: durStr(need), free: nearest(first, t, 2), staff: named ? named.name : "", service: want.name, svc: want.said ? "" : want.name });
      if (bad.size) fitBad = bad;
    }
  } else if (!svAsk.length && svMin) prompt += `\nМ. Свободное время выше посчитано для услуги примерно на ${svMin} мин. Если клиент хочет услугу дольше (комплекс, несколько услуг), это время может не подойти — сначала узнай услугу, до этого не обещай время.`;
  else if (svMain && svAsk.length) prompt += `\nМ. Свободное время выше посчитано для услуги «${svFound[0].title}» (${svFound[0].minutes || "?"} мин): клиент услугу ещё не назвал. Если он хочет услугу дольше (комплекс, несколько услуг), это время может не подойти — сначала узнай услугу; время под неё появится в подсказке в следующем сообщении, до этого не обещай его.`;

  // время окончания услуги («с 11:00 до 12:00») — не выдумка: защита пропускает его только как конец такого промежутка
  const all = new Set([...any.days, ...(own ? own.days : [])].flatMap(d => d.times).concat(fitDays.flatMap(d => d.lists.flat()))), /** @type {Set<string>} */ ends = new Set();
  const durations = new Set(base.services.map(/** @param {any} x */ x => x.minutes).filter(Boolean));
  for (const m of durations) for (const t of all) { const e = mins(t) + m; if (e < 1440) ends.add(`${Math.floor(e / 60)}:${String(e % 60).padStart(2, "0")}`); }
  return { loc, services: base.services, staff: base.staff, cut: base.cut, named, facts, prompt, dates, failed: [...new Set([...any.failed, ...ownFailed])],
    slots: any.days.map(d => ({ ...d, times: show(d) })), slotsNote: unread(any.failed), extraTimes: all, softTimes: ends, durations, fit, fitBad };
}

// та же услуга под другим названием в прайсе: «Мужская стрижка (Барберы)» и «Мужская стрижка (Шеф-барбер)», «… №1» и «… №2»
/** @param {string} t */
const svBase = t => { let s = svTrim(t).replace(/\s*№\s*\d+\s*$/, ""); for (let i = 0; i < 3; i++) s = s.replace(/\s*\([^()]*\)\s*$/, ""); return s; };
/** @param {any[]} all @param {any} x */
export const svSiblings = (all, x) => all.filter(y => y.id !== x.id && svBase(y.title) === svBase(x.title));

// создаёт запись в Altegio. Возвращает { ok } либо причину: soft — уточнить у клиента, иначе — передать администратору
/** @param {Env} env @param {Record<string, any>} A @param {Record<string, any>} q @param {number} nowMs @param {boolean} [test] */
export async function altBook(env, A, q, nowMs, test) {
  const list = /** @param {any[]} arr */ arr => arr.slice(0, 6).join(", "), date = q.date || "", time = hm(q.time);
  const hard = /** @param {string} error @param {Record<string, any>} [extra] */ (error, extra) => ({ ok: false, reason: "api", error, date, time, ...(extra || {}) });
  if (!A.services.length) return hard("в Altegio нет услуг, открытых для онлайн-записи", { services: clean(q.service, 80) });
  const sv = altPickServices(A.services, q.service);
  if (!sv.list) return A.cut && (!sv.ask.length || sv.weak) ? hard("бот видит только часть списка услуг и не нашёл в ней услугу «" + clean(q.service, 60) + "»", { services: clean(q.service, 80) })
    : { ok: false, soft: true, reason: "service", list: list((sv.ask.length ? sv.ask : A.services).map(/** @param {any} x */ x => x.title)) };
  let svc = sv.list, names = svc.map(x => x.title).join(" + ");
  const st = altPickStaff(A.staff, q.staff);
  if (st.ask && !A.staff.length) return hard("в Altegio нет мастеров, открытых для онлайн-записи", { services: names });
  if (st.ask) return A.cut && !st.ask.length ? hard("бот видит только часть списка мастеров и не нашёл в ней мастера «" + clean(q.staff, 40) + "»", { services: names })
    : { ok: false, soft: true, reason: "staff", noAny: !!st.noAny, list: list((st.ask.length ? st.ask : A.staff).map(/** @param {any} m */ m => m.name)) };
  const staff = st.staff || null;
  /** @type {Record<string, any>} */
  const info = { services: names, staffName: staff ? staff.name : "", date, time };
  if (!date || !time) return { ok: false, reason: "format", error: "бот не передал дату и время в нужном виде", ...info };
  if (!(A.dates || []).length) return { ok: false, reason: "api", error: "в расписании нет свободного времени на ближайшие дни", ...info };
  if (!A.dates.includes(date)) return { ok: false, soft: true, reason: "date", list: A.dates.map(/** @param {any} d */ d => `${d.slice(8, 10)}.${d.slice(5, 7)}`).join(", "), ...info };
  info.label = (/** @param {any} d */ d => (d.rel ? d.rel + ", " : "") + d.label)(altDay(date, [], nowMs));
  let ids = [...new Set(svc.map(x => x.id))];
  const staffId = staff ? staff.id : 0;
  // длительность услуги против свободного времени мастера (A.fit — см. altSnapshot): не помещается — «занято» с ближайшим временем,
  // когда поместится, ещё до Altegio (живой показ Winchester, 18.10.2026: Premium на 16:30 при записи у мастера в 17:30)
  const need = svc.reduce((n, x) => n + (+x.minutes || 0), 0), F = A.fit;
  if (F && need > F.step) {
    const pool = staff ? [String(staff.id)] : A.staff.map(/** @param {any} m */ m => String(m.id)), lists = pool.map(/** @param {string} id */ id => F.staff[id] && F.staff[id][date]).filter(Boolean);
    if (lists.length && lists.length === pool.length) {
      const fits = [...new Set(lists.flatMap(/** @param {string[]} l */ l => fitStarts(l, need, F.step)))].sort((a, b) => mins(a) - mins(b));
      if (!fits.includes(time)) return { ok: false, soft: true, reason: "taken", free: nearest(fits, time, 3), long: durStr(need), ...info };
    }
  }
  /** @param {any[]} list @returns {Promise<any>} */
  const timesOf = list => altTimes(env, A.loc, staffId, date, [...new Set(list.map(x => x.id))], nowMs, true).then(v => v, e => e instanceof Error ? e : new Error(String(e)));
  /** @type {any} */
  let times = await timesOf(svc);
  // одна услуга в двух строках прайса (у шеф-барбера и у барберов, Winchester): мастер оказывает только свою. ИИ мог взять строку другого
  // мастера — берём строку того, к кому записываем, иначе Altegio не даст время и клиент услышит «у мастера нет времени» (19.10.2026)
  if (staff && (times instanceof Error || !times.some(/** @param {any} t */ t => t.time === time))) {
    const n = Math.min(3, Math.max(0, ...svc.map(x => svSiblings(A.services, x).length)));
    for (let k = 0; k < n; k++) {
      const alt2 = svc.map(x => svSiblings(A.services, x)[k] || x), t2 = await timesOf(alt2);
      if (!(t2 instanceof Error) && t2.some(/** @param {any} t */ t => t.time === time)) {
        svc = alt2; ids = [...new Set(svc.map(x => x.id))]; names = svc.map(x => x.title).join(" + "); info.services = names; times = t2; break;
      }
    }
  }
  if (times instanceof Error) return { ok: false, reason: "api", error: times.message, ...info };
  let slot = times.find(/** @param {any} t */ t => t.time === time), staffId2 = staffId;
  const others = () => F ? nearest(times.map(/** @param {any} t */ t => t.time), time, 3) : thin(times.filter(/** @param {any} t */ t => t.time !== time).map(/** @param {any} t */ t => t.time), 6); // с проверкой длительности — ближайшие к названному
  if (!slot) { altDropTimes(A.loc); return { ok: false, soft: true, reason: "taken", free: others(), ...info }; }
  // «любой мастер»: мастера выбираем сами (у кого это время свободно, из них — у кого день свободнее). Иначе Altegio назначит кого-то,
  // а бот не будет знать кого: клиенту не сможет сказать, и удалённую администратором запись не заметит (проверка по времени мастера)
  if (!staff && A.staff.length > 1 && A.staff.length <= 12) {
    const got = await Promise.all(A.staff.map(/** @param {any} m */ m => altTimes(env, A.loc, m.id, date, ids, nowMs, true).then(t => ({ m, t, s: t.find(/** @param {any} x */ x => x.time === time) })).catch(() => null)));
    const fit = got.filter(x => x && x.s).sort((a, b) => b.t.length - a.t.length);
    if (fit.length) { slot = fit[0].s.datetime ? fit[0].s : slot; staffId2 = fit[0].m.id; info.staffName = fit[0].m.name; info.anyStaff = true; }
  } else if (!staff && A.staff.length === 1) { info.staffName = A.staff[0].name; info.anyStaff = true; }
  const appointments = [{ id: 1, services: ids, staff_id: staffId2, datetime: slot.datetime || `${date}T${time.padStart(5, "0")}:00+0${TZ}:00` }];
  try {
    if (test) { await altCall(env, "POST", `/book_check/${A.loc}`, { appointments }); return { ok: true, dry: true, record_id: 0, record_hash: "", ...info }; }
    const d = (await altRecord(env, A.loc, { phone: q.phone, fullname: q.name, comment: "Запись через AI-администратора", appointments })).data;
    altDropTimes(A.loc);
    const rec = (Array.isArray(d) ? d[0] : d) || {};
    if (!rec.record_id) return { ok: false, reason: "api", maybe: true, error: "Altegio не вернул номер записи", ...info };
    return { ok: true, record_id: rec.record_id, record_hash: rec.record_hash || "", ...info };
  } catch (/** @type {any} */ e) {
    altDropTimes(A.loc);
    if (e.code === 433 || e.code === 436) return { ok: false, soft: true, reason: "taken", free: others(), ...info }; // время занято; свободных мастеров на это время нет
    if (e.code === 431) return q.fixedPhone ? { ok: false, reason: "api", error: "Altegio не принял номер телефона клиента " + q.phone, ...info } : { ok: false, soft: true, reason: "phone", ...info };
    if (e.code === 437) return { ok: false, soft: true, reason: "overlap", ...info }; // время пересекается с другой записью этого клиента
    if (e.code === 438) { // услуга недоступна: предлагаем остальные; если других нет — заявка администратору
      altCache.delete("base:" + A.loc);
      const rest = A.services.filter(/** @param {any} x */ x => !ids.includes(x.id)).map(/** @param {any} x */ x => x.title);
      return rest.length ? { ok: false, soft: true, reason: "service", list: list(rest), ...info } : { ok: false, reason: "api", error: "Altegio не принял услугу «" + names + "»: она недоступна для онлайн-записи", ...info };
    }
    if (e.code === 432) return { ok: false, reason: "code", error: "локация требует код из SMS для онлайн-записи — отключите подтверждение номера в настройках онлайн-записи Altegio", ...info };
    if (e.code === 434) return { ok: false, reason: "api", error: "номер клиента в чёрном списке Altegio", ...info };
    if (altEmailErr(e)) return { ok: false, reason: "api", error: ALT_EMAIL_TIP, ...info };
    if (e.status === 404 && staff) return { ok: false, soft: true, reason: "staffService", ...info }; // мастер не оказывает эту услугу
    // ответа нет, сбой сервера или «успех» с непонятным телом — запись могла создаться
    return { ok: false, reason: "api", maybe: !e.status || e.status >= 500 || (e.status >= 200 && e.status < 300), error: e.message, ...info };
  }
}
