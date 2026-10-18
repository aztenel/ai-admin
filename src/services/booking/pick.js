// @ts-check
// Подбор услуги и мастера по тому, что написал ИИ или клиент. Правило одно: не уверены — переспрашиваем, а не угадываем.
import { isForm, staffNames, caseName, STAFF_POS } from "./people.js";
import { nameToks, svTrim, svWords, svStem, svParts } from "../../lib/names.js";
import { lowE, clean } from "../../lib/text.js";

// мастер, которого назвал клиент (последний из упомянутых). Тёзок различаем по фамилии рядом; не ясно — никого не выбираем
/** @param {any[]} staff @param {string[]} toks @param {number} i @param {string[][]} names */
function altMention(staff, toks, i, names) {
  const t = toks[i];
  if (t.length < 3) return undefined;
  const hit = staff.filter((m, j) => names[j].some(n => isForm(n, t)));
  if (!hit.length) return undefined;
  if (hit.length === 1) return hit[0];
  const near = toks.slice(Math.max(0, i - 2), i + 3); // тёзки: смотрим соседние слова — фамилию
  const by = hit.filter(m => names[staff.indexOf(m)].some(n => !isForm(n, t) && near.some(x => isForm(n, x))));
  return by.length === 1 ? by[0] : null;
}
/** @param {any[]} staff @param {string} userText */
export function altNamed(staff, userText) {
  const toks = nameToks(userText), names = staffNames(staff).map(ns => ns.filter(w => w.length >= 3));
  let best = null;
  toks.forEach((t, i) => { const m = altMention(staff, toks, i, names); if (m !== undefined) best = m; });
  return best;
}

// Услуга, которую клиент уже назвал в переписке: все слова названия (по основам, падежи не мешают) есть среди его слов.
// Нужна, чтобы спрашивать у Altegio свободное время сразу с длительностью услуги: без неё Altegio считает короткий слот и показывает
// свободным время, на которое услуга (например, час) не помещается (вживую 14.10.2026: у Айдоса 15:00 при записи 15:00–16:00).
// «Стрижка» ⊂ «Мужская стрижка»: из вложенных названий берём самое полное.
// Возвращает подходящие услуги: одна — или несколько с одинаковым названием (две линии цен: «барбер» и «шеф-барбер», в названии отличается только категория в скобках).
// Не уверены (ничего не подошло, подошли разные названия или больше трёх) — [], время спрашиваем как раньше.
/** @param {any[]} services @param {string} text @returns {any[]} */
export function altServicesIn(services, text) {
  const said = new Set((lowE(String(text || "")).match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length >= 3 || /\d/.test(w)).map(svStem));
  const hits = services.map(x => ({ x, w: new Set(svWords(svTrim(x.title).replace(/\([^()]*\)/g, " ")).map(svStem)) })).filter(v => v.w.size && [...v.w].every(w => said.has(w)));
  const top = hits.filter(v => !hits.some(o => o !== v && o.w.size > v.w.size && [...v.w].every(w => o.w.has(w))));
  const key = /** @param {any} v */ v => [...v.w].sort().join(" ");
  return top.length && top.length <= 3 && top.every(v => key(v) === key(top[0])) ? top.map(v => v.x) : [];
}

// Та же услуга под другими названиями: у шеф-барбера она может называться длиннее («Мужская стрижка (шеф)», «Мужская стрижка — топ»)
// и иметь другую длительность. Берём услуги, в названии которых есть все слова найденной; вариант, которого мастер не оказывает,
// Altegio отвечает пусто или ошибкой — его время просто не попадёт в список (живой показ Winchester, 18.10.2026)
/** @param {any[]} services @param {any[]} found @returns {any[]} */
export function altServicesLike(services, found) {
  const ws = /** @param {any} x */ x => new Set(svWords(svTrim(x.title).replace(/\([^()]*\)/g, " ")).map(svStem));
  const keys = found.map(ws).filter(w => w.size);
  const like = services.filter(x => found.includes(x) || (w => keys.some(k => [...k].every(t => w.has(t))))(ws(x)));
  return like.slice(0, 4);
}

