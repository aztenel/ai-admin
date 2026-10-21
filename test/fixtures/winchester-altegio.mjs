// Расписание Winchester для заглушки Altegio (test/harness.mjs): net.altData = () => winchesterAlt().
// Услуги, цены, длительности, мастера и кто что делает — как в открытой онлайн-записи Winchester (локация 133486, разведка 21.10.2026:
// book_services, book_services?staff_id=, book_staff). Две строки прайса одной услуги: шеф-барбер (Тони) и барберы, четыре категории
// с одинаковым названием «Мужские стрижки и бритьё» — как вживую. Плюс две старые строки, которых нет ни у одного мастера.
// Даты и занятость считаются от Date.now() в момент вызова (часы проверок — суббота, 3.10.2026, 12:00 по Астане; «день n» — n дней после).
// Используется в test/unit/site-booking.test.mjs, test/devserver.mjs (--site) и e2e формы записи (test/site-booking-e2e.mjs).

export const W = { TONI: 2089378, AIDOS: 2844400, AIDYN: 2787003, ALISHER: 3094358, RUSLAN: 3087825 };
// номера услуг, которые нужны проверкам
export const WS = { CUT_CHEF: 13023866, CUT: 13023827, KIDS_CHEF: 13023857, KIDS: 13023818, PREMIUM_CHEF: 13023862, PREMIUM: 13023823,
  PERM: 13508134, DOWN_CHEF: 13508138, DOWN: 13508156, MASK: 13023841, SPA: 13023839, OLD1: 13023801, OLD2: 13023802 };

const CAT_CHEF = 13023817, CAT_BARBER = 13023813, CAT_OLD1 = 13023814, CAT_OLD2 = 13023816, CAT_EXTRA = 13023815;
const PREMIUM_NOTE = "- Стрижка\n- SPA-процедура для лица\n- Глиняная маска\n- Перкуссионный массаж";
const sv = (id, title, category_id, price, sec, weight, comment = "") => ({ id, title, category_id, price_min: price, price_max: price, discount: 0, comment, weight, active: 1, seance_length: sec });
// линия шеф-барбера (Тони)
const CHEF = [
  sv(13023866, "Мужская стрижка", CAT_CHEF, 9000, 3600, 9), sv(13023865, "Моделирование бороды", CAT_CHEF, 5000, 1800, 8),
  sv(13023857, "Детская стрижка", CAT_CHEF, 6000, 1800, 7), sv(13023863, "Комплекс Отец и сын", CAT_CHEF, 14000, 5400, 6),
  sv(13023862, "Комплекс \"PREMIUM\"", CAT_CHEF, 13000, 5400, 5, PREMIUM_NOTE), sv(13508138, "Перманентная укладка (Down perm)", CAT_CHEF, 10000, 1800, 4),
  sv(13508158, "Камуфляж седины (Kondor)", CAT_CHEF, 5500, 1800, 3), sv(13023859, "Камуфляж бороды (Kondor)", CAT_CHEF, 4000, 1800, 2),
  sv(13023867, "Окантовка + Укладка", CAT_CHEF, 2500, 1800, 1)];
// линия барберов (Айдос, Айдын, Алишер, Руслан)
const BARBER = [
  sv(13023827, "Мужская стрижка", CAT_BARBER, 7000, 3600, 10), sv(13023826, "Моделирование бороды", CAT_BARBER, 4500, 1800, 9),
  sv(13023818, "Детская стрижка", CAT_BARBER, 5000, 1800, 8), sv(13023824, "Комплекс Отец и сын", CAT_BARBER, 10000, 5400, 7),
  sv(13023823, "Комплекс \"PREMIUM\"", CAT_BARBER, 12000, 5400, 6, PREMIUM_NOTE), sv(13508134, "Химическая завивка", CAT_BARBER, 20000, 3600, 5),
  sv(13508156, "Перманентная укладка (Down perm)", CAT_BARBER, 10000, 1800, 4), sv(13023822, "Камуфляж седины (Kondor)", CAT_BARBER, 5500, 1800, 3),
  sv(13023820, "Камуфляж бороды (Kondor)", CAT_BARBER, 4000, 1800, 2), sv(13023828, "Окантовка + Укладка", CAT_BARBER, 2500, 1800, 1)];
const EXTRA = [
  sv(13023839, "SPA-процедура для лица", CAT_EXTRA, 4000, 1800, 5), sv(13023840, "Восковое удаление лишних волос", CAT_EXTRA, 1500, 300, 4),
  sv(13023841, "Глиняная маска", CAT_EXTRA, 2000, 900, 3), sv(13023845, "Чёрная маска", CAT_EXTRA, 2000, 900, 2),
  sv(13023843, "Перкуссионный массаж", CAT_EXTRA, 2000, 600, 1)];
// старые строки прайса: в общем списке есть, у мастеров — нет (на сайте их быть не должно)
const OLD = [sv(13023801, "Мужская стрижка", CAT_OLD1, 5000, 3600, 4), sv(13023802, "Мужская стрижка", CAT_OLD2, 7000, 3600, 8)];

const person = (id, name, specialization, position, rating, comments_count, weight) =>
  ({ id, name, specialization, position: { id: 1, title: position }, rating, show_rating: 1, comments_count, votes_count: 0, avatar: "", avatar_big: "", weight, bookable: true, fired: 0, hidden: 0, status: 0 });
