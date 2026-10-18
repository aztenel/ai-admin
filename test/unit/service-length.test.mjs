// Свободное время — с учётом длительности услуги (живой показ Winchester, 18.10.2026): у Тони записи в 11:30, 13:00 и 17:30,
// а бот предлагал 11:00 и 12:30 на стрижку (1 ч) и 17:00 на «Отец и сын» (1 ч 30 мин). Без услуги Altegio отдаёт любое свободное начало.
// Теперь: пока услуга не названа — время по основной услуге (altegio.mainService), «Отец и сын» у барберов и у шеф-барбера —
// две услуги в Altegio, ошибка по одной не выбрасывает ответ по другой. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1, D2 } from "../harness.mjs";

const ENV = { ALTEGIO_PARTNER: "partner-key" };
const W = {
  services: [
    { id: 201, title: "Мужская стрижка", category_id: 1, price_min: 9000, price_max: 9000, active: 1, seance_length: 3600 },
    { id: 202, title: "Комплекс «Отец и сын»", category_id: 1, price_min: 10000, price_max: 10000, active: 1, seance_length: 5400 },
    { id: 203, title: "Комплекс «Отец и сын»", category_id: 2, price_min: 14000, price_max: 14000, active: 1, seance_length: 5400 }],
  category: [{ id: 1, title: "Барберы" }, { id: 2, title: "Шеф-барбер" }],
  staff: [{ id: 31, name: "Тони", bookable: true, specialization: "шеф-барбер" }, { id: 32, name: "Айдос", bookable: true, specialization: "барбер" }],
  times: {},
  // у Тони свободно 11:00–11:30, 12:30–13:00, 14:00–17:30: без услуги Altegio отдаёт любое начало
  timesFor: (staff, date, sids) => {
    if (staff === "31") {
      if (sids.includes("202")) return { error: 422 }; // услугу барберов шеф-барбер не оказывает
      if (sids.includes("203")) return ["14:00", "15:00", "16:00"];
      if (sids.includes("201")) return ["14:00", "15:00", "16:00", "16:30"];
      return ["11:00", "12:30", "14:00", "15:00", "16:00", "17:00"];
    }
    if (staff === "32") return sids.includes("203") ? { error: 422 } : ["10:00", "12:00"];
    return sids.length ? ["10:00", "12:00", "14:00", "15:00", "16:00"] : ["10:00", "11:00", "12:00", "12:30", "14:00", "17:00"];
  }
};
const toniLine = () => { const p = JSON.stringify(net.gemini.at(-1)), i = p.indexOf("именно к мастеру Тони"); return i < 0 ? "" : p.slice(i, i + 400); };

test("услуга не названа — время у Тони по основной услуге (стрижка 1 ч): 11:00 и 12:30 не предлагаются", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  await s.chat("winchester", "len-1", "сколько стоит стрижка?", ["Стрижка у шеф-барбера Тони — 9 000 ₸."]);
  await s.chat("winchester", "len-1", "у Тони завтра в 12 свободно?", ["Подскажу время."]);
  const t = toniLine();
  assert.ok(/14:00/.test(t) && !/11:00/.test(t) && !/12:30/.test(t), t);
  assert.ok(/посчитано для услуги «Мужская стрижка» \(60 мин\)/.test(JSON.stringify(net.gemini.at(-1))), "ИИ знает, для какой услуги это время");
  net.altData = null;
});

test("«Отец и сын» к Тони: ошибка по услуге барберов не подменяет время на «любое начало» — 17:00 не предлагается", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  await s.chat("winchester", "len-2", "а в 17ч можно на комплекс отец и сын к Тони?", ["Подскажу время."]);
  const t = toniLine();
  assert.ok(/14:00/.test(t) && !/17:00/.test(t), t);
  net.altData = null;
});
