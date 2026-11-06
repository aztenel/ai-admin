# Bagisto — аудит кода как кандидата для Prime Mobile OS

Репозиторий: `/home/user/erp-lab/bagisto`, коммит `678a43c804321a310dd41fd39deda78d316ac6f5` (5 ноября 2026).
Только статический анализ: ничего не запускалось, ни тесты, ни приложение.
`Core::BAGISTO_VERSION = '2.5.x-dev'` (`packages/Webkul/Core/src/Core.php:32`). Laravel `^13.0`, PHP `^8.4`, лицензия MIT (`composer.json`).
Пакеты: `packages/Webkul/*`, 40 модулей (Admin, Shop, Sales, Checkout, Product, Inventory, RMA, DataTransfer, User, Core, платёжные шлюзы и т. д.).

## Вывод (TL;DR)

- **Как основа ERP/POS — не подходит.** Это витрина интернет-магазина. В ней есть склады с количеством на каждом и резерв под заказ, но нет закупок и поставщиков, перемещений, инвентаризации, журнала движения товара, учёта по серийным номерам и IMEI, POS, гарантии и мультиарендности. POS и Multi-Tenant SaaS — платные расширения Webkul, в этом репозитории их нет.
- **Как отдельная платная витрина поверх собственной ERP — возможно, но с оговорками.** Есть каталог, конфигурируемые товары (модель × память × цвет), несколько каналов, мультивалютность (KZT в списке валют), полный перевод `ru`. Казахского языка (`kk`) нет. Kaspi нет. REST/GraphQL API в ядро не входит. Синхронизацию остатков из ERP придётся писать самим.

---

## 1. Склад и учёт

### 1.1 Типы товаров
`packages/Webkul/Product/src/Type/`: `Simple`, `Configurable`, `Virtual`, `Grouped`, `Bundle`, `Downloadable`, `Booking` (+ `AbstractType`). Типа «товар с серийным номером» нет.

### 1.2 Склады (inventory sources) и количество
- Склады: таблица `inventory_sources` (`packages/Webkul/Inventory/src/Database/Migrations/2018_07_23_110040_create_inventory_sources_table.php`). Пакет Inventory маленький: модель, репозиторий, одна миграция.
- Привязка склада к каналу: `channel_inventory_sources` (`packages/Webkul/Core/src/Database/Migrations/2018_12_24_123812_create_channel_inventory_sources_table.php`; `Channel::inventory_sources()` в `packages/Webkul/Core/src/Models/Channel.php:98`).
- Количество: `product_inventories(qty int, product_id, vendor_id default 0, inventory_source_id)`, уникальный ключ `(product_id, inventory_source_id, vendor_id)` (`packages/Webkul/Product/src/Database/Migrations/2018_07_27_113956_create_product_inventories_table.php`). `qty` — знаковый `integer`, проверки ≥ 0 в базе нет.
- Резерв: `product_ordered_inventories(qty, product_id, channel_id)`, уникальный ключ `(product_id, channel_id)` (`.../2018_12_26_165327_create_product_ordered_inventories_table.php`). Резерв ведётся **по каналу, а не по складу**.
- Индекс для витрины: `product_inventory_indices` (`.../2022_10_08_134150_create_product_inventory_indices_table.php`). Ещё есть `cart_item_inventories` (Checkout).
- Остаток из админки задаётся **абсолютным значением**, без записи о движении: `ProductInventoryRepository::saveInventories()` делает `updateOrCreate([...], ['qty' => $qty ?? 0])` (`packages/Webkul/Product/src/Repositories/ProductInventoryRepository.php:24-39`). Маршрут — `PUT edit/{id}/inventories` → `updateInventories` (`packages/Webkul/Admin/src/Routes/web/catalog-routes.php:103`).

### 1.3 Как меняется остаток по жизненному циклу заказа
1. **Оформление заказа** — `OrderRepository::createOrderIfNotThenRetry()` (`packages/Webkul/Sales/src/Repositories/OrderRepository.php:46-123`) внутри `DB::beginTransaction()` (стр. 50) → `OrderItemRepository::manageInventory()` (`packages/Webkul/Sales/src/Repositories/OrderItemRepository.php:82-145`):
   - `available` = сумма `qty` по `product_inventories` активных складов канала, **`->lockForUpdate()`** (стр. 108-112);
   - `ordered_inventories` канала, `->lockForUpdate()->first()` (стр. 114-117);
   - если `available - reserved < qty` и выключены `back_orders`, выбрасывается `InsufficientInventoryException` (стр. 124-131);
   - иначе резерв увеличивается (`increment`) или создаётся новая строка (стр. 133-142).
   - **Физический остаток при заказе не уменьшается** — растёт только резерв.
