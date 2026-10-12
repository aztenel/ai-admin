#!/usr/bin/env node
// Сбор списка бизнесов Астаны из официального API 2ГИС (Places API 3.0) для продаж.
// Только официальный API, без парсинга сайта. Ключ — только из переменной DGIS_KEY.
// Контакты (contact_groups) на этом ключе не отдаются (платное разрешение 2ГИС),
// поэтому колонки «Телефон», «WhatsApp», «Instagram» остаются пустыми — заполняются вручную.
//
// Запуск:  DGIS_KEY=… node scripts/leads/dgis.mjs            (из облачной сессии: NODE_USE_ENV_PROXY=1)
// Опции:   --target=35  --pool=70  --max-requests=150  --niche=barber  --offline
//   --offline — пересобрать CSV из сохранённого scripts/leads/out/raw.json, 0 запросов к API.
// Результат: scripts/leads/out/astana-<дата>.csv (папка out/ в .gitignore — данные не коммитить).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "out");
const RAW = join(OUT_DIR, "raw.json");
const API = "https://catalog.api.2gis.com/3.0/items";
const REGION_ID = "68"; // Астана (Regions API, 12.10.2026)
const FIELDS = "items.reviews,items.schedule,items.rubrics,items.adm_div,items.name_ex,items.org";
const HEADER = ["Ниша", "Название", "Адрес", "Район", "Рейтинг", "Число отзывов", "График", "Ссылка 2ГИС",
  "Телефон", "WhatsApp", "Instagram", "Заметки", "Статус звонка"];

// Ниши: поисковые фразы и фильтр по названию рубрики (текстовый поиск иногда приносит лишнее).
const NICHES = [
  { id: "barber", name: "Барбершоп", queries: ["барбершоп", "мужская парикмахерская"],
    rubric: /барбершоп|мужск\S* (парикмахер|салон)/i },
  { id: "beauty", name: "Салон красоты / ногтевая студия", queries: ["салон красоты", "ногтевая студия", "маникюр"],
    rubric: /салон\S* красот|ногт|маникюр|педикюр|парикмахерск|бровист|ресниц/i },
  { id: "cosmo", name: "Косметология", queries: ["косметология", "косметолог", "эстетическая косметология", "лазерная эпиляция", "косметологический кабинет"],
    rubric: /косметолог|косметическ|эстетическ|эпиляц/i },
  { id: "dental", name: "Стоматология", queries: ["стоматология"],
    rubric: /стоматолог|зубн/i },
  { id: "auto", name: "Автосервис / детейлинг", queries: ["автосервис", "детейлинг", "автомойка"],
    rubric: /автосервис|детейлинг|автомойк|шиномонтаж|кузовн|автоэлектр|ремонт автомобил|тюнинг|покраска авто/i },
  { id: "phones", name: "Магазин / ремонт телефонов", queries: ["ремонт телефонов", "магазин телефонов"],
    rubric: /телефон|смартфон|сотов|мобильн|гаджет|цифровой техник|электроник/i },
];

const DAYS = [["Mon", "Пн"], ["Tue", "Вт"], ["Wed", "Ср"], ["Thu", "Чт"], ["Fri", "Пт"], ["Sat", "Сб"], ["Sun", "Вс"]];

// ---------- аргументы ----------
const arg = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const TARGET = Number(arg("target", 35));
const POOL = Number(arg("pool", 70)); // сколько подходящих набрать до отбора лучших по отзывам
const MAX_REQ = Number(arg("max-requests", 150));
const ONLY = arg("niche", "");
const OFFLINE = process.argv.includes("--offline");
const MAX_PAGES = 5; // демо-ключ, по сниппету документации, глубже 5 страниц не отдаёт

let spent = 0;
let pageSize = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- запросы к API (ключ в URL, поэтому адрес и ключ нигде не печатаем) ----------
async function call(params) {
  const key = process.env.DGIS_KEY;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (spent >= MAX_REQ) throw new Error(`Достигнут предел запросов (${MAX_REQ})`);
    spent++;
    const url = new URL(API);
    for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (e) {
      console.error(`  сеть: ${e?.cause?.code || e?.name || "ошибка"} (попытка ${attempt + 1})`);
      await sleep(1500 * (attempt + 1));
      continue;
    }
    let body = null;
    try { body = await res.json(); } catch { /* пустое тело */ }
    const code = body?.meta?.code ?? res.status;
    if (code === 200) return { ok: true, items: body?.result?.items || [], total: body?.result?.total || 0 };
    if (code === 429 || code >= 500) {
      console.error(`  API ${code}, повтор`);
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return { ok: false, code, msg: body?.meta?.error?.message || "" }; // 400/403/404 — повторять нечего
  }
  return { ok: false, code: 0, msg: "сеть" };
}

