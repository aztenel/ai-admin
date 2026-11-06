# SFON / Smartfon System — исследование по открытым источникам

Дата: 05.11.2026. **Доступа к учётной записи нет** (владелец доступ не давал). Вход, регистрация, подбор паролей, вызовы данных API, POST-запросы — не делались. Только GET публичных страниц, публичных статических файлов (JS/HTML фронтенда), документации OpenAPI и поиск в интернете.

Сырые файлы: `/tmp/claude-0/-home-user-ai-admin/6ab38e8a-d97e-5c22-a717-7d4aed177d69/scratchpad/sfon/`
- `openapi.json` — спецификация Open API (OpenAPI 3.0.1), 24 691 байт
- `https___open-api.sfon.kz_open-api_v3_api-docs_swagger-config` — swagger-config
- `raw_sfon.kz`, `landing/main.js`, `landing/strings.txt` — лендинг sfon.kz
- `web/*.js` (120 файлов, 6 МБ), `all_web_dec.js`, `ru_strings.txt` (3 672 строки интерфейса), `internal_api.txt`, `api_paths.txt` — фронтенд web.sfon.kz («SmartfonNext»)
- `raw_shop.sfon.kz` — витрина shop.sfon.kz

Уровни доказательства, которые используются ниже:
- **[OpenAPI]** — публичная документация Open API (то, что внешней системе реально доступно по ключу).
- **[Лендинг]** — маркетинговый текст sfon.kz.
- **[Фронтенд]** — строки интерфейса, маршруты и вызовы внутреннего API из публичного JS web.sfon.kz. Это сильное указание, что функция есть в продукте, но **не проверено вживую** и внутренний API наружу не документирован (нужен вход пользователя, Bearer-токен OAuth2).
- **[Поиск]** — результаты поиска (Instagram, 2GIS, Яндекс Карты).

---

## 1. Что это за продукт

- Название: **Smartfon System** (sfon.kz), веб-приложение **SmartfonNext** (web.sfon.kz), витрина **SFS Store** (shop.sfon.kz). [Лендинг] `<title>Smartfon System</title>`, meta: «Самая заточенная программа для бизнеса в сфере мобильной электроники».
- Для оптовой и розничной торговли мобильной электроникой и аксессуарами: «Программа заточена для оптово и розничной торговли в сфере мобильной электроники и аксессуаров». Обкатана в сети магазинов Kop Kop Store (@kopkop.kz): «Все протестировано в действующем магазине — 3 филиала розничной и оптовой продажи». [Лендинг, Instagram @smartfon.system — 2.1K подписчиков]
- Два модуля (режима): **Электроника** (`systemType=SFON`, «учёт по уникальности товара» — поштучно по IMEI) и **Аксессуары** (`systemType=ACCS`, «расчёт по количеству товара»). [Лендинг] «Модуль для техники с системой расчета по уникальности товара / Модуль для аксессуаров с системой расчета по количеству товара»; [Фронтенд] `getSystemType(){return mode==='admin'?'SFON':'ACCS'}`.
- Контакты: Астана, ул. Арай 29а, офис 5, 4 этаж (лендинг); Яндекс Карты — ул. Сыганак 54А; +7 700 901 90 01; support@sfon.kz; 2GIS https://2gis.kz/astana/firm/70000001084028244 (рубрика «Программное обеспечение»). Видео-обзор: https://www.youtube.com/embed/_cdCY-tcsdc.
- Технологии [Фронтенд]: Angular + NG-ZORRO (Ant Design), сканер штрихкодов камерой (zxing-wasm), ApexCharts, jsPDF. Серверы: `https://web.sfon.kz/sfon-api` (основное API), `/auth_server` (OAuth2), `/reports-api`, `/v2/assistant-api` (ИИ-ассистент), `https://shop.sfon.kz/im-api` (интернет-магазин), `/fileserver`. Есть `dev.shop.sfon.kz`, `old.web.sfon.kz`, `dev.open-api.sfon.kz`.

---

## 2. Open API (open-api.sfon.kz) — получено полностью

