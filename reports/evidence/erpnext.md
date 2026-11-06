# ERPNext как основа для «Prime Mobile OS» — статический аудит кода

- Репозиторий: `/home/user/erp-lab/erpnext`, ветка develop, коммит `d64d888659652a3feceb52d79fb8f8cdaa4e996a` (5.11.2026).
- Версия в коде: `erpnext/__init__.py:8` → `__version__ = "17.0.0-dev"`; `pyproject.toml`: `requires-python = ">=3.14"`, `[tool.bench.frappe-dependencies] frappe = ">=17.0.0-dev,<18.0.0"`.
- Метод: только чтение кода. **Ничего не запускалось** — ни тесты, ни сервер. Всё, что про поведение под нагрузкой и про конкурентность, — рассуждение по коду, а не проверка.
- Frappe Framework не клонирован. Всё, что помечено **[Frappe, по знаниям]**, — из общих знаний о Frappe v14–v16, по исходникам в этом аудите не сверялось.
- Обозначения: «есть в коде» = видел функцию/строку; «не найдено» = искал и указываю, где.

---

## 1. Serial No и Serial and Batch Bundle (SABB)

### 1.1 Doctype Serial No — имя записи и уникальность
- `erpnext/stock/doctype/serial_no/serial_no.json`: `"autoname": "hash"`, `"naming_rule": "Random"`. **Это важное отличие от v14/v15**: раньше `name` = сам серийный номер (первичный ключ). В этой ветке v17-dev `name` — случайный хэш, а физический номер лежит в поле `serial_no` (`Data`, `reqd`, `search_index`, `set_only_once`, `no_copy`).
- Уникальность — не глобальная, а **по паре (item_code, serial_no)**:
  - `serial_no.py:315-317` `on_doctype_update()` → `frappe.db.add_index("Serial No", ["item_code","warehouse"])` и `SerialBatchIdentity("Serial No").add_unique_constraint()`.
  - `erpnext/stock/serial_batch_identity.py:27-36` `add_unique_constraint()`: MariaDB — `frappe.db.add_unique(doctype, ["item_code","serial_no"], "unique_item_code_serial_no")`; Postgres — `CREATE UNIQUE INDEX … (lower(serial_no), item_code)`.
  - Поиск без учёта регистра: `_number_key` / `Lower` в `serial_batch_identity.py` (тест `test_legacy_serial_no_lookup_is_case_insensitive`, `test_serial_and_batch_bundle.py:2442`). Регистронезависимость уникального ключа в MariaDB зависит от collation таблицы (utf8mb4_unicode_ci у Frappe по умолчанию — **[Frappe, по знаниям]**).
  - `serial_no.py:79-81` `show_unique_validation_message` → `raise_duplicate()` даёт понятное «Serial No X already exists for Item Y».
- **Последствие для телефонов**: один и тот же IMEI можно завести под двумя разными товарами (iPhone 15 128 ГБ и iPhone 15 256 ГБ) — база не запретит. Для магазина телефонов нужна своя глобальная уникальность IMEI (свой индекс / валидация в своём приложении).
- Поля карточки (`serial_no.json`): `item_code`, `batch_no`, `warehouse` (только для чтения), `purchase_rate` (только чтение — себестоимость единицы), `customer`, `status`, `warranty_period`, `warranty_expiry_date`, `amc_expiry_date`, `maintenance_status`, `company`, `reference_doctype/name`, `posting_date`, `asset`…
- Защита от ручной правки: `serial_no.py:86-107` — нельзя создать серийник сразу со складом (`SerialNoCannotCreateDirectError`), нельзя менять «складские» поля (`STOCK_MANAGED_FIELDS`) вне движения склада (`SerialNoCannotCannotChangeError`). Удаление запрещено, если номер есть в SLE (`on_trash`, 125-137).

