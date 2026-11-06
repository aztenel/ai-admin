# Additional OSS bases for "Prime Mobile OS" (IMEI/serial ERP/POS, multi-tenant SaaS, Kazakhstan)

Scope: 5 projects NOT covered elsewhere (AureusERP, Inventoros, Bagisto, ERPNext excluded).
Method: shallow clones in `/home/user/erp-lab/extra/<name>` (read-only, nothing modified or pushed),
deepened with `git fetch --shallow-since=2026-08-07` to count 90-day activity. **Static reading only —
no test suite, server or migration was executed.** The GitHub REST API was NOT reachable from this session
(`gh api repos/...` -> 403 "GitHub access to this repository is not enabled for this session"), so stars,
issue counts and GitHub "release" objects are not given; versions come from `git ls-remote --tags` and
version files in the source.

Chosen: Odoo Community, InvenTree, Dolibarr (+TakePOS), Open Source POS (OSPOS), Tryton.
Considered, not cloned: UltimatePOS (commercial CodeCanyon licence, not OSS — has IMEI/serial fields and
is the de-facto "phone shop POS" in the region, useful only as a UX benchmark); Medusa (MIT commerce engine,
no stock-unit/serial model, no POS); OpenBoxes (EPL/medical supply chain, lots/expiry not IMEI);
Akaunting (BSL-style "Akaunting licence", accounting only); Krayin (CRM).

Activity note: "commits in 90 days" = commits reachable from the cloned branch with commit date >= 2026-08-07
(`git rev-list --count --since=2026-08-07 HEAD`). Dolibarr/Odoo numbers include merged maintenance-branch
commits, so they overstate unique work; compare orders of magnitude only.

---------------------------------------------------------------------------------------------------------

## 1. Odoo Community (`stock`, `point_of_sale`, `pos_stock`)

| Item | Value |
|---|---|
| URL | https://github.com/odoo/odoo (sparse clone: `addons/stock`, `point_of_sale`, `pos_stock`, `pos_repair`, `stock_account`, `product`, `odoo/release.py`) |
| Branch / last commit | `20.0`, `e6207235af5e21fe3bd8fed63af366a8ad38c384`, 2026-11-05 |
| Version | `odoo/release.py:15` `version_info = (20, 0, 0, FINAL, 0, '')`; branches 18.0 / 19.0 / 20.0 exist |
| Activity | 4 647 commits / 706 distinct author e-mails in 90 days on 20.0 |
| Licence | LGPL-3 (`LICENSE`, and `'license': 'LGPL-3'` in `addons/stock/__manifest__.py:128`, `point_of_sale/__manifest__.py:290`, `pos_stock/__manifest__.py:42`) |
| Stack | Python 3 + PostgreSQL, own ORM, OWL (JS) front-end; POS is an offline-capable JS app syncing orders to the server |
| Tests | 1 843 `tests/test_*.py` files across all addons (stock 30, point_of_sale 26, pos_stock 14) + JS tours/unit tests (`odoo.tests`, HttpCase tours, Hoot) |
| API | JSON-RPC / XML-RPC (`odoo/service/model.py`), JSON-2 bearer API `addons/rpc/controllers/json2.py`, `/json/1/<path>` bearer route in `addons/web/controllers/json.py:39` |

