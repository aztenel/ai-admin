# CLAUDE.md — системный контекст и правила репозитория `ai-admin`

> Главный документ для Claude и любого разработчика. Читается первым.
> План переезда — `REFACTORING.md`. Подробное поведение текущего монолита (Altegio, рассылки, Green-API, живые проверки) — `docs/legacy-context.md`.
> При расхождении документа и кода верь коду и исправь документ в том же изменении.

## 0. Владелец и общение

- Владелец — начинающий интегратор без технических навыков: код не читает, часто работает с телефона.
- Пиши ему **по-русски, коротко, простыми словами**. Всегда разделяй: «проверено вживую», «проверено на заглушках», «не проверено».
- Не обещай владельцу и его клиентам того, что не проверено вживую.
- Решения, которые нельзя отменить (выкладка на боевой сайт, удаление данных, рассылки настоящим клиентам), — только после явного слова владельца («выкладывай» и т. п.).
- Никаких ключей, токенов и паролей в репозитории, в логах и в чате. Репозиторий **публичный**.

---

## 1. Обзор проекта и стек

### 1.1. Что это

**AI-администратор** — сервис для малого бизнеса Казахстана (барбершопы, салоны, стоматологии, ремонт телефонов и т. п.):

- **ИИ-бот** отвечает клиентам в WhatsApp и в веб-чате: цены, график, запись. Записывает в CRM **Altegio**, передаёт сложное человеку.
- **Пульт чатов** (PWA) — администратор видит все переписки, отвечает с номера бизнеса, забирает чат у бота, закрывает просьбы.
- **Рассылки** по базе клиентов (шаблоны Meta или обычный текст через Green-API), напоминания о записи, просьба об отзыве (ссылка 2ГИС / Google Карты), дневная сводка в Telegram.
- **Платформа «паспортов»**: новый клиент-бизнес подключается заполнением формы, без правки кода.

Цель — полноценный аналог **Corta Chat / Chatwoot**: мультиарендность (много бизнесов на одном движке), реляционная БД, мгновенный пульт без опроса, мобильные приложения iOS/Android.

### 1.2. Стек: сейчас и цель

| Слой | Сейчас (октябрь 2026) | Цель (после `REFACTORING.md`) |
|---|---|---|
| Сервер | Один Cloudflare Worker `worker.js` (6 218 строк, ES-модуль, без сборщика — wrangler сам собирает через esbuild) | Тот же Worker, разложенный на модули `src/**`; `src/index.js` — роутер на 100–150 строк |
| Данные | Cloudflare **KV** (ключи `h:…`, `leads:…`, `cfg:all` и ещё ~40 видов) | **Supabase (PostgreSQL)**: таблицы с `workspace_id`, RLS, миграции SQL. KV остаётся только для кэша и счётчиков-ограничителей |
| Обновление пульта | Опрос `/api/inbox/list` каждые 15 с | **Supabase Realtime** (`postgres_changes`) + опрос как запасной путь |
| Вход | Ключ → cookie `aia` (HMAC от `LEADS_KEY`), сотрудник — свой ключ | **Supabase Auth** (почта / телефон), роли в `workspace_members`; для мобильных — токен (Bearer), не cookie |
| ИИ | Claude Haiku 5.5 (`MODEL=claude-haiku-5-5`, `askClaude`), запасной Gemini (`askGemini`) | Слой `services/ai` с поставщиками за одним интерфейсом, учёт токенов по `workspace_id` |
| WhatsApp | **Meta Cloud API** (`/wa/<id>`, общий `POST /`) и **Green-API** (обычный WhatsApp по QR, `/ga/<id>?t=…`) | Адаптеры `services/integrations/meta`, `…/greenapi` с общим интерфейсом «канал» |
| CRM записи | **Altegio**: публичный API онлайн-записи (ключ разработчика) + журнал записей (ключ пользователя `ALTEGIO_USER_<ID>`) | Адаптер `services/integrations/altegio` + доменный сервис `services/booking` |
| Уведомления | Telegram-бот (`TG_TOKEN`, `TG_CHAT`), уведомления браузера и Windows в пульте | + push на телефоны (FCM / APNs) через `services/notifications/push` |
| Пульт (UI) | Ванильный JS (`pult/app.js`, `views.js`), свой CSS на переменных (`design.base.css`, `layout.css`, `motion.css`), собирается `tools/build-pult.mjs` в строку `pult.gen.js` внутри Worker | Отдельное приложение `apps/pult` (сборка Vite, **Tailwind CSS v4** поверх тех же токенов), раздаётся из `public/` через **Workers Static Assets** |
| Компьютер | Программа «Пульт» для Windows на **Tauri 2** (`desktop/`), открывает `/inbox` сайта | Без изменений, плюс общий код уведомлений |
| Телефоны | PWA «на экран Домой» | **Capacitor** (`mobile/`): iOS и Android с родными push-уведомлениями |
| Тесты | `test/smoke.mjs` (592), `test/platform.mjs` (481), контракт маршрутов `test/contract/` (709), золотые переписки `test/golden/` (51), `test/unit/`, `test/e2e.mjs` (72, Playwright), `test/review/` (~130 независимых сценариев), CI на Node 20/22/24 | Те же наборы как защитная сетка + юнит-тесты модулей + проверки изоляции арендаторов |
| Выкладка | Cloudflare Workers Builds: `main` → боевой сайт, любая другая ветка → черновик (Worker Previews) | Без изменений; миграции БД — `supabase db push` в отдельном шаге CI |

Слова «Supabase», «Tailwind», «Capacitor», «Realtime» в этом документе — **цель**, их в коде пока нет.

### 1.3. Ключевые архитектурные решения (и почему)

