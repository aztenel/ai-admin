-- D1 (SQLite): данные сообщений Winchester. Время — INTEGER, мс UTC. ws — компания ('winchester').
-- Телефон — только цифры с кодом страны ('77001234567'), как ключи optout: в KV.

CREATE TABLE contacts (
  id                TEXT PRIMARY KEY,
  ws                TEXT NOT NULL,
  phone             TEXT NOT NULL CHECK (length(phone) BETWEEN 10 AND 15 AND phone NOT GLOB '*[^0-9]*'),
  name              TEXT,
  altegio_client_id TEXT,
  first_visit_at    INTEGER,
  last_visit_at     INTEGER,
  visits            INTEGER NOT NULL DEFAULT 0,
  last_staff        TEXT,
  last_service      TEXT,
  next_booking_at   INTEGER,              -- ближайшая будущая запись; NULL — нет
  data_hash         TEXT,                 -- синхронизация пишет строку, только если поля Altegio изменились
  synced_at         INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (ws, phone)
);
CREATE INDEX contacts_altegio ON contacts (ws, altegio_client_id) WHERE altegio_client_id IS NOT NULL;
CREATE INDEX contacts_last_visit ON contacts (ws, last_visit_at);
CREATE INDEX contacts_next_booking ON contacts (ws, next_booking_at) WHERE next_booking_at IS NOT NULL;

CREATE TABLE contact_sources (
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  ws          TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('altegio','import','manual','chat','site')),
  external_id TEXT NOT NULL DEFAULT '',
  import_id   TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  PRIMARY KEY (contact_id, source, external_id)
);

-- согласия: только добавление; действующее — последняя строка по (contact_id, purpose)
CREATE TABLE consents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ws         TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('marketing','service')),
  state      TEXT NOT NULL CHECK (state IN ('granted','denied','unknown')),
  basis      TEXT NOT NULL,
  source     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX consents_last ON consents (ws, contact_id, purpose, id DESC);

CREATE TABLE restrictions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ws          TEXT NOT NULL,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('marketing_optout','full_block','sender_block','cooldown','undeliverable')),
  channel     TEXT NOT NULL DEFAULT '',   -- номер-отправитель для sender_block и undeliverable; '' — любой
  until_at    INTEGER,                    -- только для cooldown
  reason      TEXT NOT NULL,
  source      TEXT NOT NULL,              -- chat_stop | meta_131050 | meta_button | admin | import | kv_migration
  actor       TEXT NOT NULL,
  legacy_key  TEXT,                       -- 'optout:winchester:7700…': повторный перенос из KV не создаёт дублей
  created_at  INTEGER NOT NULL,
  lifted_at   INTEGER,
  lifted_by   TEXT,
  lift_reason TEXT,
  CHECK (kind <> 'cooldown' OR until_at IS NOT NULL)
);
CREATE INDEX restrictions_active ON restrictions (ws, contact_id) WHERE lifted_at IS NULL;
CREATE UNIQUE INDEX restrictions_legacy ON restrictions (ws, legacy_key) WHERE legacy_key IS NOT NULL;
-- один действующий запрет каждого вида на контакт и номер: второй «стоп» не плодит строки
CREATE UNIQUE INDEX restrictions_one_active ON restrictions (ws, contact_id, kind, channel)
  WHERE lifted_at IS NULL AND kind <> 'cooldown';

CREATE TABLE bookings (
  ws                  TEXT NOT NULL,
  record_id           TEXT NOT NULL,
  contact_id          TEXT REFERENCES contacts(id),
  starts_at           INTEGER NOT NULL,
  provider_created_at INTEGER,            -- create_date Altegio, если отдаёт (не проверено вживую)
  staff               TEXT,
  services            TEXT,
  attendance          INTEGER,            -- как в Altegio: -1 не пришёл, 0 ждём, 1 пришёл, 2 подтвердил
  deleted             INTEGER NOT NULL DEFAULT 0,
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  PRIMARY KEY (ws, record_id)
);
CREATE INDEX bookings_contact ON bookings (ws, contact_id, starts_at);
CREATE INDEX bookings_starts ON bookings (ws, starts_at);

CREATE TABLE audiences (
  id          TEXT PRIMARY KEY,
  ws          TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('filter','import_temp','import_saved','manual')),
  filter      TEXT CHECK (filter IS NULL OR json_valid(filter)),
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE TABLE audience_members (          -- только для списков (импорт, вручную); фильтры считаются на лету
  audience_id TEXT NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (audience_id, contact_id)
);

CREATE TABLE imports (
  id           TEXT PRIMARY KEY,
  ws           TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('temp','saved')),
  state        TEXT NOT NULL CHECK (state IN ('preview','confirmed','discarded')),
  total INTEGER, valid INTEGER, dup INTEGER, invalid INTEGER, new_contacts INTEGER, updated INTEGER,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE TABLE import_rows (
  import_id  TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_no     INTEGER NOT NULL,
  phone      TEXT,
  name       TEXT,
  consent    TEXT CHECK (consent IS NULL OR consent IN ('granted','denied','unknown')),
  basis      TEXT,
  error      TEXT,                         -- почему строка не пойдёт (неверный номер, дубль в файле)
  contact_id TEXT,
  PRIMARY KEY (import_id, row_no)
);