### 1.2 Статусы Active / Delivered / Inactive / Consumed / Expired
- Список статусов: `serial_no.json` → `status` = `Active|Inactive|Consumed|Delivered|Expired`.
- Статус вычисляется из движения склада, не руками: `erpnext/stock/serial_batch_bundle.py`
  - `get_serial_no_status(sle)` (стр. 39-51): приход (`actual_qty > 0`) → `Active` и `warehouse = sle.warehouse`.
  - `get_status_for_serial_nos(sle)` (54-69): расход не из закупки → `Delivered`; Stock Entry с целью потребления → `Consumed`; расход по закупке (возврат поставщику) или отмена прихода → `Inactive`.
  - `update_serial_no_status_warehouse()` (537-570): одним `UPDATE tabSerial No SET warehouse=…, status=…, company=…, customer=…` по списку номеров; при `Delivered` ставит `warranty_expiry_date = дата + Item.warranty_period` (561-566), иначе сбрасывает гарантию.
  - Для Stock Reconciliation — отдельно `update_serial_no_status_for_stock_reco` (572).
- Склад `warehouse = NULL` = «не в наличии». Именно по полю `warehouse` дальше проверяется возможность продать.

### 1.3 Проверки «нельзя продать то, чего нет / уже продано»
Все в `erpnext/stock/doctype/serial_and_batch_bundle/serial_and_batch_bundle.py`:
- `validate()` (116-152) — порядок: `validate_serial_and_batch_no`, `validate_duplicate_serial_and_batch_no` (дубль номера в одном документе, 1617), при черновике расхода — `validate_serial_no_status()`.
- `validate_serial_no_status()` (163-180): на сохранении черновика расхода — ищет номера с `warehouse != self.warehouse` → «You cannot outward … as they are either Delivered, Inactive or located in a different warehouse». (Замечание: фильтр `!=` в SQL не поймает строки с `warehouse IS NULL` — NULL не сравнивается; ловит только «на другом складе». Проданный (NULL) отсекается уже на проведении, см. ниже. Это вывод по коду, не проверено.)
- `on_submit()` (1771-1774) → `validate_serial_nos_inventory()` (276-334): для расхода берёт `get_available_serial_nos(...)` с `check_serial_nos=True` и требует, чтобы каждый номер был доступен **именно на этом складе**; иначе `SerialNoWarehouseError` «Serial No X is not present in the warehouse Y» или «…reserved for … via Stock Reservation Entry».
- `get_available_serial_nos(kwargs)` (2678-2758): учитывает резервы (`get_reserved_serial_nos_for_sre`), номера в непроведённых в учёт POS-чеках (`get_reserved_serial_nos_for_pos`, 2965), остаток на дату проводки по SLE (`get_serial_nos_based_on_posting_date`, 2865 — плюс/минус по журналу), и в конце `get_serial_nos_based_on_filters()` (2778).
- `get_serial_nos_based_on_filters()` (2778-2823): `frappe.qb.from_(Serial No)….for_update()` (стр. 2782) — **блокирующее чтение строк Serial No** с условием `warehouse = <склад>`.
- Приход дубля: `validate_serial_nos_duplicate()` (336-395) — на проведении прихода номер, который уже числится на каком-то складе, → `SerialNoDuplicateError` «already present in the warehouse». `allow_existing_serial_no()` (211-245) — повторный приход когда-то выданного номера; **настройка Stock Settings `allow_existing_serial_no` по умолчанию = 1** (`stock_settings.json`), т. е. принять обратно проданный телефон (выкуп/trade-in) можно.
- Отрицательный остаток: у серийных товаров проверка остатка в `stock_ledger.py:1348` (`if (sle.serial_no and …) or not allow_negative_stock`) и `validate_negative_stock` (1716). Но решающая защита серийника — проверка SABB выше (она не зависит от `allow_negative_stock`).
- Возвраты: только номера из исходного документа — `POS Invoice.validate_return_serial_nos` (`accounts/doctype/pos_invoice/pos_invoice.py:532-550`), для DN/SI — `SerialAndBatchBundle.validate_serial_and_batch_no_for_returned` (1472) и `controllers/sales_and_purchase_return.py` (`validate_returned_items` 89, `get_returned_serial_nos` 1092).

