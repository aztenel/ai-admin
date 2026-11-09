// Адаптер Meta Graph (план Meta, шаг 2, 09.11.2026): чтение (metaGet) и запись (metaWrite) с запретом на черновике, сведения номера
// (metaPhone), сведения WABA (metaWaba), список и подача шаблонов (tplList, tplCreate), номер и ключ компании (metaIds), имена
// переменных (META_VARS). До этого чтение номера шло прямо из bcHealth без срока ответа, а списка шаблонов и сведений WABA не было
// вовсе. Всё на заглушке test/meta.mjs, вживую не проверено. Номера и ключи вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { net, mkKV } from "../harness.mjs";
import { metaStub, metaEnv, metaIds as stubIds, META } from "../meta.mjs";
import { metaGet, metaWrite } from "../../src/services/integrations/meta/graph.js";
import { metaPhone, tierOf } from "../../src/services/integrations/meta/phone.js";
import { metaWaba } from "../../src/services/integrations/meta/waba.js";
import { tplList, tplCreate, tplView } from "../../src/services/integrations/meta/templates-api.js";
import { metaIds, WA_HINT } from "../../src/services/integrations/meta/client.js";
import { META_VARS } from "../../src/config/env.js";
import { bcHealth } from "../../src/services/broadcast/sender.js";
import { PREVIEW_HOOK } from "../../src/lib/stage.js";

const ROOT = new URL("../../", import.meta.url);
/** окружение с номером Meta компании (по умолчанию Winchester) */
const envOf = (/** @type {any} */ extra = {}, cid = "winchester") => ({ KV: mkKV().api, ...metaEnv(cid), ...extra });
const writes = () => net.graph.filter(g => g.method !== "GET");
const noToken = (/** @type {any} */ res, /** @type {string} */ token) => assert.equal(JSON.stringify(res).includes(token), false, "ключ попал в результат: " + JSON.stringify(res));
const RU = /[а-яё]/i;

test("metaIds: номер, WABA, есть ли секрет, через кого; ключ не перечисляется и в JSON не попадает", () => {
  const env = envOf();
  const ids = metaIds(env, "winchester");
  assert.equal(ids.pnid, META.pnid); assert.equal(ids.waba, META.waba); assert.equal(ids.hasSecret, true); assert.equal(ids.hasToken, true); assert.equal(ids.via, "");
  assert.equal(ids.up, "WINCHESTER");
  assert.equal(ids.token, META.token, "адаптеру ключ доступен");
  assert.ok(!Object.keys(ids).includes("token"), "ключ не перечисляется: случайный ответ пульту с ids его не покажет");
  noToken(ids, META.token); noToken({ ...ids }, META.token);
  const wz = metaIds({ ...env, WA_VIA_WINCHESTER: "Wazzapo" }, "winchester");
  assert.equal(wz.via, "wazzapo");
  const none = metaIds({ KV: env.KV }, "winchester");
  assert.equal(none.hasToken, false); assert.equal(none.hasSecret, false); assert.equal(none.waba, ""); assert.equal(none.token, "");
});

test("META_VARS: только имена и виды, каждое имя описано в CLAUDE.md §3", () => {
  const doc = readFileSync(new URL("CLAUDE.md", ROOT), "utf8");
  const names = META_VARS.map(v => v.name);
  for (const n of ["WA_TOKEN_<ID>", "APP_SECRET_<ID>", "PHONE_NUMBER_ID_<ID>", "WABA_ID_<ID>", "WA_SINCE_<ID>", "WA_VIA_<ID>", "VERIFY_TOKEN"]) assert.ok(names.includes(n), n);
  for (const v of META_VARS) {
    assert.ok(["secret", "text"].includes(v.kind), v.name);
    assert.deepEqual(Object.keys(v).filter(k => !["name", "kind", "what"].includes(k)), [], "в списке нет значений: " + v.name);
    assert.ok(doc.includes("`" + v.name + "`"), "нет в CLAUDE.md: " + v.name);
  }
  assert.equal(META_VARS.find(v => v.name === "WA_TOKEN_<ID>").kind, "secret");
  assert.equal(META_VARS.find(v => v.name === "APP_SECRET_<ID>").kind, "secret");
  assert.equal(META_VARS.find(v => v.name === "WABA_ID_<ID>").kind, "text");
});