1. **Переезд по шагам, без «переписать с нуля»** (strangler fig). Боевой бот работает всё время; каждое изменение проходит те же 1 100+ проверок. Переписывание с нуля потеряло бы сотни мелких правил, найденных вживую (см. `docs/legacy-context.md`).
2. **JavaScript + JSDoc-типы** (`// @ts-check`, `tsc --noEmit --checkJs` в CI), а не немедленный TypeScript: тесты запускают `worker.js` прямо в Node 20/22/24 без сборки. На TypeScript можно перейти позже по модулям.
3. **PostgreSQL как единственная правда о данных**, KV — только кэш. Это закрывает известные гонки KV (два сообщения одного чата одновременно, «прочитал → изменил → записал»): атомарные операции делаются функциями Postgres (`rpc`) и ограничениями уникальности.
4. **Мультиарендность через `workspace_id` в каждой строке + RLS.** Сервер ходит в БД сервисным ключом (RLS обходится), поэтому изоляция в коде обязательна (раздел 5.3). Клиенты (пульт, приложения) ходят с ключом `anon` и токеном пользователя — их ограничивает RLS.
5. **Секреты арендаторов уезжают из переменных Cloudflare в таблицу `integration_secrets`** (шифрование AES-GCM ключом `SECRETS_MASTER_KEY`). Сейчас каждый новый клиент — новые переменные `WA_TOKEN_<ID>`, `GA_TOKEN_<ID>`, `ALTEGIO_USER_<ID>` в панели и новый черновик. Это не масштабируется: у Worker есть предел числа переменных, и подключить клиента без владельца нельзя.
6. **Вебхуки отвечают сразу, работа — в очереди** (Cloudflare Queues, нужен платный тариф Workers): Meta и Green-API повторяют неотвеченные вебхуки, а ответ ИИ идёт 1–10 с.
7. **Мобильные приложения — не «обёртка сайта»**: Capacitor собирает пульт локально (`webDir`), к серверу ходит по API с токеном, push — родные. Приложение-обёртку сайта Apple может отклонить (App Review 4.2).

---

## 2. Карта текущего монолита (`worker.js`, 6 218 строк)

Номера строк — на 11 октября 2026 (коммит ветки `dev`). Они сдвигаются; ищи по имени функции.

### 2.1. Разделы файла

