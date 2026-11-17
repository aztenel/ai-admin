// @ts-check
// CRM продаж Bot Flow — отдельный Worker (не ai-admin): лиды, оценка, воронка, перезвоны и встречи.
// Страница и скрипты — статические файлы из public/ (Workers Static Assets), этот файл отвечает только на /api/*.
// Пользователь один — владелец: вход ключом CRM_KEY (Secret в панели Cloudflare), дальше — подписанная cookie.
// Данные — в своей базе D1 (привязка DB), с данными клиентов ai-admin не пересекаются.
import { score, STAGE_IDS, ACTIVE, CALL_RESULTS, CLOSED, LPR_RESULTS, phoneKeys } from "../public/score.js";

const DAY = 864e5, SESSION_DAYS = 60, LOGIN_SLOT = 15 * 60e3, LOGIN_MAX = 10;
const enc = new TextEncoder();

/** @param {any} data @param {number} [status] @param {Record<string, string>} [headers] */
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }
});
/** @param {number} status @param {string} code @param {string} error @param {Record<string, any>} [more] */
const fail = (status, code, error, more = {}) => json({ ok: false, code, error, ...more }, status);

class Bad extends Error {
  /** @param {string} message @param {string} [field] */
  constructor(message, field = "") { super(message); this.field = field; }
}