test("WA_HINT: коды 10, 200 и 80008 — понятной причиной", () => {
  for (const c of [10, 200, 80008]) assert.ok(RU.test(WA_HINT[c] || ""), "нет подсказки " + c);
  assert.match(WA_HINT[10], /whatsapp_business_management/);
});

test("новые адаптеры ходят в Graph только через metaGet / metaWrite (у записи — запрет черновика)", () => {
  for (const f of ["phone.js", "waba.js", "templates-api.js"]) {
    const src = readFileSync(new URL("src/services/integrations/meta/" + f, ROOT), "utf8");
    assert.equal(/\bfetch\s*\(/.test(src), false, f + " зовёт fetch мимо graph.js");
  }
  const g = readFileSync(new URL("src/services/integrations/meta/graph.js", ROOT), "utf8");
  assert.match(g, /isPreview\(env\)/);
});

test("metaGet: зависший Graph завершается по сроку с «Meta не отвечает», без повтора; ключ — только заголовком", async () => {
  net.reset();
  metaStub(net, { hang: true, hangMs: 5000 });
  const t0 = Date.now();
  const r = await metaGet(envOf(), META.token, `${META.pnid}?fields=display_phone_number`, { ms: 60 });
  assert.equal(r.ok, false); assert.equal(r.status, 0); assert.match(r.why, /Meta не отвечает/);
  assert.ok(Date.now() - t0 < 2000, "срок не сработал");
  assert.equal(net.graph.length, 1, "срок ответа не повторяется: иначе ожидание удваивается");
  assert.equal(net.graph[0].aborted, true); assert.notEqual(net.graph[0].noSignal, true);
  noToken(r, META.token);
  // обрыв связи — тоже без повтора
  net.reset(); metaStub(net, { fail: { drop: true } });
  const d = await metaGet(envOf(), META.token, `${META.pnid}?fields=display_phone_number`);
  assert.equal(d.ok, false); assert.equal(d.status, 0); assert.ok(RU.test(d.why)); assert.equal(net.graph.length, 1);
  // ключ — в заголовке, не в адресе (адрес попадает в журналы)
  net.reset(); metaStub(net);
  const ok = await metaGet(envOf(), META.token, `${META.pnid}?fields=display_phone_number`);
  assert.equal(ok.ok, true); assert.equal(ok.j.display_phone_number, META.display);
  assert.equal(net.graph[0].tokenVia, "header"); assert.equal(net.graph[0].url.includes(META.token), false);
});

test("metaGet: 429 и 5xx — один повтор, остальные отказы — без повтора", async () => {
  const path = `${META.waba}/message_templates?limit=100`, on = "GET /message_templates";
  for (const fail of [{ status: 500 }, { status: 503 }, { status: 429, code: 130429 }, { status: 502, raw: "<html>Bad gateway</html>" }]) {
    net.reset(); metaStub(net, { fail: { on, times: 1, ...fail } });
    const r = await metaGet(envOf(), META.token, path, { pause: 0 });
    assert.equal(r.ok, true, JSON.stringify(fail)); assert.equal(net.graph.length, 2, JSON.stringify(fail));
  }
  net.reset(); metaStub(net, { fail: { on, status: 500 } });
  let r = await metaGet(envOf(), META.token, path, { pause: 0 });
  assert.equal(r.ok, false); assert.equal(r.status, 500); assert.equal(net.graph.length, 2, "повтор один");
  assert.ok(RU.test(r.why));
  for (const code of [190, 10, 200, 100, 80008, 131031]) {
    net.reset(); metaStub(net, { fail: { on, code } });
    r = await metaGet(envOf(), META.token, path, { pause: 0 });
    assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(net.graph.length, 1, "код " + code + " не повторяется");
  }
});

test("metaWrite: на черновике — 409 preview и ни одного запроса; на боевом — один запрос без повтора, срок — «неизвестно»", async () => {
  net.reset(); metaStub(net);
  let r = await metaWrite(envOf({ STAGE: "preview" }), META.token, "POST", `${META.waba}/subscribed_apps`, {});
  assert.deepEqual({ ok: r.ok, status: r.status, code: r.code, error: r.error }, { ok: false, status: 409, code: "preview", error: PREVIEW_HOOK });
  r = await metaWrite(envOf({ STAGE: "preview" }), META.token, "DELETE", `${META.waba}/subscribed_apps`);
  assert.equal(r.code, "preview");
  assert.equal(net.graph.length, 0);
  // GET через metaWrite не ходит (чтение — metaGet): ошибка вызова, а не тихий запрос
  r = await metaWrite(envOf(), META.token, "GET", `${META.waba}`);
  assert.equal(r.ok, false); assert.equal(net.graph.length, 0);
  // боевой: один POST
  r = await metaWrite(envOf(), META.token, "POST", `${META.waba}/subscribed_apps`, {});
  assert.equal(r.ok, true); assert.deepEqual(r.j, { success: true }); assert.equal(writes().length, 1);
  assert.equal(writes()[0].tokenVia, "header");
  // 500 — без повтора, «неизвестно, применилось ли»
  net.reset(); metaStub(net, { fail: { on: "POST /subscribed_apps", status: 500 } });
  r = await metaWrite(envOf(), META.token, "POST", `${META.waba}/subscribed_apps`, {});
  assert.equal(r.ok, false); assert.equal(r.unsure, true); assert.equal(writes().length, 1, "запись вслепую не повторяется");
  // срок — тоже «неизвестно», без повтора
  net.reset(); metaStub(net, { fail: { on: "POST /subscribed_apps", hang: true }, hangMs: 5000 });
  r = await metaWrite(envOf(), META.token, "POST", `${META.waba}/subscribed_apps`, {}, { ms: 60 });
  assert.equal(r.ok, false); assert.equal(r.status, 0); assert.equal(r.unsure, true); assert.equal(writes().length, 1);
  // точный отказ (400) — не «неизвестно»
  net.reset(); metaStub(net, { fail: { on: "POST /subscribed_apps", code: 100 } });
  r = await metaWrite(envOf(), META.token, "POST", `${META.waba}/subscribed_apps`, {});
  assert.equal(r.ok, false); assert.equal(r.unsure, false); assert.equal(r.code, 100);
});

const TPLS = [
  { name: "winchester_s01_v1", category: "UTILITY", body: "Вы записаны на услугу: {{service}}\nБарбер: {{barber}}\nЖдём вас.", buttons: ["Стоп"] },
  { name: "winchester_old", category: "MARKETING", status: "REJECTED", rejected_reason: "INVALID_FORMAT", body: "Привет, {{1}}! Скидка {{2}} до конца недели." },
  { name: "winchester_promo", category: "MARKETING", status: "PAUSED", quality: "RED", header: "Новости {{1}}", body: "Акция {{1}} для вас.", footer: "Winchester",
    buttons: [{ type: "URL", text: "Записаться", url: "https://winchester.kz/{{1}}" }, { type: "PHONE_NUMBER", text: "Позвонить", phone_number: "+77000000333" }] },
  { name: "winchester_img", category: "MARKETING", lang: "kk", header: { format: "IMAGE" }, body: "Апта акциясы. Күтеміз." }
];

test("tplList: страницы по курсору after (ключ из paging.next не берётся), разбор тела, параметров, шапки, кнопок и статусов", async () => {
  net.reset();
  metaStub(net, { pageMax: 2, templates: TPLS });
  const env = envOf(), res = await tplList(env, metaIds(env, "winchester"));
  assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.more, false);
  assert.equal(net.graph.length, 2, "две страницы");
  assert.ok(net.graph.every(g => g.method === "GET" && g.tokenVia === "header" && !g.url.includes(META.token) && g.path === `/${META.waba}/message_templates`));
  assert.ok(net.graph[1].query.after, "вторая страница — по курсору");
  noToken(res, META.token);
  const by = Object.fromEntries(res.list.map(t => [t.name, t]));
  assert.deepEqual(Object.keys(by).sort(), TPLS.map(t => t.name).sort());
  const s01 = by.winchester_s01_v1;
  assert.deepEqual({ status: s01.status, category: s01.category, lang: s01.lang, pf: s01.pf, params: s01.params, body: s01.body, header: s01.header, reason: s01.reason },
    { status: "APPROVED", category: "UTILITY", lang: "ru", pf: "named", params: ["service", "barber"], body: TPLS[0].body, header: null, reason: "" });
  assert.deepEqual(s01.buttons, [{ type: "QUICK_REPLY", text: "Стоп" }]);
  assert.ok(s01.id);
  const old = by.winchester_old;
  assert.deepEqual({ status: old.status, pf: old.pf, params: old.params, reason: old.reason }, { status: "REJECTED", pf: "positional", params: ["1", "2"], reason: "INVALID_FORMAT" });
  const promo = by.winchester_promo;
  assert.equal(promo.status, "PAUSED"); assert.equal(promo.quality, "RED"); assert.equal(promo.footer, "Winchester");
  assert.deepEqual(promo.header, { format: "TEXT", text: "Новости {{1}}", params: ["1"] });
  assert.deepEqual(promo.buttons, [{ type: "URL", text: "Записаться", url: "https://winchester.kz/{{1}}", param: true }, { type: "PHONE_NUMBER", text: "Позвонить" }]);
  const img = by.winchester_img;
  assert.equal(img.lang, "kk"); assert.deepEqual(img.header, { format: "IMAGE" }); assert.deepEqual(img.params, []);
});

