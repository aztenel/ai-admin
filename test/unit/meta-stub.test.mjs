// Заглушка Meta Graph (test/meta.mjs) и помощники подписанных вебхуков Meta: основа для проверок номера Meta у Winchester
// (ТЗ v4 §5, план шаг 1, 09.11.2026). До неё заглушка на любой адрес Graph отвечала как на отправку сообщения — и на чтение
// сведений о номере, и на список шаблонов: проверить чтение номера, WABA и шаблонов было нечем. Код сервера здесь не меняется:
// проверяется сама заглушка — что она отвечает как Graph (поля, страницы, коды ошибок) и что отказы вставляются предсказуемо.
// Номера и ключи вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { metaStub, metaEnv, metaSignal, metaStatuses, metaEvent, metaMessages, META } from "../meta.mjs";
import { GRAPH } from "../../src/config/constants.js";

const AUTH = { authorization: "Bearer " + META.token };
/** запрос к Graph через подменённый fetch: тело — JSON, ответ — { status, j } */
async function g(path, { method = "GET", body, token = META.token, signal } = {}) {
  const r = await fetch(GRAPH + path, { method, headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}

test("номер: GET /{pnid}?fields= — только запрошенные поля и id, как Graph; неизвестное поле — код 100", async () => {
  net.reset(); metaStub(net);
  const { status, j } = await g(`/${META.pnid}?fields=display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit,status,name_status`);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(j).sort(), ["display_phone_number", "id", "name_status", "quality_rating", "status", "verified_name", "whatsapp_business_manager_messaging_limit"]);
  assert.equal(j.id, META.pnid); assert.equal(j.display_phone_number, META.display); assert.equal(j.quality_rating, "GREEN");
  assert.equal(j.whatsapp_business_manager_messaging_limit, "TIER_250"); assert.equal(j.status, "CONNECTED"); assert.equal(j.name_status, "APPROVED");
  const bad = await g(`/${META.pnid}?fields=display_phone_number,no_such_field`);
  assert.equal(bad.status, 400); assert.equal(bad.j.error.code, 100); assert.match(bad.j.error.message, /no_such_field/);
  // запись — с путём без версии и разобранным запросом: проверкам не нужно разбирать адрес
  const rec = net.graph[0];
  assert.equal(rec.method, "GET"); assert.equal(rec.path, "/" + META.pnid); assert.equal(rec.query.fields.split(",")[0], "display_phone_number"); assert.equal(rec.auth, AUTH.authorization);
});

test("номер: старое поле предела (лестница полей при коде 100) и смена качества на лету", async () => {
  net.reset();
  const st = metaStub(net, { unknownFields: ["whatsapp_business_manager_messaging_limit"], phone: { messaging_limit_tier: "TIER_2K" } });
  let r = await g(`/${META.pnid}?fields=display_phone_number,quality_rating,whatsapp_business_manager_messaging_limit`);
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 100);
  r = await g(`/${META.pnid}?fields=display_phone_number,quality_rating,messaging_limit_tier`);
  assert.equal(r.status, 200); assert.equal(r.j.messaging_limit_tier, "TIER_2K");
  st.phone.quality_rating = "YELLOW"; // проверка меняет сведения номера — следующий ответ уже с ними
  r = await g(`/${META.pnid}?fields=quality_rating`);
  assert.equal(r.j.quality_rating, "YELLOW");
  r = await g(`/${META.waba}/phone_numbers`);
  assert.equal(r.j.data[0].quality_rating, "YELLOW", "список номеров WABA — из тех же сведений");
});

