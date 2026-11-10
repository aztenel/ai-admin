# План Meta по ТЗ Winchester v4 §5 («Meta в пульте»)

> Перенесено из рабочих заметок сессии 10.11.2026, чтобы не потерять при остановке. Состояние работ — раздел 0.
> Ссылки вида `файл:строка` — на код до шагов 1–2; строки сдвигаются, ищи по имени функции.
> Репозиторий публичный: ключей, номеров клиентов и личных данных здесь нет.

## 0. Состояние на 10.11.2026

Всё — только в ветке `dev` и на заглушках. На боевой сайт ничего из этого не выкладывалось, вживую не проверялось.

| Шаг | Состояние |
|---|---|
| 1. Заглушка Meta Graph и помощники подписанных вебхуков для проверок | сделан: `b057b26`, правки двух проверок — `5c7255c`, `d402025` |
| 2. Конфигурация и адаптер Graph: чтение и запись, номер, WABA, список и подача шаблонов | сделан: `bd11df2`, правки первой проверки — `5024c11`; повторная проверка «правильность» не закончена (у помощника кончился предел), проверка «безопасность» находок не дала |
| 3. Изоляция компании на /wa/<id> и отметка последнего события Meta | не начат |
| 4. Реестр шаблонов Meta: кэш статусов, генератор из сценариев, проверка правил Meta, привязка и API | не начат |
| 5. Отправка шаблона с номером сообщения, классы ошибок Meta, общий счётчик предела; «неизвестно» в рассылках Meta | не начат |
| 6. Выбор канала у сервисных сценариев и их отправка через Meta | не начат |
| 7. Рекламные сценарии (день рождения, реактивация) и проверка на свой номер через Meta | не начат |
| 8. Пульт «Автоматические сообщения»: канал сценария и статус шаблона Meta | не начат |
| 9. Чаты номера Meta: маршрут ответа, старые чаты Wazzapo, окно 24 часа, подпись номера | не начат |
| 10. Ответ из пульта через Meta: одна отправка и «неизвестно, ушло ли» | не начат |
| 11. Галочки Meta и полнота входящих (реакции, цитаты, неподдерживаемые), бот молчит | не начат |
| 12. Рассылки по базе через Meta: сервер (шаблон, подстановки, проверка, тест, запуск, итоги) | не начат |
| 13. Пульт: тот же мастер рассылки с каналом Meta | не начат |
| 14. Контроль номера Meta: качество, предел, сигналы в Telegram и push | не начат |
| 15. Подключение: «Проверка запуска» и /diag для номера Meta | не начат |
| 16. Инструкция владельцу по подключению Meta и документы | не начат |

Как продолжать: повторить проверку шага 2 (правильность), затем шаги 3–16 по порядку — сначала тесты на заглушке
`test/meta.mjs`, потом код, две независимые проверки (правильность и деньги; безопасность и изоляция компаний), правки.
Каждый шаг — отдельный коммит в `dev`, полный набор проверок перед коммитом (`node --test test/unit/*.test.mjs`,
`npm test`, `npm run check:types`, `npm run check:boundaries`; при правке пульта — `npm run build:app`, `check:app`, e2e).

Решения владельца, принятые по умолчанию (владелец может поменять):
- Согласие на рекламу через Meta. Оставить как у второго номера (у Winchester с 03.11.2026 рекламу получают все, кто не отказывался) или через Meta писать только тем, кто подтвердил согласие? Правила Meta требуют согласия, а жалобы снижают качество и предел номера. По умолчанию — как у второго номера, но первая рассылка не больше 50 человек.
- Если Meta пометит номер за жалобы (FLAGGED) или качество станет жёлтым: останавливать только рекламу или ещё и сервисные сообщения (подтверждение записи, напоминания), если они уже переключены на Meta? По умолчанию — только рекламу.

## 1. Итог разбора

ПТЗ на ТЗ Winchester v4 §5 («Meta в пульте»). Это только чтение: код не менялся, вживую ничего не проверялось. Утверждения карт участков я сверил с кодом выборочно, по местам, на которые опирается план, и расхождений не нашёл.

Что уже есть:
- вебхук /wa/<id> с подписью APP_SECRET_<ID> (src/controllers/webhooks/meta.js:285-295);
- разбор входящих, бот на wa молчит (waOff, src/config/builtin-clients.js:175);
- ответ из пульта внутри 24 часов (src/controllers/inbox.js:211-215);
- отправка шаблона с позиционными подстановками (src/services/integrations/meta/templates.js:19-34);
- качество и предел номера (src/services/broadcast/sender.js:122-134, quality.js);
- сигналы Meta (src/services/broadcast/holds.js:57-117);
- запрет отправки на черновике (src/lib/stage.js).

Чего нет:
- Пульт не видит шаблонов Meta: нет списка, нет статусов, нет WABA. Привязки «сценарий → шаблон» тоже нет.
- У автоматических сообщений нет выбора канала. Без Green-API журнал вообще не читается (src/services/reminders/journal.js:267-268).
- Рассылка по базе Meta не умеет подставлять данные клиента (src/services/broadcast/create.js:104-109). При 5xx Meta получатель возвращается в очередь, а это двойная отправка (sender.js:349-352).
- Номер отправителя никак не сверяется с phone_number_id из вебхука (meta.js:222-224). Это риск для изоляции компаний.
- Профиль чата может «залипнуть» на старом номере Wazzapo (pn в src/services/channels/index.js:113), и ответ уйдёт с него.
- Галочек Meta нет: обрабатываются только отчёты failed (meta.js:216-221). У wa нет «неизвестно, ушло ли» и атомарной отметки отправки (src/services/inbox/send.js:158-160).

Каков план. 16 шагов, у каждого сначала тесты на заглушках, каждый можно выложить отдельно:
1. Основа: заглушка Graph, адаптер (чтение и запись с запретом на черновике), изоляция /wa/<id>, реестр шаблонов с генератором и проверкой правил Meta, отправка шаблона с wamid и классы ошибок Meta.
2. Выбор канала у сервисных и рекламных «Автоматических» и пульт для них.
3. Чаты: маршрут, старые чаты, подпись, «неизвестно», галочки.
4. Рассылки по базе через Meta: сервер и тот же мастер.
5. Контроль номера и «Проверка запуска».
6. Инструкция владельцу и документы.

По умолчанию у всех сценариев остаётся Green-API, и его поведение не меняется. Перехода между каналами сам по себе не бывает ни в одну сторону. При смене канала сообщение не уходит второй раз: тот же ключ D1 send_claims в пространстве «ga» и те же отметки rms:.

Выкладка на боевой сайт в эту работу не входит.

## 2. Решения

### Номер Meta у Winchester

**Решение.** Один номер Meta на компанию: прямой Cloud API (WA_TOKEN_/APP_SECRET_/PHONE_NUMBER_ID_WINCHESTER), WA_VIA_WINCHESTER удаляется. Код Wazzapo не трогаем.

**Почему.** Так решено в ТЗ v4 §1. Ветку Wazzapo делят другие клиенты, её проверяют test/unit/wazzapo.test.mjs и broadcast-wazzapo.test.mjs. Пока WA_VIA задан, отправка, шаблоны и качество уходят в Wazzapo (src/services/channels/meta.js:25, channels/templates.js:15, sender.js:124).

### Новые переменные

**Решение.** Только две, обе Text: WABA_ID_<ID> (для шаблонов, проверки компании и изоляции сигналов) и необязательная WA_SINCE_<ID> (отсечка старых чатов wa, формат как у GA_SINCE). Главный выключатель REMIND_GA_<ID> общий для обоих каналов.

**Почему.** Владельцу меньше настроек. Разбор времени переиспользуем из gaSince (src/services/inbox/lines.js:17-27). Отдельный выключатель для Meta не нужен: каждый сценарий переключает сам владелец.

### Изоляция компаний на /wa/<id>

**Решение.** Если задан PHONE_NUMBER_ID_<ID>, сообщения и отчёты с другим metadata.phone_number_id отбрасываются: ответ 200 и один сигнал в Telegram. Если задан WABA_ID_<ID>, так же отбрасываются сигналы с другим entry.id. В пульте показываются и привязываются только шаблоны с префиксом «<id>_».

**Почему.** Сейчас подписанное событие с любым номером превращается в чат Winchester, и ответ уходит с чужого pnid (meta.js:222-224, client.js:11). WABA портфолио Bot Flow могут делить и другие клиенты. Образец — проверка idInstance у Green-API (src/controllers/webhooks/greenapi.js:52).

### Выбор канала у сценария

**Решение.** Новое поле msgset:<id>.s[<сценарий>].ch: "ga" или "meta", без поля — "ga". Меняет только владелец через POST /api/msg/auto {id, ch}. Канал берётся в момент отправки, а не при планировании.

**Почему.** ТЗ §5.3: по умолчанию Green-API, переключать по одному сценарию. Существующие настройки (src/services/automsg/catalog.js:81-98) и тесты не меняются.

### Сам переход между каналами

**Решение.** Никогда. Если выбран Meta, а Meta не готова (нет шаблона, номер на паузе, предел), сообщение ждёт или пропускается с причиной в журнале сценария, плюс один сигнал в Telegram. Со второго номера оно не уходит.

**Почему.** Это прямое требование задачи. Иначе клиент получил бы сообщение не с того номера, который выбрал владелец.

### Двойная отправка при смене канала

**Решение.** Отметка D1 send_claims для автоматических сообщений остаётся в пространстве "ga" с прежним ключом a-<вид>-<запись>-<версия>, a-bd-…, a-ra-… (src/services/reminders/journal.js:642-645, marketing.js:190). Отметки KV rms:<id>:ga:… (src/db/kv/reminders.js:90-108) остаются прежними.

