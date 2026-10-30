// @ts-check
// Согласия и запреты в D1 (этап 1, 31.10.2026): только добавление строк — история не теряется; снятие запрета — отметка
// lifted_* с тем, кто и почему. Расхождения KV и D1 — sync_issues. Зеркало «стопа» в KV пишет сервис (services/contacts/stops.js).

/** Контакт по номеру (создаётся, если нет). → id. @param {any} db @param {string} ws @param {string} phone @param {string} newId @param {number} at */
export async function contactFor(db, ws, phone, newId, at) {
  const [, sel] = await db.batch([
    db.prepare("insert into contacts (id, ws, phone, search, created_at, updated_at) values (?, ?, ?, ?, ?, ?) on conflict (ws, phone) do nothing").bind(newId, ws, phone, phone, at, at),
    db.prepare("select id from contacts where ws = ? and phone = ?").bind(ws, phone)
  ]);
  return String(((sel.results || [])[0] || {}).id || "");
}

/**
 * Запрет. Второй такой же действующий — не создаётся (уникальный индекс); ясный «стоп» поверх неоднозначного снимает
 * пометку «ждёт решения». event_key — id сообщения у провайдера: повторный вебхук не даёт второго события.
 * @param {any} db @param {string} ws
 * @param {{ contactId: string, kind: string, reason: string, source: string, actor: string, review?: boolean, legacyKey?: string|null, at: number, eventKey?: string, details?: any }} x
 * @returns {Promise<boolean>} true — запрет новый
 */
export async function restrictionAdd(db, ws, x) {
  const list = [
    db.prepare(`insert into restrictions (ws, contact_id, kind, channel, reason, source, actor, legacy_key, needs_review, created_at)
      values (?, ?, ?, '', ?, ?, ?, ?, ?, ?) on conflict do nothing returning id`).bind(ws, x.contactId, x.kind, x.reason.slice(0, 300), x.source, x.actor, x.legacyKey || null, x.review ? 1 : 0, x.at)
  ];
  if (!x.review) list.push(db.prepare("update restrictions set needs_review = 0 where ws = ? and contact_id = ? and kind = ? and lifted_at is null and needs_review = 1").bind(ws, x.contactId, x.kind));
  list.push(db.prepare("insert into events (ws, event_key, kind, contact_id, actor, details, at) values (?, ?, ?, ?, ?, ?, ?) on conflict do nothing")
    .bind(ws, x.eventKey || `r:${x.contactId}:${x.kind}:${x.at}`, x.review ? "stop_review" : x.kind === "full_block" ? "full_block" : "stop", x.contactId, x.actor, JSON.stringify({ reason: x.reason.slice(0, 200), source: x.source, ...(x.details || {}) }), x.at));
  const res = await db.batch(list);
  return (res[0].results || []).length === 1;
}

/** Снять запрет (кто и почему — обязательно). → вид снятого или null. @param {any} db @param {string} ws @param {{ contactId: string, rid: number, by: string, reason: string, at: number }} x */
export async function restrictionLift(db, ws, x) {
  const [r] = await db.batch([
    db.prepare("update restrictions set lifted_at = ?, lifted_by = ?, lift_reason = ?, needs_review = 0 where id = ? and ws = ? and contact_id = ? and lifted_at is null returning kind").bind(x.at, x.by, x.reason.slice(0, 300), x.rid, ws, x.contactId),
    db.prepare("insert into events (ws, event_key, kind, contact_id, actor, details, at) values (?, ?, 'lift', ?, ?, ?, ?) on conflict do nothing").bind(ws, `lift:${x.rid}:${x.at}`, x.contactId, x.by, JSON.stringify({ rid: x.rid, reason: x.reason.slice(0, 200) }), x.at),
    db.prepare("insert into audit (ws, actor, action, target, details, at) values (?, ?, 'restriction_lift', ?, ?, ?)").bind(ws, x.by, x.contactId, JSON.stringify({ rid: x.rid, reason: x.reason.slice(0, 200) }), x.at)
  ]);
  const row = (r.results || [])[0];
  return row ? String(row.kind) : null;
}
/** Решение по неоднозначному «стопу»: оставить запрет маркетинга (пометка снимается). @param {any} db @param {string} ws @param {string} contactId @param {number} rid @param {string} by @param {number} at */
export async function reviewKeep(db, ws, contactId, rid, by, at) {
  const [r] = await db.batch([
    db.prepare("update restrictions set needs_review = 0 where id = ? and ws = ? and contact_id = ? and lifted_at is null and needs_review = 1 returning id").bind(rid, ws, contactId),
    db.prepare("insert into audit (ws, actor, action, target, details, at) values (?, ?, 'review_keep', ?, ?, ?)").bind(ws, by, contactId, JSON.stringify({ rid }), at)
  ]);
  return (r.results || []).length === 1;
}
/** Действующие запреты контакта, которые закрывают маркетинг (для зеркала KV). @param {any} db @param {string} ws @param {string} contactId */
export async function blocksLeft(db, ws, contactId) {
  return +((await db.prepare("select count(*) n from restrictions where ws = ? and contact_id = ? and lifted_at is null and needs_review = 0 and kind in ('marketing_optout', 'full_block')").bind(ws, contactId).first("n")) || 0);
}

