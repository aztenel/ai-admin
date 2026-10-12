// @ts-check
// «Мои боты» (/studio, /api/studio/*): список паспортов, проверка, сохранение, ключи сотрудников, удаление.
import { jsonP, sameOrigin } from "../lib/http.js";
import { ADMIN_CSS } from "../lib/css.js";
import { CLIENTS } from "../config/builtin-clients.js";
import { NICHES } from "../config/niches.js";
import { sha256Hex } from "../services/auth/session.js";
import { compileClient, syncClients } from "../services/tenants/passport.js";
import { freeSlots } from "../services/schedule/slots.js";
import { altLoc } from "../services/booking/book.js";
import { kvRetry } from "../services/studio/deps.js";
/** @import { Env, Client } from "../lib/types.js" */

// ================= ПАСПОРТ БОТА: клиенты из хранилища, без правки кода =================
// Настоящий клиент описывается данными («паспортом»): название, ниша, адрес, график, услуги и цены, способ записи.
// Паспорта лежат в KV одним ключом cfg:all = { <id>: паспорт }. Из паспорта собирается такой же объект, как у демо-клиентов в CLIENTS,
// поэтому весь движок (подсказка ИИ, защита ответа, запись, заявки) работает с ним без отдельных веток.
// Секреты в паспорт не кладём: токен WhatsApp — секрет WA_TOKEN_<ID>, подпись Meta — APP_SECRET_<ID> в панели Cloudflare.
/** @param {Env} env @returns {Promise<Record<string, any>>} */
async function loadCfgs(env) { return JSON.parse((await env.KV.get("cfg:all")) || "{}") || {}; } // при сбое чтения бросает ошибку: нельзя сохранять поверх «пустого» списка

