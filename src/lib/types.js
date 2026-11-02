// @ts-check
// Общие формы данных для JSDoc-типов (только @typedef): подключаются тегом /** @import { Env } from "../lib/types.js" */.
// Точность не цель: any там, где форма не очевидна.

/**
 * Окружение Worker: привязка KV, текстовые переменные и секреты (CLAUDE.md §3).
 * @typedef {Record<string, any> & { KV: any }} Env
 */

/**
 * Клиент (паспорт бота), как в CLIENTS / compileClient.
 * @typedef {Record<string, any>} Client
 */

/**
 * Профиль чата (имя, телефон, записи, заявки, пауза, need, окно 24 ч li, stop…).
 * @typedef {Record<string, any>} Profile
 */

/**
 * Реплика в истории чата. mid — номер сообщения у провайдера, st — статус доставки; del — удалено (клиентом или у всех),
 * dl — удалено у всех из пульта, dlu — удаляли, но неизвестно, удалилось ли; hid — скрыто в пульте («Удалить у меня»)
 * @typedef {{ role: string, text: string, t?: number, by?: string, m?: any, mid?: string, st?: string, del?: number, dl?: { at: number, by: string }, dlu?: { at: number, by: string }, hid?: { at: number, by: string } }} Turn
 */

/**
 * Чат целиком: реплики и профиль.
 * @typedef {{ n?: number, turns: Turn[], profile: Profile }} Hist
 */

/**
 * Контекст одного ответа бота (окна записи, профиль, лимиты, подсказки): форма зависит от ветки, поэтому any.
 * @typedef {Record<string, any>} Ctx
 */

export {};