// что клиент говорил о мастере: к кому хочет (want — последний названный, если после него не сказано «к любому») и к кому не хочет («только не к Арману»)
// Пожелание о мастере — только имя с «к», «мастер», «именно», «только» («к Арману», «мастер Ерлан свободен?»). Просто имя — не пожелание: так зовут и клиентов
// («Здравствуйте, это Арман»). «Был у Армана, не понравилось» — наоборот, к нему не записываем. own — имена самого клиента и тех, кого он записывает
const STAFF_MARK = /^(к|ко|мастер\S*|барбер\S*|специалист\S*|стилист\S*|парикмахер\S*|врач\S*|доктор\S*|именно|только|лучше|to|with|шебер\S*)$/, STAFF_AFTER = /^(свобод\S*|работа\S*|принима\S*|занят\S*|стриж\S*)$/;
const STAFF_BAD = /^(понравил\S*|плохо|ужас\S*|недовол\S*|испортил\S*|криво|жалоб\S*|хамил\S*|груб\S*)$/, STAFF_PAST = /^(был|была|были|стригся|стриглась|стриглись|ходил|ходила|ходили|делал|делала)$/;
const STAFF_U_AFTER = /^(есть|свобод\S*|можно|время|окн\S*|окошк\S*)$/, STAFF_U_BEFORE = /^(запис\S*|запиш\S*|хочу|можно|есть)$/;
/** @param {any[]} staff @param {string} userText @param {any[]} [own] */
export function altStaffWish(staff, userText, own = []) {
  const toks = nameToks(userText), names = staffNames(staff).map(ns => ns.filter(w => w.length >= 3)), not = new Set();
  /** @type {any} */
  let want = null, at = -1;
  toks.forEach((t, i) => {
    const m = altMention(staff, toks, i, names);
    if (m === undefined) return;
    const b2 = toks.slice(Math.max(0, i - 2), i), a3 = toks.slice(i + 1, i + 4), near = toks.slice(Math.max(0, i - 4), i + 6);
    if (m && near.some((x, j) => STAFF_BAD.test(x) && (!/^понравил/.test(x) || near[j - 1] === "не"))) { not.add(m); if (want === m) want = null; return; } // «был у Армана, не понравилось»; «мне понравилось у Армана» — не жалоба
    const atU = toks[i - 1] === "у" && !toks.slice(Math.max(0, i - 4), i - 1).some(x => STAFF_PAST.test(x)) && (a3.some(x => STAFF_U_AFTER.test(x)) || toks.slice(Math.max(0, i - 3), i - 1).some(x => STAFF_U_BEFORE.test(x)));
    const liked = near.some((x, j) => /^понравил/.test(x) && near[j - 1] !== "не"); // «мне понравилось у Армана» — пожелание
    const marked = b2.some(x => STAFF_MARK.test(x)) || atU || liked || a3.slice(0, 2).some(x => STAFF_AFTER.test(x));
    if (/(^|\s)(не|кроме|без|except|not)(\s+(к|у|хочу|надо))?$/.test(toks.slice(Math.max(0, i - 3), i).join(" "))) { if (m) { not.add(m); if (want === m) want = null; } return; }
    if (!marked) return;                                                   // просто имя — не пожелание
    if (!m) { want = null; return; }                                       // тёзки: кого именно — не ясно
    if (own.some(n => n && caseName(n, t)) && !b2.some(x => STAFF_MARK.test(x)) && !atU) return;
    want = m; at = i; not.delete(m);
  });
  const after = at >= 0 ? " " + toks.slice(at + 1).join(" ") + " " : "";
  if (/\s(любой|любому|любого|любая|любым|без разницы|не важно|неважно|не важен|все равно|кто свободен|кто есть|свободному|свободного|свободный|кому угодно|к другому|другой мастер|другого мастера|другому мастеру|any|anyone|whoever|кез келген|барибир)\s/.test(after)) want = null;
  return { want, not: [...not] };
}

// ---- подбор услуги и мастера по тому, что написал ИИ. Правило одно: не уверены — переспрашиваем, а не угадываем
/** @param {string} s */
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); // дефис не трогаем: в режиме «u» запись «\-» вне скобок — ошибка
// та же строка без хвостов, которые ИИ мог переписать из списка: « — от 6 000 ₸», «, около 60 мин», «(60 мин)»
/** @param {string} w */
function svForms(w) {
  const out = [w], add = /** @param {any} x */ x => { x = x.replace(/[\s.,]+$/, "").trim(); if (x && !out.includes(x)) out.push(x); return x || out[out.length - 1]; };
  const a = add(w.replace(/\s+-\s+(от\s+\d[\d\s]*|цену\s+уточняет\s+мастер)\s*(,\s*около\s+\d+\s*мин\S*)?$/, ""));
  const b = add(a.replace(/,?\s*(около\s+)?\d+\s*(мин\S*|час\S*)$/, ""));
  add(b.replace(/\s*\([^()]*\)\s*$/, ""));
  return out;
}