- Swagger UI: https://open-api.sfon.kz/open-api/swagger-ui/index.html
- Конфиг: https://open-api.sfon.kz/open-api/v3/api-docs/swagger-config → `{"url":"/open-api/v3/api-docs", ...}`
- Спецификация: **https://open-api.sfon.kz/open-api/v3/api-docs** (OpenAPI 3.0.1, `info.title: "SFON Open API"`, `version: v1`), сервер `https://open-api.sfon.kz/open-api`.
- Описание: «API для интеграции внешних систем с учётной системой SFON: каталог товаров в наличии, справочники и магазины компании. **Только чтение.**»
- **Авторизация:** `securitySchemes.ApiKeyAuth` — `type: apiKey`, `in: header`, `name: X-API-Key`. Глобально для всех операций. «Ключ привязан к компании и к конкретной внешней системе. Он выдаётся в настройках компании в SFON и имеет срок действия. Компания определяется только ключом… Храните ключ на сервере и не передавайте его в браузер». Ключ вида `sfon_...`.
- Ошибки — единый `ApiError {timestamp, status, code, message, path}`; коды: 401 `API_KEY_MISSING|API_KEY_INVALID|API_KEY_DISABLED|API_KEY_EXPIRED|COMPANY_INACTIVE`; 400 `BAD_REQUEST|INVALID_PARAMETER|INVALID_PAGE|INVALID_PAGE_SIZE`; 404 `NOT_FOUND`; 429 (лимит на шлюзе, величина не указана); 500 `INTERNAL_ERROR`.
- Пагинация: `page` с 0, `size` 1–100 (по умолчанию 20); ответ `content, page, size, totalElements, totalPages, last`.
- Фото: `url` открывается без авторизации (`https://shop.sfon.kz/storage/...`); новые — фото по модели и цвету, б/у — фото экземпляра.
- Актуальность: «Данные читаются с реплики учётной базы и могут отставать от кассы на несколько секунд».

### 2.1. Теги и все эндпоинты (10 операций)

| Тег | Метод | Путь | operationId | Параметры | Ответ 200 |
|---|---|---|---|---|---|
| 1. Компания | GET | `/v1/company` | getCompany | — | `CompanyFullDto` (реквизиты, настройки витрины: логотипы base64, **текст гарантийного талона**, список магазинов; `id` магазина = `storeId` в поиске) |
| 2. Товары | POST | `/v1/products/search` | search | query `page`, `size`; тело `ProductFilterCondition` (можно `{}`) | `PageResponseProductGroupDto`. Товары **в наличии** (не проданные, не удалённые, не скрытые с витрины), сортировка по цене по убыванию. NEW — строка на группу «модель+цвет+память+RAM+магазин», `count`, `averagePrice` = минимальная цена группы. OLD — строка на экземпляр (IMEI): своя цена, `batteryState`, `year`, `description`, `productId` |
| 2. Товары | GET | `/v1/products/old/{productId}` | getOldProduct | path `productId` (int64) | `DetailProductInfoIM`: `productInfo`, `oldAlternativeProducts`, `modelCharacterValueList` |
| 2. Товары | GET | `/v1/products/new/{productTypeValue}/{familyValue}/{modelValue}` | getNewProduct | path тип/семейство/модель; query `memoryValue`, `colorValue`, `ramValue`, `searchType` = `ID` (по умолч.) \| `CODE` | `DetailProductInfoIM`: группа + `alternativeProductsByColor`, `alternativeProductsByMemory`, характеристики |
| 3. Справочники | GET | `/v1/dictionaries/product-types` | getProductTypes | query `state` NEW\|OLD | схема ответа не описана (с фото типа) |
| 3. Справочники | GET | `/v1/dictionaries/product-types/{productTypeId}/families` | getFamilies | path `productTypeId`, query `state` | не описана (с фото семейства) |
| 3. Справочники | GET | `/v1/dictionaries/families/{familyId}/models` | getModels | path `familyId`, query `state` | не описана (с фото модели) |
| 3. Справочники | GET | `/v1/dictionaries/memories` | getMemories | — | не описана |
| 3. Справочники | GET | `/v1/dictionaries/rams` | getRams | — | не описана |
| 3. Справочники | GET | `/v1/dictionaries/colors` | getColors | — | не описана |

POST `/v1/products/search` — единственный POST, но это чтение (поиск). Мы его не вызывали.
У справочников в спецификации описаны только ответы 401/500 — форма 200-ответа неизвестна (вероятно `id, code, name…`, не подтверждено).
Иерархия справочников: «тип товара → семейство → модель»; цвет, память, RAM — плоские; скрытие с витрины — отдельно для NEW и OLD.

