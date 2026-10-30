-- Проверка бизнес-логики клиентов перед кампаниями (31.10.2026). Только добавление столбцов.
-- План — docs/architecture-cloudflare-d1.md §6.3.

-- согласие: чем подтверждено и подтверждено ли. Реклама — только при последнем согласии «да» и confirmed = 1.
-- evidence: chat (клиент сам написал в WhatsApp — сервер нашёл его сообщение), document (анкета, договор — с номером),
-- oral (устно в салоне — только если клиент никогда не отказывался), import (из файла — всегда не подтверждено),
-- altegio (флаг «разрешил рассылки» в Altegio — не подтверждено), client_stop (клиент сам отказался)
ALTER TABLE consents ADD COLUMN evidence TEXT;
ALTER TABLE consents ADD COLUMN evidence_ref TEXT;      -- время сообщения клиента, номер анкеты, импорт
ALTER TABLE consents ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1));
ALTER TABLE consents ADD COLUMN given_at INTEGER;       -- когда клиент согласился или отказался (не когда записали)

-- справочник клиентов Altegio (вся база, а не только журнал за 2 года): визиты по данным Altegio
ALTER TABLE contacts ADD COLUMN alt_first_visit_at INTEGER;
ALTER TABLE contacts ADD COLUMN alt_last_visit_at INTEGER;
ALTER TABLE contacts ADD COLUMN alt_visits INTEGER;
ALTER TABLE contacts ADD COLUMN alt_newsletter INTEGER CHECK (alt_newsletter IS NULL OR alt_newsletter IN (0, 1));

-- запись пропала: cancelled — Altegio отдал её удалённой, vanished — её просто нет в прочитанном окне
ALTER TABLE bookings ADD COLUMN gone TEXT CHECK (gone IS NULL OR gone IN ('cancelled', 'vanished'));