test("tplList: не больше 5 страниц (more: true); сбой второй страницы — ошибка, а не половина списка", async () => {
  net.reset();
  metaStub(net, { pageMax: 1, templates: Array.from({ length: 7 }, (_, i) => ({ name: "winchester_t" + i, body: "Текст " + i + "." })) });
  let env = envOf(), res = await tplList(env, metaIds(env, "winchester"));
  assert.equal(res.ok, true); assert.equal(res.list.length, 5); assert.equal(res.more, true); assert.equal(net.graph.length, 5);
  net.reset();
  const st = metaStub(net, { pageMax: 1, templates: TPLS });
  st.fail({ on: g => g.method === "GET" && !!g.query.after, code: 190 });
  env = envOf(); res = await tplList(env, metaIds(env, "winchester"));
  assert.equal(res.ok, false); assert.equal(res.code, 190); assert.ok(!("list" in res) || !res.list, "половины списка нет: иначе шаблоны выглядели бы удалёнными");
});

test("ошибки 190, 10, 200, 100 (не тот WABA / номер) и 80008 — русской причиной; ключа нет ни в одном ответе", async () => {
  const on = "GET /message_templates";
  /** @type {[any, RegExp][]} */
  const cases = [[{ code: 190 }, /токен|ключ/i], [{ code: 10 }, /разрешени|прав/i], [{ code: 200 }, /разрешени|доступ/i], [{ code: 80008 }, /много запросов/i],
    [{ code: 190, message: "Malformed access token " + META.token }, /токен|ключ/i], [{ code: 100, message: "Invalid parameter " + META.token }, RU]];
  for (const [fail, re] of cases) {
    net.reset(); metaStub(net, { fail: { on, ...fail } });
    const env = envOf(), res = await tplList(env, metaIds(env, "winchester"));
    assert.equal(res.ok, false); assert.equal(res.code, fail.code); assert.match(res.why, re, JSON.stringify(res)); assert.ok(RU.test(res.why));
    noToken(res, META.token);
  }
  // не тот WABA — Meta не видит объект (100/33): причина называет переменную, один запрос
  net.reset(); metaStub(net);
  let env = envOf({ WABA_ID_WINCHESTER: "800999" }), res = await tplList(env, metaIds(env, "winchester"));
  assert.equal(res.ok, false); assert.equal(res.code, 100); assert.match(res.why, /WABA_ID_WINCHESTER/); assert.equal(net.graph.length, 1);
  // не тот номер — причина называет PHONE_NUMBER_ID, один запрос (лестница полей при 100/33 не нужна)
  net.reset(); metaStub(net);
  env = envOf({ PHONE_NUMBER_ID_WINCHESTER: "900999" });
  const ph = await metaPhone(env, metaIds(env, "winchester"));
  assert.equal(ph.ok, false); assert.match(ph.why, /PHONE_NUMBER_ID_WINCHESTER/); assert.equal(net.graph.length, 1);
  // неверный ключ
  net.reset(); metaStub(net);
  env = envOf({ WA_TOKEN_WINCHESTER: "test-bad-token-xyz" });
  const bad = await metaPhone(env, metaIds(env, "winchester"));
  assert.equal(bad.ok, false); assert.equal(bad.code, 190); assert.match(bad.why, /токен|ключ/i); noToken(bad, "test-bad-token-xyz");
});

