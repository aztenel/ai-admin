// @ts-check
// Страницы: заявки /leads, политика /privacy, витрина демо /, веб-чат.
import { esc } from "../lib/text.js";
import { BASE_CSS } from "../lib/css.js";
import { CLIENTS } from "../config/builtin-clients.js";
import { allLeads } from "../services/inbox/deps.js";
/** @import { Env, Client } from "../lib/types.js" */

/** @param {Env} env @param {any} only @param {any} [s] */
export async function leadsPage(env, only, s) { // s — вошедший человек (cookie): ему показываем переходы в пульт и рассылки
  const ids = only ? [only] : Object.keys(CLIENTS);
  let total = 0, blocks = "", blind = false, part = false;
  for (const id of ids) {
    // у массива бывает пометка unread ("all" — хранилище не отвечает)
    /** @type {any} */
    const leads = await allLeads(env, id);
    if (leads.unread === "all") blind = true; else if (leads.unread) part = true;
    total += leads.length;
    if (!leads.length && !only) continue;
    blocks += `<h3>${esc(CLIENTS[id].name)} (${leads.length})</h3>` + leads.slice().reverse().map((/** @type {any} */ l) => `<div class="l${l.status ? " x" : ""}"><b>${esc(l.name || "имя не указано")}</b>${l.status ? ` <em>${esc(l.status)}</em>` : ""}<br>${esc(l.phone || "без телефона")} · ${esc(l.service)}<br>${esc(l.time)}${l.note ? `<br><small>${esc(l.note)}</small>` : ""}<br><small>${esc(l.source)} · ${esc(l.at)}</small>${s && l.phone ? `<br><a href="tel:${esc(l.phone)}">Позвонить</a>${/^WhatsApp/.test(l.source || "") ? ` · <a href="/inbox?c=${id}#wa:${esc(String(l.phone).replace(/\D/g, ""))}">Открыть чат</a>` : ""}` : ""}</div>`).join("");
  }
  // хранилище не читается — так и пишем: пустая страница выглядела бы как «заявок нет»
  const warn = !env.KV ? "Хранилище KV не подключено к воркеру — заявки негде хранить. Проверьте настройку на странице /diag."
    : blind ? `Хранилище не отвечает — ${blocks ? "часть заявок сейчас не видна" : "заявки сейчас не видны"}, попробуйте обновить страницу. Заявки не потеряны.`
    : part ? "Общий список заявок сейчас не читается — показаны последние заявки из запасных копий. Попробуйте обновить страницу." : "";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заявки</title>
<style>${BASE_CSS}body{padding:16px;max-width:640px;margin:0 auto}h3{margin:22px 0 4px}.l{background:var(--panel);border-radius:12px;padding:12px 14px;margin:10px 0;border:1px solid var(--line);line-height:1.5}small{color:var(--muted)}.x{opacity:.55}.x b{text-decoration:line-through}em{color:var(--bad);font-style:normal;font-weight:700}a{color:var(--acc)}</style>
${s ? `<p style="display:flex;gap:14px;flex-wrap:wrap;margin:0 0 6px"><a href="/inbox${only ? "?c=" + only : ""}">← Чаты</a>${only ? `<a href="/broadcast?c=${only}">Рассылки</a>` : ""}${s.role === "owner" ? `<a href="/studio">Боты</a>` : ""}<a href="/logout">Выйти</a></p>` : ""}<h2>Заявки (${total})</h2>${warn ? `<p style="background:var(--lead);border:1px solid var(--leadl);border-radius:12px;padding:10px 14px;line-height:1.5">${warn}</p>` : ""}${blocks || (warn ? "" : "<p>Пока пусто</p>")}`;
}

// политика конфиденциальности — нужна Meta, чтобы опубликовать приложение (App settings → Basic → Privacy Policy URL)
/** @param {Env} env */
export function privacyPage(env) {
  const owner = esc(env.OWNER_NAME || "Владелец сервиса «AI-администратор»");
  const mail = env.OWNER_EMAIL ? `<a href="mailto:${esc(env.OWNER_EMAIL)}">${esc(env.OWNER_EMAIL)}</a>` : "контакт владельца сервиса";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Политика конфиденциальности — AI-администратор</title>
<style>${BASE_CSS}.w{max-width:720px;margin:0 auto;padding:24px 16px 48px;line-height:1.55}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:22px 0 6px}p,li{color:var(--ink)}.m{color:var(--muted)}</style></head><body><div class="w">
<h1>Политика конфиденциальности</h1><p class="m">Сервис «AI-администратор» · редакция от 04.10.2026</p>
<p>AI-администратор — автоматический ассистент, который отвечает в WhatsApp и в веб-чате от имени компании (клиники, салона, автосервиса и т.п.): рассказывает об услугах и ценах и принимает заявки на запись. Оператор сервиса: ${owner}. Связь: ${mail}.</p>
<h2>Какие данные мы обрабатываем</h2><ul><li>номер телефона WhatsApp и имя профиля;</li><li>текст сообщений, которые вы отправляете;</li><li>данные для записи, которые вы сами сообщаете: имя, желаемая услуга, дата и время.</li></ul>
<p>Голосовые сообщения, фото и файлы бот не распознаёт. В переписке остаётся отметка о том, что вы их прислали; сам файл администратор компании может открыть из переписки, пока его хранит WhatsApp. Копий файлов сервис не делает.</p>
<h2>Зачем</h2><p>Чтобы ответить на ваш вопрос, записать вас или передать заявку администратору компании. Переписку с ботом видят администраторы этой компании: они могут продолжить разговор и ответить вам сами. Сервис не продаёт данные и не передаёт их третьим лицам для их собственных целей.</p>
<h2>Сообщения от компании</h2><p>Компания может сама написать вам в WhatsApp — напомнить о записи, сообщить новости или предложение. Такие сообщения получают только её клиенты, оставлявшие компании свой номер. Чтобы больше их не получать, ответьте «стоп»: отметка об отказе хранится бессрочно, и рассылки компании вам приходить не будут.</p>
<h2>Кто ещё участвует в обработке</h2><ul><li>Meta (WhatsApp Business Platform) — доставка сообщений;</li><li>Google (Gemini API) — формирование ответа по тексту переписки; номер телефона в модель не передаётся;</li><li>Cloudflare — хостинг и хранение истории переписки;</li><li>Telegram — уведомления администратору компании: о заявке, а также текст вашего сообщения, когда на него должен ответить человек (вы попросили администратора или написали «стоп»);</li><li>Altegio — расписание компании, если она им пользуется: при записи туда передаются имя, номер телефона, услуга и время.</li></ul>
<h2>Сколько храним</h2><ul><li>история переписки — 7 дней после последнего сообщения; если вы написали «стоп» — 30 дней, чтобы бот помнил о вашей просьбе;</li><li>заявки на запись и отметка о согласии — 30 дней;</li><li>отметка об отказе от сообщений («стоп») — бессрочно, пока вы не напишете «старт»;</li><li>списки номеров, которые компания загрузила для своих сообщений клиентам, — до 180 дней;</li><li>затем данные удаляются автоматически.</li></ul>
<h2 id="delete">Ваши права и удаление данных</h2><ul><li>напишите боту «стоп» — он перестанет отвечать вам автоматически, а компания перестанет присылать вам сообщения (ваши следующие сообщения увидит администратор); чтобы бот снова отвечал, напишите «старт»;</li><li>напишите «администратор» — с вами свяжется живой сотрудник;</li><li>чтобы узнать, какие данные о вас хранятся, или удалить их, напишите на ${mail} с номера или указанием номера телефона — удалим в течение 10 дней.</li></ul>
<h2>Согласие</h2><p>В начале переписки бот сообщает, что вам отвечает AI-ассистент. Продолжая переписку, вы соглашаетесь на обработку данных в описанных целях.</p>
<h2>English summary</h2><p class="m">AI Administrator is an automated assistant that answers WhatsApp and web-chat messages on behalf of a business and takes booking requests. We process your WhatsApp number, profile name and message text only to reply and pass your booking to the business; the business's staff can read the conversation and reply themselves. The business may also send WhatsApp messages (reminders, news, offers) to its own customers; reply "stop" to opt out — the opt-out mark is kept until you send "start". Voice messages, photos and files are not analysed or copied: the conversation keeps only a note that you sent them. Processors: Meta (message delivery), Google Gemini (reply generation; your phone number is not sent), Cloudflare (hosting), Telegram (staff notifications, including the text of a message a human has to answer), Altegio (the business's booking schedule, if used: your name, phone number, service and time). Chat history is kept for 7 days (30 days after you send "stop", so the bot remembers your request), booking requests for 30 days, recipient lists uploaded by the business for up to 180 days, then deleted automatically. Send "stop" to opt out of automatic replies and of the business's messages; to access or delete your data contact ${mail}.</p>
</div></body></html>`;
}