test("WABA: сведения аккаунта, подписанные приложения и номера; подписка приложения — запись (POST/DELETE)", async () => {
  net.reset();
  const st = metaStub(net, { waba: { account_review_status: "PENDING" } });
  let r = await g(`/${META.waba}?fields=account_review_status,business_verification_status`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.j, { id: META.waba, account_review_status: "PENDING", business_verification_status: "verified" });
  r = await g(`/${META.waba}/subscribed_apps`);
  assert.equal(r.j.data.length, 1); assert.ok(r.j.data[0].whatsapp_business_api_data.id);
  r = await g(`/${META.waba}/phone_numbers`);
  assert.equal(r.j.data.length, 1); assert.equal(r.j.data[0].id, META.pnid); assert.equal(r.j.data[0].display_phone_number, META.display);
  r = await g(`/${META.waba}/subscribed_apps`, { method: "DELETE" });
  assert.deepEqual(r.j, { success: true });
  assert.equal((await g(`/${META.waba}/subscribed_apps`)).j.data.length, 0);
  r = await g(`/${META.waba}/subscribed_apps`, { method: "POST" });
  assert.deepEqual(r.j, { success: true });
  assert.equal((await g(`/${META.waba}/subscribed_apps`)).j.data.length, 1);
  assert.deepEqual(st.subscribed.map(x => x.method), ["DELETE", "POST"]);
  // приложение не подписано с самого начала
  net.reset(); metaStub(net, { apps: [] });
  assert.equal((await g(`/${META.waba}/subscribed_apps`)).j.data.length, 0);
});

test("шаблоны: список страницами через paging.next / after; поля по fields", async () => {
  net.reset();
  const st = metaStub(net, { pageMax: 2, templates: [
    { name: "winchester_s01_v1", category: "UTILITY", body: "Вы записаны {{date}} в {{time}}, мастер {{staff}}. Ждём вас." },
    { name: "winchester_w01_v1", category: "MARKETING", body: "Добрый день! Давно вас не видели.", buttons: ["Стоп"] },
    { name: "winchester_old", category: "MARKETING", status: "REJECTED", rejected_reason: "INVALID_FORMAT", body: "Привет, {{1}}! Скидка {{2}}." },
    { name: "other_promo", category: "MARKETING", body: "Чужой шаблон без префикса." }] });
  let r = await g(`/${META.waba}/message_templates?limit=100`);
  assert.equal(r.status, 200);
  assert.equal(r.j.data.length, 2, "страница не больше pageMax, даже если limit больше");
  assert.ok(r.j.paging && r.j.paging.next && r.j.paging.cursors.after);
  const all = [...r.j.data];
  const next = new URL(r.j.paging.next);
  assert.equal(next.host, "graph.facebook.com"); assert.equal(next.searchParams.get("after"), r.j.paging.cursors.after);
  const r2 = await fetch(r.j.paging.next, { headers: AUTH }); const j2 = await r2.json();
  all.push(...j2.data);
  assert.equal(j2.paging.next, undefined, "последняя страница — без next");
  assert.deepEqual(all.map(t => t.name), st.templates.map(t => t.name));
  const s01 = all[0];
  assert.equal(s01.language, "ru"); assert.equal(s01.status, "APPROVED"); assert.equal(s01.category, "UTILITY"); assert.equal(s01.parameter_format, "NAMED");
  const body = s01.components.find(c => c.type === "BODY");
  assert.match(body.text, /\{\{date\}\}/);
  assert.deepEqual(body.example.body_text_named_params.map(p => p.param_name), ["date", "time", "staff"]);
  const w01 = all[1];
  assert.equal(w01.components.find(c => c.type === "BUTTONS").buttons[0].type, "QUICK_REPLY");
  const old = all[2]; // позиционные параметры
  assert.equal(old.parameter_format, "POSITIONAL");
  assert.equal(old.rejected_reason, undefined, "без fields — поля по умолчанию, как у Graph (причины отказа среди них нет)");
  r = await g(`/${META.waba}/message_templates?fields=name,status`);
  assert.deepEqual(Object.keys(r.j.data[0]).sort(), ["id", "name", "status"]);
  r = await fetch(new URL(`/v23.0/${META.waba}/message_templates?fields=name,status,rejected_reason,quality_score{score}&limit=1&after=${encodeURIComponent(Buffer.from("tpl:2").toString("base64"))}`, "https://graph.facebook.com"), { headers: AUTH }).then(x => x.json());
  assert.deepEqual(r.data.map(t => [t.name, t.rejected_reason]), [["winchester_old", "INVALID_FORMAT"]]);
  assert.equal(r.data[0].quality_score.score, "UNKNOWN");
  assert.equal((await g(`/${META.waba}/message_templates?fields=name,nope`)).j.error.code, 100);
});

