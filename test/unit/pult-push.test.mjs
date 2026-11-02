// Пульт /app/ ставится на экран «Домой» и получает push (ТЗ v2.0 §3, 31.10.2026): манифест и значки — в сборке, sw.js — без кэша;
// логика Service Worker (apps/pult/public/sw.js) — в песочнице node:vm: тот же открытый чат не шумит (кроме Safari — там без
// уведомления push отключают), адрес из сообщения — только свой /app/, нажатие открывает чат в открытом пульте или новом окне.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { pultApp } from "../../src/controllers/pult.js";

const pub = f => new URL("../../apps/pult/public/" + f, import.meta.url);
const SW = readFileSync(pub("sw.js"), "utf8");
const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const plain = o => JSON.parse(JSON.stringify(o));
function sw(ua, wins = []) {
  const on = {}, shown = [], opened = [], self = {
    navigator: { userAgent: ua, setAppBadge: async n => { self.badge = n; }, clearAppBadge: async () => { self.badge = 0; } },
    location: { origin: "https://bot.test" }, addEventListener: (t, f) => { on[t] = f; }, skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => wins, openWindow: async u => { opened.push(u); } },
    registration: { showNotification: async (title, o) => { shown.push(plain({ title, ...o })); } }, // объекты песочницы — в обычные (другой realm)
  };
  vm.runInNewContext(SW, { self, URL, console });
  const fire = async (type, ev) => { let p; on[type]({ ...ev, waitUntil: x => { p = x; } }); await p; };
  return { self, shown, opened, fire };
}
const win = (url, focused = true) => { const w = { url, focused, visibilityState: focused ? "visible" : "hidden", posted: [], focus: async () => { w.didFocus = true; }, postMessage: m => w.posted.push(plain(m)) }; return w; };
const CHAT = "/app/?c=winchester#/inbox/ga%3A77001112001";
const msg = o => ({ data: { json: () => o } });

test("манифест для экрана «Домой»: своя область /app/, отдельное окно, значки лежат в сборке; страница на него ссылается", () => {
  const m = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8"));
  assert.equal(m.id, "/app/"); assert.equal(m.scope, "./"); assert.equal(m.start_url, "./"); assert.equal(m.display, "standalone");
  for (const i of m.icons) assert.ok(existsSync(pub(i.src.slice(2))), i.src);
  assert.ok(m.icons.some(i => i.purpose === "maskable"));
  const html = readFileSync(new URL("../../apps/pult/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icon-180\.png"/);
  assert.ok(existsSync(pub("icon-180.png")));
});

test("sw.js отдаётся без кэша (иначе браузер сутки держит старую версию), манифест — как остальные файлы", () => {
  const files = { "sw.js": { type: "text/javascript; charset=utf-8", body: SW }, "manifest.webmanifest": { type: "application/manifest+json; charset=utf-8", body: "{}" } };
  const r = pultApp("/app/sw.js", "", files);
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-cache"); assert.match(r.headers.get("content-type"), /^text\/javascript/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const m = pultApp("/app/manifest.webmanifest", "", files);
  assert.equal(m.headers.get("cache-control"), "public, max-age=3600"); assert.match(m.headers.get("content-type"), /^application\/manifest\+json/);
});

test("push: тот же чат открыт перед глазами — без уведомления (Chrome); на iPhone — всё равно показываем; значок — число ждущих", async () => {
  const a = sw(CHROME, [win("https://bot.test" + CHAT)]);
  await a.fire("push", msg({ t: "Winchester", b: "Новое сообщение · второй номер", u: CHAT, g: "c1", c: "ga:77001112001", n: 2 }));
  assert.equal(a.shown.length, 0); assert.equal(a.self.badge, 2);
  const b = sw(CHROME, [win("https://bot.test/app/?c=winchester#/inbox/ga%3A77009999999")]);
  await b.fire("push", msg({ t: "Winchester", b: "Новое сообщение · второй номер", u: CHAT, g: "c1", c: "ga:77001112001" }));
  assert.deepEqual(b.shown, [{ title: "Winchester", body: "Новое сообщение · второй номер", tag: "c1", renotify: true, icon: "/app/icon-192.png", badge: "/app/icon-192.png", data: { url: "https://bot.test" + CHAT } }]);
  const c = sw(CHROME, [win("https://bot.test" + CHAT, false)]); // пульт открыт, но свёрнут
  await c.fire("push", msg({ t: "W", b: "x", u: CHAT, c: "ga:1" }));
  assert.equal(c.shown.length, 1);
  const i = sw(IPHONE, [win("https://bot.test" + CHAT)]);
  await i.fire("push", msg({ t: "Winchester", b: "Новое сообщение", u: CHAT, c: "ga:77001112001", n: 0 }));
  assert.equal(i.shown.length, 1, "Safari: без уведомления push отключают"); assert.equal(i.self.badge, 0);
});

test("push: адрес только свой /app/; сломанное сообщение — всё равно уведомление «Пульт»", async () => {
  const a = sw(CHROME);
  await a.fire("push", msg({ t: "W", b: "x", u: "https://evil.example/app/phish" }));
  await a.fire("push", msg({ t: "W", b: "x", u: "/inbox?c=winchester" }));
  assert.deepEqual(a.shown.map(s => s.data.url), ["https://bot.test/app/", "https://bot.test/app/"]);
  await a.fire("push", { data: { json: () => { throw new Error("not json"); } } });
  await a.fire("push", { data: null });
  assert.deepEqual(a.shown.slice(2).map(s => [s.title, s.body]), [["Пульт", ""], ["Пульт", ""]]);
});

test("нажатие на уведомление: открытый пульт переходит к чату сам, иначе — новое окно с этим чатом", async () => {
  const w = win("https://bot.test/app/?c=winchester#/inbox", false), a = sw(CHROME, [win("https://bot.test/inbox"), w]);
  const n = { close() { n.closed = true; }, data: { url: "https://bot.test" + CHAT } };
  await a.fire("notificationclick", { notification: n });
  assert.ok(n.closed && w.didFocus); assert.deepEqual(w.posted, [{ type: "pult-open", url: "https://bot.test" + CHAT }]); assert.deepEqual(a.opened, []);
  const b = sw(CHROME, [win("https://bot.test/inbox")]);
  await b.fire("notificationclick", { notification: { close() {}, data: { url: "https://evil.example/" } } });
  assert.deepEqual(b.opened, ["https://bot.test/app/"]);
});
