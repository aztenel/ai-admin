// F. redact end-to-end: what reaches the LLM and the stored history when a phone is followed by an IIN / card number.
// Run with: node f4_redact_e2e.mjs [path-to-worker]   (default: dev worker.js; pass ./worker.main.mjs to compare with v7.3)
const worker = (await import(process.argv[2] || new URL("../../../worker.js", import.meta.url).pathname)).default;
const mem = new Map(); const sent = []; const tg = [];
const KV = { get: async k => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); }, delete: async k => { mem.delete(k); } };
const env = { KV, GEMINI_KEY: "k", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1" };
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.includes("generativelanguage")) { sent.push(JSON.parse(init.body).contents.at(-1).parts[0].text); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Спасибо! Чем ещё помочь?" }] }, finishReason: "STOP" }] })); }
  if (url.includes("telegram")) { tg.push(JSON.parse(init.body).text); return new Response("{}"); }
  throw new Error(url);
};
let n = 0;
for (const text of ["Мой телефон и ИИН:\n87011234567\n990101300123", "8 701 123 45 67 4400 4301 2345 6789", "+7 701 123 45 67 990101300123", "ИИН 990101300123, тел 87011234567"]) {
  const sid = "r" + (++n);
  await worker.fetch(new Request("https://x.test/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.3.0." + n }, body: JSON.stringify({ c: "dent", sid, text }) }), env, {});
  const hist = JSON.parse(mem.get("h:web:dent:" + sid));
  console.log(`client: ${JSON.stringify(text)}\n   sent to the LLM : ${JSON.stringify(sent.at(-1))}\n   stored in KV    : ${JSON.stringify(hist.turns[0].text)} | profile.phone=${hist.profile.phone || "-"}`);
}
