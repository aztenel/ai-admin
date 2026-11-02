# Аудит: сообщения, база клиентов и планировщик Winchester (31.10.2026)

Основа — ТЗ «Winchester · Полная бизнес-логика сообщений, клиентской базы и умного планировщика», v1.0 от 31.10.2026
(дальше — ТЗ), и код ветки `dev` (`45da286`, совпадает с `main` на момент аудита). Аудит только чтением: production не
менялся, ничего не отправлялось, поля Altegio, которые не проверены вживую, помечены «не проверено».

## 0. Коротко

- **Есть и работает (на заглушках):** снимок базы клиентов из журнала Altegio и 7 фиксированных сегментов; рассылки с
  паузой/стопом/пределами и повтором временных ошибок; «стоп» по словарю на 3 языках (и при выключенном боте);
  напоминания накануне / за 2 часа и просьба об отзыве по всем записям журнала (на сервере выключены, `REMIND_GA_WINCHESTER`).
- **Нет:** единой базы контактов (с источниками, согласиями, историей), видов запретов кроме одного «стопа», одобрения
  пакетов, теста себе, ручного исключения получателей, импорта в постоянную базу, календаря-планировщика, учёта записей
  после сообщений, единого журнала событий и аудита действий сотрудников, ролей с раздельными правами.
- **Главные противоречия:** согласие на маркетинг (код — пишем всем клиентам Altegio, ТЗ — только с основанием), интервал
  14 дней против 30, «стоп» блокирует и сервисные сообщения, рассылки со второго номера в коде запрещены.
- **Хранилище:** требования ТЗ (история согласий, аудит, статусы получателей, идемпотентные события, фильтры И/ИЛИ) не
  ложатся на KV. Предложение — внедрять сразу на PostgreSQL (решение проекта, `REFACTORING.md`, фаза 2), но только
  новые таблицы сообщений и контактов Winchester, за флагом.

## 1. Карта: ТЗ → что есть сейчас

Статусы: **есть** · **частично** · **нет**.