### 2.2. Модель данных Open API (все схемы)

- **ProductFilterCondition** (required: `state`): `state` NEW|OLD; `storeId`; `productTypeId`; `productFamilyIds[]`; `modelIds[]`; `colorIds[]`; `memoryIds[]`; `ramIds[]`; `actualPriceFrom`/`actualPriceTo`; `yearFrom`, `batteryFrom` (% аккумулятора, только OLD); `description`.
- **ProductGroupDto**: магазин — `storeName, storeAddress, storeAddressLink, storeTelephone, storeWhatsapp`; модель — `modelId, modelName, modelCode`; `productTypeName/Code`, `familyName/Code`, `ramName/Code`, `memoryName/Code`, `colorName/Code`; `count` (int64), `averagePrice`, `oldPrice` (double; цена может быть `null`); `photos[]`; `description`; `state`; `batteryState` (int, %); `year`; `productId` (int64, только OLD).
  - **IMEI/серийный номер в Open API не отдаются**: полей `imei`, `imei1/imei2`, `serial` нет; б/у экземпляр идентифицируется только `productId`.
  - **Закупочной цены, себестоимости, поставщика, статуса продажи нет** — только витринная цена (`averagePrice`, `oldPrice`).
- **DetailProductInfoIM**: `productInfo`, `alternativeProductsByColor[]`, `alternativeProductsByMemory[]`, `oldAlternativeProducts[]`, `modelCharacterValueList[]`.
- **ModelCharacterValueDto**: `id`, `characterType` (DicCharacterTypeDto), `model` (DicModelDto), `characterValue`.
- **DicCharacterTypeDto**: `id, code, companyId, nameRu, productTypeId, dataType` (STRING|NUMBER), `isDeleted`.
- **DicModelDto**: `id, createdDate, code, nameEn, nameKz, nameQq, nameRu, familyId, companyId`.
- **Photo**: `id, url, attachmentPath, sourceType` (PRODUCT_TYPE|FAMILY|MODEL|PRODUCT), `sourceId, property` (для фото модели — название цвета).
- **CompanyFullDto**: `companyDto`, `siteSettingsDto`, `stores[]`.
- **CompanyDto**: `id, createdDate, companyName, uniqueLoginSuffix, email, telephone, ownerId, localCurrencyId, address, active, preferredProductState` (NEW|OLD).
- **SiteSettingsDto** (имена полей — русские фразы): «Логотип в заголовке сайте в формате base64», «Логотип в документах…», «…для аксессуаров», «Логотип в ценниках…», «Текст гарантийного талона».
- **StoreDto**: `id, storeName, address, addressLink, telephone, telephoneWhatsapp, isHideImNew, isHideImOld`.
- **PageResponseProductGroupDto**, **ApiError** — см. выше.

**Вывод по Open API:** это API **витрины/каталога остатков**, а не ERP-API. Нет продаж, приёмок, возвратов, перемещений, клиентов, поставщиков, долгов, кассы, отчётов, вебхуков. Записи нет. Подходит для: бот отвечает «есть ли iPhone 15 128 ГБ в наличии, сколько стоит, в каком магазине», показ фото, характеристики, б/у с % аккумулятора.

### 2.3. Как выдаётся ключ [Фронтенд]
Раздел «Настройки → Интеграции» (`/settings/integrations`, только роль `SUPER_ADMIN`): `GET /company-integrations`, `GET /company-integrations/{id}/api-key` (показ ключа, «Ключ скопирован в буфер обмена»). Создание/активация/деактивация/перевыпуск ключа — у системного менеджера SFON (`/system-manager/companies/{id}/integrations`, `/activate`, `/deactivate`, `/regenerate-key`). Т. е. ключ создаёт SFON, владелец компании только смотрит/копирует. Подсказка в форме: «Например: 1С Бухгалтерия, сайт, Kaspi» (имя внешней системы, `clientSystemName`).

---

## 3. Внутренний API (только по фронтенду, не документирован, нужен вход)

Вход: OAuth2 password grant `POST https://web.sfon.kz/auth_server/oauth/token` (Basic-авторизация клиента фронтенда зашита в публичный JS — здесь не воспроизводится), дальше `Authorization: Bearer <token>`. Для внешней интеграции это **неприменимо** без учётной записи и согласия SFON; использовать не рекомендуется.

