// @ts-check
// База D1 (docs/architecture-cloudflare-d1.md): подключена ли, та ли это база и какие миграции применены.
// С 31.10.2026 у черновиков (Worker Previews) своя база ai-admin-dev и своё KV, у боевого сайта D1 пока не подключена.
// В базе стоит отметка meta.stage ('preview' или 'production'), в окружении — переменная STAGE (у черновиков 'preview'
// из wrangler.jsonc, у боевого сайта её нет). Не совпали — базой не пользуемся: черновик с боевой базой (или наоборот)
// мог бы писать в чужие данные, а запреты «стоп» читались бы не оттуда.
/** @import { Env } from "../../lib/types.js" */

/** @param {Env} env */
export const stageOf = env => (env.STAGE === "preview" ? "preview" : "production");

/**
 * Состояние базы для страницы владельца. Значения строк не читаются — только служебные таблицы.
 * @param {Env} env
 * @returns {Promise<{ want: string, bound: boolean, ok?: boolean, stage?: string|null, migrations?: string[], tables?: number, ms?: number, error?: string }>}
 */
export async function d1Status(env) {
  const want = stageOf(env), db = env.DB;
  if (!db || typeof db.prepare !== "function") return { want, bound: false };
  const t = Date.now();
  try {
    /** @type {string[]} */
    const names = ((await db.prepare("select name from sqlite_master where type = 'table'").all()).results || []).map((/** @type {any} */ r) => String(r.name));
    const has = (/** @type {string} */ n) => names.includes(n);
    const stage = has("meta") ? await db.prepare("select v from meta where k = 'stage'").first("v") : null;
    const migrations = has("d1_migrations") ? ((await db.prepare("select name from d1_migrations order by id").all()).results || []).map((/** @type {any} */ r) => String(r.name)) : [];
    const tables = names.filter(n => !/^(sqlite_|_cf_|d1_migrations$)/.test(n)).length;
    return { want, bound: true, ok: stage === want && migrations.length > 0, stage: stage == null ? null : String(stage), migrations, tables, ms: Date.now() - t };
  } catch (/** @type {any} */ e) {
    return { want, bound: true, ok: false, error: String((e && e.message) || e).slice(0, 160), ms: Date.now() - t };
  }
}

// проверка — раз в минуту на экземпляр Worker: каждый запрос к D1 стоит времени, а отметка базы не меняется
/** @type {WeakMap<object, { at: number, ok: boolean }>} */
const seen = new WeakMap();
const TTL = 60_000;

/**
 * База для нового кода — только если это своя база окружения и миграции применены; иначе null («закрыто при сомнении»:
 * без базы отправки D1 не идут, бот и пульт работают на KV, как раньше).
 * @param {Env} env
 * @param {number} now
 */
export async function d1Ready(env, now) {
  const db = env.DB;
  if (!db || typeof db.prepare !== "function") return null;
  const c = seen.get(db);
  if (c && now - c.at < TTL) return c.ok ? db : null;
  const s = await d1Status(env);
  seen.set(db, { at: now, ok: !!s.ok });
  return s.ok ? db : null;
}
