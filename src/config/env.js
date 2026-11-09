// @ts-check
// Имена переменных окружения номера Meta компании (план Meta, шаг 2, 09.11.2026). Только имена и виды: значений здесь нет и быть
// не может (репозиторий публичный, CLAUDE.md §3.5). Полный список переменных — CLAUDE.md §3; проверка test/unit/meta-graph.test.mjs
// сверяет, что каждое имя отсюда там описано. Проверки переменных при старте Worker пока нет.
// <ID> — id компании заглавными (WINCHESTER). kind: secret — тип «Secret» в Cloudflare (даёт доступ), text — «Text» (открытая настройка).

/** @typedef {{ name: string, kind: "secret" | "text", what: string }} VarInfo */

/** @type {ReadonlyArray<Readonly<VarInfo>>} */
export const META_VARS = Object.freeze([
  { name: "WA_TOKEN_<ID>", kind: "secret", what: "постоянный ключ системного пользователя Meta (права whatsapp_business_messaging и whatsapp_business_management)" },
  { name: "APP_SECRET_<ID>", kind: "secret", what: "секрет приложения Meta: подпись вебхука /wa/<id>" },
  { name: "PHONE_NUMBER_ID_<ID>", kind: "text", what: "ID номера WhatsApp в Meta: с него уходят ответы и сообщения" },
  { name: "WABA_ID_<ID>", kind: "text", what: "ID аккаунта WhatsApp Business: шаблоны, сведения аккаунта, подписка приложения" },
  { name: "WA_SINCE_<ID>", kind: "text", what: "когда подключён номер Meta (как GA_SINCE_<ID>)" },
  { name: "WA_VIA_<ID>", kind: "text", what: "wazzapo — номер через партнёра Meta Wazzapo" },
  { name: "VERIFY_TOKEN", kind: "text", what: "пароль проверки адреса вебхука в кабинете Meta" }
].map(v => Object.freeze(/** @type {VarInfo} */ (v))));

/** имя переменной компании: varName("WABA_ID_<ID>", "winchester") → "WABA_ID_WINCHESTER" @param {string} tpl @param {string} cid */
export const varName = (tpl, cid) => tpl.replace("<ID>", String(cid || "").toUpperCase());