const STAFF = [
  person(W.TONI, "Тони (Рауан М.)", "Шеф-барбер", "Шеф барбер", 5, 249, 48), person(W.AIDOS, "Айдос", "Барбер", "Барбер ", 4.92, 199, 47),
  person(W.AIDYN, "Айдын", "Барбер", "Барбер ", 4.95, 283, 46), person(W.ALISHER, "Алишер", "Барбер", "Барбер ", 0, 0, 45),
  person(W.RUSLAN, "Руслан", "Барбер", "Барбер ", 0, 0, 43)];
const without = (list, ...ids) => list.filter(x => !ids.includes(x.id));
const OFFERS = {
  [W.TONI]: [...CHEF, ...EXTRA], [W.AIDOS]: [...BARBER, ...EXTRA], [W.AIDYN]: [...without(BARBER, 13508134, 13508156), ...EXTRA],
  [W.ALISHER]: [...without(BARBER, 13508156), ...EXTRA], [W.RUSLAN]: [...without(BARBER, 13508134, 13508156), ...EXTRA] };
// выходные по дням недели (0 — воскресенье): Тони — пятница, Айдос — пн и вт, Айдын — ср и чт, Руслан — вт и пт, Алишер — без выходных
const OFF = { [W.TONI]: [5], [W.AIDOS]: [1, 2], [W.AIDYN]: [3, 4], [W.RUSLAN]: [2, 5], [W.ALISHER]: [] };
// занятость по умолчанию: { staff, day (число — дней после сегодня, или «ГГГГ-ММ-ДД»), from, to }. День 1, Тони: Premium (1 ч 30 мин)
// на 16:30 не помещается из-за записи в 17:30 — настоящий случай 18.10.2026
export const BUSY = [
  { staff: W.TONI, day: 0, from: "12:00", to: "15:00" },
  { staff: W.TONI, day: 1, from: "13:00", to: "14:00" }, { staff: W.TONI, day: 1, from: "17:30", to: "18:30" },
  { staff: W.AIDOS, day: 1, from: "10:00", to: "12:00" }];

const iso = ms => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
const mins = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// «день n» — дата n дней после сегодня (по Астане)
export const dayN = n => iso(Date.now() + n * 86400e3);
export const GRID = Array.from({ length: 22 }, (_, i) => hhmm(600 + i * 30)); // 10:00 … 20:30

/** @param {{ busy?: any[], days?: number }} [o] */
export function winchesterAlt({ busy = BUSY, days = 40 } = {}) {
  const now = Date.now(), all = Array.from({ length: days }, (_, i) => iso(now + i * 86400e3));
  const dow = d => new Date(d + "T00:00:00Z").getUTCDay();
  const busyOf = (staff, date) => busy.filter(b => String(b.staff) === String(staff) && (typeof b.day === "number" ? iso(now + b.day * 86400e3) : b.day) === date);
  const D = {
    services: [...CHEF, ...BARBER, ...OLD, ...EXTRA],
    category: [{ id: CAT_CHEF, title: "Мужские стрижки и бритьё", weight: 5 }, { id: CAT_BARBER, title: "Мужские стрижки и бритьё", weight: 4 },
      { id: CAT_OLD1, title: "Мужские стрижки и бритьё", weight: 3 }, { id: CAT_OLD2, title: "Мужские стрижки и бритьё", weight: 2 }, { id: CAT_EXTRA, title: "Дополнительные услуги", weight: 1 }],
    staff: STAFF.map(x => ({ ...x, position: { ...x.position } })),
    dates: all, times: {},
    // услуги мастера (book_services?staff_id=)
    servicesFor: staff => (OFFERS[staff] || []).map(x => ({ ...x })),
    // длительность услуги у мастера, секунды: у Айдына детская стрижка — 45 мин (как вживую)
    lenFor: (staff, id) => String(staff) === String(W.AIDYN) && +id === 13023818 ? 2700 : undefined,
    // открытые дни мастера (book_dates?staff_id=, проверка дня в book_times)
    datesFor: staff => String(staff) === "0" ? all : all.filter(d => !(OFF[staff] || []).includes(dow(d))),
    // свободные начала: сетка 10:00…20:30 минус занятое; с услугами — только где помещается сумма их длительностей у мастера
    timesFor: (staff, date, sids = []) => {
      if (String(staff) === "0") return [...new Set(STAFF.flatMap(m => { const r = D.timesFor(String(m.id), date, sids); return Array.isArray(r) ? r : []; }))].sort();
      if (!D.datesFor(staff).includes(date)) return [];
      const b = busyOf(staff, date).map(x => [mins(x.from), mins(x.to)]);
      const free = GRID.filter(t => { const s = mins(t); return !b.some(([a, z]) => s < z && s + 30 > a); });
      if (!sids || !sids.length) return free;
      const offers = D.servicesFor(staff);
      if (sids.some(id => !offers.some(x => String(x.id) === String(id)))) return { error: 422 }; // чужую строку прайса мастер не оказывает
      const need = sids.reduce((n, id) => { const x = offers.find(v => String(v.id) === String(id)); return n + Math.round((D.lenFor(staff, id) ?? x.seance_length) / 60); }, 0);
      const set = new Set(free.map(mins));
      return free.filter(t => { const s = mins(t); for (let k = 30; k < need; k += 30) if (!set.has(s + k)) return false; return true; });
    }
  };
  return D;
}
