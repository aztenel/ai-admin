# REFACTORING.md — дорожная карта переезда монолита

> Как превратить `worker.js` (6 218 строк, KV) в модульную мультиарендную систему на Supabase/PostgreSQL с мгновенным пультом и приложениями iOS/Android, **не останавливая боевого бота**.
> Правила кода и целевое дерево каталогов — `CLAUDE.md` (§4, §5). Поведение текущего кода — `docs/legacy-context.md`.

---

## Принципы переезда (действуют во всех фазах)

1. **Без «большого взрыва».** Старый и новый код живут рядом; трафик переключается по частям (по маршрутам, по арендаторам). В любой момент боевой сайт работает.
2. **Защитная сетка — существующие тесты.** `test/smoke.mjs` (592), `test/platform.mjs` (481), контракт маршрутов (709), золотые переписки (51), `test/unit/`, `test/e2e.mjs` (72), `test/review/` (~130) зелёные **до и после каждого шага**. Перенос кода в модуль = тесты не меняются. Если тест пришлось менять — это изменение поведения, его делают отдельным шагом и объясняют.
3. **Маленькие шаги.** Один перенос — одно изменение (коммит/PR): «вынести `altCall` в `services/integrations/altegio/client.js`». Удобно откатывать и проверять.
4. **Сначала заморозка поведения, потом перенос.** Перед переносом сложного места (`think()`, Altegio, рассылки) — дописать сценарии на то, что ещё не покрыто («золотые» переписки).
5. **Переключатели вместо веток-долгожителей.** Новые пути включаются переменной/флагом (`STORAGE_MODE`, `ROUTER_V2`, `workspaces.flags`) — сначала на демо и тестовом арендаторе, потом на всех.
6. **Откат — за минуты.** У каждой фазы описано, что вернуть, если что-то сломалось.
7. **Живые проверки владельца** после каждой фазы на черновике `dev` (Green-API номер друга, пробная локация Altegio 1399687), потом выкладка по слову «выкладывай».
8. **Новых функций во время фаз 1–3 не добавляем**, кроме срочных исправлений (их — сначала в тест, потом в код, в старом и новом месте одновременно).

### Шаг 0 (подготовка, до фазы 1) — сделан 11 октября 2026 в ветке `dev`

| Что | Зачем | Как сделано |
|---|---|---|
| Тег `monolith-v1` на текущем `main` | Точка отката | Тег на коммите `main`, с которого начат переезд (выкладку не запускает) |
| `jsconfig.json` + `// @ts-check` в новых файлах, `npx tsc --noEmit --checkJs` в CI | Типы без сборщика: тесты по-прежнему запускают JS в Node 20/22/24 | `jsconfig.json` (strict, только `src/**`), `npm run check:types` (TypeScript 6.0.2 через `npx`), шаг CI на Node 24 |
| `scripts/check-boundaries.mjs` (или dependency-cruiser) в CI | Запрет обратных зависимостей (CLAUDE.md §4) с первого же модуля | Свой скрипт без зависимостей: подключения находит разбор V8, плюс запрет `import()`, модулей Node, пакетов не из `dependencies`, выхода из `src/`, циклов. Идёт внутри `npm test` (`test/unit/boundaries.test.mjs`) — значит, и перед выкладкой |
| «Золотые» сценарии: 30–50 реальных переписок (обезличенных) с ожидаемыми ответами кода (не ИИ) | Ловят изменение поведения при переносе `think()` | `test/golden/` — 51 переписка. **Не настоящие**: собраны по ошибкам, найденным вживую и в проверках (`docs/legacy-context.md`, `test/review/README.md`), номера вымышленные. Настоящие обезличенные переписки владельца можно добавить позже тем же способом |
| Контрактные тесты маршрутов: для каждого из ~60 маршрутов — статус, форма ответа, права | Ловят поломки при смене роутера (фаза 3) | `test/contract/routes.mjs` — 96 адресов × гость/владелец/сотрудник + чужой сайт, поддельная cookie, подпись вебхуков; снимок `routes.snap.json` и правила прав, не зависящие от снимка |
| `src/` создан, `worker.js` импортирует из `src/` | С этого момента всё новое — только в `src/` | `src/lib/money.js` (функция `money` перенесена без изменений, `test/unit/money.test.mjs` сравнивает с прежней строкой) |

Побочный результат: контракт маршрутов нашёл страницы с данными без запрета кэша и встраивания (`/altegio`, `/selftest`, вход в `/leads` ключом в адресе) и ответы API без `no-store` (`/api/studio/*`, `/api/selftest`, `/api/history`) — исправлено тем же шагом. Вживую не проверено.

---

## Фаза 1. Изоляция бэкенда и модульный рефакторинг

**Цель:** разложить логику `worker.js` по модулям `src/` с явными границами; вынести внешние интеграции (Altegio, Green-API, Meta, Telegram, ИИ, 2ГИС-отзывы) в адаптеры. Хранилище пока **прежнее (KV)**, поведение — **прежнее**.

### 1.1. Порядок выноса (от листьев к центру)

Сначала то, от чего зависят все и что ни от чего не зависит; `think()` — последним.