**Почему.** Одно и то же сообщение не уйдёт по двум каналам. Отметки, сделанные до выкладки, продолжают действовать.

### Сервисные через Meta и окно 24 часа

**Решение.** Если клиент писал на номер Meta меньше 23 ч 30 мин назад (и после WA_SINCE), уходит обычный текст одобренного варианта. Иначе — Utility-шаблон. Если текст получил 131047, внутри той же отметки один раз отправляем шаблоном.

**Почему.** ТЗ §5.2. Запас 30 минут защищает от 131047 на границе окна. Обычный текст в окне бесплатный и совпадает с утверждённым текстом.

### Реклама через Meta

**Решение.** Всегда Marketing-шаблон, даже внутри окна. Это касается и автосценариев (день рождения, реактивация), и рассылок.

**Почему.** Одинаково для всех получателей, у Meta есть кнопка отказа, правила категорий соблюдаются, проверять проще.

### Форма шаблонов

**Решение.** Параметры именованные (parameter_format named), имя шаблона «<id>_<сценарий>_v<версия текста>», язык пока только ru. В сервисных шаблонах нет имени клиента. Рекламные автосценарии подаются парой: с именем и без. 28 текстов библиотеки подаются как есть, без параметров, с кнопкой быстрого ответа «Стоп».

**Почему.** Meta не принимает пустой параметр, переменную в начале или в конце тела и куски [[…]] (S01 b2 кончается {детали}, S12 b3 начинается с имени: src/services/reminders/templates.js:31-131). Новая версия текста — новый шаблон, одобрения не путаются. У текстов W01–W28 переменных нет (src/services/broadcast/library.js:43). Казахский не проверен носителем.

### Нет данных для шаблона

**Решение.** Если пуст обязательный параметр (нет мастера, ссылки short_link и т.п.), шаблон не отправляем: пропуск с причиной, к Graph не обращаемся. Заглушка «—» из bcParam (templates.js:10) в новых сервисных шаблонах не используется.

**Почему.** «Барбер: —» хуже, чем ничего. Переключаться на Green-API нельзя.

### Как шаблон попадает в Meta

**Решение.** Два пути. Владелец нажимает «Подать в Meta»: система показывает точный текст и отправляет POST /{WABA}/message_templates. Или владелец привязывает шаблон, созданный в WhatsApp Manager с префиксом. Подача работает только на боевом сайте (на черновике metaWrite отвечает 409).

**Почему.** Для подачи нужно право whatsapp_business_management. Владелец видит текст до подачи, поэтому отдельный вопрос о формулировках не нужен.

### Откуда пульт знает статус шаблона

**Решение.** Главный источник — чтение списка шаблонов (кэш wat:<id>, мягкое обновление раз в 10 минут, кнопка «Обновить» у владельца). Вебхуки статуса, качества и смены категории только ускоряют обновление. В пульте разные подписи: «Текст одобрен владельцем» и «Шаблон одобрен Meta».

**Почему.** Вебхуки шаблонов приходят на уровне WABA и приложения и могут не дойти. Слово «одобрено» сейчас значит «одобрено владельцем» (apps/pult/src/campaigns/Library.tsx:342-343).

### «Неизвестно, ушло ли» у Meta

**Решение.** Обрыв связи, срок, 408, 499, 5xx и 131000 считаются «неизвестно»: второй раз не шлём, в переписке st:unknown с причиной. Так везде: пульт, автоматические, рассылки Meta.

**Почему.** Так же сделано для Green-API 01.11.2026 (journal.js:597-612). В рассылках Meta сейчас 5xx возвращает получателя в очередь (sender.js:349-352), и он может получить платный шаблон дважды.

### Пределы и паузы

**Решение.** У каждого канала свои паузы (jrhold:<id> и jrhold:<id>:wa), счётчики дня, «стоп» прохода и предел в минуту (Green-API 2, Meta 10). Все шаблоны Meta (рассылки, сервисные, реклама) делят один счётчик bcq:<id> против предела номера. Реклама берёт не больше 80% предела минус уже отправленное. Текст внутри окна в предел не считается.

**Почему.** Meta считает получателей шаблонов за скользящие сутки, сейчас предел 250. Если сервисных не учитывать, рассылка упрётся в 131048 или снизит уровень номера.

### Качество номера

**Решение.** Рекламные автосценарии через Meta работают только при GREEN. Ручную рассылку при UNKNOWN (новый номер) можно запустить только с явным подтверждением владельца, при YELLOW и RED — нельзя. Пометка FLAGGED останавливает только рекламу. Ошибки уровня аккаунта (190, 368, 131031, 131048…) останавливают все отправки Meta на 6 часов.

**Почему.** У нового номера качество «нет данных» (ТЗ §1): строгий GREEN не дал бы запустить первую рассылку. Сервисные письма о записи нужны клиенту, а жалобы вызывает реклама.

### Согласие на рекламу

**Решение.** Через Meta действуют те же правила, что у второго номера: marketingGate, 30 дней между рекламой, «стоп», запись, визит меньше 14 дней назад. Отметки bcm: и bdg: общие для обоих каналов. Первая рассылка через Meta — по умолчанию не больше 50 человек.

**Почему.** Правила уже есть (src/services/crm/segments.js:63-78). Реклама через Meta закроет рекламу со второго номера на 30 дней, и наоборот.

### Подпись номера в пульте

**Решение.** У Winchester lines.wa = «WhatsApp Meta», рядом номер из Meta (display_phone_number из вебхука или Graph в ln:<id>; ln: дописывается, а не перезаписывается). Основной телефон +7 700 505 05 03 в пульт не подключаем.

**Почему.** Сейчас там «Основной WhatsApp» и «Ответ уйдёт с основного номера» (src/config/builtin-clients.js:157, apps/pult/src/data/live.ts:61, apps/pult/src/inbox/Composer.tsx:21), а это телефон администраторов.

### Старые чаты wa

**Решение.** WA_SINCE_<ID> плюс сравнение p.pn с PHONE_NUMBER_ID_<ID>. Если чат старый, ответ закрыт с объяснением. waRoute для компании со своим номером берёт pnid из переменной, а не из профиля.

**Почему.** p.pn «залипает» (src/services/channels/index.js:78, :113, src/services/conversation/orchestrator.js:234), и ответ ушёл бы на прежний pnid Wazzapo с новым ключом.

### Отправка из пульта на wa

**Решение.** Атомарная отметка D1 send_claims, если у адреса готова база (sendDb ok). Иначе прежняя защита память + KV: у других компаний D1 нет.

**Почему.** P1 аудита 31.10.2026 (src/services/inbox/send.js:226-258): KV не атомарен между экземплярами Worker.

### Черновик

**Решение.** Читать Graph на черновике можно. Любая запись (POST/DELETE) идёт только через metaWrite с запретом при STAGE=preview. Проверка в тестах ловит любые не-GET запросы к Graph, а не только запросы с телом.

**Почему.** Сейчас test/unit/audit-p0.test.mjs:206 пропустил бы DELETE без тела. Подача шаблона и подписка приложения — изменения настроек, необратимые.

### Где API

**Решение.** Каталог, подача и привязка шаблонов — /api/bc/meta/templates: GET для владельца и сотрудника, POST только владелец (добавить в OWNER_POST контракта). Канал сценария — /api/msg/auto. Подписка приложения на WABA — /api/launch/meta/subscribe, только владелец.

**Почему.** /api/bc/ и /api/launch/ уже под правилами контракта (test/contract/routes.mjs:154-157). /api/msg/ нужно добавить в PROTECTED отдельным коммитом.

### Мастер рассылок

**Решение.** Один мастер (GaWizard) с выбором канала для рассылок по базе. Старый Wizard Meta остаётся только для списков из Excel, подпись это объясняет. Стоимость считает пульт (common.ts:19, :109-113).

**Почему.** ТЗ §5.4: «тот же мастер». Не дублируем расчёт цены на сервере.

### Время окна в чате

**Решение.** p.li берём как min(сейчас, msg.timestamp) из вебхука.

**Почему.** При проигрыше журнала (до 3 суток) li сейчас завышено (meta.js:96, :180, :244): пульт считает окно открытым, а Meta отвечает 131047.

## 3. Шаги

### Шаг 1. Заглушка Meta Graph и помощники подписанных вебхуков для проверок

_объём: S_

Файлы: `test/meta.mjs`, `test/harness.mjs`, `test/unit/meta-stub.test.mjs`, `test/unit/audit-p0.test.mjs`

**Сначала тесты.**

test/unit/meta-stub.test.mjs:
- GET /{pnid}?fields=… возвращает display_phone_number, verified_name, quality_rating, whatsapp_business_manager_messaging_limit, status, name_status;
- GET /{waba}?fields=account_review_status,business_verification_status;
- /{waba}/subscribed_apps и /{waba}/phone_numbers;
- /{waba}/message_templates отдаёт 2 страницы через paging.next/after;
- POST message_templates возвращает {id, status: PENDING, category};
- POST /messages (text и template) возвращает messages[0].id и message_status;
- вставка отказов: {status, code}, «висит» до abort сигнала, бросает TypeError;
- net.reset() всё очищает.
В test/unit/audit-p0.test.mjs:206 noOut меняется на net.graph.filter(g => g.method !== 'GET').length === 0: все прежние проверки остаются зелёными.

**Что сделать.**

metaStub(net, {phone, waba, apps, numbers, templates, fail, hang}) строит net.graphReply-маршрутизатор по пути и методу. Сейчас заглушка на любой адрес Graph отвечает как на отправку (test/harness.mjs:228-233), а graphReply сбрасывается в reset (harness:67).

Помощники:
- metaSignal(S, path, field, value, {secret, entryId}) — подписанное событие сигнала;
- metaStatuses(S, path, statuses, {secret, pnid}) — отчёты о доставке.
Оба по образцу waPost (harness:319-327) и signal (test/platform.mjs:751-764).

