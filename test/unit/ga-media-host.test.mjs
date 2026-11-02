// Файлы из пульта со второго номера (Green-API sendFileByUpload) — на адрес для файлов (mediaUrl). Живая проверка владельца 02.11.2026:
// голосовые с iPhone не уходили — обе попытки «Не знаем, ушло ли» за 0,2 с, и на стенде из пульта не ушёл ни один файл (тексты — уходят).
// Код вычислял адрес для файлов из обычного (api → media), а у группы инстансов 7107 обычный адрес 7107.api.greenapi.com есть, а
// 7107.media.greenapi.com — нет: запрос до Green-API не доходил. По документации Green-API («Using GREEN-API Hosts») mediaUrl — свой
// параметр инстанса из кабинета, на время перехода годится общий https://media.greenapi.com. Теперь: mediaUrl из настроек
// (GA_MEDIA_URL_<ID>) → вычисленный адрес, если он отвечает → общий. Причина «не знаем, ушло ли» — в переписке (se) и в журнале Worker;
// ответ 200 без номера сообщения с текстом ошибки («failed to upload file» — по документации это ошибка с кодом 200) — отказ, а не
// «неизвестно»: файл не ушёл, «Повторить» можно.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { sendOnceReset } from "../../src/services/inbox/send.js";
import { gaMediaProbeReset } from "../../src/services/integrations/greenapi/client.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7107000077", token: "ga-tok-media" };
const A = "77000007711";
const env = (x = {}) => ({ GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, ...(sqliteOk ? { DB: d1With("production").db } : {}), ...x });
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
let n = 0;
const sendFile = (b, { name = "voice-20261102000000.ogg", type = "audio/ogg", rid = "file-media-" + ++n } = {}) => {
  const fd = new FormData();
  fd.set("file", new Blob([Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4])], { type }), name);
  fd.set("rid", rid); fd.set("voice", "1"); fd.set("dur", "2");
  return b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${A}`, { method: "POST", body: fd });
};
const uploads = () => net.ga.filter(x => x.op === "sendFileByUpload");
/** адреса, которых нет (как 7107.media.greenapi.com 02.11.2026): соединение не устанавливается */
const gone = hosts => (url) => (hosts.some(h => url.startsWith("https://" + h + "/")) ? Promise.reject(new TypeError("Network connection lost.")) : null);
const fresh = () => { net.reset(); sendOnceReset(); gaMediaProbeReset(); };

test("адреса для файлов нет (группа 7107) — файл уходит через общий media.greenapi.com", { skip }, async () => {
  fresh();
  net.mediaReply = gone(["7107.media.greenapi.com"]);
  const s = mk(env({ GA_URL_WINCHESTER: "https://7107.api.greenapi.com" })), b = await login(s);
  await s.gaText("winchester", INST, A, "Здравствуйте");
  const r = await sendFile(b);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.warn, undefined, "без «не знаем, ушло ли»");
  const up = uploads();
  assert.equal(up.length, 1);
  assert.equal(up[0].host, "media.greenapi.com", "общий адрес для файлов");
  assert.equal(s.hist("ga", "winchester", A).turns.at(-1).st, "sent");
  // второй файл: проверка адреса запомнена — сразу на общий
  const r2 = await sendFile(b);
  assert.equal(r2.status, 200);
  assert.equal(uploads()[1].host, "media.greenapi.com");
});

test("адрес для файлов из настроек (GA_MEDIA_URL_<ID>) — важнее вычисленного; вычисленный отвечает — он", { skip }, async () => {
  fresh();
  const s = mk(env({ GA_URL_WINCHESTER: "https://7107.api.greenapi.com", GA_MEDIA_URL_WINCHESTER: "https://7107.files.greenapi.com/" })), b = await login(s);
  await s.gaText("winchester", INST, A, "Здравствуйте");
  assert.equal((await sendFile(b)).status, 200);
  assert.equal(uploads()[0].host, "7107.files.greenapi.com");
  fresh();
  const s2 = mk(env({ GA_URL_WINCHESTER: "https://7105.api.greenapi.com" })), b2 = await login(s2);
  await s2.gaText("winchester", INST, A, "Здравствуйте");
  assert.equal((await sendFile(b2)).status, 200);
  assert.equal(uploads()[0].host, "7105.media.greenapi.com", "адрес группы 7105 есть — он и используется");
});

test("Green-API не ответил — «не знаем, ушло ли» с причиной в переписке; 200 без номера с ошибкой — отказ, «Повторить» можно", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s);
  await s.gaText("winchester", INST, A, "Здравствуйте");
  net.gaReply = rec => (rec.op === "sendFileByUpload" ? new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500, headers: { "content-type": "application/json" } }) : null);
  let r = await sendFile(b);
  assert.equal(r.status, 200);
  let t = s.hist("ga", "winchester", A).turns.at(-1);
  assert.equal(t.st, "unknown");
  assert.match(t.se || "", /500/, "причина записана: " + t.se);
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${A}`)).json();
  assert.match(c.turns.at(-1).se || "", /500/, "пульт видит причину");
  // 200 с текстом ошибки и без номера сообщения — файл не ушёл
  net.gaReply = rec => (rec.op === "sendFileByUpload" ? new Response(JSON.stringify({ message: "failed to upload file" }), { status: 200, headers: { "content-type": "application/json" } }) : null);
  r = await sendFile(b, { rid: "file-media-200" });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /failed to upload file/);
  net.gaReply = null;
  r = await sendFile(b, { rid: "file-media-200" });
  assert.equal(r.status, 200, "отказ — тот же номер отправки уходит снова");
  assert.equal(s.hist("ga", "winchester", A).turns.at(-1).st, "sent");
});
