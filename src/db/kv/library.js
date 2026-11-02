// @ts-check
// Библиотека рекламных текстов компании (services/broadcast/library.js): правки владельца и свои тексты — один ключ mtpl:<клиент>.
/** @import { Env } from "../../lib/types.js" */
import { kvRetry } from "./retry.js";

/** @param {Env} env @param {string} cid @returns {Promise<Record<string, any>>} */
export async function libRead(env, cid) { try { return JSON.parse((await env.KV.get("mtpl:" + cid)) || "{}") || {}; } catch (e) { return {}; } }
/** @param {Env} env @param {string} cid @param {Record<string, any>} v */
export const libSave = (env, cid, v) => kvRetry(() => env.KV.put("mtpl:" + cid, JSON.stringify(v)));