Найденные пути (база `${api}` = `https://web.sfon.kz/sfon-api`), сгруппировано:
- Товары (электроника): `GET /product/{id}`, `POST /product` (оприходование), `PUT /product`, `PUT /product/update-info`, `GET /product/find-by-imei?imei=`, `GET /product/find-by-code/{code}`, `GET /product/code`, `POST /product/filter?page&size&sort`, `/product/filter-detail`, `POST /product/balance/filter`, `PUT /product/{id}/stock`, `GET /product/price/pdf/{id}` (ценник PDF), `GET /product-flow-history/{id}` (история движения экземпляра), `/price-change-info/{id}`, `/actual-price`, `/actual-price/find-for-post`, `PUT /changePrice/...`.
- Приёмка: `/product-posting/filter`, `/product-posting/parent/{id}`, `/product-posting/update-buy-price`.
- Продажа: `POST /sale/new-sale`, `GET /sale/{id}`, `/sale/filter`, `GET /sale/public/{token}` (публичный электронный документ), `/sale/change-course-value/{id}`, `/sale/change-course-value-bulk/{id}`.
- Возвраты: `/returns/parent/{id}`; аксессуары — `/accessories/product-return`.
- Перемещения: `/product-move/create`, `/accept/{id}`, `/reject/{id}/{…}`, `/cancel/{id}`, `/filter`, `/parent/{id}`.
- Ревизия: `/revision-light/product`, `/accessories/revision`.
- Аксессуары: `/accessories`, `/accessories/product/{id}`, `/accessories/product-posting`, `/product-sale`, `/product-move`, `/product-category`, `/product-position/balance`, `/position/changeQnt/...`.
- Контрагенты: `/person/allPersons?type=CLIENT|PROVIDER`, `POST/PUT /person?type=`, `/clients/filter`.
- Долги: `/duty/client-store`, `/duty/provider`, `/duty/increase-client-debt`, `/duty/increase-provider-debt`, `/duty/repayment-client-with-store`, `/duty/repayment-with-provider`, отмены `/duty/cancel-*`, `/total_duty/`.
- Деньги: `/cash-balances/*` (внесение, изъятие, перевод в/из центральной кассы, история, отмена операции с причиной), `/non-cash-accounts/*`, `/non-cash-operations/*`, `/expenses/*`.
- Бонусы и SMS: `/clients/unactivated-bonuses`, `/clients/send-bonus-usage-confirmation-code`, `/clients/validate-bonus-usage-confirmation-code`, `/clients/promotion-bonus`, `/client-bonus-request`, `/companies/bonus-settings`, `/sms-service/create-mass-sms-campaign`, `/sms-service/send-campaign`, `/sms-service/short-link`.
- Пользователи: `/user/allUsers`, `/user/filter`, `/user/{id}/access`, `/set-access`, `/set-profit-percentage`, `/user/print-fast-login-barcode/...`, `/user-sale-data`.
- Справочники: `/dictionary/allDicts?type=PRODUCT_TYPE|EXPENSE_TYPE|SOURCE_TYPE|CURRENCY|DUTY_TYPE`, `/dictionary/allDictsByReference/{id}?type=FAMILY|MODEL`, `/api/admin/character-types`, `/api/admin/model-character-values`.
- Отчёты (`/reports-api`): `POST /sales/data`, `POST /sales/xlsx`, `POST /situation-business`.
- Журнал: `/journal/records?module=`, `/journal/user/{id}?module=`.
- Компания/витрина: `/site-settings/warranty`, `/site-settings/{id}/notifications/enable|disable`, `/site-settings/{id}/whatsapp/notifications/enable|disable`, логотипы, `/display/{productType|family|model|store}/...`, `/im-settings/{id}/preferred-product-state`, `/companies/announcement`.
- Управление SaaS (роль SYSTEM_MANAGER): `/system-manager/companies/{id}/subscription-history`, `/issue-subscription`, `/update-max-store-count`, `/refill-sms-balance`, `/store-limit-history`.

---

## 4. Функциональные области

Формат: подтверждено? · источник · процесс · вручную · можно автоматизировать · ограничения.

