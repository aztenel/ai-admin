// @ts-check
// Страница автотеста /selftest (сами сценарии — в services/selftest).
import { esc } from "../lib/text.js";
import { BASE_CSS } from "../lib/css.js";
import { CLIENTS } from "../config/builtin-clients.js";
import { CASES } from "../services/selftest/cases.js";

/** @param {string} key */
export function selftestPage(key) {
  const list = JSON.stringify(CASES.map((k, i) => ({ i, c: CLIENTS[k.c].name, t: k.t }))).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Автотест бота</title>
<style>${BASE_CSS}.w{max-width:760px;margin:0 auto;padding:20px 16px}h1{font-size:21px;margin:0 0 4px}p{color:var(--muted);line-height:1.5;margin:4px 0 14px}
button{background:var(--acc);color:#fff;border:0;border-radius:10px;padding:11px 16px;font:600 15px system-ui;cursor:pointer}button:disabled{opacity:.5}
#sum{font-weight:700;margin:12px 0}.r{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:8px 0;padding:10px 12px}
.r summary{cursor:pointer;display:flex;gap:8px;align-items:baseline;list-style:none}.r summary::-webkit-details-marker{display:none}
.st{flex:none;width:22px}.nm{flex:1;min-width:0}.nm small{color:var(--muted)}.f{color:var(--bad);font-size:13.5px;margin:6px 0 0 30px}
.tr{font-size:13.5px;line-height:1.45;margin:8px 0 0 30px}.tr div{margin:4px 0}.u{color:var(--muted)}.g{color:var(--bad);font-size:12px}
.ok{color:var(--good)}.bad{color:var(--bad)}select{padding:9px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:14px}</style></head>
<body><div class="w"><h1>Автотест AI-администратора</h1>
<p>Прогоняет ${CASES.length} диалогов через живую модель и проверяет ответы. Бесплатный лимит Gemini небольшой, поэтому сценарии идут по одному: весь прогон — 3–8 минут. Заявки автотеста в реальный список не попадают.</p>
<select id="only"><option value="">Все ниши</option>${Object.values(CLIENTS).filter(c => !c.hidden || CASES.some(k => k.c === c.id)).map(c => `<option>${esc(c.name)}</option>`).join("")}</select>
<button id="go">Запустить</button><div id="sum"></div><div id="out"></div></div>
<script>
const L=${list},KEY=${JSON.stringify(key).replace(/</g, "\\u003c")};const out=document.getElementById('out'),sum=document.getElementById('sum'),go=document.getElementById('go');
function row(k){const d=document.createElement('details');d.className='r';d.innerHTML='<summary><span class="st">⏳</span><span class="nm"></span></summary>';d.querySelector('.nm').textContent=k.t+' ';const s=document.createElement('small');s.textContent=k.c;d.querySelector('.nm').appendChild(s);out.appendChild(d);return d}
function fill(d,r){d.querySelector('.st').textContent=r.pass?'✅':r.limit?'⚠️':'❌';if(r.limit){const f=document.createElement('div');f.className='f';f.textContent='Лимит бесплатного Gemini (429) — это не ошибка бота. Перезапустите эту нишу через минуту.';d.appendChild(f)}if(r.error){const f=document.createElement('div');f.className='f';f.textContent=r.error;d.appendChild(f);return}
if(!r.pass){const f=document.createElement('div');f.className='f';f.textContent='Не прошло: '+r.fails.join(' · ');d.appendChild(f);d.open=true}
const tr=document.createElement('div');tr.className='tr';for(const m of r.transcript){const u=document.createElement('div');u.className='u';u.textContent='Клиент: '+m.u;const b=document.createElement('div');b.textContent='Бот ('+(m.ms/1000).toFixed(1)+' с): '+m.b+(m.lead?'  [заявка: '+m.lead.name+', '+(m.lead.phone||'—')+']':'')+(m.cancel?'  [отмена]':'')+(m.handoff?'  [передано администратору]':'')+(m.paused?'  [бот на паузе]':'')+(m.error?'  [сбой: '+m.error.slice(0,120)+']':'');tr.append(u,b);if(m.guard){const g=document.createElement('div');g.className='g';g.textContent='защита сработала: '+m.guard;tr.appendChild(g)}}d.appendChild(tr)}
go.onclick=async()=>{go.disabled=true;out.innerHTML='';const only=document.getElementById('only').value;const todo=L.filter(k=>!only||k.c===only);let ok=0,bad=0,lim=0;
for(const k of todo){const d=row(k);let r;for(let a=0;a<3;a++){try{const x=await fetch('/api/selftest',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:KEY,i:k.i})});r=await x.json();if(!r.limit)break}catch(e){r={pass:false,error:String(e),fails:[],transcript:[]}}d.querySelector('.st').textContent='⏸';await new Promise(s=>setTimeout(s,20000))}
fill(d,r);r.pass?ok++:r.limit?lim++:bad++;sum.innerHTML='<span class="ok">Прошло: '+ok+'</span> · <span class="bad">Не прошло: '+bad+'</span>'+(lim?' · ⚠️ лимит Gemini: '+lim:'')+' · из '+todo.length;await new Promise(s=>setTimeout(s,4000))}
go.disabled=false};
</script></body></html>`;
}