export function portfolioPage() {
  const cards = Object.entries(CLIENTS).filter(([, c]) => !c.hidden).map(([id, c]) => `<a class="card" href="/?c=${id}"><b>${esc(c.name)}</b><span>${esc(c.kind)}</span><i>Открыть чат →</i></a>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI-администраторы — демо</title>
<style>${BASE_CSS}.w{max-width:560px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 6px}p{color:var(--muted);margin:0 0 18px;line-height:1.5}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0;color:inherit;text-decoration:none}
.card b{display:block;font-size:17px}.card span{display:block;color:var(--muted);font-size:14px;margin:2px 0 6px}.card i{color:var(--acc);font-style:normal;font-weight:600;font-size:14px}</style></head>
<body><div class="w"><h1>AI-администратор для бизнеса</h1><p>Отвечает клиентам за секунды, 24/7, доводит до записи и сразу передаёт заявку владельцу. Выберите нишу и напишите как клиент.</p>${cards}</div></body></html>`;
}

/** @param {string} id @param {Client} c */
export function chatPage(id, c) {
  const cfg = JSON.stringify({ id, name: c.name, greeting: c.greeting, chips: c.chips, real: !!c.real }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(c.name)} — AI-администратор</title>
<style>${BASE_CSS}
html,body{height:100%}body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
.app{height:100%;max-width:520px;margin:0 auto;display:flex;flex-direction:column}
header{background:var(--head);color:#f3faf9;padding:12px 14px;display:flex;gap:10px;align-items:center}
header b{display:block;font-size:16px}header span{font-size:12.5px;color:#a9c9cc}
header .w{flex:1;min-width:0}header button{background:none;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:999px;padding:7px 10px;font:600 12px system-ui}
main{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.n{align-self:center;text-align:center;font-size:12.5px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;max-width:92%}
.m{max-width:84%;padding:9px 12px 6px;border-radius:14px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.b{align-self:flex-start;background:var(--bot);border-top-left-radius:4px}.u{align-self:flex-end;background:var(--panel);border-top-right-radius:4px}
.t{display:block;text-align:right;font-size:11px;color:var(--muted);margin-top:3px}.t i{color:var(--acc);font-style:normal;font-weight:700}
.lead{background:var(--lead);border:1px solid var(--leadl);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.5}
.chips{display:flex;gap:6px;overflow-x:auto;padding:6px 12px}
.chips button{flex:none;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:9px 12px;font:600 13px system-ui}
form{display:flex;gap:8px;padding:8px 12px 4px}
input{flex:1;min-width:0;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:22px;padding:11px 16px;font-size:16px}
form button{width:46px;height:46px;border-radius:50%;border:0;background:var(--acc);color:#fff;font-size:18px}
.pd{font-size:11px;color:var(--muted);text-align:center;padding:0 12px 10px}
</style></head><body><div class="app">
<header><div class="w"><b>${esc(c.name)} · AI-администратор</b><span>онлайн 24/7</span></div><button id="rs" type="button">Заново</button></header>
<main id="ch"></main><div class="chips" id="cp"></div>
<form id="f"><input id="in" placeholder="Напишите сообщение…" autocomplete="off" aria-label="Сообщение" maxlength="600"><button aria-label="Отправить">➤</button></form>
<div class="pd">Отправляя сообщение, вы соглашаетесь на обработку данных для записи.</div>
</div><script>
const C=${cfg};const ch=document.getElementById('ch'),cp=document.getElementById('cp'),inp=document.getElementById('in');
let sid,busy=false;
function newSid(){sid=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));try{localStorage.setItem('sid_'+C.id,sid)}catch(e){}}
try{sid=localStorage.getItem('sid_'+C.id)}catch(e){} if(!sid)newSid();
const now=()=>new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
function add(cls,text,sec,time){const d=document.createElement('div');d.className='m '+cls;d.textContent=text;const t=document.createElement('span');t.className='t';t.textContent=time===undefined?now():time;if(sec!=null){const i=document.createElement('i');i.textContent=' · ответ за '+sec.toFixed(1).replace('.',',')+' с';t.appendChild(i)}if(t.textContent)d.appendChild(t);ch.appendChild(d);ch.scrollTop=ch.scrollHeight}
function note(t){const d=document.createElement('div');d.className='n';d.textContent=t;ch.appendChild(d)}
function card(title,rows){const d=document.createElement('div');d.className='lead';const b=document.createElement('b');b.textContent=title;d.appendChild(b);(rows||[]).forEach(([k,v])=>{const s=document.createElement('div');s.textContent=k+': '+(v||'—');d.appendChild(s)});ch.appendChild(d);ch.scrollTop=ch.scrollHeight}
function chips(list){cp.innerHTML='';(list||[]).forEach(x=>{const b=document.createElement('button');b.type='button';b.textContent=x;b.onclick=()=>send(x);cp.appendChild(b)})}
async function send(text){text=(text||'').trim();if(!text||busy)return;busy=true;inp.value='';chips([]);add('u',text);
const typing=document.createElement('div');typing.className='m b';typing.textContent='печатает…';ch.appendChild(typing);ch.scrollTop=ch.scrollHeight;const t0=performance.now();
try{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({c:C.id,sid,text})});const d=await r.json();typing.remove();
add('b',d.reply||'Ошибка, попробуйте ещё раз.',(performance.now()-t0)/1000);
const L=d.leads||(d.lead?[d.lead]:[]),rq=L.some(l=>l.kind&&l.kind!=='callback');
if(d.cancel&&!rq)card(d.cancelDone?'Запись отменена':'Просьба передана администратору');if(d.handoff)card('Запрос передан живому администратору');
L.forEach(l=>l.kind==='callback'?card('Администратор перезвонит вам',[['Телефон',l.phone]]):l.kind?card('Просьба передана администратору',[['Телефон',l.phone]]):card(l.altegio&&l.altegio.record_id?'Запись создана в расписании':'Новая заявка передана администратору',[['Имя',l.name],['Телефон',l.phone],['Услуга',l.service],['Время',l.time]]));
chips((d.offer||[]).map(x=>'В '+x))}
catch(e){typing.remove();add('b','Нет связи, попробуйте ещё раз.')}busy=false}
function intro(){ch.innerHTML='';if(!C.real)note('Демо. Компания и цены условные. Напишите как клиент и посмотрите, как AI записывает.');add('b',C.greeting)}
async function start(){intro();chips(C.chips);
try{const r=await fetch('/api/history?c='+C.id+'&sid='+encodeURIComponent(sid));const d=await r.json();
if(d.turns&&d.turns.length){d.turns.forEach(t=>add(t.role==='user'?'u':'b',t.text,null,''));chips([])}}catch(e){}}
document.getElementById('f').onsubmit=e=>{e.preventDefault();send(inp.value)};
document.getElementById('rs').onclick=()=>{newSid();intro();chips(C.chips)};
start();
</script></body></html>`;
}