test("metaPhone: поля номера, предел TIER_250 / TIER_2K / UNLIMITED, лестница полей при коде 100", async () => {
  net.reset(); metaStub(net);
  let env = envOf(), r = await metaPhone(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual({ phone: r.phone, name: r.name, quality: r.quality, limit: r.limit, tier: r.tier, status: r.status, nameStatus: r.nameStatus, verify: r.verify, platform: r.platform, mode: r.mode, throughput: r.throughput },
    { phone: META.display, name: META.name, quality: "GREEN", limit: 250, tier: "TIER_250", status: "CONNECTED", nameStatus: "APPROVED", verify: "VERIFIED", platform: "CLOUD_API", mode: "LIVE", throughput: "STANDARD" });
  assert.equal(net.graph.length, 1); noToken(r, META.token);
  assert.deepEqual([tierOf("TIER_250").limit, tierOf("TIER_2K").limit, tierOf("TIER_10K").limit, tierOf("TIER_100K").limit, tierOf("TIER_UNLIMITED").limit, tierOf("UNLIMITED").limit, tierOf("").limit, tierOf("TIER_50").limit],
    [250, 2000, 10000, 100000, -1, -1, 0, 50]);
  assert.deepEqual(tierOf({ current_limit: "TIER_2K" }), { tier: "TIER_2K", limit: 2000 }, "предел объектом — тоже читается");
  // новое поле предела неизвестно → старое (как прежний bcHealth), остальные поля номера на месте
  net.reset(); metaStub(net, { unknownFields: ["whatsapp_business_manager_messaging_limit"], phone: { messaging_limit_tier: "TIER_2K" } });
  r = await metaPhone(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true); assert.equal(r.limit, 2000); assert.equal(r.status, "CONNECTED"); assert.equal(net.graph.length, 2);
  assert.ok(net.graph[1].query.fields.includes("messaging_limit_tier") && !net.graph[1].query.fields.includes("whatsapp_business_manager_messaging_limit"));
  // неизвестного нет ни того, ни другого поля — номер без предела
  net.reset(); metaStub(net, { unknownFields: ["whatsapp_business_manager_messaging_limit", "messaging_limit_tier"] });
  r = await metaPhone(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true); assert.equal(r.limit, 0); assert.equal(r.quality, "GREEN"); assert.equal(net.graph.length, 3);
  // неизвестное дополнительное поле (другая версия API) — убирается, предел остаётся
  net.reset(); metaStub(net, { unknownFields: ["account_mode"] });
  r = await metaPhone(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true); assert.equal(r.limit, 250); assert.equal(r.mode, ""); assert.equal(net.graph.length, 2);
  // UNLIMITED и жёлтое качество
  net.reset(); metaStub(net, { phone: { whatsapp_business_manager_messaging_limit: "TIER_UNLIMITED", quality_rating: "yellow", status: "FLAGGED", name_status: "DECLINED" } });
  r = await metaPhone(env, metaIds(env, "winchester"));
  assert.deepEqual([r.limit, r.quality, r.status, r.nameStatus], [-1, "YELLOW", "FLAGGED", "DECLINED"]);
  // без номера или ключа — понятная причина и ни одного запроса
  net.reset(); metaStub(net);
  for (const e of [envOf({ PHONE_NUMBER_ID_WINCHESTER: "" }), envOf({ WA_TOKEN_WINCHESTER: "" }), envOf({ PHONE_NUMBER_ID_WINCHESTER: "900333/../x" })]) {
    r = await metaPhone(e, metaIds(e, "winchester"));
    assert.equal(r.ok, false); assert.ok(RU.test(r.why)); assert.match(r.why, /WINCHESTER/);
  }
  assert.equal(net.graph.length, 0);
});

test("нет WABA_ID — понятная причина и ни одного вызова Graph (список, подача, сведения WABA)", async () => {
  net.reset(); metaStub(net);
  const env = envOf({ WABA_ID_WINCHESTER: "" }), ids = metaIds(env, "winchester");
  for (const r of [await tplList(env, ids), await metaWaba(env, ids), await tplCreate(env, ids, { name: "winchester_x_v1", language: "ru", category: "UTILITY", components: [{ type: "BODY", text: "Текст." }] })]) {
    assert.equal(r.ok, false); assert.equal(r.code, "nowaba"); assert.match(r.why, /WABA_ID_WINCHESTER/);
  }
  assert.equal(net.graph.length, 0);
});

test("tplCreate: подаёт ровно тот JSON; на черновике — 409 preview без запроса; неверное имя — отказ до Graph", async () => {
  net.reset();
  const st = metaStub(net);
  const spec = { name: "winchester_s01_v1", language: "ru", category: "UTILITY", parameter_format: "named",
    components: [{ type: "BODY", text: "Вы записаны на {{service}}. Ждём вас.", example: { body_text_named_params: [{ param_name: "service", example: "Стрижка" }] } }] };
  let env = envOf(), r = await tplCreate(env, metaIds(env, "winchester"), spec);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.status, "PENDING"); assert.equal(r.category, "UTILITY"); assert.ok(r.id);
  assert.equal(writes().length, 1); assert.equal(writes()[0].path, `/${META.waba}/message_templates`);
  const { id, waba, ...sent } = st.created[0];
  assert.deepEqual(sent, spec); assert.equal(waba, META.waba);
  // Meta отказала (переменная в конце текста) — причина Meta видна, без повтора
  r = await tplCreate(env, metaIds(env, "winchester"), { ...spec, name: "winchester_s01_v2", components: [{ type: "BODY", text: "Вы записаны на {{service}}", example: { body_text_named_params: [{ param_name: "service", example: "Стрижка" }] } }] });
  assert.equal(r.ok, false); assert.equal(r.code, 100); assert.equal(r.unsure, false); assert.match(r.user || "", /start or end/); assert.equal(writes().length, 2);
  // черновик
  net.reset(); metaStub(net);
  env = envOf({ STAGE: "preview" });
  r = await tplCreate(env, metaIds(env, "winchester"), spec);
  assert.deepEqual({ ok: r.ok, status: r.status, code: r.code }, { ok: false, status: 409, code: "preview" });
  assert.equal(writes().length, 0);
  // неверное имя или категория — до Graph
  env = envOf();
  for (const bad of [{ ...spec, name: "Winchester S01" }, { ...spec, category: "PROMO" }, { ...spec, language: "" }, { ...spec, components: [] }]) {
    r = await tplCreate(env, metaIds(env, "winchester"), bad);
    assert.equal(r.ok, false); assert.equal(r.code, "bad"); assert.ok(RU.test(r.why));
  }
  assert.equal(net.graph.length, 0);
});