CREATE TABLE campaigns (
  id             TEXT PRIMARY KEY,
  ws             TEXT NOT NULL,
  channel        TEXT NOT NULL,
  name           TEXT NOT NULL,
  audience_id    TEXT REFERENCES audiences(id),
  state          TEXT NOT NULL DEFAULT 'draft'
                 CHECK (state IN ('draft','ready','approved','sending','paused','cancelled','done')),
  texts          TEXT NOT NULL CHECK (json_valid(texts)),   -- снимок текстов: шаблоны живут в KV и меняются
  window_from    INTEGER NOT NULL,
  window_to      INTEGER NOT NULL,
  daily_cap      INTEGER NOT NULL,
  approved_count INTEGER,
  approved_by    TEXT,
  approved_at    INTEGER,
  version        INTEGER NOT NULL DEFAULT 1,               -- двойное «Одобрить» → одно одобрение
  created_by     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX campaigns_state ON campaigns (ws, state);

CREATE TABLE campaign_recipients (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  TEXT NOT NULL REFERENCES contacts(id),
  ws          TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('candidate','excluded','approved','sent','failed','skipped','unknown')),
  reason      TEXT,
  text_idx    INTEGER,
  excluded_by TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, contact_id)
);
CREATE INDEX recipients_state ON campaign_recipients (campaign_id, state);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ws          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('reminder_d1','reminder_h2','review','campaign')),
  job_key     TEXT NOT NULL UNIQUE,         -- 'd1:<record>:<starts_at>' | 'cmp:<campaign>:<contact>'
  contact_id  TEXT NOT NULL REFERENCES contacts(id),
  record_id   TEXT,
  campaign_id TEXT,
  due_at      INTEGER NOT NULL,
  late_at     INTEGER NOT NULL,             -- позже — не отправляем
  state       TEXT NOT NULL DEFAULT 'queued'
              CHECK (state IN ('queued','claimed','done','skipped','cancelled','failed')),
  reason      TEXT,
  claim_token TEXT,
  claimed_at  INTEGER,
  done_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX jobs_due ON jobs (ws, due_at) WHERE state = 'queued';
CREATE INDEX jobs_claimed ON jobs (ws, claimed_at) WHERE state = 'claimed';
CREATE INDEX jobs_record ON jobs (ws, record_id) WHERE record_id IS NOT NULL;

-- каждая отправка; send_key UNIQUE — вторая попытка с тем же ключом не уходит
CREATE TABLE outbound (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ws          TEXT NOT NULL,
  send_key    TEXT NOT NULL UNIQUE,
  job_id      INTEGER REFERENCES jobs(id),
  channel     TEXT NOT NULL,
  contact_id  TEXT NOT NULL REFERENCES contacts(id),
  purpose     TEXT NOT NULL CHECK (purpose IN ('service','review','marketing','test')),
  campaign_id TEXT,
  text_hash   TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('sending','sent','failed','unknown')),
  provider_id TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);
CREATE INDEX outbound_contact ON outbound (ws, contact_id, purpose, created_at);
CREATE INDEX outbound_channel ON outbound (ws, channel, created_at);
CREATE INDEX outbound_sending ON outbound (ws, created_at) WHERE state = 'sending';

-- бюджет номера на сутки (по Астане): сервис и маркетинг отдельно, резервирование одной командой
CREATE TABLE sender_daily (
  ws        TEXT NOT NULL,
  channel   TEXT NOT NULL,
  day       TEXT NOT NULL,
  service   INTEGER NOT NULL DEFAULT 0,
  marketing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ws, channel, day)
);
CREATE TABLE sender_state (                -- пауза номера (кнопка, отказ Green-API)
  ws           TEXT NOT NULL,
  channel      TEXT NOT NULL,
  paused_until INTEGER,
  reason       TEXT,
  updated_by   TEXT,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (ws, channel)
);

-- журнал: event_key UNIQUE — повторный вебхук или повтор задачи не создаёт второе событие
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ws          TEXT NOT NULL,
  event_key   TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  contact_id  TEXT,
  campaign_id TEXT,
  job_id      INTEGER,
  record_id   TEXT,
  outbound_id INTEGER,
  actor       TEXT NOT NULL,
  details     TEXT CHECK (details IS NULL OR json_valid(details)),
  at          INTEGER NOT NULL
);
CREATE INDEX events_at ON events (ws, at);
CREATE INDEX events_contact ON events (ws, contact_id, at) WHERE contact_id IS NOT NULL;
CREATE INDEX events_campaign ON events (ws, campaign_id, at) WHERE campaign_id IS NOT NULL;

-- записи после маркетингового сообщения: факты, без «благодаря»
CREATE TABLE outcomes (
  outbound_id INTEGER NOT NULL REFERENCES outbound(id),
  record_id   TEXT NOT NULL,
  ws          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('booked','visited','cancelled','moved')),
  after_ms    INTEGER NOT NULL,
  PRIMARY KEY (outbound_id, record_id, kind)
);

CREATE TABLE plan_days (                   -- календарь: числа на день и вид; причины изменений — в events
  ws          TEXT NOT NULL,
  day         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  candidates  INTEGER NOT NULL DEFAULT 0,
  approved    INTEGER NOT NULL DEFAULT 0,
  queued      INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  excluded    INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (ws, day, kind)
);

CREATE TABLE sync_state (
  ws            TEXT NOT NULL,
  source        TEXT NOT NULL,
  scope         TEXT NOT NULL,
  last_ok_at    INTEGER,
  last_error    TEXT,
  last_error_at INTEGER,
  cursor        TEXT,
  PRIMARY KEY (ws, source, scope)
);

CREATE TABLE audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ws      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  details TEXT CHECK (details IS NULL OR json_valid(details)),
  at      INTEGER NOT NULL
);
CREATE INDEX audit_at ON audit (ws, at);
