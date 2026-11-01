# Сайт студии TAYVENO (ИП Bot Flow)

Публичный сайт студии разработки: Astro 7 + TypeScript + Tailwind CSS 4, без React. Публикация — Cloudflare Worker `tayveno` (Workers Static Assets), адрес — https://tayveno.xyz.
Дизайн — утверждённая концепция B «Contemporary Software» (Figma, файл `z9nrk5bW3ZFw7PKyF46rxN`, раздел «Раунд 2»):
Manrope (заголовки) + Golos Text (текст), белый фон, акцент `#2457A6`, сетка 12 колонок, контейнер 1248, поля 96 / 20.

## Страницы

| Адрес | Что |
|---|---|
| `/` | Главная: первый экран, полоса настоящих экранов Winchester, направления, работа, порядок работы |
| `/services/` | Четыре направления: что можем сделать, с чего начинаем |
| `/cases/`, `/cases/winchester/` | Работы. Кейс — файл `src/content/cases/winchester.md` |
| `/about/` | О студии, принципы, сведения о компании (связь бренда с ИП) |
| `/contacts/` | Способы связи из конфигурации, форма (если включена), реквизиты |
| `/privacy/` | Политика конфиденциальности |
| `/404.html`, `/robots.txt`, `/sitemap-index.xml` | Служебные |

## Где что менять

- **Бренд, юридические данные, контакты** — только `src/config/site.ts`. Пустое поле на сайт не выводится.
  Публичный бренд — константа `BRAND`.
- Направления и порядок работы — `src/lib/content.ts`. Строки интерфейса — `src/i18n/ui.ts`.
- Токены дизайна — `src/styles/global.css` (`@theme`).
- Скриншоты кейса — `public/images/winchester/`, готовит `scripts/images.py` из снимков Playwright (deviceScaleFactor 2).
- Превью ссылок и значки — `node scripts/og.mjs` (пересобрать после смены бренда).

## Как расширять

- **Новый кейс** — файл `src/content/cases/<slug>.md` (поля проверяет схема в `src/content.config.ts`), картинки в
  `public/images/<slug>/`. Страница и пункт в `/cases/` появятся сами. Только запущенные проекты и проверенные факты.
- **Блог, демо** — новые коллекции рядом с `cases` в `src/content.config.ts` и страницы в `src/pages/blog/`, `src/pages/demos/`.
- **Языки** — словарь в `src/i18n/ui.ts` (тип `UI` не даст пропустить строку), язык в `astro.config.mjs` (`i18n.locales`),
  страницы в `src/pages/kk/`, `src/pages/en/`. У русского префикса нет.
- Интерактивные демо, которым нужен React, — `npx astro add react`, остров только на своей странице.

## Команды

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # dist/
npm run check        # astro check (TypeScript) + типы функции формы
npm run qa           # Playwright: 1440 / 768 / 390, консоль и CSP, прокрутка, axe, SEO, ссылки, sitemap, меню, форма
npm run qa -- --url https://адрес   # то же на опубликованном сайте + HTTPS, заголовки, превью, форма выключена
npm run check:meta   # что не заполнено для проверки в Meta (--strict — с ошибкой)
```

`npm run qa` проверяет собранный `dist/` на локальном сервере с заголовками из `public/_headers` (как Cloudflare).
Нужен Playwright с Chromium (в облачной среде — уже установлен в `/opt/node-tools`). Чтобы проверить форму:
`PUBLIC_CONTACT_FORM=1 npm run build && npm run qa` (ответ сервера подменяется, в Telegram ничего не уходит).

## Две сборки: тестовая и боевая

| | Тестовая | Боевая |
|---|---|---|
| Когда | `SITE_URL` не задан, сборка не в Cloudflare | `SITE_URL=https://…` или сборка в Workers Builds (`WORKERS_CI=1` → https://tayveno.xyz) |
| Адрес в canonical, sitemap, превью | адрес этой публикации Cloudflare (`CF_PAGES_URL`), локально — localhost | `SITE_URL` |
| Поисковики | закрыто: `noindex` на страницах, `Disallow: /` в robots.txt | открыто, robots.txt со ссылкой на sitemap |
| Условие | нет | сборка **остановится**, если название ИП не сверено (`legal.nameVerified`); без контакта — только предупреждение |

Адреса по умолчанию нет намеренно: 01.11.2026 оказалось, что `botflow-site.pages.dev` занят чужим проектом —
canonical и ссылки указывали бы на чужой сайт.

Пока нет ни одного способа связи (почта, телефон, мессенджер или включённая форма), кнопок «Обсудить проект» и пункта
«Контакты» на сайте нет: страница без контактов — тупик. Страница `/contacts/` остаётся с реквизитами, закрыта от
поисковиков и не попадает в карту сайта.

## Публикация: Cloudflare Worker `tayveno`