test("metaWaba: сведения аккаунта, подписанные приложения и номера; только GET", async () => {
  net.reset(); metaStub(net, { waba: { account_review_status: "PENDING" } });
  let env = envOf(), r = await metaWaba(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, META.name); assert.equal(r.review, "PENDING"); assert.equal(r.verify, "verified"); assert.ok(r.ns);
  assert.deepEqual(r.apps.map((/** @type {any} */ a) => a.id), [META.app]);
  assert.equal(r.numbers.length, 1); assert.equal(r.numbers[0].id, META.pnid); assert.equal(r.numbers[0].phone, META.display); assert.equal(r.hasPhone, true);
  assert.equal(writes().length, 0); noToken(r, META.token);
  // номер компании не из этого WABA — видно сразу
  net.reset(); metaStub(net, { apps: [], numbers: [{ id: "900777", display_phone_number: "+7 700 000 07 77" }] });
  r = await metaWaba(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true); assert.equal(r.hasPhone, false); assert.deepEqual(r.apps, []);
  // подписанные приложения не прочитались — остальное есть, причина отдельно
  net.reset(); metaStub(net, { fail: { on: "GET /subscribed_apps", code: 200 } });
  r = await metaWaba(env, metaIds(env, "winchester"));
  assert.equal(r.ok, true); assert.equal(r.apps, null); assert.match(r.appsWhy, /разрешени|доступ/i); assert.equal(r.numbers.length, 1);
  // сам WABA не прочитался — ошибка
  net.reset(); metaStub(net, { fail: { on: `GET /${META.waba}`, code: 190 } });
  r = await metaWaba(env, metaIds(env, "winchester"));
  assert.equal(r.ok, false); assert.equal(r.code, 190);
});

