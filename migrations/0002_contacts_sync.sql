-- Этап 1 (31.10.2026): единая база контактов и синхронизация журнала Altegio → D1. Только добавление столбцов и индексов.
-- План — docs/architecture-cloudflare-d1.md §6.2.

-- записи Altegio: id клиента в Altegio и отпечаток полей — неизменённая запись при синхронизации не переписывается
ALTER TABLE bookings ADD COLUMN client_ref TEXT;
ALTER TABLE bookings ADD COLUMN hash TEXT;

-- поиск: имя в нижнем регистре и цифры номера (LIKE в SQLite не знает регистра кириллицы — приводим в коде)
ALTER TABLE contacts ADD COLUMN search TEXT;
CREATE INDEX contacts_staff ON contacts (ws, last_staff) WHERE last_staff IS NOT NULL;

-- синхронизация: аренда (две синхронизации одной компании одновременно не идут) и числа последнего удачного прохода
ALTER TABLE sync_state ADD COLUMN lease_until INTEGER;
ALTER TABLE sync_state ADD COLUMN lease_token TEXT;
ALTER TABLE sync_state ADD COLUMN stats TEXT CHECK (stats IS NULL OR json_valid(stats));

-- импорт: что будет со строкой (новый, обновится, без изменений, дубль в файле, неверный номер)
ALTER TABLE import_rows ADD COLUMN action TEXT CHECK (action IS NULL OR action IN ('new','update','same','dup','invalid'));
ALTER TABLE imports ADD COLUMN same INTEGER;
ALTER TABLE imports ADD COLUMN source_name TEXT;
