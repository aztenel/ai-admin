# Inventoros v2.3.0 — static audit as a base for "Prime Mobile OS"

Repo: `/home/user/erp-lab/Inventoros`, HEAD `9314c4d` ("prepare 2.3 release"). Clone is **shallow** (`git rev-parse --is-shallow-repository` = true, 73 commits, tags only v2.1.0/v2.2.0/v2.3.0), so **v1.0.8 (MIT) source is NOT in this clone** — anything about v1.0.8 below is from CHANGELOG/LICENSE text only.

Method: static reading only. Nothing was executed (no composer install, no phpunit). "Confirmed" = seen in code at the cited place. "Not found" = searched with the stated grep and got nothing.

Stack: Laravel 13 (`composer.json` `laravel/framework ^13.0`), PHP `^8.4.1`, Inertia 3 + Vue 3 SPA, Sanctum 4 tokens, rebing/graphql-laravel 9, laravel/mcp 0.7 (MCP server at `/mcp`), maatwebsite/excel 4, barryvdh/laravel-dompdf 3, pragmarx/google2fa-laravel, picqer barcode, bacon QR, Sentry. DB: SQLite/MySQL/PostgreSQL (custom `app/Database/PostgresConnection.php`). Size: 129 migrations, ~64 top-level services (`app/Services/*.php` ≈17 100 lines), 429 PHPUnit test files.

---

## 0. Verdict in one paragraph

Inventoros is a well-hardened **self-hosted, quantity-first warehouse/order system** with optional multi-organization support. Its concurrency discipline (row locks on every stock write, locked re-reads on every state transition) and tenant isolation (global scope + explicit checks + 404 middleware + many isolation tests) are better than typical OSS. But for a phone shop it has structural gaps: **serials are a secondary, non-authoritative record** (no location, no variant, one number per unit, auto-picked FIFO at sale, decoupled from `products.stock`), **no POS**, **stock availability is checked against the org-wide total, not per branch**, **cost is a static catalog price (no per-unit/IMEI cost)**, **no SaaS provisioning (signup → org)**, PDF templates use Helvetica (Cyrillic likely broken), no KZT in the currency list. And it is **AGPL-3.0-only**: using v2.x as the core of a closed SaaS obliges you to offer full source of the modified version to every network user.

---

## 1. Inventory domain

### 1.1 Product / variants
- `products` (`database/migrations/2025_10_12_034201_create_products_table.php`): `sku`, `price decimal(10,2)`, `stock integer` (signed, default 0, line 35), `min_stock`, `max_stock`, `barcode` (non-unique index, line 51), `location_id`. SKU unique became per org: `2026_05_18_000001_make_inventory_numbers_unique_per_organization.php:21-22` (`unique(['organization_id','sku'])`).
- Cost: `purchase_price` (renamed from `cost`) + `selling_price` (`2025_10_13_023000_add_purchase_price_to_products_table.php:16-20`).
- `tracking_type` none|batch|serial on the **product only** (`app/Http/Requests/Product/StoreProductRequest.php:60`; migration `2026_03_12_000001_add_tracking_type_to_products_table.php`).
- Variants: `product_options`, `product_variants` (`2025_12_28_000002_create_product_variants_table.php`: own `sku`, `barcode`, `price`, `purchase_price`, `compare_at_price`, signed `stock` line 25). Variant SKU is only indexed (line 37), not unique — not verified whether a later migration adds uniqueness (searched `product_variants` + `unique` in migrations: only the composite index found).
- Kits / BOM / assembly: `ProductComponent`, `WorkOrder*`, `WorkOrderService` (807 lines).

### 1.2 Serial numbers (critical for IMEI)
Schema — `database/migrations/2026_03_12_000003_create_product_serials_table.php:14-27`:
`id, organization_id, product_id, serial_number string, status string(20) default 'available', notes, timestamps`, **`unique(['organization_id','serial_number'])`** (line 23), index `(organization_id, product_id)`, index `status`. Later: `order_item_id` FK nullable (`2026_07_25_000002_add_order_item_id_to_product_serials.php`). Model `app/Models/Inventory/ProductSerial.php` (uses `BelongsToOrganization`; statuses available/sold/reserved/damaged/written_off/transferred/consumed; `order_item_id` deliberately not fillable).