| № | Что выносим | Откуда (функции `worker.js`) | Куда |
|---|---|---|---|
| 1 | Чистые помощники | `normPhone`, `phonesIn`, `redact`, `isJoke`, `hm`, `mins`, `isoDay`, `hhmm`, `local`, `money`, `clean`, `esc`, `hash`, `lowE`, `detectLang` | `src/lib/{phone,time,text,money,crypto}.js`, `services/conversation/language.js` |
| 2 | Ответы HTTP и безопасность | `html`, `page`, `json`, `jsonP`, `forbid`, `sameOrigin`, `metaSigOk`, `hmacB64`, `safeEq` | `src/lib/http.js`, `src/lib/crypto.js` |
| 3 | Конфигурация | Шапка с переменными, `CLIENTS`, `NICHES`, константы (`MAX_TURNS`, `HIST_KEEP`, лимиты Altegio) | `src/config/{env,builtin-clients,niches,constants}.js` |
| 4 | Хранилище за интерфейсом | `putHist`, `logTurns`, `histMeta`, `mergeProfile`, `loadLeads`/`saveLeads`/`allLeads`, `leadKey`, `kvRetry`, ключи `optout:`, `bc:*`, `rmq:` | `src/db/kv/*.js` с интерфейсами `ChatsRepo`, `LeadsRepo`, `OptoutsRepo`, `BroadcastsRepo`, `RemindersRepo` (те же, что потом у Postgres) |
| 5 | Адаптер **Telegram** | `notify`, `notifyOnce`, резервная копия заявок | `services/integrations/telegram/client.js` + `services/notifications/telegram.js` (тексты, «не чаще раза в 10 минут») |
| 6 | Адаптеры **ИИ** | `askGemini` (+ `THINK_LADDER`, `THINK_STEP`), `askClaude` | `services/ai/{gemini,claude,index}.js` — один интерфейс `ai.reply({ system, turns, model })`, выбор поставщика по имени модели, учёт токенов |
| 7 | Адаптер **Green-API** | `gaRoute`, `gaHook`, `gaCall`, `gaCode`, `gaKind`, `sendGreen`, `gaInfo`, `gaStateSignal`, разбор вебхука из `handleGreen` | `services/integrations/greenapi/{client,webhook,state,errors}.js` |
| 8 | Адаптер **Meta** | `sendWA`, `waErr`, `waSignal`, разбор вебхука из `handleWhatsApp`, отправка шаблонов из рассылок | `services/integrations/meta/{client,webhook,templates,errors}.js` |
| 9 | Общий **канал** | `waRoute`, `nicheOf`, окно 24 ч (`profile.li`), `seenBefore`, `markOptout`, `waCoex` (ответ с телефона) | `services/channels/index.js`: `channel.send(ctx, chat, text)`, `channel.canWrite(chat)`, `channel.receive(evt)` — Meta и Green-API за одним интерфейсом |
| 10 | Адаптер **Altegio** (HTTP) | `altCall`, `altRecord`, `altBase`, `altTimes`, `altDates`, `altCancel`, `altJournal`, `altEmailErr`, коды ошибок 422/431–438 | `services/integrations/altegio/{client,booking-api,journal-api,errors}.js` |
| 11 | Домен **записи** | `altPickServices`, `altPickStaff`, `altBook`, `altSnapshot`, `altFromJournal`, `altPrune`, `altIsGone`, `altSay`, `altLabel`, `altWhen`, `samePerson`, `altOther`, лимиты `altLimKeys`/`altOverLimit` | `services/booking/{pick,book,journal,replies,limits,people}.js` |
| 12 | Разбор ответа ИИ | `tidyTags`, `tagFields`, `tagsOf`, `altClaims`, `CLAIM_*`, `CL_*`, `PAY_TAG`, `myRecQ`, `wantsChange`, `ALT_*` выражения | `services/conversation/{tags,claims,intents}.js` |
| 13 | Защита ответа | `checkReply`, `pricesIn`, `allowedTimes`, `siteIn`, `offers` | `services/conversation/guard.js` |
| 14 | Паспорт | `parseSchedule`, `parseServices`, `parseRepairs`, `compileClient`, `syncClients`, `FIELDS` | `services/tenants/{passport,parse-schedule,parse-services,parse-repairs}.js` |
| 15 | Рассылки, напоминания, сводка | `bcParse`, `bcDate`, `bcSeg`, `bcRun`, `bcGaMsg`, `remindPlan`, `remindRun`, `remindText`, `digestRun`, `cronRun` | `services/broadcast/*`, `services/reminders/*`, `services/digest.js`, `src/jobs/cron.js` |
| 16 | **Отзывы (2ГИС)** | Поле `review`, вид напоминания `rv` в `remindPlan`/`remindText` | `services/reviews/index.js`: `reviewLink(workspace)`, `planReviewAsk(booking)`; адаптер `integrations/twogis/` — пустой интерфейс до появления API |
| 17 | **Trade-In (новое место)** | В коде нет; ближайшее — ниша `repair`, `parseRepairs`, `REPAIR_RULE` | `services/tradein/` — только каркас: интерфейс `estimate(device, condition)` по прайсу паспорта + заявка администратору. Реализация — после фазы 2, отдельной задачей |
| 18 | **`think()` → оркестратор** | `think`, `thinkSafe` (2256–3435) | `services/conversation/orchestrator.js` + шаги (см. 1.2) |
| 19 | Действия пульта | `/api/inbox/act` (`resolve`, `pause`, `resume`, `done`, `forget`), `send`, `view` | `services/inbox/*` + `controllers/inbox.js` |
| 20 | Страницы-служебки | `/diag`, `/altegio`, `/altegio/user`, `/selftest`, `/launch`, `/studio` | `controllers/*` |

### 1.2. Как разрезать `think()` (≈1 150 строк)

`think()` превращается в конвейер шагов с общим объектом `turn` (входящее сообщение, чат, арендатор, черновик ответа, решения):

