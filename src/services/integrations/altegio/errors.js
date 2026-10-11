// @ts-check
// Altegio: ошибка «нужен email клиента» и подсказка владельцу.
/** @import { Env } from "../../../lib/types.js" */
// локация требует настоящий email клиента: пустой не подошёл
/** @param {any} e */
export const altEmailErr = e => !!e && e.status === 422 && /e-?mail/i.test(e.message || "");
export const ALT_EMAIL_TIP = "Altegio требует email клиента для онлайн-записи — сделайте поле email необязательным в настройках онлайн-записи Altegio";