2. **Счёт (invoice)** — `InvoiceItemRepository::updateProductInventory()` (`packages/Webkul/Sales/src/Repositories/InvoiceItemRepository.php:25-60`) вызывается только для **нескладских** позиций (`! isStockable() && showQuantityBox()`, `InvoiceRepository.php:137-163`). Снимает резерв и уменьшает склады канала по убыванию `qty`.
3. **Отгрузка (shipment)** — `ShipmentItemRepository::updateProductInventory()` (`packages/Webkul/Sales/src/Repositories/ShipmentItemRepository.php:25-63`), вызов в `ShipmentRepository.php:104,114`, внутри транзакции (`ShipmentRepository::create`, стр. 44/146). Снимает резерв и уменьшает `qty` выбранного склада (`shipment.source`). **Блокировки строк нет.** Количество считается в PHP (`$inventory->qty - $data['qty']`) и **обрезается до 0** (`if (($qty = ...) < 0) $qty = 0;`, стр. 56-58). Резерв тоже обрезается до 0 (стр. 40-42).
4. **Отмена заказа** — `OrderRepository::cancel()` (стр. 141-196) → `returnQtyToProductInventory()` (`OrderItemRepository.php:151-182`). **Транзакции нет** (в `cancel()` нет `DB::` вообще). Возврат на склад — `update(['qty' => $inventory->qty + $shippedQty])`, без блокировки.
5. **Возврат денег (refund)** — `RefundRepository::create` в транзакции (стр. 42/164) → `RefundItemRepository::returnQtyToProductInventory()` (`packages/Webkul/Sales/src/Repositories/RefundItemRepository.php:~25-90`): возвращает отгруженное количество на склад отгрузки, тоже чтение-изменение-запись без блокировки. Фильтр по `vendor_id` закомментирован (стр. 67).

### 1.4 Гонки и перепродажа (oversell)
- **Одновременное оформление заказов на один товар**: строки `product_inventories` блокируются через `lockForUpdate` в транзакции, поэтому параллельные заказы на один товар выполняются по очереди. Защита от перепродажи на этом шаге **есть** (MySQL/InnoDB, Postgres).
- Тонкое место: при первом заказе строки резерва ещё нет, и `->lockForUpdate()->first()` ничего не блокирует. Но строки `product_inventories` уже заблокированы, а `unique(product_id, channel_id)` не даст создать две строки резерва. Повтор (`max_retry_attempts`, по умолчанию 3, стр. 48) обработает ошибку дубля. По коду гонка закрыта, но не проверено.
- **Гонки после заказа**: отгрузка, отмена, refund и ручная правка в админке делают чтение-изменение-запись **без `lockForUpdate`** (`ShipmentItemRepository.php:47-60`, `OrderItemRepository.php:176-180`, `RefundItemRepository.php:66-71`, `ProductInventoryRepository.php:31`). Значит, возможны потерянные обновления, например отгрузка одновременно с ручной правкой остатка.
- **Отрицательный остаток**: в базе он возможен (знаковый `integer`), но код обрезает значения до 0. С `catalog.inventory.stock_options.back_orders` резерв может превысить остаток. При отгрузке недостача **молча теряется** (обрезка до 0), не становится минусом и не попадает в журнал.
- **Резерв по каналу, а не по складу**: при нескольких складах на один канал резерв не привязан к филиалу. Для учёта «телефон лежит в филиале X» модель не подходит.

### 1.5 Возвраты (RMA)
Пакет `packages/Webkul/RMA` (миграции 2025-11-14, `rma`, `rma_items`, `rma_reasons`, `rma_statuses`, `rma_rules`, `rma_custom_fields`, …). Админский контроллер — `packages/Webkul/Admin/src/Http/Controllers/Sales/RMA/RequestController.php`:
- создание возврата: `store()` (стр. 221+), предел количества — `qty_invoiced - qty_refunded` или `qty_ordered - qty_invoiced - qty_canceled` (стр. 250-251);
- статус «посылка получена» → `handleReceivedPackage()` (стр. 411) → `processOrderRefund()` (стр. 514) → `RefundRepository::create` (возврат на склад идёт через refund);
- отмена позиции, по которой нет счёта, — `cancelNonInvoicedItem()` (стр. 483).
- Клиентская часть: `packages/Webkul/Shop/src/Http/Controllers/Customer/Account/RMAController.php`.
- Возврат привязан к заказу и позиции заказа, а не к конкретной единице (серийному номеру): единиц как сущности в системе нет.

