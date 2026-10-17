// @ts-check
// Панель владельца (/admin): все служебные страницы в одном месте, под компьютер. Только для владельца — клиенту и сотрудникам
// не нужна (17.10.2026, по просьбе владельца: адреса страниц приходилось помнить и набирать вручную с ?c=).
import { ADMIN_CSS } from "../lib/css.js";
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

/** @param {Env} env */
export function adminPage(env) {
  const bots = Object.values(CLIENTS).filter(c => env.SHOW_DEMOS === "1" || !DEMO_IDS.has(c.id));
  const opts = bots.map(c => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</option>`).join("");
  const groups = TOOLS.map(([g, list]) => `<h3>${g}</h3><div class="grid">${/** @type {any[]} */ (list).map(([href, t, d, needBot]) =>
    `<a class="card tool" data-bot="${needBot}" data-href="${href}" href="${href}"><b>${t}</b><span class="mut">${d}</span><code>${href}${needBot ? "?c=…" : ""}</code></a>`).join("")}</div>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Панель — AI-администратор</title><style>${ADMIN_CSS}
.w{max-width:1100px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.tool{display:flex;flex-direction:column;gap:4px;margin:0;text-decoration:none;color:var(--ink)}.tool:hover{border-color:var(--acc)}.tool code{font-size:12px;color:var(--muted)}
.pick{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pick select{width:auto;min-width:260px}</style></head><body>
<div class="top"><b>Панель владельца</b><a href="/studio">Мои боты</a><a href="/logout">Выйти</a></div><div class="w">
<div class="card pick"><b>Бот:</b><select id="bot">${opts}</select><span class="mut">ссылки ниже откроются для этого бота</span></div>
${groups}</div>
<script>
var S=document.getElementById('bot');try{var v=localStorage.getItem('aiaBot');if(v&&[].some.call(S.options,function(o){return o.value===v}))S.value=v}catch(e){}
function go(){try{localStorage.setItem('aiaBot',S.value)}catch(e){}[].forEach.call(document.querySelectorAll('.tool'),function(a){var h=a.dataset.href;if(a.dataset.bot==='1'){h+='?c='+encodeURIComponent(S.value)}a.href=h;a.querySelector('code').textContent=h})}
S.onchange=go;go();
</script></body></html>`;
}

// /diag в рамке панели: тот же текст, что раньше, но с шапкой и ссылкой назад
/** @param {string} body */
export const diagPage = body => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Диагностика — AI-администратор</title><style>${ADMIN_CSS}.w{max-width:1100px}</style></head><body>
<div class="top"><b>Диагностика</b><a href="/admin">Панель</a><a href="/logout">Выйти</a></div><div class="w"><div class="card"><pre>${body.replace(/[&<>]/g, ch => ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;")}</pre></div></div></body></html>`;