test("шаблоны: подача — { id, status: PENDING, category }, повтор имени и языка — отказ, переменная в начале или конце — отказ; решение Meta — st.review", async () => {
  net.reset();
  const st = metaStub(net);
  const tpl = { name: "winchester_s03_v2", language: "ru", category: "UTILITY", parameter_format: "named",
    components: [{ type: "BODY", text: "Напоминаем: {{day}} в {{time}} вас ждёт мастер {{staff}}.", example: { body_text_named_params: [{ param_name: "day", example: "завтра" }, { param_name: "time", example: "15:00" }, { param_name: "staff", example: "Тони" }] } }] };
  let r = await g(`/${META.waba}/message_templates`, { method: "POST", body: tpl });
  assert.equal(r.status, 200);
  assert.ok(r.j.id); assert.equal(r.j.status, "PENDING"); assert.equal(r.j.category, "UTILITY");
  assert.equal(st.created.length, 1); assert.equal(st.created[0].name, "winchester_s03_v2");
  const listed = (await g(`/${META.waba}/message_templates`)).j.data.find(t => t.name === "winchester_s03_v2");
  assert.equal(listed.status, "PENDING"); assert.equal(listed.id, r.j.id);
  r = await g(`/${META.waba}/message_templates`, { method: "POST", body: tpl });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 100); assert.equal(r.j.error.error_subcode, 2388024);
  r = await g(`/${META.waba}/message_templates`, { method: "POST", body: { ...tpl, name: "winchester_s01_v2", components: [{ type: "BODY", text: "Детали записи: {{link}}", example: { body_text_named_params: [{ param_name: "link", example: "https://example.test/x" }] } }] } });
  assert.equal(r.status, 400, "переменная в конце текста — Meta не принимает"); assert.equal(r.j.error.error_subcode, 2388299);
  r = await g(`/${META.waba}/message_templates`, { method: "POST", body: { ...tpl, name: "Плохое имя" } });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 100);
  st.review("winchester_s03_v2", "APPROVED");
  assert.equal((await g(`/${META.waba}/message_templates`)).j.data.find(t => t.name === "winchester_s03_v2").status, "APPROVED");
  r = await g(`/${META.waba}/message_templates?name=winchester_s03_v2`, { method: "DELETE" });
  assert.deepEqual(r.j, { success: true });
  assert.equal((await g(`/${META.waba}/message_templates`)).j.data.length, 0);
  assert.deepEqual(st.deleted, ["winchester_s03_v2"]);
});