### 4.1. Товары и категории
- **Подтверждено.** [OpenAPI] иерархия «тип → семейство → модель» + цвет/память/RAM, характеристики модели (`ModelCharacterValueDto`, тип STRING/NUMBER), фото. [Фронтенд] «Справочник» (`/settings/dictionaries`), «Характеристики» (`/admin/store-management/product-characteristics`), у аксессуаров — категории (`/product-category`), `manufacturerId`, `productCategoryId`.
- Процесс: справочники ведёт компания (`companyId` в `DicModelDto`), названия на ru/en/kz/qq.
- Вручную: заведение моделей, характеристик, фото.
- Автоматизировать: чтение каталога через Open API для бота/сайта.
- Ограничения: Open API только читает; схемы ответов справочников не описаны.

### 4.2. IMEI1/IMEI2 и серийные номера
- **Подтверждён один код на единицу — «IMEI / Серийный».** [Фронтенд] поле формы `imei`; строки «IMEI / Серийный», «Серийный номер или IMEI», «Введите корректный IMEI (минимум 8 символов)», «IMEI может содержать только латинские буквы, цифры и символы: - _ / : |», «Сервер отклонил партию, так как некоторые IMEI уже зарегистрированы на складе или проданы» (уникальность), `GET /product/find-by-imei?imei=`, сканирование камерой («Наведите рамку на штрихкод IMEI или серийного номера»).
- **IMEI2 — не подтверждено из открытых источников** (ни `imei2`, ни «IMEI 2» в 6 МБ фронтенда не найдено; есть только одно поле `imei`). Отдельного поля серийного номера тоже нет — то же поле.
- Open API IMEI **не отдаёт** вообще.
- Вручную: ввод или скан IMEI при приёмке, продаже, перемещении, ревизии.

### 4.3. Приёмка / закупка
- **Подтверждено.** [Лендинг] «Быстрое оприходование товара», «Возможность просмотра историй приемки». [Фронтенд] «Добавить товар» (`/warehouse/add-product`), «История приемки» (`/warehouse/postings`), «Оприходование партии устройств на склад, серийные номера (IMEI) и себестоимость», шаги «2. Поставка, себестоимость и состояние», «3. Сканирование или ввод IMEI / Serial Number»; буферная таблица партии; поля `provider`, `costPrice`, `actualPrice`, `suggestedPrice`, `currencyId`, `state` (NEW/OLD), `batteryState`, `year`, `isDuty`/`partDuty` (приёмка в долг поставщику); правка закупочной цены задним числом `/product-posting/update-buy-price`. Аксессуары — приёмка количеством (`/accessories/warehouse/acceptance`), «Отчет о приемке товаров.xlsx». Видео базы знаний №4 «Как оприходовать товар: Электроника».
- Вручную: параметры устройства, поставщик, себестоимость, IMEI (скан).
- Автоматизировать: через открытые источники — нет (нет API записи, нет импорта).
- Ограничения: импорт приёмки из файла — не подтверждено.

### 4.4. Продажи и возвраты
- **Подтверждено.** [Лендинг] «Быстрая продажа товара», «Быстрый возврат товара», «просмотр историй продажи». [Фронтенд] «Продажа» (`/pos`), «Заказы» (журнал чеков), «Возврат товара», `POST /sale/new-sale`; продажа: скан IMEI → корзина → клиент → способ оплаты → печать чека (видео №5). Возврат: полный и «Частичный возврат», «Оформить возврат по чеку», выплата «Наличными из кассы» / «Безналичный счет», причина, перерасчёт бонусов. Trade-In: «Добавить Trade-In в зачет (F8)», «Зачет стоимости Trade-In» (видео №6). Статусы экземпляра: `YES` «В наличии», `SOLD` «Продано», `BRON` «Бронь».
- Ограничения: Open API продаж не отдаёт.

### 4.5. Остатки по филиалам
- **Подтверждено.** [OpenAPI] `storeId` в фильтре, магазин в каждой строке поиска, `count` для новых; `StoreDto`. [Фронтенд] `/product/balance/filter`, «Оценка склада в себестоимости», «Аналитика склада», «Отчеты по складу».
- Автоматизировать: наличие по магазинам — через Open API (без себестоимости). Данные — с реплики, задержка «несколько секунд».