| ТЗ | Требование | Статус | Что сейчас (где) |
|---|---|---|---|
| §2 | Altegio — источник клиентов, визитов, будущих записей, отмен | частично | `services/crm/snapshot.js`: журнал за 90 дней назад и 60 вперёд, ночью в 04:00 и кнопкой; `services/reminders/journal.js`: вчера–завтра раз в 15 мин. Altegio ID клиента не хранится (ключ — номер); перенос виден только как новое время, история переносов не хранится |
| §2 | Импорт Excel/CSV с проверкой колонок, дублей, согласия | частично | `services/broadcast/parse.js` (`bcParse`): список для одной рассылки, без согласия и без сохранения контактов |
| §2 | Ручное добавление контактов | нет | — |
| §2 | Вебхуки Altegio, иначе опрос; полная сверка; время синхронизации и ошибки | частично | Только опрос. Время и ошибка снимка — `crm:<id>:snap.at`, `crm:<id>:err` (блок базы на `/broadcast`, пульт). У напоминаний — `jrs:` без показа. Есть ли у Altegio вебхуки для нашего ключа — не проверено |
| §2 | Объединение по устойчивому ID и номеру, provenance; импорт не перезаписывает запреты | нет | Только по нормализованному номеру (`normPhone`) |
| §2.1 | Актуальность с индикацией задержки; проверка перед отправкой | частично | Пульт опрашивает раз в 15 с. Рассылка из базы — снимок не старше 3 дней (`CRM_FRESH_BC`), автосценарий — 36 ч и свежие записи за сегодня (`crmBookedNow`). **Ручная рассылка не видит записи, сделанные после ночного снимка.** Напоминания перечитывают журнал дня перед отправкой |
| §3 | Карточка контакта, источники, история кампаний, ручное редактирование с аудитом, поиск | нет | Снимок `crm:<id>:snap` (одно значение KV: номер, имя, первый/последний визит, число визитов, мастер, услуга, будущая запись) + переписки `h:` + `optout:`. Список сегмента с фильтрами и номерами маской — `GET /api/crm/list` |
| §3 | Импорт ≠ согласие; без основания маркетинг запрещён | нет | Согласий на маркетинг нет вообще (§2 «Противоречия», п. 1) |
| §4 | Пять видов ограничений с основанием, автором, историей | частично | Один вид — `optout:<компания>:<номер>` (время, без автора и причины): «стоп» словарём `STOP` (`orchestrator.js`), Meta 131050 и кнопка шаблона (`broadcast/holds.js`). Охлаждение — только 14 дней после маркетинга (`bcm:`). Нет: запрета отправителя, полной блокировки, охлаждения до даты, технической недоступности, ручной проверки спорных ответов, снятия отказа из пульта |
| §4 | Проверка запретов при сборке, одобрении и перед отправкой | частично | Сборка — да (`crmPick`), перед порцией рассылки — да (`bcTick` → `crmView`), одобрения нет |
| §5 | Сегменты: 21–35/36–60/61–90/90+, число визитов, мастер, индивидуальный интервал | частично | `services/crm/segments.js`: `pora`, `long`, `away`, `new`, `regular`, `staff:<имя>`, `all`. Нет 90+ (снимок читает 90 дней) и индивидуального интервала |
| §5 | Фильтры по записям, коммуникациям, источнику; И/ИЛИ; сохранённые; обязательные исключения | частично | Обязательные исключения есть: «стоп», будущая запись, визит < 14 дней, маркетинг < 14 дней. Остального нет |
| §5 | Кампания хранит снимок одобренной аудитории + проверка перед отправкой | частично | Рассылка хранит список номеров (`bcr:`) и перепроверяет исключения перед порцией. Одобрения нет |
| §6 | Календарь, скользящий интервал 30 дней, пересчёт плана, резерв под сервис | нет | Автосценарий «Пора на стрижку» раз в день (`services/crm/auto.js`, ровно N дней, `cap`). Интервал — 14 дней. Месячного сброса нет (и не нужен). Очереди сервиса и маркетинга раздельные, общего бюджета номера нет |
| §6 | Ручное одобрение пакетов, пауза и отмена очереди | частично | Пауза/продолжить/стоп/удалить — `controllers/broadcast.js` (`act`). Одобрения нет |
| §7 | Аудитория → фильтры → шаблон → проверка → тест себе → одобрение → расписание → журнал | частично | Есть: сегмент или список, проверка (`/api/bc/check`), часы, предел в день, отчёт «не дошло». Нет: теста себе, одобрения, ручного исключения с причиной. Рассылка из базы через Green-API запрещена (`gaNoBroadcast`, `crmRecipients`). Пульт `apps/pult` построен под шаблоны Meta основного номера |
| §7 | Переменные `{имя}`, `{мастер}`, `{время}`, `{ссылка}` | частично | Только `{имя}` (`bcName`) |
| §7 | Повтор только временных ошибок | есть | `services/broadcast/sender.js`: временные — повтор каждые 10 мин, через час — остановка; постоянные — остановка рассылки |
| §8 | Накануне 18:00, за 2 часа в разрешённое время, отзыв после визита, все записи Altegio, отмена/перенос | есть (выключено) | `services/reminders/journal.js`, 30.10.2026, на заглушках; включается `REMIND_GA_WINCHESTER=1` |
| §8 | Бонусы выключены до проверки API | есть | Не начато; методы в документации Altegio есть, не проверены вживую |
| §9 | Записи после сообщений (24 ч / 3 / 7 / 14 дней), визит, отмена, перенос | нет | Поле `create_date` журнала не проверено вживую |
| §10 | Единый журнал событий, переход в чат, фильтры | частично | Сервисные пишутся в переписку чата (`h:ga:`), удачные — `rmok:`; у рассылок — счётчики и ошибки; сигналы в Telegram. Единой ленты и фильтров нет |
| §10 | Идемпотентность | частично | Вебхуки — `seenBefore`; напоминания — `rms:`; рассылки — позиция + оборванная порция `b.cur`; запись с сайта — `sb:<rid>`. Ключа события в общем журнале нет |
| §10 | Аудит действий владельца и сотрудников | нет | — |
| §12 | Секреты только на сервере | есть | Переменные Cloudflare; в браузер не уходят |
| §12 | Роли владелец/администратор/оператор с раздельными правами | частично | Две роли: владелец и сотрудник компании (`services/auth`); сотруднику запрещены только отдельные действия |
| §12 | Маскирование телефонов, ограничение экспорта | есть | `maskPhone`, `logSafe`; выгрузки базы нет |
| §12 | Резервное копирование, мониторинг очередей | частично | Ежедневная копия только заявок (в Telegram); KV целиком не копируется. Сигналы в Telegram |
| §12 | Сменяемые провайдеры отправки | частично | Meta / Wazzapo / Green-API за `sendWA`/`sendGreen`, общего интерфейса «отправитель» нет |