Код сервера не меняется.

### Шаг 2. Конфигурация и адаптер Graph: чтение и запись, номер, WABA, список и подача шаблонов

_объём: M; зависит от шагов: 1_

Файлы: `src/config/env.js`, `src/services/integrations/meta/graph.js`, `src/services/integrations/meta/phone.js`, `src/services/integrations/meta/waba.js`, `src/services/integrations/meta/templates-api.js`, `src/services/integrations/meta/client.js`, `src/services/broadcast/sender.js`, `worker.js`, `CLAUDE.md`, `test/unit/meta-graph.test.mjs`

**Сначала тесты.**

test/unit/meta-graph.test.mjs:
- metaGet: зависший Graph завершается по сроку (ms параметром) с ошибкой «Meta не отвечает»; 429 и 5xx — один повтор, только у GET.
- metaWrite: при STAGE=preview возвращает {status:409, code:'preview'}, а в net.graph нет ни одного не-GET; ошибка без повтора.
- tplList читает 2 страницы и разбирает тело, именованные и позиционные параметры, кнопки и статусы.
- Ошибки 190, 10/200, 100 и 80008 возвращаются русской причиной. Строки ключа нет нигде в результате (JSON.stringify(res).includes(token) === false).
- metaPhone: лестница полей при коде 100 (как sender.js:128-129); TIER_250, TIER_2K и UNLIMITED разбираются; status и name_status на месте.
- Нет WABA_ID — понятная причина и ни одного вызова Graph.
- Компании A и B ходят каждая со своим ключом и WABA (проверка заголовка authorization).
Прежние проверки bcHealth не меняются (test/platform.mjs:516-519, test/unit/crm-broadcast.test.mjs:425).

**Что сделать.**

src/config/env.js — список META_VARS имён и видов: WA_TOKEN_<ID> секрет, APP_SECRET_<ID> секрет, PHONE_NUMBER_ID_<ID> Text, WABA_ID_<ID> Text, WA_SINCE_<ID> Text, WA_VIA_<ID> Text, VERIFY_TOKEN Text. Значений в нём нет. Исправить CLAUDE.md §3.5: файла env.js не было.

client.js — metaIds(env, cid) → {token, pnid, waba, hasSecret, via}. Ключ наружу не уходит. В WA_HINT добавить 10, 200, 80008.

graph.js:
- metaGet(env, token, path, {ms=8000}) — AbortSignal.timeout, один повтор GET при 429/5xx;
- metaWrite(env, token, method, path, body) — isPreview → {ok:false, status:409, code:'preview', error: PREVIEW_HOOK}, без повтора, 15 с.

phone.js — metaPhone с полями display_phone_number, verified_name, quality_rating, whatsapp_business_manager_messaging_limit, status, name_status, code_verification_status, platform_type, account_mode, throughput.

waba.js — metaWaba: сведения WABA, subscribed_apps, phone_numbers. Только GET.

templates-api.js:
- tplList — не больше 5 страниц по 100, внутренний вид {id, name, lang, status, category, quality, reason, pf, body, params, header, buttons};
- tplCreate — через metaWrite.

bcHealth (sender.js:122-134) вызывает metaPhone и сохраняет прежний вид ответа (у fetch сейчас нет срока, sender.js:125). Ветка Wazzapo без изменений.

Слой integrations подключает только config и lib (scripts/check-boundaries.mjs). В CLAUDE.md §3.2 — строки WABA_ID_<ID> и WA_SINCE_<ID>; шапка worker.js:10-14.

### Шаг 3. Изоляция компании на /wa/<id> и отметка последнего события Meta

_объём: M; зависит от шагов: 1_

Файлы: `src/controllers/webhooks/meta.js`, `src/services/chatstore/wal.js`, `src/db/kv/meta.js`, `test/unit/meta-isolation.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-isolation.test.mjs. Окружение: WA_TOKEN_, APP_SECRET_, PHONE_NUMBER_ID_WINCHESTER='900333', WABA_ID_WINCHESTER='waba-w'; значения вымышленные.
- Сообщение с pnid '900999' → ответ 200, нет h:wa:winchester:*, нет POST в Graph, один Telegram «Meta прислала событие чужого номера» (повтор — без второго).
- То же при CHAT_STORE_WINCHESTER=d1 (d1With): нет записи ibq:.
- Совпадающий pnid → чат есть.
- Отчёты statuses и smb_message_echoes с чужим pnid пропускаются.
- account_update с entry.id ≠ WABA_ID → нет bchold:.
- Без PHONE_NUMBER_ID и WABA_ID — как сейчас: снимок контракта /wa/barber (test/contract/routes.mjs:83) не меняется.
- Неподписанное событие → 403.
- wahook:winchester пишется не чаще раза в 10 минут: {at, field, entry: entry.id}.

**Что сделать.**

handleWhatsApp (meta.js:201-225): ожидаемый pnid = PHONE_NUMBER_ID_<ID> (или waPhoneId). Change с другим value.metadata.phone_number_id пропускается целиком: messages, statuses, echoes, history. Сигналы (поле не messages) с entry.id ≠ WABA_ID_<ID> пропускаются, если WABA_ID задан.

waPart (src/services/chatstore/wal.js:47-73) получает ожидаемый pnid и не кладёт чужое в журнал.

handleWAClient (meta.js:285-295) после верной подписи пишет отметку wahookMark (память экземпляра + KV, 30 дней). Она нужна «Проверке запуска», номер клиента в неё не попадает.

Сигнал о чужом номере — notifyOnce с отметкой в KV wafg:<id>:<pnid> на сутки. В журнал Worker без номера клиента.

### Шаг 4. Реестр шаблонов Meta: кэш статусов, генератор из сценариев, проверка правил Meta, привязка и API

_объём: L; зависит от шагов: 2, 3_

Файлы: `src/db/kv/meta.js`, `src/services/meta/registry.js`, `src/services/meta/spec.js`, `src/services/meta/fit.js`, `src/services/broadcast/holds.js`, `src/controllers/broadcast.js`, `src/services/broadcast/deps.js`, `test/contract/routes.mjs`, `test/contract/routes.snap.json`, `test/unit/meta-templates.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-templates.test.mjs.