**Commercial limits.** LGPL-3 has no network/SaaS clause: hosting a modified Community for subscribers
does not by itself require publishing sources (distributing on-prem copies does, for LGPL modules you
modify). Own add-on modules may be proprietary (Odoo's documented "link exception" practice). BUT:
open-core — Barcode app (`stock_barcode`), Studio, full Accounting, IoT box drivers, mobile app,
localisations for many countries are Odoo Enterprise (proprietary, paid per user). "Odoo" is a registered
trademark — a reseller SaaS cannot be branded Odoo. Kazakh localisation (`l10n_kz`) not checked in this
sparse clone. Upgrade model: yearly major versions; data migration between majors is officially an
Enterprise/Upgrade-service product; Community relies on OCA OpenUpgrade.

**Serial model.** `stock.lot` (`addons/stock/models/stock_lot.py`), product field `tracking` in
`('none','lot','serial')`; stock quantity per (product, location, lot, package, owner) in `stock.quant`.
- Uniqueness: **Python constraint, not a DB unique index** — `@api.constrains('name','product_id','company_id')`
  `_check_unique_lot` (`stock_lot.py:116-139`): (company, product, name) unique, plus no clash with
  company-less lots. Not found: any `models.Constraint`/`UniqueIndex` on `stock.lot` (grepped
  `Constraint|Index(` in `stock_lot.py`, `stock_quant.py`). Concurrent inserts could therefore race.
- Double-sale guard: `stock.quant.check_quantity()` (`stock_quant.py:627-643`) raises
  "The serial number has already been assigned" if a serial sums to >1 under a destination location;
  called from `stock.move._check_quantity` (`stock_move.py:2348-2353`) during `_action_done` (`stock_move.py:2434`)
  and from `stock_move_line.py:433,520`. Checks the **destination**; leaving the source negative is not
  blocked here.
- `_check_serial_number` (`stock_quant.py:1502`) only returns a **warning message** (used by onchange in
  `stock_move_line.py:202-240` and `stock_quant.py:1012`), i.e. UI-level, not enforcement.
- Locking: reservation uses `try_lock_for_update` on quants (`stock_quant.py:1122`).
- POS path: `pos_stock/models/stock_move.py:37-60` looks up lots by name and, if the picking type allows
  `use_create_lots`, **creates missing lots** from POS-entered names; `pos_order_line.get_existing_lots`
  (`pos_stock/models/pos_order_line.py:30`) offers lots with qty>0 in the POS location. POS pickings can be
  created real-time or at session closing (`pos_stock/models/pos_order.py:25-48`), so a serial sold offline
  is validated only when the picking is processed.
- Multi-tenancy: multi-company inside one DB via `company_id` + record rules (`stock_lot.py:56`);
  real SaaS isolation = one PostgreSQL database per tenant (Odoo.sh / `dbfilter`).

Fit: strongest functional coverage (purchase, sale, returns, transfers, inventory adjustments, multi-warehouse,
costing via `stock_account`, POS, repairs `pos_repair`). Weak points: serial uniqueness is ORM-level,
heavy platform, Enterprise pressure, DB-per-tenant ops cost, warranty is not a core concept.

---------------------------------------------------------------------------------------------------------

## 2. InvenTree

| Item | Value |
|---|---|
| URL | https://github.com/inventree/InvenTree |
| Branch / last commit | `master`, `c5c878d6afe67cf612f436d04c6479dc18a3c2dd`, 2026-11-05 |
| Version | latest tag `1.7.0`; master `INVENTREE_SW_VERSION = '1.8.0 dev'` (`src/backend/InvenTree/InvenTree/version.py:18`) |
| Activity | 376 commits / 34 authors in 90 days |
| Licence | MIT (`LICENSE`), no extra clauses found; "InvenTree" name/logo not covered by MIT |
| Stack | Django 5.2 (`src/backend/requirements.txt:616`) + DRF REST API, React/TypeScript front-end (`src/frontend`), Postgres/MySQL/SQLite, Celery-like background worker (django-q), plugin system (`src/backend/InvenTree/plugin/`) |
| Docs | MkDocs site in `docs/` (28 top-level doc sections in `docs/docs`) |
| Tests | 93 `test*.py` files (Django TestCase) + 27 Playwright `*.spec.ts` in `src/frontend` |
| API | Full REST under `/api/` (`InvenTree/urls.py:168`), OpenAPI schema (`docs/extract_schema.py`) |

**Serial model** — best of the five.
- `StockItem.serial` + `serial_int` (`stock/models.py:452`, `:830`).
- **DB-level unique constraint** `UniqueConstraint(fields=['part','serial'], condition=serial not null/empty,
  name='stock_item_unique_part_serial')` (`stock/models.py:498-513`).
- Wider scope (variant tree or global, setting `SERIAL_NUMBER_GLOBALLY_UNIQUE`) checked in
  `Part.validate_serial_number` (`part/models.py:836`, `:915-935`) and `find_conflicting_serial_numbers`
  (`part/models.py:941`).
- **Concurrency:** `StockItem._lock_serial_numbers` (`stock/models.py:681-738`) takes `select_for_update`
  on the part tree (or the settings row when global) and re-validates under lock; `_create_serial_numbers`
  (`stock/models.py:742-844`) converts `IntegrityError` to validation error.
- Sales double-allocation guard: `SalesOrder.allocate_serial_numbers` (`order/models.py:1774-1860`):
  rejects non-existent, not-in-stock, test-failed, and already-allocated serials, using
  `stock_item.lock_quantity()` (row lock, `stock/models.py:3223`) then `unallocated_quantity() < 1`.
  `SalesOrderAllocation.clean` (`order/models.py:3256+`) forbids over-allocation and qty != 1 for serials.
- Also present: `ReturnOrder` (`order/models.py:3381`), `TransferOrder` (`:3824`), stocktake
  (`part/stocktake.py`, `StockItem.stocktake` `stock/models.py:3296`), full tracking history.
- Multi-tenancy: **none** — single organisation per instance; optional `STOCK_OWNERSHIP_CONTROL`
  (`common/setting/system.py:813`, default False) restricts by owner group, not tenant isolation.
- **No POS / cashier UI, no cash register, no fiscal receipts** (not found after browsing backend apps list:
  `build, common, company, order, part, stock, report, pricing, users, plugin...`). Profit/margin is limited
  to pricing module, not retail P&L.

Fit: excellent reference implementation for IMEI integrity and a clean REST backend; would need a POS front-end,
tenant layer (schema- or DB-per-tenant), retail accounting, warranty.

---------------------------------------------------------------------------------------------------------

## 3. Dolibarr ERP/CRM (+ TakePOS)

| Item | Value |
|---|---|
| URL | https://github.com/Dolibarr/dolibarr |
| Branch / last commit | `develop`, `832af7a5a60b85336ad89e91b36c5830864a7179`, 2026-11-05 |
| Version | latest stable tag `24.0.2`; develop `25.0.0-alpha` (`htdocs/version.inc.php:40-41`) |
| Activity | 5 412 commits / 174 authors in 90 days (includes merges from maintenance branches) |
| Licence | GPL-3-or-later (`COPYING`, `README.md:22-26`) |
| Stack | PHP, MySQL/MariaDB/PostgreSQL, server-rendered pages, modules in `htdocs/<module>`; POS = `htdocs/takepos` |
| Tests | 181 `*Test.php` PHPUnit files under `test/` |
| API | REST (Luracast Restler) `htdocs/api/`; stock-specific `htdocs/product/stock/class/api_productlots.class.php`, `api_stockmovements.class.php`, `api_warehouses.class.php` |

**Commercial limits.** GPL-3 without network clause: SaaS hosting of a modified copy does not trigger source
release; distributing it does, and custom modules linked into the PHP app are generally treated as GPL.
Many add-ons on DoliStore are paid. True multi-company requires the external **Multicompany** module
(not in this repo: only `htdocs/core/multicompany_page.php` hook page found; `htdocs/custom/` contains only README).

**Serial model.** Product flag `tobatch` (0 none, 1 lot, 2 serial) (`install/mysql/tables/llx_product.sql:62`);
master table `llx_product_lot`; per-warehouse quantities `llx_product_batch`.
- DB: `UNIQUE uk_product_lot(fk_product, batch)` (`llx_product_lot.key.sql`) — note **no `entity` column in the
  key** although the table has `entity` (`llx_product_lot.sql:22`), so in multicompany the same IMEI cannot
  exist in two entities for the same product row. `UNIQUE uk_product_batch(fk_product_stock, batch)` per warehouse.
- Serial check: `MouvementStock::_create` (`product/stock/class/mouvementstock.class.php:230`) inside
  `$this->db->begin()` (`:342`); after an **incoming** movement it checks `getBatchCount(...) > 1`
  -> "TooManyQtyForSerialNumber" and rolls back (`:706-723`). Only increases are checked (`qty > 0`).
- Outgoing (sale) protection only when `STOCK_DISALLOW_NEGATIVE_TRANSFER` is set (`:470`), default off
  (getDolGlobalInt default 0) -> by default a serial can be shipped from a warehouse where it is not, driving
  the lot negative.
- No row locking: 0 occurrences of `FOR UPDATE` in `mouvementstock.class.php`.
- Other serial checks: qty>1 rejected in stock transfer (`product/stock/stocktransfer/stocktransfer_card.php:204,288`),
  inventory (`product/inventory/inventory.php:439`); UI warnings `product/stock/product.php:1234`.
- TakePOS has batch selection (`takepos/index.php:712-717`, `takepos/invoice.php:74`).

Fit: complete small-business suite (invoices, purchases, warehouses, POS, contracts/interventions usable for
warranty), REST API, huge community. Weak: dated PHP architecture, serial integrity is application-level and
partially optional, multi-tenant = paid external module or instance-per-tenant.

---------------------------------------------------------------------------------------------------------

## 4. Open Source Point of Sale (OSPOS)

| Item | Value |
|---|---|
| URL | https://github.com/opensourcepos/opensourcepos |
| Branch / last commit | `master`, `9a304c01831303709964abb8f5bc219af807f081`, 2026-11-04 |
| Version | latest tag `3.4.3`; master `3.4.4-dev` (`app/Config/App.php:15`) |
| Activity | 147 commits / 18 authors in 90 days |
| Licence | MIT **plus a mandatory-footer clause**: footer "© 2010 - year · opensourcepos.org · 3.x.x - hash" "MUST BE RETAINED, MUST BE VISIBLE IN EVERY PAGE and CANNOT BE MODIFIED" (`README.md:118-131`) — conflicts with white-label SaaS branding |
| Stack | PHP 8.2+ CodeIgniter 4.7.4 (`composer.json:28-30`), MySQL, jQuery/Bootstrap views |
| Docs | `docs/BUILD.md`, `INSTALL.md`, `UPGRADE.md`; README |
| Tests | 41 `*Test.php` (PHPUnit, `phpunit.xml.dist`) |
| API | No REST API found (`app/Config/Routes.php` has no api/resource routes) |

**Serial model — weak.** Only a boolean `items.is_serialized` (`initial_schema.sql:200`) and free-text
`serialnumber varchar(30)` on `sales_items`, `receivings_items`, `sales_suspended_items`
(`initial_schema.sql:478,530,621`). No serial registry table, **no unique index** (only FKs, `:801-824`),
no validation: controller copies POST value (`app/Controllers/Sales.php:662,703`, `Receivings.php:212`);
`Sale_lib::add_item` just adds a separate cart line for serialized items (`app/Libraries/Sale_lib.php:1115,1152-1166`).
Not found: any check that a serial was received or not already sold. Sale saved in a transaction
(`app/Models/Sale.php:561-697`), stock quantity decremented per line. Multi-location stock yes; multi-company/tenant no.

Fit: only as a cashier-UX reference; not a base for IMEI tracking; licence footer clause problematic.

---------------------------------------------------------------------------------------------------------

## 5. Tryton (trytond + `stock_lot`, `stock_lot_unit`, `sale_point`)

| Item | Value |
|---|---|
| URL | https://github.com/tryton/tryton (GitHub mirror of the Heptapod monorepo) |
| Branch / last commit | `main`, `0a94ac3c67e22648bf6ff81c5e982ae815c26fd5`, 2026-10-28 |
| Version | latest server tag `trytond-8.2.1`; trunk `__version__ = "8.3.0"` (`trytond/trytond/__init__.py:17`) |
| Activity | 105 commits / 8 authors in 90 days (mirror; small core team) |
| Licence | GPL-3-or-later (`trytond/LICENSE`, `COPYRIGHT`); no open-core, no paid modules; trademark "Tryton" held by the foundation |
| Stack | Python + PostgreSQL, modular ORM, desktop client `tryton/` (GTK) and web client `sao/`; 221 modules |
| Docs | Sphinx `doc/` + per-module `doc/` + doctest `.rst` scenarios |
| Tests | 388 `tests/test_*.py` + 426 `.rst` doctest scenarios in `modules/*/tests` (unittest/doctest via tox) |
| API | JSON-RPC/XML-RPC + REST protocol `trytond/trytond/protocols/rest.py`; REST client lib `naiad/` |

**Serial model.** `stock.lot` with `number` + `product` (`modules/stock_lot/stock.py:27-32`, class `Lot` `:47`).
- Uniqueness: **not found** — no `Unique(` / `_sql_constraints` in `modules/stock_lot` or `stock_lot_unit`;
  duplicates are allowed (there is even a `duplicate_lot_number` field, `stock.py:588`).
- `stock_lot_unit` adds a lot unit/quantity so a lot with quantity 1 behaves as a serial: per-move and
  per-shipment checks `check_lot` (`modules/stock_lot_unit/stock.py:95-126`). Lot-vs-shipment quantity
  differences raise only a **user warning** (`stock_lot/stock.py:695-730`, `res.user.warning`).
- Locking: assignment `Move.assign_try` locks via `_assign_try_lock` per company (`modules/stock/move.py:1169-1206`).
- POS `sale_point`: no lot/serial handling found (grepped "lot" in `modules/sale_point/*.py` — only reporting).
- Multi-company: `company` module, records carry `company`; one DB per tenant for SaaS isolation.

Fit: clean, very stable, no open-core; but serial-as-lot is weak, POS lacks serials, small community in the region.

---------------------------------------------------------------------------------------------------------

## Comparison for Prime Mobile OS

| Criterion | InvenTree | Odoo CE | Dolibarr | Tryton | OSPOS |
|---|---|---|---|---|---|
| Serial DB unique index | yes (part, serial) | no (ORM constraint) | yes (product, batch) | no | no |
| Double-sell guard | row lock + re-check | on move done (destination) | only if negative stock disabled | warning / lot qty | none |
| POS | none | yes (offline JS) | TakePOS | sale_point (no lots) | yes (core purpose) |
| Returns / transfers / stocktake | yes | yes | yes | yes | returns only |
| Multi-tenant | none | company-in-DB / DB-per-tenant | paid Multicompany module | company / DB-per-tenant | none |
| REST API | yes (DRF + OpenAPI) | JSON-RPC, JSON-2 | yes (Restler) | REST + JSON-RPC | no |
| Licence for SaaS resale | MIT, clean | LGPL ok, Enterprise open-core, trademark | GPL-3 ok (no AGPL) | GPL-3 ok | MIT + forced footer |
| 90-day commits | 376 | 4 647 | 5 412* | 105 | 147 |

*includes merged maintenance-branch commits.

All claims above are from static reading of the cited files; none of the projects' tests were run.