test("отправка: текст и шаблон — messages[0].id и message_status; шаблон сверяется с одобренным (имя, язык, параметры)", async () => {
  net.reset();
  const st = metaStub(net, { templates: [{ name: "winchester_s01_v1", body: "Вы записаны {{date}} в {{time}}. Ждём вас." }, { name: "winchester_pos", body: "Вы записаны {{1}}. Ждём вас." }, { name: "winchester_wait", status: "PENDING", body: "Ждём вас." }, { name: "winchester_paused", status: "PAUSED", body: "Ждём вас." }] });
  const to = "77000000901";
  let r = await g(`/${META.pnid}/messages`, { method: "POST", body: { messaging_product: "whatsapp", to, type: "text", text: { body: "Здравствуйте!" } } });
  assert.equal(r.status, 200);
  assert.match(r.j.messages[0].id, /^wamid\./); assert.equal(r.j.messages[0].message_status, "accepted"); assert.equal(r.j.contacts[0].wa_id, to);
  const tplMsg = (name, params, lang = "ru") => ({ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: lang }, components: params ? [{ type: "body", parameters: params }] : [] } });
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_s01_v1", [{ type: "text", parameter_name: "date", text: "10 ноября" }, { type: "text", parameter_name: "time", text: "15:00" }]) });
  assert.equal(r.status, 200); assert.equal(r.j.messages[0].message_status, "accepted");
  assert.deepEqual(st.sent.map(x => [x.type, x.to, x.name || ""]), [["text", to, ""], ["template", to, "winchester_s01_v1"]]);
  assert.equal(st.sent[1].text, "Вы записаны 10 ноября в 15:00. Ждём вас.", "заглушка собирает текст, который увидел бы клиент");
  assert.equal(st.sent[1].id, r.j.messages[0].id);
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_pos", [{ type: "text", text: "завтра" }]) });
  assert.equal(r.status, 200, "позиционные параметры");
  // как Meta: неверное число или имена параметров — 132000, нет шаблона на этом языке или не одобрен — 132001, приостановлен — 132015
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_s01_v1", [{ type: "text", parameter_name: "date", text: "10 ноября" }]) });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132000);
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_s01_v1", [{ type: "text", parameter_name: "date", text: "10 ноября" }, { type: "text", parameter_name: "staff", text: "Тони" }]) });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132000);
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_s01_v1", [{ type: "text", parameter_name: "date", text: "" }, { type: "text", parameter_name: "time", text: "15:00" }]) });
  assert.equal(r.status, 400, "пустой параметр Meta не принимает");
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_s01_v1", [{ type: "text", parameter_name: "date", text: "1" }, { type: "text", parameter_name: "time", text: "2" }], "kk") });
  assert.equal(r.status, 404); assert.equal(r.j.error.code, 132001);
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_wait") });
  assert.equal(r.j.error.code, 132001);
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("winchester_paused") });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132015);
  assert.equal(st.sent.length, 3, "отказы в отправленные не попадают");
  // без сверки шаблонов (checkTemplates: false) — любой шаблон «уходит»
  net.reset(); const st2 = metaStub(net, { checkTemplates: false });
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: tplMsg("any_name", [{ type: "text", text: "x" }]) });
  assert.equal(r.status, 200); assert.equal(st2.sent.length, 1);
});

test("отказы: { status, code } по методу и пути, times; «висит» до AbortSignal; обрыв — TypeError; ответ потерян после отправки", async () => {
  net.reset();
  const st = metaStub(net, { fail: { on: "POST /messages", code: 131047, times: 1 }, hangMs: 200 });
  const send = () => g(`/${META.pnid}/messages`, { method: "POST", body: { messaging_product: "whatsapp", to: "77000000902", type: "text", text: { body: "Ответ" } } });
  let r = await send();
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 131047); assert.ok(r.j.error.message);
  r = await send();
  assert.equal(r.status, 200, "times: 1 — второй раз отправка проходит");
  assert.equal((await g(`/${META.pnid}?fields=quality_rating`)).status, 200, "отказ касается только своего пути");
  st.fail({ on: /^POST /, status: 500 }); // только код ответа — тело как у Graph при сбое
  r = await send();
  assert.equal(r.status, 500); assert.equal(typeof r.j.error.code, "number");
  st.fails.length = 0;
  st.fail({ code: 190 }); // без on — все запросы; код ответа — как у Graph для этого кода
  r = await g(`/${META.pnid}?fields=quality_rating`);
  assert.equal(r.status, 401); assert.equal(r.j.error.code, 190);
  st.fails.length = 0;
  st.fail({ on: rec => rec.body && rec.body.to === "77000000903", code: 131026, details: "Message undeliverable" });
  r = await g(`/${META.pnid}/messages`, { method: "POST", body: { messaging_product: "whatsapp", to: "77000000903", type: "text", text: { body: "x" } } });
  assert.equal(r.j.error.code, 131026); assert.equal(r.j.error.error_data.details, "Message undeliverable");
  st.fails.length = 0;
  // «висит»: ответ не приходит, пока запрос не оборвут по сроку
  st.fail({ on: "POST /messages", hang: true });
  const t0 = Date.now();
  await assert.rejects(fetch(GRAPH + `/${META.pnid}/messages`, { method: "POST", headers: AUTH, body: "{}", signal: AbortSignal.timeout(30) }), e => e.name === "TimeoutError", "как настоящий fetch: ошибка — причина отмены");
  assert.ok(Date.now() - t0 < 2000);
  const ac = new AbortController(); setTimeout(() => ac.abort(), 10);
  await assert.rejects(fetch(GRAPH + `/${META.pnid}/messages`, { method: "POST", headers: AUTH, body: "{}", signal: ac.signal }), e => e.name === "AbortError");
  const hung = net.graph.filter(x => x.aborted);
  assert.ok(hung.length >= 1, "заглушка отмечает оборванный запрос — так проверки видят, что код ставит срок");
  // без срока (AbortSignal) — через hangMs ошибка и пометка noSignal: проверка не зависает навсегда
  await assert.rejects(() => fetch(GRAPH + `/${META.pnid}/messages`, { method: "POST", headers: AUTH, body: "{}" }), /без срока/);
  assert.ok(net.graph.some(x => x.noSignal));
  st.fails.length = 0;
  st.fail({ on: "POST /messages", drop: true });
  await assert.rejects(() => send(), TypeError);
  const before = st.sent.length;
  st.fails.length = 0;
  st.fail({ on: "POST /messages", lost: true }); // Meta отправила, а ответ не дошёл
  await assert.rejects(() => send(), TypeError);
  assert.equal(st.sent.length, before + 1, "при потерянном ответе сообщение у Meta всё равно есть");
});