## 2. Противоречия ТЗ и текущего кода (решить до реализации)

1. **Согласие на маркетинг.** ТЗ §3, §4, §6.1 и тест «импортирован номер без согласия» — маркетинг только при подтверждённом
   основании. Код считает доступными всех клиентов Altegio, кроме «стопа». Где хранятся согласия Winchester, неизвестно
   (ТЗ §15); форма сайта `is_newsletter_allowed` не передаёт. Есть ли поле согласия в карточке клиента Altegio и отдаёт ли
   его API — не проверено. **Если применить ТЗ буквально, до ответа Кайрата маркетинговая аудитория равна нулю.**
2. **Интервал между маркетинговыми касаниями:** код — 14 дней (`CRM_QUIET_DAYS`, отметки `bcm:` живут 15 дней), ТЗ — 30
   скользящих. Для 30 дней отметки нужно хранить не меньше 31 дня (в БД — без срока).
3. **«Стоп» блокирует всё.** Один `optout:` останавливает и маркетинг, и напоминания с отзывом (`journal.js`). ТЗ разделяет
   отказ от маркетинга и полную блокировку. Нужно правило: что значит «стоп» в ответ на напоминание.
4. **Рассылки со второго номера.** Код: `gaNoBroadcast: true`, база — только шаблоном Meta (`docs/tz-winchester-v2.md`,
   18.10.2026). Решение владельца 30.10.2026 и ТЗ: маркетинг со второго номера с одобрением. Старое ТЗ и раздел
   «Рассылки» пульта устарели.
5. **Пределы.** Макет 30.10 показывает «до 150 в день», «по 15 в день» как обычные настройки; ТЗ §6 — не подавать внутренние
   пределы как безопасные квоты Green-API. Поменять тексты пульта и сигналов.
6. **«Отправить N» vs «Одобрить N».** Макет — «Отправить»; ТЗ — «Одобрить N», если отправка по расписанию.
7. **Отзыв.** Код — через 3 часа от начала записи при отметке «пришёл»; ТЗ — после подтверждённого завершённого визита;
   «60 дней» — пример, нужно согласование.
8. **За 2 часа вне окна.** Код такое напоминание не создаёт; ТЗ — согласовать.
9. **«Реальное время».** Данные Altegio у нас — снимок раз в сутки (рассылки) и раз в 15 минут (напоминания). Без
   вебхуков Altegio «живые» сегменты требуют частой сверки, а Altegio принимает не больше 5 запросов в секунду.
10. **Сегмент 90+.** Снимок читает 90 дней; для 90+ нужно читать больше журнала или хранить историю визитов в БД.
11. **Роли.** ТЗ — владелец / администратор / оператор; код — владелец / сотрудник; `REFACTORING.md` — owner / admin / agent.

## 3. Хранилище

> **31.10.2026: заменено.** Владелец решил оставить всё в Cloudflare, без Supabase: данные сообщений — в D1, KV остаётся.
> План, схема D1 и миграция — `docs/architecture-cloudflare-d1.md`. Разделы 3–4 ниже — прежний вариант, для истории.

ТЗ требует истории согласий и запретов, аудита, статусов каждого получателя, идемпотентных событий, атрибуции записей и
фильтров И/ИЛИ. В KV нет транзакций и запросов по полям, а один ключ можно писать не чаще раза в секунду. Решение проекта
уже принято — PostgreSQL (Supabase, `CLAUDE.md` §1.3, `REFACTORING.md` фаза 2), но фаза 2 не начата.