```
orchestrator.handle(ctx, inbound)
  1. limits.check          — лимиты сообщений, «стоп», пауза бота, выключенный бот
  2. handoff.check         — «позовите человека» → пауза + сигнал администратору
  3. language.detect
  4. booking.snapshot      — окна Altegio + журнал записей (правда из CRM)
  5. prompt.build          — системная подсказка (факты, правила ниши, PAY/UPSELL/REPAIR)
  6. ai.reply (до 3 попыток: черновик → защита → повтор)
  7. guard.check           — цены/время/сайты только из фактов
  8. intents + tags        — что просил клиент; что предложил ИИ ([ЗАЯВКА], [ОТМЕНА], [РЕКВИЗИТЫ])
  9. decide (ветка):        booking/flows/{book,cancel,move,status}  |  booking/flows/down  |  leads/flows
 10. compose               — готовые фразы (altSay), реквизиты Kaspi, допродажа
 11. persist               — заявки → история → (ответ отправит контроллер) → уведомления
 12. schedule              — напоминания, отзыв
```

Каждый шаг — функция `(ctx, turn) → turn` с собственными тестами. Ветки 9 сейчас занимают 2552–3312; переносить по одной ветке, сверяясь с «золотыми» сценариями.

### 1.3. Как сохраняем работоспособность

- `worker.js` остаётся точкой входа и **реэкспортирует/вызывает** новые модули; его размер уменьшается с каждым переносом.
- Тесты импортируют `worker.js` как раньше — значит, проверяют и новый код.
- Перенос делается копированием функции «как есть» + замена глобалов на `ctx`; улучшения — отдельными шагами после переноса.
- После каждых 3–5 переносов — выкладка на черновик `dev` и короткая живая проверка владельцем (запись, отмена, рассылка в 1 номер, пульт).

### 1.4. Готово, когда

- [ ] `worker.js` — не больше ~600 строк (роутер + склейка), всё остальное в `src/`.
- [ ] Ни один модуль `services/` не читает `env` напрямую и не создаёт `Response`.
- [ ] Проверка границ зависимостей в CI зелёная.
- [ ] `npm test`, `test/review`, `e2e` — без изменений в ожиданиях.
- [ ] Живая проверка на `dev`: веб-чат, WhatsApp (Green-API), запись/отмена в Altegio, пульт, рассылка через Green-API на свой номер.

### 1.5. Риски и откат

| Риск | Защита | Откат |
|---|---|---|
| Тонкая регрессия в разборе ответа ИИ | «Золотые» сценарии + `test/review` перед каждой выкладкой | Revert одного коммита переноса |
| Циклические импорты | Проверка границ в CI | — |
| Вырос CPU на запрос (лишние вызовы) | Замер `ms` в логах до/после | Revert |

---

## Фаза 2. Проектирование и миграция БД (Supabase / PostgreSQL)

**Цель:** все данные бизнеса — в PostgreSQL с `workspace_id` и RLS; KV — только кэш и счётчики. Пульт получает изменения через Realtime. Переезд — по арендаторам: `kv → dual → pg`.

### 2.1. Подключение

- Проект Supabase (регион ближе к Казахстану/Европе — проверить задержку из Cloudflare).
- Доступ из Worker: `@supabase/supabase-js` (через `fetch`, работает в Workers) с **сервисным ключом**; атомарные операции — функции Postgres через `rpc()`. Прямой Postgres через **Hyperdrive** — только если понадобятся сложные транзакции.
- Доступ из пульта/приложений: `supabase-js` с `SUPABASE_ANON_KEY` + токен пользователя (Supabase Auth); чтение — через RLS, изменения — через API Worker (бизнес-правила остаются на сервере).

### 2.2. Схема (миграция `supabase/migrations/0001_init.sql`)