| Строки | Раздел | Что внутри | Куда переедет |
|---|---|---|---|
| 1–38 | Шапка | Список переменных окружения в комментарии, импорт `pult.gen.js` | `CLAUDE.md` §3, `src/config/env.js` |
| 40–180 | Встроенные демо-клиенты | `CLIENTS` (стоматология, салон, автосервис, школа, банкетный зал, барбершоп, `alt`), `week()`, `hasClient` | `src/config/builtin-clients.js` → строки `workspaces` с `is_demo` |
| 181–226 | Время и расписание | `local`, `isoDay`, `hhmm`, `mins`, расчёт свободных окон демо | `src/lib/time.js`, `src/services/schedule/` |
| 227–316 | Промпт | `systemPrompt(c, ctx)`, правила ниш, `PAY_RULE`, `UPSELL_RULE`, `REPAIR_RULE` | `src/services/conversation/prompt.js` |
| 317–386 | Слой 1: вход | `normPhone`, `phonesIn`, `redact` (маскирование номеров), `isJoke`, проверка имени | `src/lib/phone.js`, `src/lib/text.js` |
| 387–522 | Передача человеку, заявки | `wantsHuman`, `nextOpen`, `consentText`, `loadLeads`/`saveLeads`/`allLeads`, `detectLang` | `services/conversation/handoff.js`, `db/repositories/leads.js`, `services/conversation/language.js` |
| 523–708 | Слой 3: проверка ответа ИИ | `checkReply` — цены только из фактов, время только из свободных окон, сайты; `offers` (кнопки-подсказки) | `src/services/conversation/guard.js` |
| 709–2143 | **Altegio** (≈1 430 строк) | `altClaims` (ложные «записала»), `tidyTags`/`tagFields` (разбор `[ЗАЯВКА]`/`[ОТМЕНА]`), `altOther`, `samePerson`, `altCall` (HTTP + ключ пользователя), `altIsGone`/`altPrune`, `altJournal`/`altFromJournal` (журнал записей), `altBase`, `altTimes`, `altSnapshot` (подсказка с окнами), `altPickServices`/`altPickStaff`, `altBook`, `altRecord`, `altCancel`, `altSay` (готовые ответы на 3 языках), `altDiag`/`altPage` (`/altegio`), `altUserProbe` (`/altegio/user`), лимиты записей | `src/services/integrations/altegio/` (HTTP-клиент, типы) + `src/services/booking/` (правила записи, отмены, переноса) |
| 2144–2255 | Общий мозг: история | `histTtl`, `putHist`, `logTurns`, `histMeta` (строка списка в пульте), `mergeProfile` | `src/db/repositories/chats.js`, `messages.js` |
| 2256–3407 | **`think()` — один ответ бота** (≈1 150 строк) | Лимиты → «позовите человека» → язык → Altegio-снимок и журнал → вызов ИИ (`ask`, до 3 попыток) → защита → **три ветки**: `if (alt)` (2552–3016, запись/отмена/перенос в Altegio), `altDown` (3017–3078, расписание недоступно), обычные заявки (3079–3312) → сохранение (3313–3407: заявки → история → ответ → Telegram), реквизиты Kaspi, напоминания | `src/services/conversation/orchestrator.js` + `booking/flows/*.js` + `leads/flows.js` |
| 3408–3435 | `thinkSafe` | Страховка вокруг `think` | `orchestrator.js` |
| 3436–3536 | Поставщики ИИ | `askGemini` (лесенка «раздумий» `THINK_LADDER`), `askClaude` (Messages API), `notify` (Telegram) | `src/services/ai/{gemini,claude}.js`, `src/services/notifications/telegram.js` |
| 3537–3675 | Лимит сессий, автотест | Ограничение новых диалогов с IP, `CASES`, `runCase` (`/selftest`) | `src/services/ratelimit.js`, `src/services/selftest/` |
| 3676–3855 | **HTTP: `export default { fetch, scheduled }`** | Весь роутер одной цепочкой `if (P === …)` (≈60 маршрутов) + фоновая задача раз в минуту | `src/index.js` + `src/routes/*` |
| 3856–4114 | Каналы: веб-чат и Meta | `handleWebChat`, `handleWAText`, `waText`, `handleWAMedia`, `seenBefore` (повторы вебхуков), `waCoex` (ответ с телефона), `markOptout`, `handleWhatsApp`, `handleWAMessage` | `src/controllers/webhooks/meta.js`, `src/services/channels/` |
| 4115–4305 | **Green-API** | `gaRoute`, `gaHook` (пароль вебхука = HMAC токена), `gaCall`, `gaCode`, `sendGreen`, `gaInfo`, `gaStateSignal`, `handleGreen`, `sendWA`, `handleWAClient` (`/wa/<id>`), `metaSigOk`, `waErr` | `src/services/integrations/greenapi/`, `…/meta/` |
| 4306–4379 | `/diag` | Проверка ключей и скорости моделей | `src/controllers/diag.js` |
| 4380–4522 | Страницы | `html`, витрина `/`, веб-чат, `/privacy`, `/leads`, `/selftest` | `public/` (статичное) + `src/controllers/pages.js` |
| 4523–4820 | **Паспорт бота** | `NICHES`, `parseSchedule`, `parseServices`, `parseRepairs` (прайс ремонта), `compileClient`, `syncClients` (раз в минуту из `cfg:all`) | `src/services/tenants/passport.js` → таблицы `workspaces`, `bots` |
| 4821–4933 | Вход | `handleLogin`, `sessionRead`/`cookieSet` (cookie `aia`), `keyGate` (ограничение подбора ключа), `canSee`, `sameOrigin`, `page()` (заголовки безопасности, CSP) | `src/services/auth/`, `src/routes/middleware/` |
| 4934–5088 | «Мои боты» `/studio` | Форма паспорта (`FIELDS`), `/api/studio/*`, ключи сотрудников | `src/controllers/studio.js` |
| 5089–5268 | **Пульт: бэкенд** | `waRoute`, `/api/inbox/list|chat|send|act|media|me|leads`, действия `resolve/pause/resume/done/forget`, манифест PWA | `src/controllers/inbox.js` + `src/services/inbox/` |
| 5269–5436 | Проверка запуска `/launch` | Чек-лист подключений, экзамен бота (`casesFor`), «Настроить Green-API» (`/api/launch/ga`) | `src/controllers/launch.js` |
| 5437–5827 | **Рассылки** | `bcParse` (список из Excel), `bcDate`/`bcSeg` (сегменты), `bcRun`, ошибки Meta (`BC_TEMP`, `BC_ACCOUNT`, `BC_PARAM`), Green-API-рассылки (`bcGaMsg`, паузы), `digestRun` (сводка в Telegram) | `src/services/broadcast/`, `src/services/digest.js` |
| 5828–6218 | Напоминания и отзывы, фоновая задача | `remindPlan`, `remindText`, `remindSend`, `remindRun`, `cronRun` | `src/services/reminders/`, `src/jobs/cron.js` |

### 2.2. Где что зашито (быстрый указатель)

- **Вебхуки:** Meta общий — `POST /` и `/webhook` (≈3836); Meta клиента — `/wa/<id>` → `handleWAClient` (4268); Green-API общий — `POST /ga?t=<GA_HOOK>` (≈3822); Green-API клиента — `/ga/<id>?t=<пароль>` → `handleGreen` (4196). Подпись Meta — `metaSigOk` (4280). Повторы — `seenBefore` (ключ `seen:`).
- **Бэкенд PWA-пульта:** `/api/inbox/*` (5089–5268), страница — `PULT_LIVE` из `pult.gen.js` (собран из `pult/`), демо `/demo` — `PULT_DEMO`.
- **Бизнес-логика записи:** `think()` ветка `if (alt)` + весь раздел Altegio 709–2143.
- **Отзывы 2ГИС:** интеграции с API 2ГИС **нет**. Есть поле паспорта `review` (ссылка на 2ГИС / Google Карты) и отправка просьбы об отзыве через 3 часа после записи (`remindPlan` → вид `rv`, `remindRun`). Только WhatsApp, только записи, созданные ботом.
- **Trade-In:** в коде **нет**. Ближайшее — ниша `repair` (прайс «модель | работа | цена | срок», `parseRepairs`, `REPAIR_RULE`). В целевой архитектуре место для него — `src/services/tradein/` (оценка по прайсу, заявка администратору), см. `REFACTORING.md`, фаза 1.
- **Реквизиты Kaspi:** поле паспорта `pay`, метка `[РЕКВИЗИТЫ]` (`PAY_TAG`), вставка в конце `think()`; кнопка «₸» в пульте.
- **Telegram:** `notify`, `notifyOnce` (не чаще раза в 10 минут на повод), ежедневная резервная копия заявок, сводка `digestRun`.
- **Фоновая задача** (`scheduled`, раз в минуту по `wrangler.jsonc`): `cronRun` → порции рассылок (`bcRun`), напоминания (`remindRun`), сводка (`digestRun`). У черновиков фоновой задачи нет.

