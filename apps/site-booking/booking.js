/* Онлайн-запись на сайте: окно поверх страницы; ES5 без библиотек, как скрипт сайта.
   Нет fetch, запись выключена или API не ответил — кнопки остаются ссылками на WhatsApp. Подключение — apps/site-booking/README.md. */
(function(){
var W=window,D=document;
if(!W.fetch||!W.Promise||!D.body||!D.body.closest)return;
var me=D.currentScript||D.querySelector('script[src*="booking.js"]');
function attr(n,d){var v=me&&me.getAttribute(n);return v||d;}
var API=attr('data-api','https://ai-admin.azikonps4.workers.dev').replace(/\/+$/,'');
var CL=attr('data-client','winchester');
var CSS=attr('data-css',((me&&me.src)||'').replace(/[^\/]*$/,'')+'booking.css');
var MAP=attr('data-map','https://2gis.kz/astana/firm/70000001038239111');
var PRIV=attr('data-privacy','privacy.html');
var BASE=API+'/api/site/'+encodeURIComponent(CL)+'/';
var SKEY='wbk:'+CL;
var STEPS=['master','services','time','contacts'];
var TIT={master:'Мастер',services:'Услуги',time:'Время',contacts:'Контакты'};
var DW=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
var DAY=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
var MON=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
var MO=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
var NET='Не удалось загрузить данные. Проверь интернет и попробуй ещё раз.';
var WAIT='Заявка отправляется — подожди несколько секунд, окно закроется после ответа.';
var SLOW='Расписание отвечает дольше обычного — подожди, не закрывай окно.';
var LOST='Расписание отвечает слишком долго. Запись могла создаться — администратор проверит и свяжется с тобой. Не записывайся повторно.';
var ROM=['I','II','III','IV','V','VI'];
var CO={name:'Winchester',phone:'+7 700 505 05 03',tel:'+77005050503',wa:'77066940608',address:''};
var mq=W.matchMedia('(prefers-reduced-motion: reduce)');
function calm(){return mq.matches;}

var S={api:'idle',cat:null,sv:{},st:{},staff:null,any:false,keys:[],date:null,time:null,slot:null,
 step:'master',ret:false,near:null,nearAt:0,days:null,tr:null,tq:0,tc:{},note:'',msg:'',
 name:'',phN:'',comment:'',busy:false,done:null,mode:'dry'};
var root,panel,main,side,barT,nextB,lbl,prog,backB,live,cur,opener,isOpen=false,cssOk=false,pushed=false,skipPop=false,catP=null,advT=0,openPt=null,catTry=0,slowT=0;

// даты — свои массивы, без Intl и часового пояса браузера
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';';});}
function money(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+'\u00a0₸';}
function dur(m){var h=Math.floor(m/60),r=m%60;return(h?h+'\u00a0ч':'')+(h&&r?' ':'')+(r||!h?r+'\u00a0мин':'');}
function plur(n,a,b,c){var t=n%10,h=n%100;return n+' '+(t===1&&h!==11?a:t>1&&t<5&&(h<10||h>20)?b:c);}
function mins(t){var p=String(t).split(':');return+p[0]*60+ +p[1];}
function ud(s){var p=String(s).split('-');return new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));}
function addD(s,n){var d=ud(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function diff(a,b){return Math.round((ud(b)-ud(a))/864e5);}
function dLong(s){var d=ud(s);return DW[d.getUTCDay()]+', '+d.getUTCDate()+' '+MON[d.getUTCMonth()];}
function dRel(s){var n=S.cat?diff(S.cat.today,s):9,d=ud(s);return n===0?'сегодня':n===1?'завтра':DW[d.getUTCDay()].toLowerCase()+', '+d.getUTCDate()+' '+MO[d.getUTCMonth()];}
var NAME;try{NAME=new RegExp("^[\\p{L}][\\p{L}\\s.'’-]*$",'u');}catch(e){NAME=/^[^\d\s][^\d]*$/;}
function low(s){return String(s||'').toLowerCase().replace(/ё/g,'е').trim();}
function closest(el,sel){return el&&el.closest?el.closest(sel):null;}
function q(sel,el){return(el||cur).querySelector(sel);}
function byId(i){return D.getElementById(i);}
function raf(f){W.requestAnimationFrame(f);}
function ga(el,n){return el.getAttribute(n);}
function qa(sel,el){return Array.prototype.slice.call((el||root).querySelectorAll(sel));}

// значки — SVG: в шрифтах сайта нет стрелок и галочек
function ic(p,vb){return'<svg viewBox="'+(vb||'0 0 24 24')+'" aria-hidden="true" focusable="false">'+p+'</svg>';}
var L=' fill="none" stroke="currentColor" stroke-width="1.6"';
var I={
 back:ic('<path d="M14.5 5.5 8 12l6.5 6.5"'+L+'/>'),next:ic('<path d="M9.5 5.5 16 12l-6.5 6.5"'+L+'/>'),
 x:ic('<path d="M6 6l12 12M18 6 6 18"'+L+'/>'),ok:ic('<path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6"/>'),
 cal:ic('<path d="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4"'+L+'/>'),
 star:ic('<path d="m12 2.8 2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3L2.9 9.4l6.3-.8z" fill="currentColor"/>'),
   pin:ic('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"'+L+'/><circle cx="12" cy="10" r="2.3"'+L+'/>')
};
function waI(){return byId('wa')?ic('<use href="#wa"/>'):'';}
function emblem(){return byId('emblem')?ic('<use href="#emblem"/>','0 0 240 240'):'';}

// 12 с на чтение (GET при обрыве — ещё раз через 1 с); запись — 30 с: сервер отвечает не дольше (срок ответа BUDGET в sitebook)
function req(method,path,body,again){
 return new Promise(function(ok,fail){
  var ac=W.AbortController?new AbortController():null,t=setTimeout(function(){if(ac)ac.abort();},method==='POST'?30000:12000);
  fetch(BASE+path,{method:method,mode:'cors',credentials:'omit',cache:'no-store',signal:ac?ac.signal:undefined,
   headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})
   .then(function(r){return r.json().then(function(j){return{s:r.status,j:j||{}};},function(){return{s:r.status,j:{ok:false,code:'server'}};});})
   .then(function(r){clearTimeout(t);ok(r);},function(e){
    clearTimeout(t);
    if(again)setTimeout(function(){req(method,path,body,false).then(ok,fail);},1000);else fail(e);
   });
 });
}
function get(path,qs){return req('GET',path+(qs?'?'+qs:''),null,true);}
function loadCat(force){
 if(catP&&!force)return catP;
 S.api='loading';
 catP=get('catalog').then(function(r){
  if(r.j.ok){setCat(r.j);S.api='ok';return true;}
  S.api=r.j.code==='off'?'off':'error';S.apiMsg=r.j.error||'';return false;
 },function(){S.api='error';return false;});
 return catP;
}
// каталог не загрузился (нет сети, сбой) — кнопки ведут в WhatsApp, а форма сама пробует снова: через 4 с, 15 с, минуту и при
// появлении сети; раньше запись оставалась выключенной до перезагрузки страницы (проверка формы 21.10.2026)
function catAgain(){
 if(S.api!=='error'||isOpen)return;
 loadCat(true).then(function(ok){if(ok)idle(prebuild);else catLater();});
}
function catLater(){if(S.api==='error'&&catTry<3)setTimeout(catAgain,[4000,15000,60000][catTry++]);}
function setCat(c){
 S.cat=c;S.mode=c.mode;S.sv={};S.st={};
 c.services.forEach(function(s){S.sv[s.key]=s;});
 c.staff.forEach(function(m){S.st[m.id]=m;});
 S.pk=c.groups.length&&c.groups[0].keys.length?c.groups[0].keys[0]:c.services.length?c.services[0].key:'';
 if(c.company)for(var k in c.company)if(c.company[k])CO[k]=c.company[k];
 fix();
}
function fix(){
 if(!S.cat)return;
 if(S.any||!S.st[S.staff])S.staff=null;
 S.keys=S.keys.filter(function(k){return S.sv[k]&&(S.staff==null||does(S.staff,k));});
 if(S.date&&S.date<S.cat.today){S.date=null;S.time=null;}
 if(S.keys.length>S.cat.maxServices)S.keys.length=S.cat.maxServices;
}
function does(id,k){var m=S.st[id];return!!m&&m.services.indexOf(k)>=0;}
function doer(keys){return S.cat.staff.filter(function(m){return keys.every(function(k){return m.services.indexOf(k)>=0;});});}
function staffName(id){return S.st[id]?S.st[id].name:'';}
function tot(id){
 var p=0,m=0,from=false;
 S.keys.forEach(function(k){
  var s=S.sv[k],b=id!=null&&s.by[id];
  if(b){p+=b.price;m+=b.min;from=from||b.max>b.price;}else{p+=s.price.from;m+=s.min;from=from||s.price.to>s.price.from;}
 });
 return{price:p,min:m,from:from};
}
function cost(){return S.slot?{price:S.slot.price,min:S.slot.min,from:false}:tot(S.any?null:S.staff);}
function save(){try{sessionStorage.setItem(SKEY,JSON.stringify({s:S.staff,a:S.any,k:S.keys,d:S.date,t:S.time}));}catch(e){}}
function restore(){try{var o=JSON.parse(sessionStorage.getItem(SKEY)||'null');if(o){S.staff=o.s;S.any=!!o.a;S.keys=o.k||[];S.date=o.d||null;S.time=o.t||null;}}catch(e){}}
function forget(){S.staff=null;S.any=false;S.keys=[];S.date=S.time=S.slot=null;S.done=null;S.step='master';try{sessionStorage.removeItem(SKEY);}catch(e){}}

function waText(){
 var p=[];
 if(S.cat){
  var m=S.any?(S.slot?staffName(S.slot.staff):'любой мастер'):staffName(S.staff);
  if(m)p.push(m);
  S.keys.forEach(function(k){p.push(S.sv[k].name);});
  if(S.date&&S.time){var d=ud(S.date);p.push(DW[d.getUTCDay()].toLowerCase()+' '+S.date.slice(8)+'.'+S.date.slice(5,7)+' в '+S.time);}
 }
 return p.length?'Здравствуйте! Хочу записаться: '+p.join(', '):'Здравствуйте! Хочу записаться в '+CO.name;
}
function waUrl(t){return'https://wa.me/'+CO.wa+'?text='+encodeURIComponent(t||waText());}
function waA(txt,cls){return'<a class="'+(cls||'')+'" data-wbk-wa href="'+esc(waUrl())+'" target="_blank" rel="noopener">'+txt+'</a>';}
function telA(txt,cls){return'<a class="'+(cls||'')+'" href="tel:'+esc(CO.tel)+'">'+txt+'</a>';}

function build(){
 root=D.createElement('div');
 root.className='wbk';
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','wbk-title');
 root.innerHTML='<div class="wbk-bg" data-wbk="close"></div><div class="wbk-p">'+
  '<div class="wbk-hd"><div class="wbk-hr"><button class="wbk-ib" data-wbk="back" aria-label="Назад">'+I.back+'</button>'+
  '<p class="label wbk-lb"></p><button class="wbk-ib" data-wbk="close" aria-label="Закрыть">'+I.x+'</button></div>'+
  '<div class="wbk-pg" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>'+
  '<div class="wbk-m"></div><aside class="wbk-sd" aria-label="Твоя запись"></aside>'+
  '<div class="wbk-br"><p class="wbk-bt"></p><button class="btn btn-brass" data-wbk="next">Дальше'+I.next+'</button></div>'+
  '<p class="wbk-sr" aria-live="polite"></p></div>';
 D.body.appendChild(root);
 panel=q('.wbk-p',root);main=q('.wbk-m',root);side=q('.wbk-sd',root);
 barT=q('.wbk-bt',root);nextB=q('[data-wbk=next]',root);lbl=q('.wbk-lb',root);
 prog=qa('.wbk-pg i');backB=q('[data-wbk=back]',root);live=q('.wbk-sr',root);
 root.addEventListener('click',onClick);
 root.addEventListener('change',onChange);
 root.addEventListener('input',onInput);
  root.addEventListener('submit',function(e){e.preventDefault();submit();});
 root.addEventListener('focusin',onFocusIn);
 root.addEventListener('focusout',onBlur);
}
function say(t){live.textContent='';setTimeout(function(){live.textContent=t;},30);}

function open(v,from,ev){
 if(isOpen)return;
 opener=from||D.activeElement;
 openPt=ev&&ev.detail?{x:ev.clientX,y:ev.clientY,t:Date.now()}:null; // открыли мышью или касанием: где и когда
 var h=D.documentElement,sb=W.innerWidth-h.clientWidth; // до записи в DOM — без лишней раскладки
 if(!root)build();
 isOpen=true;
 if(S.done)forget();
 var p=loadCat();
 var show=function(){
  if(sb>0)h.style.paddingRight=sb+'px';
  h.classList.add('wbk-lock');
  raf(function(){raf(function(){if(!isOpen)return;root.classList.add('wbk-o');var t=byId('wbk-title');if(t)t.focus({preventScroll:true});});});
  try{W.history.pushState({wbk:1},'');pushed=true;}catch(e){pushed=false;}
 };
 if(S.cat){
  S.pre=null;preset(v);
  // окно собрано заранее для того же выбора — только показываем; другой выбор (кнопка «Записаться на Premium») — шаг рисуется заново
  if(S.ready&&cur&&ga(cur,'data-step')===S.step&&S.sig===sig()){S.ready=false;hdr();bar();sideUpd();if(ON[S.step])ON[S.step]();if(!calm())cur.className+=' wbk-fd';}
  else go(S.step,0);
 }else{S.pre=v;go('master',0);}
 show();
 p.then(function(ok){
  if(!isOpen)return;
  if(ok&&S.pre!=null){preset(S.pre);S.pre=null;go(S.step,0,true);}else if(!ok)go(S.step,0,true);
 });
}
// data-book: m:<имя> — мастер, s:<ключ> — услуга
function preset(v){
 v=low(v);
 if(v.indexOf('m:')===0){
  var n=v.slice(2),m=S.cat.staff.filter(function(x){return low(x.name).indexOf(n)===0;})[0];
  if(m){if(S.any||S.staff!==m.id){S.slot=S.time=null;}S.any=false;S.staff=m.id;dropKeys();S.step='services';return;}
 }
 if(v.indexOf('s:')===0){
  var k=v.slice(2),key=S.sv[k]?k:(S.cat.services.filter(function(x){return x.key.indexOf(k)>=0;})[0]||{}).key;
  if(key){S.keys=[key];S.slot=S.time=null;if(S.staff!=null&&!does(S.staff,key))S.staff=null;S.step='master';return;}
 }
 if(v)S.step='master';
 if(STEPS.indexOf(S.step)<0||STEPS.indexOf(S.step)>STEPS.indexOf(need()))S.step=need();
}
function close(fromPop){
 if(!isOpen||held())return;
 isOpen=false;clearTimeout(advT);
 root.classList.remove('wbk-o');
 var h=D.documentElement;h.classList.remove('wbk-lock');h.style.paddingRight='';
 if(pushed&&!fromPop){skipPop=true;W.history.back();}else clearHash();
 pushed=false;
 if(S.done||S.step==='unknown')forget();
 var to=back2(opener);
 if(to)try{to.focus({preventScroll:true});}catch(e){to.focus();}
}
// куда вернуть фокус: кнопка, которой открыли; она скрыта (меню на телефоне закрылось) — кнопка этого меню (aria-controls)
function shown(el){return!!el&&D.body.contains(el)&&!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';}
function back2(el){
 if(!el||!el.focus)return null;
 if(shown(el))return el;
 for(var p=el.parentNode;p&&p!==D.body;p=p.parentNode)if(p.id){var c=D.querySelector('[aria-controls="'+p.id+'"]');if(shown(c))return c;}
 return null;
}
// идёт отправка: окно не закрывается и шаг не меняется — иначе ответ терялся, и клиент мог записаться второй раз (проверка 21.10.2026)
function held(){
 if(!S.busy)return false;
 var w=cur&&q('.wbk-alw');
 if(w&&!q('.wbk-wt',w))w.innerHTML='<p class="wbk-nt wbk-wt" role="status">'+esc(WAIT)+'</p>';else say(WAIT);
 return true;
}
function clearHash(){if(/^#book/.test(location.hash))try{W.history.replaceState(W.history.state,'',location.pathname+location.search);}catch(e){}}
function onPop(){
 if(skipPop){skipPop=false;clearHash();return;}
 if(!isOpen)return;
 if(S.busy){try{W.history.pushState({wbk:1},'');}catch(e){}held();return;}
 var i=STEPS.indexOf(S.step);
 if(i<=0){pushed=false;close(true);return;}
 back();
 try{W.history.pushState({wbk:1},'');}catch(e){}
}

function need(){if(!S.any&&S.staff==null)return'master';if(!S.keys.length)return'services';if(!S.slot)return'time';return'contacts';}
function next(){
 var i=STEPS.indexOf(S.step);
 if(i<0||STEPS.indexOf(need())<=i)return;
 go(S.ret?need():STEPS[i+1],1);
}
function back(){
 if(held())return;
 var i=STEPS.indexOf(S.step);
 if(i<=0)return;
 if(S.ret&&need()==='contacts')return go('contacts',-1);
 go(STEPS[i-1],-1);
}
// окно собрано заранее, в простое: нажатие только показывает его
function prebuild(){
 if(root||isOpen||!S.cat)return;
 build();preset('');
 root.setAttribute('data-s',S.step);hdr();bar();sideUpd();
 swap(VIEW[S.step](),0,false,0,0);
 S.ready=true;S.sig=sig();
}
function sig(){return JSON.stringify([S.step,S.staff,S.any,S.keys]);}
function go(step,dir,fade){
 S.ready=false;
 var prev=S.step,st=cur?main.scrollTop:0,y=cur?cur.offsetTop-st:0;
 clearTimeout(advT);
 S.step=step;
 if(step==='contacts')S.ret=false;
 if(step!=='time')S.msg='';
 root.setAttribute('data-s',step);
 hdr();bar();sideUpd();
 swap(VIEW[step](),dir==null?(STEPS.indexOf(step)>=STEPS.indexOf(prev)?1:-1):dir,fade,y,st);
 if(ON[step])ON[step]();
 // фокус — в следующем кадре, без лишней раскладки
 raf(function(){var t=byId('wbk-title');if(t&&isOpen&&root.classList.contains('wbk-o')&&root.contains(t))t.focus({preventScroll:true});});
 save();
}
function swap(html,dir,fade,y,st){
 var old=cur,el=D.createElement('div');
 el.className='wbk-st';el.setAttribute('data-step',S.step);el.innerHTML=html;
 if(old){
  var t=q('#wbk-title',old);if(t)t.removeAttribute('id');
  old.setAttribute('aria-hidden','true');old.inert=true;
  if(calm()||!dir)old.parentNode.removeChild(old);
  // уходящий шаг — только wbk-lv: классы появления (wbk-en, wbk-fd) перебивали его анимацию, и старый шаг въезжал поверх нового
  else{old.style.top=y+st+'px';old.className='wbk-st wbk-lv'+(dir<0?' wbk-bk':'');setTimeout(function(){if(old.parentNode)old.parentNode.removeChild(old);},240);}
 }
 main.appendChild(el);
 // наверх — в следующем кадре: без раскладки посреди обработчика
 if(st)raf(function(){main.scrollTop=0;if(old)old.style.top=y+'px';});
 if(!calm())el.className+=dir?' wbk-en'+(dir<0?' wbk-bk':''):fade?' wbk-fd':'';
 cur=el;
}
function hdr(){
 var i=STEPS.indexOf(S.step),n=i<0?(S.step==='done'?5:3):i+1; // «не получили подтверждения» — запись не завершена: 3 из 4
 // одним элементом: у .label сайта flex с отступом, и «·» отрывалась от «Шаг 1 из 4» лишним промежутком
 lbl.innerHTML='<span>'+(i<0?(S.step==='done'?'Готово':'Онлайн-запись'):'Шаг '+n+' из 4<span class="wbk-ln"> · '+TIT[S.step]+'</span>')+'</span>';
 backB.classList.toggle('wbk-no',i<=0);
 prog.forEach(function(p,k){p.classList.toggle('on',k<n);});
}
function bar(){
 var a='',b='',ok=false,x;
 if(S.step==='master'){ok=S.any||S.staff!=null;a=ok?'Мастер':'';b=S.any?'Любой мастер':ok?staffName(S.staff):'Выбери мастера';}
 else if(S.step==='services'){
  ok=S.keys.length>0;x=tot(S.any?null:S.staff);
  a=ok?plur(S.keys.length,'услуга','услуги','услуг')+' · '+dur(x.min):'';b=ok?(x.from?'от ':'')+money(x.price):'Выбери услуги';
 }else if(S.step==='time'){
  ok=!!S.slot;a=ok?dLong(S.date)+(S.any||S.slot.staff!==S.staff?' · '+staffName(S.slot.staff):''):'';
  b=ok?S.time+'–'+S.slot.end:'Выбери время';
 }
 barT.innerHTML='<small>'+esc(a)+'</small><b'+(ok?'':' class="wbk-q"')+'>'+esc(b)+'</b>';
 nextB.disabled=!ok;
 root.classList.toggle('wbk-nb',S.step==='master'&&!ok);
}
function sideUpd(){side.innerHTML='<p class="label">Твоя запись</p>'+sum(S.step==='contacts')+'<span class="wbk-wm" aria-hidden="true">'+emblem()+'</span>';}
function sum(edit){
 if(!S.cat)return'';
 var ed=function(s){return edit?'<button class="tlink wbk-ed" data-go="'+s+'">Изменить</button>':'';};
 var id=S.slot?S.slot.staff:S.any?null:S.staff,m=S.st[id],x=cost();
 var no='<span class="wbk-q">—</span>',who=S.any?(m?esc(m.name)+' <small>— назначили на это время</small>':'Любой мастер'):m?esc(m.name)+' <small>'+esc(m.role||'')+'</small>':no;
 var list=S.keys.length?'<ul>'+S.keys.map(function(k){
  var s=S.sv[k],b=id!=null&&s.by[id];
  return'<li><span>'+esc(s.name)+'</span><b>'+(b?money(b.price):(s.price.to>s.price.from?'от ':'')+money(s.price.from))+'</b></li>';
 }).join('')+'</ul>':no;
 var when=S.slot&&S.date?dLong(S.date)+', '+S.time+'–'+S.slot.end:no;
 return'<dl class="wbk-dl"><div><dt>Мастер</dt><dd>'+who+'</dd>'+ed('master')+'</div><div><dt>Услуги</dt><dd>'+list+'</dd>'+ed('services')+
  '</div><div><dt>Когда</dt><dd>'+when+'</dd>'+ed('time')+'</div></dl>'+
  '<p class="wbk-to"><span>Итого'+(x.min?' · '+dur(x.min):'')+'</span><b>'+(S.keys.length?(x.from?'от ':'')+money(x.price):'—')+'</b></p>';
}
function head(t,sub){return'<h2 class="wbk-h" id="wbk-title" tabindex="-1">'+t+'</h2>'+(sub?'<p class="wbk-sub">'+sub+'</p>':'');}
function waLine(){return'<p class="wbk-wa">Удобнее в WhatsApp? '+waA('Напиши нам')+'</p>';}
function alertBox(msg,retry){
 return'<div class="wbk-al" role="alert"><p>'+esc(msg)+'</p><div class="wbk-ac">'+
  (retry?'<button class="btn btn-line" data-wbk="retry">Повторить</button>':telA('Позвонить','btn btn-line'))+
  waA(waI()+'Написать в WhatsApp','btn btn-line')+'</div></div>';
}
function skel(n,cls){var s='';for(var i=0;i<n;i++)s+='<span class="wbk-sk '+cls+'"></span>';return s;}
function loadFail(){
 if(S.api==='off')return alertBox(S.apiMsg||'Онлайн-запись сейчас недоступна. Напиши нам в WhatsApp или позвони: '+CO.phone+'.');
 S.retry=function(){var p=loadCat(true);go(S.step,0);p.then(function(ok){if(isOpen){if(ok&&S.pre!=null){preset(S.pre);S.pre=null;}go(S.step,0,true);}});};
 return alertBox(NET,1);
}

var VIEW={},ON={};
VIEW.master=function(){
 var h=head('Выбери мастера','Или доверься нам — покажем всё свободное время');
 if(!S.cat)return h+(S.api==='loading'||S.api==='idle'?'<div class="wbk-ms">'+skel(6,'wbk-skr')+'</div>':loadFail());
 var keys=S.keys.length?S.keys:S.pk?[S.pk]:[],one=keys.length===1?S.sv[keys[0]].name:plur(keys.length,'услуга','услуги','услуг');
 var rows=mRow(0,'<span class="wbk-av wbk-ay">'+emblem()+'</span>','Любой мастер','',
  '<span class="wbk-ds">Покажем всё свободное время, мастера назначим сами</span>'+(keys.length?'<b>'+esc(one)+' от '+money(S.keys.length?tot(null).price:S.sv[S.pk].price.from)+'</b>':''));
 S.cat.staff.forEach(function(m){
  var x,ok=keys.every(function(k){return does(m.id,k);}),missing=S.keys.filter(function(k){return!does(m.id,k);});
  if(S.keys.length)x=tot(m.id);
  var price=!keys.length?'':S.keys.length?(ok?'<b>'+esc(one)+' '+money(x.price)+'</b>':'<span>Не делает: '+esc(missing.map(function(k){return S.sv[k].name;}).join(', '))+'</span>')
   :ok&&S.sv[S.pk].by[m.id]?'<b>'+esc(one)+' '+money(S.sv[S.pk].by[m.id].price)+'</b>':'';
  var rate=m.rating?'<span>'+I.star+(Math.round(m.rating*10)/10).toFixed(1)+(m.reviews?' · '+plur(m.reviews,'отзыв','отзыва','отзывов'):'')+'</span>':'';
  var ph=photo(m.name);
  rows+=mRow(m.id,'<span class="ph wbk-av'+(ph?' has" style="background-image:'+esc(ph):'')+'"><b>'+esc(m.name.charAt(0))+'</b></span>',m.name,m.role||'',rate+price);
 });
 return h+'<div class="wbk-ms wbk-sg">'+rows+'</div>'+waLine();
};
function mRow(id,av,name,role,meta){
 var on=id===0?S.any:!S.any&&S.staff===id;
 return'<button class="wbk-mr" data-staff="'+id+'" aria-pressed="'+on+'">'+av+
  '<span class="wbk-mi"><span class="wbk-mn">'+esc(name)+'</span><span class="wbk-mo">'+esc(role)+'</span>'+
  (meta?'<span class="wbk-mx">'+meta+'</span>':'')+'<span class="wbk-nr" data-near="'+id+'">'+nearHTML(id)+'</span></span><span class="wbk-rd"></span></button>';
}
// фото мастера — с самой страницы (.ph «Тони, …»)
function photo(name){
 var all=D.querySelectorAll('.ph.has[aria-label]');
 for(var i=0;i<all.length;i++)if(ga(all[i],'aria-label').indexOf(name+',')===0&&all[i].style.backgroundImage)return all[i].style.backgroundImage;
 return'';
}
function nearHTML(id){
 if(S.near==='err')return'';
 if(!S.near)return'<span class="wbk-sk wbk-skn"></span>';
 var n=id?S.near[id]:null;
 if(!id)S.cat.staff.forEach(function(m){var v=S.near[m.id];if(v&&v.times.length&&(!n||v.date<n.date))n={date:v.date,times:v.times.slice()};else if(v&&n&&v.date===n.date)n.times=n.times.concat(v.times);});
 if(!n||!n.times.length)return'<small>Нет свободного времени в ближайшие дни</small>';
 var t=n.times.filter(function(x,i,a){return a.indexOf(x)===i;}).sort().slice(0,3);
 return'<span>Ближайшее · '+dRel(n.date)+'</span>'+t.map(function(x){return'<i>'+x+'</i>';}).join('');
}
ON.master=function(){
 if(!S.cat||Date.now()-S.nearAt<120000)return;
 S.nearAt=Date.now();
 get('nearest').then(function(r){S.near=r.j.ok?r.j.staff||{}:'err';nearUpd();},function(){S.near='err';nearUpd();});
};
function nearUpd(){if(root)qa('[data-near]').forEach(function(el){el.innerHTML=nearHTML(+ga(el,'data-near'));});}

VIEW.services=function(){
 if(!S.cat)return head('Выбери услуги')+loadFail();
 var m=S.any?null:S.st[S.staff],all=S.cat.staff.length,n=0;
 var sub=m?'Цены — у мастера '+esc(m.name):'Цена зависит от мастера: шеф-барбер или барбер';
 var rows0=0,html=S.cat.groups.map(function(g){
  var rows=g.keys.filter(function(k){return S.sv[k]&&(!m||does(m.id,k));}).map(function(k){
   var s=S.sv[k],b=m&&s.by[m.id],on=S.keys.indexOf(k)>=0,cnt=doer([k]).length;
   var p=b?(b.max>b.price?'<small>от</small>':'')+money(b.price):(s.price.to>s.price.from?'<small>от</small>':'')+money(s.price.from);
   var info=[dur(b?b.min:s.min)];
   if(s.desc)info.push(esc(s.desc));
   if(!m&&cnt<all)info.push('есть не у всех мастеров');
   return'<label class="wbk-sv" data-key="'+esc(k)+'"><input type="checkbox" name="svc" value="'+esc(k)+'"'+(on?' checked':'')+'>'+
    '<span class="wbk-cb">'+I.ok+'</span><span class="wbk-sn"><b>'+esc(s.name)+'</b><small>'+info.join(' · ')+'</small></span>'+
    '<span class="wbk-dt"></span><span class="wbk-sp">'+p+'</span></label>';
  }).join('');
  var gh=rows?'<div class="wbk-gr"><h3 class="wbk-gh"><i>'+(ROM[n++]||n)+'</i>'+esc(g.title)+'</h3><div class="wbk-sg">'+rows+'</div></div>':'';
  var later=rows0>4;rows0+=rows.split('<label').length-1;return later&&rows?'<!--later-->'+gh:gh;
 }).join('').split('<!--later-->');
 S.later=html.slice(1);html=html[0]+'<div class="wbk-lt"></div>';
 var note=S.note;S.note='';
 return head('Выбери услуги',sub)+'<div class="wbk-ntw">'+(note?'<p class="wbk-nt" role="status">'+esc(note)+'</p>':'')+'</div>'+html+waLine();
};
function dropKeys(){
 if(S.any||S.staff==null)return;
 var out=[],m=S.st[S.staff];
 S.keys=S.keys.filter(function(k){var ok=does(m.id,k);if(!ok)out.push('«'+S.sv[k].name+'»');return ok;});
 if(out.length)S.note=out.join(', ')+' — '+m.name+(out.length>1?' эти услуги':' эту услугу')+' не делает, убрали из списка.';
}
function notice(t){
 var w=cur&&q('.wbk-ntw');
 if(w)w.innerHTML='<p class="wbk-nt" role="status">'+esc(t)+'</p>';else say(t);
}

VIEW.time=function(){
 if(!S.cat)return head('Выбери день и время')+loadFail();
 return head('Выбери день и время','Только время, когда мастер свободен на всю длительность услуг')+
  '<div class="wbk-dh"><p class="label">Дата</p><span class="wbk-ar"><button class="wbk-ib" data-wbk="prev" aria-label="Раньше">'+I.back+'</button>'+
  '<button class="wbk-ib" data-wbk="later" aria-label="Позже">'+I.next+'</button></span></div>'+
  '<div class="wbk-dy" role="group" aria-label="День">'+daysHTML()+'</div>'+
  '<div class="wbk-ntw">'+(S.msg?'<p class="wbk-nt e" role="alert">'+esc(S.msg)+'</p>':'')+'</div>'+
  '<div class="wbk-tw">'+(S.tr&&S.tr.taken?timesHTML():tSkel())+'</div>'+waLine();
};
function tSkel(){return'<div class="wbk-tg"><span class="wbk-sk wbk-skl"></span><div class="wbk-ts">'+skel(8,'wbk-skt')+'</div></div>';}
function daysHTML(){
 var c=S.cat,open=S.daysKey===tq('')?S.days:null,out='',sel=S.date,foc=sel&&(!open||open.indexOf(sel)>=0)?sel:null;
 for(var i=0;i<c.days;i++){
  var d=addD(c.today,i),u=ud(d),ok=!open||open.indexOf(d)>=0,on=d===sel;
  if(!foc&&ok)foc=d;
  var tag=i===0?'Сегодня':i===1?'Завтра':DW[u.getUTCDay()];
  out+='<button class="wbk-d'+(i===0?' td':'')+'" data-date="'+d+'" aria-pressed="'+on+'"'+(ok?'':' disabled')+
   ' tabindex="'+(d===foc?0:-1)+'" aria-label="'+DAY[u.getUTCDay()]+', '+u.getUTCDate()+' '+MON[u.getUTCMonth()]+(ok?'':' — нет записи')+'">'+
   '<small>'+tag+'</small><b>'+u.getUTCDate()+'</b><span>'+MO[u.getUTCMonth()]+'</span></button>';
 }
 return out;
}
function stripUpd(full){
 var dy=cur&&q('.wbk-dy');
 if(!dy)return;
 var a=D.activeElement,f=a&&a.getAttribute&&ga(a,'data-date');
 if(full){dy.innerHTML=daysHTML();a=f&&q('[data-date="'+f+'"]',dy);if(a)a.focus();}
 else qa('.wbk-d',dy).forEach(function(b){var on=ga(b,'data-date')===S.date;b.setAttribute('aria-pressed',String(on));b.tabIndex=on?0:-1;});
 raf(function(){
  var b=q('[aria-pressed=true]',dy);
  if(!b)return;
  var l=b.offsetLeft,w=dy.clientWidth,x=l-(w-b.offsetWidth)/2;
  if(l<dy.scrollLeft||l+b.offsetWidth>dy.scrollLeft+w)dy.scrollTo({left:x,behavior:calm()?'auto':'smooth'});
 });
}
function timesHTML(){
 var r=S.tr,sl=r.slots,u=ud(r.date),day=DAY[u.getUTCDay()],h='<p class="wbk-td">'+day.charAt(0).toUpperCase()+day.slice(1)+', '+u.getUTCDate()+' '+MON[u.getUTCMonth()]+'</p>';
 if(!sl.length)return h+'<div class="wbk-em0"><p>На этот день свободного времени нет.</p>'+
  (r.next?'<button class="btn btn-line" data-date="'+r.next+'">Ближайший день: '+dLong(r.next).replace(/^../,function(x){return x.toLowerCase();})+'</button>':'')+'</div>';
 var named=S.any||sl.some(function(x){return x.staff!==S.staff;});
 return h+[['Утро',0,720],['День',720,1080],['Вечер',1080,1440]].map(function(g){
  var b=sl.filter(function(x){var m=mins(x.time);return m>=g[1]&&m<g[2];}).map(function(x){
   return'<button class="wbk-t" data-time="'+x.time+'" aria-pressed="'+(x.time===S.time&&!!S.slot)+'"'+
    (named?' aria-label="'+x.time+', мастер '+esc(staffName(x.staff))+'"':'')+'>'+x.time+(named?'<small>'+esc(staffName(x.staff))+'</small>':'')+'</button>';
  }).join('');
  return b?'<div class="wbk-tg"><p class="label">'+g[0]+'</p><div class="wbk-ts wbk-sg">'+b+'</div></div>':'';
 }).join('');
}
function tq(date){return'staff='+(S.any?0:S.staff)+'&services='+encodeURIComponent(S.keys.join(','))+(date?'&date='+date:'');}
// первая группа — сразу, остальные — по одной за кадр: на слабом телефоне шаг рисовался одной задачей до 120 мс (проверка 21.10.2026)
ON.services=function(){
 var h=S.later||[],el=cur;S.later=[];
 (function put(i){if(i<h.length)setTimeout(function(){raf(function(){var w=cur===el&&q('.wbk-lt');if(w){w.insertAdjacentHTML('beforebegin',h[i]);put(i+1);}});},0);})(0);
};
ON.time=function(){
 var dk=tq(''),keep=S.tr&&S.tr.taken;
 if(S.daysKey!==dk){S.days=null;S.daysKey=dk;get('dates',dk).then(function(r){if(S.daysKey===dk&&r.j.ok){S.days=r.j.dates;if(S.step==='time')stripUpd(true);}},function(){});}
 if(keep){S.tr.taken=false;loadTimes(S.date,true);return;}
 S.tr=null;
 loadTimes(S.date&&S.date>=S.cat.today?S.date:null);
};
function loadTimes(date,fresh){
 var qs=tq(date),tok=++S.tq,c=S.tc[qs],tw=cur&&q('.wbk-tw');
 var done=function(j){
  if(tok!==S.tq||S.step!=='time')return;
  S.tr=j;S.date=j.date;
  if(S.slot&&!j.slots.some(function(x){return x.time===S.time&&x.staff===S.slot.staff;}))S.slot=null;
  if(!S.slot&&S.time){S.slot=j.slots.filter(function(x){return x.time===S.time;})[0]||null;if(!S.slot)S.time=null;}
  tw=q('.wbk-tw');tw.innerHTML=timesHTML();fadeIn(tw);
  stripUpd();bar();sideUpd();save();
 };
 if(!fresh&&c&&Date.now()-c.at<60000)return done(c.j);
 if(tw&&!(fresh&&S.tr))tw.innerHTML=tSkel();
 get('times',qs).then(function(r){
  if(tok!==S.tq||S.step!=='time')return;
  if(r.j.ok){S.tc[qs]={at:Date.now(),j:r.j};return done(r.j);}
  if(r.j.code==='bad_request'&&(r.j.field==='services'||r.j.field==='staff')){S.note=r.j.error;return go(r.j.field==='staff'?'master':'services',-1);}
  S.retry=function(){loadTimes(date,true);};
  q('.wbk-tw').innerHTML=alertBox(r.j.error||NET,1);
 },function(){
  if(tok!==S.tq||S.step!=='time')return;
  S.retry=function(){loadTimes(date,true);};
  q('.wbk-tw').innerHTML=alertBox(NET,1);
 });
}
function fadeIn(el){if(calm())return;el.classList.remove('wbk-fd');raf(function(){el.classList.add('wbk-fd');});}

VIEW.contacts=function(){
 var dry=S.mode==='dry',btn=dry?'Отправить заявку':'Записаться';
 var f=function(n,label,input,opt){
  return'<div class="wbk-fi"><label class="label" for="wbk-'+n+'">'+label+(opt?'<small>необязательно</small>':'')+'</label>'+input+
   '<p class="wbk-er" id="wbk-'+n+'-e" aria-live="polite"></p></div>';
 };
 return head('Проверь запись')+'<div class="wbk-rv">'+sum(true)+'</div>'+
  '<form class="wbk-fm" novalidate>'+
  f('name','Имя','<input class="wbk-in" id="wbk-name" name="name" autocomplete="name" maxlength="60" required aria-describedby="wbk-name-e" enterkeyhint="next" value="'+esc(S.name)+'">')+
  f('phone','Телефон','<input class="wbk-in" id="wbk-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required aria-describedby="wbk-phone-e" placeholder="+7 7XX XXX XX XX" value="'+(S.phN?fmtPh(S.phN):'')+'">')+
  f('comment','Комментарий для мастера','<textarea class="wbk-in" id="wbk-comment" name="comment" maxlength="150" rows="3" aria-describedby="wbk-comment-e">'+esc(S.comment)+'</textarea><span class="wbk-cn" aria-live="polite"></span>',1)+
  '<div class="wbk-hp" aria-hidden="true"><label>Сайт <input name="website" tabindex="-1" autocomplete="off"></label></div>'+
  '<div class="wbk-alw"></div>'+
  (dry?'<p class="wbk-dry">Онлайн-запись работает в режиме проверки: время свободно, а запись в журнал мастера внесёт администратор и подтвердит её звонком или в WhatsApp.</p>':'')+
  '<button type="submit" class="btn btn-brass wbk-sb" data-wbk="submit">'+btn+'</button>'+
  '<p class="wbk-cs">Нажимая «'+btn+'», ты соглашаешься с <a href="'+esc(PRIV)+'" target="_blank" rel="noopener">политикой конфиденциальности</a></p></form>'+waLine();
};

// маска «+7 7XX XXX XX XX»: принимает «8…», «7…» и вставку
function natl(v){
 var d=String(v).replace(/\D/g,'');
 if(/^\s*\+/.test(v)||d.length>10){if(d.charAt(0)==='7')d=d.slice(1);}
 if(d.charAt(0)==='8'||(d.length>10&&d.charAt(0)==='7'))d=d.slice(1);
 return d.slice(0,10);
}
function fmtPh(n){return'+7 '+n.slice(0,3)+(n.length>3?' '+n.slice(3,6):'')+(n.length>6?' '+n.slice(6,8):'')+(n.length>8?' '+n.slice(8,10):'');}
function phoneIn(el,e){
 var v=el.value,c=el.selectionStart==null?v.length:el.selectionStart,n=natl(v),k=c>=v.length?n.length:natl(v.slice(0,c)).length;
 var del=e&&/^delete/.test(e.inputType||'');
 if(e&&e.inputType==='deleteContentBackward'&&n===S.phN&&k>0){n=n.slice(0,k-1)+n.slice(k);k--;} // стёрли пробел — и цифру перед ним
 S.phN=n;
 if(!n&&del){el.value='';return;}
 var f=fmtPh(n),pos=f.length;
 if(k<n.length){pos=3;for(var i=3,seen=0;i<f.length&&seen<k;i++)if(/\d/.test(f.charAt(i))){seen++;pos=i+1;}}
 el.value=f;
 if(D.activeElement===el)try{el.setSelectionRange(pos,pos);}catch(x){}
}
function phoneOk(n){return/^7(0[0-8]|47|71|7[5-8])\d{7}$/.test(n);}
function cleanName(v){return String(v).replace(/\s+/g,' ').trim();}
function ferr(n,msg){
 var i=byId('wbk-'+n),e=byId('wbk-'+n+'-e');
 if(!i)return;
 i.setAttribute('aria-invalid',msg?'true':'false');e.textContent=String(msg||'').replace(/\+7 7XX XXX XX XX/g,'+7\u00a07XX\u00a0XXX\u00a0XX\u00a0XX'); // маска — одной строкой
}
var FIELD={name:'Проверь имя: только буквы, от 2 до 60 знаков.',name0:'Напиши имя.',phone:'Нужен номер мобильного Казахстана: +7 7XX XXX XX XX.',comment:'Комментарий — не длиннее 150 знаков.'};

function rid(){var s='',c=W.crypto;for(var i=0;i<4;i++)s+=('00000'+(c?c.getRandomValues(new Uint32Array(1))[0]:Math.floor(Math.random()*4294967296)).toString(36)).slice(-6);return s;}
function submit(){
 if(S.busy||S.step!=='contacts')return;
 var fm=q('form'),name=cleanName(fm.elements.name.value),bad=null;
 S.name=name;S.comment=fm.elements.comment.value.replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 ferr('name',!name?FIELD.name0:name.length>=2&&name.length<=60&&NAME.test(name)?'':FIELD.name);
 ferr('phone',phoneOk(S.phN)?'':FIELD.phone);
 ferr('comment',S.comment.length<=150?'':FIELD.comment);
 bad=['name','phone','comment'].filter(function(n){return ga(byId('wbk-'+n),'aria-invalid')==='true';})[0];
 if(bad)return byId('wbk-'+bad).focus();
 if(need()!=='contacts')return go(need(),-1);
 S.tries={fast:0,old:0,prog:0,net:0};
 send({staff:S.any?S.slot.staff:S.staff,any:S.any,services:S.keys.slice(),date:S.date,time:S.time,name:name,phone:'+7'+S.phN,
  comment:S.comment,website:fm.elements.website.value,ft:S.cat.ft,rid:rid()});
}
// кнопка не disabled, а aria-disabled: фокус остаётся на ней (иначе уходил на body — Esc и программа экранного доступа теряли место)
function busy(on){
 S.busy=on;
 clearTimeout(slowT);
 if(on)slowT=setTimeout(function(){var w=S.busy&&cur&&q('.wbk-alw');if(w)w.innerHTML='<p class="wbk-nt wbk-wt" role="status">'+esc(SLOW)+'</p>';},8000);
 backB.setAttribute('aria-disabled',String(on));
 var b=cur&&q('.wbk-sb'),dry=S.mode==='dry';
 if(!b)return;
 b.setAttribute('aria-disabled',String(on));b.classList.toggle('wbk-ld',on);
 b.innerHTML=on?'<span class="wbk-spin" aria-hidden="true"></span>'+(dry?'Отправляем…':'Записываем…'):dry?'Отправить заявку':'Записаться';
}
function send(body){
 busy(true);
 var aw=q('.wbk-alw');if(aw)aw.innerHTML='';
 req('POST','book',body,false).then(function(r){answer(r,body);},function(){
  // с тем же rid сервер не запишет дважды
  if(S.tries.net++<1)return setTimeout(function(){send(body);},1500);
  fail('Не получилось отправить заявку. Проверь интернет и попробуй ещё раз.');
 });
}
function fail(msg){busy(false);var aw=cur&&q('.wbk-alw');if(aw){aw.innerHTML=alertBox(msg);}say(msg);}
function answer(r,body){
 var j=r.j,c=j.code;
 if(j.ok){busy(false);S.done=j.booking;S.mode=j.mode||S.mode;S.nearAt=0;S.tc={};try{sessionStorage.removeItem(SKEY);}catch(e){}return go('done',1);}
 if(S.step!=='contacts'){busy(false);return;}
 if(c==='too_fast'&&S.tries.fast++<1)return setTimeout(function(){send(body);},Math.min(5,Math.max(1,+j.retry||2))*1000);
 if(c==='expired'&&S.tries.old++<1)return loadCat(true).then(function(ok){if(!ok)return fail(j.error);body.ft=S.cat.ft;send(body);});
 if(c==='in_progress'&&S.tries.prog++<5)return setTimeout(function(){send(body);},2000);
 busy(false);
 // сервер всё ещё записывает — второй заявки не предлагаем: запись могла создаться
 if(c==='in_progress'){S.err=LOST;S.errT='unknown';return go('unknown',1);}
 if(c==='taken'){
  S.msg=j.error;S.slot=null;S.time=null;S.tc={};
  S.tr={date:S.date,next:null,slots:j.slots||[],taken:true};
  return go('time',-1);
 }
 if(c==='service')return loadCat(true).then(function(){fix();S.note=j.error;go('services',-1);});
 if(c==='bad_request'&&FIELD[j.field]){ferr(j.field,j.error);var i=byId('wbk-'+j.field);if(i)i.focus();return;}
 if(c==='bad_request'&&(j.field==='services'||j.field==='staff')){S.note=j.error;return go(j.field==='staff'?'master':'services',-1);}
 if(c==='bad_request'&&(j.field==='date'||j.field==='time')){S.msg=j.error;S.slot=null;S.tc={};return go('time',-1);}
 if(c==='unknown'||c==='refused'){S.err=j.error;S.errT=c;return go('unknown',1);}
 fail(j.error||'Что-то пошло не так. Попробуй ещё раз или напиши нам в WhatsApp.');
}

VIEW.done=function(){
 var b=S.done,dry=S.mode==='dry',names=b.services.map(function(s){return esc(s.name)+' · '+money(s.price);}).join('<br>');
 return'<div class="wbk-dn"><span class="wbk-em">'+emblem()+'</span>'+
  '<h2 class="wbk-h wbk-xl" id="wbk-title" tabindex="-1">'+(dry?'Заявка <em>принята</em>':'Ждём тебя в <em class="rye">Winchester</em>')+'</h2>'+
  (dry?'<p class="wbk-sub">Это проверка онлайн-записи: время свободно, но в журнал мастера запись пока не внесена. Администратор получил заявку и подтвердит её звонком или в WhatsApp.</p>':'')+
  '<dl class="wbk-fl"><div><dt>Мастер</dt><dd>'+esc(b.staff.name)+(b.any?' <small>— назначили на это время</small>':b.staff.role?' <small>'+esc(b.staff.role)+'</small>':'')+'</dd></div>'+
  '<div><dt>Когда</dt><dd>'+dLong(b.date)+', '+b.time+'–'+b.end+'</dd></div><div><dt>Услуги</dt><dd>'+names+'</dd></div>'+
  '<div><dt>Итого</dt><dd>'+money(b.total)+' · '+dur(b.min)+'</dd></div><div><dt>Адрес</dt><dd>'+esc(CO.address)+'</dd></div></dl>'+
  '<div class="wbk-ac">'+(dry?'':'<button class="btn btn-brass" data-wbk="ics">'+I.cal+'Добавить в календарь</button>')+
  '<a class="btn btn-line" href="'+esc(MAP)+'" target="_blank" rel="noopener">'+I.pin+'Как добраться</a>'+
  '<button class="btn '+(dry?'btn-brass':'btn-line')+'" data-wbk="close">Готово</button></div>'+
  '<p class="wbk-ft">Перенести или отменить — '+waA('напиши в WhatsApp')+' или позвони '+telA(esc(CO.phone))+'</p></div>';
};
VIEW.unknown=function(){
 return head(S.errT==='refused'?'Заявка у администратора':'Не получили подтверждения',esc(S.err))+'<div class="wbk-ac">'+telA('Позвонить '+esc(CO.phone),'btn btn-brass')+
  waA(waI()+'Написать в WhatsApp','btn btn-line')+'<button class="btn btn-line" data-wbk="close">Закрыть</button></div>';
};

// .ics: время в UTC (Астана +5), строки до 75 байт
function ics(){
 var b=S.done,z=function(t,add){return new Date(Date.UTC(+b.date.slice(0,4),+b.date.slice(5,7)-1,+b.date.slice(8,10),0,mins(t)+(add||0)-300)).toISOString().replace(/[-:]/g,'').slice(0,15)+'Z';};
 var e=function(s){return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');};
 var fold=function(l){var o='',n=0;for(var i=0;i<l.length;i++){var c=l.charCodeAt(i),w=c<128?1:c<2048?2:3;if(n+w>74){o+='\r\n ';n=1;}o+=l.charAt(i);n+=w;}return o;};
 var txt=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Winchester//Online booking//RU','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
  'UID:'+(b.id||b.date+b.time.replace(':',''))+'@winchester.kz','DTSTAMP:'+new Date().toISOString().replace(/[-:]|\.\d+/g,'').slice(0,15)+'Z',
  'DTSTART:'+z(b.time),'DTEND:'+z(b.time,b.min),'SUMMARY:'+e('Winchester: '+b.services.map(function(s){return s.name;}).join(', ')),
  'LOCATION:'+e(CO.address),'DESCRIPTION:'+e('Мастер: '+b.staff.name+'. Перенести или отменить: '+CO.phone),'END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
 var url=URL.createObjectURL(new Blob([txt],{type:'text/calendar;charset=utf-8'})),a=D.createElement('a');
 a.href=url;a.download='winchester-'+b.date+'.ics';a.hidden=true;root.appendChild(a);a.click();
 setTimeout(function(){URL.revokeObjectURL(url);a.parentNode.removeChild(a);},1500);
}

function onClick(e){
 // второе касание двойного нажатия на кнопку записи (то же место, до 350 мс) попадало в выезжающее окно (выбирало мастера)
 // или в подложку (закрывало окно) — его пропускаем; быстрый щелчок в другом месте окна работает
 var o=openPt;
 if(o&&e.detail&&Date.now()-o.t<350&&Math.abs(e.clientX-o.x)<40&&Math.abs(e.clientY-o.y)<40){e.preventDefault();e.stopPropagation();return;}
 var a=closest(e.target,'[data-wbk],[data-wbk-wa],[data-staff],[data-date],[data-time],[data-go]');
 if(!a||!root.contains(a))return;
 if(a.hasAttribute('data-wbk-wa')){a.href=waUrl();return;}
 var w=ga(a,'data-wbk');
 if(w==='submit')return;
 if(S.busy&&w!=='ics'){e.preventDefault();held();return;}
 if(w==='close')return close();
 if(w==='back')return back();
 if(w==='next')return next();
 if(w==='retry')return S.retry&&S.retry();
 if(w==='ics')return ics();
 if(w==='prev'||w==='later'){var dy=q('.wbk-dy');dy.scrollBy({left:(w==='prev'?-.8:.8)*dy.clientWidth,behavior:calm()?'auto':'smooth'});return;}
 if(a.hasAttribute('data-staff'))return pickStaff(+ga(a,'data-staff'));
 if(a.hasAttribute('data-date'))return pickDate(ga(a,'data-date'));
 if(a.hasAttribute('data-time'))return pickTime(ga(a,'data-time'));
 if(a.hasAttribute('data-go')){S.ret=true;go(ga(a,'data-go'),-1);}
}
function pickStaff(id){
 if(!S.cat)return;
 var any=id===0;
 if(any!==S.any||(!any&&id!==S.staff)){S.slot=null;S.time=null;S.tr=null;}
 S.any=any;S.staff=any?null:id;
 dropKeys();
 qa('.wbk-mr',cur).forEach(function(b){b.setAttribute('aria-pressed',String(+ga(b,'data-staff')===id));});
 bar();sideUpd();save();
 clearTimeout(advT);
 advT=setTimeout(function(){if(isOpen&&S.step==='master')next();},150);
}
function pickDate(d){
 if(d===S.date&&S.tr&&S.tr.date===d)return;
 S.date=d;S.slot=null;S.time=null;S.msg='';
 var w=q('.wbk-ntw');if(w)w.innerHTML='';
 stripUpd();
 bar();sideUpd();
 loadTimes(d);
}
function pickTime(t){
 var sl=S.tr&&S.tr.slots.filter(function(x){return x.time===t;})[0];
 if(!sl)return;
 S.time=t;S.slot=sl;S.msg='';
 var w=q('.wbk-ntw');if(w)w.innerHTML='';
 qa('.wbk-t',cur).forEach(function(b){b.setAttribute('aria-pressed',String(ga(b,'data-time')===t));});
 bar();sideUpd();save();
 say(dLong(S.date)+', '+t+'–'+sl.end+(S.any?', мастер '+staffName(sl.staff):''));
}
function onChange(e){
 var t=e.target;
 if(t.name!=='svc')return;
 var k=t.value,i=S.keys.indexOf(k),max=S.cat.maxServices||5;
 if(t.checked&&i<0){
  if(S.keys.length>=max){t.checked=false;return notice('Не больше '+max+' услуг за один визит.');}
  S.keys.push(k);
 }else if(!t.checked&&i>=0)S.keys.splice(i,1);
 S.slot=null;S.time=null;S.tr=null;
 bar();sideUpd();save();
}
function onInput(e){
 var t=e.target;
 if(t.id==='wbk-phone'){phoneIn(t,e);if(ga(t,'aria-invalid')==='true'&&phoneOk(S.phN))ferr('phone','');}
 else if(t.id==='wbk-name'){S.name=t.value;if(ga(t,'aria-invalid')==='true')ferr('name','');}
 else if(t.id==='wbk-comment'){S.comment=t.value;var n=t.value.length,c=q('.wbk-cn');c.textContent=n>=120?n+' / 150':'';}
}
function onFocusIn(e){var t=e.target;if(t.id==='wbk-phone'&&!t.value){t.value='+7 ';try{t.setSelectionRange(3,3);}catch(x){}}}
function onBlur(e){var t=e.target;if(t.id==='wbk-phone'&&!S.phN)t.value='';}
function onKey(e){
 if(e.key==='Escape'||e.key==='Esc'){e.preventDefault();return close();}
 if(e.key==='Tab'){
  var f=qa('a[href],button:not([disabled]),input:not([tabindex="-1"]),textarea,[tabindex="0"]',panel).filter(function(el){
   return el.tabIndex>=0&&!closest(el,'.wbk-lv,[hidden],.wbk-hp')&&(el.offsetWidth||el.offsetHeight)&&getComputedStyle(el).visibility!=='hidden';
  });
  if(!f.length)return;
  var a=D.activeElement,first=f[0],last=f[f.length-1];
  if(e.shiftKey&&(a===first||!panel.contains(a))){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&(a===last||!panel.contains(a))){e.preventDefault();first.focus();}
  return;
 }
 var d=closest(e.target,'.wbk-d');
 if(d&&/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)){
  var all=qa('.wbk-d:not([disabled])',cur),i=all.indexOf(d);
  var n=e.key==='Home'?0:e.key==='End'?all.length-1:i+(e.key==='ArrowLeft'?-1:1);
  if(all[n]){e.preventDefault();d.tabIndex=-1;all[n].tabIndex=0;all[n].focus();}
 }
}

D.addEventListener('click',function(e){
 if(e.defaultPrevented||e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
 var a=closest(e.target,'[data-book]');
 if(!a||(root&&root.contains(a)))return;
 // без стилей окна, выключено или API не ответил — ссылка в WhatsApp; после сбоя каталог спрашиваем снова (следующий клик — в форму)
 if(!cssOk||S.api==='off'||S.api==='error'){if(S.api==='error')catAgain();return;}
 e.preventDefault();
 open(ga(a,'data-book')||'',a,e);
});
W.addEventListener('focusin',function(e){if(isOpen&&root&&!root.contains(e.target)){var t=byId('wbk-title');if(t)t.focus();}});
W.addEventListener('popstate',onPop);
// Esc и Tab — на всём документе: после щелчка по тексту окна фокус не внутри него, а Esc должен закрывать окно
D.addEventListener('keydown',function(e){if(isOpen&&root)onKey(e);});
W.addEventListener('online',catAgain);
function hash(){var m=/^#book(?:=(.*))?$/.exec(location.hash);if(m&&!isOpen)loadCat().then(function(ok){var f=function(){open(decodeURIComponent(m[1]||''),null);};if(ok){if(cssOk)f();else l.addEventListener('load',f);}});}
W.addEventListener('hashchange',hash);
restore();
var l=D.createElement('link');
l.rel='stylesheet';l.href=CSS;
l.onload=function(){cssOk=true;};
D.head.appendChild(l);
function idle(f){if(W.requestIdleCallback)W.requestIdleCallback(f,{timeout:3000});else setTimeout(f,1500);}
function early(){idle(function(){loadCat().then(function(ok){if(ok)idle(prebuild);else catLater();});});}
if(D.readyState==='complete')early();else W.addEventListener('load',early);
hash();
})();