### 1.4 Второй идентификатор (IMEI2)
- Поиск `imei` по всему `erpnext/` — встречается только в `locale/*.po` (переводы). **Поля для второго номера нет.**
- SABB-строка (`serial_and_batch_entry`) хранит одно `serial_no`. Карточка Serial No — одно `serial_no`.
- Вариант: Custom Field `imei2` (и `imei1`, если основной номер — заводской serial) на Serial No + свой уникальный индекс + поиск по нему в сканере. Сканер `stock/utils.py:754` `scan_barcode` → `get_barcode_matches` (786) ищет Item Barcode, затем Serial No/Batch по полю номера — по custom-полю он **не ищет**; нужен хук/переопределение (`override_whitelisted_methods` или своя функция в POS). Вывод: IMEI2 = кастомизация, а не готовая функция.

---

## 2. Склад и документы

| Объект | Где | Что важно |
|---|---|---|
| Stock Ledger Entry | `stock/doctype/stock_ledger_entry/`, логика `stock/stock_ledger.py` (3 368 строк) | `make_sl_entries` (236): закрытие периода, отмена, `repost_current_voucher` (336) → `update_entries_after` (переоценка), `update_qty_in_future_sle` + `validate_negative_qty_in_future_sle` (3046) |
| Bin | `stock/doctype/bin/bin.py` | остатки по товар×склад; `update_qty_from_sle` (255) пересчитывает и пишет `frappe.db.set_value`; создание с защитой от гонки `get_or_make_bin` / `_create_bin` (`stock/utils.py:322-345`, savepoint + `UniqueValidationError`), тест `test_bin.py:17 test_concurrent_inserts` |
| Repost Item Valuation | `stock/doctype/repost_item_valuation/` | переоценка задним числом в фоне: `hooks.py` scheduler `run_parallel_reposting` (cron) и `repost_entries` (hourly_maintenance); отмена документа при «In Progress» запрещена (`stock_ledger.py:377 validate_cancellation`) |
| allow_negative_stock | Stock Settings (по умолчанию 0) + флаг у Item; `stock_ledger.py:3189 is_negative_stock_allowed` | POS при глобальном флаге вообще пропускает проверку количества: `pos_invoice.py:416` |
| Stock Reservation Entry | `stock/doctype/stock_reservation_entry/` (2 341 строка, 56 тестов) | включается `enable_stock_reservation` (по умолчанию 0); резерв серийников учитывается при выборе (`get_reserved_serial_nos_for_sre`, `get_serial_no_reservation`) |
| Stock Entry | `stock/doctype/stock_entry/` | `purpose`: Material Issue / Receipt / **Material Transfer** / … / Repack / Disassemble…; типы — `Stock Entry Type` (фикстуры `setup/setup_wizard/operations/install_fixtures.py:86`). Перемещение между филиалами = Material Transfer (есть транзит, `get_transit_package` в `serial_batch_bundle.py:137`) |
| Stock Reconciliation | `stock/doctype/stock_reconciliation/` (65 тестов) | инвентаризация; серийники на складе пересчитываются, отмена делает их Inactive (`test_serial_no.py:49`) |
| Purchase Receipt | `stock/doctype/purchase_receipt/` (178 тестов) | приход с номерами, `purchase_rate` → в Serial No |
| Delivery Note | `stock/doctype/delivery_note/` (118 тестов) | отгрузка |
| Sales Invoice `update_stock=1` | `accounts/doctype/sales_invoice/` | продажа с одновременным списанием |
| POS Invoice | `accounts/doctype/pos_invoice/pos_invoice.py` (1 257 строк) | **сам склад не двигает**: сводится в Sales Invoice при закрытии смены через `POS Invoice Merge Log` (фоновой задачей `enqueue_job`, `pos_invoice_merge_log.py:576,738`); до этого серийник «занят» запросом `get_reserved_serial_nos_for_pos`. Настройка `POS Settings.invoice_type` = Sales Invoice — режим без POS Invoice (`pos_invoice.py:490`) |
| POS Opening / Closing | `accounts/doctype/pos_opening_entry/`, `pos_closing_entry/` | одна открытая смена на профиль и на кассира (`check_open_pos_exists`, `check_user_already_assigned`, 81-95) |
| Возвраты | `is_return` + `return_against`, `controllers/sales_and_purchase_return.py` (`make_return_doc` 605) | нельзя вернуть больше, чем продано (`validate_quantity` 263) |
| Отмена | docstatus 2 → `make_sl_entries` с `is_cancelled`: `set_as_cancel` (`stock_ledger.py:405`) помечает старые SLE, пишутся обратные; статус серийника откатывается (`get_serial_no_status_term` — `Case` по `reference_name`, `serial_batch_bundle.py:72-79`); есть проверка «будущих» движений серийника `check_future_entries_exists` (`serial_and_batch_bundle.py:1048`) |
| Warranty Claim | `support/doctype/warranty_claim/` | поля: serial_no, customer, complaint, warranty_amc_status, resolution…; проверка «номер принадлежит товару» (88) и **только предупреждение**, если номер продан другому клиенту (`warn_if_serial_no_not_delivered_to_customer`, 99) |
| Maintenance | `maintenance/doctype/maintenance_schedule`, `maintenance_visit` | сервисные визиты; из Warranty Claim — `make_maintenance_visit` (147) |
| Гарантийный талон | печатные формы — см. §5 | готового «гарантийного талона» нет; дата гарантии считается сама из `Item.warranty_period` при продаже |