### 2.3. Хранилище KV сейчас (что переносить в БД)

| Ключ | Что хранит | Целевая таблица |
|---|---|---|
| `cfg:all` | Все паспорта ботов `{ <id>: cfg }` | `workspaces`, `bots` |
| `h:<канал>:<клиент>:<id>` + метаданные | Чат: `turns[]` (до 60), `profile` (имя, телефон, записи, заявки, пауза, `need`, окно 24 ч `li`, `stop`…) | `contacts`, `chats`, `messages`, `bookings`, `chat_flags` |
| `leads:<клиент>`, `lead:<клиент>:<день>:<id>` | Заявки (дважды: список и отдельный ключ) | `leads` |
| `optout:<клиент>:<номер>` | Отказ от рассылок («стоп») | `optouts` |
| `bc:<клиент>:<id>`, `bcr:`, `bcl:`, `bct:`, `bcf:`, `bcrun`, `bcq:`, `bchold:`, `bclast:` | Рассылки, получатели, очередь, пределы, паузы | `broadcasts`, `broadcast_recipients` (пределы — KV/`rate_limits`) |
| `rmq:<клиент>`, `rmidx`, `rms:…` | Очередь напоминаний и отметки отправки | `reminders` |
| `dg:<клиент>:<день>` | Отметка дневной сводки | `job_marks` |
| `bk:<локация>:<номер>:<день>`, `ip:`, `session:`, `lg:`, `nt:` | Счётчики-ограничители, сессии | Остаются в KV (или `rate_limits`) |
| `seen:`, `wa:`, `wasend:`, `wafail:`, `waburst:`, `wasig:`, `meta:`, `ga:`, `gastate:` | Повторы вебхуков, состояние каналов | `messages.provider_message_id` (уникальность), `channels.state` |
| `consent:`, `pr:`, `off:`, `cx:`, `mv:`, `t:`, `base:` | Согласия, кэш Altegio, служебные отметки | `contacts.consent_at`, KV-кэш |

### 2.4. Связанные части вне `worker.js`

- `pult/` → `tools/build-pult.mjs` → `pult.gen.js` (не править руками): PWA-пульт (`/inbox`, `/demo`, манифесты, значки).
- `desktop/` — программа «Пульт» для Windows (Tauri 2), сборка `.github/workflows/desktop.yml`, снимки пробного запуска — ветка `desktop-shots`. Подробно — `desktop/README.md`.
- `test/` — `harness.mjs` (KV в памяти, заглушки Gemini/Claude/Telegram/Meta/Altegio/Green-API, `S.gaText` — вебхук Green-API), `smoke.mjs`, `platform.mjs`, `e2e.mjs`, `devserver.mjs` (локальный сервер на заглушках), `review/` (независимые сценарии, `node test/review/run.mjs`).
- Защитная сетка переезда (шаг 0, всё запускается из `test/smoke.mjs`, значит, и перед выкладкой):
  - `test/contract/routes.mjs` + `routes.snap.json` — контракт маршрутов: каждый адрес × гость/владелец/сотрудник (код, тип, переадресация, заголовки защиты, ключи JSON) и правила прав (чужие данные не утекают, чужой сайт и неподписанный вебхук отклоняются).
  - `test/golden/cases.mjs` + `run.mjs` + `expected.json` — 51 «золотая» переписка: ИИ подменён записанными ответами, сверяется решение кода (ответ клиенту, заявки, Altegio, Telegram, состояние чата).
  - `test/unit/*.test.mjs` (`node --test`) — модули `src/` и проверка границ.
  - Поведение изменили намеренно — `UPDATE=1 node test/contract/routes.mjs` / `UPDATE=1 node test/golden/run.mjs`, затем **прочитать разницу в git** и объяснить её в коммите. Без `UPDATE=1` разница — ошибка.
- `src/` — перенесённый и новый код: пункты 1–15 и 17 таблицы §1.1 `REFACTORING.md` сделаны 11 октября 2026 (пункт 16 — переносить нечего). Слои: `lib/` (чистые помощники, HTTP, подпись), `config/` (демо-клиенты, ниши, константы), `db/kv/` (чаты, заявки, `kvRetry`, ключи рассылок), `services/{integrations,ai,notifications,channels,conversation,booking,schedule,tenants,broadcast,reminders,tradein}`, `services/digest.js`, `jobs/cron.js`. `worker.js` (3 341 строка) подключает их. В `worker.js` остались: `think()`/`thinkSafe`, роутер `fetch`, обработчики сообщений (`handleWebChat`, `handleWhatsApp`, `handleWAMessage`, `handleWAClient`, `handleGreen`), страницы и API пульта/рассылок/студии/запуска (`bcPage`/`bcApi`, `inboxApi`, `studioApi`, `launchApi`), `altDiag`/`altPage`/`altUserProbe`, `runCase`/автотест, `systemPrompt`, `REPAIR_RULE`. Файлы перенесены «как есть» и помечены `// @ts-nocheck` — типы добавляются отдельным шагом (новый `tradein/index.js` — под `@ts-check`, `estimate` бросает «не реализовано»). Номера строк в таблице §2.1 устарели — ищи по имени функции. `jsconfig.json` — проверка типов `src/` (`npm run check:types`). `scripts/check-boundaries.mjs` — границы слоёв (`npm run check:boundaries`).
- `test/review/bot-copy.mjs` — копии бота в папках `test/review/4a`, `4b` подключают `src/` по абсолютному пути.
- `.github/workflows/checks.yml` — тесты на Node 20/22/24 и пробная сборка `wrangler deploy --dry-run`.
- `wrangler.jsonc` — **не `wrangler.toml`**: имя `ai-admin`, `main: worker.js`, KV `KV`, cron `* * * * *`, `keep_vars: true`, блок `previews`.

