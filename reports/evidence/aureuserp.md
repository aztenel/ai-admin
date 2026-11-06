# AureusERP v1.8.0 — static code audit for "Prime Mobile OS"

Repo: `/home/user/erp-lab/aureuserp`, commit `9b076df06a902cce5a14866650547ed13ffa140a` (HEAD "Merge pull request #1682 … v1.8.0/changelog").
Method: **static reading only**. Nothing was executed (no composer install, no tests, no DB). Every "behaviour" below is an inference from code (and from test *names/bodies*, which were read, not run). "Confirmed" = seen in code; "not found" = searched as stated.
All plugin paths below are relative to `plugins/webkul/` unless they start with `app/`, `config/`, `bootstrap/`, `tests/`, `.github/`.

Stack (composer.json): PHP ^8.3, Laravel ^13, Filament ^5, Livewire ^4, Sanctum ^4, filament-shield 4.2.0 (spatie/laravel-permission), knuckleswtf/scribe ^5.6, maatwebsite/excel ^3.1, barryvdh/laravel-dompdf ^3.1, milon/barcode ^13, nativephp/mobile ^3.3, Pest ^4.4. Plugins merged via `wikimedia/composer-merge-plugin` (`composer.json` → `extra.merge-plugin.include: plugins/*/*/composer.json`).
Size: ~405k lines PHP in `plugins/webkul` (excluding lang); inventories plugin ~57k lines.
Plugins present: accounting, accounts, analytics, barcode, blogs, chatter, contacts, crm, employees, fields, full-calendar, inventories, invoices, maintenance, manufacturing, partners, payments, plugin-manager, **point-of-sale**, products, projects, purchases, recruitments, sales, security, support, table-views, time-off, timesheets, website.

---

## 0. TL;DR verdict for a phone-shop ERP

* It is an Odoo-clone (models/flows mirror Odoo `stock.quant`, `stock.move`, `stock.move.line`, `stock.lot`, `stock.picking`, POS sessions). Serial tracking exists (`ProductTracking::SERIAL`), but **IMEI uniqueness is NOT enforced by the database or by validation**, and **POS by design completes a sale even when the serial is not in stock** (stock goes negative, order only flagged). For an IMEI shop this is the single biggest gap.
* Transactions: Filament UI actions are wrapped in DB transactions (`$hasDatabaseTransactions = true`); the **REST API workflow endpoints (validate/cancel/reserve/return) are NOT** wrapped → partial writes possible on exceptions; `lockForUpdate()` in `ProductQuantity::adjustStock` is a no-op outside a transaction. No optimistic locking / version columns found.
* Multi-tenancy is **multi-company inside one installation** (global `CompanyScope`, `user_allowed_companies`), not SaaS tenant isolation: rows with `company_id = NULL` are visible to every company; super_admin bypasses all; scope is **disabled in console (queues, artisan)**.
* Rich feature surface (POS with offline uuid idempotency, accounting, invoices, purchases, returns, scrap, stocktake, barcode app, PDFs, Sanctum REST API with Scribe docs, MFA). Test suite is large (~3.6k Pest cases) incl. inventory serial cases, but none for "sell the same serial twice" or "duplicate lot name".

---

## 1. Inventory

### 1.1 Product model / variants
* Base product: `products/src/Models/Product.php` (uses `BelongsToCompany`, line 27/31; `HasChatter`/`HasLogActivity`). Inventory extends it: `inventories/src/Models/Product.php:27` `class Product extends BaseProduct`, casts `tracking` to `ProductTracking` (line 49).
* Variants: Odoo-style template/variant in one table — `products/database/migrations/2025_01_05_100751_create_products_products_table.php` has `is_configurable` (l.31) and `parent_id` (l.35); attribute models `products/src/Models/{Attribute,AttributeOption,ProductAttribute,ProductAttributeValue,ProductCombination}.php`. Usable for "iPhone 16 / 128GB / Black".
* Cost: single `cost decimal(15,4)` on `products_products` (same migration, l.22). No per-unit cost; no FIFO/AVCO valuation layers — grep for `fifo|avco|valuation_layer|cost_method|stock_valuation` over all plugins found only unrelated enum/factory hits (`products/src/Enums/ProductRemoval.php` is removal strategy FIFO/LIFO, not costing). `inventories_moves.price_unit` exists (`2026_04_10_094203_add_price_unit_column_in_inventories_moves_table.php`) so purchase price per move line is stored, but no valuation engine uses it. POS COGS uses `product->cost` (`point-of-sale/src/Services/OrderCalculator.php:203` `$line->unit_cost = (float) ($line->product?->cost ?? 0);`, `CogsEntryBuilder.php:122`). → **Per-IMEI purchase price / exact profit per unit: not implemented** (would need custom code).
* Product barcode: unique `(company_id, barcode)` — `products/database/migrations/2026_09_24_000000_add_unique_barcode_to_products_products_table.php:55` (migration also clears existing duplicates).