/**
 * Согласие — новая строка истории. confirmed — подтверждено ли (реклама — только по подтверждённому «да»), evidence — чем
 * (chat, document, oral, import, altegio, client_stop), evidenceRef — что именно, givenAt — когда клиент согласился или отказался.
 * @param {any} db @param {string} ws
 * @param {{ contactId: string, purpose: string, state: string, basis: string, source: string, actor: string, at: number, evidence?: string|null, evidenceRef?: string|null, confirmed?: boolean, givenAt?: number|null }} x
 */
export async function consentAdd(db, ws, x) {
  await db.batch([
    db.prepare("insert into consents (ws, contact_id, purpose, state, basis, source, actor, created_at, evidence, evidence_ref, confirmed, given_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ws, x.contactId, x.purpose, x.state, x.basis.slice(0, 200), x.source, x.actor, x.at, x.evidence || null, x.evidenceRef ? x.evidenceRef.slice(0, 200) : null, x.confirmed ? 1 : 0, x.givenAt ?? null),
    db.prepare("insert into events (ws, event_key, kind, contact_id, actor, details, at) values (?, ?, 'consent', ?, ?, ?, ?) on conflict do nothing").bind(ws, `consent:${x.contactId}:${x.purpose}:${x.at}`, x.contactId, x.actor,
      JSON.stringify({ purpose: x.purpose, state: x.state, basis: x.basis.slice(0, 120), evidence: x.evidence || null, confirmed: !!x.confirmed }), x.at)
  ]);
}

// источники запретов, которые поставил сам клиент («стоп», кнопка и отказ Meta, перенос его «стопа» из KV): снять их можно только после
// его нового подтверждённого согласия (решение владельца 31.10.2026). Остальные (поставил человек, пауза после отмены) — технические
export const CLIENT_SOURCES = ["chat_stop", "ga_journal", "meta_button", "meta_131050", "kv_migration", "kv", "kv_fallback"];
const CLIENT_IN = CLIENT_SOURCES.map(x => `'${x}'`).join(", ");

/** Когда клиент последний раз сам отказался (запрет от клиента — даже снятый — или отказ в согласии не из файла); null — никогда. @param {any} db @param {string} ws @param {string} contactId */
export async function refusedAt(db, ws, contactId) {
  const v = await db.prepare(`select max(t) t from (select max(created_at) t from restrictions where ws = ?1 and contact_id = ?2 and kind in ('marketing_optout', 'full_block') and needs_review = 0 and source in (${CLIENT_IN})
    union all select max(coalesce(given_at, created_at)) from consents where ws = ?1 and contact_id = ?2 and purpose = 'marketing' and state = 'denied' and coalesce(evidence, '') <> 'import')`).bind(ws, contactId).first("t");
  return v == null ? null : +v;
}
/** Номера, которые сами отказывались (импорт «да» им не записывается). @param {any} db @param {string} ws @param {string[]} phones */
export async function refusedPhones(db, ws, phones) {
  const out = new Set();
  for (let i = 0; i < phones.length; i += 2000) {
    const r = await db.prepare(`select c.phone from contacts c where c.ws = ?1 and c.phone in (select value from json_each(?2)) and (
      exists (select 1 from restrictions r where r.ws = c.ws and r.contact_id = c.id and r.kind in ('marketing_optout', 'full_block') and r.needs_review = 0 and r.source in (${CLIENT_IN}))
      or exists (select 1 from consents s where s.ws = c.ws and s.contact_id = c.id and s.purpose = 'marketing' and s.state = 'denied' and coalesce(s.evidence, '') <> 'import'))`).bind(ws, JSON.stringify(phones.slice(i, i + 2000))).all();
    for (const x of r.results || []) out.add(String(x.phone));
  }
  return out;
}
/** Последнее согласие на маркетинг. @param {any} db @param {string} ws @param {string} contactId */
export async function consentLast(db, ws, contactId) {
  return await db.prepare("select * from consents where ws = ? and contact_id = ? and purpose = 'marketing' order by id desc limit 1").bind(ws, contactId).first();
}
/** Запрет по id (в компании и у контакта). @param {any} db @param {string} ws @param {string} contactId @param {number} rid */
export async function restrictionGet(db, ws, contactId, rid) {
  return await db.prepare("select * from restrictions where id = ? and ws = ? and contact_id = ?").bind(rid, ws, contactId).first();
}

/** Есть ли контакт в компании. @param {any} db @param {string} ws @param {string} id @returns {Promise<{ id: string, phone: string } | null>} */
export async function contactOne(db, ws, id) {
  const r = await db.prepare("select id, phone from contacts where ws = ? and id = ?").bind(ws, id).first();
  return r ? { id: String(r.id), phone: String(r.phone) } : null;
}

// ---- расхождения KV и D1
/** Открыть (или ещё раз отметить) расхождение. @param {any} db @param {string} ws @param {string} kind @param {string} key @param {any} details @param {number} at */
export async function issueOpen(db, ws, kind, key, details, at) {
  await db.prepare("insert into sync_issues (ws, kind, key, details, created_at) values (?, ?, ?, ?, ?) on conflict do update set attempts = attempts + 1")
    .bind(ws, kind, key, details == null ? null : JSON.stringify(details), at).run();
}
/** @param {any} db @param {string} ws @param {string} kind @param {string} key @param {number} at */
export async function issueClose(db, ws, kind, key, at) {
  await db.prepare("update sync_issues set resolved_at = ? where ws = ? and kind = ? and key = ? and resolved_at is null").bind(at, ws, kind, key).run();
}
/** Открытые расхождения всех компаний (для фоновой починки). @param {any} db @param {number} n */
export async function issuesOpen(db, n) {
  return (await db.prepare("select ws, kind, key, details, attempts from sync_issues where resolved_at is null order by id limit ?").bind(n).all()).results || [];
}
/** Запреты, перенесённые из KV раньше (ключи legacy_key) — для проверки переноса. @param {any} db @param {string} ws */
export async function legacyKeys(db, ws) {
  const r = await db.prepare("select legacy_key from restrictions where ws = ? and legacy_key is not null").bind(ws).all();
  return new Set((r.results || []).map((/** @type {any} */ x) => String(x.legacy_key)));
}
/** Перенос пачки «стопов» из KV (идемпотентно: legacy_key уникален). rows: [{ id, p, at, meta }]. @param {any} db @param {string} ws @param {any[]} rows @param {number} at */
export async function legacyImport(db, ws, rows, at) {
  const j = JSON.stringify(rows);
  const [, ins] = await db.batch([
    db.prepare("insert into contacts (id, ws, phone, search, created_at, updated_at) select j.value ->> '$.id', ?1, j.value ->> '$.p', j.value ->> '$.p', ?2, ?2 from json_each(?3) j where true on conflict (ws, phone) do nothing").bind(ws, at, j),
    db.prepare(`insert into restrictions (ws, contact_id, kind, channel, reason, source, actor, legacy_key, needs_review, created_at)
      select ?1, c.id, 'marketing_optout', '', case when j.value ->> '$.meta' = 1 then 'Meta stop button' else 'STOP (KV)' end, 'kv_migration', 'migration', 'optout:' || ?1 || ':' || (j.value ->> '$.p'), 0, j.value ->> '$.at'
      from json_each(?2) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where true on conflict do nothing returning id`).bind(ws, j)
  ]);
  return (ins.results || []).length;
}

/** Сколько из этих номеров с действующим запретом маркетинга или полным. @param {any} db @param {string} ws @param {string[]} phones */
export async function blockedCount(db, ws, phones) {
  let n = 0;
  for (let i = 0; i < phones.length; i += 2000) {
    n += +((await db.prepare(`select count(distinct c.phone) n from contacts c join restrictions r on r.ws = c.ws and r.contact_id = c.id and r.lifted_at is null and r.kind in ('marketing_optout', 'full_block')
      where c.ws = ?1 and c.phone in (select value from json_each(?2))`).bind(ws, JSON.stringify(phones.slice(i, i + 2000))).first("n")) || 0);
  }
  return n;
}
/** Строка аудита. @param {any} db @param {string} ws @param {string} actor @param {string} action @param {string|null} target @param {any} details @param {number} at */
export async function auditAdd(db, ws, actor, action, target, details, at) {
  await db.prepare("insert into audit (ws, actor, action, target, details, at) values (?, ?, ?, ?, ?, ?)").bind(ws, actor, action, target, details == null ? null : JSON.stringify(details), at).run();
}
/** id действующего запрета вида. @param {any} db @param {string} ws @param {string} contactId @param {string} kind */
export async function restrictionActiveId(db, ws, contactId, kind) {
  return +((await db.prepare("select id from restrictions where ws = ? and contact_id = ? and kind = ? and lifted_at is null order by id desc limit 1").bind(ws, contactId, kind).first("id")) || 0);
}
