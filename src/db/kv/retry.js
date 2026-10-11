// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Повтор действия с KV через секунду (ограничение KV — одна запись ключа в секунду).
// у KV лимит — одна запись ключа в секунду (иначе отказ 429): действие повторяется один раз через секунду. Чтение и изменение — внутри f, чтобы вторая попытка шла по свежим данным
/**
 * @param {() => any} f
 * @returns {Promise<any>}
 */
export const kvRetry = async f => { try { return await f(); } catch (e) { console.log("kv retry", String(e).slice(0, 120)); await new Promise(r => setTimeout(r, 1100)); return f(); } };