### 1.2 Lots / serial numbers (critical for IMEI)
* Tracking enum: `inventories/src/Enums/ProductTracking.php` — `SERIAL='serial'`, `LOT='lot'`, `QTY='qty'`. Column `products_products.tracking` default `qty` (`inventories/database/migrations/2025_01_10_091035_alter_products_products_table.php`). Global switch `TraceabilitySettings::enable_lots_serial_numbers` (`Filament/Clusters/Settings/Pages/ManageTraceability.php:85`).
* Lot table: `inventories/database/migrations/2025_01_14_092601_create_inventories_lots_table.php` — `name` string **`->index()` only**, `product_id`, `company_id` **nullable**, `location_id`, expiry dates, `properties` json. **No unique index on (product_id, name) or (company_id, product_id, name).** Confirmed by `grep -rn "unique(" inventories/database products/database` — unique indexes exist for tags, locations barcode, warehouses name/code, package types, storage capacities, product barcode; **none for lots**.
* App-level validation of lot name uniqueness: **not found**.
  * API `inventories/src/Http/Requests/LotRequest.php:20` — `'name' => [required,'string','max:255']`, no `unique` rule; `product_id` only `exists:products_products,id`.
  * Filament form `inventories/src/Filament/Clusters/Products/Resources/LotResource/Schemas/LotForm.php:32-38` — `TextInput::make('name')->required()->maxLength(255)`, no `->unique()`.
  * `Lot` model (`inventories/src/Models/Lot.php`) has no saving hook checking duplicates; only `creator_id` default and `ChecksCompanyConsistency` (product must match company).
* Lot lookup by name during receipt: `inventories/src/Services/MoveCompleter.php::matchExistingLots()` (≈l.165-195) — finds existing lot by `(product_id, name, company_id|NULL)` and reuses it, otherwise `MoveLine::assignLotFromName()` creates a new one. So the normal receipt UI path tends to reuse lots, but nothing stops manual/API creation of a second `Lot` row with the same IMEI (or a race of two receipts creating it concurrently).
* Serial duplicate guard: `inventories/src/Models/Move.php:1242` `assertSerialUniqueness()`, called at the **end** of `MoveCompleter::complete()` (`MoveCompleter.php:71`). Logic: for SERIAL products, sums `ProductQuantity.quantity` grouped by `(product_id, location_id, lot_id)` over **internal descendants of the move's destination location**; throws `serial-already-assigned` if |qty| > 1.
  * Keyed by `lot_id`, not by lot name → two Lot rows with the same IMEI are invisible to it.
  * Checks only the *destination* internal locations → on a delivery to Customers (non-internal) nothing is checked. The *source* side is not checked for availability: `ProductQuantity::adjustStock()` (`Models/ProductQuantity.php:309-358`) creates/updates the quant and returns `availableFor(... allowNegative: true)`; `MoveCompleter::settleStock()` only releases competing reservations when `$availableQty < 0` — it does not refuse. **Static inference: validating a delivery for a serial already sold (qty 0 at stock) drives that lot's quant to −1 instead of failing.** Needs live test.
  * Runs after stock has already been updated → relies on the caller's transaction to roll back (see §2).
  * Test: `inventories/tests/Feature/Workflows/OneStepReceiptTest.php:633` "throws when the same serial number is assigned to two move lines" (same lot on two receipt lines). No test for duplicate lot name, nor for delivering an already-delivered serial (searched `tests` for `serial-already|twice|duplicate`).
* Serial helpers: `Lot::generateLotNames()` / `Lot::getNextSerial()` (`Lot.php` ≈l.104-150) — sequential serial generation; reservation never reserves fractional qty of serial products (`ProductQuantity.php:541`; test `OneStepDeliveryTest.php:770`); one move line per serial on receipt/delivery (`MoveReserver.php:113-121`, tests `OneStepReceiptTest.php:505,520`, `OneStepDeliveryTest.php:748`).
* **IMEI1 + IMEI2 + serial per unit**: only one identifier (`inventories_lots.name`) + free `reference` + `properties` json + `HasCustomFields` (fields plugin, `Lot.php` uses `Webkul\Field\Traits\HasCustomFields`). Searched for `imei` across plugins: only unrelated translation hits. → IMEI2 / device serial would be custom fields, not indexed/unique.