### 4.6. Перемещения
- **Подтверждено.** [Лендинг] «Перемещение товара между магазинами». [Фронтенд] «Перемещение товара», «Подтверждение перемещения»; накладная перемещения: создать → магазин-получатель принимает/отклоняет («Накладная успешно создана. Ожидается подтверждение приёмки в магазине…»), отмена; статусы `PENDING/ACCEPTED/REJECTED/CANCELED`; «Накладной лист № ….pdf».
- Ограничения: в Open API нет; товар в пути, вероятно, не в наличии на витрине (не подтверждено).

### 4.7. Поставщики и клиенты
- **Подтверждено.** [Фронтенд] «Контрагенты» (`/settings/counterparties`), `person?type=CLIENT|PROVIDER`, поля `firstName, lastName, middleName, telephone, codeCountry, email, address`; источник клиента — справочник `SOURCE_TYPE` «Каналы поступления клиентов и лидов»; «При безналичной оплате обязательно выберите клиента».
- Ограничения: клиентская база через Open API недоступна.

### 4.8. Накладные / чеки / гарантийные документы
- **Подтверждено.** [Лендинг] «Автоматический гарантийный лист для товара», «Формирование чека и накладного». [OpenAPI] `SiteSettingsDto` «Текст гарантийного талона», логотипы для документов и ценников. [Фронтенд] «Редактор талонов» («Загружен стандартный шаблон гарантии по закону РК», «Образец талона (A4)»), «Гарантийный талон № ….pdf», «Распечатать кассовый чек», «Печать чека / талона», ценники PDF; электронный документ по публичной ссылке `/e-public-document/:token` («Ссылка на документ доступна клиенту по SMS/WhatsApp»); «Отправка чеков, бонусов и информации о гарантии после оформления продажи».
- Вручную: текст гарантии (редактор), печать.

### 4.9. Закупочные цены и прибыль
- **Подтверждено (внутри SFON).** [Фронтенд] «Себестоимость», «Валовая маржа», «Чистая прибыль», «Оценка склада в себестоимости», «Доход за вычетом себестоимости и бонусов», процент вознаграждения продавца от чистой прибыли (`set-profit-percentage`, `sfonProfitPercentage`, `accsProfitPercentage`).
- В Open API **нет** (только цена продажи).

### 4.10. Скидки и способы оплаты
- **Подтверждено:** наличные (`CASH`), безнал (`NON_CASH`, несколько безналичных счетов с комиссией банка — пример «Kaspi Pay, Halyk POS, Р/С Halyk»), долг (`DEBT`, срок возврата), сплит (`SPLIT`, «Распределите сумму чека между наличными, счетом и долгом»), Trade-In в зачёт, бонусы клиента (кэшбэк, списание с подтверждением SMS-кодом), налог/сбор в %, доставка Kaspi Seller (видео №9). Мультивалютность и курс доллара по заказу («Хоть в долларах продавай» [Лендинг]; «Массовая корректировка курса» [Фронтенд]).
- Скидки: упоминаются косвенно («детали оплат, скидок, возвратов», «информация о позициях, скидках») — отдельный механизм скидок **не подтверждён**.
- **Рассрочка/кредит банка (Kaspi Red/кредит) — не подтверждено.** Обложка `how-to-sell-on-credit` означает «продажа в долг» (видео №7 «Как продавать в долг»). Kaspi как отдельная интеграция (Kaspi API, Kaspi QR) — не подтверждено; Kaspi фигурирует как название безналичного счёта и как доставка Kaspi Seller.

### 4.11. История операций
- **Подтверждено.** [Фронтенд] «Журналирование» (`/settings/journal`, `/journal/records?module=SFON|ACCS`, по пользователю), история движения экземпляра (`/product-flow-history/{id}`), история изменения цены, история кассовых операций, отмены операций с указанием причины.

### 4.12. Роли сотрудников
- **Подтверждено.** [Фронтенд] роли `SUPER_ADMIN` (владелец: магазины, интеграции), `ADMIN`, `SELLER` («Продавец»), служебная `SYSTEM_MANAGER` (сотрудник SFON). Меню по ролям: продавец — продажа, касса, добавить товар, долги клиентов, балансы; админ — ещё статистика, склад, ревизия, расходы, настройки. Ограничение пользователей по магазину (`/store/accessible`), бейдж быстрого входа со штрихкодом. [Лендинг] тарифы «Без ограничений пользователей».

