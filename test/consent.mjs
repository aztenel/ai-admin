// Рассылки по базе Altegio — только с подтверждённым согласием (решение владельца 31.10.2026, ТЗ Winchester v2.0 §5). Проверкам
// рассылок по базе нужна база согласий D1 (test/d1.mjs, Node 22+): grantSnap выдаёт подтверждённое согласие всем клиентам снимка
// (или списку номеров) — как если бы каждый письменно согласился. На Node 20 базы нет: такие проверки пропускаются.
import { sqliteOk, d1With } from "./d1.mjs";
import { contactAdd } from "../src/db/d1/contacts.js";
import { consentAdd } from "../src/db/d1/rights.js";

export { sqliteOk };
export const consentSkip = sqliteOk ? false : "согласия — в базе D1 (node:sqlite есть только в Node 22+)";
let n = 0;
/** @param {any} env @param {string} cid @param {string[]} [only] номера (цифры) — только им; без списка — всем из снимка */
export async function grantSnap(env, cid, only) {
  if (!sqliteOk) return;
  if (!env.DB) env.DB = d1With("production").db;
  const snap = JSON.parse((await env.KV.get(`crm:${cid}:snap`)) || "null");
  const phones = only || (snap ? [...snap.list.map(x => x.p), ...(snap.futOnly || [])] : []);
  for (const p of phones) {
    const id = "c" + (++n);
    const r = await contactAdd(env.DB, cid, { id, phone: String(p), name: "", search: String(p), at: 1, actor: "owner" });
    await consentAdd(env.DB, cid, { contactId: (r && r.id) || id, purpose: "marketing", state: "granted", basis: "письменное согласие (проверки)", source: "manual", actor: "owner", at: 1, evidence: "document", evidenceRef: "тест", confirmed: true, givenAt: 1 });
  }
}
