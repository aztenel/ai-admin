// База D1 для проверок на заглушках: тот же API, что у привязки D1 в Worker (prepare/bind/first/all/run/raw, batch, exec),
// поверх встроенного в Node SQLite (node:sqlite, без новых пакетов). Миграции из migrations/ применяются, как
// `wrangler d1 migrations apply`: таблица d1_migrations, каждая миграция — одной транзакцией.
// node:sqlite есть в Node 22 и 24, в Node 20 — нет: тогда sqliteOk = false и проверки D1 пропускаются с пометкой.
import { readFileSync, readdirSync } from "node:fs";

// Node 22 при загрузке SQLite пишет ExperimentalWarning — в выводе проверок он только мешает
const warn = process.emitWarning;
process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : warn.call(process, w, ...a));
/** @type {any} */
const sqlite = await import("node:sqlite").catch(() => null);
process.emitWarning = warn;

export const sqliteOk = !!sqlite;
export const MIGRATIONS = new URL("../migrations/", import.meta.url);

// D1 принимает null, числа, строки и true/false (как 1/0); undefined и объекты — ошибка, больше 100 параметров — ошибка
const arg = v => {
  if (v === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || typeof v === "number" || typeof v === "string") return v;
  throw new TypeError("D1_TYPE_ERROR: Type '" + typeof v + "' not supported");
};

/** База D1 в памяти. fail(sql) → true — запрос падает, как при сбое D1 («D1 не ответила»). */
export function openD1() {
  if (!sqlite) throw new Error("node:sqlite недоступен (нужен Node 22+)");
  const raw = new sqlite.DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;"); // в D1 внешние ключи проверяются всегда
  const ops = { queries: 0, batches: 0 };
  /** @type {{ fail: null | ((sql: string) => boolean) }} */
  const ctl = { fail: null };
  const exec1 = (sql, args) => {
    ops.queries++;
    if (ctl.fail && ctl.fail(sql)) throw new Error("D1_ERROR: Network connection lost.");
    if (args.length > 100) throw new Error("D1_ERROR: too many SQL variables");
    const t = performance.now(), rows = raw.prepare(sql).all(...args.map(arg));
    const ch = raw.prepare("select changes() c, last_insert_rowid() id").get();
    return { success: true, results: rows.map(r => ({ ...r })), meta: { changes: ch.c, last_row_id: ch.id, duration: performance.now() - t } };
  };
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    all: async () => exec1(sql, args),
    run: async () => exec1(sql, args),
    first: async col => { const r = exec1(sql, args).results[0]; return r === undefined ? null : col === undefined ? r : r[col] ?? null; },
    raw: async () => exec1(sql, args).results.map(r => Object.values(r))
  });
  const db = {
    prepare: sql => stmt(sql),
    // как в D1: все запросы пачки — одна транзакция; ошибка в любом — откат всей пачки
    batch: async list => {
      ops.batches++;
      raw.exec("BEGIN");
      try { const out = list.map(s => exec1(s.sql, s.args)); raw.exec("COMMIT"); return out; }
      catch (e) { raw.exec("ROLLBACK"); throw e; }
    },
    exec: async sql => { ops.queries++; if (ctl.fail && ctl.fail(sql)) throw new Error("D1_ERROR: Network connection lost."); raw.exec(sql); return { count: sql.split(";").filter(s => s.trim()).length, duration: 0 }; }
  };
  return { db, raw, ops, ctl };
}

/** Применить миграции, которых ещё нет в d1_migrations, как wrangler (таблица и её столбцы — те же). */
export function migrate(raw, dir = MIGRATIONS) {
  raw.exec(`CREATE TABLE IF NOT EXISTS d1_migrations(
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  );`);
  const done = new Set(raw.prepare("select name from d1_migrations").all().map(r => r.name));
  const files = readdirSync(dir).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    raw.exec("BEGIN");
    try {
      raw.exec(readFileSync(new URL(f, dir), "utf8"));
      raw.prepare("insert into d1_migrations(name) values (?)").run(f);
      raw.exec("COMMIT");
    } catch (e) { raw.exec("ROLLBACK"); throw new Error(`миграция ${f}: ${e.message}`); }
    applied.push(f);
  }
  return applied;
}

/** База с применёнными миграциями и отметкой окружения (как у ai-admin-dev после создания). */
export function d1With(stage = "preview") {
  const d = openD1();
  migrate(d.raw);
  if (stage) d.raw.prepare("insert into meta(k, v) values ('stage', ?)").run(stage);
  return d;
}