/* ---------- вход ---------- */
/** @param {ArrayBuffer} buf */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** @param {string} key @param {string} msg */
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
/** сравнение строк без утечки по времени: сравниваются HMAC обеих строк со случайным ключом @param {string} a @param {string} b */
async function sameStr(a, b) {
  const k = b64u(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const [x, y] = await Promise.all([hmac(k, a), hmac(k, b)]);
  let d = x.length ^ y.length;
  for (let i = 0; i < x.length && i < y.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
/** ключ задан и не короткий: с коротким ключом CRM не открывается вообще @param {any} env */
const keyOf = env => { const k = String(env.CRM_KEY || ""); return k.length >= 12 ? k : ""; };
/** @param {Request} request @param {string} name */
const cookie = (request, name) => { const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")); return m ? m[1] : ""; };
/** @param {any} env @param {Request} request @param {number} now */
async function signedIn(env, request, now) {
  const key = keyOf(env), [exp, sig] = cookie(request, "crm").split(".");
  if (!key || !exp || !sig || !(+exp > now)) return false;
  return sameStr(sig, await hmac(key, "crm:" + exp));
}
/** @param {string} value @param {number} maxAge */
const setCookie = (value, maxAge) => `crm=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

/** @param {any} env @param {Request} request @param {number} now */
async function login(env, request, now) {
  const key = keyOf(env);
  if (!key) return fail(503, "nokey", "Ключ входа не задан. Добавьте Secret CRM_KEY (не короче 12 знаков) в настройках Worker.");
  const ip = request.headers.get("cf-connecting-ip") || "local", slot = Math.floor(now / LOGIN_SLOT);
  // попытка занимается ДО проверки ключа, одним запросом (счётчик растёт атомарно): иначе пачка одновременных запросов
  // проходила бы проверку «меньше предела» все разом и перебирала ключ быстрее, чем разрешено
  const r = await env.DB.batch([
    env.DB.prepare("INSERT INTO login_attempts (ip, slot, n) VALUES (?, ?, 1) ON CONFLICT (ip, slot) DO UPDATE SET n = n + 1 RETURNING n").bind(ip, slot),
    env.DB.prepare("DELETE FROM login_attempts WHERE slot < ?").bind(slot - 8)
  ]);
  if (r[0].results[0].n > LOGIN_MAX) return fail(429, "rate", "Слишком много попыток. Подождите 15 минут.");
  const body = await readJson(request);
  if (!(await sameStr(String(body.key || ""), key))) return fail(403, "badkey", "Ключ не подошёл.");
  // верный вход попытку не тратит
  await env.DB.prepare("UPDATE login_attempts SET n = n - 1 WHERE ip = ? AND slot = ? AND n > 0").bind(ip, slot).run();
  const exp = now + SESSION_DAYS * DAY;
  return json({ ok: true }, 200, { "set-cookie": setCookie(exp + "." + (await hmac(key, "crm:" + exp)), SESSION_DAYS * 86400) });
}

/* ---------- разбор ввода ---------- */
/** @param {Request} request @returns {Promise<Record<string, any>>} */
async function readJson(request) {
  const text = await request.text();
  if (text.length > 20000) throw new Bad("Слишком большой запрос");
  try { const j = JSON.parse(text || "{}"); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch (e) {}
  throw new Bad("Запрос не разобран");
}
const TEXT = { name: 120, niche: 60, city: 60, address: 200, phones: 120, gis_url: 400, instagram: 200, booking_url: 400, booking: 40, lpr_name: 120, lpr_phone: 40, next_what: 200, notes: 4000 };
const INT = { reviews: 1e7, masters: 1000, branches: 1000, ig_followers: 1e9, avg_check: 1e8, price: 1e10, prepay: 1e10, next_at: 1e14, meet_at: 1e14, paid_at: 1e14 };
const COLS = [...Object.keys(TEXT), ...Object.keys(INT), "rating", "ig_alive", "impression"];

/** @param {any} v @param {number} max @param {string} field */
function int(v, max, field) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[\s ]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Bad("Неверное число", field);
  return Math.round(n);
}
/** ссылка: «@имя» и «instagram.com/имя» — в адрес Instagram; без http — дописываем https @param {string} v @param {string} field */
function link(v, field) {
  if (!v) return "";
  if (field === "instagram" && /^@?[\w.]{1,30}$/.test(v)) return "https://instagram.com/" + v.replace(/^@/, "");
  const u = /^https?:\/\//i.test(v) ? v : "https://" + v;
  try { const p = new URL(u); if (p.protocol === "https:" || p.protocol === "http:") return p.href; } catch (e) {}
  throw new Bad("Ссылка не разобрана", field);
}
/**
 * Поля лида из запроса: только известные, обрезанные и проверенные. Поля, которых в запросе нет, не трогаем.
 * @param {Record<string, any>} body @returns {Record<string, any>}
 */
function fields(body) {
  /** @type {Record<string, any>} */ const out = {};
  for (const k in TEXT) if (k in body) {
    const v = String(body[k] ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, TEXT[/** @type {keyof typeof TEXT} */ (k)]);
    out[k] = k === "gis_url" || k === "instagram" || k === "booking_url" ? link(v, k) : v;
  }
  for (const k in INT) if (k in body) out[k] = int(body[k], INT[/** @type {keyof typeof INT} */ (k)], k);
  if ("rating" in body) {
    const v = body.rating === null || body.rating === "" ? null : Number(String(body.rating).replace(",", "."));
    if (v !== null && !(v >= 0 && v <= 5)) throw new Bad("Рейтинг — от 0 до 5", "rating");
    out.rating = v === null ? null : Math.round(v * 10) / 10;
  }
  if ("ig_alive" in body) out.ig_alive = body.ig_alive === null || body.ig_alive === "" ? null : (+body.ig_alive ? 1 : 0);
  if ("impression" in body) {
    const v = body.impression === null || body.impression === "" ? null : +body.impression;
    if (v !== null && ![1, 2, 3].includes(v)) throw new Bad("Впечатление — 1, 2 или 3", "impression");
    out.impression = v;
  }
  return out;
}
/** строка для поиска: SQLite сравнивает без учёта регистра только латиницу, поэтому храним текст в нижнем регистре @param {Record<string, any>} l */
const searchOf = l => [l.name, l.address, l.city, l.niche, l.lpr_name, l.booking, l.notes].map(v => String(v || "")).join(" ").toLowerCase().slice(0, 5000);

/* ---------- запросы ---------- */
const LIVE = "deleted_at IS NULL";
const LIST_COLS = "id, " + COLS.join(", ") + ", score, grade, stage, created_at, updated_at, touched_at";
const inList = (/** @type {string[]} */ a) => a.map(v => `'${v}'`).join(", ");

/** @param {any} db @param {string} id */
const getLead = (db, id) => db.prepare(`SELECT ${LIST_COLS} FROM leads WHERE id = ? AND ${LIVE}`).bind(id).first();

/** запросы записи лида целиком и его номеров (одной пачкой) @param {any} db @param {Record<string, any>} l @param {boolean} isNew */
function saveStatements(db, l, isNew) {
  const s = score(l);
  /** @type {Record<string, any>} */ const all = { ...l, score: s.score, grade: s.grade, search: searchOf(l) };
  const cols = [...COLS, "score", "grade", "stage", "search", "updated_at", "touched_at"];
  const vals = cols.map(c => all[c] ?? null);
  const st = isNew
    ? db.prepare(`INSERT INTO leads (id, created_at, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})`).bind(l.id, l.created_at, ...vals)
    : db.prepare(`UPDATE leads SET ${cols.map(c => c + " = ?").join(", ")} WHERE id = ?`).bind(...vals, l.id);
  const phones = [...new Set([...phoneKeys(l.phones), ...phoneKeys(l.lpr_phone)])];
  return [st, db.prepare("DELETE FROM lead_phones WHERE lead_id = ?").bind(l.id),
    ...phones.map(d => db.prepare("INSERT OR IGNORE INTO lead_phones (digits, lead_id) VALUES (?, ?)").bind(d, l.id))];
}
/** @param {any} db @param {string} id @param {number} at @param {string} kind @param {string} stage @param {string} note */
const touchStatement = (db, id, at, kind, stage, note) =>
  db.prepare("INSERT INTO touches (lead_id, at, kind, stage, note) VALUES (?, ?, ?, ?, ?)").bind(id, at, kind, stage, note);

/** лид с таким же номером (кроме самого себя) @param {any} db @param {string[]} keys @param {string} [selfId] */
async function findDup(db, keys, selfId = "") {
  if (!keys.length) return null;
  return db.prepare(`SELECT l.id, l.name, l.stage FROM lead_phones p JOIN leads l ON l.id = p.lead_id
    WHERE p.digits IN (${keys.map(() => "?").join(", ")}) AND l.${LIVE} AND l.id != ? LIMIT 1`).bind(...keys, selfId).first();
}

/** @param {any} env @param {Record<string, any>} body @param {number} now */
async function createLead(env, body, now) {
  const f = fields(body);
  if (!f.name) throw new Bad("Впишите название", "name");
  const stage = STAGE_IDS.includes(body.stage) ? body.stage : "new";
  if (!body.force) {
    const dup = await findDup(env.DB, phoneKeys(f.phones));
    if (dup) return fail(409, "dup", "Лид с таким номером уже есть: " + dup.name, { dup });
  }
  const l = { ...Object.fromEntries(COLS.map(c => [c, null])), ...Object.fromEntries(Object.keys(TEXT).map(c => [c, ""])), ...f, id: crypto.randomUUID(), stage, created_at: now, updated_at: now, touched_at: null };
  await env.DB.batch([...saveStatements(env.DB, l, true), touchStatement(env.DB, l.id, now, "note", stage, "Добавлен")]);
  return json({ ok: true, lead: await getLead(env.DB, l.id) }, 201);
}

/** @param {any} env @param {string} id @param {Record<string, any>} body @param {number} now */
async function updateLead(env, id, body, now) {
  const old = await getLead(env.DB, id);
  if (!old) return fail(404, "notfound", "Лид не найден");
  const f = fields(body);
  if ("name" in f && !f.name) throw new Bad("Впишите название", "name");
  const l = { ...old, ...f, updated_at: now };
  const st = saveStatements(env.DB, l, false);
  if ("stage" in body && body.stage !== old.stage) {
    if (!STAGE_IDS.includes(body.stage)) throw new Bad("Нет такого этапа", "stage");
    l.stage = body.stage;
    if (CLOSED.includes(l.stage)) { l.next_at = null; l.next_what = ""; }
    st.splice(0, st.length, ...saveStatements(env.DB, l, false), touchStatement(env.DB, id, now, "stage", l.stage, "Этап изменён вручную"));
  }
  await env.DB.batch(st);
  return json({ ok: true, lead: await getLead(env.DB, id) });
}

/**
 * Касание: итог звонка или заметка, следующий шаг, встреча, предоплата. Лид и запись в истории меняются одной пачкой.
 * @param {any} env @param {string} id @param {Record<string, any>} body @param {number} now
 */
async function touchLead(env, id, body, now) {
  const old = await getLead(env.DB, id);
  if (!old) return fail(404, "notfound", "Лид не найден");
  const result = body.result ? String(body.result) : "";
  if (result && !CALL_RESULTS.includes(result)) throw new Bad("Нет такого итога", "result");
  const note = String(body.note ?? "").trim().slice(0, 2000);
  const f = fields({ next_at: body.next_at, next_what: body.next_what ?? "", meet_at: body.meet_at, prepay: body.prepay, price: body.price });
  if (!result && !note && !f.next_at) throw new Bad("Выберите итог или напишите, что сказали");
  if (result === "meet" && !f.meet_at) throw new Bad("Укажите время встречи", "meet_at");
  if (result === "paid" && !(f.prepay > 0)) throw new Bad("Укажите сумму предоплаты", "prepay");
  const l = { ...old, updated_at: now, touched_at: now };
  if (result) l.stage = result;
  if (result === "meet") l.meet_at = f.meet_at;
  if (result === "paid") { l.prepay = f.prepay; l.paid_at = now; if (f.price) l.price = f.price; }
  if (result === "think" && f.price) l.price = f.price;
  if (CLOSED.includes(result)) { l.next_at = null; l.next_what = ""; }
  else if (f.next_at) { l.next_at = f.next_at; l.next_what = f.next_what || l.next_what || ""; }
  else if (result === "nd") { l.next_at = now + 2 * 3600e3; l.next_what = "Перезвонить"; } // не дозвонился — сам вернётся в «Сегодня» через 2 часа
  else if (result === "meet") { l.next_at = null; l.next_what = ""; } // встреча сама видна в «Сегодня» по своему времени — старый перезвон больше не нужен
  // «звонок» для счётчиков — любой итог, кроме предоплаты (её обычно берут на встрече)
  const kind = result && result !== "paid" ? "call" : "note";
  await env.DB.batch([...saveStatements(env.DB, l, false), touchStatement(env.DB, id, now, kind, result || old.stage, note)]);
  return json({ ok: true, lead: await getLead(env.DB, id) });
}

/** @param {any} env @param {URLSearchParams} q */
async function listLeads(env, q) {
  const where = [LIVE], args = [];
  const stage = q.get("stage") || "all", grade = q.get("grade"), text = (q.get("q") || "").trim().toLowerCase().slice(0, 100);
  if (stage === "work") where.push(`stage IN (${inList(ACTIVE)})`);
  else if (stage !== "all") { if (!STAGE_IDS.includes(stage)) throw new Bad("Нет такого этапа"); where.push("stage = ?"); args.push(stage); }
  if (grade !== null && grade !== "all") { if (!["A", "B", "C", ""].includes(grade)) throw new Bad("Нет такой оценки"); where.push("grade = ?"); args.push(grade); }
  for (const k of ["city", "niche", "booking"]) { const v = q.get(k); if (v) { where.push(k + " = ?"); args.push(v); } }
  // запрос из одних цифр, пробелов и скобок — поиск по номеру (кусок номера тоже), остальное — по словам в тексте лида
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 3 && /^[\d\s()+-]+$/.test(text)) { where.push("id IN (SELECT lead_id FROM lead_phones WHERE digits LIKE ?)"); args.push("%" + digits.replace(/^[78](?=\d{10}$)/, "") + "%"); }
  else for (const w of text.split(/\s+/).filter(Boolean).slice(0, 5)) { where.push("search LIKE ? ESCAPE '\\'"); args.push("%" + w.replace(/[\\%_]/g, "\\$&") + "%"); }
  const order = { score: "score DESC, created_at DESC", recent: "updated_at DESC", next: "next_at IS NULL, next_at ASC, score DESC" }[q.get("sort") || "score"] || "score DESC, created_at DESC";
  const limit = Math.min(100, Math.max(1, +(q.get("limit") || 50) || 50)), offset = Math.max(0, +(q.get("offset") || 0) || 0);
  const w = where.join(" AND ");
  const [rows, total] = await env.DB.batch([
    env.DB.prepare(`SELECT ${LIST_COLS} FROM leads WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...args, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) n FROM leads WHERE ${w}`).bind(...args)
  ]);
  return json({ ok: true, items: rows.results, total: total.results[0].n });
}

/** экран «Сегодня»: границы дня и «сейчас» присылает телефон — день считается по его часам @param {any} env @param {URLSearchParams} q @param {number} now */
async function today(env, q, now) {
  const from = +(q.get("from") || 0), to = +(q.get("to") || 0), week = +(q.get("week") || 0);
  if (!(from > 0 && to > from && to - from <= 2 * DAY)) throw new Bad("Не указан день");
  const act = inList(ACTIVE), db = env.DB, sel = `SELECT ${LIST_COLS} FROM leads WHERE ${LIVE} AND `;
  const r = await db.batch([
    db.prepare(sel + "stage = 'meet' AND meet_at >= ? AND meet_at < ? ORDER BY meet_at").bind(from, to),
    db.prepare(sel + `stage IN (${act}) AND next_at IS NOT NULL AND next_at < ? AND NOT (stage = 'meet' AND meet_at >= ?) ORDER BY next_at LIMIT 100`).bind(Math.min(now, to), from),
    db.prepare(sel + `stage IN (${act}) AND next_at >= ? AND next_at < ? ORDER BY next_at LIMIT 100`).bind(now, to),
    db.prepare(sel + "stage = 'meet' AND meet_at < ? ORDER BY meet_at LIMIT 50").bind(from),
    db.prepare(sel + "stage = 'new' ORDER BY score DESC, created_at LIMIT 30"),
    db.prepare(`SELECT COUNT(*) n FROM leads WHERE ${LIVE} AND stage = 'new'`),
    db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(t.stage IN (${inList(LPR_RESULTS)})), 0) lpr, COALESCE(SUM(t.stage = 'meet'), 0) meets
      FROM touches t JOIN leads l ON l.id = t.lead_id WHERE t.kind = 'call' AND t.at >= ? AND t.at < ? AND l.${LIVE}`).bind(from, to),
    db.prepare(`SELECT COALESCE(SUM(prepay), 0) s FROM leads WHERE ${LIVE} AND paid_at >= ?`).bind(week || from)
  ]);
  const [meetToday, overdue, later, meetPassed, fresh] = r.slice(0, 5).map((/** @type {any} */ x) => x.results);
  return json({ ok: true, meetToday, overdue, later, meetPassed, fresh, freshTotal: r[5].results[0].n,
    stats: { ...r[6].results[0], prepayWeek: r[7].results[0].s }, due: meetToday.length + overdue.length + later.length + meetPassed.length });
}