```sql
-- расширения
create extension if not exists pgcrypto;

-- ===== арендаторы и доступ =====
create table workspaces (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,                 -- бывший id паспорта: 'kairat', 'barber'
  name          text not null,
  niche         text not null,                        -- dent | beauty | barber | repair | …
  timezone      text not null default 'Asia/Almaty',
  is_demo       boolean not null default false,
  plan          text not null default 'trial',
  storage_mode  text not null default 'kv' check (storage_mode in ('kv','dual','pg')),
  flags         jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create table workspace_members (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner','admin','agent')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- паспорт бота (версии: откат настроек одним действием)
create table bots (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  version       int  not null,
  config        jsonb not null,                       -- поля паспорта: график, услуги, мастера, pay, upsell, review, repairs, remind, digest…
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (workspace_id, version)
);
create unique index bots_one_active on bots(workspace_id) where is_active;

-- каналы: номер Meta, номер Green-API, веб-чат, Telegram
create table channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  type          text not null check (type in ('wa_cloud','green_api','web','telegram')),
  external_id   text,                                 -- phone_number_id Meta | idInstance Green-API
  display_phone text,
  state         jsonb not null default '{}',          -- authorized/blocked/качество/шаблоны
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (type, external_id)
);

-- секреты интеграций: зашифрованы ключом SECRETS_MASTER_KEY в Worker; клиентам недоступны вовсе
create table integration_secrets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  kind          text not null,                        -- wa_token | app_secret | ga_token | altegio_user | altegio_loc | tg_chat
  channel_id    uuid references channels(id) on delete cascade,
  ciphertext    bytea not null,
  iv            bytea not null,
  updated_at    timestamptz not null default now()
);
-- один секрет каждого вида на арендатора (и на канал, если он указан)
create unique index integration_secrets_one on integration_secrets
  (workspace_id, kind, coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ===== люди и переписка =====
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  phone_e164    text,                                 -- +77011234567
  name          text,
  wa_name       text,
  lang          text,                                 -- ru | kk | en
  consent_at    timestamptz,
  opted_out_at  timestamptz,                          -- «стоп» на рассылки
  tags          text[] not null default '{}',
  note          text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, phone_e164)
);

create table chats (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  channel_id        uuid not null references channels(id),
  contact_id        uuid references contacts(id),
  external_chat_id  text not null,                    -- номер WhatsApp или id сессии веб-чата
  status            text not null default 'open' check (status in ('open','pending','resolved')),
  bot_state         text not null default 'active' check (bot_state in ('active','paused','off','stopped')),
  paused_until      timestamptz,
  need_reason       text,                             -- human | limit | media | ai | req | lead | call | off
  need_at           timestamptz,
  assignee_id       uuid references auth.users(id),
  last_message_at   timestamptz,
  last_inbound_at   timestamptz,                      -- окно 24 ч WhatsApp
  last_preview      text,
  unread_count      int not null default 0,
  memory            jsonb not null default '{}',      -- служебная память бота (бывший profile: cxAsk, wish, req…)
  forgot_at         timestamptz,                      -- «Очистить память бота»
  created_at        timestamptz not null default now(),
  unique (channel_id, external_chat_id)
);
create index chats_inbox on chats (workspace_id, need_at desc nulls last, last_message_at desc);

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  chat_id             uuid not null references chats(id) on delete cascade,
  direction           text not null check (direction in ('in','out')),
  sender_type         text not null check (sender_type in ('contact','bot','agent','system')),
  sender_user_id      uuid references auth.users(id),
  body                text,
  media               jsonb,                          -- { kind, provider_id, mime, size }
  provider_message_id text,                           -- wamid / idMessage — защита от повторов вебхука
  status              text,                           -- sent | delivered | read | failed
  meta                jsonb not null default '{}',    -- служебные строки ИИ, причина защиты, модель, токены
  created_at          timestamptz not null default now()
);
create unique index messages_dedupe on messages (chat_id, provider_message_id) where provider_message_id is not null;
create index messages_chat_time on messages (chat_id, created_at);

-- ===== записи, заявки, рассылки =====
create table bookings (                                -- зеркало записей CRM (правда — в Altegio)
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  contact_id    uuid references contacts(id),
  chat_id       uuid references chats(id),
  provider      text not null default 'altegio',
  external_id   text not null,                        -- record_id
  external_hash text,                                 -- record_hash (для отмены через онлайн-запись)
  starts_at     timestamptz not null,
  services      text,
  staff_name    text,
  person_name   text,
  state         text not null default 'active' check (state in ('active','cancel_requested','cancelled','done','gone')),
  created_by    text not null default 'bot',          -- bot | admin | crm
  synced_at     timestamptz,
  unique (workspace_id, provider, external_id)
);

create table leads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  chat_id       uuid references chats(id),
  contact_id    uuid references contacts(id),
  kind          text not null default 'lead' check (kind in ('lead','cancel','change','callback','tradein')),
  name          text, phone text, service text, wanted_time text,
  booking_id    uuid references bookings(id),
  status        text,                                 -- null = ждёт | выполнена | отменена | клиент передумал | заменена
  note          text,
  created_at    timestamptz not null default now()
);
create index leads_open on leads (workspace_id, created_at desc) where status is null;

create table broadcasts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  channel_id    uuid not null references channels(id),
  name          text not null,
  template      text, lang text, params text, body text, image_url text,
  segment       jsonb,                                -- { kind: 'idle'|'bday', days }
  daily_cap     int not null default 50,
  state         text not null default 'draft',        -- draft | running | paused | done
  hold_reason   text,
  next_at       timestamptz,
  created_at    timestamptz not null default now()
);
create table broadcast_recipients (
  broadcast_id  uuid not null references broadcasts(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  phone_e164    text not null,
  name          text,
  state         text not null default 'queued',       -- queued | claimed | sent | failed | skipped | unknown
  error         text,
  claimed_at    timestamptz, sent_at timestamptz,
  primary key (broadcast_id, phone_e164)
);

create table reminders (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  booking_id    uuid not null references bookings(id) on delete cascade,
  kind          text not null check (kind in ('d1','h2','rv')),  -- накануне | за 2 часа | отзыв
  due_at        timestamptz not null,
  state         text not null default 'queued',
  sent_at       timestamptz,
  unique (booking_id, kind)
);

-- ===== служебное =====
create table device_tokens (                           -- push для приложений (фаза 5)
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios','android','web','windows')),
  token text not null, updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
create table ai_usage (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  day date not null, model text not null,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0, calls int not null default 0,
  primary key (workspace_id, day, model)
);
create table audit_log (
  id bigserial primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  actor text not null,                                 -- user:<uuid> | bot | system | webhook
  action text not null, target text, details jsonb,
  created_at timestamptz not null default now()
);
```

### 2.3. Безопасность строк (миграция `0002_rls.sql`)

