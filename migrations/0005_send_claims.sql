-- Защита от двойной отправки из пульта (аудит перед сдачей Winchester, 31.10.2026). Одна строка на одно нажатие «Отправить»:
-- компания, канал, чат и rid (номер нажатия, его придумывает пульт). Вставка строки атомарна: из двух одновременных запросов
-- с тем же rid — в одном экземпляре Worker или в двух разных — отправит только тот, чья вставка прошла. KV для этого не годится:
-- запись в нём видна в других местах сети не сразу, а «прочитал → записал» не атомарно.
-- state: pending — отправляем (или результат не записался: повторно не отправляем никогда);
--        sent — Green-API принял (mid — номер сообщения); unknown — ответа нет, сообщение могло уйти: повторно не отправляем;
--        refused — Green-API отказал, ничего не ушло: «Повторить» с тем же rid может отправить снова.
CREATE TABLE send_claims (
  ws         TEXT NOT NULL,
  ch         TEXT NOT NULL,
  chat       TEXT NOT NULL,
  rid        TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'unknown', 'refused')),
  mid        TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ws, ch, chat, rid)
);
CREATE INDEX send_claims_age ON send_claims (ws, created_at);