---

## 3. Переменные окружения и секреты

Задаются **только** в панели Cloudflare (Workers → ai-admin → Settings → Variables and Secrets). Для черновиков — отдельно, в разделе **Previews**; новый секрет получают только **новые** черновики (новая ветка). `keep_vars: true` в `wrangler.jsonc` обязателен: иначе выкладка сотрёт переменные. Тип «Secret» — для всего, что даёт доступ; «Text» — для открытых настроек.

### 3.1. Сейчас: общие

| Имя | Тип | Обязательно | Назначение |
|---|---|---|---|
| `KV` | KV binding | да | Хранилище (`wrangler.jsonc`) |
| `ANTHROPIC_KEY` | Secret | при `MODEL=claude-…` | Ключ Claude API (console.anthropic.com) |
| `GEMINI_KEY` | Secret | при моделях Gemini | Ключ Gemini |
| `MODEL`, `MODEL_FALLBACK` | Text | нет | Модель и запасная (сейчас `claude-haiku-5-5`) |
| `LEADS_KEY` | Secret | да | Ключ владельца: вход в `/studio`, `/leads`, `/diag`, подпись cookie |
| `VERIFY_TOKEN` | Text | для Meta | Проверка вебхука Meta |
| `TG_TOKEN` | Secret | да для клиентов | Бот Telegram для уведомлений |
| `TG_CHAT` | Text | да для клиентов | Чат(ы) владельца, через запятую |
| `ALTEGIO_PARTNER` | Secret | для Altegio | Ключ разработчика Altegio (онлайн-запись) |
| `ALTEGIO_SELF_CANCEL` | Text | нет | `1` — бот сам отменяет и переносит (не включать без новой проверки) |
| `ALTEGIO_SLOT_CHECK` | Text | нет | `1` — угадывать удалённые записи по времени мастера (выключено: ошибалось) |
| `WA_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET`, `WA_CLIENT` | Secret/Text | нет | Старый режим «один номер Meta на весь Worker» |
| `GA_ID`, `GA_TOKEN`, `GA_URL`, `GA_HOOK`, `GA_CLIENT` | Text/Secret | нет | Старый режим «общий номер Green-API» (демо) |
| `SITE_URL` | Text | желательно | Адрес сайта для ссылок в Telegram (`https://ai-admin.azikonps4.workers.dev`) |
| `OWNER_NAME`, `OWNER_EMAIL`, `CONSENT_TEXT` | Text | нет | Страница `/privacy`, текст согласия |
| `SESSIONS_PER_IP`, `BC_BATCH` | Text | нет | Ограничения |

### 3.2. Сейчас: на каждого клиента (`<ID>` — id паспорта заглавными, например `KAIRAT`)

| Имя | Тип | Назначение |
|---|---|---|
| `WA_TOKEN_<ID>`, `APP_SECRET_<ID>`, `PHONE_NUMBER_ID_<ID>` | Secret/Secret/Text | Свой номер Meta (вебхук `/wa/<id>`) |
| `GA_ID_<ID>`, `GA_TOKEN_<ID>`, `GA_URL_<ID>` | Text/Secret/Text | Свой номер Green-API (вебхук `/ga/<id>?t=…`) |
| `ALTEGIO_LOC_<ID>` | Text | Номер локации Altegio |
| `ALTEGIO_USER_<ID>` | Secret | Ключ пользователя Altegio — чтение журнала записей (получают на `/altegio/user`) |
| `ALTEGIO_SELF_CANCEL_<ID>` | Text | Самостоятельная отмена для одного клиента |
| `TG_CHAT_<ID>` | Text | Свой чат Telegram клиента |
| `KEY_<ID>` | Secret | Старый ключ клиента к `/leads` |

### 3.3. Цель: добавляются

| Имя | Тип | Фаза | Назначение |
|---|---|---|---|
| `SUPABASE_URL` | Text | 2 | Адрес проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | 2 | Сервисный ключ — **только в Worker**, никогда в браузер и приложения |
| `SUPABASE_ANON_KEY` | Text | 2 | Публичный ключ для пульта и приложений (защищён RLS) |
| `SUPABASE_JWT_SECRET` | Secret | 2 | Проверка токенов пользователей в Worker (если не через `auth.getUser`) |
| `SECRETS_MASTER_KEY` | Secret | 2 | 32 байта base64 — шифрование `integration_secrets` (AES-GCM, WebCrypto) |
| `STORAGE_MODE` | Text | 2 | `kv` / `dual` / `pg` — по умолчанию для новых арендаторов (переключатель переезда) |
| `QUEUE` | Queue binding | 3 | Очередь обработки вебхуков (Cloudflare Queues, платный тариф) |
| `ASSETS` | Static Assets binding | 3 | Раздача `public/` |
| `HYPERDRIVE` | Hyperdrive binding | 3 (по желанию) | Прямое подключение к Postgres, если понадобятся транзакции из Worker |
| `FCM_SERVICE_ACCOUNT` | Secret | 5 | JSON сервисного аккаунта Firebase для push (Android, при желании и iOS) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_TOPIC` | Text/Text/Secret/Text | 5 | Push на iPhone напрямую через APNs (если не через FCM) |
| `SENTRY_DSN` | Secret | 3 (по желанию) | Отчёты об ошибках |

После фазы 2 переменные **на клиента** (§3.2) заменяются строками `channels` и `integration_secrets`; старые имена остаются запасным путём до конца переезда.

### 3.4. Секреты CI (GitHub → Settings → Secrets)

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (миграции); `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (подпись Android); `APPLE_*` / `MATCH_*` (подпись iOS); при покупке подписи Windows — `WINDOWS_CERT_*`.

