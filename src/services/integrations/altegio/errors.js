// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Altegio: ошибка «нужен email клиента» и подсказка владельцу.
// локация требует настоящий email клиента: пустой не подошёл
export const altEmailErr = e => !!e && e.status === 422 && /e-?mail/i.test(e.message || "");
export const ALT_EMAIL_TIP = "Altegio требует email клиента для онлайн-записи — сделайте поле email необязательным в настройках онлайн-записи Altegio";