### 1.6 Перемещения между складами
**Не найдены.** Искал `transfer` по `packages/**/*.php` (кроме DataTransfer): нашлись только меню и маршруты импорта DataTransfer (`packages/Webkul/Admin/src/Config/menu.php:394-402`, `Routes/web/settings-routes.php:171-180`) и статусы PayPal. Таблиц и контроллеров перемещения нет.

### 1.7 Инвентаризация (stocktake)
**Не найдена.** Таблиц пересчёта и журнала движения нет. Остаток задаётся абсолютным числом (§1.2).

### 1.8 Серийные номера / IMEI / лицензионные ключи
- `imei` (как отдельное слово, `grep -rniw`): **0 совпадений** по `packages`, `app`, `config`. Без границ слова совпадения ложные, например «t**imeI**nterval» в шаблонах booking.
- `serial` (без `serializ*`): только `pg_get_serial_sequence` в `packages/Webkul/Core/src/Concerns/SyncsPostgresSequences.php:90` и тестах. **Учёта по серийным номерам нет.**
- `license_key` / `licence`: **не найдено.** Ближе всего — ссылки для скачивания у типа Downloadable (`DownloadableLinkPurchasedRepository`, `lockForUpdate` на стр. 108). Пула ключей и единиц с уникальным номером нет.
- Обходные пути (опция кастомизации или атрибут на позиции заказа) не дают ни уникальности, ни статусов единицы (на складе / продан / возвращён / в ремонте).

### 1.9 Закупки и поставщики
**Не найдены.** `grep -rni supplier packages --include=*.php` — 0 совпадений. `purchase_order` — 0. `vendor_id` в `product_inventories` — задел под платный Marketplace (README, раздел «Multi Vendor Marketplace»), а не поставщики. Себестоимость: атрибут `cost` создаётся при установке (`packages/Webkul/Installer/src/Database/Seeders/Attribute/AttributeTableSeeder.php:253`), но отчёты по прибыли его **не используют**: `grep cost packages/Webkul/Admin/src/Helpers/Reporting/*.php` — 0 совпадений.

### 1.10 POS
**В коде нет.** README: раздел «# POS» ведёт на `https://bagisto.com/en/laravel-pos/`, то есть это коммерческое расширение. В `composer.json` и `packages/Webkul/*` пакета POS нет. Слова `point of sale` в PHP нет.

### 1.11 Гарантия
**Не найдена** (ни `warranty`, ни сроков гарантии на позиции).

---

## 2. Целостность данных

| Операция | Транзакция | Блокировка | Источник |
|---|---|---|---|
| Создание заказа | да, `DB::beginTransaction` + повтор до 3 раз | `lockForUpdate` на остатке и резерве | `OrderRepository.php:46-123`, `OrderItemRepository.php:108-117` |
| Счёт | да | нет | `InvoiceRepository.php:47/187` |
| Отгрузка | да | нет | `ShipmentRepository.php:44/146` |
| Refund | да | нет | `RefundRepository.php:42/164` |
| Отмена заказа | **нет** | нет | `OrderRepository.php:141-196` |
| Купоны | да (в слушателе) | `lockForUpdate` | `packages/Webkul/CartRule/src/Listeners/Order.php:64,80,122,152` |
| Сохранение способа оплаты | `DB::transaction` | — | `packages/Webkul/Checkout/src/Cart.php:653` |
| Импорт | `DB::transaction` | — | `packages/Webkul/DataTransfer/src/Helpers/Import.php` |