Себестоимость и прибыль: оценка по серийнику (`SerialNoValuation`, `serial_batch_bundle.py:707+`, `get_serial_no_wise_incoming_rate`), отчёты Gross Profit есть в `accounts/report/gross_profit` (**наличие отчёта проверено только по имени каталога — не по коду**). Настройка «оценка по серийнику / по методу товара» — тесты `test_serial_no_wise_valuation_*` (`test_serial_and_batch_bundle.py:2145-2516`).

---

## 3. Целостность и конкурентность

### 3.1 Найденные блокировки (есть в коде)
- Serial No: `get_serial_nos_based_on_filters` — `SELECT … FOR UPDATE` (`serial_and_batch_bundle.py:2782`), вызывается из проверки на проведении (`on_submit` → `validate_serial_nos_inventory`).
- SLE: `get_previous_sle_of_current_voucher` (`stock_ledger.py:2498`, `.for_update()` ~2532) и выборка SLE того же момента (~2489) — блокирует последнюю строку журнала товар×склад; будущие SLE для переоценки — `get_sle_after_datetime(... for_update=True)` (2384).
- Bin: блокировки строки Bin на обычной проводке **не найдено** (искал `for_update`/`FOR UPDATE` по `stock/`, `controllers/`; `frappe.get_doc("Bin", …, for_update=True)` есть только в `manufacturing/.../production_plan.py:490` и патче). Остаток в Bin пересчитывается из журнала (`update_qty_from_sle`), т. е. сериализация идёт через блокировку SLE.
- SABB-партии: `get_available_qty_from_stock_ledger` / `_from_sabb` с `.for_update()` (2005, 2031).
- Документ: Frappe проверяет `modified` при сохранении (`check_if_latest`) — защита от одновременной правки одного документа **[Frappe, по знаниям]**. От двух разных документов с одним серийником она не защищает.