### 3.5. Правила

- Новый секрет — только в панели Cloudflare / GitHub Secrets. В код, тесты, `wrangler.jsonc`, документы и чат — **только имя**.
- В логи — никогда: токены, ключи, полные номера телефонов (маскировать: `+7 777 *** ** 10`), тексты паролей.
- Список переменных живёт в `src/config/env.js` (с проверкой при старте: что обязательно, что нет). Этот раздел обновляется в том же изменении.

---

## 4. Целевое дерево каталогов

```
ai-admin/
├── CLAUDE.md                     # этот файл
├── REFACTORING.md                # план переезда по фазам
├── README.md                     # коротко для людей: что это и как запустить
├── wrangler.jsonc                # Worker: main=src/index.js, KV, ASSETS, QUEUE, crons, previews
├── package.json                  # скрипты: test, check (tsc --checkJs), build:pult, lint
├── jsconfig.json                 # checkJs, пути
├── src/                          # ===== СЕРВЕР (Cloudflare Worker) =====
│   ├── index.js                  # точка входа: fetch / scheduled / queue → router (100–150 строк)
│   ├── routes/                   # ТОЛЬКО таблица «метод + путь → контроллер» и цепочка middleware
│   │   ├── index.js              # сборка роутера
│   │   ├── webhooks.js           # /wa/:id, /ga/:id, POST /, /webhook, /ga
│   │   ├── inbox.js              # /inbox, /api/inbox/*
│   │   ├── studio.js             # /studio, /api/studio/*
│   │   ├── launch.js             # /launch, /api/launch/*
│   │   ├── broadcast.js          # /broadcast, /api/bc/*
│   │   ├── chat.js               # /api/chat, /api/history (веб-чат)
│   │   ├── auth.js               # /login, /logout, /api/auth/*
│   │   ├── admin.js              # /diag, /altegio, /altegio/user, /selftest, /leads
│   │   └── middleware/           # requestId, errorBoundary, auth, tenant, sameOrigin, cors, rateLimit, securityHeaders
│   ├── controllers/              # HTTP ⇄ домен: разобрать запрос, проверить ввод и права, вызвать сервис, собрать ответ
│   │   ├── webhooks/{meta.js,greenapi.js}
│   │   ├── inbox.js  studio.js  launch.js  broadcast.js  chat.js  auth.js  diag.js  pages.js
│   ├── services/                 # БИЗНЕС-ЛОГИКА: не знает про Request/Response и про конкретную БД
│   │   ├── conversation/         # бывший think(): orchestrator, prompt, guard (checkReply), claims, tags,
│   │   │                         # language, handoff, limits, payments (Kaspi), upsell
│   │   ├── booking/              # запись/отмена/перенос: flows/{book,cancel,move,status}.js, pick (услуга, мастер),
│   │   │                         # journal (правда из CRM), replies (altSay)
│   │   ├── leads/                # заявки без CRM, просьбы администратору
│   │   ├── inbox/                # действия пульта: ответить, забрать, вернуть бота, «сделано», забыть
│   │   ├── broadcast/            # parse (Excel), segments, planner, sender (Meta/Green-API), errors
│   │   ├── reminders/            # напоминания и просьба об отзыве (2ГИС/Google — ссылка из паспорта)
│   │   ├── reviews/              # отзывы: ссылки 2ГИС/Google, позже — сбор оценок
│   │   ├── tradein/              # (новое) оценка Trade-In по прайсу, заявка администратору
│   │   ├── digest.js             # дневная сводка
│   │   ├── tenants/              # паспорт: parse (график, услуги, ремонт), compile, niches
│   │   ├── auth/                 # сессии, роли, ключи, Supabase Auth
│   │   ├── ai/                   # index (выбор поставщика), claude.js, gemini.js, usage (учёт токенов)
│   │   ├── notifications/        # telegram.js, push.js (FCM/APNs), throttle
│   │   ├── channels/             # общий интерфейс канала: receive(), send(), window24h(), optout
│   │   ├── selftest/             # сценарии автотеста и экзамена
│   │   └── integrations/         # АДАПТЕРЫ внешних API: только HTTP, ретраи, разбор ошибок, типы
│   │       ├── altegio/          # client.js (altCall), booking-api.js, journal-api.js, errors.js
│   │       ├── greenapi/         # client.js (gaCall), webhook.js (разбор, пароль), state.js
│   │       ├── meta/             # client.js (Graph API), webhook.js (подпись), templates.js
│   │       ├── telegram/         # client.js
│   │       └── twogis/           # (на будущее) отзывы/карточка 2ГИС, если появится API
│   ├── db/                       # ДОСТУП К ДАННЫМ
│   │   ├── client.js             # фабрика Supabase-клиента (сервисный ключ), Hyperdrive по желанию
│   │   ├── repositories/         # workspaces, members, bots, channels, secrets, contacts, chats, messages,
│   │   │                         # bookings, leads, broadcasts, optouts, reminders, audit
│   │   ├── kv/                   # старое хранилище (на время переезда) — те же интерфейсы, что repositories
│   │   └── storage.js            # выбор kv / dual / pg по workspace (переключатель переезда)
│   ├── jobs/                     # cron.js (раз в минуту), queue.js (обработчик очереди вебхуков)
│   ├── config/                   # env.js (схема переменных), constants.js, niches.js, builtin-clients.js (демо)
│   └── lib/                      # ЧИСТЫЕ функции без ввода-вывода: phone, time, text, money, crypto, http (json/page),
│                                 # errors (AppError), log (структурные логи), ids
├── supabase/                     # ===== БАЗА =====
│   ├── config.toml
│   ├── migrations/               # 0001_init.sql, 0002_rls.sql, 0003_realtime.sql, … (только вперёд)
│   └── seed.sql                  # демо-арендаторы для черновиков и тестов
├── apps/
│   └── pult/                     # ===== PWA-ПУЛЬТ (исходники) =====
│       ├── index.html  vite.config.js  tailwind.css
│       └── src/                  # app/, views/, components/, state/ (стор + realtime), api/ (клиент), styles/tokens.css
├── public/                       # ===== СТАТИКА (Workers Static Assets) =====
│   ├── app/                      # собранный пульт (vite build) — не править руками
│   ├── icons/  manifest.webmanifest  demo.webmanifest  privacy.html
├── mobile/                       # ===== CAPACITOR =====
│   ├── capacitor.config.ts       # appId kz.aiadmin.pult, webDir ../public/app
│   ├── android/  ios/            # родные проекты (создаёт `npx cap add`)
├── desktop/                      # ===== TAURI (Windows) — уже есть =====
├── scripts/                      # migrate-kv-to-pg.mjs, build-pult.mjs, check-boundaries.mjs
├── docs/                         # legacy-context.md, adr/ (решения), runbooks/ (что делать при сбое)
└── test/
    ├── unit/                     # быстрые тесты модулей lib/ и services/
    ├── integration/              # harness.mjs, smoke.mjs, platform.mjs (сценарии на заглушках)
    ├── tenancy/                  # проверки изоляции арендаторов (обязательные)
    ├── e2e/                      # Playwright: пульт на телефоне и компьютере
    └── review/                   # независимые сценарии (как сейчас)
```