Confirmed gaps for phones:
- **One identifier per unit** — no IMEI2 / second serial column (schema above). Two IMEIs = two separate serial rows or notes.
- Uniqueness is **per organization**, not global; IMEI is unique only within one tenant (fine for SaaS, but the same IMEI can exist in two tenants — no cross-tenant "stolen/blacklist" check).
- **No `product_variant_id`** on serials (only 3 migrations touch the table; none adds it). `OrderService::create` explicitly skips serial allocation for variant lines (`app/Services/OrderService.php:331-336`: "A variant line draws on the variant's stock, never the parent's serials"). ⇒ "iPhone 15 128GB Black" modelled as a variant **cannot be serial-tracked**; each SKU must be its own product.
- **No location/warehouse** on serials (schema). You cannot know in which branch IMEI X is; transfers don't move serials (`app/Services/StockTransferService.php` — grep for `serial|tracking_type|TrackingType` → no hits). Stock audits don't count serials (`app/Services/StockAuditService.php` grep `serial` → only a comment "serialize").
- **No per-unit cost** on serials ⇒ no per-IMEI profit.
- **Serial is not the source of truth for stock.** `TrackedStockReconciliationService` docblock (`app/Services/TrackedStockReconciliationService.php` header): "the tracking tables are maintained independently of products.stock, so the two can silently diverge … Until batch/serial records become the authoritative source of stock". `products.stock` is the authority.
- **Sale does not let the cashier pick the IMEI.** `TrackedStockAllocationService::allocateSerials()` (`app/Services/TrackedStockAllocationService.php:102-141`) selects `status=available` serials of the product `orderBy('id') … lockForUpdate()->limit($quantity)` — i.e. the oldest rows — and marks them sold + pins `order_item_id`. The only "preferred" serials are those of a consumed stock reservation (lines 110-113). No order request field for serial IDs (grep `serial` in `app/Http/Requests/Order*` → nothing).
- **Best-effort by default**: if fewer serials than quantity exist, allocation silently returns 0 and the order still succeeds (`allocateSerials` lines 120-131); only `config('inventory.strict_tracked_stock')` (`config/inventory.php:23`, env `INVENTORY_STRICT_TRACKED_STOCK`, default false) makes it throw. Test asserting this: `tests/Feature/SerialAllocationOnFulfillmentTest.php:114 test_order_succeeds_untouched_when_serials_are_not_fully_populated`.
- **Returns release the wrong unit**: `ReturnOrderService` receive (`app/Services/ReturnOrderService.php:645-655`) calls `releaseForOrderItem($orderItem, qty)`, and `releaseSerials()` (`TrackedStockAllocationService.php:143-167`) frees `orderBy('id')->limit($limit)` — the lowest-id serial of the line, not the IMEI the customer actually returned. Return requests have no serial field (grep `serial` in `app/Http/Requests/ReturnOrder/*` → nothing).
- **Purchase receiving does not capture serials**: `PurchaseOrderService::receive()` (`app/Services/PurchaseOrderService.php:158-197`) → `PurchaseOrderItem::receive()` (`app/Models/Purchasing/PurchaseOrderItem.php:195-265`) only books quantity via `StockAdjustment::adjust`. Serials are added separately via `POST /api/v1/products/{product}/serials` (`app/Http/Controllers/Api/SerialTrackingController.php:47-85`, validation `Rule::unique('product_serials')->where(organization_id)` lines 63-70) or the product screen.
- **Manual status edits bypass stock**: `SerialTrackingController::update()` (lines 108-190) locks the serial row and refuses double allocation (409 `already_allocated`, lines 160-168), transferred/consumed/written_off (409), reserved (409) — good — but setting `sold` there does **not** decrement `products.stock` and writes no `stock_adjustments` row. `ProductSerial` does not use `LogsActivity` (list of models using it: Warehouse, PurchaseOrder, User, Setting, Customer, Order, ProductCategory, ProductVariant, StockAudit, StockAdjustmentRequest, StockTransfer, ProductLocation, Product, Supplier, CycleCountSchedule) ⇒ no serial history/audit trail.
- Scanning: `ScanLookupService::resolve()` (`app/Services/ScanLookupService.php:33+`) resolves product SKU/barcode, variant, product link, location — **not serial numbers** (no serial lookup method).
- CSV/Excel import of serials: not found (grep `serial` in `app/Imports/*`, `app/Exports/*` → only "spreadsheet serial dates").
- Inter-company transfers do move named serials (CHANGELOG 2.1.0 line ~32; `app/Models/Inventory/InterCompanyTransferSerial.php`).