```sql
create function is_member(ws uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()) $$;

alter table workspaces           enable row level security;
alter table workspace_members    enable row level security;
alter table bots                 enable row level security;
alter table channels             enable row level security;
alter table integration_secrets  enable row level security;   -- политик нет: доступ только сервисному ключу
alter table contacts             enable row level security;
alter table chats                enable row level security;
alter table messages             enable row level security;
alter table bookings             enable row level security;
alter table leads                enable row level security;
alter table broadcasts           enable row level security;
alter table broadcast_recipients enable row level security;
alter table reminders            enable row level security;
alter table ai_usage             enable row level security;
alter table audit_log            enable row level security;

create policy ws_read  on workspaces for select using (is_member(id));
create policy m_read   on workspace_members for select using (is_member(workspace_id));
-- одинаковая политика чтения для таблиц с workspace_id:
create policy r on chats     for select using (is_member(workspace_id));
create policy r on messages  for select using (is_member(workspace_id));
create policy r on contacts  for select using (is_member(workspace_id));
create policy r on bookings  for select using (is_member(workspace_id));
create policy r on leads     for select using (is_member(workspace_id));
create policy r on broadcasts for select using (is_member(workspace_id));
-- запись из клиентов не разрешаем: изменения идут через API Worker (правила бизнеса на сервере)
```

### 2.4. Realtime (миграция `0003_realtime.sql`)

```sql
alter publication supabase_realtime add table chats, messages, leads;
```

Пульт подписывается на `postgres_changes` по `chats` и `messages` с фильтром `workspace_id=eq.<id>`; RLS не даст получить чужое. Опрос раз в 15 с остаётся запасным (если сокет оборвался) и реже — раз в 60 с.

### 2.5. Атомарные операции (функции Postgres вместо `kvRetry`)

| Функция | Заменяет | Что делает атомарно |
|---|---|---|
| `append_turn(chat, direction, sender, body, provider_id)` | `logTurns`, `mergeProfile` | Вставка сообщения + обновление `last_*`, `unread_count`, `need_*`; повтор вебхука — без дубля |
| `claim_broadcast_batch(broadcast, n)` | «порция отмечается до отправки» (`bcRun`) | `update … set state='claimed' … for update skip locked` — никто не получит сообщение дважды |
| `consume_limit(workspace, key, max, window)` | `bk:`, `bcq:` | Счётчики пределов (или оставить в KV) |
| `upsert_bookings_from_journal(workspace, contact, rows)` | `altFromJournal` | Зеркало записей CRM; исчезнувшие → `gone`, их заявки → «отменена» |

### 2.6. Перенос данных из KV

1. **`scripts/migrate-kv-to-pg.mjs`** (запуск из CI или вручную с ключами из секретов): читает KV через Cloudflare API по префиксам и пишет в Postgres:

| KV | → Postgres |
|---|---|
| `cfg:all[id]` | `workspaces` (slug=id) + `bots` (version 1) + `channels` (по переменным `WA_*_<ID>`, `GA_*_<ID>`) |
| переменные `WA_TOKEN_<ID>`, `GA_TOKEN_<ID>`, `ALTEGIO_USER_<ID>`, `ALTEGIO_LOC_<ID>`, `TG_CHAT_<ID>` | `integration_secrets` (шифруются; вводит владелец в «Мои боты» — значения из панели скрипт не видит) |
| `h:<ch>:<cid>:<id>` | `contacts` (телефон из id/профиля), `chats` (флаги из `profile`), `messages` (из `turns`, время `t`), `bookings` (из `profile.bookings`) |
| `leads:<cid>` ∪ `lead:<cid>:<day>:<id>` | `leads` (дубли по `id` склеиваются) |
| `optout:<cid>:<номер>` | `contacts.opted_out_at` |
| `bc:<cid>:<id>` и связанные | `broadcasts`, `broadcast_recipients` |
| `rmq:<cid>`, `rms:` | `reminders` |

2. Скрипт **идемпотентный** (повторный запуск ничего не дублирует: `on conflict do nothing/update`) и пишет отчёт: сколько ключей, сколько строк, что пропущено и почему.

### 2.7. Переключение по арендаторам: `kv → dual → pg`

| Режим | Чтение | Запись | Назначение |
|---|---|---|---|
| `kv` | KV | KV | Как сейчас |
| `dual` | KV (правда) | KV **и** Postgres | Проверка: ночной скрипт сравнивает KV и Postgres, расхождения — в отчёт |
| `pg` | Postgres | Postgres (+ KV-кэш) | Цель |

Порядок: демо-арендаторы → тестовый `kairat` (пробная локация, номер друга) → настоящие клиенты по одному. `db/storage.js` выбирает репозиторий по `workspaces.storage_mode`; интерфейсы репозиториев одинаковые (сделаны в фазе 1, шаг 4).

### 2.8. Вход через Supabase Auth

- Владелец и сотрудники — пользователи Supabase (почта, при желании телефон). Роли — `workspace_members.role`.
- Старый вход ключом (`LEADS_KEY`, ключи сотрудников, cookie `aia`) работает параллельно до конца фазы 5, затем выключается.
- Пульт в браузере может остаться на cookie (своя страница), **приложения — только Bearer-токен** (cookie в WKWebView и на чужом origin ненадёжны).

### 2.9. Готово, когда

- [ ] Миграции применяются с нуля (`supabase db reset`) и на черновом проекте.
- [ ] Все арендаторы в режиме `pg` минимум неделю без расхождений в ночном сравнении.
- [ ] Тест изоляции (`test/tenancy/`): пользователь арендатора A не читает и не меняет ничего у B — ни через API Worker, ни через Supabase напрямую с `anon`-ключом, ни через Realtime.
- [ ] Гонки «два сообщения одного чата» и «двойная отправка рассылки» воспроизведены тестом и не воспроизводятся.
- [ ] Резервное копирование Supabase (PITR или ежедневный дамп) включено и проверено восстановлением.

