-- Демо-база черновика (31.10.2026): источник контакта 'demo' — вымышленные клиенты «Загрузить демо-базу», пульт подписывает их
-- «демо», а «Убрать демо-базу» удаляет только их. Ограничение CHECK в SQLite не меняется ALTER — таблица источников создаётся
-- заново с тем же составом столбцов и ключом, строки переносятся как есть. На contact_sources никто не ссылается.
CREATE TABLE contact_sources_v2 (
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  ws          TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('altegio','import','manual','chat','site','demo')),
  external_id TEXT NOT NULL DEFAULT '',
  import_id   TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  PRIMARY KEY (contact_id, source, external_id)
);
INSERT INTO contact_sources_v2 (contact_id, ws, source, external_id, import_id, first_seen, last_seen)
  SELECT contact_id, ws, source, external_id, import_id, first_seen, last_seen FROM contact_sources;
DROP TABLE contact_sources;
ALTER TABLE contact_sources_v2 RENAME TO contact_sources;
CREATE INDEX contact_sources_demo ON contact_sources (ws, contact_id) WHERE source = 'demo';