Double-sell protection: within the normal order path a serial can't be sold twice — `lockForUpdate` on the serial rows + status transition under the product lock (OrderService locks products first, lines 134-148). The DB has no constraint tying `status='sold'` to exactly one `order_item_id`; protection is application-level. On SQLite `lockForUpdate` is a no-op (Laravel SQLite grammar), so real protection exists only on MySQL/PG.

Batches/lots: `product_batches` (`2026_03_12_000002_create_product_batches_table.php`), FEFO allocation `allocateBatches()` (lines 181-250), `order_item_batch_allocations`.

### 1.3 Stock per location/warehouse
- `warehouses` (`2026_04_04_024204_create_warehouses_table.php:11-36`: priority, is_default, currency, timezone; `warehouse_user` pivot), `product_locations` (bins) with `warehouse_id`.
- `product_location_stocks` (`2026_07_25_000001_create_product_location_stocks_table.php`): `quantity` per (product, location), `unique(['product_id','location_id'])`; made unsigned later (`2026_07_26_000002_…_unsigned.php` — real backstop only on MySQL; comment says no-op elsewhere). Variant bins: `variant_location_stocks` (`2026_10_21_000001_…`). Invariant stated in migration docblock: `products.stock == SUM(quantity)`.
- **Order availability is checked against the org-wide total**, not the branch: `OrderService::create` lines 197-212 compute `available = target->stock - reservedTotal(...)` (product/variant total). Bins are then drained by `ProductLocationStockService::consume()` (`app/Services/ProductLocationStockService.php:174-230`): the order's warehouse first, then **other warehouses by priority** (lines 185-202). ⇒ A sale in branch A can silently take stock booked in branch B. For multi-branch phone shops this must change.
- `products.stock` / `product_variants.stock` are signed `integer` with no CHECK constraint (migrations cited) — negative prevention is application-level.
- `WarehouseAccessService` restricts users to assigned warehouses for locations/adjustments/audits/transfers/returns/receiving/shipments, but per CHANGELOG 2.0.0 "The order list, customers, purchase orders and other reports are not filtered by warehouse".

### 1.4 Reservations
`StockReservationService` (852 lines), table `stock_reservations` with `unique(['organization_id','owner_type','owner_reference','scope_key'])` (`2026_10_12_000001_create_stock_reservations_table.php:51`) — idempotent holds on product/bin/variant/serial/batch; expiry job. Orders consume holds (`OrderService::create` lines 189-193, 339-341).

### 1.5 Purchase orders / receiving
`PurchaseOrderService` (create/update/receive), PO lock + per-item lock (`PurchaseOrderService.php:177-191`), over-receive capped (`PurchaseOrderItem::receive` 201-207), approvals (`2026_09_29_000001_add_approval_to_purchase_orders…`), supplier price history (`SupplierPriceHistory`). Receiving does **not** update `products.purchase_price` (grep in `recordSupplierCost` region shows no `purchase_price`/`update`) — no average/FIFO costing.

### 1.6 Sales orders
`OrderService::create()` (`app/Services/OrderService.php:112-355`): inside `SequenceNumberRetry::create(fn() => DB::transaction(...))`; batch `lockForUpdate` products+variants filtered by `organization_id` (134-148); validates availability across all lines (197-212); bulk inserts order items and `stock_adjustments` ledger rows with `quantity_before/after` (214-283, 302-304); bins consumed + `decrement('stock')` (310-321); serial/batch allocation (323-337); `do_action('order_created')` after commit (347-349). **Stock is taken at order creation**, not at shipment/payment. `cancel/approve/reject/restockForDeletion` lock the order row and are idempotent (375-540). `unit_cost` stored at sale = `OrderItem::costAtSale()` = variant/product `purchase_price` (`app/Models/Order/OrderItem.php:95-100`). Order numbers `ORD-YYYYMMDD-n` per org (`Order::generateOrderNumber`, `app/Models/Order/Order.php:476-479`, `SequenceNumber` + retry on unique clash; uniqueness per org migration `2026_03_12_000002_make_order_number_unique_per_organization.php`).