test("компании A и B ходят каждая со своим ключом, номером и WABA", async () => {
  net.reset();
  const st = metaStub(net, { templates: [{ name: "winchester_a", body: "Текст A." }] });
  st.add({ cid: "barber", templates: [{ name: "barber_b", body: "Текст B." }] });
  const env = { KV: mkKV().api, ...metaEnv("winchester"), ...metaEnv("barber") }, B = stubIds("barber");
  const a = await tplList(env, metaIds(env, "winchester")), b = await tplList(env, metaIds(env, "barber"));
  assert.deepEqual(a.list.map((/** @type {any} */ t) => t.name), ["winchester_a"]); assert.deepEqual(b.list.map((/** @type {any} */ t) => t.name), ["barber_b"]);
  assert.equal(net.graph[0].auth, "Bearer " + META.token); assert.equal(net.graph[0].path, `/${META.waba}/message_templates`);
  assert.equal(net.graph[1].auth, "Bearer " + B.token); assert.equal(net.graph[1].path, `/${B.waba}/message_templates`);
  const pa = await metaPhone(env, metaIds(env, "winchester")), pb = await metaPhone(env, metaIds(env, "barber"));
  assert.equal(pa.phone, META.display); assert.equal(pb.phone, B.display);
  assert.equal(net.graph[2].auth, "Bearer " + META.token); assert.equal(net.graph[3].auth, "Bearer " + B.token);
  noToken([a, b, pa, pb], META.token); noToken([a, b, pa, pb], B.token);
  // ключ B к WABA A — Meta объект не показывает (100/33): чужие шаблоны не читаются
  const mix = await tplList(env, { ...metaIds(env, "winchester"), get token() { return B.token; } });
  assert.equal(mix.ok, false); assert.equal(mix.code, 100);
});

