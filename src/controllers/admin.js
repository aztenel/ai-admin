// @ts-check
// Панель владельца (/admin): все служебные страницы в одном месте, под компьютер. Только для владельца — клиенту и сотрудникам
// не нужна (17.10.2026, по просьбе владельца: адреса страниц приходилось помнить и набирать вручную с ?c=).
import { esc } from "../lib/text.js";
import { OWNER_BASE } from "../lib/css.js";
import { CLIENTS, DEMO_IDS } from "../config/builtin-clients.js";
/** @import { Env } from "../lib/types.js" */

// [адрес, название, пояснение, нужен ли бот (?c=)]
const TOOLS = [
  ["Работа с клиентами", [["/inbox", "Пульт чатов", "переписка, ответ клиенту, «Сделано»", 1], ["/leads", "Заявки", "все заявки за 30 дней", 1], ["/broadcast", "Рассылки", "шаблоны Meta, список из Excel", 1]]],
  ["Настройка", [["/studio", "Мои боты", "паспорта, ключи сотрудников, удаление", 0], ["/launch", "Проверка запуска", "что подключено, номер Wazzapo, экзамен бота", 1], ["/altegio", "Расписание Altegio", "свободные окна, пробная запись", 1], ["/altegio/user", "Ключ журнала Altegio", "получить ALTEGIO_USER_<ID>", 0]]],
  ["Проверки", [["/diag", "Диагностика", "ключи, модели ИИ, расходы за 7 дней", 0], ["/diag/storage", "Хранилища", "KV и база D1 этого адреса: чьи, сколько ключей, миграции", 0], ["/selftest", "Автотест бота", "сценарии без настоящих клиентов", 0], ["/", "Веб-чат бота", "проверка без WhatsApp", 1]]],
  ["Для клиентов и Meta", [["/privacy", "Политика конфиденциальности", "ссылка для Meta и клиентов", 0], ["/demo", "Демо пульта", "вымышленные данные, для показа", 0]]]
];

// вид панели (17.10.2026, по просьбе владельца): белый фон, тёмно-синие шапка с выбором бота и карточки; общая часть — OWNER_BASE
const PANEL_CSS = `${OWNER_BASE}
.top{position:static;padding-bottom:6px}.pick{background:var(--head);padding:6px max(24px,calc(50% - 526px)) 22px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}.pick span{color:var(--onh);font-size:14px}
.pick select{font:inherit;font-size:15px;color:#fff;background:var(--card);border:1px solid #2a4688;border-radius:10px;padding:10px 14px;min-width:260px}
h3{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:28px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.tool{display:flex;flex-direction:column;gap:4px;padding:18px 20px;background:var(--card);color:#fff;border-radius:14px;text-decoration:none;transition:background .15s}.tool:hover{background:var(--hover)}.tool b{font-size:16px;font-weight:600}.tool .mut{color:var(--onh);font-size:13.5px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;font:13.5px/1.6 ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace;margin:0}`;

/** @param {Env} env */
export function adminPage(env) {
  const bots = Object.values(CLIENTS).filter(c => env.SHOW_DEMOS === "1" || !DEMO_IDS.has(c.id));
  const opts = bots.map(c => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</option>`).join("");
  const groups = TOOLS.map(([g, list]) => `<h3>${g}</h3><div class="grid">${/** @type {any[]} */ (list).map(([href, t, d, needBot]) =>
    `<a class="tool" data-bot="${needBot}" data-href="${href}" href="${href}" title="${href}"><b>${esc(t)}</b><span class="mut">${esc(d)}</span></a>`).join("")}</div>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Панель — AI-администратор</title><style>${PANEL_CSS}</style></head><body>
<div class="top"><b>Панель владельца</b><a href="/studio">Мои боты</a><a href="/logout">Выйти</a></div>
<div class="pick"><select id="bot" aria-label="Бот">${opts}</select><span>ссылки ниже откроются для этого бота</span></div>
<div class="w">${groups}</div>
<script>
var S=document.getElementById('bot');try{var v=localStorage.getItem('aiaBot');if(v&&[].some.call(S.options,function(o){return o.value===v}))S.value=v}catch(e){}
function go(){try{localStorage.setItem('aiaBot',S.value)}catch(e){}[].forEach.call(document.querySelectorAll('.tool'),function(a){var h=a.dataset.href;if(a.dataset.bot==='1'){h+='?c='+encodeURIComponent(S.value)}a.href=h;a.title=h})}
S.onchange=go;go();
</script></body></html>`;
}

// /diag (и /diag/storage) в рамке панели: тот же текст, что раньше, но с шапкой и ссылкой назад
/** @param {string} body @param {string} [title] */
export const diagPage = (body, title = "Диагностика") => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — AI-администратор</title><style>${PANEL_CSS}</style></head><body>
<div class="top"><b>${esc(title)}</b><a href="/admin">Панель</a><a href="/logout">Выйти</a></div><div class="w"><pre>${body.replace(/[&<>]/g, ch => ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;")}</pre></div></body></html>`;