### 1.7 Returns, transfers, adjustments, stocktake
- Returns: `ReturnOrderService` (822 lines) draft→approved→received→completed/rejected, lock on parent order, restock via `StockAdjustment::adjust` into `product->location_id` (lines 630-643), refund amounts per line (`2026_10_17_040000_record_return_line_refund_amounts.php`).
- Transfers (intra-org): `StockTransferService` create/prepare/ship/complete/cancel, every transition `lockForUpdate` on the transfer (lines 124-125, 151-152, 204-208, 319-320), lines adjusted with `allowNegative: false` (387-389). Quantity only.
- Adjustments: `StockAdjustment::adjust()` (`app/Models/Inventory/StockAdjustment.php:196-…`) re-reads the product under `lockForUpdate` (line ~214), writes `quantity_before/after`, respects reservations. **Default parameter `allowNegative = true`** (line 203); all user-facing callers pass `false` (GraphQL `CreateStockAdjustmentMutation.php:116-124`, ApprovalService 457/470, transfers, work orders, ICT), `InventoryResetService:188` intentionally true. Approval rules for adjustments (`ApprovalService::stockAdjustmentNeedsApproval`).
- Stocktake: `StockAudit*` + `StockAuditService`, `StockAuditReviewService` (variance review with `expected_revision` optimistic check), `CycleCountService` schedules. Quantity-based; no IMEI scanning count.
- Movement history: `stock_adjustments` table = ledger (type, before/after, reference_type/id, user, location). Activity log `activity_logs` via `app/Traits/LogsActivity.php` (models listed above) + security events (`SecurityEventLogger`).

---

## 2. Data integrity summary
| Concern | Status | Where |
|---|---|---|
| Transactions on writes | Confirmed broadly | OrderService, PO, returns, transfers, payments, adjustments |
| Row locks (`lockForUpdate`) before read-modify-write | Confirmed | OrderService:134-148, StockAdjustment::adjust, TrackedStockAllocation:117/153/191, PurchaseOrderService:177, StockTransferService:125/152/208 |
| Atomic decrement | `decrement('stock')` under lock (OrderService:320), bins `decrement('quantity')` (ProductLocationStockService:219) | |
| Negative stock | App-level checks; DB column signed (products/variants), unsigned only for bins on MySQL | migrations cited |
| Same serial sold twice | Prevented app-level in order path + serial PUT (409); no DB constraint | §1.2 |
| Lock ordering (product before serial/bins) | Documented & followed | OrderService:563-570, ReturnOrderService:645-649 |
| Idempotency keys for API writes | **Not found** for orders/payments/PO (grep `idempoten`/`Idempotency-Key`: only `InterCompanyTransferService:120-139` and reservations). Orders have `external_reference` unique per org (`2026_09_27_144009_…:17`) which can serve as a client key but is optional | |
| State-transition idempotency | Confirmed (cancel returns early if already cancelled, OrderService:378-381) | |
| Payments | `OrderPaymentService` re-sums inside tx, refuses overpay unless flagged (`app/Services/OrderPaymentService.php:28-68`), void instead of delete (`order_payments.voided_at`) | |
| Queue/jobs | Run **unscoped** (OrganizationScope skips when no auth — `app/Support/Tenancy/OrganizationContext.php` `isScoped()`); jobs pass `organizationId` explicitly (`app/Jobs/ProcessProductImportJob.php:53-72`) | |
| Concurrency tests | Exist but are deterministic stale-model simulations, not parallel workers (e.g. `tests/Feature/StockAdjustmentRaceConditionTest.php:57 test_adjust_uses_fresh_locked_stock_not_caller_stale_value`); default suite runs on SQLite where FOR UPDATE is ignored. CI also runs MySQL 8 / Postgres 16 matrix (`.github/workflows/*` `phpunit-database` job, `phpunit.mysql.xml`, `phpunit.pgsql.xml`) | |