**Направление зависимостей (нарушать нельзя):**

```
routes → controllers → services → (services/integrations | db/repositories) → lib
                         ↑ config, lib доступны всем;  services НЕ импортируют controllers/routes;
                         integrations НЕ импортируют services; db НЕ импортирует services.
```

Проверка — `scripts/check-boundaries.mjs` (внутри `npm test`). Ещё она запрещает в `src/`: `import()` (цель не всегда видна; типы в JSDoc — тегом `/** @import { T } from "./x.js" */`), модули Node (`fs`, `events`, `node:*` — в Worker их нет), пакеты не из `dependencies` в `package.json`, подключения вне `src/` (новый код не зависит от `worker.js`), несуществующие файлы и другой регистр букв, циклы.

---

## 5. Стандарты кода и безопасности

### 5.1. Разделение ответственности (SoC)

| Слой | Может | Не может |
|---|---|---|
| `routes/` | Сопоставить метод и путь, навесить middleware | Любая логика, чтение тела, доступ к БД |
| `controllers/` | Разобрать запрос, проверить ввод (схема), проверить права, вызвать **один** сервисный сценарий, собрать `Response` | Бизнес-правила, прямые запросы к БД и внешним API, вызов ИИ |
| `services/` | Бизнес-правила, оркестрация, вызов репозиториев и адаптеров через переданный `ctx` | Знать про `Request`/`Response`/cookie/URL, читать `env` напрямую, писать в KV/БД мимо репозиториев |
| `services/integrations/` | HTTP к внешнему API, таймауты, повторы, превращение ответов и ошибок во внутренние типы | Бизнес-решения («записать ли клиента»), доступ к БД |
| `db/repositories/` | SQL/PostgREST, отображение строк в объекты | Бизнес-правила; любой метод без `workspaceId` |
| `lib/` | Чистые функции | Ввод-вывод, `Date.now()` без параметра (время передаётся явно — тесты с закреплёнными часами) |

Правила:
- **Одна функция — одна задача**, до ~60 строк. `think()` в 1 150 строк не повторять: оркестратор вызывает шаги, каждый шаг — отдельный модуль с тестом.
- **Зависимости передаются явно**: `createCtx({ env, workspaceId, requestId, now, log })` → `{ db, ai, channels, altegio, notify, clock }`. Сервис получает `ctx` параметром, а не берёт глобальные переменные. Так тесты подменяют что угодно, а арендатор виден в каждом вызове.
- **ИИ советует, код решает.** ИИ пишет текст и служебные строки (`[ЗАЯВКА]`, `[ОТМЕНА]`, `[РЕКВИЗИТЫ]`); создаёт, отменяет, отправляет только код по проверенным условиям (просьба клиента, ответ CRM, лимиты). Это правило проекта действует и после переезда.
- **Правда о записях — CRM** (журнал Altegio), не память бота и не история чата.
- Готовые фразы клиенту (`altSay`) — в одном месте, на трёх языках (ru/kk/en).
- Комментарии — по-русски, коротко и о том, **почему** так, особенно если правило найдено вживую (дата и случай).

### 5.2. Обработка ошибок

- Ошибки домена — класс `AppError { code, status, userMessage, retryable, cause }` (`src/lib/errors.js`). Наружу уходит только `userMessage` и `code`, никогда стек и текст чужого API.
- **Внешние вызовы** (ИИ, Altegio, Meta, Green-API, Telegram, Supabase): у каждого таймаут (ИИ 9 с на попытку; Altegio 8 с; Telegram 5 с), повтор только безопасных запросов (GET, 429, 5xx) и не больше 1–2 раз с паузой. Создание записи (`book_record`) **не повторять вслепую** — сначала проверить, не создалась ли.
- **Вебхуки:** неверная подпись/пароль → 401/403; всё остальное → быстро 200 после записи в очередь/БД (иначе провайдер повторит и клиент получит два ответа). Повторы отсекаются уникальностью `(channel_id, provider_message_id)`.
- **Клиент бизнеса никогда не остаётся без ответа:** любой сбой → безопасная фраза (`c.safe`) и сигнал администратору (Telegram/пульт), как делает `thinkSafe` сейчас.
- **Сбой хранилища не роняет ответ клиенту**: порядок «сохранить заявку → историю → ответить → уведомить» сохраняется.
- Логи — структурные JSON: `{ level, msg, requestId, workspaceId, chatId, route, ms, code }`. Номера телефонов и тексты сообщений — маскированные или усечённые.
- Каждая найденная вживую ошибка: **сначала сценарий в тестах, который её повторяет, потом исправление.**