(1) Чистые функции:
- снимок toMetaSpec для каждого слота s01, d1, h2, s06, cx, rv, bi, bo, bd, ra и W01: категория, именованные параметры, примеры по числу параметров, ни одной переменной первой или последней, нет { } [ ];
- metaLint ловит переменную в начале и в конце, соседние переменные, остаток [[, тело больше 1024 знаков, 3 URL-кнопки;
- матрица fits(): не та категория, PENDING, REJECTED, PAUSED, лишний и недостающий параметр, нет языка, текст изменён после подачи — у каждого случая причина словами.

(2) API:
- GET /api/bc/meta/templates для сотрудника работает и не содержит ключа и WABA id;
- шаблон tayveno_x скрыт префиксом;
- POST submit отправляет в заглушку ровно ожидаемый JSON;
- submit на STAGE=preview → 409 preview и ни одного не-GET;
- сотрудник → 403, чужая компания → 403;
- bind шаблона без префикса → 400;
- refresh чаще раза в минуту → 429.

(3) Вебхуки:
- APPROVED, REJECTED (с rejection_info.reason), PAUSED и template_category_update правят wat: без вызова Graph;
- без подписи — не применяются;
- REJECTED у kk не трогает ru.

(4) Контракт: новые строки и UPDATE=1. Расширение PROTECTED на /api/msg/ — отдельным коммитом с разбором разницы.

**Что сделать.**

Хранилище:
- wat:<id> = {at, list, err}, 7 дней. Обновление в полёте одно на экземпляр. Мягкое обновление, если записи больше 10 минут.
- wam:<id> = {slot: {name, lang:['ru'], params, nn?, v, var, id, at, by}}, без срока.

spec.js:
- берётся полная форма действующего варианта: все [[…]] остаются, их переменные становятся обязательными;
- {компания}, {адрес}, ссылка 2ГИС вписываются в текст;
- остальное становится именованными параметрами: service, barber, date, time, service_barber, details, rating, amount, balance;
- у d1 есть параметр day («завтра», «сегодня» или дата), потому что «завтра» зашито в S03 (src/services/reminders/templates.js:47), а выбор с сайта 12–168 ч тоже идёт видом d1 (src/services/reminders/journal.js:177-178);
- примеры берутся из SV_SAMPLE, без настоящих клиентов.

Тела ru:
- S01: «Вы записаны на услугу: {{service}}\nБарбер: {{barber}}\nДата: {{date}} в {{time}}.\nДетали: {{details}}\n\nЕсли нужно перенести или отменить, напишите сюда.»;
- S03, S04, S06, S07 — без имени, с концовкой «напишите сюда»;
- S12: «Благодарим за визит!\nВаш мастер {{barber}} порадуется отзыву о своей работе\nУслуга: {{service}}\n\nКонтроль качества: {{rating}}\n2ГИС: https://go.2gis.com/mrkUN»;
- S19 и S20 заканчиваются «Спасибо, что выбираете Winchester.»;
- bd и ra — пара: с {{name}} не первой переменной и вариант без имени;
- W01–W28 — текст как есть плюс QUICK_REPLY «Стоп».

fit.js — fits(slot, binding, tpl): APPROVED; UTILITY у сервисных, MARKETING у рекламных; язык есть; набор параметров совпал (у позиционных — по карте); версия и вариант текста те же, что при подаче (как approvalFits).

holds.js:70-80 дополнительно правит wat: по имени и языку. Новое поле template_category_update: шаблон сервисного сценария, переведённый в MARKETING, перестаёт подходить, и один сигнал в Telegram. Паузу по имени (h.tpl, holds.js:21) для рассылок не меняем.

Контроллер: GET и POST /api/bc/meta/templates через deps; POST только владелец, sameOrigin.

### Шаг 5. Отправка шаблона с номером сообщения, классы ошибок Meta, общий счётчик предела; «неизвестно» в рассылках Meta

_объём: M; зависит от шагов: 2_

Файлы: `src/services/integrations/meta/templates.js`, `src/services/channels/templates.js`, `src/services/broadcast/errors.js`, `src/db/kv/broadcasts.js`, `src/services/broadcast/sender.js`, `test/unit/meta-send.test.mjs`, `test/unit/crm-broadcast.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-send.test.mjs:
- sendTemplate возвращает {ok, id: wamid, held};
- готовые components (именованные параметры, параметр кнопки) передаются как есть;
- старые b.params работают как раньше (test/platform.mjs:581, :641 не меняются);
- 500, обрыв и 131000 → unsure;
- таблица metaKind по каждому коду;
- metaUse и metaUsed: слоты за скользящие сутки.

Дописать в test/unit/crm-broadcast.test.mjs:
- рассылка Meta, Graph 500 у второго получателя → b.unsure = 1, через 10 минут ему не шлём;
- код 0 → unsure, отметка bcm: стоит;
- шесть 131049 подряд → рассылка идёт, skipped 6.

**Что сделать.**

templates.js:19-34:
- ответ {ok:true, id: messages[0].id, held: message_status === 'held_for_quality_assessment'};
- если пришли b.components — они используются, иначе прежняя сборка из b.params;
- обрыв и срок → {ok:false, code:0, unsure:true}; статус ≥ 500 или код 131000 → unsure.
Ветка Wazzapo (channels/templates.js:14-20) передаёт id, если он есть.

metaKind(r) в src/services/broadcast/errors.js (слой services):
- unknown — 0, abort, 408, 499, ≥ 500, 131000, 2xx без id;
- window — 131047;
- recipient — 131026;
- mlimit — 131049, 130472;
- optout — 131050;
- temp — 4, 80007, 130429, 131056, HTTP 429;
- tpl — 132000, 132001, 132005, 132007, 132012, 132015, 132016;
- param — 100, 131008, 131009;
- account — 190, 368, 131031, 131048, 131042, 133010, 10, 200, 131005;
- preview — 409 или code 'preview'.

metaUse и metaUsed в db/kv/broadcasts.js: вынести логику слотов bcq:<id> из sender.js:248-252, :363-365.

bcTick (sender.js:335-361), ветка Meta:
- unknown → как у Green-API: b.unsure, done++, marked, реплика 'unknown', пауза 10 минут, без возврата в очередь;
- mlimit → b.skipped с причиной, не входит в streak.
Меняется и рассылка Meta других компаний: это безопаснее, проверяется контрактом и золотыми переписками.

### Шаг 6. Выбор канала у сервисных сценариев и их отправка через Meta

_объём: L; зависит от шагов: 4, 5_

Файлы: `src/services/automsg/catalog.js`, `src/db/kv/automsg.js`, `src/services/automsg/channel.js`, `src/services/inbox/lines.js`, `src/services/automsg/index.js`, `src/services/reminders/journal.js`, `src/services/reminders/info.js`, `src/db/kv/reminders.js`, `test/automsg.mjs`, `test/unit/automsg-channel.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/automsg-channel.test.mjs.

Настройка канала:
(1) Без ch — только Green-API, net.graph пуст. Прогон journal-remind.test.mjs и automsg.test.mjs без изменений.
(2) {id:'confirm', ch:'meta'} от владельца:
- без WA_TOKEN → 409 meta_off;
- с WA_VIA_WINCHESTER=wazzapo → 409 meta_wz;
- без подходящего шаблона → 409 meta_tpl;
- пауза jrhold:<id>:wa или качество RED → 409 meta_hold;
- компания не подтверждена Meta → 409 confirm, повтор с sure проходит;
- в журнале сценария «канал: Meta».
(3) Сотрудник → 403.
(4) GET /api/msg/auto отдаёт ch, chs.ga, chs.meta {ok, why, tpl} и сводку meta.

Отправка:
(5) Окно открыто (клиент писал 1 час назад в h:wa:) → один POST type:text, нет вызовов Green-API, реплика в h:wa с mid и st:sent.
(6) Окна нет → template с точными именованными параметрами из записи журнала.
(7) Текст получил 131047 → один шаблон, одна отметка.
(8) Пустой details → пропуск, Graph не вызывается.
(9) Отправлено через Green-API, сценарий переключили на Meta, журнал прочитан снова → Meta не шлёт (D1 send_claims; и при потерянной rms:).
(10) Общий env.WA_TOKEN без WA_TOKEN_WINCHESTER → Meta не готова.
(11) В профиле pn старого номера → в адресе POST стоит PHONE_NUMBER_ID_WINCHESTER.
(12) WA_SINCE позже li → шаблон; li = сейчас − 23 ч 45 мин → шаблон.

Классы ошибок по metaKind:
(13) 500 → unknown, без повтора;
(14) 131026 → задача в h:wa (need send), один Telegram;
(15) 131056 → повтор через минуту, после 3 раз задача;
(16) 368 → jrhold:winchester:wa, при этом Green-API в том же проходе отправляет;
(17) 132015 → пауза шаблона, другой сценарий Meta уходит;
(18) 131050 → «стоп».

Пределы:
(19) Два сценария на разных каналах: за минуту 2 через Green-API и до 10 через Meta.
(20) qual.limit 250 и использовано 245 → шаблоны стоят с причиной, текст в окне уходит.
(21) Green-API не подключён, сценарий на Meta → проход идёт.
(22) Вне часов отправки — ничего.
(23) jrDry показывает ch, how и tpl, ничего не записывая.

**Что сделать.**

catalog.js:85-90: s[id] = {on, at, by, t, ch, chAt, chBy}, ch по умолчанию 'ga'.

channel.js:
- chOf(set, id);
- metaRoute(env, c) — {client, pnid: PHONE_NUMBER_ID_<ID>, quiet:true} только если есть WA_TOKEN_<ID> и PHONE_NUMBER_ID_<ID> и не wzOn. Общий env.WA_TOKEN/WA_CLIENT (src/services/channels/index.js:114) и p.pn не используются;
- metaReady(env, c, id) — маршрут, привязка из шага 4 с fits, bcHold.all (кроме src 'quality' для сервисных), jrhold:<id>:wa, qual: не RED, metaacct (для подтверждения);
- inWindow(p, now, since) — 23 ч 30 мин и li ≥ lineSince(env, cid, 'wa'). lineSince — обобщение gaSince (lines.js:17-27), у ga поведение прежнее.

journal.js:
- jrClient (:266-268): проход идёт, если готов хотя бы один канал включённого сценария;
- :335-350: свои у каждого канала PER_MIN (Green-API 2, Meta 10), набор остановленных, jrHold(cid или cid+':wa'), jrCount и jrcn с суффиксом ':wa'. Ключи Green-API не переименовываются.

jrSend (:511-640):
- переписка по каналу (h:wa: или h:ga:), «подтверждение уже в переписке» смотрит обе;
- Meta не готова → 'wait' и одна запись «канал Meta не готов: …, на второй номер не переключаем» плюс notifyOnce раз в день, пока не опоздало;
- в окне — sendWA тем же одобренным текстом svText;
- вне окна — sendTemplate с components из svVars(c, msgOf(x), lang) по параметрам привязки, все обязательные непусты;
- предел номера: metaUsed < лимит − 10% (лимит неизвестен — не больше 50 в сутки), удачный шаблон → metaUse;
- отметка: тот же sendOnceAuto(env, c.id, x.p, `a-${x.k}-${orec}-${ver}`) в пространстве 'ga' (:642-645) и тот же jrTry/jrUntry;
- ветвление по metaKind как в тестах, adminTask пишет в переписку своего канала;
- у реплики ch и tpl.

jrDry (:662-698) и journalInfo (info.js:50) показывают ch, how (text или template) и tpl.

autoChange — действие {id, ch} с проверками, autoInfo — блоки ch, chs и meta. Комментарий формата в db/kv/automsg.js:3-6.

### Шаг 7. Рекламные сценарии (день рождения, реактивация) и проверка на свой номер через Meta

_объём: M; зависит от шагов: 6_

Файлы: `src/services/automsg/marketing.js`, `src/services/automsg/index.js`, `test/unit/automsg-channel.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

Дописать в test/unit/automsg-channel.test.mjs:
- Winchester с gaNoBroadcast, birthday на Meta, MARKETING одобрен, qual GREEN → поздравление шаблоном уходит только клиенту с согласием (grantSnap из test/consent.mjs); без согласия — пропуск;
- qual YELLOW или пустой → включить нельзя, 409 locked с причиной;
- уже поздравлен через Green-API в этом году (bdg:) → через Meta не уходит;
- имени нет или оно сомнительное → шаблон без имени (nn), а если его нет — пропуск;
- 131049 → пропуск и отметка bcm:;
- 131050 → «стоп»;
- нажатие кнопки «Стоп» (type button) → «стоп» через stopSeen;
- autoTest ch:'meta': один POST на номер для проверки, номер из тела запроса игнорируется;
- тот же rid → dup;
- STAGE=preview → 409, net.graph пуст;
- без шаблона → 409 meta_tpl с текстом.

**Что сделать.**

mkLocked(env, c, id):
- для ga — bcGaOff, как сейчас (marketing.js:46);
- для meta — пусто, если привязан подходящий MARKETING-шаблон, qual GREEN, нет bcHold.all и jrhold:<id>:wa; иначе причина.

mkRun (:49-56) пропускает компанию, только если оба рекламных сценария закрыты. mkClient (:59-61) использует маршрут по каналу.

mkSend (:166-214), ветка Meta:
- всегда шаблон, параметры из dataFor/render (имя через normName);
- те же отметки sendOnceAuto a-bd-…, a-ra-…, те же bcm: и bdg:;
- счётчик и предел по каналу плюс metaUse;
- переписка h:wa:;
- разбор по metaKind.
Правила согласия не меняются.

autoTest (index.js:210-246):
- канал — ch сценария;
- окно по переписке h:wa:<номер для проверки>;
- вне окна шаблон на SV_SAMPLE или DEMO;
- порядок прежний: готовность → isPreview → 20 в час → sendOnceAuto(rid t-…);
- реплика test:1 в h:wa:;
- ошибки не ставят паузу номера, кроме ошибок аккаунта.

### Шаг 8. Пульт «Автоматические сообщения»: канал сценария и статус шаблона Meta

_объём: M; зависит от шагов: 6, 7_

Файлы: `apps/pult/src/model/campaigns.ts`, `apps/pult/src/data/live-campaigns.ts`, `apps/pult/src/data/demo-automsg.ts`, `apps/pult/src/data/source.ts`, `apps/pult/src/campaigns/AutoMessages.tsx`, `apps/pult/src/screens/Campaigns.tsx`, `apps/pult/scripts/e2e-automsg.mjs`, `test/devserver.mjs`, `pult-app.gen.js`

**Сначала тесты.**

apps/pult/scripts/e2e-automsg.mjs, телефон 390×844:
- Meta не готова → выбор канала неактивен с причиной сервера;
- готова и шаблон одобрен → подтверждение с текстом «в течение 24 часов — обычным текстом, позже — шаблоном «…», Meta берёт плату», после сохранения у карточки значок «Meta», ушёл POST {id, ch:'meta'};
- у сотрудника выбора и кнопок «Подать в Meta» нет;
- отклонённый шаблон показывается с причиной;
- в листе проверки «С какого номера» — номер Meta.
Вкладка «Meta»: список шаблонов со статусом, категорией и качеством.
Демо-данные содержат каждый статус.

**Что сделать.**

Модель:
- у сценария ch ('ga' или 'meta', незнакомое → 'ga') и chs {ga, meta: {ok, why, tpl: {name, status, category} | null}};
- в AutoMessages блок meta {ready, phone, why, quality, limit, used, hold};
- AutoMsgPatch {id, ch}, у AutoMsgTestResult поле ch.

Экраны:
- EditSheet (AutoMessages.tsx:521): выбор «Второй WhatsApp / WhatsApp Meta (+7 702 …)» только у владельца;
- ScenarioCard (:311): значок канала, причина chs[ch].why, строки «Текст одобрен владельцем» и «Шаблон Meta: одобрен / на проверке / отклонён (причина) / приостановлен / Meta сменила категорию / шаблона нет»;
- у владельца кнопки «Подать в Meta», «Выбрать готовый», «Обновить статусы» (/api/bc/meta/templates);
- StatusCard (:223-264): номер Meta, качество, предел N, сегодня занято M, пауза;
- TestSheet (:733-787) и ConfirmText (:203-205): номер выбранного канала;
- вкладка Meta (Campaigns.tsx:364-395) вместо «неактивного канала» показывает реестр шаблонов.

После правок npm run build:app и npm run check:app.

### Шаг 9. Чаты номера Meta: маршрут ответа, старые чаты Wazzapo, окно 24 часа, подпись номера

_объём: M; зависит от шагов: 3, 6_

Файлы: `src/services/channels/index.js`, `src/controllers/webhooks/meta.js`, `src/services/conversation/orchestrator.js`, `src/services/inbox/lines.js`, `src/db/kv/inbox.js`, `src/controllers/inbox.js`, `src/config/builtin-clients.js`, `src/services/inbox/notify.js`, `apps/pult/src/data/live.ts`, `apps/pult/src/inbox/Composer.tsx`, `apps/pult/src/screens/Settings.tsx`, `test/unit/old-line.test.mjs`, `test/unit/meta-chats.test.mjs`, `apps/pult/scripts/e2e-inbox.mjs`, `CLAUDE.md`

**Сначала тесты.**

Дописать в test/unit/old-line.test.mjs:
(1) Чат wa с li раньше WA_SINCE_WINCHESTER → /api/inbox/chat отдаёт sendOff = OLD_WA_LINE; /send → 409 oldline, net.graph пуст.
(2) В профиле pn='old-wz-pnid' → ни одного POST на /old-wz-pnid/.
(3) Клиент написал снова через новый pnid → ответ уходит на …/<PHONE_NUMBER_ID_WINCHESTER>/messages.
(4) Без WA_SINCE и при совпадающем pn — как раньше.

test/unit/meta-chats.test.mjs:
- ветка «бот выключен» и медиа пишут p.pn и перезаписывают его;
- li = время сообщения: проигрыш журнала с timestamp 30 часов назад → окно закрыто;
- /api/inbox/list?v=2 отдаёт lines.wa {label:'WhatsApp Meta', phone} и сохраняет lines.ga;
- сообщение в Telegram называет «WhatsApp Meta».

В e2e-inbox.mjs над полем ввода: «Ответ уйдёт с номера WhatsApp Meta …».

**Что сделать.**

waRoute (channels/index.js:111-116): если у компании есть PHONE_NUMBER_ID_<ID>, pnid берётся из него; p.pn задан и не совпадает → null (чат старый). Общий режим без изменений.

p.pn = wx.pnid пишется в ветке «бот выключен» (meta.js:94-98) и в медиа (:170-182) и перезаписывается: channels/index.js:78, orchestrator.js:234.

li = min(now, +msg.timestamp*1000): ts передаётся в wx из handleWAMessage, используется в :96, :180, :244.

lines.js:
- oldWaChat(env, cid, p) = (lineSince > 0 && !(p.li ≥ since)) || (p.pn && pnNow && p.pn !== pnNow);
- OLD_WA_LINE: «Это переписка прежнего номера: ответ ушёл бы клиенту уже с нового номера Meta. Ответьте с телефона».

inbox.js:141-152, 189-190, 300-301, 366-367: oldLine и sendOff распространяются на wa (send, done, delete).

ln:<id> дописывается, а не перезаписывается (linesSave, db/kv/inbox.js:9): {wa, waAt} из metadata.display_phone_number и qualityFetch.

Подписи:
- builtin-clients.js:157 — lines.wa = 'WhatsApp Meta';
- пульт: lineName и FROM (live.ts:61, Composer.tsx:21, Settings.tsx:316-322), текст закрытого окна (live.ts:212) без слов «основной номер»;
- Telegram при выключенном боте (meta.js:100) пишет подпись линии.

После правок npm run build:app.

### Шаг 10. Ответ из пульта через Meta: одна отправка и «неизвестно, ушло ли»

_объём: M; зависит от шагов: 5_

Файлы: `src/services/inbox/send.js`, `src/controllers/inbox.js`, `test/unit/meta-chat-send.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-chat-send.test.mjs:
- net.graphReply бросает TypeError → POST /api/inbox/send 200 с warn и st unknown;
- повтор с тем же rid → нового POST нет;
- sendOnceReset() (новый экземпляр) + D1 (d1With) + тот же rid → нового POST нет;
- 500 → unknown;
- 400 {error:{code:131047}} → 409 с подсказкой, повтор с тем же rid отправляет (отказ подтверждён);
- 130429 → отказ «подождите минуту»;
- без D1 — прежняя защита KV (у других компаний);
- STAGE=preview → 409, net.graph пуст;
- «Отправить клиенту и закрыть» с уже отправленным rid клиенту не пишет.

**Что сделать.**

sendOnce (send.js:158-160): у ch 'wa' sendOnceD1, если sendDb(env).state === 'ok'. Иначе прежний sendOnceKV, никаких nosetup для wa.

sendTo для wa (inbox.js:211-215):
- результат sendWA разбирается metaKind;
- unknown или брошенное исключение → {ok:true, unknown:true, se:'нет связи с Meta' | 'Meta ответила 500…'};
- temp → отказ «подождите минуту» (точно не ушло);
- остальное → отказ с текстом BC_HINT или WA_HINT.

sendWA сейчас при обрыве даёт ok:false (src/services/channels/meta.js:46-51): пульт считает это отказом и позволяет «Повторить», а сообщение могло уйти. Нарушение CLAUDE.md §5.2.

adminTurn уже пишет unknown и se (inbox.js:223-224).

### Шаг 11. Галочки Meta и полнота входящих (реакции, цитаты, неподдерживаемые), бот молчит

_объём: M; зависит от шагов: 3, 10_

Файлы: `src/controllers/webhooks/meta.js`, `src/services/inbox/status.js`, `src/controllers/inbox.js`, `test/unit/meta-status.test.mjs`, `test/unit/wa-off.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-status.test.mjs:
(1) Ответ из пульта → реплика с mid 'wamid.out.N'.
(2) metaStatuses delivered → st delivered, read → read; read раньше delivered → остаётся read.
(3) failed 131026 → st failed с подсказкой в se, push send_failed; повтор того же отчёта ничего не пишет (считать put в KV).
(4) Отчёт с чужим pnid пропускается (шаг 3).
(5) При CHAT_STORE_WINCHESTER=d1 — то же, плюс события msg_* в D1 с campaign_id из turn.bc.
(6) GET /api/bc/stats учитывает ch wa.
(7) Входящее с context.id нашего ответа → у реплики q.
(8) reaction на наш ответ → re='👍', need не появился, число реплик прежнее.
(9) type 'unsupported' → видимая реплика и need.

Дописать в test/unit/wa-off.test.mjs: для текста, медиа, реакции, unsupported и отчётов на /wa/winchester клиенту ничего (s.sentTo пуст), ИИ не вызывался.

**Что сделать.**

handleWhatsApp (meta.js:216-221), после фильтра pnid, для каждого val.statuses[]:
- applyStatus(env, `h:wa:${niche}:${recipient}`, st.id, st.status, failed ? `${code}: ${hint}` : '', t => turn = t) (src/services/inbox/status.js:56-66);
- turn найден → statStatus(env, niche, 'wa', id, turn, stOf(st.status), now);
- стало failed → failedPush;
- чат не создаётся: patchTurn вернёт nochat;
- прежний waFailed остаётся.

stOf понимает sent, delivered, read и failed Meta; deleted и warning пропускаются.

stFresh для wa и при D1 (inbox.js:148) — не трогаем: в D1 копия согласована.

handleWAMessage (:267-280):
- wx.msgId ставится всегда (mid в KV безопасен);
- msg.context.id → wx.qt = quoteOf;
- reaction → patchTurn(…, t => t.re = emoji), без новой реплики;
- unsupported, errors и прочее → реплика «[клиент прислал сообщение, которое WhatsApp не передал]» + inboundNeed + push;
- system customer_changed_number → chatAudit.
Бот при этом не вызывается.

### Шаг 12. Рассылки по базе через Meta: сервер (шаблон, подстановки, проверка, тест, запуск, итоги)

_объём: L; зависит от шагов: 4, 5, 11_

Файлы: `src/services/broadcast/create.js`, `src/services/broadcast/sender.js`, `src/services/broadcast/results.js`, `src/controllers/broadcast.js`, `test/unit/meta-campaigns.test.mjs`, `test/unit/pult-campaigns.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-campaigns.test.mjs.

/api/bc/check с ch 'wa' + segment 'pora' + APPROVED MARKETING + pv [client.first_name]:
- samples с телом шаблона и настоящим именем, номера маской, funnel как у второго номера;
- pv не по числу параметров → ошибка «число подстановок не совпадает»;
- PENDING, REJECTED, UTILITY, без префикса, не тот язык → ошибка;
- recipients из тела игнорируются;
- staff.name у клиента без мастера → excluded nostaff.

/create:
- хранит pv, msg, render, sel, drop;
- cap 1000 при пределе 250 → 400 «не больше 237».

bcTick:
- имя в базе изменилось → в теле Graph свежее имя;
- нет имени → fb;
- два bcTick одновременно (два env с общими KV и D1) → у каждого получателя ровно один POST;
- реплика в h:wa с mid и настоящим текстом;
- bcs: дописан.

/test для Meta:
- сотрудник → 403, 0 POST;
- нет номера для проверки → 409 notest;
- body.to чужой → POST на номер для проверки;
- тот же rid → один POST;
- preview → 409.

act start:
- без sure → 409 final {n, rest, cap, from, to, days, text, sample, quality, limit, used};
- другое n → снова 409;
- YELLOW → 409;
- UNKNOWN → 409 confirm, с qok → запущена;
- нет APP_SECRET_WINCHESTER → 409;
- шаблон стал PAUSED → 409;
- сотрудник → 403;
- без GA_BROADCAST_WINCHESTER Meta запускается, а второй номер — 409 ga_off.

Итоги: delivered и read из подписанных отчётов → results.delivered=1, read=1; повтор не удваивается.

**Что сделать.**

create.js:
- ch 'wa' — синоним прежнего '' (поле ch в рассылке не хранить: на b.ch === 'ga' опираются bcHoldFor и bcLog, holds.js:21, sender.js:102);
- metaText по образцу gaText (:63-76): шаблон из реестра (fits), pv — ключи из VARS (render.js:21-29) или {text} до 300 знаков без переводов строки, fb для имени;
- msg — тело шаблона с {{n}} → {{ключ}}, по нему render делает примеры и запись в переписку;
- строки получателей — gaRows (:149-158) для обоих каналов;
- cap для Meta ≤ floor(0,95 × qual.limit), при неизвестном пределе ≤ 240; по умолчанию в мастере 50.

sender.js:
- bcTick (:286-374) для Meta по базе: fresh-строки и значения на каждого получателя, components через sendTemplate;
- перед каждым шаблоном sendOnce(env, cid, 'wa', digits, 'bc-' + b.id);
- bcSentAdd и для Meta crm;
- перед порцией — qual: (RED или сигнал → stopFor);
- bcLog (:101-110) пишет настоящее тело с mid вместо «[Рассылка …]»;
- bcFinal (:176-195) — и для Meta.

broadcast.js:
- /api/bc/test для Meta (:172-189) — как у второго номера (:147-171): только владелец, set.test.p, rid, bcTestLog с каналом;
- act start (:206-256) для Meta crm проверяет по порядку: APP_SECRET_<ID>, шаблон по свежему чтению, качество (qualityGet не старше 6 часов, иначе qualityFetch), предел, затем итоговую аудиторию (условие :243 расширить до src crm любого канала);
- /api/bc/list (:63): main.warn (WA_VIA, нет APP_SECRET, нет WABA_ID), число годных шаблонов.

results.js (:22-31, :70-82): полные итоги для src crm любого канала.

### Шаг 13. Пульт: тот же мастер рассылки с каналом Meta

_объём: L; зависит от шагов: 12_

Файлы: `apps/pult/src/campaigns/GaWizard.tsx`, `apps/pult/src/campaigns/launch.tsx`, `apps/pult/src/campaigns/CampaignSheet.tsx`, `apps/pult/src/campaigns/Results.tsx`, `apps/pult/src/screens/Campaigns.tsx`, `apps/pult/src/model/campaigns.ts`, `apps/pult/src/data/source.ts`, `apps/pult/src/data/live-campaigns.ts`, `apps/pult/src/data/demo-campaigns.ts`, `apps/pult/scripts/dev-live.mjs`, `test/devserver.mjs`, `apps/pult/scripts/e2e-campaigns.mjs`, `pult-app.gen.js`

**Сначала тесты.**

apps/pult/scripts/e2e-campaigns.mjs, Chromium, телефон 390×844 и компьютер:
- выбор Meta виден только при подключённом номере и годном шаблоне;
- PENDING и REJECTED не выбираются;
- несовпадение числа подстановок не даёт «Далее»;
- предпросмотр с настоящим именем;
- на «Проверке» качество, предел, занято за сутки и стоимость;
- тест → «отправлено на ваш номер»;
- «Запустить» → лист итоговой аудитории со стоимостью и числом, повтор с sure;
- сотрудник видит «запускает владелец»;
- демо-режим.

**Что сделать.**

Шаг «Аудитория»: выбор «Второй WhatsApp · Green-API» или «WhatsApp Meta · +7 702 514 86 91».

Шаг «Сообщение» (Meta):
- список из src.metaTemplates(ws) с метками «Одобрен», «На проверке у Meta», «Отклонён (причина)», «Приостановлен»; выбрать можно только одобренный Marketing;
- тело пузырём (WaBubble);
- у каждой {{n}} — чип вставки (DEFAULT_VARS) или «свой текст», запасное значение имени;
- галочки «стоп» нет, предупреждение, если в шаблоне нет кнопки или строки отказа.

«Проверка» — та же воронка плюс блок Meta: QUALITY, предел, занято, предел в сутки до 0,95 × предела, costEstimate (common.ts:109-113).

«Тест» — src.campaignTest(ws, draft, rid) с каналом черновика: gaTest всегда ставит второй номер (live-campaigns.ts:384-391).

«Запуск» — LaunchControls получает line {kind: 'bot' | 'main'} вместо BotNumberState (launch.tsx:29-56); noBroadcast только у bot; для main проверки маршрута, APP_SECRET и качества, вопрос qok.

CampaignSheet (:159-276): черновик Meta по базе — через LaunchControls. Results (:90): подпись «отчёты Meta». Кнопка MetaPanel (Campaigns.tsx:261) открывает GaWizard с каналом main. Старый Wizard.tsx — только для списков, с подписью.

После правок npm run build:app и check:app.

### Шаг 14. Контроль номера Meta: качество, предел, сигналы в Telegram и push

_объём: M; зависит от шагов: 2, 3, 5_

Файлы: `src/services/broadcast/quality.js`, `src/services/broadcast/holds.js`, `src/services/notifications/push.js`, `src/controllers/broadcast.js`, `src/db/kv/meta.js`, `apps/pult/src/campaigns/Overview.tsx`, `test/unit/meta-health.test.mjs`, `test/unit/meta-signals.test.mjs`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-health.test.mjs, 10:03 по Астане, без WA_VIA:
- YELLOW + TIER_250 → один Telegram, второй проход дня — ни одного;
- TIER_2K → TIER_250 → «предел уменьшился»; TIER_250 → TIER_2K → «предел вырос — можно переключать сценарии по одному»;
- status FLAGGED или name_status DECLINED → Telegram;
- Graph не отвечает → проход завершается по сроку, ещё попытка в пределах 10:00–10:09, Telegram только если все не удались;
- все вызовы GET, ключа нет в тексте.

test/unit/meta-signals.test.mjs:
- phone_number_quality_update DOWNGRADE {current_limit:'TIER_250'} → qual.limit=250 и русский текст;
- UPGRADE → 2000;
- FLAGGED → bchold.all.src='quality', рассылка Meta на паузе, сервисный Meta идёт;
- UNFLAGGED снимает только паузу src quality;
- business_capability_update правит предел;
- account_review_update APPROVED/REJECTED и account_update VERIFIED_ACCOUNT → metaacct:winchester и Telegram;
- phone_number_name_update REJECTED с причиной;
- ACCOUNT_RESTRICTION → push channel_down;
- одно событие дважды → один Telegram (отметка KV);
- user_preferences stop → «стоп» и в D1 (stopRecord);
- неподписанное → 403, состояние не меняется.

/api/bc/list два раза за 10 минут → один GET в Graph, «занято» учитывает metaUse сервисных.

**Что сделать.**

qualityRun (quality.js:17-42) через metaPhone:
- qual:<id> = {quality, limit, tier, status, nameStatus, at};
- новые строки «Предел Meta вырос», «Номер в Meta в состоянии …», «Meta отклонила имя «…»»;
- отметка qch: ставится после удачного чтения; при ошибке её снимаем, чтобы в пределах окна была ещё попытка (сейчас неудача в 10:00 не повторяется, :27-28).

waSignal (holds.js:57-97), по полям с понятными текстами вместо сырых «key: value» (:92-96):
- phone_number_quality_update: FLAGGED → bcHoldEdit h.all = {at, why, src:'quality'}; DOWNGRADE и UPGRADE → qualityPatch предела;
- business_capability_update → предел;
- account_review_update и VERIFIED_ACCOUNT (сейчас только console.log, :84) → metaacct:<id> = {review, verified, at};
- phone_number_name_update → решение и причина.
Важные сигналы — с отметкой KV wasig:<id>:<поле>:<событие>:<значение> на сутки (notifyOnce помнит только в памяти, src/services/notifications/telegram.js:14). Серьёзное account_update → push channel_down с линией «номер Meta» (push.js:23-38). user_preferences и 131050 → ещё и stopRecord с источником 'meta' (holds.js:61-69, :110; sender.js:357).

/api/bc/list (broadcast.js:63): qual: моложе 10 минут переиспользуется, иначе qualityFetch; used = metaUsed. Пульт Overview (:126-175): «X из N за 24 часа».

### Шаг 15. Подключение: «Проверка запуска» и /diag для номера Meta

_объём: M; зависит от шагов: 2, 3, 4, 14_

Файлы: `src/controllers/launch.js`, `src/services/launch/deps.js`, `src/controllers/diag.js`, `src/routes/index.js`, `test/unit/meta-launch.test.mjs`, `test/contract/routes.mjs`, `test/contract/routes.snap.json`, `CLAUDE.md`

**Сначала тесты.**

test/unit/meta-launch.test.mjs, вход владельца, metaStub:
- все строки зелёные;
- нет VERIFY_TOKEN → ❌; VERIFY_TOKEN === LEADS_KEY → ❌ (значение не показывается);
- WA_VIA=wazzapo при прямом ключе → ❌ «уберите WA_VIA_WINCHESTER», ключа в ответе нет;
- после подписанного события «Последнее событие от Meta: N мин назад (messages)» и entry.id для сверки с WABA_ID; неподписанное отметки не даёт;
- subscribed_apps пуст → ❌ с подсказкой, нет права → «у ключа нет права whatsapp_business_management»;
- pnid нет в /phone_numbers → ❌;
- шаблоны по статусам;
- строка «бот на WhatsApp Meta выключен»;
- сотрудник → 403;
- preview: проверки GET работают, POST /api/launch/meta/subscribe → 409 'preview' и ни одного не-GET.

/diag владельца: строка номера Meta без значения ключа.
Контракт: строки для subscribe, UPDATE=1, разбор разницы.

**Что сделать.**

launch.js:103-127, строки по прямому Meta:
- секреты: WA_TOKEN_, APP_SECRET_;
- PHONE_NUMBER_ID_ и WABA_ID_ заданы;
- VERIFY_TOKEN задан и не равен LEADS_KEY: leadsKey подставляет VERIFY_TOKEN, если LEADS_KEY нет (src/services/auth/session.js:10);
- конфликт WA_VIA;
- адрес /wa/<id> и полный список полей подписки из общей константы META_FIELDS: messages, message_template_status_update, message_template_quality_update, template_category_update, phone_number_quality_update, phone_number_name_update, account_update, account_alerts, account_review_update, business_capability_update, user_preferences (сейчас подсказка просит только messages, :111);
- последнее событие (wahook:);
- номер (metaPhone: имя, name_status, status, качество, предел, account_mode);
- номер принадлежит WABA;
- проверка WABA и компании;
- подписка приложения;
- шаблоны;
- бот (BOT_WA).
Graph только через deps (сейчас контроллер сам зовёт fetch, :118).

POST /api/launch/meta/subscribe → metaWrite POST /{waba}/subscribed_apps: только владелец, sameOrigin, на черновике 409.

diag.js:40-57: по каждой компании с WA_TOKEN_<ID> одна строка (номер, качество, предел, статус) и ссылка на /launch?c=<id>.

### Шаг 16. Инструкция владельцу по подключению Meta и документы

_объём: M; зависит от шагов: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15_

Файлы: `docs/runbooks/winchester-meta.md`, `CLAUDE.md`, `docs/tz-winchester-v4.md`, `docs/handoff.md`, `docs/runbooks/keys-and-data.md`, `docs/runbooks/winchester-go-live.md`, `docs/winchester.md`, `docs/winchester-kairat-handoff.md`, `test/unit/meta-docs.test.mjs`

**Сначала тесты.**

test/unit/meta-docs.test.mjs, по образцу test/unit/go-live-d1.test.mjs:
- инструкция перечисляет ровно META_FIELDS;
- имена переменных совпадают с META_VARS (src/config/env.js) и с CLAUDE.md §3.2;
- адрес /wa/winchester;
- в docs и test нет строк вида /EAA[A-Za-z0-9]{20,}/ и других похожих на ключ.

**Что сделать.**

docs/runbooks/winchester-meta.md — простым русским, только имена переменных, с пометками «проверено вживую / не проверено». Набросок — в ownerInstruction.

Обновить:
- CLAUDE.md: шапка — ссылка на инструкцию; §2.2 — пункты Meta, в том числе убрать «У Meta/Wazzapo статусы в чат не пишутся»; §2.3 — ключи wat:, wam:, metaacct:, wahook:, wafg:, wasig:, jrhold:<id>:wa, jrc:<id>:wa:<день>, jrcn:<id>:wa:<день>; §3.2 — WABA_ID_<ID>, WA_SINCE_<ID>, пометка у WA_VIA_<ID>;
- docs/tz-winchester-v4.md §5 и §7 п. 6 — что сделано и на заглушках;
- docs/handoff.md:56-64, docs/runbooks/keys-and-data.md:27-31 («Сменить постоянный ключ Meta»), docs/runbooks/winchester-go-live.md:61, :74, docs/winchester.md:33-68, docs/winchester-kairat-handoff.md:83, :98-103.

Каждый предыдущий шаг уже правит CLAUDE.md в своей части (правило «документ в том же изменении»). Этот шаг — инструкция и сверка остального.

## 4. Переменные Cloudflare

- WA_TOKEN_WINCHESTER (Secret, уже есть) — заменить ключ Wazzapo постоянным ключом системного пользователя Bot Flow с правами whatsapp_business_messaging и whatsapp_business_management (второе нужно для списка и подачи шаблонов, проверки WABA и подписки приложения)
- APP_SECRET_WINCHESTER (Secret, уже есть) — «Секрет приложения» из настроек приложения Meta: без него вебхук /wa/winchester отвечает 403
- PHONE_NUMBER_ID_WINCHESTER (Text, уже есть) — ID номера +7 702 514 86 91; теперь обязателен: по нему отсекаются события чужих номеров и выбирается номер для ответов
- WABA_ID_WINCHESTER (Text, новая) — ID аккаунта WhatsApp Business: шаблоны, проверка компании, подписка приложения, изоляция сигналов
- WA_SINCE_WINCHESTER (Text, новая, необязательная) — когда подключён номер Meta («2026-11-10 12:00» по Астане, ISO-время или мс): в старых чатах wa ответ из пульта закрыт, окно 24 часа из старых чатов не считается
- VERIFY_TOKEN (Text, общая, уже есть) — пароль проверки адреса вебхука в кабинете Meta; должен отличаться от LEADS_KEY
- WA_VIA_WINCHESTER — удалить: пока она задана, отправка, шаблоны и качество номера идут через Wazzapo
- BOT_WA_WINCHESTER — не задавать (или 0): бот на номере Meta молчит, отвечает администратор
- REMIND_GA_WINCHESTER (Text, уже есть) — общий главный выключатель автоматических сообщений для обоих каналов, без изменений
- GA_BROADCAST_WINCHESTER (Text, уже есть) — касается только второго номера (Green-API), на рассылки через Meta не влияет
- TPL_REMIND_WINCHESTER / TPL_REVIEW_WINCHESTER — не задавать: старый путь напоминаний бота; сервисные по журналу берут шаблоны из реестра
- CHAT_STORE_WINCHESTER=d1 (Text, уже есть) — рекомендуется: без неё отчёты о доставке и входящие пишутся по копии KV, и одна запись может затереть другую

## 5. Риски

- Двойная отправка при смене канала. Если поменять ключ отметки или пространство «ga» (journal.js:644, marketing.js:190), одно и то же сообщение уйдёт и со второго номера, и через Meta. Это проверяет тест (9) шага 6, ключи переименовывать нельзя.
- Двойная отправка в рассылках Meta, пока не сделан шаг 5: 5xx и обрыв возвращают получателя в очередь (sender.js:349-352), и клиент получает второй платный шаблон. Шаг 5 стоит раньше всего остального, что связано с рассылками.
- Окно 24 часа. Время li завышено при проигрыше журнала (meta.js:96), а старые чаты Wazzapo хранят li и pn прежнего номера. Защищают запас 30 минут, WA_SINCE, сравнение pn и повтор шаблоном при 131047.
- Отказы Meta 131026, 131049, 131050 и 132xxx часто приходят позже, в отчёте statuses, хотя отправка ответила 200. Без шага 11 в счётчиках будет «ушло», а задачи администратору не появятся.
- Предел номера 250 в сутки общий для всех шаблонов. По сведениям Meta 2025 года предел может считаться на всё портфолио Bot Flow: тогда будущие клиенты в том же портфолио делят его. Вживую не проверено. Наш счётчик bcq: приблизительный, KV не атомарен.
- Meta может перевести Utility-шаблон в Marketing: дороже, с ограничениями частоты и требованием согласия. Фразы «будем рады отзыву», «захотите записаться снова» и ссылки openhc.kz и go.2gis.com рискованны. Сценарий через Meta тогда встаёт с сигналом в Telegram, на Green-API он сам не переходит.
- Неверный порядок или имена параметров дают 132000 на каждом сообщении и паузу шаблона. Поэтому шаблоны, которые подаёт система, — с именованными параметрами. Ручную привязку позиционных проверяет fits().
- Опечатка в PHONE_NUMBER_ID_WINCHESTER или WABA_ID_WINCHESTER молча отбросит все сообщения. Защищают сигнал в Telegram о чужом номере и строки «Проверки запуска»: последнее событие, номер принадлежит WABA.
- Изоляция компаний. У приложения Meta один адрес вебхука. Если приложение Bot Flow станет общим для нескольких клиентов, нужен общий вход с разводкой по phone_number_id, а не /wa/winchester. Сейчас клиент один, это не мешает.
- Черновик. Любая запись в Graph (подача шаблона, подписка приложения) должна идти только через metaWrite. WA_TOKEN_WINCHESTER нельзя класть в переменные Previews. Тест noOut ловит не-GET запросы.
- Ключи. Ответы Graph с ошибкой содержат номер получателя: в журнал только через logSafe и maskPhone. Ключ и его начало нигде не показываются, сверяются только «да/нет» (diag.js:24).
- Поля вебхуков phone_number_quality_update, business_capability_update, account_review_update, phone_number_name_update, template_category_update и поле предела whatsapp_business_manager_messaging_limit взяты из документации Meta, вживую не проверены. Разбор терпимый, с прежним общим текстом как запасным.
- Сценарий FLAGGED не должен останавливать сервисные: пауза src 'quality' закрывает только рекламу. Ошибки аккаунта закрывают все отправки Meta на 6 часов.
- Шаг 5 меняет поведение рассылок Meta у других компаний: 5xx больше не повтор, а «неизвестно». Это безопаснее. Проверяется контрактом, золотыми переписками и test/platform.mjs.
- Расширение правил контракта на /api/msg/ может вскрыть старые расхождения в /api/msg и /api/contacts. Поэтому это отдельный коммит.
- Плата за шаблоны идёт с карты Кайрата, в том числе за пробы на свой номер вне окна. Это сказано в листах подтверждения пульта.
- Тексты Altegio слово в слово Meta не примет (переменная в конце или в начале тела). Шаблоны отличаются от действующих текстов второго номера. Владелец видит точный текст перед подачей.
- Отказ шаблона на kk останавливает рассылки и с ru: пауза по имени без языка (holds.js:21, :76). Пока подаём только ru, это не мешает.

## 6. Вне этой работы

- Выкладка на боевой сайт (main) и любые изменения в Cloudflare: только по слову владельца, отдельным шагом.
- Отправка файлов и голосовых и цитата из пульта на номер Meta (сейчас 409, src/controllers/inbox.js:166, :192). В §5.1 этого нет, можно сделать позже тем же путём send-file.
- Кнопка «Написать шаблоном» в чате при закрытом окне 24 часа. Пульт по-прежнему советует позвонить. Кнопку можно добавить позже на реестре из шага 4, если владелец попросит.
- «Удалить у всех» и отметка «прочитано» (синие галочки у клиента) для Meta.
- Казахские шаблоны: только после проверки текстов носителем, потом — тем же генератором.
- Ошибка текста «завтра» в S03 у второго номера при выборе клиента на сайте 12–21 ч и 48–168 ч (src/services/reminders/templates.js:47, src/services/reminders/journal.js:177-178). В шаблоне Meta она закрыта параметром day; для Green-API нужна отдельная маленькая правка, она меняет текущее поведение.
- Удаление шаблонов в Meta и обжалование смены категории.
- Старый пульт /inbox (pult/) и программа для Windows: новые подписи, статусы шаблонов и канал не получают.
- Общее приложение Meta для нескольких компаний и вход /wa/botflow с разводкой по номеру.
- Embedded Signup и самостоятельное подключение номера клиентом.
- Перенос пауз шаблонов на ключ «имя + язык» (holds.js:21): пока подаём только ru, не нужен.

## 7. Черновик инструкции владельцу (шаг 16)

Инструкция «Подключить номер Meta +7 702 514 86 91» (docs/runbooks/winchester-meta.md). Пишется простым русским языком, в ней только имена переменных, у каждого пункта пометка «проверено вживую / не проверено».

0. Что получится. Чаты номера +7 702 514 86 91 появятся в пульте с подписью «WhatsApp Meta». Бот там молчит, отвечает администратор, и только из пульта: приложения WhatsApp на телефоне у этого номера нет. Рассылки и автоматические сообщения по-прежнему идут со второго номера (Green-API), пока Meta не одобрит компанию и шаблоны. Потом вы переключаете сценарии по одному.

1. Что нужно заранее:
- вход администратором в портфолио Bot Flow (business.facebook.com);
- номер в WhatsApp Manager со статусом «Подключён»;
- карта Кайрата в оплате аккаунта WhatsApp;
- имя «Winchester Barbershop» одобрено.
Часть экранов Meta работает только на компьютере.

2. Приложение Meta (developers.facebook.com). Тип «Бизнес», портфолио Bot Flow, продукт WhatsApp. В разделе «WhatsApp → Настройка API» выпишите «ID номера телефона» и «ID аккаунта WhatsApp Business».

3. Постоянный ключ. Настройки компании → Пользователи → Системные пользователи → Добавить (роль Администратор). Затем «Назначить ресурсы»: приложение и аккаунт WhatsApp с полным доступом. Затем «Создать маркер»: это приложение, срок «Никогда», разрешения whatsapp_business_messaging и whatsapp_business_management. Ключ сразу вставьте в Cloudflare и больше никуда: ни в чат, ни в заметки.

4. Секрет приложения. Приложение → Настройки → Основное → «Секрет приложения».

5. Cloudflare → Workers → ai-admin → Settings → Variables and Secrets, раздел Production (не Previews):
- удалить WA_VIA_WINCHESTER;
- Secret WA_TOKEN_WINCHESTER — новый ключ вместо ключа Wazzapo;
- Secret APP_SECRET_WINCHESTER;
- Text PHONE_NUMBER_ID_WINCHESTER;
- Text WABA_ID_WINCHESTER;
- Text WA_SINCE_WINCHESTER — текущее время по Астане;
- Text VERIFY_TOKEN — если его нет: длинный пароль, не такой, как LEADS_KEY.
Не ставьте BOT_WA_WINCHESTER, TPL_REMIND_WINCHESTER и TPL_REVIEW_WINCHESTER. Сохраните.

6. Вебхук. Приложение → WhatsApp → Конфигурация:
- Callback URL: https://ai-admin.azikonps4.workers.dev/wa/winchester;
- Verify token — то же значение, что VERIFY_TOKEN, затем «Подтвердить и сохранить»;
- подписаться на поля: messages, message_template_status_update, message_template_quality_update, template_category_update, phone_number_quality_update, phone_number_name_update, account_update, account_alerts, account_review_update, business_capability_update, user_preferences;
- поля history и smb_message_echoes не нужны.

7. Перевести приложение в режим «Опубликовано» (Live). Нужны ссылка на /privacy и почта: переменные OWNER_NAME и OWNER_EMAIL.

8. Проверка. Откройте /launch?c=winchester: все строки должны быть ✅ (секреты, номер, предел 250, номер в аккаунте, подписка приложения, «последнее событие от Meta»). Если подписки нет — кнопка «Подписать приложение». Потом напишите со своего телефона на +7 702 514 86 91:
- в пульте появился чат с подписью номера;
- бот молчит;
- в Telegram пришло «Бот выключен, клиент пишет».
Ответьте из пульта в течение 24 часов и убедитесь, что ответ пришёл. Отметьте «проверено вживую».

9. Шаблоны. «Рассылки» → «Автоматические» → сценарий → «Подать в Meta». Вы видите точный текст до подачи. Ждите статус «Шаблон одобрен Meta». Только после этого и после одобрения компании Bot Flow переключайте сценарий: «Канал: WhatsApp Meta», по одному. Начните с подтверждения записи. Для рекламы: «Шаблоны» → «Подать в Meta», 4–6 текстов, первая рассылка — не больше 50 человек.

10. Чего не делать:
- не создавать второе приложение на тот же номер;
- не класть ключ в Previews;
- не включать сценарии на Meta до одобрения компании и шаблонов;
- не присылать ключи в чат.

11. Если не работает:
- 190 — ключ временный или отозван;
- 403 на вебхук — нет APP_SECRET или он не тот;
- «Wrong verify token» — не совпал VERIFY_TOKEN;
- 133010 — номер не зарегистрирован: WhatsApp Manager → номер → «Зарегистрировать», PIN;
- 131031 — аккаунт ограничен, смотрите Business Support Home;
- «нет права whatsapp_business_management» — пересоздайте ключ с этим правом;
- сообщения не приходят — приложение не подписано на аккаунт или в режиме разработки;
- в Telegram «событие чужого номера» — проверьте PHONE_NUMBER_ID_WINCHESTER.

12. Откат. Переключите сценарии обратно на «Второй WhatsApp» и удалите WA_TOKEN_WINCHESTER: номер пропадёт из пульта, вебхук Meta будет получать 403, вреда от этого нет. Как сменить ключ — docs/runbooks/keys-and-data.md.