/** @param {any} env @param {number} now */
async function funnel(env, now) {
  const db = env.DB;
  const r = await db.batch([
    db.prepare(`SELECT stage, COUNT(*) n FROM leads WHERE ${LIVE} GROUP BY stage`),
    db.prepare(`SELECT grade, COUNT(*) n FROM leads WHERE ${LIVE} GROUP BY grade`),
    db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(t.stage NOT IN ('nd', 'bad')), 0) reach, COALESCE(SUM(t.at >= ?), 0) calls7,
      COUNT(DISTINCT CASE WHEN t.stage = 'meet' THEN t.lead_id END) meets
      FROM touches t JOIN leads l ON l.id = t.lead_id WHERE t.kind = 'call' AND l.${LIVE}`).bind(now - 7 * DAY),
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(prepay), 0) prepay, COALESCE(SUM(price), 0) price FROM leads WHERE ${LIVE} AND prepay > 0`)
  ]);
  return json({ ok: true, byStage: Object.fromEntries(r[0].results.map((/** @type {any} */ x) => [x.stage, x.n])),
    byGrade: Object.fromEntries(r[1].results.map((/** @type {any} */ x) => [x.grade || "?", x.n])), calls: r[2].results[0], paid: r[3].results[0] });
}

/** выгрузка всех лидов для Excel: разделитель «;», в начале — метка UTF-8 @param {any} env */
async function exportCsv(env) {
  const cols = ["name", "niche", "city", "address", "phones", "stage", "grade", "score", "booking", "reviews", "rating", "masters", "branches", "ig_followers", "ig_alive",
    "impression", "avg_check", "lpr_name", "lpr_phone", "next_at", "next_what", "meet_at", "price", "prepay", "paid_at", "gis_url", "instagram", "booking_url", "notes", "created_at", "touched_at"];
  const rows = (await env.DB.prepare(`SELECT ${cols.join(", ")} FROM leads WHERE ${LIVE} ORDER BY created_at`).all()).results;
  const time = new Set(["next_at", "meet_at", "paid_at", "created_at", "touched_at"]);
  // ячейку, которая начинается с = + - @, Excel принял бы за формулу — ставим перед ней апостроф
  const cell = (/** @type {any} */ v, /** @type {string} */ c) => {
    let s = v === null || v === undefined ? "" : time.has(c) ? new Date(+v + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : String(v);
    if (/^[=+\-@]/.test(s) && c !== "phones" && c !== "lpr_phone") s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = "﻿" + [cols.join(";"), ...rows.map((/** @type {any} */ r) => cols.map(c => cell(r[c], c)).join(";"))].join("\r\n");
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="crm-leads.csv"', "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

/* ---------- маршруты ---------- */
/** @param {Request} request @param {any} env */
async function api(request, env) {
  const url = new URL(request.url), P = url.pathname, M = request.method, now = Date.now();
  if (!env.DB) return fail(503, "nodb", "База не подключена");
  if (M !== "GET") {
    // изменяющие запросы — только со своей страницы и только JSON (чужой сайт такой запрос без разрешения не отправит)
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return fail(403, "origin", "Запрос с другого сайта");
    if (!/^application\/json/i.test(request.headers.get("content-type") || "")) return fail(415, "type", "Нужен JSON");
  }
  if (P === "/api/login" && M === "POST") return login(env, request, now);
  if (!(await signedIn(env, request, now))) return fail(401, "auth", "Нужен вход");
  if (P === "/api/logout" && M === "POST") return json({ ok: true }, 200, { "set-cookie": setCookie("x", 0) });
  if (P === "/api/me" && M === "GET") {
    const m = await env.DB.batch(["city", "niche", "booking"].map(k => env.DB.prepare(`SELECT ${k} v, COUNT(*) n FROM leads WHERE ${LIVE} AND ${k} != '' GROUP BY ${k} ORDER BY n DESC LIMIT 50`)));
    const [cities, niches, bookings] = m.map((/** @type {any} */ x) => x.results.map((/** @type {any} */ r) => r.v));
    return json({ ok: true, cities, niches, bookings });
  }
  if (P === "/api/today" && M === "GET") return today(env, url.searchParams, now);
  if (P === "/api/funnel" && M === "GET") return funnel(env, now);
  if (P === "/api/export.csv" && M === "GET") return exportCsv(env);
  if (P === "/api/leads" && M === "GET") return listLeads(env, url.searchParams);
  if (P === "/api/leads" && M === "POST") return createLead(env, await readJson(request), now);
  const m = P.match(/^\/api\/leads\/([0-9a-f-]{36})(\/touch)?$/);
  if (m) {
    const id = m[1];
    if (m[2]) return M === "POST" ? touchLead(env, id, await readJson(request), now) : fail(405, "method", "Не тот метод");
    if (M === "GET") {
      const lead = await getLead(env.DB, id);
      if (!lead) return fail(404, "notfound", "Лид не найден");
      const touches = (await env.DB.prepare("SELECT id, at, kind, stage, note FROM touches WHERE lead_id = ? ORDER BY at DESC, id DESC LIMIT 200").bind(id).all()).results;
      return json({ ok: true, lead, touches });
    }
    if (M === "PATCH") return updateLead(env, id, await readJson(request), now);
    if (M === "DELETE") {
      const r = await env.DB.prepare(`UPDATE leads SET deleted_at = ?, updated_at = ? WHERE id = ? AND ${LIVE}`).bind(now, now, id).run();
      return r.meta.changes ? json({ ok: true }) : fail(404, "notfound", "Лид не найден");
    }
  }
  return fail(404, "notfound", "Нет такого адреса");
}

export default {
  /** @param {Request} request @param {any} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    try { return await api(request, env); }
    catch (e) {
      if (e instanceof Bad) return fail(400, "bad", e.message, e.field ? { field: e.field } : {});
      console.log("crm error", String((e && /** @type {any} */ (e).stack) || e));
      return fail(500, "error", "Что-то сломалось. Попробуйте ещё раз.");
    }
  }
};
