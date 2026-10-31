// @ts-check
// Реклама — только с подтверждённым согласием (решение владельца 31.10.2026; ТЗ Winchester v2.0 §5): рассылка по базе Altegio
// (services/crm, автосценарий «Пора на стрижку», рассылка из сегмента) спрашивает разрешённые номера здесь. Базы согласий D1
// нет (боевой сайт) или она не отвечает — разрешённых нет: рекламы нет, причина видна в пульте («закрыто наглухо»).
// reasons — почему остальным нельзя (для воронки рассылки, ТЗ v3.0 P0): block, stop, review, denied, unconfirmed, noconsent, cooldown.
// Кого нет в базе контактов вовсе — в reasons нет: для воронки это «нет согласия». Кому можно — решает только phones.
/** @import { Env, Client } from "../../lib/types.js" */
import { d1Ready } from "../../db/d1/status.js";
import { consentGate } from "../../db/d1/contacts.js";
import { optoutPhones } from "../../db/kv/optout.js";
import { GAP_MS } from "./segments.js";

/** → { ready: база отвечает, phones: кому можно, why: почему никому, reasons: номер → причина } @param {Env} env @param {Client} c @param {number} now */
export async function marketingGate(env, c, now) {
  /** @type {Map<string, string>} */
  const none = new Map();
  const db = await d1Ready(env, now).catch(() => null);
  if (!db) return { ready: false, phones: new Set(), reasons: none, why: "Нет базы согласий (раздел «Клиенты»): реклама — только тем, кто дал подтверждённое согласие." };
  try { const g = await consentGate(db, c.id, now, await optoutPhones(env, c.id), GAP_MS); return { ready: true, phones: g.phones, reasons: g.why, why: "" }; }
  catch (e) { console.log("gate", String(e).slice(0, 120)); return { ready: false, phones: new Set(), reasons: none, why: "База согласий не ответила — рассылка по базе отложена." }; }
}
