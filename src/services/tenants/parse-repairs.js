// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Паспорт бота: разбор прайса ремонта («Модель | работа | цена | срок»).
import { REPAIR_MAX } from "../../config/constants.js";
import { altText } from "../integrations/altegio/client.js";
import { numOf } from "./parse-services.js";

// ---- прайс ремонта: «Модель | работа | цена | срок» по строке («iPhone 13 | замена экрана | 45000–60000 | 1 день»).
// Отдельно от услуг: в названии модели есть числа («iPhone 13»), поэтому поля разделяются чертой «|», а строк может быть до 300
export function parseRepairs(src) {
  const list = [], errors = [];
  const lines = String(src || "").replace(/\r/g, "").split("\n").map(x => x.trim()).filter(Boolean);
  if (lines.length > REPAIR_MAX) return { list, errors: [`прайс ремонта: ${lines.length} строк — оставьте не больше ${REPAIR_MAX} (объедините похожие модели)`] };
  lines.forEach((line, i) => {
    const no = i + 1, f = line.split(/\s*[|\t]\s*/);
    if (f.length < 3) { errors.push(`прайс ремонта, строка ${no}: напишите через черту «|»: модель | работа | цена | срок — например «iPhone 13 | замена экрана | 45000–60000 | 1 день»`); return; }
    const model = altText(f[0], 60), work = altText(f[1], 80), pr = (f[2] || "").trim(), term = altText(f.slice(3).join(" ").trim(), 40);
    if (!model || !/\p{L}|\d/u.test(model)) { errors.push(`прайс ремонта, строка ${no}: не указана модель`); return; }
    if (!work || !/\p{L}/u.test(work)) { errors.push(`прайс ремонта, строка ${no}: не указано, какая работа`); return; }
    let min = null, max = null, from = false;
    if (!pr) { errors.push(`прайс ремонта, строка ${no}: не указана цена (можно «после диагностики» или «бесплатно»)`); return; }
    if (/^(бесплатно|free|0)$/i.test(pr)) { min = 0; max = 0; }
    else if (/диагност|договор|уточн|индивидуальн|мастер/i.test(pr)) { /* цену называет мастер */ }
    else {
      const m = /^(от\s*)?([\d\s\u00a0.,]+(?:к|k|тыс\.?)?)\s*(?:₸|тг\.?|тенге)?\s*(?:(?:[–—-]|до)\s*([\d\s\u00a0.,]+(?:к|k|тыс\.?)?)\s*(?:₸|тг\.?|тенге)?)?$/i.exec(pr);
      if (!m) { errors.push(`прайс ремонта, строка ${no}: не понял цену «${pr}» — напишите, например, «45000», «45000–60000» или «от 30000»`); return; }
      min = numOf(m[2]); max = m[3] ? numOf(m[3]) : min; from = !!m[1];
      if (!isFinite(min) || !isFinite(max) || min < 100) { errors.push(`прайс ремонта, строка ${no}: цена «${pr}» выглядит ошибкой`); return; }
      if (max < min) [min, max] = [max, min];
    }
    list.push({ model, work, min, max, from, term });
  });
  return { list, errors };
}