### 2.10. Риски и откат

| Риск | Защита | Откат |
|---|---|---|
| Задержка до БД увеличила время ответа | Замер до/после; индексы; один запрос на шаг; кэш паспорта в памяти экземпляра | `storage_mode = 'kv'` у арендатора |
| Расхождение данных в `dual` | Ночное сравнение, отчёт | Остаться в `dual`, исправить, перезапустить скрипт |
| Утечка между арендаторами | RLS + `workspaceId` в каждом методе + тест изоляции в CI | Немедленное выключение доступа клиентов (`anon`) |
| Supabase недоступен | Ответ клиенту не зависит от сохранения (порядок как сейчас), запись в очередь на повтор | Временный `kv` |

---

## Фаза 3. Очистка Cloudflare Worker

**Цель:** `src/index.js` — 100–150 строк: принять запрос, найти маршрут, прогнать middleware, вызвать контроллер. Всё тяжёлое — в очередь и фоновые задачи. Статика — через Static Assets.

### 3.1. Целевая точка входа

```js
// src/index.js — только склейка; логики здесь нет
import { router } from "./routes/index.js";
import { runCron } from "./jobs/cron.js";
import { handleQueue } from "./jobs/queue.js";
import { createCtx } from "./services/ctx.js";

export default {
  fetch: (req, env, exec) => router.handle(req, createCtx(env, exec)),
  scheduled: (evt, env, exec) => exec.waitUntil(runCron(createCtx(env, exec), evt.scheduledTime)),
  queue: (batch, env, exec) => handleQueue(batch, createCtx(env, exec)),
};
```

```js
// src/routes/index.js — таблица маршрутов
export const router = createRouter([requestId, errorBoundary, securityHeaders])
  .post("/wa/:id",        webhooks.meta)            // подпись Meta → очередь → 200
  .post("/ga/:id",        webhooks.greenapi)        // пароль вебхука → очередь → 200
  .post("/",              webhooks.metaShared)      // старый общий номер
  .get ("/inbox",         auth.page,  inbox.page)
  .all ("/api/inbox/*",   auth.api,   tenant, inbox.api)
  .all ("/api/studio/*",  auth.owner, studio.api)
  .all ("/api/bc/*",      auth.api,   tenant, broadcast.api)
  .post("/api/chat",      rateLimit,  chat.post)
  // … остальные ~50 маршрутов — по одной строке
  .fallback(assets.serve);                          // public/ через Workers Static Assets
```

### 3.2. Шаги

1. **Роутер с таблицей маршрутов** (свой маленький, без зависимостей, или `itty-router`/`hono` — решить ADR). Включается флагом `ROUTER_V2`: старая цепочка `if (P === …)` остаётся запасной до прохождения контрактных тестов (шаг 0).
2. **Middleware:** `requestId`, `errorBoundary` (любая ошибка → `AppError` → понятный ответ + лог), `securityHeaders` (то, что сейчас в `page()`), `auth` (cookie/Bearer), `tenant` (workspace из сессии и `c=`, проверка `canSee`), `sameOrigin`, `cors` (для Capacitor), `rateLimit`.
3. **Вебхуки через очередь** (Cloudflare Queues; нужен платный тариф Workers): контроллер проверяет подпись/пароль, пишет событие в очередь, отвечает 200 за миллисекунды. Обработчик очереди вызывает `conversation.orchestrator`, повторы отсекаются уникальностью `provider_message_id`. До перехода на платный тариф — `ctx.waitUntil` (как сейчас).
4. **Фоновые задачи** — `src/jobs/cron.js`: `broadcast.tick`, `reminders.tick`, `digest.tick`, ночное сравнение `dual`, резервная копия заявок. Каждая задача ограничена по времени и идемпотентна.
5. **Статика:** `wrangler.jsonc` → `"assets": { "directory": "./public", "binding": "ASSETS" }`. Пульт, манифесты, значки, `privacy` — файлами из `public/`, а не строками внутри Worker (`pult.gen.js` удаляется в фазе 4). Проверка: заголовки безопасности для HTML пульта — через `_headers` или через Worker-обёртку.
6. **`worker.js` удаляется**, `main` в `wrangler.jsonc` → `src/index.js`. Тесты импортируют `src/index.js`.

### 3.3. Готово, когда

- [ ] `src/index.js` ≤ 150 строк, `src/routes/index.js` — только таблица.
- [ ] Контрактные тесты всех маршрутов зелёные на новом роутере; флаг `ROUTER_V2` удалён.
- [ ] Вебхук отвечает < 100 мс (замер в логах), ответ клиенту приходит как раньше.
- [ ] Повторный вебхук Meta/Green-API не даёт второго ответа (тест).
- [ ] `wrangler deploy --dry-run` в CI, выкладка черновика, живая проверка.

### 3.4. Риски и откат

| Риск | Защита | Откат |
|---|---|---|
| Маршрут потерялся при переносе | Контрактные тесты на каждый маршрут | `ROUTER_V2 = 0` |
| Очередь копит сообщения (сбой ИИ) | Ограничение повторов, «мёртвая» очередь, сигнал в Telegram | Обработка в `waitUntil` |
| Static Assets отдали HTML без CSP | Тест заголовков в e2e | Раздача через Worker |

---

## Фаза 4. Полировка PWA-пульта и анимации