async function page(q, n) {
  const params = { q, region_id: REGION_ID, type: "branch", search_type: "one_branch",
    page: n, page_size: pageSize, fields: FIELDS };
  let r = await call(params);
  if (!r.ok && r.code === 400 && pageSize > 10 && n === 1) { // демо-ключ: страница меньше
    pageSize = 10;
    console.error("  page_size > 10 не принят, перехожу на 10");
    r = await call({ ...params, page_size: pageSize });
  }
  return r;
}

// ---------- разбор карточки ----------
const inAstana = (x) => (x.adm_div || []).some((d) => d.type === "city" && d.name === "Астана");

function hours(s) {
  if (!s) return "";
  if (s.is_24x7) return "Круглосуточно";
  const rows = DAYS.map(([k, ru]) => {
    const w = s[k]?.working_hours;
    return { ru, t: w && w.length ? w.map((h) => `${h.from}–${h.to}`).join(", ") : "" };
  });
  const out = [];
  for (let i = 0; i < rows.length;) { // подряд идущие дни с одним временем склеиваем в «Пн–Пт 10:00–21:00»
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].t === rows[i].t) j++;
    if (rows[i].t) out.push(`${i === j ? rows[i].ru : `${rows[i].ru}–${rows[j].ru}`} ${rows[i].t}`);
    i = j + 1;
  }
  return out.join("; ");
}

function row(niche, x) {
  const rv = x.reviews || {};
  const addr = [x.address_name, x.address_comment].filter(Boolean).join(", ");
  return {
    niche: niche.name, orgId: x.org?.id || x.id, name: x.name || "", addr,
    district: (x.adm_div || []).find((d) => d.type === "district")?.name || "",
    rating: rv.general_rating ?? "", reviews: rv.general_review_count ?? 0,
    hours: hours(x.schedule),
    url: `https://2gis.kz/astana/firm/${String(x.id).split("_")[0]}`, // не проверено вживую
  };
}

// ---------- сбор ----------
async function collect(niche, seen) {
  const pool = new Map();
  for (const q of niche.queries) {
    for (let n = 1; n <= MAX_PAGES && pool.size < POOL; n++) {
      const r = await page(q, n);
      if (!r.ok) { if (r.code !== 404) console.error(`  «${q}» стр.${n}: код ${r.code} ${r.msg}`); break; }
      for (const x of r.items) {
        const hit = (x.rubrics || []).some((u) => niche.rubric.test(u.name || ""));
        const id = x.org?.id || x.id;
        if (hit && inAstana(x) && !seen.has(id) && !pool.has(id)) pool.set(id, row(niche, x));
      }
      if (r.items.length < pageSize) break; // последняя страница
      await sleep(250);
    }
    if (pool.size >= POOL) break;
  }
  return [...pool.values()];
}

// ---------- CSV ----------
function cell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // чтобы Excel не принял название за формулу
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => [HEADER, ...rows.map((r) => [r.niche, r.name, r.addr, r.district, r.rating,
  r.reviews, r.hours, r.url, "", "", "", "", ""])].map((l) => l.map(cell).join(";")).join("\r\n");

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let pools; // { nicheId: rows[] }
  if (OFFLINE) {
    pools = JSON.parse(readFileSync(RAW, "utf8"));
  } else {
    if (!process.env.DGIS_KEY) { console.error("Переменная DGIS_KEY не задана — остановка."); process.exit(1); }
    pools = {};
    const seen = new Set();
    for (const niche of NICHES.filter((n) => !ONLY || n.id === ONLY)) {
      pools[niche.id] = await collect(niche, seen);
      for (const r of pools[niche.id]) seen.add(r.orgId); // без дублей между нишами
      console.error(`${niche.name}: найдено подходящих ${pools[niche.id].length}, запросов всего ${spent}`);
      writeFileSync(RAW, JSON.stringify(pools)); // сырьё в out/ (в .gitignore), чтобы пересобирать без запросов
    }
  }
  const all = [];
  for (const niche of NICHES) {
    const best = (pools[niche.id] || []).sort((a, b) => b.reviews - a.reviews || (b.rating || 0) - (a.rating || 0))
      .slice(0, TARGET);
    console.error(`${niche.name}: в CSV ${best.length}`);
    all.push(...best);
  }
  const file = join(OUT_DIR, `astana-${new Date().toISOString().slice(0, 10)}.csv`);
  writeFileSync(file, "﻿" + toCsv(all)); // BOM — чтобы Excel открыл кириллицу
  console.error(`Готово: ${all.length} строк → ${file}. Запросов к API: ${spent}.`);
}

main().catch((e) => { console.error("Ошибка:", e.message); process.exit(1); });
