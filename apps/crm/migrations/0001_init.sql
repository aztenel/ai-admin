-- CRM продаж Bot Flow: лиды, касания (звонки, заметки, смена этапа), номера для поиска повторов, попытки входа.
-- Время — миллисекунды Unix. Удаление лида — мягкое (deleted_at).
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phones TEXT NOT NULL DEFAULT '',
  gis_url TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  booking_url TEXT NOT NULL DEFAULT '',
  booking TEXT NOT NULL DEFAULT '',
  reviews INTEGER,
  rating REAL,
  masters INTEGER,
  branches INTEGER,
  ig_followers INTEGER,
  ig_alive INTEGER,
  impression INTEGER,
  avg_check INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'new',
  lpr_name TEXT NOT NULL DEFAULT '',
  lpr_phone TEXT NOT NULL DEFAULT '',
  next_at INTEGER,
  next_what TEXT NOT NULL DEFAULT '',
  meet_at INTEGER,
  price INTEGER,
  prepay INTEGER,
  paid_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  search TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  touched_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX leads_stage ON leads (stage, score DESC) WHERE deleted_at IS NULL;
CREATE INDEX leads_next ON leads (next_at) WHERE deleted_at IS NULL AND next_at IS NOT NULL;
CREATE INDEX leads_meet ON leads (meet_at) WHERE deleted_at IS NULL AND meet_at IS NOT NULL;

CREATE TABLE lead_phones (
  digits TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  PRIMARY KEY (digits, lead_id)
);

CREATE TABLE touches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX touches_lead ON touches (lead_id, at);
CREATE INDEX touches_at ON touches (at);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  slot INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ip, slot)
);
