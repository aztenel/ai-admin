-- Переписки в D1 (01.11.2026, Winchester). До этого чат хранился одним значением KV h:<канал>:<компания>:<чат> = { n, turns, profile }:
-- запись по старой копии из другой точки сети затирала соседнюю (входящее, ответ администратора, статус доставки), а список чатов
-- и сама переписка у пульта отставали до минуты. Здесь чат — строка chat_threads (состояние, ревизия), каждое сообщение — своя строка
-- chat_messages. Пишет и читает их только src/db/d1/chats.js; включается на компанию переменной CHAT_STORE_<ID> = d1.
--
-- chat_threads — один чат: ws — компания (id паспорта), ch — канал (wa | ga | web), chat — номер клиента цифрами или id веб-чата.
--   rev        — ревизия: растёт на 1 при каждом изменении чата (сообщение, статус, состояние). Запись проходит, только если ревизия
--                та же, что при чтении, иначе — перечитать и наложить свои изменения снова: два одновременных изменения не затирают друг друга.
--                0 — заготовка строки (её создаёт первая запись в новый чат); такой чат пульт не показывает.
--   n          — счётчик записей бота (h.n, им think() замечает, что в чат пришло другое сообщение).
--   profile    — состояние чата, как в KV: имя, «Нужен ответ», кто ведёт, «Готово», пауза бота, «стоп», записи, заявки, журнал действий.
--   meta       — строка списка чатов пульта (histMeta, как метаданные ключа KV): последнее сообщение, галочки, время.
--   updated_at — время последнего изменения (meta.t); last_in, need, assignee, done, stop — копии полей профиля для выборок.
--   expires_at — срок хранения, как у KV: 7 дней после последнего сообщения, со «стопом» — дольше (histTtl). Потом чат удаляется
--                целиком (страница /privacy: «история переписки — 7 дней после последнего сообщения»).
--   src        — откуда чат: d1 — начат здесь, kv — перенесён из KV (переносится без потерь и повторно — без дублей).
CREATE TABLE chat_threads (
  ws         TEXT NOT NULL,
  ch         TEXT NOT NULL CHECK (ch IN ('wa', 'ga', 'web')),
  chat       TEXT NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 0,
  n          INTEGER NOT NULL DEFAULT 0,
  profile    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(profile)),
  meta       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  updated_at INTEGER NOT NULL,
  last_in    INTEGER,
  need       TEXT,
  assignee   TEXT,
  done       INTEGER,
  stop       INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  src        TEXT NOT NULL DEFAULT 'd1' CHECK (src IN ('d1', 'kv')),
  PRIMARY KEY (ws, ch, chat)
);
CREATE INDEX chat_threads_list ON chat_threads (ws, ch, updated_at);
CREATE INDEX chat_threads_need ON chat_threads (ws, need) WHERE need IS NOT NULL;
CREATE INDEX chat_threads_exp ON chat_threads (expires_at);

-- chat_messages — одно сообщение (реплика). id — порядок записи; показ — по t (время реплики), при равном t — по id.
--   mkey — устойчивый ключ сообщения в чате: номер у провайдера (m:<idMessage>:<u|m>), номер отправки из пульта (r:<rid>) или отпечаток
--          неизменяемых полей (h:…). Повтор вебхука, повтор записи после сбоя и повторный перенос из KV не создают второе сообщение.
--   role — user (клиент) | model (бот, сотрудник, напоминание, рассылка); t, mid, rid, st — копии полей реплики для выборок;
--   data — сама реплика как в KV (текст, файл, цитата, сотрудник, статус, пометки). ver растёт при каждом изменении реплики.
-- Сообщения удаляются вместе с чатом (истёк срок, «Удалить данные клиента») и при «Очистить память бота».
CREATE TABLE chat_messages (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ws   TEXT NOT NULL,
  ch   TEXT NOT NULL,
  chat TEXT NOT NULL,
  mkey TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  t    INTEGER NOT NULL,
  mid  TEXT,
  rid  TEXT,
  st   TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  ver  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ws, ch, chat, mkey),
  FOREIGN KEY (ws, ch, chat) REFERENCES chat_threads (ws, ch, chat) ON DELETE CASCADE
);
CREATE INDEX chat_messages_thread ON chat_messages (ws, ch, chat, t, id);
CREATE INDEX chat_messages_mid ON chat_messages (ws, ch, mid) WHERE mid IS NOT NULL;