### 3.2 Две одновременные продажи одного IMEI (рассуждение, не проверено)
- **Delivery Note / Sales Invoice с update_stock**: транзакция T1 на проведении берёт `FOR UPDATE` на строку Serial No и в той же транзакции ставит `warehouse=NULL, status=Delivered` (`update_serial_no_status_warehouse`). T2 доходит до того же `SELECT … FOR UPDATE … WHERE warehouse = X` и ждёт. После фиксации T1 блокирующее чтение в InnoDB видит последнюю зафиксированную версию — `warehouse IS NULL`, строка не проходит фильтр → T2 падает с `SerialNoWarehouseError`. По коду — защищено. Условие: обе продажи с одного склада; если склады разные, T2 и так не пройдёт.
- **POS Invoice (режим по умолчанию)**: POS Invoice склад не трогает до закрытия смены. «Занятость» серийника определяется **обычным (неблокирующим) чтением** проведённых POS Invoice в `get_reserved_serial_nos_for_pos` (2965) **до** блокирующего запроса. Строку Serial No T1 не меняет (склада нет), значит после ожидания T2 видит строку с прежним складом и проходит. В REPEATABLE READ снимок T2 для списка «занятых» взят до фиксации T1. **Вероятная гонка: два кассира одновременно продают один IMEI через POS — оба чека проведутся**, ошибка вылезет только при сведении смены (Sales Invoice). Тест `test_pos_invoice.py:545 test_serialized_item_transaction` проверяет только последовательный случай. Это надо подтвердить нагрузочным тестом; обход — режим POS «Sales Invoice» (`POS Settings.invoice_type`) или своя блокировка.
- Тестов на настоящую параллельность (потоки, два соединения) для серийников **не найдено** (искал `threading|concurren|ThreadPool` в `test_*.py`: есть только `test_bin.py` — вставки Bin, `test_stock_ledger_entry.py:1771,1840` — порядок SLE «как при одновременной проводке», моделируется последовательно).
- Идемпотентность API: ключа идемпотентности для POST `/api/resource` нет **[Frappe, по знаниям]**; повтор запроса создаст второй черновик. Повтор `submit` уже проведённого документа отклоняется по docstatus. Для мобильной кассы с плохой связью нужен свой ключ (например, поле с UUID + уникальный индекс).

---

## 4. Мультикомпания и мультиарендность

- `Company` — поле почти во всех транзакциях; склады, счета, центры затрат — по компании. Межкомпанийные перемещения есть (`test_serial_no.py:107-192 test_inter_company_transfer*`).
- Новое в v17-dev: doctype **Company Restriction** (`stock/doctype/company_restriction/company_restriction.py`, таблица с полем `company`) — ограничивает Item/Customer/Supplier компаниями и наследует ограничение на документы: `hooks.py:355-377` (`permission_query_conditions` и `has_permission`, в том числе `"*"` → `get_inherited_permission_query_conditions`). Исключения — `COMPANY_RESTRICTION_EXEMPT_DOCTYPES` (там **Serial No и Serial and Batch Bundle** — серийники компанией не ограничиваются).
- User Permission (Frappe) — ограничение пользователя записями (Company, Warehouse) **[Frappe, по знаниям]**: работает на уровне запросов, легко ошибиться в настройке, отчёты и API с `ignore_permissions` его обходят.
- **Вывод для SaaS**: «много компаний в одной базе» — это одна организация с филиалами, а не изоляция чужих бизнесов. Настоящая изоляция у Frappe — **multi-site**: один сайт = своя база MariaDB, общий код bench, маршрутизация по домену **[Frappe, по знаниям]**. Для сотен магазинов: сотни баз, миграции (`bench migrate`) по каждой, общий Redis/воркеры; это делает Frappe Cloud. Компания внутри сайта — для филиалов одного магазина; филиал = Warehouse (+ POS Profile), а не Company.
- Уникальность IMEI по (item, serial) действует внутри сайта — между магазинами-сайтами пересечений нет (это нормально).

---

## 5. Интеграции

- REST: `/api/resource/<DocType>` (CRUD), `/api/method/<путь>` (whitelisted-функции), v2 `/api/v2/...` в новых Frappe; токены API key/secret, OAuth2 **[Frappe, по знаниям]**.
- Webhooks: doctype `Webhook` во Frappe (события документа → HTTP, с HMAC-подписью) **[Frappe, по знаниям]**.
- Импорт данных: Data Import (Frappe); у Serial No `allow_import: 1` (`serial_no.json`); у SABB свой CSV-импорт номеров — `download_blank_csv_template` / `read_serial_batch_csv` (`serial_and_batch_bundle.py:2143-2238`).
- Печать: Print Format (Jinja → HTML → PDF; wkhtmltopdf или Chrome-рендер в новых Frappe **[Frappe, по знаниям]**). Готовые: `accounts/print_format/pos_invoice_{bordered,classic,modern,…}`, `sales_invoice_*`, `sales_invoice_return`, `credit_note`. Отдельного «гарантийного талона» нет — делается своим Print Format.
- Штрихкоды: `Item Barcode` (типы EAN, EAN-13, UPC, GTIN, CODE-39…, `item_barcode.json`), сканер `stock/utils.py:754 scan_barcode` (кэш 120 с), в POS — `selling/page/point_of_sale/point_of_sale.py:347 search_for_serial_or_batch_or_barcode_number`. Зависимость `barcodenumber` (проверка контрольной цифры).
- Казахстан: в `regional/` нет KZ (есть australia, italy, south_africa, turkey, uae, us). Фискализация ККМ/ОФД, ЭСФ — **не найдено** (искал `kazakh|KZT` — только `country_wise_tax.json` и одно json). Перевод `locale/ru.po` есть; казахского (`kk`) — нет.