test("ключ: чужой ключ к номеру — 100 (нет доступа), неверный — 190; две компании со своими ключами", async () => {
  net.reset();
  const st = metaStub(net, { token: META.token });
  const B = st.add({ pnid: "900444", wabaId: "800444", token: "test-meta-token-b", display: "+7 700 000 04 44" });
  assert.equal(B.pnid, "900444");
  assert.equal((await g(`/${META.pnid}?fields=quality_rating`)).status, 200);
  assert.equal((await g(`/900444?fields=display_phone_number`, { token: "test-meta-token-b" })).j.display_phone_number, "+7 700 000 04 44");
  let r = await g(`/900444?fields=display_phone_number`);
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 100); assert.equal(r.j.error.error_subcode, 33);
  r = await g(`/${META.pnid}?fields=display_phone_number`, { token: "wrong" });
  assert.equal(r.status, 401); assert.equal(r.j.error.code, 190);
  r = await g(`/123456789?fields=id`);
  assert.equal(r.status, 400); assert.equal(r.j.error.error_subcode, 33, "неизвестный объект — как Graph");
  assert.ok(!JSON.stringify(r.j).includes(META.token), "ключа в ответе нет");
});

test("net.reset() очищает заглушку: прежний ответ «как на отправку» на любой адрес Graph", async () => {
  net.reset(); metaStub(net, { phone: { quality_rating: "RED" } });
  assert.ok(net.graphReply); assert.ok(net.meta);
  net.reset();
  assert.equal(net.graphReply, null); assert.equal(net.meta, null); assert.equal(net.graph.length, 0);
  const { status, j } = await g(`/${META.pnid}?fields=quality_rating`);
  assert.equal(status, 200); assert.ok(j.messages && j.messages[0].id, "без заглушки — как раньше");
  assert.equal(net.graph[0].method, "GET");
});

test("metaEnv: переменные номера Meta компании — ключ, секрет, номер, WABA (вымышленные)", () => {
  const e = metaEnv("winchester");
  assert.deepEqual(Object.keys(e).sort(), ["APP_SECRET_WINCHESTER", "PHONE_NUMBER_ID_WINCHESTER", "WABA_ID_WINCHESTER", "WA_TOKEN_WINCHESTER"]);
  assert.equal(e.PHONE_NUMBER_ID_WINCHESTER, META.pnid); assert.equal(e.WABA_ID_WINCHESTER, META.waba);
  assert.deepEqual(Object.keys(metaEnv("acme", { pnid: "1", waba: "2" })).sort(), ["APP_SECRET_ACME", "PHONE_NUMBER_ID_ACME", "WABA_ID_ACME", "WA_TOKEN_ACME"]);
});