// ================= «МОИ БОТЫ»: страница владельца =================
const CFG_KEYS = ["name", "niche", "kind", "address", "phone", "schedule", "booking", "altegioLoc", "step", "bookDays", "services", "staff", "extra", "repairs", "pay", "upsell", "digest", "remind", "review", "greeting", "safe", "tg", "waPhoneId", "off"];
/** @param {any} b */
const cfgIn = b => { const o = /** @type {Record<string, any>} */ ({}); for (const k of CFG_KEYS) if (b && b[k] !== undefined && b[k] !== null) o[k] = k === "off" ? !!b[k] : String(b[k]).slice(0, k === "repairs" ? 20000 : 8000); return o; };
// что подключено у клиента: по этим отметкам владелец видит, чего не хватает до запуска
/** @param {Env} env @param {Client} c */
function clientState(env, c) {
  const up = c.id.toUpperCase();
  return {
    id: c.id, name: c.name, kind: c.kind, niche: c.niche || "", dynamic: !!c.dynamic, off: !!c.off, updated: c.updated || 0,
    booking: altLoc(env, c) ? "altegio" : c.booking || "manual",
    key: !!(env["KEY_" + up] || c.keyHash),
    tg: !!(env.TG_TOKEN && (env["TG_CHAT_" + up] || c.tg || env.TG_CHAT)), tgOwn: !!(env["TG_CHAT_" + up] || c.tg),
    waToken: !!env["WA_TOKEN_" + up], waSecret: !!env["APP_SECRET_" + up]
  };
}
/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function studioApi(request, env, url, s) {
  const P = url.pathname, M = request.method;
  if (s.role !== "owner") return jsonP({ error: "Эта страница — только для владельца сервиса." }, 403);
  if (M === "GET" && P === "/api/studio/list") {
    return jsonP({ clients: Object.values(CLIENTS).map(c => clientState(env, c)), niches: Object.entries(NICHES).map(([id, n]) => ({ id, title: n.title })) });
  }
  if (M === "GET" && P === "/api/studio/get") {
    const id = /** @type {any} */ (url.searchParams.get("c")), all = await loadCfgs(env);
    if (!Object.hasOwn(all, id)) return jsonP({ error: "Такого бота нет." }, 404);
    const { keyHash, ...cfg } = all[id];
    return jsonP({ cfg: { ...cfg, id }, hasKey: !!keyHash });
  }
  if (M !== "POST" || !sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403);
  /** @type {Record<string, any>} */
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const id = String(b.id || b.c || "").trim();
  if (P === "/api/studio/check" || P === "/api/studio/save") {
    const all = await loadCfgs(env), old = Object.hasOwn(all, id) ? all[id] : null;
    const cfg = { ...cfgIn(b), id, ...(old && old.keyHash ? { keyHash: old.keyHash } : {}) };
    const r = compileClient(cfg);
    if (P === "/api/studio/save" && b.isNew && old) r.errors.push(`бот с идентификатором «${id}» уже есть — откройте его в списке`);
    const preview = r.errors.length ? null : { facts: r.client.facts, hours: r.client.hoursText, greeting: r.client.greeting, slots: freeSlots(r.client, Date.now()).map(d => `${d.rel ? d.rel + ", " : ""}${d.label}: ${d.times.join(", ")}`), services: r.client.services.length };
    if (P === "/api/studio/check" || r.errors.length) return jsonP({ ok: !r.errors.length, errors: r.errors, warnings: r.warnings, preview }, P === "/api/studio/save" && r.errors.length ? 400 : 200);
    all[id] = { ...cfg, v: ((old && old.v) || 0) + 1, updated: Date.now() };
    delete all[id].id;
    try { await kvRetry(() => env.KV.put("cfg:all", JSON.stringify(all))); } catch (e) { return jsonP({ ok: false, errors: ["не удалось сохранить — хранилище не отвечает, попробуйте ещё раз"] }, 500); }
    await syncClients(env, true);
    return jsonP({ ok: true, id, warnings: r.warnings, preview });
  }
  if (P === "/api/studio/key") { // новый ключ для сотрудников клиента: показываем один раз, в хранилище — только его хеш
    const all = await loadCfgs(env);
    if (!Object.hasOwn(all, id)) return jsonP({ error: "Ключ можно выдать только боту, созданному на этой странице." }, 400);
    const raw = crypto.getRandomValues(new Uint8Array(15)), key = [...raw].map(x => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("").replace(/(.{5})(?=.)/g, "$1-");
    all[id].keyHash = await sha256Hex(key);
    try { await kvRetry(() => env.KV.put("cfg:all", JSON.stringify(all))); } catch (e) { return jsonP({ error: "не удалось сохранить — попробуйте ещё раз" }, 500); }
    await syncClients(env, true);
    return jsonP({ ok: true, key });
  }
  if (P === "/api/studio/remove") {
    const all = await loadCfgs(env);
    if (!Object.hasOwn(all, id)) return jsonP({ error: "Такого бота нет." }, 404);
    if (String(b.confirm || "") !== id) return jsonP({ error: "Для удаления введите идентификатор бота." }, 400);
    delete all[id];
    try { await kvRetry(() => env.KV.put("cfg:all", JSON.stringify(all))); } catch (e) { return jsonP({ error: "не удалось сохранить — попробуйте ещё раз" }, 500); }
    await syncClients(env, true);
    return jsonP({ ok: true });
  }
  return jsonP({ error: "Не найдено." }, 404);
}
export function studioPage() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Мои боты — AI-администратор</title><style>${ADMIN_CSS}</style></head><body>
<div class="top"><b>Мои боты</b><a href="/leads">Заявки</a><a href="/logout">Выйти</a></div><div class="w">
<div id="list"><p class="mut">Загрузка…</p></div>
<div id="edit" hidden>
<h2 id="etitle">Новый бот</h2><p class="mut">Заполните то, что знаете. Кнопка «Проверить» покажет ошибки и то, что бот будет знать о компании.</p>
<div id="idrow"><label>Короткое имя бота<small>Латиницей, без пробелов — например acme. Попадёт в адреса страниц, потом не меняется.</small></label><input type="text" id="f_id" maxlength="16" autocapitalize="off" autocomplete="off"></div>
<label>Название компании</label><input type="text" id="f_name" maxlength="60">
<label>Ниша</label><select id="f_niche"></select>
<div id="kindrow" hidden><label>Чем занимается компания<small>Два-три слова: «студия массажа», «ветеринарная клиника».</small></label><input type="text" id="f_kind" maxlength="60"></div>
<label>Адрес</label><input type="text" id="f_address" maxlength="160" placeholder="Астана, ул. …, дом …">
<label>Телефон компании</label><input type="text" id="f_phone" maxlength="30" placeholder="+7 701 123 45 67" inputmode="tel">
<label>График работы<small>Например: Пн–Пт 10:00–21:00; Сб–Вс 11:00–19:00. Или: ежедневно 9–21.</small></label><textarea id="f_schedule" style="min-height:60px"></textarea>
<label>Как бот записывает</label><select id="f_booking"><option value="altegio">Сам записывает в Altegio</option><option value="manual">Собирает заявку — администратор подтверждает</option><option value="none">Не записывает — только отвечает и берёт телефон</option></select>
<div id="altrow"><label>Номер филиала в Altegio<small>Число из адреса журнала в Altegio. Услуги, цены и мастеров бот возьмёт из Altegio сам.</small></label><input type="text" id="f_altegioLoc" maxlength="12" inputmode="numeric"></div>
<div id="manrow"><label>Услуги и цены<small>Одна услуга на строке: название — цена — минуты. Например: Мужская стрижка — 6000 — 60</small></label><textarea id="f_services" style="min-height:150px"></textarea>
<label>Мастера или специалисты<small>По одному на строке: Арман — топ-барбер. Можно не заполнять.</small></label><textarea id="f_staff" style="min-height:70px"></textarea>
<div id="steprow"><label>Шаг записи, минут<small>Через сколько минут бот предлагает следующее время: 60 — каждый час, 30 — каждые полчаса.</small></label><input type="number" id="f_step" min="15" max="240" value="60">
<label>На сколько дней вперёд записывать<small>От 1 до 7. Обычно 3: сегодня, завтра и послезавтра.</small></label><input type="number" id="f_bookDays" min="1" max="7" value="3"></div></div>
<label>Прайс ремонта<small>Для сервисов и магазинов техники. По строке: модель | работа | цена | срок, например «iPhone 13 | замена экрана | 45000–60000 | 1 день». Цена: «45000», «от 30000», «45000–60000», «бесплатно» или «после диагностики». Бот называет только эти цены и всегда говорит, что это предварительная оценка. До 300 строк.</small></label><textarea id="f_repairs" style="min-height:100px" placeholder="iPhone 13 | замена экрана | 45000–60000 | 1 день"></textarea>
<label>Допродажи<small>По строке: «Услуга → что предложить к ней», например «Мужская стрижка → Оформление бороды». Бот предложит дополнение один раз за разговор и не будет настаивать. До 10 строк.</small></label><textarea id="f_upsell" style="min-height:64px" placeholder="Мужская стрижка → Оформление бороды"></textarea>
<label>Реквизиты для оплаты<small>Kaspi Gold, номер для перевода, ссылка на оплату — как их должен увидеть клиент. Бот отправляет этот текст дословно, когда спрашивают про оплату; в пульте он вставляется кнопкой «₸». До 500 знаков.</small></label><textarea id="f_pay" style="min-height:64px" placeholder="Kaspi Gold: +7 701 123 45 67 (Имя Ф.)"></textarea>
<label>Дополнительно<small>Всё, что бот должен знать: оплата, предоплата, правила отмены, парковка, с какого возраста. Каждое правило — с новой строки. Чего здесь нет, бот не обещает.</small></label><textarea id="f_extra" style="min-height:120px"></textarea>
<label>Telegram администратора<small>Номер чата, куда приходят заявки и просьбы клиентов. Пусто — уведомления идут вам.</small></label><input type="text" id="f_tg" maxlength="120" inputmode="numeric">
<label>Напоминания клиентам о записи<small>Только о записях, которые бот сам сделал в Altegio, и только в WhatsApp. Через официальный WhatsApp (Meta) — если клиент писал за последние сутки.</small></label><select id="f_remind"><option value="">накануне в 18:00 и за 2 часа</option><option value="day">только накануне в 18:00</option><option value="off">не напоминать</option></select>
<label>Ссылка на отзывы<small>2ГИС, Google Карты и т. п. Если указана — через 3 часа после начала записи бот попросит клиента оставить отзыв. Пусто — не просит.</small></label><input type="text" id="f_review" maxlength="300" placeholder="https://2gis.kz/...">
<label>Дневная сводка в Telegram<small>Раз в день: сколько было чатов, записей, заявок, просьб и кто ждёт ответа. Утренняя сводка — за вчерашний день.</small></label><select id="f_digest"><option value="">в 21:00 (по умолчанию)</option><option value="20">в 20:00</option><option value="22">в 22:00</option><option value="23">в 23:00</option><option value="9">в 9:00 утра — за вчера</option><option value="8">в 8:00 утра — за вчера</option><option value="off">не присылать</option></select>
<label>WhatsApp: Phone number ID<small>Число из кабинета Meta (WhatsApp → API Setup). Можно вписать позже — нужно для проверки номера на странице «Проверка запуска».</small></label><input type="text" id="f_waPhoneId" maxlength="20" inputmode="numeric">
<label><input type="checkbox" id="f_off"> Бот выключен<small>Клиентам в WhatsApp отвечает только администратор из пульта чатов.</small></label>
<div id="out"></div>
<div class="row"><button class="btn" id="b_check">Проверить</button><button class="btn p" id="b_save">Сохранить</button><button class="btn" id="b_back">К списку</button></div>
<div id="extra" hidden><h3>Ключ для сотрудников</h3><p class="mut">С этим ключом администратор компании входит в пульт чатов и видит только своих клиентов. Ключ показывается один раз.</p>
<div class="row"><button class="btn" id="b_key">Выдать новый ключ</button><button class="btn d" id="b_del">Удалить бота</button></div><div id="keyout"></div></div>
</div></div>
<script>
var $=function(i){return document.getElementById(i)},FIELDS=['name','niche','kind','address','phone','schedule','booking','altegioLoc','step','bookDays','services','staff','extra','repairs','pay','upsell','tg','digest','remind','review','waPhoneId'],cur=null,niches=[];
function api(p,b){return fetch(p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{}).then(function(r){return r.json().then(function(j){j._status=r.status;return j})})}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function tag(ok,t){return el('span','tag '+(ok===true?'ok':ok===false?'no':''),t)}
function show(v){$('list').hidden=v!=='list';$('edit').hidden=v!=='edit';window.scrollTo(0,0)}
function load(){api('/api/studio/list').then(function(d){if(d.error){$('list').textContent=d.error;return}niches=d.niches;var L=$('list');L.textContent='';
 var mine=d.clients.filter(function(c){return c.dynamic}),demo=d.clients.filter(function(c){return !c.dynamic});
 var h=el('h2','', 'Боты клиентов');L.appendChild(h);
 if(!mine.length)L.appendChild(el('p','mut','Пока нет ни одного. Нажмите «Новый бот» и заполните паспорт компании.'));
 mine.forEach(function(c){L.appendChild(card(c))});
 var nb=el('button','btn p','+ Новый бот');nb.onclick=function(){openEdit(null)};L.appendChild(nb);
 L.appendChild(el('h2','','Демо-боты'));L.appendChild(el('p','mut','Встроенные примеры для показа. Меняются только в коде.'));
 demo.forEach(function(c){L.appendChild(card(c))})})}
function card(c){var d=el('div','card');d.appendChild(el('b','',c.name));d.appendChild(el('div','mut',c.kind+' · '+c.id+(c.off?' · выключен':'')));
 var t=el('div','tags');t.appendChild(tag(null,c.booking==='altegio'?'запись в Altegio':c.booking==='none'?'без записи':'заявки администратору'));
 if(c.dynamic){t.appendChild(tag(c.tgOwn?true:c.tg?null:false,c.tgOwn?'Telegram администратора':c.tg?'Telegram: общий чат':'Telegram не настроен'));t.appendChild(tag(c.waToken&&c.waSecret,c.waToken&&c.waSecret?'WhatsApp подключён':'WhatsApp не подключён'));t.appendChild(tag(c.key,c.key?'ключ сотрудника выдан':'нет ключа сотрудника'))}
 d.appendChild(t);var r=el('div','row');
 function a(h,x,p){var e=el('a','btn'+(p?' p':''),x);e.href=h;r.appendChild(e)}
 if(c.dynamic){var b=el('button','btn p','Изменить');b.onclick=function(){openEdit(c.id)};r.appendChild(b)}
 a('/?c='+c.id,'Чат');a('/inbox?c='+c.id,'Пульт чатов');a('/leads?c='+c.id,'Заявки');if(c.dynamic){a('/broadcast?c='+c.id,'Рассылки');a('/launch?c='+c.id,'Проверка запуска')}
 d.appendChild(r);return d}
function fill(cfg){FIELDS.forEach(function(k){var e=$('f_'+k);if(e)e.value=cfg[k]!==undefined&&cfg[k]!==null?cfg[k]:(k==='step'?60:k==='bookDays'?3:k==='booking'?'altegio':k==='niche'?'barber':'')});$('f_off').checked=!!cfg.off;rows()}
function rows(){var b=$('f_booking').value;$('altrow').hidden=b!=='altegio';$('manrow').hidden=b==='altegio';$('steprow').hidden=b!=='manual';$('kindrow').hidden=$('f_niche').value!=='other'}
function read(){var o={id:cur||$('f_id').value.trim().toLowerCase(),isNew:!cur,off:$('f_off').checked};FIELDS.forEach(function(k){o[k]=$('f_'+k).value});return o}
function openEdit(id){cur=id;$('out').textContent='';$('keyout').textContent='';var s=$('f_niche');s.textContent='';niches.forEach(function(n){var o=el('option','',n.title);o.value=n.id;s.appendChild(o)});
 $('idrow').hidden=!!id;$('extra').hidden=!id;$('etitle').textContent=id?'Бот «'+id+'»':'Новый бот';$('f_id').value='';
 if(!id){fill({});show('edit');return}
 api('/api/studio/get?c='+encodeURIComponent(id)).then(function(d){if(d.error){alert(d.error);return}fill(d.cfg);show('edit')})}
function report(d,saved){var o=$('out');o.textContent='';
 if(d.errors&&d.errors.length){var e=el('div','msg e');e.appendChild(el('b','','Нужно исправить:'));d.errors.forEach(function(x){e.appendChild(el('div','','• '+x))});o.appendChild(e)}
 if(d.warnings&&d.warnings.length){var w=el('div','msg w');w.appendChild(el('b','','Обратите внимание:'));d.warnings.forEach(function(x){w.appendChild(el('div','','• '+x))});o.appendChild(w)}
 if(d.ok){o.appendChild(el('div','msg g',saved?'Сохранено. Изменения начнут действовать в течение минуты.':'Ошибок нет. Ниже — то, что бот будет знать о компании.'))}
 if(d.preview){o.appendChild(el('h3','','Что знает бот'));o.appendChild(el('pre','',d.preview.facts||'(только то, что придёт из Altegio)'));o.appendChild(el('div','mut','График: '+d.preview.hours));
  if(d.preview.slots&&d.preview.slots.length){o.appendChild(el('h3','','Какое время бот предложит'));o.appendChild(el('pre','',d.preview.slots.join('\\n')))}
  o.appendChild(el('h3','','Приветствие'));o.appendChild(el('pre','',d.preview.greeting))}
 o.scrollIntoView({behavior:'smooth',block:'nearest'})}
$('f_booking').onchange=rows;$('f_niche').onchange=rows;$('b_back').onclick=function(){show('list');load()};
$('b_check').onclick=function(){api('/api/studio/check',read()).then(function(d){report(d,false)})};
$('b_save').onclick=function(){var b=read();api('/api/studio/save',b).then(function(d){report(d,true);if(d.ok&&!cur){cur=b.id;$('idrow').hidden=true;$('extra').hidden=false;$('etitle').textContent='Бот «'+cur+'»'}})};
$('b_key').onclick=function(){if(!confirm('Выдать новый ключ? Прежний ключ сотрудников перестанет работать.'))return;api('/api/studio/key',{id:cur}).then(function(d){var o=$('keyout');o.textContent='';if(d.error){o.appendChild(el('div','msg e',d.error));return}
 var m=el('div','msg g');m.appendChild(el('div','','Ключ сотрудников (сохраните сейчас — больше он не покажется):'));m.appendChild(el('pre','',d.key));m.appendChild(el('div','','Страница входа для администратора: '+location.origin+'/inbox?c='+cur));o.appendChild(m)})};
$('b_del').onclick=function(){var x=prompt('Удалить бота «'+cur+'»? Переписка и заявки сотрутся сами через 30 дней. Для подтверждения введите его короткое имя:');if(x===null)return;api('/api/studio/remove',{id:cur,confirm:x.trim()}).then(function(d){if(d.error){alert(d.error);return}show('list');load()})};
load();
</script></body></html>`;
}