### 4.13. Отчёты
- **Подтверждено.** [Лендинг] «Онлайн статистика для руководителей», «Аналитика продажи», «Ревизия», «Статистика продаж менеджера», «Контроль расходов», «Контроль долгов клиентов/поставщикам». [Фронтенд] «Статистика», `/reports-api/situation-business` («Ситуация бизнеса»), отчёт продаж с выгрузкой в Excel (не больше 31 дня), аналитика предзакупа (xlsx), итоги дня по способам оплаты.

### 4.14. Импорт / экспорт
- **Экспорт в Excel — подтверждён** [Фронтенд] (продажи, приёмка, аналитика, аксессуары). **Импорт из файла — не подтверждено** (строк «импорт» в интерфейсе не найдено).

### 4.15. API и интеграции
- Open API — см. §2 (только чтение каталога в наличии, `X-API-Key`). Вебхуков, OAuth для партнёров, записи — нет в документации.
- Встроенные: SMS-шлюз (рассылки и транзакционные SMS, баланс SMS у SFON), уведомления WhatsApp (вкл/выкл в настройках витрины — механизм не раскрыт), собственный интернет-магазин shop.sfon.kz («SFS Store», витрина компании, `https://shop.sfon.kz/<компания>` — например `/kopkop`), «Smartfon AI Ассистент» (сообщение об ошибке упоминает OpenAI).
- 1С, Kaspi-магазин — только как примеры имён внешней системы для ключа; готовых интеграций **не подтверждено**.

### 4.16. Фискализация (онлайн-касса / ОФД)
- **Не подтверждено из открытых источников.** Единственное упоминание — текст гарантии «Сохраняйте гарантийный талон и фискальный чек…». Слов ОФД, ККМ, Webkassa, «фискализ» в интерфейсе нет. Вероятно, фискальный чек пробивается отдельной кассой — это предположение, не факт.

### 4.17. Тарифы [Лендинг sfon.kz]
| Тариф | Модуль | Цена до скидки | Цена | Условия |
|---|---|---|---|---|
| Базовый | Электроника | 35 000 | 21 000 (−40%) | 2 магазина, без ограничений пользователей и функционала |
| Базовый | Аксессуары | 19 000 | 11 000 (−40%) | то же |
| Профи | Электроника | 50 000 | 35 000 (−30%) | 2 магазина… |
| Профи | Аксессуары | 27 000 | 19 000 (−30%) | 2 магазина… |
Период оплаты и валюта на странице не указаны (вероятно ₸ в месяц — **не подтверждено**). «Подключить на 14 дней бесплатно» → https://web.sfon.kz/register. В коде лендинга есть и невыводимый калькулятор (внедрение 400 000 / 200 000 / 500 000, ежемесячно 50 000 / 20 000 / 65 000 от 11 пользователей и 5 магазинов) — на странице не показан, не опираться. В системе есть подписки по модулям («Подписка: Аксессуары») и лимит магазинов.

### 4.18. Мобильные приложения
- **Не подтверждено.** В App Store / Google Play приложения не найдено. Веб-приложение адаптировано под телефон (сканирование IMEI камерой телефона, «Держите телефон в 15–20 см от наклейки»).

---

## 5. Что это значит для нас (ai-admin)

1. Для бота магазина телефонов реально подключить **только Open API**: наличие и цены по магазинам, б/у с % аккумулятора и годом, фото, характеристики, адреса и WhatsApp магазинов. Нужен ключ `X-API-Key` от владельца магазина (выдаёт SFON через «Настройки → Интеграции», у ключа есть срок).
2. Через Open API **нельзя**: найти товар по IMEI, узнать продажу/гарантию по IMEI, создать заявку/бронь/продажу, получить клиентов, долги, себестоимость.
3. Trade-In: SFON сам учитывает Trade-In как зачёт в продаже; оценки Trade-In в API нет — оценка у нас остаётся своей (прайс), итог — заявка администратору.
4. Риски: лимит 429 не опубликован; кэшировать каталог; цены могут быть `null`; данные с задержкой; ключ хранить только на сервере (как требует SFON).

Всё выше — по документам и публичному коду фронтенда; **вживую ничего не проверено** (нет ключа и учётной записи).