---

## 3. Multi-tenancy
Mechanism (confirmed):
1. `organization_id` on tenant tables + global scope `app/Models/Scopes/OrganizationScope.php:28-53`: when authenticated, `where(<table>.organization_id = active org)`; authenticated user with null org → `whereRaw('1 = 0')` (fail closed). Trait `app/Models/Concerns/BelongsToOrganization.php` adds the scope and stamps `organization_id` on create.
2. Active org: `OrganizationContext::id()` = `auth()->user()->organization_id`, which `ActiveOrganization` (`app/Services/Organizations/ActiveOrganization.php:190-247, 277-310`) overwrites **in memory** from the session switch (session regenerated + CSRF rotated on switch, lines 198-204) or from the Sanctum token's `organization_id`. DB `users.organization_id` stays the home org (docblock line 40).
3. Scope is applied to 28 models (Product, ProductSerial, ProductBatch, ProductLocation(+Stock), Order, OrderPayment, PurchaseOrder, Customer, Supplier, Warehouse, StockReservation, Shipment, …). **Not** applied (have `organization_id` but rely on manual checks): `StockTransfer`, `StockAdjustment`, `ReturnOrder`, `StockAudit`, `ProductVariant`, `ProductCategory`, `WorkOrder`, `InterCompanyTransfer`, `Webhook`, `WebhookDelivery`, `ActivityLog`, `SavedReport`, `Notification`, `PurchaseOrderItem`, `Role`, `User`, `PermissionSet`, `Setting`, `PersonalAccessToken` (computed by grepping models for `organization_id` without `BelongsToOrganization`).
4. `EnsureTenantOwnership` (`app/Http/Middleware/EnsureTenantOwnership.php:24-44`) 404s any route-bound model of another org — but it is alias `api.tenant` (`bootstrap/app.php:136`) applied only to the "parity endpoints" group (`routes/api.php:313-385`), not to web routes or the earlier API product routes.
5. Controllers do explicit checks for unscoped models, e.g. `StockTransferController::show/authorizeTransfer` (`app/Http/Controllers/Inventory/StockTransferController.php:131-137, 221-227`), `ReturnOrderController` (`app/Http/Controllers/Order/ReturnOrderController.php:141-147, 214-218`), `WorkOrderController::authorizeWorkOrder` (327-331), `ProductCategoryController` (91-117), API `ensureOwned()` in `transition()` (`Api/ReturnOrderController.php:142-144`, `Api/StockTransferController.php:121-123`), GraphQL resolvers `->forOrganization(...)` (`app/GraphQL/Queries/StockTransferQuery.php`, `ReturnOrderQuery.php`), StockAuditReviewService locks with `where('organization_id', $actor->organization_id)`.
6. IDOR scan: I ran a heuristic (every controller method with a route-bound unscoped model, body lacking `organization_id|authorize|ensure|abort|assert|forOrganization`). Flagged 10 methods; all 10 were guarded indirectly on manual inspection (`transition()`→`ensureOwned`; `StockAuditController::reviewCount` → `StockAuditReviewService::decide` lines 23-36 aborts on foreign org). **No IDOR found** by this pass — heuristic, not proof. Weak spot noted by the authors themselves: on web routes without `api.tenant`, FormRequest validation runs before the controller's org check, so a foreign id can return 422 vs 404 (existence oracle) — docblock of `EnsureTenantOwnership.php:16-21`.
7. Writes from a stale tab after org switch refused (`EnsureActiveOrganizationMatches.php`, header `X-Inventoros-Organization`, 409/redirect).
8. Tests: `tests/Feature/OrganizationScopeTest.php`, `NewTenantTablesOrgScopeTest.php`, `GraphQLTenancyScopingTest.php`, `Api/CrossOrgIdorValidationTest.php`, `TenantRoleAssignmentIsolationTest.php`, `PerOrganizationUniqueIdentifiersTest.php`, `Organizations/*` (switching, token binding, background context, portal isolation, ICT) — ~20 files.

