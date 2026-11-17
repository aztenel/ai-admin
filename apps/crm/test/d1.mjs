// База D1 для проверок: тот же API, что у привязки D1 в Worker (prepare/bind/first/all/run, batch), поверх node:sqlite (Node 22+).
import { readFileSync, readdirSync } from "node:fs";
const warn = process.emitWarning;
process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : warn.call(process, w, ...a));
const sqlite = await import("node:sqlite");
process.emitWarning = warn;

const arg = v => {
  if (v === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || typeof v === "number" || typeof v === "string") return v;
  throw new TypeError("D1_TYPE_ERROR: Type '" + typeof v + "' not supported");
};

/** пустая база с применёнными миграциями из migrations/ */
export function openD1() {
  const raw = new sqlite.DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(f, dir), "utf8"));
  const exec1 = (sql, args) => {
    if (args.length > 100) throw new Error("D1_ERROR: too many SQL variables");
    const rows = raw.prepare(sql).all(...args.map(arg));
    const ch = raw.prepare("select changes() c, last_insert_rowid() id").get();
    return { success: true, results: rows.map(r => ({ ...r })), meta: { changes: ch.c, last_row_id: ch.id } };
  };
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    all: async () => exec1(sql, args),
    run: async () => exec1(sql, args),
    first: async col => { const r = exec1(sql, args).results[0]; return r === undefined ? null : col === undefined ? r : r[col] ?? null; }
  });
  return {
    raw,
    prepare: sql => stmt(sql),
    batch: async list => {
      raw.exec("BEGIN");
      try { const out = list.map(s => exec1(s.sql, s.args)); raw.exec("COMMIT"); return out; }
      catch (e) { raw.exec("ROLLBACK"); throw e; }
    }
  };
}
