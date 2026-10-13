// @ts-check
// Запись в Altegio: снимок расписания для подсказки ИИ (altSnapshot) и создание записи (altBook); настройки клиента altLoc, altSelfCancel.
/** @import { Env, Client } from "../../lib/types.js" */
import { altBase, altCache, altDates, altTimes, altDropTimes, altRecord } from "../integrations/altegio/booking-api.js";
import { ALT_TTL, ALT_DAYS } from "../../config/constants.js";
import { altCall } from "../integrations/altegio/client.js";
import { isoDay, mins, hm, TZ } from "../../lib/time.js";
import { altDay } from "./replies.js";
import { altNamed, altPickServices, altPickStaff, altServicesIn } from "./pick.js";
import { money } from "../../lib/money.js";
import { clean } from "../../lib/text.js";
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
/** @param {Env} env @param {Client} c @returns {number} */
export const altLoc = (env, c) => {
  const v = env["ALTEGIO_LOC_" + String(c.id).toUpperCase()];
  if (v != null && String(v).trim() !== "") return /^\d{1,12}$/.test(String(v).trim()) && +v > 0 ? +v : -1; // опечатка в номере — это сбой настройки, а не «расписания нет»
  return +((c.altegio && c.altegio.location) || 0) || 0;
};

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
/** @param {Env} env @param {Client} c @param {number} nowMs @param {string} userText */
export async function altSnapshot(env, c, nowMs, userText) {
  const loc = altLoc(env, c);
  const base = await altBase(env, loc, nowMs);
  const dk = "d:" + loc, hit = altCache.get(dk);
  let dates;
  if (hit && Math.abs(nowMs - hit.at) < ALT_TTL) dates = hit.v;
  else {
    dates = altDates(await altCall(env, "GET", `/book_dates/${loc}?date_from=${isoDay(nowMs)}&date_to=${isoDay(nowMs + 21 * 86400e3)}`), nowMs).slice(0, ALT_DAYS);
    altCache.set(dk, { at: nowMs, v: dates });
  }
  // услуга уже названа — время спрашиваем с ней (Altegio тогда учитывает её длительность); не вышло или пусто — как раньше, без услуги
  // Одно название у нескольких услуг (барбер и шеф-барбер) — спрашиваем по каждой отдельно и объединяем: мастеру, который эту услугу не оказывает, Altegio отвечает 404 (altTimes → пусто).
  // Длительности у них должны совпадать, иначе не угадываем.
  const svFound = altServicesIn(base.services, userText);
  const svAsk = svFound.length && new Set(svFound.map(/** @param {any} x */ x => x.minutes || 0)).size === 1 ? svFound.map(/** @param {any} x */ x => [x.id]) : [];
  const read = async (/** @type {any} */ staffId, /** @type {string[]} */ list) => {
    const one = async (/** @type {string} */ d) => {
      if (!svAsk.length) return altTimes(env, loc, staffId, d, null, nowMs);
      const parts = await Promise.all(svAsk.map(ids => altTimes(env, loc, staffId, d, ids, nowMs)));
      const seen = new Set();
      return parts.flat().filter(/** @param {any} x */ x => !seen.has(x.time) && seen.add(x.time)).sort(/** @param {any} a @param {any} b */ (a, b) => mins(a.time) - mins(b.time));
    };
    let rs = await Promise.allSettled(list.map(one));
    if (svAsk.length && (rs.some(r => r.status === "rejected") || rs.every(r => r.status === "fulfilled" && !r.value.length))) rs = await Promise.allSettled(list.map(d => altTimes(env, loc, staffId, d, null, nowMs)));
    return { days: rs.map((r, i) => r.status === "fulfilled" ? altDay(list[i], r.value.map(/** @param {any} x */ x => x.time), nowMs) : null).filter(d => d && d.times.length),
      failed: list.filter((d, i) => rs[i].status === "rejected"), error: (rs.find(r => r.status === "rejected") || {}).reason };
  };
  const any = await read(0, dates);
  if (dates.length && any.failed.length === dates.length) throw any.error; // время не читается совсем — это сбой, а не «свободных окон нет»
  let /** @type {any} */ named = altNamed(base.staff, userText), /** @type {any} */ own = null;
  /** @type {any[]} */
  let ownFailed = [];
  if (named) { own = await read(named.id, dates); ownFailed = own.failed; if (own.failed.length && !own.days.length) { own = null; named = null; } } // время мастера не читается — не выдаём это за «у него занято»

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
  if (named) prompt += `\n\nЕсли клиент хочет именно к мастеру ${named.name} — вот его свободное время (к нему записывай только на это время):\n` +
    (own.days.map(fmt).join("\n") || "- в ближайшие дни свободного времени нет — предложи другого мастера или время из «Свободных окон».") + unread(own.failed);
  else if (base.staff.length > 1) prompt += "\nК. Время конкретного мастера появится в подсказке, когда клиент назовёт его имя. Если клиент мастера не назвал, до записи один раз спроси, к кому записать: назови мастеров из списка или «к любому свободному». Не записывай, пока клиент не ответил про мастера.";
  if (base.staff.length > 1) prompt += "\nЛ. Если клиент выбрал «любого» мастера, мастера назначает система и сама называет его клиенту. Мастер записи указан в «Уже известно о клиенте» — называй его. Не говори, что мастер «не прикреплён» или «будет любой свободный», если запись уже создана.";

  // время окончания услуги («с 11:00 до 12:00») — не выдумка: защита пропускает его только как конец такого промежутка
  const all = new Set([...any.days, ...(own ? own.days : [])].flatMap(d => d.times)), /** @type {Set<string>} */ ends = new Set();
  const durations = new Set(base.services.map(/** @param {any} x */ x => x.minutes).filter(Boolean));
  for (const m of durations) for (const t of all) { const e = mins(t) + m; if (e < 1440) ends.add(`${Math.floor(e / 60)}:${String(e % 60).padStart(2, "0")}`); }
  return { loc, services: base.services, staff: base.staff, cut: base.cut, named, facts, prompt, dates, failed: [...new Set([...any.failed, ...ownFailed])],
    slots: any.days.map(d => ({ ...d, times: show(d) })), slotsNote: unread(any.failed), extraTimes: all, softTimes: ends, durations };
}

