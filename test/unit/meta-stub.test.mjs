// Заглушка Meta Graph (test/meta.mjs) и помощники подписанных вебхуков Meta: основа для проверок номера Meta у Winchester
// (ТЗ v4 §5, план шаг 1, 09.11.2026). До неё заглушка на любой адрес Graph отвечала как на отправку сообщения — и на чтение
// сведений о номере, и на список шаблонов: проверить чтение номера, WABA и шаблонов было нечем. Код сервера здесь не меняется:
// проверяется сама заглушка — что она отвечает как Graph (поля, страницы, коды ошибок) и что отказы вставляются предсказуемо.
// Номера и ключи вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { metaStub, metaEnv, metaIds, metaSignal, metaStatuses, metaEvent, metaMessages, META } from "../meta.mjs";
import { sendTemplate } from "../../src/services/integrations/meta/templates.js";
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

// ---- находки проверки шага 1 (09.11.2026): заглушка не должна пропускать то, на чём споткнётся настоящая Meta, и путать компании

test("отправка: одновременные запросы с задержкой (delay) получают разные wamid — номер выдаётся при записи запроса, а не после задержки", async () => {
  net.reset();
  const st = metaStub(net, { fail: { on: "POST /messages", delay: 30, times: 2 } });
  const send = to => g(`/${META.pnid}/messages`, { method: "POST", body: { messaging_product: "whatsapp", to, type: "text", text: { body: "Ответ" } } });
  const [a, b] = await Promise.all([send("77000000911"), send("77000000912")]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const ids = [a.j.messages[0].id, b.j.messages[0].id];
  assert.notEqual(ids[0], ids[1], "два клиента — два разных wamid: отчёты о доставке и отметки не сливаются");
  assert.deepEqual(ids, ["wamid.out.1", "wamid.out.2"], "номер — по порядку записи, как у прежней заглушки");
  assert.equal(st.sent.find(x => x.to === "77000000911").id, ids[0]);
  assert.equal(st.sent.find(x => x.to === "77000000912").id, ids[1]);
  // проверка обрезала net.graph посреди работы (так делают audit-p0 и crm-broadcast) — номера не повторяются
  net.graph.length = 0;
  const c = await send("77000000913");
  assert.ok(!ids.includes(c.j.messages[0].id), c.j.messages[0].id);
  assert.equal(new Set(st.sent.map(x => x.id)).size, st.sent.length);
});

test("отправка: именованный параметр дважды — отказ 132000, переменная без значения не уходит пустой", async () => {
  net.reset();
  const st = metaStub(net, { templates: [{ name: "winchester_s01_v1", body: "Вы записаны {{date}} в {{time}}. Ждём вас." }] });
  const r = await g(`/${META.pnid}/messages`, { method: "POST", body: { messaging_product: "whatsapp", to: "77000000914", type: "template",
    template: { name: "winchester_s01_v1", language: { code: "ru" }, components: [{ type: "body", parameters: [{ type: "text", parameter_name: "date", text: "10 ноября" }, { type: "text", parameter_name: "date", text: "11 ноября" }] }] } } });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132000);
  assert.match(r.j.error.error_data.details, /date/);
  assert.equal(st.sent.length, 0, "«Вы записаны 11 ноября в . Ждём вас.» не уходит");
});

