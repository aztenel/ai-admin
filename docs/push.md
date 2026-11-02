# Push-уведомления пульта `/app/` (ТЗ Winchester v2.0 §3, 31.10.2026)

Уведомление приходит на телефон или компьютер сотрудника, даже когда пульт закрыт. Сделано на стандарте Web Push — без
приложения в App Store и без сторонних сервисов: шифрование и подпись — в самом Worker (WebCrypto).

## Где что

| Часть | Файл |
|---|---|
| Шифрование сообщения (RFC 8291) и подпись VAPID (RFC 8292) | `src/services/integrations/webpush/crypto.js` |
| Отправка в службу push, список разрешённых служб (Apple, Google, Mozilla, Microsoft) | `src/services/integrations/webpush/client.js` |
| Подписки устройств, ключи VAPID, «уже отправляли» | `src/db/kv/push.js` (`wp:<компания>:<отпечаток>`, `push:vapid`, `wpd:`) |
| Кому и что отправить: `pushNotify(env, cid, ev)` | `src/services/notifications/push.js` |
| API пульта: `/api/push/config`, `subscribe`, `prefs`, `unsubscribe`, `test` | `src/controllers/push.js` |
| Service Worker, манифест для экрана «Домой», значки | `apps/pult/public/sw.js`, `manifest.webmanifest`, `icon-*.png` |
| Экран «Настройки → Уведомления» | `apps/pult/src/screens/PushSettings.tsx`, `apps/pult/src/lib/push.ts` |

## Событие (`pushNotify`)

```js
pushNotify(env, "winchester", {
  kind: "inbound",            // inbound | campaign_reply | booking_change | unassigned | send_failed | channel_down
  key: "<idMessage>",         // повтор события за 10 минут — одно уведомление (память + KV wpd:)
  chat: { ch: "ga", id: "77001112001" }, // нажатие откроет этот чат: /app/?c=winchester#/inbox/ga%3A77001112001
  title: "Ерлан", text: "…",  // имя и текст — только на устройства, где сотрудник включил «показывать текст»
  line: "второй номер",       // на экране блокировки без текста: «Новое сообщение · второй номер»
  assignee: "Айгерим",        // только на устройства этого сотрудника (нет таких — всем)
  badge: 3,                   // число на значке приложения
  critical: false,            // true — и в часы «не беспокоить», и в Telegram (notifyOnce, раз в 10 минут на вид)
}) // → { sent, skipped }, исключений не бросает
```

## Ограничения (честно)

- **iPhone и iPad**: только iOS 16.4 и новее и только пульт, добавленный на экран «Домой» (Safari → «Поделиться» →
  «На экран Домой») и открытый значком. Во вкладке Safari push нет — экран настроек так и пишет.
- Доставляют службы Apple и Google: обычно за секунды, но время доставки они не обещают; телефон в режиме
  «Не беспокоить» или «Фокус» может придержать уведомление.
- Safari отключает push сайту, который получил сообщение и ничего не показал, — поэтому на iPhone уведомление показывается
  всегда, даже если этот чат открыт.
- Имя сотрудника — то, что он ввёл на своём устройстве (вход в пульт — общий ключ компании). Это подпись, а не защита доступа.
- Программа для Windows (Tauri) — по-прежнему уведомления Windows, пока программа открыта.

## Проверки

- `test/unit/webpush.test.mjs` — пример RFC 8291 байт в байт, подпись VAPID проверяется открытым ключом, адреса служб push.
- `test/unit/push.test.mjs` — права API, ключи, кому уходит, «не беспокоить», повтор события, 410.
- `test/unit/pult-push.test.mjs` — манифест, `sw.js` без кэша, логика Service Worker (node:vm).
- `apps/pult`: `npm run e2e:push -- <папка>` — Chromium: экраны iPhone и компьютера, подписка, «Проверить», показ уведомления.
- На настоящем iPhone — не проверено (нужна живая проверка владельца после выкладки в `dev`).