**Цель:** пульт — отдельное приложение `apps/pult` (сборка Vite, Tailwind CSS v4), мгновенный (Realtime, оптимистичная отправка), удобный на телефоне (жесты, вибро-отклик в приложении), без потери того, что уже работает (дизайн «графит + шафран», анимации из `pult/motion.css`, уведомления, тёмная/светлая тема, вырезы экрана).

### 4.1. Перенос кода пульта

| Сейчас | Будет |
|---|---|
| `pult/app.js` (455 строк, свой `h()`), `views.js`, `demo.js` | `apps/pult/src/{app,views,components,state,api}/` — ES-модули; по желанию лёгкий фреймворк (Preact/Svelte — решение ADR: важно для виртуального списка и состояния) |
| `pult/design.base.css`, `layout.css`, `motion.css` | `apps/pult/src/styles/tokens.css` (те же CSS-переменные — источник правды цветов) + Tailwind v4 (`@theme` ссылается на переменные), container queries Tailwind вместо ручных `@container` |
| `tools/build-pult.mjs` → `pult.gen.js` (строка в Worker) | `vite build` → `public/app/` (файлы с хешами, кэш на год), Worker отдаёт `index.html` с заголовками безопасности |
| Опрос `/api/inbox/list` раз в 15 с | Supabase Realtime (`chats`, `messages`) + опрос раз в 60 с запасным |
| `/demo` — отдельная сборка `PULT_DEMO` | Та же сборка, режим демо по флагу; данные — `demo.js` (вымышленные, номера замаскированы) |

### 4.2. Интерфейс и микровзаимодействия

- **Список чатов:** виртуальный список (> 200 строк), «лента внимания» у ждущих чатов (уже есть), счётчик непрочитанных (новое: `chats.unread_count`), фильтры «Ждут ответа / Все / Бот молчит / Сайт / Мои».
- **Жесты на телефоне:** свайп строки влево — «Забрать чат» / «Готово»; свайп вправо по переписке — назад к списку; потянуть вниз — обновить. Жесты дублируются кнопками (доступность).
- **Переписка:** оптимистичная отправка (сообщение сразу в ленте, при ошибке — «Не отправлено, повторить»), статусы доставки (Meta/Green-API), «печатает…» бота, группировка по дням, быстрые ответы, реквизиты «₸», вложения (фото, голосовые) с предпросмотром.
- **Анимации** (сохраняем принцип: двигается то, что ответило на действие; постоянно — только «лента внимания»): появление сообщения, открытие чата, листы снизу/окна по центру, «прыжок» счётчика, переход между разделами; всё — через `transform/opacity`, 60 кадров на среднем Android, `prefers-reduced-motion` уважается.
- **Карточка клиента:** записи из журнала CRM (правда), заявки, метки, заметка, история визитов.
- **Офлайн:** service worker кэширует оболочку пульта; последние 50 чатов — в IndexedDB; при обрыве — баннер «Нет связи», отправка встаёт в очередь.
- **Уведомления:** браузер — Notification API (колокольчик, уже есть), Windows — Tauri, телефоны — push (фаза 5). Один модуль `notify` с выбором способа.
- **Доступность:** фокус с клавиатуры, размеры касания ≥ 44 px, контраст текста ≥ 4.5:1 в обеих темах, подписи для читалок.

### 4.3. Бюджеты и проверки

- JS пульта ≤ 150 КБ gzip, CSS ≤ 30 КБ; первая отрисовка на среднем Android ≤ 2 с; ответ на касание ≤ 100 мс.
- Playwright: телефон 390×844 и компьютер 1440×900, светлая и тёмная тема; снимки экрана сравниваются с эталоном (визуальная регрессия).
- Lighthouse PWA/Accessibility ≥ 90 в CI.
- Проверка на настоящих устройствах владельца: iPhone (Safari, «на экран Домой»), Android (Chrome), Windows (программа «Пульт»).

### 4.4. Готово, когда

- [ ] `pult.gen.js` удалён, пульт раздаётся из `public/app/`.
- [ ] Новое сообщение клиента появляется в пульте < 2 с без опроса.
- [ ] Все прежние сценарии e2e зелёные + жесты, офлайн, оптимистичная отправка.
- [ ] Программа для Windows работает с новым пультом без пересборки (она открывает сайт).

### 4.5. Риски и откат

| Риск | Защита | Откат |
|---|---|---|
| Realtime не доходит (сеть, прокси) | Запасной опрос | Только опрос |
| Новый пульт хуже старого на слабых телефонах | Бюджеты + проверка на устройствах | Старый пульт по адресу `/inbox?legacy=1` до конца фазы |

---

## Фаза 5. Мобильные приложения (Capacitor: iOS и Android)

**Цель:** приложения «Пульт» в App Store и Google Play: тот же пульт из `public/app/`, родные push-уведомления, вибро-отклик, правильная клавиатура и кнопка «назад».

### 5.1. Устройство

- Папка `mobile/`: `capacitor.config.ts`, `android/`, `ios/` (создаются `npx cap add android|ios`).
- **Сборка пульта внутри приложения** (`webDir: '../public/app'`), а не загрузка сайта по адресу: так приложение открывается без сети, проходит проверку Apple (App Review 4.2 «минимальная функциональность») и обновляется вместе с релизом. Данные — через API Worker и Supabase.
- **Вход — токен, не cookie:** Supabase Auth в приложении, токен в защищённом хранилище; запросы к Worker с `Authorization: Bearer`. CORS Worker разрешает `capacitor://localhost` (iOS) и `https://localhost` (Android).

