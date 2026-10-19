// AI-администратор v7.5 — веб-чат по ссылке (6 ниш) + WhatsApp Cloud API + запись в Altegio + автотест
// Cloudflare Worker.
//
// ОБЯЗАТЕЛЬНО:  KV binding "KV" · Secret GEMINI_KEY · Text VERIFY_TOKEN
// ЖЕЛАТЕЛЬНО:   Text LEADS_KEY (пароль к заявкам и автотесту; если нет — используется VERIFY_TOKEN)
//               Text MODEL (например gemini-3.5-flash-lite) · Text MODEL_FALLBACK
// УВЕДОМЛЕНИЯ:  Secret TG_TOKEN + Text TG_CHAT — заявки, отмены, «позовите человека», голосовые и фото в Telegram.
//               TG_CHAT можно через запятую (владелец, администратор). Свой чат у клиента: TG_CHAT_DENT, TG_CHAT_BEAUTY…
// СОГЛАСИЕ:     Text CONSENT_TEXT — свой текст согласия (по умолчанию стандартный, {name} = название компании)
// WHATSAPP (официально, Meta):  Secret WA_TOKEN · Text PHONE_NUMBER_ID · Text WA_CLIENT · Secret APP_SECRET
//   Webhook в Meta (WhatsApp → Configuration): Callback URL = https://<воркер>/  · Verify token = VERIFY_TOKEN · поле messages
//   APP_SECRET = App secret из App settings → Basic: бот принимает только запросы, подписанные Meta.
//   Без APP_SECRET бот в WhatsApp сам в расписание Altegio не записывает — передаёт заявку администратору
//   Text OWNER_NAME, OWNER_EMAIL — оператор и почта на странице /privacy (Privacy Policy URL для публикации приложения Meta)
// WHATSAPP (Green-API, обычный WhatsApp по QR-коду), номер клиента: Text GA_ID_<ID> · Secret GA_TOKEN_<ID> · Text GA_URL_<ID> (apiUrl из кабинета)
//   Вебхук https://<воркер>/ga/<id>?t=<пароль> настраивает кнопка «Настроить Green-API» на странице /launch?c=<id>. Через этот номер идут и рассылки (обычным текстом).
// WHATSAPP (Green-API, общий номер воркера — демо):   Text GA_URL · Text GA_ID · Secret GA_TOKEN · Secret GA_HOOK (любой пароль)
//                               Text GA_CLIENT — ниша (dent/beauty/…); пусто = меню ниш
//   Webhook URL в кабинете Green-API:  https://<воркер>/ga?t=<GA_HOOK>
// КЛЮЧИ КЛИЕНТОВ: Text KEY_DENT, KEY_BEAUTY… — владелец видит только свои заявки: /leads?c=dent&key=…
// ALTEGIO (запись в расписание): Secret ALTEGIO_PARTNER — ключ разработчика (Altegio → Интеграции → Аккаунт разработчика)
//   Локация клиента: поле altegio.location в его блоке CLIENTS или Text ALTEGIO_LOC_<ID> (например ALTEGIO_LOC_ALT)
//   Бот берёт из Altegio услуги, мастеров и свободное время и сам создаёт запись (API онлайн-записи).
//   Отмена и перенос: по умолчанию бот в расписании ничего не удаляет, а передаёт просьбу клиента администратору (заявка + Telegram).
//   Text ALTEGIO_SELF_CANCEL = 1 (или ALTEGIO_SELF_CANCEL_<ID>, или altegio.selfCancel в блоке клиента) — бот отменяет и переносит сам
// ЛИМИТЫ:       Text SESSIONS_PER_IP — новых диалогов в сутки с одного IP (по умолчанию 8 для демо и 40 для клиента с расписанием Altegio)
//
// Ссылки:
//   /                         — витрина всех демо
//   /?c=dent|beauty|auto|edu|event|barber — чат ниши; /?c=alt — чат с записью в расписание Altegio (не на витрине)
//   /leads?key=<LEADS_KEY>    — заявки
//   /selftest?key=<LEADS_KEY> — автотест на живой модели (один сценарий по ссылке: /api/selftest?key=…&i=номер)
//   /diag?key=<LEADS_KEY>     — диагностика ключа и модели
//   /altegio?key=<LEADS_KEY>  — проверка Altegio: услуги, мастера, свободное время (&loc=<номер> — любая локация) и пробная запись
//
// Новый клиент = новый блок в CLIENTS: факты, график (hours), слоты (slots), безопасные фразы.
// Страница пульта (дизайн, телефон/планшет/ПК, демо) лежит в папке pult/ и собирается в pult.gen.js командой `node tools/build-pult.mjs`.
// Новый пульт (apps/pult, React + Vite) — по адресу /app/; собирается в pult-app.gen.js командой `npm run build:app`.
import { PULT_LIVE, PULT_DEMO, PULT_ICONS } from "./pult.gen.js";
import { PULT_APP } from "./pult-app.gen.js";
// Модули переезда (REFACTORING.md): всё новое — только в src/, worker.js их подключает.
import { money } from "./src/lib/money.js";
import { nameToks, svTrim } from "./src/lib/names.js";
import { normPhone, phonesIn, redact, maskPhones } from "./src/lib/phone.js";
import { TZ, local, mins, isoDay, hm } from "./src/lib/time.js";
import { clean, snip, lowE, esc, isJoke } from "./src/lib/text.js";
import { hash, enc8, hmacB64, safeEq, metaSigOk } from "./src/lib/crypto.js";
import { html, json, jsonP, page, forbid, sameOrigin } from "./src/lib/http.js";
import { altText, altCall } from "./src/services/integrations/altegio/client.js";
import { altCache, altBase, altDates, altDropTimes, altTimes, altRecord } from "./src/services/integrations/altegio/booking-api.js";
import { altEmailErr, ALT_EMAIL_TIP } from "./src/services/integrations/altegio/errors.js";
import { kvRetry } from "./src/db/kv/retry.js";
import { putHist, logTurns, mergeProfile, readHist } from "./src/db/kv/chats.js";
import { leadTs, loadLeads, saveLeads, leadKey, allLeads } from "./src/db/kv/leads.js";
import { bcKey, bcChunkKey, bcPut, bcGet } from "./src/db/kv/broadcasts.js";
import { detectLang } from "./src/services/conversation/language.js";
import { tagFields, tagField, altDateOf } from "./src/services/conversation/tags.js";
import { altClaims } from "./src/services/conversation/claims.js";
import { checkReply, offers, findPhone } from "./src/services/conversation/guard.js";
import { hStr, freeSlots, getSlots } from "./src/services/schedule/slots.js";
import { ALT_WANT_CHANGE } from "./src/services/conversation/intents.js";
import { compileClient, syncClients } from "./src/services/tenants/passport.js";
import { CLIENTS, BUILTIN, hasClient } from "./src/config/builtin-clients.js";
import { notify, tgProbe } from "./src/services/integrations/telegram/client.js";
import { noteDue, notifyOnce, backupRun } from "./src/services/notifications/telegram.js";
import { gaShared, gaRoute, gaSecret, gaHook } from "./src/services/integrations/greenapi/webhook.js";
import { gaCall, gaCode, gaWhy, gaInfo } from "./src/services/integrations/greenapi/client.js";
import { sendGreen } from "./src/services/channels/greenapi.js";
import { waCreds, WA_HINT, waErr } from "./src/services/integrations/meta/client.js";
import { bcParam, sendTemplate } from "./src/services/integrations/meta/templates.js";
import { sendWA } from "./src/services/channels/meta.js";
import { fixedOf, nicheOf, seenBefore, waCoex, markOptout, waRoute } from "./src/services/channels/index.js";
import { NICHES } from "./src/config/niches.js";
import { askGemini } from "./src/services/ai/gemini.js";
import { isClaude } from "./src/services/ai/claude.js";
import { PAUSE_MS, LEAD_TTL, MAX_LEN, SESSIONS_PER_IP, HIST_KEEP, ALT_DAYS, ALT_JOURNAL_DAYS, GRAPH, WA_BATCH, SESSION_MS, COOKIE, BC_CHUNK, BC_STALE, BC_SLOT, BC_DAY } from "./src/config/constants.js";
// nameForms, altNamed, ANY_STAFF, altDay, altLimKeys в worker.js не вызываются: их берут обвязки test/review (копия worker.js с экспортом внутренних функций)
import { nameKey, samePerson, caseName, nameForms } from "./src/services/booking/people.js";
import { altPickServices, altPickStaff, altNamed, ANY_STAFF } from "./src/services/booking/pick.js";
import { altSelfCancel, altLoc, thin, altSnapshot, altBook } from "./src/services/booking/book.js";
import { altUserKey } from "./src/services/booking/journal.js";
import { altWhen, altLabel, altSay, altDay } from "./src/services/booking/replies.js";
import { BASE_CSS } from "./src/lib/css.js";
import { altDiag, altUserProbe, altUserPage, altPage } from "./src/controllers/altegio.js";
import { diag } from "./src/controllers/diag.js";
import { leadsPage, privacyPage, portfolioPage, chatPage } from "./src/controllers/pages.js";
import { selftestPage } from "./src/controllers/selftest.js";
import { sundayNight, has, hasnt, noOffer, pickSlot, KZ, altSlot, altMade, CASES, COMMON } from "./src/services/selftest/cases.js";
import { ipKey, altOverLimit, altCount, altLimKeys } from "./src/services/booking/limits.js";
import { BC_HINT, bcCode, bcWhy } from "./src/services/broadcast/errors.js";
import { bcParse } from "./src/services/broadcast/parse.js";
import { bcSeg, bcOptouts } from "./src/services/broadcast/segments.js";
import { bcHold, bcHoldFor, bcFrom, bcHoldEdit, GA_STATE_TEXT, GA_STATE_BAD, gaStateSignal, waSignal, waFailed } from "./src/services/broadcast/holds.js";
import { bcRoute, bcHealth, bcGaMsg, bcGaText, bcSendGa, bcRun, bcTick, GA_CAP, GA_MSG_MAX, GA_CAPTION_MAX } from "./src/services/broadcast/sender.js";
import { remindRun } from "./src/services/reminders/send.js";
import { digestRun } from "./src/services/digest.js";
import { cronRun } from "./src/jobs/cron.js";
import { systemPrompt } from "./src/services/conversation/prompt.js";
// wantsHuman, HANDOFF, ATTACK в worker.js не вызываются: их берут обвязки test/review (копия worker.js с экспортом внутренних функций)
import { canSee } from "./src/services/auth/access.js";
import { inboxApi } from "./src/controllers/inbox.js";
import { leadsKey, sessionRead, cookieSet, keyGate } from "./src/services/auth/session.js";
import { tooManyKeys, handleLogin, enter } from "./src/controllers/auth.js";
import { studioApi, studioPage } from "./src/controllers/studio.js";
import { launchApi, launchPage } from "./src/controllers/launch.js";
import { bcApi, bcPage } from "./src/controllers/broadcast.js";
import { runCase } from "./src/services/selftest/run.js";
import { think, thinkSafe, dropAsk, FALLBACK, STOP, wantsHuman, HANDOFF, ATTACK } from "./src/services/conversation/orchestrator.js";
import { cleanSid, tooMany, handleWebChat } from "./src/controllers/chat.js";
import { consentText, MENU, MENU_TEXT, hookBurst, handleWAText, waText, MEDIA_LABEL, MEDIA_WORD, handleWAMedia, handleWhatsApp, handleWAMessage, handleWAClient } from "./src/controllers/webhooks/meta.js";
import { gaText, handleGreen } from "./src/controllers/webhooks/greenapi.js";
import { createWorker } from "./src/index.js";


// ================= слой 1: вход =================
const JOKE = { test: isJoke };


// ================= передача живому администратору =================
const WORD = /[^a-zа-яәғқңөұүһі0-9]+/;

const firstWord = s => clean(s).toLowerCase().split(" ")[0];

// ================= HTTP =================
// Роутер — src/routes/index.js, точка входа — src/index.js; страницы пульта приходят из pult.gen.js и pult-app.gen.js (вне src/).
export default createWorker({ PULT_LIVE, PULT_DEMO, PULT_ICONS, PULT_APP });