Not SaaS-ready (confirmed):
- Public registration (`app/Http/Controllers/Auth/RegisteredUserController.php` `store`) is off by default (`config/auth.php:21` `REGISTRATION_ENABLED=false`) and creates a user **without any organization** (sees nothing due to fail-closed scope). No signup → org provisioning.
- Organizations are created only by the installer (`InstallerController.php:417`) or programmatically via `OrganizationMembershipService::createOrganization()` (`app/Services/Organizations/OrganizationMembershipService.php:266-275`, `@api`, no HTTP route found — grep `createOrganization` in `app/Http` → none).
- Installation-wide concerns: plugins, updates, backups belong to one "plugin administrator organization" (`app/Support/PluginAdministration.php`: first org or `INVENTOROS_PLUGIN_ADMIN_ORG`). No super-admin/tenant console, no billing, no per-tenant domains/subdomains (portal resolves org via `ResolvePortalOrganization` — not inspected in detail).
- `roles.slug` globally unique (`2025_10_13_033034_create_roles_table.php:18`); slugs generated unique (`RoleController.php:246-249`) — works but leaks across tenants via slug suffixes (minor).

Roles/permissions: 60 permissions in `app/Enums/Permission.php` (products, stock, transfer, locations, customers, suppliers, PO incl. receive/approve, orders incl. approve, payments, settings, plugins, audits, approvals, warehouses incl. `access_all_warehouses`, returns, shipments, reports, export/import, activity log). Middleware `permission` / `api.permission` (`CheckPermission`, `CheckApiPermission` — token abilities AND user permissions), policies in `app/Policies/*`. Role assignments are per organization (`2026_10_05_053129_add_organization_id_to_role_user_table.php:37`). **No permission to hide purchase price/profit** from sellers: `ProductResource.php:32` and `ProductVariantResource.php:31` always expose `purchase_price` (grep `view_cost|hide.*cost` → nothing).

---

## 4. POS / sales / payments / documents
- **No POS / cash register UI**: `resources/js/Pages` has Orders, Returns, Customers… but no POS/register/receipt page (grep `point of sale|\bPOS\b|cash register` → nothing relevant). Orders are a back-office sales-order form.
- Payments: `OrderPayment` + `OrderPaymentService` (payments, refunds, voids), methods `cash|card|bank_transfer|cheque|other` (`app/Enums/PaymentMethod.php`) — no Kaspi QR / split tender / shift close / cash drawer.
- Discounts: line + order level, `DiscountType` enum, `OrderService::resolveDiscount` (1349+), `changeOrderDiscount` (996-1015). Tax: order-level + line tax (`computeTotals` 1273+).
- Invoices: `OrderInvoiceNumberService` (per-org sequence), PDF via dompdf `app/Services/Documents/DocumentPdfService.php`, templates `resources/views/pdf/invoice.blade.php`, `purchase-order-invoice.blade.php`, `report.blade.php` — CSS `font-family: 'Helvetica','Arial'` (invoice.blade.php:13). dompdf's built-in Helvetica is Latin-only ⇒ Russian/Kazakh text will very likely render as "?" (inference, not executed); needs DejaVu or embedded font. Emails: `OrderInvoiceEmail`, throttled (`DocumentEmailThrottle`).
- Warranty documents: **not found** (grep `warrant` in app/resources → no domain hits).
- Currency: `config/currencies.php` list (default USD, line 51) — **KZT not present** (grep → none). Money `decimal(10,2)`/(12,2) — OK for tenge.
- UI languages: `lang/` has ru but **no kk**.
- Customer portal (`routes/portal.php`, separate guard `customer`) for orders/returns.

---