**Предложение:** внедрять ТЗ сразу на PostgreSQL, но узко — только новые таблицы контактов и сообщений Winchester. Чаты,
заявки, запись с сайта остаются в KV до общей фазы 2. Флаг `MSG_V2_<ID>` (Text): без него работает нынешний код.
Альтернатива без нового сервиса — Cloudflare D1 (SQLite в том же аккаунте): проще подключить, но нет RLS и Realtime и
расходится с `REFACTORING.md`. Выбор — за владельцем (открытый вопрос 9.1).

Нужно от владельца: проект Supabase (регион ближе к Казахстану/Европе), `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в
Cloudflare (Production и Previews), платный тариф Workers (снимок базы уже ≈ 60–170 мс процессора).

## 4. Модель данных и миграции

### 4.1. Сопоставление

| ТЗ §11 | `REFACTORING.md` 2.2 | Решение |
|---|---|---|
| organizations | `workspaces` | как в плане |
| users, organization_members | `auth.users`, `workspace_members` | роли `owner`, `admin`, `operator` (вместо `agent`) + права в `sending_policies` |
| sender_accounts | `channels` | как в плане; `role` = `service`/`marketing`/`both` |
| contacts | `contacts` | расширить: `altegio_client_id`, без `consent_at`/`opted_out_at` (вынесены в отдельные таблицы) |
| contact_sources | — | новая |
| contact_consents | — | новая (история) |
| contact_restrictions | — | новая (история, scope, срок) |
| appointments, visit_history | `bookings` | расширить: `provider_created_at`, `attendance`, `last_seen_at`; визит = запись с `attendance = 1` |
| audience_definitions | — | новая (`audiences`) |
| audience_memberships | — | не хранить: вычисляется; снимок — в `campaign_recipients` |
| campaigns | `broadcasts` | заменить на `campaigns` (новые состояния, одобрение) |
| campaign_recipients | `broadcast_recipients` | заменить: причина исключения, одобрение, ключ отправки |
| templates | — | новая |
| scheduled_jobs | `reminders` | обобщить до `scheduled_jobs` (напоминания и отправки кампаний) |
| message_events | `messages` (частично) | новая лента событий с уникальным ключом |
| sending_policies | — | новая (настройки на компанию и номер) |
| planning_cycles | — | не таблица: месяц — фильтр отчёта; план строится на лету |
| sync_checkpoints | — | новая |
| audit_logs | `audit_log` | как в плане |

### 4.2. Черновик миграций (PostgreSQL)

`0001_init.sql` — из `REFACTORING.md` §2.2 только `workspaces`, `workspace_members`, `channels`, `contacts`, `bookings`,
`audit_log` с изменениями из 4.1. `0003_rls.sql` — как в §2.3 (сервер ходит сервисным ключом, RLS — для будущих клиентов).
Новое — `0002_messaging.sql`:

```sql
create table contact_sources (
  contact_id   uuid not null references contacts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source       text not null check (source in ('altegio','import','manual','chat','site')),
  external_id  text,                       -- Altegio client id, номер строки импорта
  import_id    uuid,                       -- партия импорта (для отката и отчёта)
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);
create unique index contact_sources_one on contact_sources (contact_id, source, coalesce(external_id, ''));
create table contact_consents (            -- только добавление: история
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  purpose      text not null check (purpose in ('marketing','service')),
  state        text not null check (state in ('granted','denied','unknown')),
  basis        text not null,              -- «галочка на сайте 30.10», «устное согласие на стойке» — формулировки согласовать
  source       text not null, actor text not null,
  created_at   timestamptz not null default now()
);
create table contact_restrictions (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  kind         text not null check (kind in ('marketing_optout','sender_block','full_block','cooldown','undeliverable')),
  channel_id   uuid references channels(id),     -- для sender_block и undeliverable
  until_at     timestamptz,                      -- для cooldown
  reason       text not null, source text not null, actor text not null,
  created_at   timestamptz not null default now(),
  lifted_at    timestamptz, lifted_by text, lift_reason text
);
create index restrictions_active on contact_restrictions (workspace_id, contact_id) where lifted_at is null;