/** @param {string} q */
const svIsWord = q => /\p{L}/u.test(q) && !/^(мин\S*|час\S*|min\S*|hours?|h)$/.test(q);              // «60 мин», «90» — не название услуги
const SV_NEG = /(^|\s)(не|только|лишь|no|not|only)(\s|$)/;
// → { list: [услуги] } или { ask: [на что это похоже], weak: похожее найдено только по общему слову }
/** @param {any[]} services @param {any} raw */
export function altPickServices(services, raw) {
  const T = services.map(x => ({ x, t: svTrim(x.title) })), cand = new Set();
  let strong = false;
  const many = /** @param {any} list */ list => { strong = true; list.forEach(/** @param {any} v */ v => cand.add(v.x)); return null; };
  const weak = /** @param {any} ws */ ws => { T.filter(v => { const tw = svWords(v.t); return ws.some(/** @param {any} q */ q => !/\d/.test(q) && has(tw, q)); }).slice(0, 6).forEach(v => cand.add(v.x)); return null; }; // общее слово — слабое сходство
  const has = /** @param {any} tw @param {any} q */ (tw, q) => /\d/.test(q) ? tw.includes(q) : tw.some(/** @param {any} z */ z => z.startsWith(svStem(q)));
  // услуги, которые подходят под запрос: точное название; иначе запрос стоит в названии целиком либо в названии есть все его слова
  const candsOf = /** @param {any} w */ w => {
    const exact = T.filter(v => v.t === w);
    if (exact.length) return exact;
    const ws = svWords(w), n = svParts(w).length;
    if (!ws.some(svIsWord)) return [];
    const re = new RegExp("(^|[^\\p{L}\\p{N}])" + rxEsc(w) + "($|[^\\p{L}\\p{N}])", "u");
    // все слова запроса есть в названии, и составных частей столько же: «стрижка и камуфляж» — не «стрижка + борода + камуфляж»
    return T.filter(v => { if (re.test(v.t)) return true; const tw = svWords(v.t); return ws.every(q => has(tw, q)) && (n < 2 || svParts(v.t).length === n); });
  };
  const one = /** @param {string} w @param {number} [loose] */ (w, loose) => {
    if (!w) return null;
    const exact = T.filter(v => v.t === w);
    if (exact.length) return exact.length === 1 ? exact[0].x : many(exact);
    const ws = svWords(w);
    if (!ws.some(svIsWord)) return null;
    if (loose === 0) {
      // часть составной услуги («стрижка + борода»): точное название либо одно слово, которое подходит ровно к одной несоставной услуге
      if (ws.length !== 1 || /\d/.test(ws[0])) return null;
      const hit = T.filter(v => has(svWords(v.t), ws[0]));
      if (hit.length === 1 && svParts(hit[0].t).length === 1) return hit[0].x;
      return hit.length ? many(hit.slice(0, 6)) : null;
    }
    // «стрижка без бороды»: услуги по первой части, в названии которых нет второй. «Не женская», «только стрижка» — переспрашиваем
    const neg = w.match(/^(.+?)\s+(?:без|кроме|without|except)\s+(.+)$/);
    if (neg) {
      const drop = svWords(neg[2]), all = candsOf(neg[1].trim()), left = all.filter(v => !drop.some(q => has(svWords(v.t), q)));
      if (left.length === 1) return left[0].x;
      return left.length ? many(left.slice(0, 6)) : all.length ? many(all.slice(0, 6)) : weak(svWords(neg[1]));
    }
    if (SV_NEG.test(w)) return weak(ws);
    const c = candsOf(w), n = svParts(w).length;
    // подходит несколько услуг — не угадываем. Одно слово не выбирает и единственную составную услугу: «борода» — ещё не «Стрижка + борода»
    if (c.length === 1) return svParts(c[0].t).length > n ? many(c) : c[0].x;
    return c.length ? many(c.slice(0, 6)) : weak(ws);
  };
  const any = /** @param {string} w @param {number} [loose] */ (w, loose) => { for (const f of svForms(w)) { const r = one(f, loose); if (r) return r; } return null; };
  const whole = /\|/.test(String(raw || "")) ? null : any(svTrim(raw), 1); // «А | Б» — две услуги, а не одна составная
  if (whole) return { list: [whole] };
  const out = [];
  for (const part of String(raw || "").split("|").map(svTrim).filter(Boolean)) {
    let got = any(part, 1);
    if (got) { out.push(got); continue; }
    if (/(^|\s)(без|кроме|не|только|лишь|without|except|no|not|only)(\s|$)/.test(part)) return { ask: [...cand], weak: !strong };
    const subs = svParts(/** @type {string} */ (svForms(part).at(-1))).filter(s => !/^(около\s+)?\d+\s*(мин\S*|час\S*)?$/.test(s));
    if (subs.length < 2) return { ask: [...cand], weak: !strong };
    for (const s of subs) { got = any(s, 0); if (!got) return { ask: [...cand], weak: !strong }; out.push(got); }
  }
  return out.length ? { list: [...new Set(out)] } : { ask: [...cand], weak: !strong };
}
export const ANY_STAFF = /^(к\s+)?(любой|любая|любого|любому|любым|ближайш\S*|первый\s+свободн\S*|первому\s+свободн\S*|не\s?важно|не\s?важен|неважно|не\s+имеет\s+значения|без\s+разницы|вс[её]\s+равно|кто\s+свободен|свободный|свободного|свободному|any|anyone|any\s+available|no\s+preference|кез[\s-]?келген|бәрібір|—|-|–|…|\.\.\.|нет|не\s+указан[оа]?)(\s|$|[.,!])/i;