## 5. Integrations
- REST API `/api/v1` (`routes/api.php`, 392 lines), Sanctum tokens with abilities limited to held permissions (`app/Http/Controllers/Admin/ApiTokenController.php:52-64`), token bound to org (`ActiveOrganization::bindToToken` 277-289). OpenAPI docs via dedoc/scramble. Token expiry: `expires_at` shown (ApiTokenController:41); `config/sanctum.php` does not exist in repo, so package default (no expiry) applies unless set.
- GraphQL `/graphql` (rebing, 22 queries, 23 mutations). Note: `sort_by` arguments are passed unvalidated to `orderBy` in `ProductsQuery.php:118-120`, `OrdersQuery.php:123`, `PurchaseOrdersQuery.php:98`, `SuppliersQuery.php:89`, `StockAdjustmentsQuery.php:107-109` (REST controllers use allowlists, e.g. `Api/ProductController.php:72-75`). Laravel quotes identifiers so SQL injection is unlikely, but arbitrary-column ordering / 500 errors are possible — low severity.
- MCP server `/mcp` (`routes/ai.php`, `auth:sanctum`, `throttle:api`), 30 tools incl. CreateOrder, AdjustStock, RecordPayment (`app/Mcp/Tools`).
- Outgoing webhooks: `WebhookService` HMAC-SHA256 (`sign` 95-98, `verifySignature` with `hash_equals` 108-113), `WebhookDeliveryJob` 5 tries backoff 60s…24h (lines 63-71), SSRF guard pinning DNS (`app/Support/PublicHostGuard.php`, used `WebhookDeliveryJob.php:261`). Inbound: EasyPost only (`routes/web.php` `/webhooks/easypost/{token}` HMAC).
- Import/export: Excel/CSV for products, orders, users (`app/Imports/*`, `app/Exports/*`), queued (`ProcessProductImportJob`, `ProcessOrderImportJob`), validated mimes 10 MB (`ImportExportController.php:46`), spreadsheet formula stripping (`SpreadsheetSafety`). No serial/IMEI import.
- Barcode: generation (picqer, `BarcodeService`, print views), QR labels, scan lookup (`ScanLookupService`, `Api/BarcodeLookupController`, MCP `LookupBarcodeTool`) — product/variant/location only.
- Plugin system: `plugins/` (hello-world, tax-billing), `HookRegistry` (788 lines; actions/filters `do_action`), plugin UI injection, marketplace with Ed25519-signed packages/entitlements. Upload = RCE by design; off by default (`config/plugins.php:12-20`), optional signature requirement (`PluginService::verifyPluginSignature` 535-565), restricted to plugin-admin org. Plugins are installation-wide — a plugin runs for every tenant.

---

## 6. Security
- Auth: Breeze-style session auth, email verification, `throttle:5,1` on login/password routes (`routes/auth.php:29,36`), 2FA TOTP with recovery codes (`app/Http/Controllers/Auth/TwoFactorController.php`, secret stored `encrypt()`ed line 118; challenge `throttle:5,1` `routes/web/account.php:29`; `EnsureTwoFactorVerified` in web stack). 2FA is optional per user — no org-level enforcement found (not searched exhaustively).
- API rate limit 60/min per user/IP (`app/Providers/AppServiceProvider.php:105-107`); `/api/v1/login` 5/min (`routes/api.php:79`).
- CSRF: standard `web` group; org switch rotates CSRF.
- Sessions: `SESSION_ENCRYPT` default false, `secure` from env, SameSite lax (`config/session.php:53,178,208`). `AuthenticateStaffSession` middleware.
- Headers: `SecurityHeaders` middleware (web+api), `PreventSearchIndexing`, `RejectNonNumericModelKeys`.
- Uploads: logo `image|mimes:png,jpg,jpeg,webp|max:2048|dimensions` stored private (`OrganizationLogoController.php:35-42`); plugin zip mimes + `SafeZipExtractor`; storage disks configurable (S3).
- Mass assignment guard for `role`/`organization_id` on User (`app/Models/User.php` ~120+). Activity log redacts secrets (`tests/Feature/ActivityLogRedactsSecretsTest.php`).
- Installer routes public but refuse after install (`InstallerController` 139/203/403 → 403 "already installed").
- Self-updater + release signature verification (`UpdateService`, `ReleaseSignatureVerifier`) — a SaaS would disable this.

---