Сайт — статические файлы `dist/` в Worker `tayveno` (Workers Static Assets, `wrangler.jsonc`), без скрипта: так
применяются заголовки из `public/_headers` (CSP, HSTS, кэш). Выкладка — Cloudflare **Workers Builds** из `main`:

| Настройка (Worker `tayveno` → Settings → Build) | Значение |
|---|---|
| Git repository | `aztenel/ai-admin` |
| Branch | `main` |
| Root directory | `apps/botflow-site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths (include) | `apps/botflow-site/*` |
| Переменные сборки | не нужны: в Workers Builds (`WORKERS_CI=1`) адрес — https://tayveno.xyz; версия Node — `.node-version` (22.12.0) |

У Worker `ai-admin` (бот) в его настройках сборки — Build watch paths **exclude** `apps/botflow-site/*`, чтобы правки
сайта не пересобирали бота. Вручную с компьютера владельца: `npx wrangler login`, затем `npm run deploy`.

Домен `tayveno.xyz`:
1. Зона `tayveno.xyz` в Cloudflare (Add a domain, тариф Free) → Cloudflare показывает два nameserver'а.
2. В Spaceship: Domains → tayveno.xyz → Nameservers → Custom → эти два адреса. DNSSEC в Spaceship выключить
   (сейчас в реестре висит запись DS без ключей у Spaceship — домен не открывается у резолверов с проверкой DNSSEC).
   После активации зоны DNSSEC можно включить уже в Cloudflare и добавить её DS в Spaceship.
3. Worker `tayveno` → Settings → Domains & Routes → Add → Custom domain: `tayveno.xyz` и `www.tayveno.xyz`
   (Cloudflare сам создаст записи и сертификат).
4. Зона → Rules → Redirect Rules → шаблон «Redirect from WWW to root» (301, сохранить путь и параметры).
5. Проверка: `npm run qa -- --url https://tayveno.xyz`.

**Форма связи — выключена.** Включать только после настройки секретов и живой проверки доставки:
обработчик `functions/api/contact.ts` написан для Cloudflare Pages Functions и в Worker со статическими файлами **не
выкладывается**: для формы его нужно перенести в скрипт Worker (и тогда заголовки безопасности задавать в скрипте).
До этого формы на сайте нет (`PUBLIC_CONTACT_FORM` не задан).

## Юридический блок: как заполнить по документу

Всё — в `src/config/site.ts`, раздел `legal`. Источник — документ, который подаётся в Meta (уведомление о начале
деятельности ИП с QR-кодом из налоговой или талон о регистрации). Переписывать **буква в букву**: латиница или кириллица,
регистр, кавычки, пробелы — как в документе. Ничего не дописывать «для вида».

Заполнено 01.11.2026 по уведомлению о начале деятельности ИП (с QR-кодом, подано 01.10.2026). Сам документ в
репозиторий не кладётся: в нём ИИН, ФИО и домашний адрес владельца.

| Поле | Откуда | Сейчас на сайте |
|---|---|---|
| `registeredName` | п. 3 «Наименование ИП» | «Bot Flow» — буква в букву, это же писать в форме Meta |
| `name` | форма + наименование | «ИП Bot Flow» — в текстах сайта |
| `nameVerified` | сверка с документом | `true` |
| `city` | город из п. 6 (адрес) | «Астана» |
| `registration` | заголовок документа и дата подачи | «Уведомление о начале деятельности… от 01.10.2026» |
| `activities` | п. 4, коды ОКЭД | пять кодов 62011–62020, страница «О студии» |
| `bin` | ИИН из документа | **пусто** — личный номер, только по решению владельца |
| `address` | п. 6 полностью | **пусто** — домашний адрес, только по решению владельца |

Где выводится: подвал, «О студии» → «Сведения о компании», «Контакты», политика конфиденциальности (оператор данных),
разметка schema.org (`legalName`, `taxID`, адрес).

## Перед подачей в Meta

`npm run check:meta` показывает, что не заполнено (`--strict` — с ошибкой). Препятствия:

1. **Название ИП** — сверено: «Bot Flow» (латиница, заглавные только первые буквы). В форме Meta — так же; в заявке
   Winchester Meta отказывала именно из-за расхождения букв.
2. **Реальный контакт**: почта (лучше на своём домене — Meta может прислать на неё код подтверждения) и/или телефон —
   те же, что в форме Meta и в документе.
3. **Свой домен.** `*.workers.dev` Meta уже отклоняла как «общий хостинг»; `*.pages.dev` — такой же общий адрес.
4. **Боевая сборка** с `SITE_URL` на своём домене и проверка `npm run qa -- --url https://домен`.
5. Юридический адрес и ИИН/БИН — по решению владельца; если адрес указан в форме Meta, на сайте лучше тот же.
6. Согласие Winchester на публикацию кейса и скриншотов (`clientApproved` в `winchester.md`).

Одобрение Meta не гарантировано: сайт — одно из условий, решение принимает Meta по документам.