### 1.3 Quants / stock levels / reservations
* `inventories_product_quantities` (`2025_01_14_113233_...`): `quantity`, `reserved_quantity`, `counted_quantity`, `difference_quantity`, `inventory_diff_quantity`, `inventory_quantity_set`, FK product/location/lot/package/partner/company. **No unique index on (product, location, lot, package)** → duplicate quant rows possible; code copes by summing (`findFor` + `orderBy('lot_id')->orderBy('id')->lockForUpdate()->first()` in `adjustStock`).
* Reservation: `Services/MoveReserver.php` (278 lines) with `Support/ReservationLedger.php`, `PlannedReservation.php`; `ProductQuantity::planReservation()` (≈l.520+), `applyReservationDelta()` (l.288). Availability is read (`availableFor`) before the row lock is taken → check-then-act; serialization only of the final row update, and only inside a transaction.
* Negative stock: allowed. POS test `point-of-sale/tests/Feature/Workflows/OrderStockFailureTest.php:41` "drives the stock negative when more is sold than is on hand". No setting to forbid negative stock found (grep `allow_negative|prevent_negative`: none).
* Stock levels helpers: `Support/StockLevels.php`, `StockQueryScopes.php`, `StockScope.php`; forecast tests `ForecastAvailabilityTest.php`.

### 1.4 Operations (receipts, deliveries, transfers, returns, dropship)
* Single `inventories_operations` table with STI-like subclasses `Models/{Receipt,Delivery,InternalTransfer,Dropship}.php` over `Operation.php`; types in `inventories_operation_types` (`use_create_lots`, `use_existing_lots`, `create_backorder`, `reservation_method`).
* Workflow façade `src/InventoryManager.php` → `Services/TransferWorkflow.php`: `confirm()` l.23, `reserve()` l.36, `complete()` l.64, `cancel()` l.95, `createReturn()` l.108. Supporting services: `MoveConfirmer`, `MoveReserver`, `MoveCompleter`, `MoveCanceller`, `BackorderCreator`, `MoveMerger`, `PushRuleRunner`, `ProcurementRunner`, `RuleResolver`, `PutawayPlanner`, `TransferValidator`.
* Multi-step routes (1/2/3-step receipt/delivery), push/pull rules, putaway rules, packages, backorders — tests `tests/Feature/Workflows/{One,Two,Three}Step{Receipt,Delivery}Test.php`, `InternalTransferTest.php`, `DropshipTest.php`.
* Internal transfers between warehouses/locations: `InternalTransfer` model + `InternalResource`; cross-company transfers guarded by `Support/CrossCompanyTransferGuard.php` / `Exceptions/CrossCompanyTransferException.php`. Branch = warehouse (unique `(company_id, code)` and `(company_id, name)` — `2025_01_06_072130_create_inventories_warehouses_table.php:36-37`) or a child company (`companies.parent_id`, `support/database/migrations/2024_12_10_092657_create_companies_table.php:17`).
* Returns: `TransferWorkflow::createReturn()` / `buildReturnMoveAttributes()` (l.180-231) with `is_refund` move flag (`2025_03_19_100337_add_is_refund_column...`). Test `ReplicationTest.php:281` "returns a delivery twice without exceeding the delivered quantity".
* Scrap: `Models/Scrap.php`, API `ScrapController` (validate wrapped in `DB::transaction`, l.195), tests `ScrapTest.php`.
* Purchases → receipts (`purchases` plugin; `2025_03_17_*_from_inventories.php` migrations), Sales → deliveries (`2025_04_07/09_*`), procurement groups (`2026_04_08_*`).

### 1.5 Stocktake / inventory adjustment
* Per-quant counting: `counted_quantity`, `inventory_quantity_set`, `ProductQuantity::applyCountedDifference()` (`Models/ProductQuantity.php:203-243`) creates a DONE inventory `Move` + `MoveLine` (`recordAdjustmentMove`, l.244-286) between the company's INVENTORY virtual location and the stock location — history preserved.
  * Suspicious code (needs test): after the move it does `static::updateOrCreate([location_id => adjustment location, product_id, lot_id], ['quantity' => -$this->product->available_qty, ...])` (l.227-236) — overwrites the virtual-location quant with the negative of the product's total available qty rather than adding the delta.
  * The hook runs from model events: `created`/`updated` call `applyCountedDifference()` whenever `! inventory_quantity_set` (l.149-176), and every quant update calls global `static::purgeEmpty()` (l.175).
* **API stocktake bypasses moves**: `inventories/src/Http/Controllers/API/V1/QuantityController.php::apply()` (≈l.165-200) directly `update(['quantity' => $countedQuantity, 'counted_quantity' => 0, ...])` inside `DB::transaction` — it does not call `recordAdjustmentMove`; whether the `updated` hook then creates a move depends on `inventory_diff_quantity` (not set by this endpoint) → **API stock count likely leaves no move history**. Needs live test.
* Barcode app has an adjustments screen: `barcode/src/Livewire/Adjustments.php`.
* Cyclic counts: `Location.cyclic_inventory_frequency` → `refreshCountSchedule()` (l.362+).

