// Панель владельца /admin (17.10.2026): все служебные страницы в одном месте; только владелец. /diag — в рамке панели, без начала ключей.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=" + encodeURIComponent(key) + "&next=%2Fadmin" }); return b; };

test("владелец видит панель со ссылками на все страницы; демо-боты в выборе скрыты", async () => {
  net.reset();
  const s = mk(), own = await login(s, "owner-key-123456");
  const r = await own.go("/admin");
  const html = await r.text();
  assert.equal(r.status, 200);
  for (const p of ["/inbox", "/leads", "/broadcast", "/studio", "/launch", "/altegio", "/diag", "/selftest", "/privacy"]) assert.ok(html.includes(`data-href="${p}"`), p);
  assert.ok(/value="winchester"/.test(html) && !/value="dent"/.test(html), "в выборе — Winchester, без демо");
});

test("без входа — на страницу входа; сотрудник — в свой пульт", async () => {
  net.reset();
  const s = mk(), anon = s.browser();
  const r = await anon.go("/admin");
  assert.ok(r.status === 303 && /\/login/.test(r.headers.get("location") || ""), String(r.status));
  const own = await login(s, "owner-key-123456");
  const key = (await (await own.post("/api/studio/key", { id: "winchester" })).json()).key;
  const st = await login(s, key);
  const r2 = await st.go("/admin");
  assert.equal(r2.status, 303); assert.equal(r2.headers.get("location"), "/inbox?c=winchester");
});

test("/diag — страница в рамке панели, начало ключа не показано", async () => {
  net.reset();
  const s = mk({ GEMINI_KEY: "AQ.Asecret-value" }), own = await login(s, "owner-key-123456");
  const html = await (await own.go("/diag")).text();
  assert.ok(/Панель/.test(html) && /GEMINI_KEY: есть/.test(html), html.slice(0, 300));
  assert.ok(!/AQ\.A/.test(html), "начало ключа не видно");
});
