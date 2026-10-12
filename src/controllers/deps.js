// @ts-check
// Роутер (routes/index.js): то, что ему нужно из services и адаптеров. Слой routes не подключает services напрямую (CLAUDE.md §4), поэтому берёт через controllers.
export { sessionRead, keyGate, leadsKey, cookieSet } from "../services/auth/session.js";
export { syncClients } from "../services/tenants/passport.js";
export { runCase } from "../services/selftest/run.js";
export { gaShared, gaRoute, gaHook } from "../services/channels/deps.js";