## 7. Tests
- Framework: PHPUnit 11.5 (`require-dev`), 429 `*Test.php` files, ~3 909 test methods (grep `public function test|#[Test]|@test`), plus `tests/js` (node --test) and 27 Playwright spec files / ~132 `test(` calls (`e2e/tests`).
- Config `phpunit.xml`: suites Unit + Feature, SQLite `:memory:`, queue sync, excludes group `performance`. `phpunit.mysql.xml` / `phpunit.pgsql.xml` force DB.
- Serial coverage: `tests/Feature/SerialAllocationOnFulfillmentTest.php` (allocate, cancel release, best-effort), `tests/Feature/Api/SerialTrackingApiTest.php` (18 tests in the two files combined), ICT tracked tests. Tenancy: ~20 files (§3). Concurrency: 8 "*Concurrency/*RaceCondition/*Locking" files — simulated, not parallel.
- Commands (from `.github/workflows/tests.yml:38-50`), PHP **8.4** required (`^8.4.1`) with ext mbstring, xml, ctype, iconv, intl, pdo_sqlite, sqlite3, dom, gd, zip, bcmath, sodium (sodium used for Ed25519):
  ```
  composer install --no-interaction --prefer-dist
  cp .env.example .env && php artisan key:generate
  touch database/database.sqlite && php artisan migrate --force   # CI does this; phpunit itself uses :memory:
  php artisan test            # or: vendor/bin/phpunit
  vendor/bin/phpunit --configuration=phpunit.pgsql.xml   # needs a PG with DB inventoros_test + DB_HOST/... env
  vendor/bin/phpunit --configuration=phpunit.mysql.xml
  npm ci && npm run test:js ; npm run test:e2e (Playwright, needs built app)
  ```
  (Not executed here.)

---

## 8. License (AGPL-3.0-only) implications
- `LICENSE` lines 8-17: v2.x is AGPL-3.0-only; "Releases up to and including v1.0.8 were published under the MIT license and remain available under those terms." `composer.json` `"license": "AGPL-3.0-only"`. README:323 states the network clause explicitly.
- AGPL §13: if Prime Mobile OS runs a **modified** v2.x (or a work based on it) as a network service, every user interacting with it (shop staff = your SaaS customers) must be offered the **Corresponding Source of the whole modified program**, under AGPL. Laravel app code you add that is linked into the same program is a derivative → must also be AGPL. A closed commercial SaaS on v2.x is therefore not possible without (a) publishing your source to users, or (b) a separate commercial license from the copyright holder (no dual-license/CLA offer found in README/CONTRIBUTING — grep `commercial|CLA|dual` → none; external contributors' copyright would also need clearing).
- Separate-process services talking over HTTP API are generally not covered, but core-modifying a Laravel monolith is.
- MIT option: only v1.0.8 and earlier. This clone does not contain them (shallow). Per CHANGELOG 2.0.0/2.1.0, everything below was added **after** 1.0.8 and is AGPL-only: organization memberships/switching and token-bound orgs, per-org role assignments, warehouse access restrictions, stock reservations, inter-company transfers, many lock/race fixes ("Stale transfer, return, work-order and stock-audit requests can no longer reopen…"), bin sync fixes, GraphQL/MCP permission checks, reports, approvals, payments, shipping, portal. Whether `OrganizationScope`, `product_location_stocks` (migration dated 2026-07-25) and serial tracking (2026-03-12) existed in 1.0.8 cannot be confirmed here — need `git fetch --unshallow --tags` and `git show v1.0.8:...`. Practically, v1.0.8 would lack most of the hardening that makes v2 attractive.
- Also note dependencies are MIT/BSD-ish (Laravel etc.), not a constraint; dompdf is LGPL-2.1.

---

## 9. Fit for Prime Mobile OS (what would have to be built/changed)
1. Serial-first model: `product_serials` + `imei2`, `variant_id`, `location_id`/`warehouse_id`, `purchase_cost`, `purchase_order_item_id`, `supplier_id`, status history table; make serials authoritative (stock = count of available serials) for serial-tracked SKUs; strict mode always on.
2. Scan IMEI at receive, transfer, sale, return, stocktake; ScanLookup for serials; serial import.
3. Branch-level availability (per-warehouse check, no silent cross-branch draw).
4. POS screen (fast cart, scan, split payment incl. Kaspi, receipt/фискальный чек integration, shift/cash), warranty doc PDF with Cyrillic fonts, kk locale, KZT.
5. Per-unit costing/profit, cost visibility permission.
6. SaaS layer: tenant signup/provisioning, super-admin, billing, disable installer/updater/plugin upload, per-tenant plugins.
7. Licensing decision first (AGPL vs MIT v1.0.8 vs clean-room using it only as reference).
