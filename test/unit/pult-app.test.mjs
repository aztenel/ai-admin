// Новый пульт apps/pult по адресу /app/ (19.10.2026): Worker раздаёт файлы сборки из pult-app.gen.js (tools/build-pult-app.mjs).
// Страница — с теми же заголовками защиты, что остальные (без кэша, без встраивания, CSP; встроенный скрипт темы — по хэшу),
// файлы с хэшем в имени — кэш навсегда; без входа файлы отдаются (данных в них нет), данные — только через /api/* со входом;
// вход /login?next=/app/… возвращает обратно в пульт.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mk, net } from "../harness.mjs";
import { PULT_APP } from "../../pult-app.gen.js";
import { pultApp } from "../../src/controllers/pult.js";

const OWNER = "owner-key-123456";
const index = PULT_APP["index.html"].body;
const entry = (/<script type="module"[^>]*\bsrc="\.\/(assets\/[^"]+\.js)"/.exec(index) || [])[1];
const css = (/<link rel="stylesheet"[^>]*\bhref="\.\/(assets\/[^"]+\.css)"/.exec(index) || [])[1];

test("сборка: index.html ссылается на свои файлы относительными адресами, и все они есть", () => {
  assert.ok(entry && css, "в index.html есть главный скрипт и стили: " + index.slice(0, 300));
  const refs = [...index.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  for (const r of refs) {
    assert.ok(r.startsWith("./"), `адрес ${r} — относительный (base "./"), иначе под /app/ не найдётся`);
    assert.ok(Object.hasOwn(PULT_APP, r.slice(2)), `файл ${r} есть в сборке`);
  }
  // части, которые пульт подгружает позже (раздел «Рассылки», мастер, демо): каждая есть в сборке
  for (const [name, f] of Object.entries(PULT_APP)) {
    if (!name.endsWith(".js")) continue;
    for (const m of f.body.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)) assert.ok(Object.hasOwn(PULT_APP, "assets/" + m[1]), `${name} подгружает ${m[1]} — он есть в сборке`);
  }
});

test("/app/ — страница пульта с заголовками защиты; встроенный скрипт темы разрешён по хэшу, а не 'unsafe-inline'", async () => {
  net.reset();
  const s = mk(), anon = s.browser();
  for (const p of ["/app/", "/app/?c=winchester", "/app/index.html"]) {
    const r = await anon.go(p);
    const body = await r.text();
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type") || "", /^text\/html/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "same-origin");
    assert.equal(r.headers.get("set-cookie"), null, "файлы пульта не трогают вход");
    const policy = r.headers.get("content-security-policy") || "";
    for (const d of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(policy.includes(d), d + " в " + policy);
    const script = (/script-src ([^;]+)/.exec(policy) || [])[1] || "";
    assert.ok(!script.includes("unsafe-inline") && script.startsWith("'self'"), script);
    for (const m of body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const h = "'sha256-" + createHash("sha256").update(m[1], "utf8").digest("base64") + "'";
      assert.ok(script.includes(h), "хэш встроенного скрипта " + h + " есть в script-src");
    }
    assert.ok(body.includes('<div id="root">'), "это пульт");
  }
  const h = await s.call("/app/", { method: "HEAD" });
  assert.equal(h.status, 200, "HEAD — как GET");
});

test("файлы с хэшем в имени — свой вид и кэш навсегда; без входа и без чтения хранилища", async () => {
  net.reset();
  const s = mk(), anon = s.browser(), g0 = s.kv.ops.get;
  const js = await anon.go("/app/" + entry);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(js.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(js.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await js.text(), PULT_APP[entry].body);
  const st = await anon.go("/app/" + css);
  assert.equal(st.status, 200);
  assert.equal(st.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(st.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(s.kv.ops.get, g0, "раздача файлов пульта не читает хранилище");
  // данные — только со входом: без него API отвечает 401, и пульт ведёт на /login?next=/app/…
  assert.equal((await anon.go("/api/inbox/me")).status, 401);
});

test("/app без косой черты → /app/ (с параметрами); чужие и неизвестные пути — 404", async () => {
  net.reset();
  const s = mk(), anon = s.browser();
  const r = await anon.go("/app");
  assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/app/");
  const r2 = await anon.go("/app?c=winchester");
  assert.equal(r2.status, 301); assert.equal(r2.headers.get("location"), "/app/?c=winchester");
  for (const p of ["/app/nope", "/app/assets/nope.js", "/app/__proto__", "/app/assets/__proto__", "/app/constructor", "/app/toString", "/app//index.html", "/app/assets/", "/apps/", "/application"])
    assert.equal((await anon.go(p)).status, 404, p);
  assert.equal((await anon.go("/app/", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404, "POST — 404");
});

test("вход /login?next=/app/… возвращает в новый пульт; чужие адреса в next не принимаются", async () => {
  net.reset();
  const s = mk();
  const next = "/app/?c=winchester#/campaigns";
  const pg = await (await s.browser().go("/login?next=" + encodeURIComponent(next))).text();
  assert.ok(pg.includes('name="next" value="/app/?c=winchester#/campaigns"'), "страница входа помнит, куда вернуться");
  const login = async (n, key = OWNER) => s.browser().go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=${encodeURIComponent(n)}` });
  const r = await login(next);
  assert.equal(r.status, 303); assert.equal(r.headers.get("location"), next); assert.ok(r.headers.get("set-cookie"));
  for (const bad of ["//evil.example/app/", "https://evil.example/app/", "/\\evil.example", "/ app/"]) assert.equal((await login(bad)).headers.get("location"), "/studio", bad);
  // сотрудник тоже возвращается в новый пульт (его компанию и права проверяет сервер в /api/*)
  const own = s.browser(); await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${OWNER}&next=%2Fstudio` });
  const key = (await (await own.post("/api/studio/key", { id: "winchester" })).json()).key;
  const rs = await login("/app/?c=winchester", key);
  assert.equal(rs.status, 303); assert.equal(rs.headers.get("location"), "/app/?c=winchester");
});

test("картинки и шрифты (base64 в сборке) отдаются байтами; файлы не из assets/ — короткий кэш; без сборки — 404", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);
  const files = { "assets/logo-AbCd1234.png": { type: "image/png", body: png.toString("base64"), b64: true }, "icon.svg": { type: "image/svg+xml", body: "<svg/>" } };
  for (let i = 0; i < 2; i++) { // второй раз — из памяти
    const r = pultApp("/app/assets/logo-AbCd1234.png", "", files);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
  }
  const svg = pultApp("/app/icon.svg", "", files);
  assert.equal(svg.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(await svg.text(), "<svg/>");
  assert.equal(pultApp("/app/", "", undefined).status, 404, "worker.js без PULT_APP — 404, а не сбой");
});

// находки проверки 19.10.2026: ключ входа из адреса /app?key=… дальше не переносится (только выбор компании ?c=)
test("/app → /app/: переносится только ?c=, ключ из адреса — нет", () => {
  const r = pultApp("/app", "?c=winchester&key=owner-key-123456", PULT_APP);
  assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/app/?c=winchester");
  assert.equal(pultApp("/app", "?key=owner-key-123456", PULT_APP).headers.get("location"), "/app/");
});
