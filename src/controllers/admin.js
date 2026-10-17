// @ts-check
// Панель владельца (/admin): все служебные страницы в одном месте, под компьютер. Только для владельца — клиенту и сотрудникам
// не нужна (17.10.2026, по просьбе владельца: адреса страниц приходилось помнить и набирать вручную с ?c=).
import { esc } from "../lib/text.js";
import { CLIENTS, DEMO_IDS } from "../config/builtin-clients.js";
/** @import { Env } from "../lib/types.js" */

// [адрес, название, пояснение, нужен ли бот (?c=)]
const TOOLS = [
  ["Работа с клиентами", [["/inbox", "Пульт чатов", "переписка, ответ клиенту, «Сделано»", 1], ["/leads", "Заявки", "все заявки за 30 дней", 1], ["/broadcast", "Рассылки", "шаблоны Meta, список из Excel", 1]]],
  ["Настройка", [["/studio", "Мои боты", "паспорта, ключи сотрудников, удаление", 0], ["/launch", "Проверка запуска", "что подключено, номер Wazzapo, экзамен бота", 1], ["/altegio", "Расписание Altegio", "свободные окна, пробная запись", 1], ["/altegio/user", "Ключ журнала Altegio", "получить ALTEGIO_USER_<ID>", 0]]],
  ["Проверки", [["/diag", "Диагностика", "ключи, модели ИИ, расходы за 7 дней", 0], ["/selftest", "Автотест бота", "сценарии без настоящих клиентов", 0], ["/", "Веб-чат бота", "проверка без WhatsApp", 1]]],
  ["Для клиентов и Meta", [["/privacy", "Политика конфиденциальности", "ссылка для Meta и клиентов", 0], ["/demo", "Демо пульта", "вымышленные данные, для показа", 0]]]
];

// свой спокойный вид панели (17.10.2026, по просьбе владельца): тёмно-синий и белый, минимум рамок; шрифт — системный
// (внешние шрифты CSP не пускает): на Windows — Segoe UI Variable, на Mac и iPhone — SF Pro
const PANEL_CSS = `:root{--bg:#0a1428;--card:#101e3a;--hover:#16284b;--ink:#fff;--mut:#9aa9c7;--line:#1d2f55}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI Variable Text","Segoe UI Variable","Segoe UI",-apple-system,"SF Pro Text",BlinkMacSystemFont,Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.top{display:flex;align-items:center;gap:24px;max-width:1100px;margin:0 auto;padding:28px 24px 8px}.top b{flex:1;font-size:24px;font-weight:600;letter-spacing:-.01em}.top a{color:var(--mut);text-decoration:none;font-size:14px}.top a:hover{color:var(--ink)}
.w{max-width:1100px;margin:0 auto;padding:8px 24px 48px}h3{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:32px 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.tool{display:flex;flex-direction:column;gap:4px;padding:18px 20px;background:var(--card);border-radius:14px;text-decoration:none;transition:background .15s}.tool:hover{background:var(--hover)}.tool b{font-size:16px;font-weight:600}.mut{color:var(--mut);font-size:13.5px}
.pick{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:12px}.pick span{color:var(--mut);font-size:14px}
select{font:inherit;font-size:15px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:260px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--card);border-radius:14px;padding:20px 22px;font:13.5px/1.6 ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace;margin:16px 0}`;

/** @param {Env} env */
export function adminPage(env) {
  const bots = Object.values(CLIENTS).filter(c => env.SHOW_DEMOS === "1" || !DEMO_IDS.has(c.id));
  const opts = bots.map(c => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</option>`).join("");
  const groups = TOOLS.map(([g, list]) => `<h3>${g}</h3><div class="grid">${/** @type {any[]} */ (list).map(([href, t, d, needBot]) =>
    `<a class="tool" data-bot="${needBot}" data-href="${href}" href="${href}" title="${href}"><b>${esc(t)}</b><span class="mut">${esc(d)}</span></a>`).join("")}</div>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Панель — AI-администратор</title><style>${PANEL_CSS}</style></head><body>
<div class="top"><b>Панель владельца</b><a href="/studio">Мои боты</a><a href="/logout">Выйти</a></div><div class="w">
<div class="pick"><select id="bot" aria-label="Бот">${opts}</select><span>ссылки ниже откроются для этого бота</span></div>
${groups}</div>
<script>
var S=document.getElementById('bot');try{var v=localStorage.getItem('aiaBot');if(v&&[].some.call(S.options,function(o){return o.value===v}))S.value=v}catch(e){}
function go(){try{localStorage.setItem('aiaBot',S.value)}catch(e){}[].forEach.call(document.querySelectorAll('.tool'),function(a){var h=a.dataset.href;if(a.dataset.bot==='1'){h+='?c='+encodeURIComponent(S.value)}a.href=h;a.title=h})}
S.onchange=go;go();
</script></body></html>`;
}

// /diag в рамке панели: тот же текст, что раньше, но с шапкой и ссылкой назад
/** @param {string} body */
export const diagPage = body => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Диагностика — AI-администратор</title><style>${PANEL_CSS}</style></head><body>
<div class="top"><b>Диагностика</b><a href="/admin">Панель</a><a href="/logout">Выйти</a></div><div class="w"><pre>${body.replace(/[&<>]/g, ch => ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;")}</pre></div></body></html>`;
