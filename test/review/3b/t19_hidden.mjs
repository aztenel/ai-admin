// Hidden test client «alt»: showcase, WhatsApp menu, self-test dropdown, direct link; secrets on pages a non-owner can open.
import { mk, show, D1, D2, J } from "./lib.mjs";
import { createHmac } from "node:crypto";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4190", WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", APP_SECRET: "sec", GA_ID: "1", GA_TOKEN: "gat", GA_HOOK: "hook", GA_URL: "https://x.green-api.com", KEY_ALT: "ownerkey", ALTEGIO_PARTNER: "partner-key" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini|WA|GA)/.test(String(a[0]))) _log(...a); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => String(u).includes("green-api") ? (h.calls.ga = h.calls.ga || [], h.calls.ga.push(JSON.parse(init.body)), new Response("{}")) : realFetch(u, init);
const txt = async (p, init) => (await h.call(p, init)).text();

let t = await txt("/");
_log("showcase mentions alt: " + /Тест Altegio|c=alt/.test(t) + " | cards: " + (t.match(/class="card"/g) || []).length);
t = await txt("/selftest?key=lk");
_log("selftest page mentions «Тест Altegio»: " + t.includes("Тест Altegio") + " | options: " + (t.match(/<option>[^<]*/g) || []).join(","));
t = await txt("/?c=alt"); _log("direct link /?c=alt: title ok = " + t.includes("<title>Тест Altegio — AI-администратор</title>") + " | page contains location/partner key/LEADS_KEY: " + /1398319|4190|partner-key|"lk"/.test(t));
t = await txt("/chat?c=alt"); _log("/chat?c=alt opens: " + t.includes("Тест Altegio"));

// WhatsApp menu (Meta): numbers and words
const wa = async (id, body) => { const b = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: "77011112233", type: "text", text: { body } }] } }] }] }); await h.call("/", { method: "POST", body: b, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", "sec").update(b).digest("hex") } }); await Promise.all(h.pending); };
await wa("m1", "привет"); _log("WA menu text mentions alt: " + /Altegio/.test(h.calls.wa.at(-1).text.body) + "\n   " + h.calls.wa.at(-1).text.body.replace(/\n/g, " / "));
for (const [id, s] of [["m2", "7"], ["m3", "alt"], ["m4", "Тест Altegio"], ["m5", "altegio"]]) { await wa(id, s); _log(`WA «${s}» → ${h.calls.wa.at(-1).text.body.slice(0, 50).replace(/\n/g, " / ")} | niche key: ${h.mem.get("wa:niche:wa:77011112233") || "-"}`); }
await wa("m6", "барбершоп"); _log(`WA «барбершоп» → niche: ${h.mem.get("wa:niche:wa:77011112233")}`);
// Green-API menu
const ga = async (id, s) => { await h.call("/ga?t=hook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ typeWebhook: "incomingMessageReceived", idMessage: id, senderData: { chatId: "77055556677@c.us" }, messageData: { textMessageData: { textMessage: s } } }) }); await Promise.all(h.pending); };
await ga("g1", "7"); _log("GA «7» → niche: " + (h.mem.get("wa:niche:ga:77055556677") || "-") + " | menu mentions alt: " + /Altegio/.test(h.calls.ga.at(-1).message));

// what a non-owner (chat user) receives after a real booking
h.gemini = ["Записала.\n" + h.tag("Азамат", "Мужская стрижка", "Арман", D1, "11:00")];
const res = await h.call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.3.3.3" }, body: JSON.stringify({ c: "alt", sid: "hid1", text: "Азамат, +7 777 123 45 67, мужская стрижка к Арману завтра в 11:00" }) });
const raw = await res.text();
_log("\n/api/chat JSON after booking:\n   " + raw);
_log("   contains record_hash/hash value: " + /record_hash|hash555/.test(raw) + " | contains location: " + /4190/.test(raw) + " | contains partner key: " + raw.includes("partner-key"));
const hist = await txt("/api/history?c=alt&sid=hid1"); _log("/api/history: contains hash: " + /hash555|record_hash/.test(hist) + " | " + hist.slice(0, 160));
_log("KV history (server side only) has the hash: " + /hash555001/.test(h.mem.get("h:web:alt:hid1")));
// failed booking: what internal text goes to the browser
h.ALT.hook = p => p.startsWith("/book_record/") ? J({ success: false, meta: { message: "Authentication needed. Token Bearer partner-key is invalid" } }, 401) : null;
h.gemini = ["Записала.\n" + h.tag("Дамир", "Мужская стрижка", "любой", D1, "13:00")];
const res2 = await (await h.call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.3.3.4" }, body: JSON.stringify({ c: "alt", sid: "hid2", text: "Дамир, +7 777 123 45 99, мужская стрижка завтра в 13:00" }) })).text();
_log("\n/api/chat JSON when Altegio refuses (error text from Altegio is echoed into lead.note → browser):\n   " + res2);
h.ALT.hook = null;
// leads pages
t = await txt("/leads?key=lk"); _log("\n/leads (owner): shows alt block: " + t.includes("Тест Altegio (") + " | contains hash: " + /hash555/.test(t));
t = await txt("/leads?c=alt&key=ownerkey"); _log("/leads?c=alt&key=KEY_ALT: " + (t.includes("Азамат") ? "opens for the client's own key" : "no") + " | contains hash: " + /hash555/.test(t));
_log("/leads?c=dent&key=KEY_ALT → " + (await h.call("/leads?c=dent&key=ownerkey")).status);
_log("/altegio?key=KEY_ALT (client key, not owner) → " + (await h.call("/altegio?key=ownerkey&c=alt")).status);
t = await txt("/diag?key=lk"); _log("/diag: contains partner key: " + t.includes("partner-key") + " | Altegio line: " + (t.match(/Altegio:[^\n]*/) || [""])[0]);
t = await txt("/altegio?key=lk"); _log("/altegio page: contains partner key: " + t.includes("partner-key") + " | contains hash: " + /hash555/.test(t) + " | key in hidden input: " + /name="key" value="lk"/.test(t));
const r = await h.call("/altegio?key=lk"); _log("/altegio response headers: " + JSON.stringify([...r.headers.entries()]));