create table templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  purpose text not null check (purpose in ('reminder_d1','reminder_h2','review','marketing','bonus')),
  grp text, body text not null, active boolean not null default true,
  version int not null default 1, updated_by text, updated_at timestamptz not null default now()
);
create table audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null, kind text not null check (kind in ('filter','import_temp','import_saved','manual')),
  filter jsonb,                            -- дерево И/ИЛИ из проверенного набора условий
  created_by text, created_at timestamptz not null default now()
);
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id),
  audience_id uuid references audiences(id),
  name text not null, template_ids uuid[] not null,
  state text not null default 'draft'
    check (state in ('draft','ready','approved','sending','paused','cancelled','done')),
  window_from smallint not null default 11, window_to smallint not null default 20,
  daily_cap int not null,
  approved_by text, approved_at timestamptz, approved_count int,
  created_by text, created_at timestamptz not null default now()
);
create table campaign_recipients (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  state text not null default 'candidate'
    check (state in ('candidate','excluded','approved','queued','sent','failed','skipped')),
  reason text,                             -- почему исключён или пропущен перед отправкой
  template_id uuid, send_key text unique,  -- ключ отправки: повтор задачи не шлёт второй раз
  sent_at timestamptz, provider_message_id text,
  primary key (campaign_id, contact_id)
);
create table scheduled_jobs (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('reminder_d1','reminder_h2','review','campaign_send')),
  booking_id uuid references bookings(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  due_at timestamptz not null,
  state text not null default 'queued' check (state in ('queued','claimed','sent','failed','skipped','cancelled')),
  reason text, job_key text not null unique,  -- 'd1:<booking>:<starts_at>' — перенос даёт новый ключ
  claimed_at timestamptz, done_at timestamptz
);
create index jobs_due on scheduled_jobs (workspace_id, due_at) where state = 'queued';
create table message_events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  event_key text not null unique,          -- id провайдера / ключ задачи: повторный вебхук не создаёт второе событие
  kind text not null,                      -- import|sync|exclude|approve|queue|send|deliver|reply|stop|error|booking_after
  contact_id uuid references contacts(id), campaign_id uuid references campaigns(id),
  job_id bigint references scheduled_jobs(id), booking_id uuid references bookings(id),
  details jsonb, at timestamptz not null default now()
);
create index events_contact on message_events (workspace_id, contact_id, at desc);
create table sending_policies (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid references channels(id),
  marketing_gap_days int not null default 30,   -- согласовать (ТЗ §15)
  service_window_from smallint not null default 10, service_window_to smallint not null default 21,
  review_gap_days int not null default 60,      -- согласовать
  marketing_requires_consent boolean not null default true,
  approval_required boolean not null default true,
  stale_after_minutes int not null default 30   -- данные Altegio старше — маркетинг не идёт
);
create unique index sending_policies_one on sending_policies
  (workspace_id, coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table sync_checkpoints (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null, scope text not null,    -- 'altegio' / 'records:<loc>'
  last_ok_at timestamptz, last_error text, last_error_at timestamptz, cursor jsonb,
  primary key (workspace_id, source, scope)
);
```

Перенос из KV: `crm:<id>:snap` → `contacts` + `bookings` (визиты),
`optout:` → `contact_restrictions(kind='marketing_optout', reason='STOP до 31.10.2026')`, `bcm:` → `message_events(send)`.
Скрипт `scripts/migrate-kv-to-pg.mjs` (по `REFACTORING.md` §2.6), сначала в режиме «только чтение и отчёт».

## 5. Правила, которые закрепляет код

- **Одна функция допуска** `eligible(contact, purpose, channel, at)` — одна и та же при сборке аудитории, одобрении и прямо
  перед отправкой (ТЗ §4). Маркетинг: согласие `granted` (если `marketing_requires_consent`), нет активных `marketing_optout`,
  `full_block`, `sender_block` этого номера, `cooldown` до `at`, `undeliverable` этого номера; нет будущей записи (для
  реактивации); прошло `marketing_gap_days`; данные Altegio по контакту не старше `stale_after_minutes`, иначе — пропуск с
  причиной «данные устарели». Сервис: применимое основание (запись клиента), нет `full_block` и `sender_block`.
- **«Стоп»:** явный отказ по словарю → `marketing_optout` (и `full_block`, если так решит Кайрат, §2 п. 3); спорный ответ
  («не пишите пока», «потом») → событие `reply` с пометкой «проверить» в пульте, без автоматического решения.
- **Кампания:** `draft → ready` (аудитория посчитана, исключения с причинами) `→ approved` (снимок получателей, кто и когда)
  `→ sending → done`; `paused` и `cancelled` в любой момент; из `cancelled` не уходит ничего. Перед каждой отправкой —
  `eligible`; отказ — `skipped` с причиной.
- **Сервисные:** задания `scheduled_jobs` с `job_key` от записи и времени визита: перенос даёт новый ключ, старое задание
  `cancelled`. Сервисным — приоритет и отдельный дневной бюджет номера; маркетинг берёт остаток.
- **Записи после сообщения:** для каждого `send` маркетинга — новые записи клиента с `provider_created_at` в окне 24 ч / 3 /
  7 / 14 дней после `sent_at`; запись, созданная до отправки, не считается; визит, отмена и перенос — отдельно. Метрика
  называется «Записались в течение N дней после сообщения». Нужно поле даты создания записи в Altegio (не проверено).

## 6. План релизов

Каждый этап — ветка `dev`, флаг, синтетические контакты, без отправок настоящим клиентам; выкладка на боевой сайт — только
по слову владельца, включение отправок — только после «отправляй» Кайрата.

| Этап | Что делаем | Флаг | Готово, когда | Оценка |
|---|---|---|---|---|
| 0. Аудит | Этот документ; живая проверка полей Altegio только чтением (`create_date`, `attendance`, `visit_attendance`, поле согласия клиента, вебхуки, лояльность) | — | Карта и ответы на §9 | 0,5 дня + владелец |
| 1. Контакты | Подключение БД, миграции 0001–0003, синхронизация Altegio → `contacts`/`bookings` с `sync_checkpoints`, импорт CSV с предпросмотром, согласия и запреты, разделение «стопа», перенос `optout:` | `MSG_V2_<ID>` | Дубли и «стоп» не теряются при повторной загрузке | 5–7 дней |
| 2. Кампании | Аудитории (фиксированные сегменты + И/ИЛИ из проверенного набора), шаблоны с переменными, тест себе, исключения вручную, «Одобрить N», очередь `scheduled_jobs` на Green-API со `send_key`, пауза/отмена, журнал событий, пульт | `MSG_V2_<ID>` и отдельный `MKT_GA_<ID>` (как `REMIND_GA_<ID>`) | Никаких отправок без `eligible` перед отправкой | 6–8 дней |
| 3. Сервис | Перевод `services/reminders/journal.js` на `scheduled_jobs`, отмены и переносы, бюджет номера | `MSG_V2_<ID>` | Нет устаревших и двойных уведомлений | 2–3 дня |
| 4. Планировщик | Календарь кандидатов по дням, скользящий интервал, пересчёт при изменениях базы, история плана | `MSG_V2_<ID>` | Пересчёт при изменении базы, история сохраняется | 4–5 дней |
| 5. Результаты | События `booking_after`, отчёт «Записались в течение N дней», сверяемость с Altegio | `MSG_V2_<ID>` | Метрики воспроизводятся из событий | 2–3 дня |
| 6. SaaS-ready | Роли и права, провайдер отправки за интерфейсом, перенос Winchester из `builtin-clients.js` в `workspaces` | — | Новый клиент без форка кода | по `REFACTORING.md` |

Оценки — грубые, без живых проверок Altegio; этап 1 может вырасти, если у Altegio нет нужных полей.

## 7. Тесты

Всё на синтетических контактах (`+7 700 000 xx xx`), Altegio и Green-API — заглушки `test/harness.mjs`. Репозитории БД — за
интерфейсом: в модульных тестах — реализация в памяти, SQL-миграции — в CI с сервисом PostgreSQL (GitHub Actions
`services: postgres`).

| Критический случай (ТЗ §14) | Файл теста | Сейчас |
|---|---|---|
| Один телефон в Altegio и Excel → один получатель | `test/unit/contacts-merge.test.mjs` | нет (импорт не пишет в базу) |
| STOP после одобрения, до отправки → отправка заблокирована | `test/unit/campaign-eligibility.test.mjs` | частично: `bcTick` перепроверяет «стоп» перед порцией (`crm-broadcast.test.mjs`) |
| Клиент записался после формирования календаря → исключён | `test/unit/campaign-eligibility.test.mjs` | частично: только автосценарий (`crmBookedNow`) |
| Визит перенесли → старое напоминание отменено, новое рассчитано | `test/unit/service-jobs.test.mjs` | есть для `journal.js` (`journal-remind.test.mjs`, «перенесли или удалили») |
| Вебхук пришёл дважды → одно событие, одна отправка | `test/unit/message-events.test.mjs` | частично: `seenBefore` (`channels.test.mjs`) |
| Новый месяц → ограничения и история не сбросились | `test/unit/planner.test.mjs` | нет (сбрасывать и сейчас нечего) |
| Номер без согласия → маркетинг недоступен | `test/unit/campaign-eligibility.test.mjs` | нет |
| Altegio недоступен → маркетинг на устаревших данных не идёт | `test/unit/campaign-eligibility.test.mjs` | частично: снимок старше 3 дней — пауза |
| Кампания на паузе → очередь не отправляет | `test/unit/campaign-queue.test.mjs` | есть для старых рассылок (`pult-campaigns.test.mjs`) |
| Импорт с ошибками → ошибки видны до подтверждения, верные строки не теряются | `test/unit/import.test.mjs` | частично: `bcParse` считает дубли и неверные |

Дополнительно: «стоп» в ответ на напоминание (по правилу §2 п. 3); спорный ответ уходит на ручную проверку; отменённая
кампания не шлёт после продолжения; повторный запуск задачи с тем же `send_key` не шлёт второй раз; пределы номера делятся
между сервисом и маркетингом; время по Астане на границе суток; контракт новых маршрутов (`test/contract/`); e2e пульта —
одобрение списка, исключение, пауза (`apps/pult/scripts/e2e-campaigns.mjs`).

## 8. Риски

- **Блокировка второго номера.** Green-API — не официальный WhatsApp Business Platform; внутренние пределы не гарантируют
  отсутствие блокировки. Напоминания по email в самом Altegio не выключать.
- **Согласия.** Маркетинг без зафиксированного основания — юридический риск (законы РК о персональных данных и о рекламе);
  формулировку оснований стоит проверить у юриста.
- **Неизвестные поля Altegio** (дата создания записи, согласие клиента, вебхуки) — этапы 1 и 5 зависят от них.
- **Переходный период KV + БД:** два источника правды по «стопу» — переносить `optout:` одним шагом и читать оба до конца.
- **Нагрузка на Altegio:** 5 запросов в секунду на всех — частая сверка конкурирует с ботом и сайтом.

## 9. Открытые вопросы

Из ТЗ §15 — все остаются. Новые:

1. Хранилище: Supabase (как в плане проекта) или Cloudflare D1? Кто оплачивает Supabase и платный тариф Workers?
2. Что значит «стоп» в ответ на напоминание: только маркетинг или все сообщения со второго номера?
3. Основание согласия у текущих 18 891 клиентов: есть ли отметка в Altegio, или маркетинг до подтверждения не идёт никому?
4. Интервал между маркетинговыми касаниями: оставить 14 дней до решения или сразу 30?
5. Роли: кто из сотрудников Winchester одобряет пакеты, а кто только смотрит?
6. Синхронизация: частота сверки журнала для маркетинга (каждые 15 минут? каждый час?) с учётом предела Altegio.

## 10. Что не проверено вживую

Поля журнала Altegio `create_date`, `attendance`/`visit_attendance` (ставят ли администраторы «пришёл»), поле согласия
клиента, вебхуки Altegio для нашего ключа, методы лояльности; доставка и прочтение через Green-API (вебхуки статусов для
второго номера не подключены); всё из `services/reminders/journal.js` и `services/crm/*` — только на заглушках.