// → { staff } | { any: true } | { ask: [кого это могло значить] }
/** @param {any[]} staff @param {any} raw */
export function altPickStaff(staff, raw) {
  const s0 = lowE(clean(raw, 120)).replace(/[«»"“”„]/g, "").trim(), names = staffNames(staff);
  const hits = /** @param {any} ws */ ws => staff.filter((m, i) => ws.some(/** @param {any} w */ w => names[i].some(n => isForm(n, w))));
  const named = hits(nameToks(s0));
  // «не Арман», «любой, кроме Армана» — «любого» тут записывать нельзя: Altegio может назначить как раз его
  const exWords = [...s0.matchAll(/(?:^|[^а-яёa-z])(?:не|кроме|except|not|без)\s+(?:к\s+)?(\S+(?:\s+\S+)?)/g)].map(m => m[1]).join(" ");
  const excluded = /не\s?важ|не\s+указан|не\s+имеет|без\s+разниц|no\s+preference/.test(s0) ? [] : hits(nameToks(exWords));
  if (excluded.length) { const rest = named.filter(m => !excluded.includes(m)); return rest.length === 1 ? { staff: rest[0] } : { ask: staff.filter(m => !excluded.includes(m)), noAny: true }; }
  if (!s0) return { any: true };
  if (ANY_STAFF.test(s0)) return named.length === 1 ? { staff: named[0] } : named.length ? { ask: named } : { any: true }; // «любой, лучше Ерлан» — к Ерлану
  const eq = /** @param {any} a @param {any} b */ (a, b) => nameToks(a).join(" ") === nameToks(b).join(" ");
  // всё, что названо, подходит сразу к нескольким мастерам («Арман» при мастерах «Арман» и «Арман Сериков», «Айгерим» при двух тёзках) — не угадываем
  const qt = nameToks(s0), cover = qt.length ? staff.filter(m => { const mt = nameToks(`${m.name} ${m.spec || ""}`); return qt.every(w => mt.some(n => isForm(n, w))); }) : [];
  if (cover.length > 1) return { ask: cover };
  const full = staff.filter(m => eq(m.name, s0) || eq(`${m.name} (${m.spec})`, s0));
  if (full.length === 1) return { staff: full[0] };
  const s1 = s0.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim(); // без пояснения в скобках
  const byBase = staff.filter(m => eq(m.base, s1) || eq(m.name, s1));
  if (byBase.length) return byBase.length === 1 ? { staff: byBase[0] } : { ask: byBase }; // тёзки — не угадываем
  const ws = nameToks(s1).filter(w => !STAFF_POS.has(w) && w.length >= 2), near = ws.length ? hits(ws) : [];
  const both = ws.length >= 2 ? near.filter(m => { const ns = names[staff.indexOf(m)]; return ws.every(w => ns.some(n => isForm(n, w))); }) : near; // названы имя и фамилия — должны подойти оба слова
  const pick = both.length ? both : near;
  return pick.length === 1 ? { staff: pick[0] } : { ask: pick };
}