---

## 6. Безопасность

- Роли и права — в JSON doctype (`permissions`). Пример Serial No: Stock User/Manager, Sales User, Purchase User, Item Manager (`serial_no.json`); Sales User может создавать/писать Serial No. Права уровня полей (`permlevel`), Role Profile, User Permission **[Frappe, по знаниям]**.
- Двухфакторный вход (TOTP/SMS/email), политика паролей, блокировка после неудачных попыток — System Settings Frappe **[Frappe, по знаниям]**.
- CSRF: Frappe проверяет `X-Frappe-CSRF-Token` для сессионных POST; вызовы с токеном API — без CSRF **[Frappe, по знаниям]**.
- Rate limit: `frappe.rate_limiter.rate_limit` — в ERPNext использован лишь в 2 местах (`www/book_appointment/index.py:55,115`, `templates/utils.py:13`); глобальный лимит запросов — настройка сайта `rate_limit` в site_config **[Frappe, по знаниям]**. 11 гостевых методов (`allow_guest`) в ERPNext.
- Экранирование: везде `escape_html` в сообщениях об ошибках с номерами (SABB, SerialBatchIdentity). В репозитории каталог `semgrep/` с правилами и `SECURITY.md`.
- Проверка прав в whitelisted-функциях: `frappe.has_permission("Item","select",…, throw=True)` в `auto_fetch_serial_number`, `get_pos_reserved_serial_nos` (`serial_no.py:214,256`), `scan_barcode`.

---

## 7. Тесты

- Всего в `erpnext/`: 582 файла `test_*.py`, ≈7 970 строк `def test_` (подсчёт grep, не запуск).
- По теме:
  - `stock/doctype/serial_no/test_serial_no.py` — 13 тестов: нельзя создать со складом (`test_cannot_create_direct`, 31), отмена инвентаризации → Inactive (49), возврат поставщику → Inactive (67), нельзя править складские поля (89), межкомпанийные перемещения (107-192), гарантия/AMC (411-508).
  - `test_serial_and_batch_bundle.py` — 78: доступность на момент проводки (`test_serial_availability_at_posting_cutoff`, 109), повторный приход выданного (160), один новый номер в двух строках прихода — отказ (`test_same_new_serial_on_two_rows_of_one_receipt_is_refused`, 2687, `SerialNoDuplicateError` 2709), дубль в строках (3001), расход не создаёт номера (89), оценка по номеру.
  - `test_delivery_note.py` — 118: `test_serialize_status` (358: расход номера, которого нет на складе → `ValidationError`), `test_serial_no_status` (2355: Active → Delivered), возвраты серийных (1020, 2808), гарантия (2923).
  - `accounts/doctype/pos_invoice/test_pos_invoice.py` — 47: **двойная продажа** — `test_serialized_item_transaction` (545: второй POS-чек с тем же номером → `ValidationError`), `test_delivered_serialized_item_transaction` (596: номер продан Sales Invoice → POS-чек не проводится), `test_delivered_serial_no_case` (1021), `test_invalid_serial_no_validation` (647).
  - `test_purchase_receipt.py` — 178: `test_duplicate_serial_nos` (274, `SerialNoDuplicateError`), `test_serial_no_warehouse` (410).
  - `test_stock_entry.py` 182, `test_stock_reconciliation.py` 65, `test_stock_reservation_entry.py` 56.