### 1.6 Stock move history
* `inventories_moves` + `inventories_move_lines` (lot_id, lot_name, qty, uom_qty, source/destination, reference, scheduled_at, `is_inventory`) — full ledger like Odoo. API read-only list `Http/Controllers/API/V1/MoveController.php::index` (permission `view_any_inventory_move`, l.55). Move history per serial = filter move lines by `lot_id` (`filter[lot_id]`).

---

## 2. Data integrity

### 2.1 Transactions
* Grep `DB::transaction|beginTransaction|lockForUpdate` across plugins (excluding tests): 103 hits; in **inventories src only 7**: `Models/ProductQuantity.php:336` (lockForUpdate), `EditLocation.php:31`, `EditWarehouse.php:28`, `API/V1/OperationController.php:220,246` (create/update operation), `API/V1/QuantityController.php:177` (apply), `API/V1/ScrapController.php:195`.
* **Filament UI**: the workflow actions declare `protected bool|Closure $hasDatabaseTransactions = true;` — `inventories/src/Filament/Clusters/Operations/Actions/{ValidateAction(l.17),TodoAction,CheckAvailabilityAction,ReturnAction,CancelAction,NextTransferAction}.php`, and Create/Edit pages of Receipt/Delivery/Internal/Dropship/Scrap/Lot/Location/... (list via `grep -rln hasDatabaseTransactions`). `ValidateAction::executeDoneTransfer()` (l.88-104) catches Throwable and calls `$this->halt(shouldRollBackDatabaseTransaction: true)` → UI validation is atomic (relying on Filament's action transaction wrapper; vendor not installed here, so this is inferred from the property name/API).
* **Barcode app**: `barcode/src/Livewire/Operation.php:444-461` `validateOperation()` wraps `Inventory::completeTransfer` in `DB::transaction` — atomic.
* **REST API workflow endpoints are NOT transactional**: `inventories/src/Http/Controllers/API/V1/OperationController.php` — `todoById()` (l.120), `validateById()` (l.128-134 `Inventory::completeTransfer($operation)`), `cancelById()` (l.137), reserve (l.115), `returnById()` (l.144-147) — no `DB::transaction`. Called from `DeliveryController::validateTransfer()` (l.146-160) etc. Since `assertSerialUniqueness()` throws *after* quants were updated and moves set DONE, an API call that hits it would leave **committed partial stock changes**. Also `lockForUpdate()` in `adjustStock` is ineffective in autocommit mode. No API middleware adds a transaction (`bootstrap/app.php` only adds SetLocale + trustProxies).
* Sales/Purchase API controllers wrap create/update in transactions (`sales/.../OrderController.php:106,162`, `purchases/.../PurchaseOrderController.php:101,149`); accounting API controllers too (`accounts/.../InvoiceController.php:114,214,361,408`).
* Sequences: `support/src/Services/SequenceService.php:66-127` uses transaction + `lockForUpdate` → document numbers are race-safe.
* POS: `point-of-sale/src/Services/OrderProcessor.php::process()` (l.45-83) `DB::transaction` + `lockOrder()` (l.216-222: `Order::withoutGlobalScopes()->where('uuid',$uuid)->lockForUpdate()->first()`), `pos_orders.uuid` unique (`2026_09_17_100011_create_pos_orders_table.php:17`) → **offline/retried POS submissions are idempotent**. `OrderWorkflow::markPaid()` (l.86-160) is one transaction; `RefundProcessor` (l.27,55) and `BillSplitter` (l.47) lock rows; `SessionWorkflow` l.175-178 locks the session.

### 2.2 Double sale of the same serial
* Back office: not prevented by DB; only `assertSerialUniqueness` (destination-side check, §1.2). Static reading suggests a second delivery of the same IMEI is accepted with a negative quant. Concurrent deliveries: no row lock across the availability read → race possible.
* **POS: confirmed by design** — `point-of-sale/src/Services/PickingGenerator.php::forceComplete()` (l.144-174) runs confirm+complete in a nested `DB::beginTransaction()` (savepoint); on any Throwable it rolls back only the stock part, sets `has_failed_operation` on order and session, dispatches `OrderOperationFailed`, and returns false; `OrderWorkflow::markPaid()` then still marks the order PAID (l.136-147). Tests document it: `OrderStockFailureTest.php:29` "settles the sale even when there is no stock on hand", `:56` "flags the order and the session when the operation cannot complete", `:68` "settles the sale even when the operation could not complete", `:94` "leaves stock untouched when the operation failed", `:136` "completes the operation on retry once the lot arrives in stock"; `OrderLotTest.php:90` "still settles a tracked sale when no lot was captured", `:76` "creates a missing lot when the operation type allows it" (`Services/LotResolver.php:57-67` creates a Lot from the typed name if `use_create_lots`).
  * Stock update can also be deferred to session close: `OrderWorkflow.php:208` `StockUpdateMode::AT_CLOSING` → `SessionPickingGenerator` (l.134 `beginTransaction`).
  * For an IMEI shop you would need a hard pre-payment check "this IMEI is in stock at this branch and not reserved", which does not exist.

### 2.3 Cancel / rollback / negative / idempotency
* Cancel: `Services/MoveCanceller.php` (73 lines), `TransferWorkflow::cancel()`. Unreserve guard: `ProductQuantity.php` ≈l.556 throws `unreserve-more-than-stock`.
* Negative quantities on move lines refused (`MoveCompleter::completeLines()` `no-negative-quantities`; `MoveLine.php:314`). Negative stock levels allowed.
* Idempotency: POS via uuid (above); check-availability twice does not double reserve (tests `OneStepDeliveryTest.php:307`, `ReplicationTest.php:205`). API has no idempotency keys.
* No optimistic locking (`version`/`lock_version` columns): not found.

### 2.4 Audit logs
* Chatter plugin traits `chatter/src/Traits/{HasChatter,HasLogActivity}.php`; used by `inventories/src/Models/Operation.php` (with `getLogAttributeLabels()` l.106), `Scrap.php`, `products/src/Models/{Product,Category}.php`, `point-of-sale/src/Models/{Order,Session}.php`, `sales/src/Models/{Order,Team}.php`, `purchases/src/Models/{Order,Requisition}.php`.
* **Not** on `Lot`, `Move`, `MoveLine`, `ProductQuantity` (grep). Move table itself is the stock ledger; no audit of who edited a lot/IMEI or a quant manually.

---

## 3. Multi-tenancy, companies, users, roles

### 3.1 Company isolation mechanism (confirmed)
* `support/src/Traits/BelongsToCompany.php` adds global `support/src/Models/Scopes/CompanyScope.php` and fills `company_id` from `CompanyContext::currentId()` on create.
* `CompanyScope::apply()`:
  * returns early (**no filtering**) when `app()->runningInConsole() && ! app()->runningUnitTests()` → queue workers, scheduled jobs, artisan commands see all companies;
  * no filtering when there is no authenticated `Webkul\Security\Models\User` (`internalUser()`), or when `Gate::allows('bypass_company_scope')` (granted to super_admin in `support/src/SupportServiceProvider.php:96-106`);
  * otherwise `whereIn(table.company_id, activeIds) OR company_id IS NULL` → **rows with NULL company are shared across all companies** (lots, quants, products etc. have nullable `company_id`).
* `support/src/Services/CompanyContext.php`: allowed companies from `user_allowed_companies` (`security/src/Models/User.php:118-120`); active set stored in session key `active_company_ids`; switch via `POST company-context/set` (`SupportServiceProvider.php:110`). For Sanctum API calls there is no session middleware on API routes → (inference) falls back to the user's default company.
* `support/src/Traits/ChecksCompanyConsistency.php`: on creating/updating checks related FKs belong to the same company (`CompanyConsistencyGuard`) — also skipped in console.
* ~95 models use `BelongsToCompany` (inventory: Operation, ProductQuantity, Rule, Warehouse, Package, OrderPoint, StorageCategory, PackageType, Scrap, Location, PackageLevel, Lot, PutawayRule, OperationType, MoveLine, Route, Move; plus Product, Partner, sales/purchase orders & lines, accounting moves, chatter messages/attachments …).
* Tests: `inventories/tests/Feature/Workflows/CompanyIsolationTest.php` (2 cases), `CompanyScopingInvariantsTest.php` (4), `point-of-sale/.../CompanyScopingInvariantsTest.php`, `support/tests/Helpers/CompanyHelper.php::actingAsCompanyUser`.
* Assessment for SaaS: this is **Odoo multi-company in one DB**, designed for one organization with several legal entities/branches. For many independent shops (tenants) you'd need an extra tenant layer: NULL-company shared rows, super_admin global bypass, console bypass, global roles, global settings (spatie settings, e.g. `TraceabilitySettings`) and global lookups (UoM, tags with global `unique` name — `2025_01_06_072032_create_inventories_tags_table.php:16`, `companies.name` unique — `2026_03_09_000001_add_unique_index_to_companies_name.php`) would all leak/collide across tenants.

### 3.2 Roles / permissions
* filament-shield (`config/filament-shield.php`, `FilamentShieldPlugin::make()` in `app/Providers/Filament/AdminPanelProvider.php:77`), spatie permission with `'teams' => false` (`config/permission.php:126`) → **roles are global, not per company**.
* Policies per resource (`inventories/src/Policies/*Policy.php`, 24 files) using permission strings like `view_any_inventory_delivery`, plus record-level `HasScopedPermissions` (`security/src/Traits/HasScopedPermissions.php`: user `resource_permission` GLOBAL / GROUP (teams) / INDIVIDUAL; e.g. `DeliveryPolicy::update()` = permission + `hasAccess`). `security/src/Bouncer.php` caches authorized user IDs in a **static** property (`$authorizedUserIdsCache`) — would leak between requests under Octane/FrankenPHP (`.env.pgtest` sets `OCTANE_SERVER=frankenphp`, but Octane is not in composer.json).
* Server-side checks in API: every public action in inventories API controllers calls `Gate::authorize` (counted: Delivery 10/10, Receipt 10/10, Internal 10/10, Lot 5/5, Quantity 7/7, Scrap 6/6 …), `MoveController::index` uses `abort_unless(can('view_any_inventory_move'))`. Note `QuantityController::apply()` authorizes `create` (not a dedicated "apply inventory" ability).

---

## 4. Sales / POS / accounting

* **POS exists**: `point-of-sale` plugin (own Filament panel `app/Providers/Filament/PosPanelProvider.php`, Livewire terminal, API `point-of-sale/routes/api.php` with `auth:sanctum`). Models: Config, Session, Order, OrderLine, **OrderLineLot** (`lot_name`, `lot_id` → serial capture at till), Payment, PaymentMethod, CashMovement, Printer, Floor/Table (restaurant), Bill. Services: `OrderProcessor`, `OrderWorkflow`, `RefundProcessor`, `SessionWorkflow`, `SessionCloser` (cash control), `GlobalDiscountApplier` (transactional, l.19,54), `PriceResolver`, `FiscalPositionResolver` (tax mapping, not fiscal printers), `PosInvoicer`, `ReceiptBuilder`, `CogsEntryBuilder`, `ClosingEntryBuilder`, reports (`SalesDetailsReport`, `OrderAnalysisReport`). 36 test files / 335 cases incl. `OrderLotTest`, `OrderRefundTest`, `OrderDiscountTest`, `DraftSyncTest`, `OfflineCustomerTest`.
* Discounts: line discounts + global discount (`GlobalDiscountApplier.php`), price lists (`products/src/Models/{PriceList,PriceRuleItem}.php`).
* Sales orders/quotations: `sales` plugin (ConfirmAction/CreateInvoiceAction transactional). Invoices/payments/journals/taxes/credit notes: `accounts`, `accounting`, `invoices`, `payments` plugins (API `accounts/routes/api.php`; reports GeneralLedger, ProfitLoss, BalanceSheet, AgedReceivable … with PDF/Excel export in `accounting/src/Filament/Clusters/Reporting/Pages/*`).
* Kazakhstan fiscalization (OFD / online cash register / ККМ), Kaspi QR: **not found** (searched `fiscal` → only FiscalPosition tax mapping).
* Warranty documents: **not found** (grep `warranty|guarantee` → only maintenance equipment `warranty_date`-type fields in `maintenance/src/Models/Equipment.php`).

---

## 5. Integrations

* REST API: per-plugin `routes/api.php`, prefix `admin/api/v1/<plugin>`, middleware `auth:sanctum` (accounts, inventories, partners, point-of-sale, products, projects, purchases, sales, security, support). Resource routes + workflow verbs (e.g. `receipts/{id}/check-availability|todo|validate`, `inventories/routes/api.php:35-40`). Query filtering/sorting/includes via spatie/laravel-query-builder. Docs via Scribe (`config/scribe.php:37` prefixes `admin/api/*`, controller attributes `#[Endpoint]`, `#[ResponseFromApiResource]`). Root `routes/api.php` is empty.
* Auth API: `security/src/Http/Controllers/API/V1/AuthController.php::login()` — email+password → Sanctum personal token (`createToken('api-token')`, no abilities/scopes); rate limit 5 attempts per `email|ip` (l.40-47). Sanctum `expiration => null` (`config/sanctum.php:53`) → **tokens never expire**.
* Webhooks (outbound or inbound): **not found** (grep `webhook` → only `config/logging.php`).
* Import: Filament importers only in CRM (`crm/src/Filament/Imports/{LeadImporter,OpportunityImporter,LeadRecordImporter}.php`). **No product / stock / serial import** found (searched `Imports` dirs and `ImportAction|Maatwebsite` usage: only accounting, accounts, crm). Exports: 32 exporter classes (crm 20, accounting 9, accounts 3); none for inventory/products.
* PDF: dompdf via `support/src/Traits/PDFHandler.php`; purchase PO/RFQ print (`purchases/src/Services/DocumentGenerator.php`, `PrintPOAction`, `PrintRFQAction`), POS invoice PDF (`point-of-sale/src/Http/Controllers/API/V1/OrderInvoicePdfController.php`), accounting reports, picking/label/lot print views (`inventories/resources/views/filament/clusters/operations/actions/{print-picking-operations,labels}.blade.php`, `.../products/lots/actions/print.blade.php`).
* Barcode: milon/barcode used in print views (products, packagings, locations, packages, lots, labels); dedicated **barcode scanning app** plugin `barcode/src/Livewire/{Dashboard,Transfers,Operation,Adjustments,ManufacturingOrder(s)}.php` with lot entry (`Operation.php:54,175,264`) — useful for IMEI scanning on receipts/transfers.
* Mobile: `nativephp/mobile` + `aureuserp/nativephp-remote` in composer (not examined further).

---

## 6. Security

* Admin panel (`app/Providers/Filament/AdminPanelProvider.php`): `->login()`, `->passwordReset()`, `->emailVerification()`, middleware EncryptCookies, StartSession, `AuthenticateSession`, `PreventRequestForgery` (CSRF), `->multiFactorAuthentication([AppAuthentication::make()->recoverable()])` (TOTP 2FA with recovery codes; managed in `support/src/Filament/Pages/Profile.php:63,505`). 2FA is optional per user (not enforced) — inferred from Filament MFA defaults.
* Sessions: `config/session.php` lifetime 120, `encrypt` false, `secure` from env, `http_only` true, `same_site` lax.
* Rate limiting: only API login (above) and website customer auth (`website/src/Filament/Customer/Auth/*`). No `throttle` middleware on API groups (grep). `bootstrap/app.php:28` `trustProxies(at: '*')` → `X-Forwarded-For` trusted from anyone unless behind a proxy that strips it (weakens IP-keyed throttling).
* Error output: `bootstrap/app.php` Throwable renderer returns exception class, file and line for 500s when `APP_ENV != production`.
* File uploads: 24 `FileUpload::make`, 22 with `acceptedFileTypes`, 5 with `maxSize`. Chatter attachments go to the **public disk with public visibility** (`chatter/src/Filament/Actions/Chatter/MessageAction.php:105-125`, `LogAction.php:80-81`) — random 16-char prefix, but anyone with the URL can download (no tenant check).
* Secrets: `.env.pgtest` is tracked in git and contains a real-looking `APP_KEY` (test key; must never be reused). `barryvdh/laravel-debugbar` is in `require` (not `require-dev`) → must ensure `APP_DEBUG=false` in prod.

---

## 7. Tests

* Framework: Pest 4 on PHPUnit (`phpunit.xml` lists 15 `*Feature` suites, e.g. `InventoryFeature` → `plugins/webkul/inventories/tests/Feature`, `PointOfSaleFeature`, `SaleFeature`, `PurchaseFeature`, `SecurityFeature`). `tests/Pest.php` binds `Tests\TestCase` + `DatabaseTransactions` to `Feature` and `../plugins/*/*/tests/Feature`. `tests/TestCase.php::setUp()` → `TestBootstrapHelper::ensureERPInstalled()` which runs **`migrate:fresh --force`** on the configured DB (`support/tests/Helpers/TestBootstrapHelper.php:215-227`) and installs plugins via `artisan <plugin>:install`; parallel workers get `<db>_p<TEST_TOKEN>` (l.286+). sqlite is commented out in phpunit.xml → needs MySQL 8 or PostgreSQL 16 (CI matrix in `.github/workflows/pest_tests.yml`).
* Counts (files `*Test.php` / `it|test(` cases, static grep): accounting 10/62, accounts 47/538, barcode 4/22, crm 54/735, employees 5/18, **inventories 40/858**, manufacturing 7/41, partners 10/76, **point-of-sale 36/335**, products 20/327, projects 8/71, purchases 15/171, sales 19/177, security 2/6, support 14/119, website 2/25 → ~293 files, ~3,580 cases. Plus Playwright e2e: `tests/e2e-pw` (26 `*.spec.ts`, CI `.github/workflows/playwright_tests.yml`).
* Inventory coverage: receipts/deliveries 1-3 steps, internal, dropship, scrap, quantities, forecast, replication/returns, company isolation, API V1 for every resource (`inventories/tests/Feature/API/V1/*Test.php`, 18 files incl. `LotTest.php`), Filament resource tests. Serial-related: `OneStepReceiptTest.php:429-537,633`, `OneStepDeliveryTest.php:687-770`, `TwoStep*/ThreeStep*` serial cases, `API/V1/QuantityTest.php`.
* Missing (searched): duplicate lot/serial name per product; delivering a serial that is not in stock / already delivered; concurrent validation; API validate rollback; tenant isolation via API for inventory.

### Commands to run the test suite (from `.github/workflows/pest_tests.yml`)
```bash
cd /home/user/erp-lab/aureuserp
composer install
cp .env.example .env
# set DB (MySQL 8 or PostgreSQL 16); the suite runs migrate:fresh on this DB — use a throwaway DB
sed -i 's|^APP_ENV=.*|APP_ENV=testing|' .env
sed -i 's|^DB_CONNECTION=.*|DB_CONNECTION=pgsql|' .env   # or mysql
# set DB_HOST/DB_PORT/DB_DATABASE=aureuserp/DB_USERNAME/DB_PASSWORD
php artisan key:generate
php artisan erp:install --force --admin-name="Example" --admin-email="admin@example.com" --admin-password="admin123"
vendor/bin/pest --colors=always                       # everything
vendor/bin/pest --testsuite=InventoryFeature          # inventory only
vendor/bin/pest --testsuite=PointOfSaleFeature
vendor/bin/pest plugins/webkul/inventories/tests/Feature/Workflows/OneStepReceiptTest.php
vendor/bin/pest --parallel                            # uses TEST_TOKEN per-worker DBs
# e2e (needs running app + browsers):
cd tests/e2e-pw && npm ci && npx playwright install && npx playwright test
```

---

## 8. Customizability / upgrade path / code quality

* Plugin architecture: each module is a composer package under `plugins/webkul/<name>` (own `composer.json`, ServiceProvider, `routes/`, `database/migrations`, `resources/lang`, `tests/`), merged by composer-merge-plugin; installer commands `<plugin>:install`, runtime plugin manager `plugin-manager/src/{PluginManagerServiceProvider,PermissionManager}.php`, `plugins` table with `is_installed`. Cross-plugin columns are added by "`..._from_inventories.php`" migrations (e.g. inventories adds columns to purchases/sales tables). Extension points: Filament `SchemaRegistry` contributions (`support/src/Filament/Contributions/SchemaRegistry.php`, flushed in `tests/TestCase.php`), events (`inventories/src/Events/Operation{Confirmed,Assigned,Done,Canceled,Returned}`), custom fields (`fields` plugin, `HasCustomFields`).
* A custom "phone shop" plugin could live in `plugins/<vendor>/<name>` and listen to events / add Filament schema contributions without forking core — but the IMEI uniqueness and POS hard-stock check require changing core services (`MoveCompleter`, `PickingGenerator`, `LotRequest`, lot migration) or overriding them via the container (`app(MoveCompleter::class)` resolution is container-based, so `bind()` overrides are feasible).
* Upgrade risk: Laravel 13 / Filament 5 / Livewire 4 are bleeding-edge; v1.x is very active (migrations dated up to 2026-09). Fast-moving schema (`2026_07_21_..._provision_company_virtual_locations.php`, `2026_03_17_..._fix_corrupted_location_parent_paths.php` indicate data-repair migrations).
* Code quality: services are reasonably small (inventory services 51–327 lines), typed signatures, enums, Pint config (`pint.json`), AGENTS.md for AI agents. Weaknesses: generic `\Exception` with translated messages everywhere instead of domain exceptions (inventory); heavy model-event side effects (`ProductQuantity::boot` runs adjustments and global `purgeEmpty()` on every update); N+1-prone collection logic in `assertSerialUniqueness`; static caches (`Bouncer`).

---

## 9. What Prime Mobile OS would need to add/change (if based on AureusERP)

1. DB unique index `inventories_lots (company_id, product_id, name)` (+ normalized IMEI), plus IMEI2/serial as indexed unique columns (or a separate `device_identifiers` table with a unique index across tenant).
2. Hard availability check for SERIAL products on delivery/POS (source quant of that lot ≥ 1, not reserved elsewhere), executed under `SELECT … FOR UPDATE` inside a transaction; make POS refuse payment instead of "settle and flag".
3. Wrap all API workflow endpoints in `DB::transaction` (or move the transaction into `TransferWorkflow`).
4. Tenant layer above companies (tenant_id, no NULL-shared rows, per-tenant roles/settings, scope enforced in queues/console).
5. Per-unit cost (purchase price per serial from `inventories_moves.price_unit`) and profit reports; product/serial Excel import; warranty documents; KZ fiscalization/Kaspi.
6. Sanctum token expiry/abilities, API throttling, private disk for attachments, remove committed `.env.pgtest` key, debugbar to require-dev.