### 5.3. Изоляция арендаторов (multi-tenancy)

1. В **каждой** таблице с данными бизнеса — `workspace_id uuid not null` + индекс; внешние ключи — внутри одного `workspace_id`.
2. **RLS включён на всех таблицах.** Политики: пользователь видит строки, только если он член `workspace_members` этого `workspace_id` (функция `is_member(workspace_id)`); `integration_secrets` — недоступна никому, кроме сервисного ключа.
3. Сервер ходит сервисным ключом (RLS обходится), поэтому: **каждый метод репозитория требует `workspaceId` первым параметром** и добавляет `.eq('workspace_id', …)`; метод без него — ошибка ревью. Проверка в CI: тест `test/tenancy/` пытается прочитать и изменить данные чужого арендатора через каждый маршрут API и ждёт 403/404.
4. **Арендатор определяется сервером**, а не телом запроса: из сессии/токена (пульт), из пути вебхука `/wa/:id`, `/ga/:id` + проверка подписи/пароля, из `instanceData.idInstance` (Green-API). Параметр `c=` из адреса — только выбор среди разрешённых пользователю (`canSee`).
5. Кэши (в памяти экземпляра и KV) — ключ всегда начинается с `workspace_id`.
6. Секреты арендатора расшифровываются только на время запроса и только своего `workspace_id`; не кладутся в логи, ответы API, `profile`.
7. Демо (`/demo`, встроенные демо-клиенты) не пересекается с настоящими данными: отдельные `workspace` с `is_demo = true`, номера вымышленные, звонки отключены.

### 5.4. Безопасность веба

- Все страницы с данными — через `page()`: `cache-control: no-store`, `x-frame-options: DENY`, CSP (`default-src 'self'`; внешних шрифтов и скриптов нет), `referrer-policy: same-origin`. Ответы API с данными — через `jsonP()` (`no-store`). Это проверяет контракт маршрутов (правила 4 и 5).
- Изменяющие запросы из браузера — проверка источника (`sameOrigin`); для Capacitor — CORS только для `capacitor://localhost` и `https://localhost` и только с токеном `Authorization: Bearer`.
- Ввод проверяется по схеме в контроллере (длины, форматы телефона, дат); HTML экранируется (`esc`).
- Подбор ключей ограничен (`keyGate`); после Supabase Auth — встроенные ограничения Supabase + свой лимит на IP.
- Персональные данные клиентов (телефоны, переписка) — только в нужном объёме; удаление по запросу (`act: forget` → в БД — удаление/обезличивание строк).

### 5.5. Тесты и выкладка

- `npm test` (smoke + platform + модули `src/` и границы + контракт маршрутов + золотые переписки, ~35 с) — зелёный **до** и **после** каждого изменения. Переезд модуля = тесты и ожидания не меняются, только импорт. `npm run check:types` — типы `src/`.
- Перед выкладкой, если менялись запись в Altegio, разбор ответа ИИ или защита ответа: `node test/review/run.mjs` («нового нет»).
- Пульт: `node test/e2e.mjs <папка>` (Playwright: телефон и компьютер, светлая и тёмная тема).
- `main` = боевой сайт (Cloudflare Workers Builds выкладывает каждый коммит). Новое — в `dev` (черновик `https://dev-ai-admin.azikonps4.workers.dev`). Выкладка в `main` — только по слову владельца, затем живая проверка `/`, `/?c=barber`, `/privacy` и автотест `/api/selftest?key=…&i=N`.
- Новые ветки-черновики не плодить: новый адрес нужен только ради нового секрета в Previews.
- Миграции БД — только вперёд, через `supabase/migrations/`; разрушающие изменения (удаление колонки) — в два шага: перестать использовать → удалить в следующем релизе.
- Результат сборки без панели: `gh api repos/aztenel/ai-admin/commits/<sha>/check-runs`.

### 5.6. Производительность и лимиты

- Worker: держать CPU на запрос малым (бесплатный тариф — 10 мс; для настоящих клиентов нужен платный тариф Workers). Тяжёлое — в очередь.
- KV: один ключ — не чаще раза в секунду (иначе 429), поэтому после переезда KV — только кэш и счётчики.
- Пульт: первая загрузка на среднем Android — до 2 с; JS пульта — до ~150 КБ (gzip); список чатов — виртуальный при > 200 строк.
- ИИ: в подсказку уходит до 24 последних реплик (`MAX_TURNS`), хранится 60 (`HIST_KEEP`); после переезда — учёт токенов на арендатора (`ai_usage`).

---

## 6. Полезные адреса и команды

- Боевой сайт: https://ai-admin.azikonps4.workers.dev · черновик `dev`: https://dev-ai-admin.azikonps4.workers.dev · демо пульта: `/demo`.
- Локально на заглушках: `node test/devserver.mjs` (вход ключом `owner-key-123456`).
- Сборка пульта: `node tools/build-pult.mjs` (после переезда — `npm run build:pult`).
- Программа для Windows: `desktop/README.md`, установщики — GitHub Releases (`pult-v0.2.*`).
- Из облачной сессии Claude может не быть доступа к npm/crates и нет доступа к сайтам `*.workers.dev`: проверка — через тесты на заглушках, сборки GitHub Actions и живые проверки владельца.