- Повтор `createOrderIfNotThenRetry` вызывает себя заново после `rollBack`. На `InsufficientInventoryException` и `CouponUsageLimitExceededException` повтора нет (стр. 97-101).
- **Защита от двойной оплаты в платёжных обратных вызовах**: `Cache::lock('stripe.order.'.$cartId, 30)` + «уже есть заказ с этим `cart_id`» (`packages/Webkul/Stripe/src/Http/Controllers/StripeController.php:179-190`). Похожие `Cache::lock` есть в `PayU/.../PayUController.php`, `Paypal/src/Helpers/Ipn.php`, `PayGlocal/.../PayGlocalController.php`. Подпись вебхука Stripe проверяется (`constructWebhookEvent`, `StripeController.php:141-146`).
- **Офлайн-оплата (`OnepageController::storeOrder`, `packages/Webkul/Shop/src/Http/Controllers/API/OnepageController.php:141-205`)**: проверка «заказ уже есть» стоит только для `is_buy_now`. Для обычной корзины блокировки нет, а `orders.cart_id` — просто `nullable integer` без уникального ключа (`packages/Webkul/Sales/src/Database/Migrations/2018_09_27_113154_create_orders_table.php:72`). Значит, двойная отправка до `deActivateCart()` теоретически создаёт два заказа. Это вывод из кода, не проверено.
- **Аудит**: журнала действий нет — `audit` и `activity_log` в PHP не найдены (вне языковых файлов). Есть только комментарии к заказу (`OrderComment`, `packages/Webkul/Sales/src/Models/OrderComment.php`). Кто и когда менял остаток, не записывается.

---

## 3. Мультиарендность и права