test("metaSignal: подписанный сигнал WABA доходит до сервера (шаблон приостановлен), без подписи и с чужим секретом — 403", async () => {
  net.reset(); metaStub(net);
  const S = mk({ ...metaEnv("winchester"), TG_CHAT_WINCHESTER: "-1001" });
  const ev = { event: "PAUSED", message_template_id: 1, message_template_name: "winchester_s01_v1", message_template_language: "ru", reason: "NONE" };
  let r = await metaSignal(S, "/wa/winchester", "message_template_status_update", ev, { secret: null });
  assert.equal(r.status, 403, "без подписи");
  r = await metaSignal(S, "/wa/winchester", "message_template_status_update", ev, { secret: "other-secret" });
  assert.equal(r.status, 403, "чужой секрет");
  assert.equal(S.kv.mem.get("bchold:winchester"), undefined);
  r = await metaSignal(S, "/wa/winchester", "message_template_status_update", ev);
  assert.equal(r.status, 200);
  const h = S.kv.json("bchold:winchester");
  assert.ok(h && h.tpl && h.tpl.winchester_s01_v1, JSON.stringify(h));
  assert.ok(net.tg.some(x => /winchester_s01_v1/.test(x.text)));
  // тело события — как у Meta: entry.id — WABA, changes[0] — field и value
  const body = metaEvent.body([{ field: "account_update", value: { event: "X" } }], { entryId: "800999" });
  assert.equal(body.object, "whatsapp_business_account"); assert.equal(body.entry[0].id, "800999"); assert.equal(body.entry[0].changes[0].field, "account_update");
});

test("metaStatuses: подписанные отчёты о доставке с номером компании; отказ 131050 — «стоп» клиента", async () => {
  net.reset(); metaStub(net);
  const S = mk(metaEnv("winchester"));
  const to = "77000000904";
  const body = metaStatuses.body([{ id: "wamid.out.1", status: "failed", to, code: 131050 }], { pnid: META.pnid });
  const v = body.entry[0].changes[0].value;
  assert.equal(body.entry[0].id, META.waba); assert.equal(v.metadata.phone_number_id, META.pnid); assert.equal(v.metadata.display_phone_number, META.display.replace(/\D/g, ""));
  const st = v.statuses[0];
  assert.equal(st.recipient_id, to); assert.equal(st.errors[0].code, 131050); assert.ok(/^\d+$/.test(st.timestamp));
  let r = await metaStatuses(S, "/wa/winchester", [{ id: "wamid.out.1", status: "failed", to, code: 131050 }], { secret: null });
  assert.equal(r.status, 403);
  assert.equal(S.kv.mem.get(`optout:winchester:${to}`), undefined);
  r = await metaStatuses(S, "/wa/winchester", [{ id: "wamid.out.1", status: "failed", to, code: 131050 }]);
  assert.equal(r.status, 200);
  assert.match(String(S.kv.mem.get(`optout:winchester:${to}`)), /^meta:/);
  r = await metaStatuses(S, "/wa/winchester", [{ id: "wamid.out.2", status: "delivered", to }, { id: "wamid.out.2", status: "read", to }]);
  assert.equal(r.status, 200);
});

test("metaMessages: подписанное входящее на номер компании (entry.id — WABA, metadata — номер) ложится в чат; без подписи — 403", async () => {
  net.reset(); metaStub(net);
  const S = mk(metaEnv("winchester"));
  const from = "77000000905";
  const body = metaEvent.body([{ field: "messages", value: {} }]);
  assert.equal(body.entry[0].time, undefined, "у событий «messages» времени в записи нет, как у Meta");
  let r = await metaMessages(S, "/wa/winchester", { from, type: "text", text: { body: "Здравствуйте" } }, { secret: null });
  assert.equal(r.status, 403);
  assert.equal(S.hist("wa", "winchester", from), null);
  r = await metaMessages(S, "/wa/winchester", { from, type: "text", text: { body: "Здравствуйте" } }, { names: { [from]: "Айдар" } });
  assert.equal(r.status, 200);
  const h = S.hist("wa", "winchester", from);
  assert.ok(h && h.turns.some(t => t.role === "user" && t.text === "Здравствуйте"), JSON.stringify(h));
});
