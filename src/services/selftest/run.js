// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Прогон одного сценария автотеста: свой временный KV в памяти, ответы настоящего think() (/selftest, /api/launch/case).
import { think } from "../conversation/orchestrator.js";
import { sundayNight, CASES, COMMON } from "./cases.js";

export async function runCase(env, i, list = CASES) {
  const k = list[i]; if (!k) return { error: "no case" };
  const mem = new Map();
  const store = { get: async x => mem.get(x) ?? null, put: async (x, v) => { mem.set(x, v); }, delete: async x => { mem.delete(x); } };
  const nowMs = k.now === "sunday22" ? sundayNight(Date.now()) : Date.now();
  const all = [], transcript = [];
  let prev = null;
  for (const m of k.msgs) {
    const text = typeof m === "function" ? m(prev) : m;
    const t0 = Date.now();
    const r = await think(env, store, k.c, "t", text, "автотест", { test: true, nowMs });
    r.offer = r.offer || [];
    all.push(r); transcript.push({ u: text, b: r.reply, ms: Date.now() - t0, guard: r.guard || null, lead: r.lead || null, cancel: !!r.cancel, handoff: !!r.handoff, paused: !!r.paused, error: r.error || null });
    prev = r;
  }
  const last = all[all.length - 1], fails = [];
  for (const [name, fn] of k.checks) { let ok = false; try { ok = !!fn(last, all); } catch (e) {} if (!ok) fails.push(name); }
  for (const r of all) for (const [name, fn] of COMMON) if (!fn(r) && !fails.includes(name)) fails.push(name);
  const limit = all.some(r => r.error && /429|quota|RESOURCE_EXHAUSTED/i.test(r.error));
  return { i, c: k.c, t: k.t, pass: fails.length === 0, limit: limit && fails.length > 0, fails, transcript };
}