- **Каналы ≠ арендаторы.** Канал выбирается по `hostname` (`Core::getCurrentChannel`, `packages/Webkul/Core/src/Core.php:138-150`). У канала свои склады, языки, валюты и корневая категория. Но админка, роли, покупатели и каталог общие. Слово `tenant` в PHP-коде **не найдено**: изоляции данных по арендатору нет.
- **SaaS Multi-Tenant** — платное расширение (README, раздел «# Multi Tenant eCommerce», ссылка `bagisto.com/en/laravel-multi-tenant-saas/`). В репозитории его нет.
- **Права (ACL)**: `packages/Webkul/Admin/src/Config/acl.php` (1 366 строк, 186 ключей `'key'`). Роли: `roles.permission_type` = `all` или `custom` + `permissions` (`packages/Webkul/User/src/Database/Migrations/2018_06_13_055341_create_roles_table.php`).
- **Проверка на сервере**: middleware `packages/Webkul/User/src/Http/Middleware/Bouncer.php`. Метод `checkIfAuthorized()` (стр. ~135-150) сопоставляет имя маршрута с `acl()->getRoles()`: маршрута нет в ACL и в `UNRESTRICTED_ROUTES` (стр. 17-37) → `abort(401)`. Запрет по умолчанию, то есть «закрыто, если не разрешено». Ещё есть `Bouncer::canGrantRole()` (`packages/Webkul/User/src/Bouncer.php:41`): нельзя выдать роль с правами, которых нет у самого администратора.
- **Ограничения**: права проверяются только по маршруту. Ограничить сотрудника **филиалом, складом или каналом нельзя**: в `packages/Webkul/User/src` нет ни `channel_id`, ни `inventory_source`. Для сети салонов («продавец видит только свой филиал») этого не хватает.

---

## 4. Интеграции

- **REST/GraphQL**: в ядро не входят. `packages/Webkul/Shop/src/Routes/api.php` — это внутренний JSON для витрины на Vue: префикс `api`, middleware `web` + `shop`, сессия и cookie, CSRF (`ShopServiceProvider.php:53-54`). Отдельного `routes/api.php` нет. Подсказка в админке называет «Full REST & GraphQL API» и ведёт на внешнюю документацию (`packages/Webkul/Admin/src/Resources/lang/en/app.php:148-149`, `Resources/views/help/index.blade.php:42-47`). Это отдельные пакеты (bagisto/rest-api, GraphQL), в `composer.json` их нет. `laravel/sanctum` в зависимостях есть.
- **Исходящие вебхуки** (событие в ERP): **не найдены**. Есть только входящие вебхуки платёжных систем (Stripe, PayU, PhonePe, PayGlocal, PayPal IPN) и внутренние Laravel-события `Event::dispatch(...)` (`checkout.order.save.after`, `sales.shipment.save.after`, `catalog.product.update.after` …). Через них можно сделать свою синхронизацию.
- **Импорт/экспорт**: `packages/Webkul/DataTransfer`, импортёры `Product` (с остатками по складам: `Importers/Product/Importer.php:1125-1160`, `prepareInventories`), `Customer`, `TaxRate`. Есть валидация порциями (`Concerns/ValidatesInChunks.php`), загрузка картинок. Экспорт — из таблиц (`packages/Webkul/DataGrid/src/Exports/DataGridExport.php`, `Admin/src/Exports/ProductDataGridExport.php`, `ReportingExport.php`) через `maatwebsite/excel`.
- **PDF-счета**: трейт `packages/Webkul/Core/src/Traits/PDFHandler.php` используется в `Admin/.../Sales/InvoiceController.php` и `Shop/.../Customer/Account/OrderController.php`. Зависимости — `barryvdh/laravel-dompdf`, `mpdf/mpdf`.
- **Штрихкоды**: **не найдены**. `simplesoftwareio/simple-qrcode` используется только для QR двухфакторного входа (`packages/Webkul/Admin/src/Http/Controllers/User/TwoFactorController.php`, `packages/Webkul/User/src/TwoFactorAuthentication.php`). Печати этикеток и сканирования нет.

---

## 5. Безопасность

- **Вход**: guard'ы `admin` и `customer`. Лимит попыток входа в админку — `throttle:5,1` (`packages/Webkul/Admin/src/Routes/web/auth-routes.php:38,49`), у покупателя — `throttle:6,1` (`packages/Webkul/Shop/src/Routes/customer-routes.php:28,66`). Ещё лимиты: `throttle:10,1` на загрузку для поиска по картинке (`store-front-routes.php:97`), лимиты EU Withdrawal (`EUWithdrawalServiceProvider.php:46-50`), `throttle:5,1` на включение 2FA (`Admin/src/Routes/web/rest-routes.php:74`).
- **Двухфакторный вход (2FA)**: только у администраторов. Используется `pragmarx/google2fa`, миграции `2025_09_11_140301_add_two_factor_to_admins.php`, `2026_09_23_120000_add_two_factor_last_used_window_to_admins.php` (защита от повторного использования кода). Без пройденной проверки 2FA нельзя отключить (`Bouncer.php` middleware, комментарий и `routeIs` в `handle()`). У покупателей 2FA не найдено.
- **CSRF**: включён глобально. Исключения: `stripe/*` (`bootstrap/app.php:52-54`) и `withoutMiddleware(PreventRequestForgery::class)` на обратных вызовах платёжных систем (`PayU/src/Routes/web.php:14-26`, `Paypal/src/Http/routes.php:17`, `PhonePe/src/Routes/web.php:12,19`, `Stripe/src/Routes/web.php:18`, `PayGlocal/src/Routes/web.php:16`, Installer).
- **Прокси**: `trustProxies(at: '*')` (`bootstrap/app.php:56`) — доверие любому прокси. Если сервер не за доверенным балансировщиком, IP клиента можно подделать, и лимиты попыток можно обойти.
- **Загрузки файлов**: картинки и видео проверяются по `mimes:` (`Admin/.../Appearance/SectionController.php:252`, `Catalog/AttributeController.php:300`). Импорт ограничен по расширениям и MIME (`Settings/DataTransfer/ImportController.php:98`). Вложения RMA — `mimetypes:` из настройки (`RMA/RequestController.php:161,231`): что разрешено, решает администратор. SVG чистится (`enshrined/svg-sanitize`), HTML — тоже (`stevebauman/purify`).
- **Секреты**: ключи платёжных систем (`webhook_secret` и др.) хранятся в `core_config` через админку (`packages/Webkul/Admin/src/Config/system.php:1008-1041`). Шифрование этих значений в базе не проверял.
- Сессия: `PreventSessionRevival` в группе `web` (`bootstrap/app.php:48-50`).

---

## 6. Тесты

- Фреймворки: **Pest 5** + PHPUnit 13 (`composer.json` require-dev), **Playwright** (`@playwright/test ^1.58.1` в `package.json`).
- Pest: 329 файлов `*Test.php` в `packages/Webkul/*/tests`, ≈ 2 819 вызовов `it(`/`test(` (подсчёт grep). По пакетам: Admin 140, Shop 85, Core 23, FPC 14, Sales 9, Product 9, Checkout 8, Omnibus 6, Stripe 5, Installer 5, DataGrid 5, остальные 1-3. Наборы — в `phpunit.xml`.
- Склад покрыт: `packages/Webkul/Sales/tests/Unit/OrderedInventoryTest.php` (резерв у simple/configurable/bundle, отказ при недостатке), `Admin/tests/Feature/Sales/ShipmentTest.php`, `Admin/tests/Feature/Sales/Orders/OrdersTest.php`, `Shop/tests/Feature/Checkout/{CartTest,CheckoutTest}.php`, `Shop/tests/Feature/Checkout/CouponUsageLimitTest.php`. **Проверок на настоящую параллельность** (два процесса одновременно) не найдено.
- Playwright: 111 файлов `*.spec.ts`, конфиги `packages/Webkul/{Admin,Shop,Installer}/tests/e2e-pw/playwright.config.ts`.
- CI: `.github/workflows/pest-tests.yml` (`vendor/bin/pest --parallel`, стр. 147; база — MySQL 8.0/8.4/9.7 и Postgres 10/14/18), `playwright-tests.yml` (`npm run test:e2e -- --grep "@<locale>"`), `pint-tests.yml`, `translation-tests.yml` (`php artisan bagisto:translations:check`).
- Команды: `composer install && php artisan bagisto:install` (Installer), `vendor/bin/pest --parallel`, `npm install && npx playwright install && npm run test:e2e`. Не запускал.

---

## 7. Подходит ли как витрина для магазина телефонов в Казахстане

- **Валюта KZT**: есть в списке валют установщика (`packages/Webkul/Installer/src/Resources/lang/en/app.php:172,871`). Мультивалютность встроена (`orders.channel_currency_code` и т. д.).
- **Языки**: `ru` — полный перевод (`Shop/src/Resources/lang/ru/app.php` — 1 925 строк, столько же, сколько `en`; `Admin/.../lang/ru` тоже есть). **`kk` нет** в `SupportedLocales` (`packages/Webkul/Core/src/Helpers/SupportedLocales.php:15-37`) и в папках `lang`. Казахский придётся добавлять самим: строку в `SupportedLocales` и полный набор файлов `lang/kk` для Admin, Shop, Installer и пакетов (за этим следит `bagisto:translations:check`).
- **Kaspi / Halyk**: `grep -rni "kaspi\|halyk" packages` — **0 совпадений**. Есть только индийские и международные шлюзы (Stripe, PayPal, Razorpay, PayU, PhonePe, PayGlocal). Kaspi Pay / Kaspi QR / Kaspi Магазин придётся писать отдельным модулем Payment.
- **Каталог телефонов**: Configurable (модель → варианты по памяти и цвету), атрибуты, полнотекстовый поиск через Elasticsearch (`elasticsearch/elasticsearch`), FPC, Sitemap, отзывы, сравнение. Под витрину подходит.
- **Остатки из ERP**: придётся писать синхронизацию через `ProductInventoryRepository::saveInventories` или импорт DataTransfer. Заказы обратно в ERP — через Laravel-события, исходящих вебхуков нет. Без платного REST API можно сделать свой пакет на `sanctum`.
- **Риски**: PHP/Laravel — второй стек рядом с Cloudflare Workers; работа с тенге и НДС (`Tax`) не проверялась; товары, привязанные к IMEI, на витрине будут только счётными.

## 8. Чего нет (сводка поисков)

| Возможность | Результат | Как искал |
|---|---|---|
| IMEI | не найдено | `grep -rniw imei packages app config` |
| Серийные номера | не найдено | `grep -rni serial … | grep -vi serializ` |
| Лицензионные ключи | не найдено | `grep -rniw "license_key\|licence"` |
| Поставщики, закупки | не найдено | `grep -rni supplier`, `purchase_order` |
| Перемещения | не найдено | `grep -rli transfer` (кроме DataTransfer) |
| Инвентаризация, журнал движения | не найдено | просмотр миграций Inventory и Product |
| POS | платное, в коде нет | README «# POS», `composer.json` |
| SaaS-мультиарендность | платное, в коде нет | README, `grep -rni tenant` |
| Права по филиалу | нет | `packages/Webkul/User/src` |
| Гарантия | не найдено | `grep -rni warranty` |
| Штрихкоды | не найдено | `grep -rni barcode` |
| REST/GraphQL в ядре | нет (отдельные пакеты) | `routes/`, `composer.json` |
| Аудит | не найдено | `grep -rniE "audit|activity_log"` |
| Kaspi, локаль `kk` | не найдено | `grep -rni kaspi`, `SupportedLocales.php` |
