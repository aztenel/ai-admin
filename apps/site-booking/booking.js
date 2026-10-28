/* Онлайн-запись на сайте: окно поверх страницы; ES5 без библиотек, как скрипт сайта. Путь — как онлайн-запись Altegio (решение владельца
   22.10.2026): мастер (фото, звёзды, «Любой специалист») → услуги (категории, «ещё») → календарь месяца и время → детали записи и данные
   (напоминание, согласие) → «Вы записаны». Данные — только из нашего Worker (ключи Altegio на сервере).
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
var TIT={master:'Мастер',services:'Услуги',time:'Время',contacts:'Детали'};
var DW=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
var DAY=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
var MON=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
var MO=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
var MONN=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
// напоминание — как в виджете Altegio: часы до визита (notify_by_sms); варианты, которых нет у сервера (catalog.notify), не показываем
var NOTE=[[0,'Не напоминать'],[1,'За 1 час до визита'],[2,'За 2 часа до визита'],[3,'За 3 часа до визита'],[24,'За день до визита']];
var NET='Не удалось загрузить данные. Проверь интернет и попробуй ещё раз.';
var WAIT='Заявка отправляется — подожди несколько секунд, окно закроется после ответа.';
var SLOW='Расписание отвечает дольше обычного — подожди, не закрывай окно.';
var LOST='Расписание отвечает слишком долго. Запись могла создаться — администратор проверит и свяжется с тобой. Не записывайся повторно.';
var AGREE='Отметь согласие на обработку данных — без него записать не можем.';
var NOAGREE='Поставь галочку согласия — без неё записать не можем.';

var CO={name:'Winchester',phone:'+7 700 505 05 03',tel:'+77005050503',wa:'77066940608',address:''};
var mq=W.matchMedia('(prefers-reduced-motion: reduce)');
function calm(){return mq.matches;}
function noop(){}

// dc — дни по выбору (мастер и услуги): { m: {месяц: когда загружен}, d: {день: 1}, p: {месяц: запрос}, hz: горизонт };
// tc/tf — время по запросу (ответ и запрос в пути); nd — открытые дни каждого мастера из nearest (весь горизонт: календарь сразу);
// full — дни, где время кончилось (узнали из ответа times); bad — мастера, чьё фото не загрузилось
var S={api:'idle',cat:null,sv:{},st:{},staff:null,any:false,keys:[],date:null,time:null,slot:null,
 step:'master',ret:false,near:null,nearAt:0,nd:null,hz:null,tr:null,tq:0,tc:{},tf:{},dc:{},cm:null,full:{},bad:{},
 note:'',msg:'',name:'',phN:'',comment:'',notify:1,agree:false,busy:false,done:null,mode:'dry'};
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
function dFull(s){var d=ud(s),w=DAY[d.getUTCDay()];return w.charAt(0).toUpperCase()+w.slice(1)+', '+d.getUTCDate()+' '+MON[d.getUTCMonth()];}
function dDay(s){var d=ud(s);return d.getUTCDate()+' '+MON[d.getUTCMonth()];}
function dRel(s){var n=S.cat?diff(S.cat.today,s):9,d=ud(s);return n===0?'сегодня':n===1?'завтра':DW[d.getUTCDay()].toLowerCase()+', '+d.getUTCDate()+' '+MO[d.getUTCMonth()];}
function mon(s){return String(s).slice(0,7);}
function monAdd(m,n){var k=+m.slice(5,7)-1+n,y=+m.slice(0,4)+Math.floor(k/12);k=(k%12+12)%12;return y+'-'+(k<9?'0':'')+(k+1);}
function monLen(m){return new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate();}
var NAME;try{NAME=new RegExp("^[\\p{L}][\\p{L}\\s.'’-]*$",'u');}catch(e){NAME=/^[^\d\s][^\d]*$/;}
function low(s){return String(s||'').toLowerCase().replace(/ё/g,'е').trim();}
function closest(el,sel){return el&&el.closest?el.closest(sel):null;}
function q(sel,el){return(el||cur).querySelector(sel);}
function byId(i){return D.getElementById(i);}
function raf(f){W.requestAnimationFrame(f);}
function ga(el,n){return el.getAttribute(n);}
function qa(sel,el){return Array.prototype.slice.call((el||root).querySelectorAll(sel));}
function isDay(s){return/^\d{4}-\d{2}-\d{2}$/.test(String(s||''));}

// значки — SVG: в шрифтах сайта нет стрелок и галочек
function ic(p,vb){return'<svg viewBox="'+(vb||'0 0 24 24')+'" aria-hidden="true" focusable="false">'+p+'</svg>';}
var L=' fill="none" stroke="currentColor" stroke-width="1.6"';
var STAR='<path d="m12 2.8 2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3L2.9 9.4l6.3-.8z"/>';
var I={
 back:ic('<path d="M14.5 5.5 8 12l6.5 6.5"'+L+'/>'),next:ic('<path d="M9.5 5.5 16 12l-6.5 6.5"'+L+'/>'),
 x:ic('<path d="M6 6l12 12M18 6 6 18"'+L+'/>'),ok:ic('<path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6"/>'),
 cal:ic('<path d="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4"'+L+'/>'),
 pin:ic('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"'+L+'/><circle cx="12" cy="10" r="2.3"'+L+'/>'),
 pen:ic('<path d="M15.5 4.5l4 4L9 19H5v-4zM13 7l4 4"'+L+'/>'),
 ppl:ic('<circle cx="12" cy="8.5" r="3"'+L+'/><path d="M6.5 19c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5"'+L+'/><circle cx="5.5" cy="10" r="2.2"'+L+'/><circle cx="18.5" cy="10" r="2.2"'+L+'/><path d="M2.5 18c0-2.2 1.3-3.8 3.2-4.3M21.5 18c0-2.2-1.3-3.8-3.2-4.3"'+L+'/>'),
 done:ic('<circle cx="24" cy="24" r="21.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="24" cy="24" r="17" fill="currentColor" opacity=".14"/><path d="M15 24.5 21.5 31 33.5 18" fill="none" stroke="currentColor" stroke-width="2.6"/>','0 0 48 48')
};
// пять звёзд одной картинкой: серые снизу, цветные сверху — обрезаны по оценке
var S5=(function(){var p='';for(var i=0;i<5;i++)p+='<g transform="translate('+i*24+')">'+STAR+'</g>';return'<svg viewBox="0 0 120 24" aria-hidden="true" focusable="false" fill="currentColor">'+p+'</svg>';})();
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
 var n=c.notify;
 S.notes=NOTE.filter(function(o){return!n||!n.options||n.options.indexOf(o[0])>=0;});
 if(n&&n.def!=null&&S.notes.some(function(o){return o[0]===n.def;}))S.notify=n.def;
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
function forget(){S.staff=null;S.any=false;S.keys=[];S.date=S.time=S.slot=null;S.done=null;S.agree=false;S.step='master';try{sessionStorage.removeItem(SKEY);}catch(e){}}

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
  '<p class="wbk-sr wbk-lr" aria-live="polite"></p></div>';
 D.body.appendChild(root);
 panel=q('.wbk-p',root);main=q('.wbk-m',root);side=q('.wbk-sd',root);
 barT=q('.wbk-bt',root);nextB=q('[data-wbk=next]',root);lbl=q('.wbk-lb',root);
 prog=qa('.wbk-pg i');backB=q('[data-wbk=back]',root);live=q('.wbk-lr',root);
 root.addEventListener('click',onClick);
 root.addEventListener('change',onChange);
 root.addEventListener('input',onInput);
 root.addEventListener('submit',function(e){e.preventDefault();submit();});
 root.addEventListener('focusin',onFocusIn);
 root.addEventListener('focusout',onBlur);
 root.addEventListener('pointerover',onOver);
 // фото: load и error не всплывают — ловим на погружении
 root.addEventListener('load',onImg,true);
 root.addEventListener('error',onImg,true);
 main.addEventListener('scroll',onScroll,{passive:true});
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
  warm(0);
 }else{S.pre=v;go('master',0);}
 show();
 p.then(function(ok){
  if(!isOpen)return;
  if(ok&&S.pre!=null){preset(S.pre);S.pre=null;go(S.step,0,true);warm(0);}else if(!ok)go(S.step,0,true);
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
 // «изменить» из деталей: прежние день и время ещё помещаются (время на новый выбор уже загружено) — сразу обратно к деталям,
 // без лишнего шага времени (проверка 22.10.2026); не помещаются или ответа ещё нет — шаг времени, как раньше
 if(S.ret&&need()==='time'&&keep())return go('contacts',1);
 go(S.ret?need():STEPS[i+1],1);
}
function keep(){
 if(!S.date||!S.time)return false;
 var c=S.tc[tq(S.date)],sl;
 if(!c||Date.now()-c.at>=60000||c.j.date!==S.date)return false;
 sl=c.j.slots.filter(function(x){return x.time===S.time&&(S.any||x.staff===S.staff);})[0];
 if(!sl)return false;
 S.slot=sl;return true;
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
 swap(VIEW[S.step](),0,false,0);
 S.ready=true;S.sig=sig();
}
function sig(){return JSON.stringify([S.step,S.staff,S.any,S.keys]);}
function go(step,dir,fade){
 S.ready=false;
 var prev=S.step,st=cur?main.scrollTop:0;
 clearTimeout(advT);
 S.step=step;
 if(step==='contacts')S.ret=false;
 if(step!=='time')S.msg='';
 root.setAttribute('data-s',step);
 hdr();bar();sideUpd();
 swap(VIEW[step](),dir==null?(STEPS.indexOf(step)>=STEPS.indexOf(prev)?1:-1):dir,fade,st);
 if(ON[step])ON[step]();
 // фокус — в следующем кадре, без лишней раскладки
 raf(function(){var t=byId('wbk-title');if(t&&isOpen&&root.classList.contains('wbk-o')&&root.contains(t))t.focus({preventScroll:true});});
 save();
}
// прежний шаг убирается сразу, новый въезжает (wbk-en): уходящий шаг с анимацией держал в кадре оба шага — на переходе «мастер →
// услуги» (фото, тени) кадр длился 55–100 мс при процессоре ×4, а без него долгой задачи нет (проверка 22.10.2026)
function swap(html,dir,fade,st){
 var old=cur,el=D.createElement('div');
 el.className='wbk-st';el.setAttribute('data-step',S.step);el.innerHTML=html;
 if(old)old.parentNode.removeChild(old);
 main.appendChild(el);
 // наверх — в следующем кадре: без раскладки посреди обработчика
 if(st)raf(function(){main.scrollTop=0;});
 if(!calm())el.className+=dir?' wbk-en'+(dir<0?' wbk-bk':''):fade?' wbk-fd':'';
 cur=el;
}
function hdr(){
 var i=STEPS.indexOf(S.step),n=i<0?(S.step==='done'?5:3):i+1; // «не получили подтверждения» — запись не завершена: 3 из 4
 // одним элементом: у .label сайта flex с отступом, и «·» отрывалась от «Шаг 1 из 4» лишним промежутком
 lbl.innerHTML='<span>'+(i<0?(S.step==='done'?'Готово':'Онлайн-запись'):'Шаг '+n+' из 4<span class="wbk-ln">: '+TIT[S.step].toLowerCase()+'</span>')+'</span>';
 backB.classList.toggle('wbk-no',i<=0);
 prog.forEach(function(p,k){p.classList.toggle('on',k<n);});
}
function bar(){
 var a='',b='',ok=false,x;
 if(S.step==='master'){ok=S.any||S.staff!=null;a=ok?'Мастер':'';b=S.any?'Любой специалист':ok?staffName(S.staff):'Выбери мастера';}
 else if(S.step==='services'){
  ok=S.keys.length>0;x=tot(S.any?null:S.staff);
  a=ok?plur(S.keys.length,'услуга','услуги','услуг')+', '+dur(x.min):'';b=ok?(x.from?'от ':'')+money(x.price):'Выбери услуги';
 }else if(S.step==='time'){
  ok=!!S.slot;a=ok?dLong(S.date)+(S.any||S.slot.staff!==S.staff?', '+staffName(S.slot.staff):''):'';
  b=ok?S.time+'–'+S.slot.end:'Выбери время';
 }
 barT.innerHTML='<small>'+esc(a)+'</small><b'+(ok?'':' class="wbk-q"')+'>'+esc(b)+'</b>';
 nextB.disabled=!ok;
 root.classList.toggle('wbk-nb',S.step==='master'&&!ok);
}
function sideUpd(){side.innerHTML='<p class="label">Твоя запись</p>'+sum()+'<span class="wbk-wm" aria-hidden="true">'+emblem()+'</span>';}
// карточка «Твоя запись» справа (компьютер)
function sum(){
 if(!S.cat)return'';
 var id=S.slot?S.slot.staff:S.any?null:S.staff,m=S.st[id],x=cost();
 var no='<span class="wbk-q">—</span>',who=S.any?(m?esc(m.name)+' <small>— назначили на это время</small>':'Любой специалист'):m?esc(m.name)+' <small>'+esc(m.role||'')+'</small>':no;
 var list=S.keys.length?'<ul>'+S.keys.map(function(k){
  var s=S.sv[k],b=id!=null&&s.by[id];
  return'<li><span>'+esc(s.name)+'</span><b>'+(b?money(b.price):(s.price.to>s.price.from?'от ':'')+money(s.price.from))+'</b></li>';
 }).join('')+'</ul>':no;
 var when=S.slot&&S.date?dLong(S.date)+', '+S.time+'–'+S.slot.end:no;
 return'<dl class="wbk-dl"><div><dt>Мастер</dt><dd>'+who+'</dd></div><div><dt>Услуги</dt><dd>'+list+
  '</dd></div><div><dt>Когда</dt><dd>'+when+'</dd></div></dl>'+
  '<p class="wbk-to"><span>Итого'+(x.min?' за '+dur(x.min):'')+'</span><b>'+(S.keys.length?(x.from?'от ':'')+money(x.price):'—')+'</b></p>';
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

// ---- мастер: фото (круг), имя, должность, звёзды и отзывы, цена, ближайшее время
var VIEW={},ON={};
VIEW.master=function(){
 var h=head('Выбери мастера','Или доверься нам — покажем всё свободное время');
 if(!S.cat)return h+(S.api==='loading'||S.api==='idle'?'<div class="wbk-ms">'+skel(6,'wbk-skr')+'</div>':loadFail());
 var keys=S.keys.length?S.keys:S.pk?[S.pk]:[],one=keys.length===1?S.sv[keys[0]].name:plur(keys.length,'услуга','услуги','услуг');
 var rows=mRow(0,av(null),'Любой специалист','',
  '<span class="wbk-mx"><span class="wbk-ds">Покажем всё свободное время, мастера назначим сами</span>'+(keys.length?'<b>'+esc(one)+' от '+money(S.keys.length?tot(null).price:S.sv[S.pk].price.from)+'</b>':'')+'</span>');
 S.cat.staff.forEach(function(m){
  var x,ok=keys.every(function(k){return does(m.id,k);}),missing=S.keys.filter(function(k){return!does(m.id,k);});
  if(S.keys.length)x=tot(m.id);
  var price=!keys.length?'':S.keys.length?(ok?'<b>'+esc(one)+' '+money(x.price)+'</b>':'<span>Не делает: '+esc(missing.map(function(k){return S.sv[k].name;}).join(', '))+'</span>')
   :ok&&S.sv[S.pk].by[m.id]?'<b>'+esc(one)+' '+money(S.sv[S.pk].by[m.id].price)+'</b>':'';
  rows+=mRow(m.id,av(m),m.name,m.role||'',rate(m)+(price?'<span class="wbk-mx">'+price+'</span>':''));
 });
 return h+'<div class="wbk-ms wbk-sg">'+rows+'</div>'+waLine();
};
function mRow(id,ava,name,role,meta){
 var on=id===0?S.any:!S.any&&S.staff===id;
 return'<button class="wbk-mr" data-staff="'+id+'" aria-pressed="'+on+'">'+ava+
  '<span class="wbk-mi"><span class="wbk-mn">'+esc(name)+'</span>'+(role?'<span class="wbk-mo">'+esc(role)+'</span>':'')+meta+
  '<span class="wbk-nr" data-near="'+id+'">'+nearHTML(id)+'</span></span><span class="wbk-rd"></span></button>';
}
// фото — через наш Worker (catalog: photo — «/api/site/<клиент>/photo/<id>?v=…», has_photo); нет фото или не загрузилось — буква.
// Размер круга задан в CSS: фото приходит позже и ничего не сдвигает
function phSrc(m){
 if(!m||S.bad[m.id])return'';
 var v=m.photo;
 if(m.has_photo===false||!v)return'';
 if(typeof v==='string'&&v.charAt(0)==='/'&&v.charAt(1)!=='/')return API+v;
 if(typeof v==='string'&&v.indexOf(BASE)===0)return v;
 return BASE+'photo/'+encodeURIComponent(m.id); // адрес не нашего сервера — не берём: фото только через Worker
}
function av(m,cls){
 if(!m)return'<span class="wbk-av wbk-ay'+(cls?' '+cls:'')+'" aria-hidden="true">'+(emblem()||I.ppl)+'</span>';
 var s=phSrc(m),ps=s?'':pageImg(m),pg=s||ps?'':pagePhoto(m.name);
 return'<span class="wbk-av'+(pg?' has':'')+(cls?' '+cls:'')+'" aria-hidden="true"'+(pg?' style="background-image:'+esc(pg)+'"':'')+'><b>'+esc(m.name.charAt(0).toUpperCase())+'</b>'+
  (s||ps?'<img src="'+esc(s||ps)+'" alt="" width="64" height="64" loading="lazy" decoding="async" data-ph="'+(s?m.id:'p:'+m.id)+'">':'')+'</span>';
}
// фото из блока мастеров на самой странице (.master: h3 «Тони», .av img) — если в Altegio фото нет. У Тони и Руслана в Altegio фото нет,
// а на сайте есть (прислал Кайрат 28.10.2026). Файла на сайте нет — ошибка загрузки, остаётся буква (S.bad['p:'+id])
function firstName(n){return String(n||'').replace(/^\s+/,'').split(/[\s(,]/)[0].toLowerCase();}
function pageImg(m){
 if(S.bad['p:'+m.id])return'';
 var all=D.querySelectorAll('.master'),k=firstName(m.name);
 for(var i=0;i<all.length;i++){
  var h=all[i].querySelector('h3'),im=all[i].querySelector('.av img');
  if(k&&h&&im&&im.src&&firstName(h.textContent)===k)return im.src;
 }
 return'';
}
// фото с самой страницы (.ph «Тони, …», прежний вид сайта) — запасной путь, если на сервере фото нет
function pagePhoto(name){
 var all=D.querySelectorAll('.ph.has[aria-label]');
 for(var i=0;i<all.length;i++)if(ga(all[i],'aria-label').indexOf(name+',')===0&&all[i].style.backgroundImage)return all[i].style.backgroundImage;
 return'';
}
function onImg(e){
 var t=e.target;
 if(!t||t.tagName!=='IMG'||!t.hasAttribute('data-ph'))return;
 if(e.type==='load')t.classList.add('on');
 else{S.bad[ga(t,'data-ph')]=1;if(t.parentNode)t.parentNode.removeChild(t);}
}
function rate(m){
 if(!m.rating)return'';
 var r=Math.round(m.rating*10)/10,w=Math.round(Math.min(5,m.rating)/5*1000)/10;
 return'<span class="wbk-rt"><span class="wbk-s5" aria-hidden="true">'+S5+'<span style="width:'+w+'%">'+S5+'</span></span>'+
  (m.reviews?'<span>'+plur(m.reviews,'отзыв','отзыва','отзывов')+'</span>':'')+'<span class="wbk-sr">Рейтинг '+r.toFixed(1).replace('.',',')+' из 5</span></span>';
}
// ближайшее время мастера (у «любого» — самый ранний день всех мастеров): { date, times } или null
function nearOf(id){
 if(!S.near||S.near==='err')return null;
 var n=id?S.near[id]:null;
 if(!id)S.cat.staff.forEach(function(m){var v=S.near[m.id];if(v&&v.times.length&&(!n||v.date<n.date))n={date:v.date,times:v.times.slice()};else if(v&&n&&v.date===n.date)n.times=n.times.concat(v.times);});
 if(!n||!n.times.length)return null;
 return{date:n.date,times:n.times.filter(function(x,i,a){return a.indexOf(x)===i;}).sort().slice(0,3)};
}
function nearHTML(id){
 if(S.near==='err')return'';
 if(!S.near)return'<span class="wbk-sk wbk-skn"></span>';
 var n=nearOf(id);
 if(!n)return'<small>Нет свободного времени в ближайшие дни</small>';
 return'<span>Ближайшее: '+dRel(n.date)+'</span>'+n.times.map(function(x){return'<i>'+x+'</i>';}).join('');
}
// касание времени под мастером — пожелание дня и времени: на шаге времени они выбраны, если услуги помещаются (проверка 22.10.2026:
// время выглядело кнопкой, а выбирался только мастер)
function nearPick(id,t){
 var n=nearOf(id);
 if(!n||n.times.indexOf(t)<0)return;
 S.date=n.date;S.time=t;S.slot=null;S.tr=null;S.auto=false;
}
// ближайшее время и открытые дни всех мастеров (nearest): заранее — при наведении на кнопку записи и при открытии окна
function nearLoad(){
 if(!S.cat||S.nearP||Date.now()-S.nearAt<120000)return;
 S.nearAt=Date.now();
 S.nearP=get('nearest').then(function(r){
  S.nearP=null;
  if(r.j.ok){S.near=r.j.staff||{};if(r.j.days)S.nd=r.j.days;if(isDay(r.j.to))S.hz=r.j.to;}else S.near='err';
  nearUpd();if(isOpen&&S.step==='time')calUpd();
 },function(){S.nearP=null;S.near='err';nearUpd();});
}
ON.master=nearLoad;
function nearUpd(){if(root)qa('[data-near]').forEach(function(el){el.innerHTML=nearHTML(+ga(el,'data-near'));});}

// ---- услуги: категории сверху (переход к группе), длительность, цена, мультивыбор, «ещё» у длинного описания
VIEW.services=function(){
 if(!S.cat)return head('Выбери услуги')+loadFail();
 var m=S.any?null:S.st[S.staff],all=S.cat.staff.length,n=0,idx={};
 S.cat.services.forEach(function(s,i){idx[s.key]=i;});
 var sub=m?'Цены — у мастера '+esc(m.name):'Цена зависит от мастера: шеф-барбер или барбер';
 var chips=[],rows0=0,html=S.cat.groups.map(function(g){
  var rows=g.keys.filter(function(k){return S.sv[k]&&(!m||does(m.id,k));}).map(function(k){return svRow(k,idx[k],m,all);}).join('');
  if(!rows)return'';
  var gi=n++;chips.push('<button type="button" class="wbk-chip" data-cat="'+gi+'" aria-pressed="'+(gi===0)+'">'+esc(g.title)+'</button>');
  var gh='<div class="wbk-gr" data-g="'+gi+'"><h3 class="wbk-gh">'+esc(g.title)+'</h3><div class="wbk-sg">'+rows+'</div></div>';
  var later=rows0>4;rows0+=rows.split('class="wbk-sv').length-1;return later?'<!--later-->'+gh:gh;
 }).join('').split('<!--later-->');
 S.later=html.slice(1);html=html[0]+'<div class="wbk-lt"></div>';
 var note=S.note;S.note='';
 return head('Выбери услуги',sub)+(chips.length>1?'<nav class="wbk-cats" aria-label="Категории услуг">'+chips.join('')+'</nav>':'')+
  '<div class="wbk-ntw">'+(note?'<p class="wbk-nt" role="status">'+esc(note)+'</p>':'')+'</div>'+html+waLine();
};
// строка услуги: вся строка — подпись флажка (label растянут на строку), «ещё» — своя кнопка поверх
function svRow(k,i,m,all){
 var s=S.sv[k],b=m&&s.by[m.id],on=S.keys.indexOf(k)>=0,cnt=doer([k]).length,id='wbk-s'+i,desc=s.desc||'',lg=desc.length>34;
 var p=b?(b.max>b.price?'<small>от</small>':'')+money(b.price):(s.price.to>s.price.from?'<small>от</small>':'')+money(s.price.from);
 var info='<span>'+dur(b?b.min:s.min)+'</span>'+(!m&&cnt<all?'<span>, есть не у всех мастеров</span>':'')+(desc?'<span>. '+esc(desc)+'</span>':'');
 return'<div class="wbk-sv'+(lg?' lg':'')+'" data-key="'+esc(k)+'"><input type="checkbox" name="svc" value="'+esc(k)+'" id="'+id+'"'+(on?' checked':'')+' aria-describedby="'+id+'p '+id+'d">'+
  '<span class="wbk-cb" aria-hidden="true">'+I.ok+'</span><span class="wbk-sn"><label for="'+id+'"><b>'+esc(s.name)+'</b></label></span>'+
  '<span class="wbk-dt" aria-hidden="true"></span><span class="wbk-sp" id="'+id+'p">'+p+'</span>'+
  '<span class="wbk-si"><small id="'+id+'d">'+info+'</small>'+(lg?'<button type="button" class="wbk-more" aria-expanded="false" aria-controls="'+id+'d">ещё</button>':'')+'</span></div>';
}
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
// первая группа — сразу, остальные — по одной за кадр: на слабом телефоне шаг рисовался одной задачей до 120 мс (проверка 21.10.2026)
ON.services=function(){
 var h=S.later||[],el=cur;S.later=[];S.rest=h;
 (function put(i){if(i<h.length)setTimeout(function(){raf(function(){if(S.rest!==h)return;var w=cur===el&&q('.wbk-lt');if(w){w.insertAdjacentHTML('beforebegin',h[i]);if(i===h.length-1)S.rest=null;put(i+1);}});},0);})(0);
 warm();
};
// все группы — сразу (переход по категории)
function flush(){
 var h=S.rest,w=q('.wbk-lt');S.rest=null;
 if(h&&w)h.forEach(function(x){var g=/data-g="(\d+)"/.exec(x);if(g&&!q('.wbk-gr[data-g="'+g[1]+'"]'))w.insertAdjacentHTML('beforebegin',x);});
}
function toCat(k){
 flush();
 var g=q('.wbk-gr[data-g="'+k+'"]'),c=q('.wbk-cats');
 if(!g||!c)return;
 var mt=main.getBoundingClientRect().top,y=g.getBoundingClientRect().top-mt+main.scrollTop-c.offsetHeight-6;
 // последняя группа короче экрана — место снизу, чтобы и она встала наверх, как в Altegio
 var sp=q('.wbk-lt'),more=y+main.clientHeight-main.scrollHeight;
 if(more>0&&sp)sp.style.height=(sp.offsetHeight+more+2)+'px';
 S.spyHold=Date.now()+900;chipOn(k);
 main.scrollTo({top:y,behavior:calm()?'auto':'smooth'});
}
function chipOn(k){
 var cs=qa('.wbk-chip',cur),c=q('.wbk-cats');
 cs.forEach(function(b,i){b.setAttribute('aria-pressed',String(i===k));});
 var b=cs[k];
 if(b&&c&&(b.offsetLeft<c.scrollLeft||b.offsetLeft+b.offsetWidth>c.scrollLeft+c.clientWidth))c.scrollTo({left:b.offsetLeft-16,behavior:calm()?'auto':'smooth'});
}
// какая группа сейчас наверху — тот чип и выбран
function onScroll(){if(S.step!=='services'||S.spyF)return;S.spyF=1;raf(function(){S.spyF=0;spy();});}
function spy(){
 if(Date.now()<(S.spyHold||0)||!cur)return;
 var c=q('.wbk-cats');if(!c)return;
 var top=c.getBoundingClientRect().bottom+12,gs=qa('.wbk-gr',cur),k=0;
 for(var i=0;i<gs.length;i++)if(gs[i].getBoundingClientRect().top<=top)k=+ga(gs[i],'data-g');
 var on=q('.wbk-chip[aria-pressed=true]');
 if(!on||+ga(on,'data-cat')!==k)chipOn(k);
}

// ---- дата и время: календарь месяца (дни — как разрешает Altegio), время группами «Утро / День / Вечер»
VIEW.time=function(){
 if(!S.cat)return head('Выбери дату и время')+loadFail();
 var t=S.cat.today,c=S.tc[tq('')];
 S.auto=!(S.date&&S.date>=t&&S.date<=last());
 S.cm=mon(S.auto?(c&&isDay(c.j.date)?c.j.date:t):S.date);
 return head('Выбери дату и время','Только время, когда мастер свободен на всю длительность услуг')+
  '<div class="wbk-cal">'+calHTML()+'</div>'+
  '<div class="wbk-ntw">'+(S.msg?'<p class="wbk-nt e" role="alert">'+esc(S.msg)+'</p>':'')+'</div>'+
  '<div class="wbk-tw">'+(S.tr&&S.tr.taken?timesHTML():tSkel())+'</div>'+waLine();
};
function tSkel(){return'<div class="wbk-tg"><span class="wbk-sk wbk-skl"></span><div class="wbk-ts">'+skel(8,'wbk-skt')+'</div></div>';}
function tq(date){return'staff='+(S.any?0:S.staff)+'&services='+encodeURIComponent(S.keys.join(','))+(date?'&date='+date:'');}
// последний день, на который Altegio разрешает запись: из ответа dates (по выбору), иначе из nearest, иначе из каталога (потолок)
function last(){var e=S.dc[tq('')];return e&&e.hz||S.hz||S.cat.last||addD(S.cat.today,Math.max(1,+S.cat.days||30)-1);}
// открытые дни выбора по nearest (дни каждого мастера на весь горизонт): { день: 1 } или null — не знаем
function openSet(){
 if(!S.nd)return null;
 var ids=S.any?doer(S.keys).map(function(m){return m.id;}):[S.staff],o={};
 for(var i=0;i<ids.length;i++){var a=S.nd[ids[i]];if(!a)return null;for(var k=0;k<a.length;k++)o[a[k]]=1;}
 return o;
}
// ok — открыт; uk — ещё не знаем (можно нажать: время скажет сервер); off — нельзя; full — время на этот день кончилось
function dayState(d){
 if(!S.cat||d<S.cat.today||d>last())return'off';
 var dk=tq(''),e=S.dc[dk],o;
 if(S.full[dk+d])return'full';
 if(e&&e.m[mon(d)])return e.d[d]?'ok':'off';
 o=openSet();
 return o?(o[d]?'ok':'off'):'uk';
}
// дни месяца (month=ГГГГ-ММ; ответ без month — весь период from…to, режем по месяцам сами); кэш 4 минуты, повторный запрос — тот же
function loadDates(dk,m){
 var e=S.dc[dk]||(S.dc[dk]={m:{},d:{},p:{},hz:null});
 if(e.m[m]&&Date.now()-e.m[m]<240000)return Promise.resolve(1); // 1 — уже было (перерисовывать незачем), 2 — новые данные
 if(e.p[m])return e.p[m];
 return e.p[m]=get('dates',dk+'&month='+m).then(function(r){
  delete e.p[m];
  var j=r.j,now=Date.now(),ms=[],x;
  if(!j.ok)return false;
  if(j.month||!isDay(j.from)||!isDay(j.to))ms=[j.month||m];
  else for(x=mon(j.from);x<=mon(j.to)&&ms.length<12;x=monAdd(x,1))ms.push(x);
  for(x in e.d)if(ms.indexOf(mon(x))>=0)delete e.d[x];
  ms.forEach(function(y){e.m[y]=now;});
  (j.dates||[]).forEach(function(d){if(ms.indexOf(mon(d))>=0)e.d[d]=1;});
  if(isDay(j.to))e.hz=j.to;
  return 2;
 },function(){delete e.p[m];return false;});
}
// дни показанного месяца и следующего; пришли — календарь перерисовывается (если ещё на этом шаге и выбор тот же)
function datesFor(m){
 var dk=tq('');
 [m,monAdd(m,1)].forEach(function(x,i){
  if(i&&x>mon(last()))return;
  loadDates(dk,x).then(function(ok){if(ok===2&&isOpen&&S.step==='time'&&tq('')===dk&&(x===S.cm||S.calSig!==S.cm+'|'+last()))calUpd();});
 });
}
function calHTML(){
 if(S.cm>mon(last()))S.cm=mon(last()); // горизонт оказался короче, чем думали до ответа сервера
 if(S.cm<mon(S.cat.today))S.cm=mon(S.cat.today);
 S.calSig=S.cm+'|'+last();
 var m=S.cm,n=monLen(m),lead=(ud(m+'-01').getUTCDay()+6)%7,lst=last(),dk=tq(''),e=S.dc[dk],busy=!(e&&e.m[m])&&!openSet(),foc=focusDay(m),cells=[],i,h;
 h='<div class="wbk-ch"><p class="wbk-cm" id="wbk-cm" aria-live="polite">'+MONN[+m.slice(5,7)-1]+' <span>'+m.slice(0,4)+'</span></p><span class="wbk-ar">'+
  '<button type="button" class="wbk-ib" data-wbk="pm" aria-label="Предыдущий месяц"'+(m<=mon(S.cat.today)?' aria-disabled="true"':'')+'>'+I.back+'</button>'+
  '<button type="button" class="wbk-ib" data-wbk="nm" aria-label="Следующий месяц"'+(m>=mon(lst)?' aria-disabled="true"':'')+'>'+I.next+'</button></span></div>'+
  '<div class="wbk-gd" role="grid" aria-labelledby="wbk-cm"'+(busy?' aria-busy="true"':'')+'><div class="wbk-wr" role="row">'+
  ['понедельник','вторник','среда','четверг','пятница','суббота','воскресенье'].map(function(w,k){return'<span role="columnheader" aria-label="'+w+'">'+DW[(k+1)%7]+'</span>';}).join('')+'</div>';
 for(i=0;i<lead;i++)cells.push('<span role="gridcell"></span>');
 for(i=1;i<=n;i++)cells.push(dayHTML(m+'-'+(i<10?'0':'')+i,foc));
 while(cells.length%7)cells.push('<span role="gridcell"></span>');
 for(i=0;i<cells.length;i+=7)h+='<div class="wbk-wr" role="row">'+cells.slice(i,i+7).join('')+'</div>';
 return h+'</div><p class="wbk-hz">Запись открыта до '+dDay(lst)+'</p>';
}
function dayHTML(d,foc){
 var st=dayState(d),u=ud(d),t=S.cat.today,off=st==='off'||st==='full';
 var lab=DAY[u.getUTCDay()]+', '+u.getUTCDate()+' '+MON[u.getUTCMonth()]+' '+u.getUTCFullYear()+(d===t?', сегодня':'')+
  (st==='full'?' — всё занято':st==='off'&&d>=t?(d>last()?' — запись ещё не открыта':' — нет записи'):'');
 return'<button type="button" role="gridcell" class="wbk-c'+(d===t?' td':'')+(st==='uk'?' uk':'')+'" data-date="'+d+'" aria-selected="'+(d===S.date)+'"'+
  ' tabindex="'+(d===foc?0:-1)+'"'+(off?' aria-disabled="true"':'')+' aria-label="'+lab+'">'+u.getUTCDate()+'</button>';
}
// день месяца, на котором Tab входит в календарь: выбранный, сегодня, первый доступный, первое число
function focusDay(m){
 if(S.date&&mon(S.date)===m)return S.date;
 var t=S.cat.today,n=monLen(m),i,d;
 if(mon(t)===m&&dayState(t)!=='off')return t;
 for(i=1;i<=n;i++){d=m+'-'+(i<10?'0':'')+i;if(dayState(d)==='ok'||dayState(d)==='uk')return d;}
 return mon(t)===m?t:m+'-01';
}
// перерисовать календарь, фокус — на тот же день или ту же стрелку (или на день want)
function calUpd(want){
 var w=cur&&q('.wbk-cal');
 if(!w||S.step!=='time')return;
 var a=D.activeElement,inCal=a&&w.contains(a),fd=want||(inCal&&ga(a,'data-date')),fw=inCal&&ga(a,'data-wbk');
 w.innerHTML=calHTML();
 if(fd&&mon(fd)===S.cm){var b=q('.wbk-c[data-date="'+fd+'"]',w);if(b){qa('.wbk-c[tabindex="0"]',w).forEach(function(x){x.tabIndex=-1;});b.tabIndex=0;b.focus();}}
 else if(fw){var c=q('[data-wbk="'+fw+'"]',w);if(c)c.focus();}
}
// только выделение выбранного дня — без перерисовки
function calSel(){
 var w=cur&&q('.wbk-cal');
 if(!w)return;
 qa('.wbk-c',w).forEach(function(b){var on=ga(b,'data-date')===S.date;b.setAttribute('aria-selected',String(on));if(on){qa('.wbk-c[tabindex="0"]',w).forEach(function(x){x.tabIndex=-1;});b.tabIndex=0;}});
}
function calGo(n){
 var m=monAdd(S.cm,n);
 if(m<mon(S.cat.today)||m>mon(last()))return;
 S.cm=m;S.auto=false;calUpd();datesFor(m);
}
// стрелки: ±1 день, ±неделя, Home/End — начало и конец недели, PageUp/PageDown — месяц; за пределы записи не уходим
function calMove(d,k){
 var u=ud(d),wd=(u.getUTCDay()+6)%7,n=null;
 if(k==='ArrowLeft')n=addD(d,-1);else if(k==='ArrowRight')n=addD(d,1);else if(k==='ArrowUp')n=addD(d,-7);else if(k==='ArrowDown')n=addD(d,7);
 else if(k==='Home')n=addD(d,-wd);else if(k==='End')n=addD(d,6-wd);
 else if(k==='PageUp'||k==='PageDown'){var m=monAdd(mon(d),k==='PageUp'?-1:1),dd=Math.min(+d.slice(8),monLen(m));n=m+'-'+(dd<10?'0':'')+dd;}
 if(!n)return null;
 var lo=mon(S.cat.today)+'-01',hi=mon(last())+'-'+monLen(mon(last()));
 return n<lo?(k==='PageUp'&&mon(d)!==mon(lo)?lo:null):n>hi?(k==='PageDown'&&mon(d)!==mon(hi)?hi:null):n;
}
function timesHTML(){
 var r=S.tr,sl=r.slots,tab=S.slot&&sl.some(function(x){return x.time===S.time;})?S.time:sl.length?sl[0].time:null;
 if(!isDay(r.date))return'<div class="wbk-em0"><p>Свободного времени для записи онлайн пока нет. Напиши нам в WhatsApp — подберём.</p></div>';
 var u=ud(r.date),day=DAY[u.getUTCDay()],h='<p class="wbk-td" data-date="'+r.date+'">'+day.charAt(0).toUpperCase()+day.slice(1)+', '+u.getUTCDate()+' '+MON[u.getUTCMonth()]+'</p>';
 if(!sl.length)return h+'<div class="wbk-em0"><p>На этот день свободного времени нет.</p>'+
  (r.next?'<button class="btn btn-line" data-date="'+r.next+'">Ближайший день: '+dLong(r.next).replace(/^../,function(x){return x.toLowerCase();})+'</button>':'')+'</div>';
 var named=S.any||sl.some(function(x){return x.staff!==S.staff;});
 return h+[['Утро',0,720],['День',720,1080],['Вечер',1080,1440]].map(function(g){
  var b=sl.filter(function(x){var m=mins(x.time);return m>=g[1]&&m<g[2];}).map(function(x){
   return'<button class="wbk-t" data-time="'+x.time+'" tabindex="'+(x.time===tab?0:-1)+'" aria-pressed="'+(x.time===S.time&&!!S.slot)+'"'+
    (named?' aria-label="'+x.time+', мастер '+esc(staffName(x.staff))+'"':'')+'>'+x.time+(named?'<small>'+esc(staffName(x.staff))+'</small>':'')+'</button>';
  }).join('');
  return b?'<div class="wbk-tg"><p class="label">'+g[0]+'</p><div class="wbk-ts wbk-sg" role="group" aria-label="'+g[0]+'">'+b+'</div></div>':'';
 }).join('');
}
ON.time=function(){
 datesFor(S.cm);nearLoad();
 var keep=S.tr&&S.tr.taken;
 if(keep){S.tr.taken=false;loadTimes(S.date,true);return;}
 S.tr=null;
 loadTimes(S.auto?null:S.date);
};
// время по запросу: кэш минуту, одинаковый запрос в пути — общий (упреждающая загрузка и выбор дня не спрашивают дважды)
function fetchTimes(qs){
 var c=S.tc[qs];
 if(c&&Date.now()-c.at<60000)return Promise.resolve({s:200,j:c.j});
 if(S.tf[qs])return S.tf[qs];
 return S.tf[qs]=get('times',qs).then(function(r){
  delete S.tf[qs];
  if(r.j.ok){var at=Date.now();S.tc[qs]={at:at,j:r.j};if(isDay(r.j.date)&&qs.indexOf('&date=')<0)S.tc[qs+'&date='+r.j.date]={at:at,j:r.j};markFull(qs,r.j);}
  return r;
 },function(e){delete S.tf[qs];throw e;});
}
// дни, где время кончилось: сам день без времени; открытые дни до найденного (сервер их проверил) и до «ближайшего дня»
function markFull(qs,j){
 var dk=qs.replace(/&date=.*$/,''),ch=false,x;
 if(dk!==tq('')||!isDay(j.date))return;
 var set=function(d,v){if(!!S.full[dk+d]!==v){ch=true;if(v)S.full[dk+d]=1;else delete S.full[dk+d];}};
 set(j.date,!j.slots.length);
 if(j.slots.length&&qs.indexOf('&date=')<0)for(x=S.cat.today;x<j.date;x=addD(x,1))if(dayState(x)==='ok')set(x,true);
 if(!j.slots.length&&isDay(j.next))for(x=addD(j.date,1);x<j.next;x=addD(x,1))if(dayState(x)==='ok')set(x,true);
 if(ch&&isOpen&&S.step==='time')calUpd();
}
// заранее: не больше двух запросов времени в пути (наведение на дни не должно забить очередь к Altegio); true — запрос ушёл
function prefetch(date){
 var qs=tq(date||''),c=S.tc[qs],n=0,k;
 if(c&&Date.now()-c.at<60000||S.tf[qs])return false;
 for(k in S.tf)n++;
 if(n>=2)return false;
 fetchTimes(qs).then(noop,noop);
 return true;
}
// выбраны мастер и услуги — дни текущего и следующего месяца и время первого дня берём сразу (к шагу времени всё уже есть)
function warm(wait){
 clearTimeout(S.wT);
 S.wT=setTimeout(function(){
  if(!S.cat||(!S.any&&S.staff==null)||!S.keys.length)return;
  var t=S.cat.today,d=S.date&&S.date>=t&&S.date<=last()?S.date:null,m=mon(d||t),dk=tq('');
  loadDates(dk,m);if(monAdd(m,1)<=mon(last()))loadDates(dk,monAdd(m,1));
  prefetch(d);
 },wait==null?300:wait);
}
function loadTimes(date,fresh){
 var qs=tq(date),tok=++S.tq,tw=cur&&q('.wbk-tw'),c=S.tc[qs];
 if(fresh)delete S.tc[qs];
 else if(c&&Date.now()-c.at<60000)return tDone(c.j,tok);
 // ждём: прежнее время тускнеет сразу, скелетон — только если ответ задерживается
 clearTimeout(S.skT);
 if(tw){tw.classList.add('wbk-dim');S.skT=setTimeout(function(){if(tok===S.tq&&S.step==='time'&&!(fresh&&S.tr)){var w=q('.wbk-tw');if(w)w.innerHTML=tSkel();}},180);}
 fetchTimes(qs).then(function(r){
  if(tok!==S.tq||S.step!=='time')return;
  clearTimeout(S.skT);
  if(r.j.ok)return tDone(r.j,tok);
  if(r.j.code==='bad_request'&&(r.j.field==='services'||r.j.field==='staff')){S.note=r.j.error;return go(r.j.field==='staff'?'master':'services',-1);}
  S.retry=function(){loadTimes(date,true);};
  tFail(r.j.error||NET);
 },function(){
  if(tok!==S.tq||S.step!=='time')return;
  clearTimeout(S.skT);
  S.retry=function(){loadTimes(date,true);};
  tFail(NET);
 });
}
function tFail(msg){var w=q('.wbk-tw');w.classList.remove('wbk-dim');w.innerHTML=alertBox(msg,1);}
function tDone(j,tok){
 if(tok!==S.tq||S.step!=='time')return;
 clearTimeout(S.skT);
 var had=S.time,was=S.date;
 S.tr=j;if(isDay(j.date))S.date=j.date;
 if(S.slot&&!j.slots.some(function(x){return x.time===S.time&&x.staff===S.slot.staff;}))S.slot=null;
 if(!S.slot&&S.time){S.slot=j.slots.filter(function(x){return x.time===S.time;})[0]||null;if(!S.slot)S.time=null;}
 // после «изменить» прежнее время не подошло (услуги дольше, другой мастер) — говорим об этом
 if(had&&!S.slot&&was===S.date&&j.slots.length)notice('В '+had+' это уже не помещается — выбери другое время.');
 var tw=q('.wbk-tw');tw.classList.remove('wbk-dim');tw.innerHTML=timesHTML();fadeIn(tw);
 if(S.auto&&isDay(j.date)&&mon(j.date)!==S.cm){S.cm=mon(j.date);calUpd();datesFor(S.cm);}else calSel();
 S.auto=false;
 bar();sideUpd();save();
 // соседний открытый день — заранее
 for(var i=1,x;S.date&&i<8;i++){x=addD(S.date,i);if(x>last())break;if(dayState(x)==='ok'){prefetch(x);break;}}
}
function fadeIn(el){if(calm())return;el.classList.remove('wbk-fd');raf(function(){el.classList.add('wbk-fd');});}

// ---- детали записи (как в Altegio: мастер, дата и время, услуги, итого — у каждого «изменить») и данные клиента
VIEW.contacts=function(){
 var dry=S.mode==='dry',btn=dry?'Отправить заявку':'Записаться';
 var f=function(n,label,input,opt,req2){
  return'<div class="wbk-fi"><label class="label" for="wbk-'+n+'">'+label+(req2?'<i aria-hidden="true">*</i>':'')+(opt?'<small>необязательно</small>':'')+'</label>'+input+
   '<p class="wbk-er" id="wbk-'+n+'-e" aria-live="polite"></p></div>';
 };
 var notes=(S.notes||NOTE).map(function(o){return'<option value="'+o[0]+'"'+(o[0]===S.notify?' selected':'')+'>'+o[1]+'</option>';}).join('');
 return head('Детали записи')+'<div class="wbk-ct"><section class="wbk-rv" aria-label="Твоя запись">'+details()+'</section>'+
  '<form class="wbk-fm" novalidate><h3 class="wbk-h3">Твои данные</h3>'+
  f('name','Имя','<input class="wbk-in" id="wbk-name" name="name" autocomplete="name" maxlength="60" required aria-required="true" aria-describedby="wbk-name-e" enterkeyhint="next" placeholder="Как к тебе обращаться" value="'+esc(S.name)+'">',0,1)+
  f('phone','Телефон','<input class="wbk-in" id="wbk-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required aria-required="true" aria-describedby="wbk-phone-e" placeholder="+7 7XX XXX XX XX" value="'+(S.phN?fmtPh(S.phN):'')+'">',0,1)+
  f('comment','Комментарий для мастера','<textarea class="wbk-in" id="wbk-comment" name="comment" maxlength="150" rows="3" aria-describedby="wbk-comment-e">'+esc(S.comment)+'</textarea><span class="wbk-cn" aria-live="polite"></span>',1)+
  '<div class="wbk-fi"><label class="label" for="wbk-notify">Напоминание</label><span class="wbk-sel"><select class="wbk-in" id="wbk-notify" name="notify">'+notes+'</select>'+I.next+'</span></div>'+
  '<div class="wbk-hp" aria-hidden="true"><label>Сайт <input name="website" tabindex="-1" autocomplete="off"></label></div>'+
  '<div class="wbk-agw"><label class="wbk-agree"><input type="checkbox" id="wbk-ok" name="consent"'+(S.agree?' checked':'')+' aria-describedby="wbk-ok-e">'+
  '<span class="wbk-cb" aria-hidden="true">'+I.ok+'</span><span>Я даю согласие на обработку персональных данных и подтверждаю ознакомление с '+
  '<a href="'+esc(PRIV)+'" target="_blank" rel="noopener">Политикой конфиденциальности</a></span></label><p class="wbk-er" id="wbk-ok-e" aria-live="polite"></p></div>'+
  '<div class="wbk-alw"></div>'+
  (dry?'<p class="wbk-dry">Время свободно. Запись в журнал мастера внесёт администратор и подтвердит её звонком или в WhatsApp.</p>':'')+
  '<button type="submit" class="btn btn-brass wbk-sb'+(S.agree?'':' wbk-off')+'" data-wbk="submit" aria-disabled="'+!S.agree+'" aria-describedby="wbk-hint">'+btn+'</button>'+
  '<p class="wbk-hint" id="wbk-hint">'+(S.agree?'':esc(AGREE))+'</p></form></div>'+waLine();
};
function pen(s,what){return'<button type="button" class="wbk-pen" data-go="'+s+'" aria-label="Изменить '+what+'">'+I.pen+'<span aria-hidden="true">изменить</span></button>';}
function details(){
 var id=S.slot?S.slot.staff:S.any?null:S.staff,m=S.st[id],x=cost();
 var role=S.any?(m?'назначили на это время':''):(m&&m.role)||'';
 var when=S.slot&&S.date?'<small>'+dFull(S.date)+'</small><b>'+S.time+'\u00a0—\u00a0'+S.slot.end+'</b>':'<b class="wbk-q">—</b>';
 var items=S.keys.map(function(k){
  var s=S.sv[k],b=id!=null&&s.by[id];
  return'<li><span>'+esc(s.name)+'<small>'+dur(b?b.min:s.min)+'</small></span><b>'+(b?money(b.price):(s.price.to>s.price.from?'от ':'')+money(s.price.from))+'</b></li>';
 }).join('');
 return'<div class="wbk-dr">'+av(m||null,'sm')+'<span class="wbk-dx"><b>'+(m?esc(m.name):'Любой специалист')+'</b><small>'+esc(role)+'</small></span>'+pen('master','мастера')+'</div>'+
  '<div class="wbk-dr"><span class="wbk-av wbk-ay sm" aria-hidden="true">'+I.cal+'</span><span class="wbk-dx">'+when+'</span>'+pen('time','дату и время')+'</div>'+
  '<div class="wbk-dv"><p class="wbk-dvh"><b>Услуги</b><small>'+dur(x.min)+'</small>'+pen('services','услуги')+'</p><ul>'+items+'</ul></div>'+
  '<p class="wbk-to"><span>Итого</span><b>'+(x.from?'от ':'')+money(x.price)+'</b></p>';
}
// кнопка отправки: без согласия — неактивна (aria-disabled: фокус и подсказка остаются), во время отправки — тоже
function sbSync(){
 var b=cur&&q('.wbk-sb'),h=cur&&q('#wbk-hint');
 if(!b)return;
 b.setAttribute('aria-disabled',String(S.busy||!S.agree));b.classList.toggle('wbk-off',!S.agree&&!S.busy);
 if(h)h.textContent=S.agree?'':AGREE;
}

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
 ferr('ok',S.agree?'':NOAGREE);
 bad=['name','phone','comment','ok'].filter(function(n){return ga(byId('wbk-'+n),'aria-invalid')==='true';})[0];
 if(bad)return byId('wbk-'+bad).focus();
 if(need()!=='contacts')return go(need(),-1);
 S.tries={fast:0,old:0,prog:0,net:0};
 send({staff:S.any?S.slot.staff:S.staff,any:S.any,services:S.keys.slice(),date:S.date,time:S.time,name:name,phone:'+7'+S.phN,
  comment:S.comment,notify:S.notify,consent:true,website:fm.elements.website.value,ft:S.cat.ft,rid:rid()});
}
// кнопка не disabled, а aria-disabled: фокус остаётся на ней (иначе уходил на body — Esc и программа экранного доступа теряли место)
function busy(on){
 S.busy=on;
 clearTimeout(slowT);
 if(on)slowT=setTimeout(function(){var w=S.busy&&cur&&q('.wbk-alw');if(w)w.innerHTML='<p class="wbk-nt wbk-wt" role="status">'+esc(SLOW)+'</p>';},8000);
 backB.setAttribute('aria-disabled',String(on));
 var b=cur&&q('.wbk-sb'),dry=S.mode==='dry';
 if(!b)return;
 b.classList.toggle('wbk-ld',on);
 b.innerHTML=on?'<span class="wbk-spin" aria-hidden="true"></span>'+(dry?'Отправляем…':'Записываем…'):dry?'Отправить заявку':'Записаться';
 sbSync();
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
 if(j.ok){busy(false);S.done=j.booking;S.mode=j.mode||S.mode;S.nearAt=0;S.tc={};S.dc={};S.full={};try{sessionStorage.removeItem(SKEY);}catch(e){}return go('done',1);}
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
 if(c==='consent'||(c==='bad_request'&&j.field==='consent')){S.agree=false;var ok=byId('wbk-ok');if(ok){ok.checked=false;sbSync();ferr('ok',j.error||NOAGREE);ok.focus();}return;}
 if(c==='bad_request'&&j.field==='notify'){S.notify=1;var sel=byId('wbk-notify');if(sel)sel.value='1';return fail(j.error);}
 if(c==='bad_request'&&FIELD[j.field]){ferr(j.field,j.error);var i=byId('wbk-'+j.field);if(i)i.focus();return;}
 if(c==='bad_request'&&(j.field==='services'||j.field==='staff')){S.note=j.error;return go(j.field==='staff'?'master':'services',-1);}
 if(c==='bad_request'&&(j.field==='date'||j.field==='time')){S.msg=j.error;S.slot=null;S.tc={};return go('time',-1);}
 if(c==='unknown'||c==='refused'){S.err=j.error;S.errT=c;return go('unknown',1);}
 fail(j.error||'Что-то пошло не так. Попробуй ещё раз или напиши нам в WhatsApp.');
}

// ---- готово: «Вы записаны» (настоящая запись) или «Заявка принята» (режим проверки — честно: запись внесёт администратор)
VIEW.done=function(){
 var b=S.done,dry=S.mode==='dry',names=b.services.map(function(s){return esc(s.name)+', '+money(s.price);}).join('<br>');
 return'<div class="wbk-dn"><span class="wbk-em">'+I.done+'</span>'+
  '<h2 class="wbk-h wbk-xl" id="wbk-title" tabindex="-1">'+(dry?'Заявка <em>принята</em>':'Вы <em>записаны</em>')+'</h2>'+
  '<p class="wbk-sub">'+(dry?'Время свободно, заявка у администратора: он внесёт запись в журнал мастера и подтвердит её звонком или в WhatsApp.'
   :'Ждём в <span class="rye">Winchester</span>. Запись уже в журнале мастера.')+'</p>'+
  '<dl class="wbk-fl"><div><dt>Мастер</dt><dd>'+esc(b.staff.name)+(b.any?' <small>— назначили на это время</small>':b.staff.role?' <small>'+esc(b.staff.role)+'</small>':'')+'</dd></div>'+
  '<div><dt>Когда</dt><dd>'+dFull(b.date)+', '+b.time+'\u00a0—\u00a0'+b.end+'</dd></div><div><dt>Услуги</dt><dd>'+names+'</dd></div>'+
  '<div><dt>Итого</dt><dd>'+money(b.total)+' за '+dur(b.min)+'</dd></div><div><dt>Адрес</dt><dd>'+esc(CO.address)+'</dd></div></dl>'+
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
 var a=closest(e.target,'[data-wbk],[data-wbk-wa],[data-staff],[data-date],[data-time],[data-go],[data-cat],.wbk-more');
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
 if(w==='pm'||w==='nm'){if(ga(a,'aria-disabled')!=='true')calGo(w==='pm'?-1:1);return;}
 if(a.classList.contains('wbk-more')){var r=closest(a,'.wbk-sv'),x=ga(a,'aria-expanded')!=='true';r.classList.toggle('ex',x);a.setAttribute('aria-expanded',String(x));a.textContent=x?'свернуть':'ещё';return;}
 if(a.hasAttribute('data-cat'))return toCat(+ga(a,'data-cat'));
 if(a.hasAttribute('data-staff')){var ni=closest(e.target,'.wbk-nr i');if(ni)nearPick(+ga(a,'data-staff'),ni.textContent);return pickStaff(+ga(a,'data-staff'));}
 if(a.hasAttribute('data-date')){if(ga(a,'aria-disabled')!=='true'){pickDate(ga(a,'data-date'));if(e.detail&&closest(a,'.wbk-cal'))toTimes();}return;}
 if(a.hasAttribute('data-time'))return pickTime(ga(a,'data-time'));
 if(a.hasAttribute('data-go')){S.ret=true;go(ga(a,'data-go'),-1);}
}
// мастер сменился — время сбрасывается, но день и время остаются пожеланием: если у нового мастера оно есть, оно и выбрано
function pickStaff(id){
 if(!S.cat)return;
 var any=id===0;
 if(any!==S.any||(!any&&id!==S.staff)){S.slot=null;S.tr=null;}
 S.any=any;S.staff=any?null:id;
 dropKeys();
 qa('.wbk-mr',cur).forEach(function(b){b.setAttribute('aria-pressed',String(+ga(b,'data-staff')===id));});
 bar();sideUpd();save();warm(0);
 clearTimeout(advT);
 advT=setTimeout(function(){if(isOpen&&S.step==='master')next();},150);
}
function pickDate(d){
 if(!isDay(d)||d===S.date&&S.tr&&S.tr.date===d)return;
 S.date=d;S.slot=null;S.time=null;S.msg='';S.auto=false;
 var w=q('.wbk-ntw');if(w)w.innerHTML='';
 if(mon(d)!==S.cm){S.cm=mon(d);calUpd();datesFor(S.cm);}else calSel();
 bar();sideUpd();
 loadTimes(d);
}
// низкий телефон (360×740, 375×667): календарь занимает весь экран, и касание дня «ничего не меняло» — время было ниже края
// (проверка 22.10.2026). Первый ряд времени не виден — плавно прокручиваем к времени дня; виден — окно не двигаем.
// Только касание и мышь: с клавиатуры фокус остаётся в календаре
function toTimes(){
 var w=cur&&q('.wbk-tw'),f=w&&(q('.wbk-ts,.wbk-em0',w)||w);
 if(!f)return;
 var mr=main.getBoundingClientRect(),r=f.getBoundingClientRect();
 if(r.bottom<=mr.bottom)return;
 main.scrollTo({top:main.scrollTop+w.getBoundingClientRect().top-mr.top-8,behavior:calm()?'auto':'smooth'});
}
function pickTime(t){
 var sl=S.tr&&S.tr.slots.filter(function(x){return x.time===t;})[0];
 if(!sl)return;
 S.time=t;S.slot=sl;S.msg='';
 var w=q('.wbk-ntw');if(w)w.innerHTML='';
 qa('.wbk-t',cur).forEach(function(b){var on=ga(b,'data-time')===t;b.setAttribute('aria-pressed',String(on));b.tabIndex=on?0:-1;});
 bar();sideUpd();save();
 say(dLong(S.date)+', '+t+'–'+sl.end+(S.any?', мастер '+staffName(sl.staff):''));
}
function onChange(e){
 var t=e.target;
 if(t.id==='wbk-ok'){S.agree=t.checked;if(t.checked)ferr('ok','');sbSync();return;}
 if(t.id==='wbk-notify'){S.notify=+t.value;return;}
 if(t.name!=='svc')return;
 var k=t.value,i=S.keys.indexOf(k),max=S.cat.maxServices||5;
 if(t.checked&&i<0){
  if(S.keys.length>=max){t.checked=false;return notice('Не больше '+max+' услуг за один визит.');}
  S.keys.push(k);
 }else if(!t.checked&&i>=0)S.keys.splice(i,1);
 S.slot=null;S.tr=null; // день и время — пожелание: на шаге времени выберутся снова, если ещё помещаются
 bar();sideUpd();save();warm();
}
function onInput(e){
 var t=e.target;
 if(t.id==='wbk-phone'){phoneIn(t,e);if(ga(t,'aria-invalid')==='true'&&phoneOk(S.phN))ferr('phone','');}
 else if(t.id==='wbk-name'){S.name=t.value;if(ga(t,'aria-invalid')==='true')ferr('name','');}
 else if(t.id==='wbk-comment'){S.comment=t.value;var n=t.value.length,c=q('.wbk-cn');c.textContent=n>=120?n+' / 150':'';}
}
function onFocusIn(e){
 var t=e.target;
 if(t.id==='wbk-phone'&&!t.value){t.value='+7 ';try{t.setSelectionRange(3,3);}catch(x){}}
 if(t.classList&&t.classList.contains('wbk-c'))overDay(t,150);
}
function onBlur(e){var t=e.target;if(t.id==='wbk-phone'&&!S.phN)t.value='';}
// наведение на день (и фокус с клавиатуры) — его время заранее, если задержались на нём, но не больше HOV дней в минуту: мышью
// по всему месяцу при «Любом специалисте» уходило 63 запроса к Altegio за 11 с, а лимит Altegio (5 в секунду) общий с ботом
// (проверка 22.10.2026). Выбор дня спрашивает время всегда
var HOV=6;
function onOver(e){var c=closest(e.target,'.wbk-c');if(c!==S.hov){S.hov=c;clearTimeout(S.hovT);if(c)overDay(c,180);}}
function overDay(c,ms){
 var d=ga(c,'data-date');
 if(ga(c,'aria-disabled')==='true'||d===S.date)return;
 clearTimeout(S.hovT);S.hovT=setTimeout(function(){
  if(!isOpen||S.step!=='time')return;
  var now=Date.now();
  S.hv=(S.hv||[]).filter(function(t){return now-t<60000;});
  if(S.hv.length<HOV&&prefetch(d))S.hv.push(now);
 },ms);
}
// время — одна остановка Tab, дальше стрелками, как календарь (проверка 22.10.2026: от первого времени до «Дальше» было 22 нажатия Tab).
// ← → — соседнее время, ↑ ↓ — тот же столбец в ряду выше или ниже (и в соседней группе «Утро / День / Вечер»), Home/End — первое и последнее
function tMove(t,k){
 var all=qa('.wbk-t',cur),i=all.indexOf(t);
 if(i<0)return null;
 if(k==='Home')return all[0];
 if(k==='End')return all[all.length-1];
 if(k==='ArrowLeft')return all[i-1]||null;
 if(k==='ArrowRight')return all[i+1]||null;
 var dn=k==='ArrowDown',r=t.getBoundingClientRect(),box=all.map(function(b){return b.getBoundingClientRect();}),ty=null,n=null,bd=1e9,j,y,d;
 for(j=0;j<all.length;j++){y=box[j].top;if(dn?y>r.top+4&&(ty===null||y<ty):y<r.top-4&&(ty===null||y>ty))ty=y;}
 if(ty===null)return null;
 for(j=0;j<all.length;j++)if(Math.abs(box[j].top-ty)<4){d=Math.abs(box[j].left-r.left);if(d<bd){bd=d;n=all[j];}}
 return n;
}
function onKey(e){
 if(e.key==='Escape'||e.key==='Esc'){e.preventDefault();return close();}
 if(e.key==='Tab'){
  var f=qa('a[href],button:not([disabled]),input:not([tabindex="-1"]),select,textarea,[tabindex="0"]',panel).filter(function(el){
   return el.tabIndex>=0&&!closest(el,'[hidden],.wbk-hp')&&(el.offsetWidth||el.offsetHeight)&&getComputedStyle(el).visibility!=='hidden';
  });
  if(!f.length)return;
  var a=D.activeElement,first=f[0],last2=f[f.length-1];
  if(e.shiftKey&&(a===first||!panel.contains(a))){e.preventDefault();last2.focus();}
  else if(!e.shiftKey&&(a===last2||!panel.contains(a))){e.preventDefault();first.focus();}
  return;
 }
 var tb=closest(e.target,'.wbk-t');
 if(tb&&/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(e.key)){
  e.preventDefault();
  var nt=tMove(tb,e.key);
  if(nt){tb.tabIndex=-1;nt.tabIndex=0;nt.focus();}
  return;
 }
 var c=closest(e.target,'.wbk-c');
 if(c&&/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)){
  e.preventDefault();
  var n=calMove(ga(c,'data-date'),e.key);
  if(!n)return;
  if(mon(n)!==S.cm){S.cm=mon(n);S.auto=false;calUpd(n);datesFor(S.cm);}
  else{var b=q('.wbk-c[data-date="'+n+'"]');if(b){c.tabIndex=-1;b.tabIndex=0;b.focus();}}
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
// намерение записаться (наведение, касание, фокус на кнопке записи) — ближайшее время и дни мастеров заранее
function intent(e){var a=closest(e.target,'[data-book]');if(a&&S.api==='ok'&&!(root&&root.contains(a)))nearLoad();}
D.addEventListener('pointerover',intent,{passive:true});
D.addEventListener('touchstart',intent,{passive:true});
D.addEventListener('focusin',intent);
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