- Все сценарии двойной продажи — **последовательные**. Параллельных — не найдено (§3.2).

---

## 8. Лицензия и товарный знак

- `license.txt` — GNU GPL v3 (`hooks.py:8 app_license`). GPL-3 не содержит «сетевого» условия (это AGPL): SaaS без передачи программы пользователям не обязывает публиковать изменения. Но если отдавать клиентам код (self-hosted, мобильное приложение со встроенным GPL-кодом, «коробка») — исходники своих изменений и производных под GPL. Своё приложение Frappe, импортирующее ERPNext, по позиции FSF — вероятно производное (юридическая оценка, не проверка).
- Frappe Framework — MIT **[Frappe, по знаниям]** (в Frappe v15+ лицензия MIT; сверить с репозиторием frappe перед решением).
- `TRADEMARK_POLICY.md`: «ERPNext» и логотип — знаки Frappe Technologies. Без разрешения нельзя использовать «ERPNext» в названии продукта, сервиса, домена, компании и в рекламе (AdWords); коммерческому проекту разрешение не дают; можно писать «основано на ERPNext» для описания. **Ребрендинг обязателен**: заменить `app_title`, `app_logo_url` (`hooks.py:2,10`), логотипы, тексты «ERPNext» в интерфейсе и письмах; убрать впечатление аффилированности.

---

## 9. Эксплуатация

- Стек: Python ≥ 3.14 (`pyproject.toml`), Frappe 17-dev, MariaDB (поддерживается и Postgres — ветки `db_type == "postgres"` в коде), Redis (кэш, очереди RQ, socket.io), Node.js (сборка ассетов, realtime), bench (CLI), nginx + supervisor/gunicorn, воркеры RQ, планировщик **[стек — частично по знаниям Frappe]**. Фронт `banking` на отдельной сборке (`pyproject.toml [tool.bench.assets]`).
- Ресурсы (оценка, не замер): минимальный сайт — 2 vCPU / 4 ГБ RAM; на multi-tenant bench каждая база MariaDB ~сотни МБ схемы (≈1 000+ таблиц); фоновые переоценки (`Repost Item Valuation`, cron/hourly) тяжёлые при правках задним числом.
- Темп обновлений: develop живой (коммит 5.11.2026), мажорные версии примерно раз в год (v14 2022, v15 2023, v16, сейчас 17-dev) **[по знаниям]**; патчи миграций — `erpnext/patches/v*_0/`. В этой ветке поменялась сама модель Serial No (имя = хэш вместо номера) — пример крупных изменений между мажорами, своё приложение придётся переносить.
- Кастомизация без форка: своё приложение Frappe с `hooks.py` — `doc_events` (валидации до/после submit), `override_doctype_class`, `extend_doctype_class` (ERPNext сам использует, `hooks.py:99`), `override_whitelisted_methods` (101), `permission_query_conditions`/`has_permission` (355-377), `doctype_js`, fixtures (Custom Field, Property Setter), Print Format, Workspace. IMEI2, глобальная уникальность IMEI, гарантийный талон, блокировка POS-продажи — всё делается в своём приложении.

---

## 10. Итог для «Prime Mobile OS»

Сильно: зрелый учёт серийников (статус из журнала, гарантия от продажи, возвраты только своих номеров, блокировка строки Serial No на проведении DN/SI), склады-филиалы, перемещения, инвентаризация, POS со сменами, себестоимость по номеру, тысячи тестов.

Слабо / доработать:
1. Уникальность номера — по товару, не глобальная; второго IMEI нет.
2. POS Invoice: вероятная гонка двойной продажи при одновременной проводке (по коду, не проверено).
3. Мультиарендность — только multi-site (база на магазин) → эксплуатация сотен баз.
4. Нет Казахстана: ККМ/ОФД, ЭСФ, казахский язык.
5. Тяжёлый стек и годовые мажоры с ломающими изменениями (Serial No в v17-dev).
6. Бренд «ERPNext» использовать нельзя; GPL-3 для своего кода, если его распространять.