// создаёт запись в Altegio. Возвращает { ok } либо причину: soft — уточнить у клиента, иначе — передать администратору
/** @param {Env} env @param {Record<string, any>} A @param {Record<string, any>} q @param {number} nowMs @param {boolean} [test] */
export async function altBook(env, A, q, nowMs, test) {
  const list = /** @param {any[]} arr */ arr => arr.slice(0, 6).join(", "), date = q.date || "", time = hm(q.time);
  const hard = /** @param {string} error @param {Record<string, any>} [extra] */ (error, extra) => ({ ok: false, reason: "api", error, date, time, ...(extra || {}) });
  if (!A.services.length) return hard("в Altegio нет услуг, открытых для онлайн-записи", { services: clean(q.service, 80) });
  const sv = altPickServices(A.services, q.service);
  if (!sv.list) return A.cut && (!sv.ask.length || sv.weak) ? hard("бот видит только часть списка услуг и не нашёл в ней услугу «" + clean(q.service, 60) + "»", { services: clean(q.service, 80) })
    : { ok: false, soft: true, reason: "service", list: list((sv.ask.length ? sv.ask : A.services).map(/** @param {any} x */ x => x.title)) };
  const svc = sv.list, names = svc.map(x => x.title).join(" + ");
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
  const ids = [...new Set(svc.map(x => x.id))], staffId = staff ? staff.id : 0;
  /** @type {any} */
  let times;
  try { times = await altTimes(env, A.loc, staffId, date, ids, nowMs, true); }
  catch (/** @type {any} */ e) { return { ok: false, reason: "api", error: e.message, ...info }; }
  let slot = times.find(/** @param {any} t */ t => t.time === time), staffId2 = staffId;
  const others = () => thin(times.filter(/** @param {any} t */ t => t.time !== time).map(/** @param {any} t */ t => t.time), 6);
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