```ts
// mobile/capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'kz.aiadmin.pult',
  appName: 'Пульт',
  webDir: '../public/app',
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Keyboard: { resize: 'body' },
    SplashScreen: { launchShowDuration: 0 },
  },
};
export default config;
```

Плагины: `@capacitor/push-notifications` (или `@capacitor-firebase/messaging`), `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/keyboard`, `@capacitor/app` (кнопка «назад» Android, ссылки-приглашения), `@capacitor/preferences` + защищённое хранилище токена, `@capacitor/share`, `@capacitor/splash-screen`. Версии — актуальные стабильные на момент начала фазы.

### 5.2. Push-уведомления

```
клиент пишет в WhatsApp → вебхук → очередь → orchestrator → chats.need_at обновлён
   → services/notifications/push: найти device_tokens участников workspace (роль, настройки «тихих часов»)
   → FCM HTTP v1 (Android; iOS — через FCM или APNs напрямую)
   → нажатие на уведомление → приложение открывает нужный чат (deep link /inbox#wa:<номер>)
```

- Таблица `device_tokens` (фаза 2), регистрация токена после входа, удаление при выходе.
- Push не содержит текста сообщения целиком, только «Клиент ждёт ответа: Имя» (персональные данные на экране блокировки — минимум).
- Те же правила, что у уведомлений браузера/Windows: один чат не «звенит» дважды, открытый перед глазами чат не уведомляет.

### 5.3. Сборка и публикация

| Платформа | Где собирается | Что нужно от владельца |
|---|---|---|
| Android | GitHub Actions `ubuntu-latest`: `npm ci` → `vite build` → `npx cap sync android` → Gradle `bundleRelease` (AAB), подпись ключом из секретов | Аккаунт Google Play Console (разовый взнос), ключ подписи (создаём один раз, хранить копию!), политика конфиденциальности (`/privacy`), анкета Data safety |
| iOS | GitHub Actions `macos-latest`: Xcode, `npx cap sync ios`, `xcodebuild archive`, загрузка в TestFlight (fastlane) | Apple Developer Program (ежегодный взнос), сертификаты и профили (fastlane match), описание и скриншоты, ответы о данных (App Privacy), при регистрации аккаунтов в приложении — удаление аккаунта из приложения |

- Номера версий: `1.0.<номер сборки CI>`; пробные сборки — внутреннее тестирование Google Play и TestFlight; выход в магазины — по слову владельца.
- Workflow `.github/workflows/mobile.yml`, по образцу `desktop.yml` (сборка, пробный запуск на эмуляторе Android со снимком экрана, артефакты).

### 5.4. Проверки

- Эмулятор Android в CI: приложение открывается, вход, список чатов, открытие чата, снимок экрана.
- iOS-симулятор в CI: то же.
- Push: тестовый арендатор, тестовое устройство владельца — уведомление приходит при закрытом приложении, нажатие открывает чат.
- Ручная проверка владельцем на своём телефоне перед отправкой в магазин.

### 5.5. Готово, когда

- [ ] Приложение Android во внутреннем тестировании Google Play, iOS — в TestFlight.
- [ ] Push приходят на обе платформы при закрытом приложении; нажатие открывает чат.
- [ ] Вход токеном, выход очищает токен и регистрацию push.
- [ ] Владелец проверил на своих устройствах и сказал «публикуем».

### 5.6. Риски и откат

| Риск | Защита | Откат |
|---|---|---|
| Отказ Apple (4.2, приватность) | Пульт внутри приложения, родные push, понятная политика, тестовый аккаунт для проверяющих | Исправить и отправить повторно; PWA и Windows работают независимо |
| Потерян ключ подписи Android | Копия в двух местах (менеджер паролей владельца + секрет CI) | Play App Signing (Google хранит ключ) |
| Push не доходят на часть Android (энергосбережение) | Канал уведомлений с высоким приоритетом, подсказка в настройках | Telegram-уведомления остаются |

---

## Сводка: зависимости фаз

```
Шаг 0 ──► Фаза 1 (модули) ──► Фаза 2 (БД, Auth, Realtime) ──► Фаза 3 (роутер, очередь, статика)
                                      │                                  │
                                      └──────────────► Фаза 4 (пульт: Realtime, Vite, Tailwind) ──► Фаза 5 (Capacitor)
```

- Фазы 1 → 2 → 3 — строго по порядку (каждая опирается на интерфейсы предыдущей).
- Фаза 4 может начаться после фазы 2 (нужен Realtime) параллельно с фазой 3.
- Фаза 5 — после фазы 4 (пульт собирается в `public/app/`) и Supabase Auth (фаза 2).
- Перенос записи в Altegio на журнал CRM и правило «записывать только по просьбе клиента» (см. `docs/legacy-context.md`, проблемы 10 октября) делаются **в фазе 1, шаг 11**, отдельной задачей с живой проверкой — это главный источник живых ошибок.

## Определение готовности любого шага (Definition of Done)

- [ ] `npm test` зелёный на Node 20/22/24; `tsc --checkJs` и проверка границ зелёные.
- [ ] Если менялись запись/разбор ИИ/защита — `node test/review/run.mjs` «нового нет».
- [ ] Если менялся пульт — `e2e` зелёный, снимки экрана просмотрены.
- [ ] Найденная ошибка повторена тестом до исправления.
- [ ] `CLAUDE.md` (карта, переменные, дерево) обновлён в том же изменении.
- [ ] Черновик `dev` собран, владельцу дан короткий список живых проверок; статус честно разделён: «проверено вживую / на заглушках / не проверено».
