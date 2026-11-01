# Сайт студии BOT FLOW (ИП BOT FLOW)

Публичный сайт студии разработки: Astro 7 + TypeScript + Tailwind CSS 4, без React. Публикация — Cloudflare Pages.
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
npm run check:meta   # что не заполнено для проверки в Meta (--strict — с ошибкой)
```

`npm run qa` проверяет собранный `dist/` на локальном сервере с заголовками из `public/_headers` (как Cloudflare Pages).
Нужен Playwright с Chromium (в облачной среде — уже установлен в `/opt/node-tools`). Чтобы проверить форму:
`PUBLIC_CONTACT_FORM=1 npm run build && npm run qa` (ответ сервера подменяется, в Telegram ничего не уходит).

## Публикация на Cloudflare Pages (бесплатно)

1. Cloudflare → Workers & Pages → Create → Pages → **Connect to Git** → репозиторий `aztenel/ai-admin`.
2. Project name: `botflow-site` (тогда адрес — `https://botflow-site.pages.dev`; если имя занято, Cloudflare даст другое —
   тогда поменять `SITE_URL`, шаг 4).
3. Production branch: `dev` (позже — `main`). Framework preset: **Astro**. Root directory: `apps/botflow-site`.
   Build command: `npm run build`. Build output directory: `dist`.
4. Variables (Production и Preview): `SITE_URL` = итоговый адрес сайта (`https://botflow-site.pages.dev`, потом свой домен),
   `NODE_VERSION` = `22.12.0`.
5. Settings → Builds → **Build watch paths**: include `apps/botflow-site/*` — иначе сайт пересобирается на каждый коммит бота.
6. Свой домен: Pages → Custom domains → добавить домен → `SITE_URL` поменять на него → пересобрать.

**Форма связи** (необязательно): в переменных Pages `TG_TOKEN` (Secret, токен бота Telegram), `TG_CHAT` (id чата),
`PUBLIC_CONTACT_FORM` = `1` → пересобрать. Без этих переменных формы на сайте нет. Обработчик — `functions/api/contact.ts`.

## Перед подачей в Meta

`npm run check:meta` показывает, что не заполнено. Обязательно:

1. **Название ИП буква в букву как в документе**, который подаётся в Meta (уведомление с QR-кодом или талон): латиница/кириллица,
   регистр, пробелы. Сейчас на сайте «ИП BOT FLOW» со слов владельца, с документом не сверено (`legal.nameVerified: false`).
   В заявке Winchester Meta отказывала именно из-за расхождения букв.
2. **Реальный контакт**: почта (лучше на своём домене — Meta может прислать на неё код подтверждения) и/или телефон.
   Тот же телефон и адрес, что в форме Meta и в документе.
3. **Свой домен.** Адреса `*.workers.dev` Meta уже отклоняла как «общий хостинг»; `*.pages.dev` — такой же общий адрес.
   Домен покупает владелец; после подключения — `SITE_URL`.
4. Юридический адрес и ИИН/БИН — по решению владельца (`legal.address`, `legal.bin`); если адрес в форме Meta указан,
   на сайте лучше тот же.
5. Сроки в политике конфиденциальности (ответ на запрос — 30 дней, удаление обращений — через год) — решение владельца,
   поправить в `src/pages/privacy.astro`, если нужны другие.
6. Согласие Winchester на публикацию кейса и скриншотов (`clientApproved` в `winchester.md`).

Одобрение Meta не гарантировано: сайт — одно из условий, решение принимает Meta по документам.