test("отправка: шаблон с картинкой в шапке и кнопкой-ссылкой с переменной — нужны параметры шапки и кнопки, как у Meta", async () => {
  net.reset();
  const st = metaStub(net, { templates: [
    { name: "winchester_promo_img", category: "MARKETING", header: { format: "IMAGE" }, body: "Добрый день! Ждём вас в Winchester." },
    { name: "winchester_book_url", body: "Запишитесь онлайн по кнопке ниже.", buttons: [{ type: "URL", text: "Записаться", url: "https://winchester.kz/b/{{1}}" }, "Стоп"] },
    { name: "winchester_site", body: "Наш сайт — по кнопке ниже.", buttons: [{ type: "URL", text: "Сайт", url: "https://winchester.kz" }] },
    { name: "winchester_hdr", header: "Запись {{day}}", body: "Ждём вас {{time}}, мастер рядом." }] });
  const img = st.template("winchester_promo_img").components.find(c => c.type === "HEADER");
  assert.equal(img.format, "IMAGE"); assert.ok(img.example && img.example.header_handle, "у шапки-картинки есть пример, как у поданного шаблона");
  const to = "77000000915";
  // прежний код рассылок (sendTemplate, b.img) отправляет картинку в шапке — заглушка должна это принять
  const env = { WA_TOKEN_WINCHESTER: META.token, PHONE_NUMBER_ID_WINCHESTER: META.pnid };
  const ok = await sendTemplate(env, to, { tpl: "winchester_promo_img", lang: "ru", img: "https://winchester.kz/promo.jpg", params: [] }, "", { client: "winchester" });
  assert.deepEqual(ok, { ok: true });
  assert.equal(st.sent.at(-1).header, "https://winchester.kz/promo.jpg");
  const tplMsg = (name, components) => ({ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: "ru" }, components } });
  const send = body => g(`/${META.pnid}/messages`, { method: "POST", body });
  // без картинки — Meta отказывает (параметр шапки обязателен)
  let r = await send(tplMsg("winchester_promo_img", []));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 131008);
  r = await send(tplMsg("winchester_promo_img", [{ type: "header", parameters: [{ type: "document", document: { link: "https://winchester.kz/a.pdf" } }] }]));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132012, "картинка вместо файла — не тот вид параметра");
  r = await send(tplMsg("winchester_promo_img", [{ type: "header", parameters: [{ type: "image", image: {} }] }]));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 131008, "картинка без ссылки и без id");
  // текстовая шапка: картинка вместо текста — не тот вид параметра
  r = await send(tplMsg("winchester_hdr", [{ type: "header", parameters: [{ type: "image", image: { link: "https://winchester.kz/x.jpg" } }] }, { type: "body", parameters: [{ type: "text", parameter_name: "time", text: "15:00" }] }]));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132012);
  r = await send(tplMsg("winchester_hdr", [{ type: "header", parameters: [{ type: "text", parameter_name: "day", text: "завтра" }] }, { type: "body", parameters: [{ type: "text", parameter_name: "time", text: "15:00" }] }]));
  assert.equal(r.status, 200, "текстовая шапка с текстом — как раньше");
  // кнопка-ссылка с переменной — без параметра кнопки Meta отказывает
  r = await send(tplMsg("winchester_book_url", []));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 131008);
  r = await send(tplMsg("winchester_book_url", [{ type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "abc" }] }]));
  assert.equal(r.status, 400, "кнопка 1 — быстрый ответ, у неё нет ссылки");
  r = await send(tplMsg("winchester_book_url", [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "" }] }]));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 131008, "пустая переменная ссылки");
  r = await send(tplMsg("winchester_book_url", [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc" }] }, { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "STOP" }] }]));
  assert.equal(r.status, 200, "ссылка с переменной и полезная нагрузка быстрого ответа");
  assert.deepEqual(st.sent.at(-1).buttons, ["https://winchester.kz/b/abc"], "заглушка собирает ссылку, которую увидит клиент");
  // ссылка без переменной — параметр кнопки лишний
  r = await send(tplMsg("winchester_site", [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc" }] }]));
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 132000);
  r = await send(tplMsg("winchester_site", []));
  assert.equal(r.status, 200);
  assert.equal(st.sent.length, 4, "отказы в отправленные не попадают");
});

test("ключ по умолчанию: заглушка принимает только ключ компании — неверный 190, ключ другой компании 100/33; без проверки — только явно (token: null)", async () => {
  net.reset();
  const st = metaStub(net);
  assert.equal(st.token, META.token, "первая компания — с тем же ключом, что пишет metaEnv");
  let r = await g(`/${META.pnid}?fields=quality_rating`, { token: "garbage" });
  assert.equal(r.status, 401); assert.equal(r.j.error.code, 190);
  assert.equal((await g(`/${META.pnid}?fields=quality_rating`)).status, 200);
  const B = st.add({});
  assert.ok(B.token && B.token !== META.token, "у второй компании свой вымышленный ключ");
  r = await g(`/${B.pnid}?fields=display_phone_number`);
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 100); assert.equal(r.j.error.error_subcode, 33, "ключ Winchester к номеру другой компании");
  r = await g(`/${META.waba}?fields=account_review_status`, { token: B.token });
  assert.equal(r.status, 400); assert.equal(r.j.error.code, 100); assert.equal(r.j.error.error_subcode, 33, "ключ другой компании к WABA Winchester");
  r = await g(`/${META.pnid}/messages`, { method: "POST", token: B.token, body: { messaging_product: "whatsapp", to: "77000000916", type: "text", text: { body: "x" } } });
  assert.equal(r.j.error.code, 100); assert.equal(st.sent.length, 0, "с чужим ключом с номера Winchester ничего не уходит");
  assert.equal((await g(`/${B.pnid}?fields=display_phone_number`, { token: B.token })).status, 200);
  const C = st.add({ token: null });
  assert.equal((await g(`/${C.pnid}?fields=id`, { token: "garbage" })).status, 200, "token: null — проверка ключа выключена явно");
  net.reset(); metaStub(net, { token: null });
  assert.equal((await g(`/${META.pnid}?fields=id`, { token: "garbage" })).status, 200);
});

test("metaEnv: у разных компаний разные номер, WABA, ключ и секрет; st.add({ cid }) — те же значения, что metaEnv", async () => {
  const w = metaEnv("winchester"), b = metaEnv("barber");
  for (const [k, v] of [["PHONE_NUMBER_ID", META.pnid], ["WABA_ID", META.waba], ["WA_TOKEN", META.token], ["APP_SECRET", META.secret]]) {
    assert.equal(w[k + "_WINCHESTER"], v);
    assert.ok(b[k + "_BARBER"], k); assert.notEqual(b[k + "_BARBER"], v, k + ": у другой компании — своё");
  }
  assert.deepEqual(metaEnv("barber"), b, "значения постоянные: тот же cid — те же значения");
  const ids = metaIds("barber");
  assert.equal(ids.pnid, b.PHONE_NUMBER_ID_BARBER); assert.equal(ids.waba, b.WABA_ID_BARBER); assert.equal(ids.token, b.WA_TOKEN_BARBER); assert.equal(ids.secret, b.APP_SECRET_BARBER);
  assert.match(ids.display, /^\+7 700 000 \d\d \d\d$/); assert.notEqual(ids.display, META.display);
  assert.equal(metaEnv("acme", { pnid: "1", waba: "2" }).PHONE_NUMBER_ID_ACME, "1", "явные значения важнее");
  // заглушка: компания по cid — тот же номер и ключ; ключ Winchester к её номеру — 100/33
  net.reset();
  const st = metaStub(net), B = st.add({ cid: "barber" });
  assert.equal(B.pnid, ids.pnid); assert.equal(B.wabaId, ids.waba); assert.equal(B.token, ids.token); assert.equal(B.display, ids.display);
  assert.equal((await g(`/${ids.pnid}?fields=display_phone_number`, { token: ids.token })).j.display_phone_number, ids.display);
  assert.equal((await g(`/${ids.pnid}?fields=id`)).j.error.error_subcode, 33);
  // вебхук: подпись секретом Winchester на адресе другой компании не проходит, своим секретом — проходит
  const S = mk({ ...w, ...b });
  const ev = { event: "PAUSED", message_template_id: 1, message_template_name: "barber_x", message_template_language: "ru", reason: "NONE" };
  let r = await metaSignal(S, "/wa/barber", "message_template_status_update", ev, { entryId: ids.waba });
  assert.equal(r.status, 403, "секрет Winchester — не секрет другой компании");
  r = await metaSignal(S, "/wa/barber", "message_template_status_update", ev, { entryId: ids.waba, secret: ids.secret });
  assert.equal(r.status, 200);
});