test("tplView: разбор одного шаблона Graph терпит пропуски", () => {
  assert.deepEqual(tplView({ name: "x", status: "approved" }), { id: "", name: "x", lang: "", status: "APPROVED", category: "", prev: "", quality: "", reason: "", pf: "positional", body: "", params: [], header: null, footer: "", buttons: [] });
  const t = tplView({ id: "1", name: "y", language: "ru", components: [{ type: "BODY", text: "Дата {{date}} и {{date}}, {{time}}." }] });
  assert.equal(t.pf, "named"); assert.deepEqual(t.params, ["date", "time"]);
});

test("bcHealth: прежний вид ответа через metaPhone; срок у запроса есть; ошибка — прежним текстом", async () => {
  net.reset(); metaStub(net);
  const env = envOf(), route = { client: "winchester" };
  let h = await bcHealth(env, route);
  assert.deepEqual(h, { phone: META.display, name: META.name, quality: "GREEN", limit: 250 });
  assert.notEqual(net.graph[0].noSignal, true);
  net.reset(); metaStub(net, { phone: { whatsapp_business_manager_messaging_limit: "TIER_2K" } });
  assert.equal((await bcHealth(env, route)).limit, 2000);
  net.reset(); metaStub(net, { fail: { code: 190 } });
  h = await bcHealth(env, route);
  assert.match(h.error, /^Meta не отдала сведения о номере \(код 190: токен истёк/); noToken(h, META.token);
  net.reset(); metaStub(net, { hang: true, hangMs: 30 });
  h = await bcHealth(env, route);
  assert.equal(h.error, "Meta не отвечает, сведения о номере получить не удалось.");
  assert.notEqual(net.graph[0].noSignal, true, "у запроса номера должен быть срок ответа");
});
