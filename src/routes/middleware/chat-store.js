// @ts-check
// Хранилище переписок на входе Worker (01.11.2026): env.KV заменяется обёрткой, которая ключи переписок компаний с CHAT_STORE_<ID> = d1
// пишет и читает в D1 (services/chatstore). Точка входа подключает сервисы только через middleware (scripts/check-boundaries.mjs).
export { chatEnv } from "../../services/chatstore/index.js";
