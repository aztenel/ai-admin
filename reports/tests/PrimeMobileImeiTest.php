<?php

/*
 * Prime Mobile OS — исследовательские сценарии (ветка research/prime-mobile-tests).
 * Каждый тест проверяет ЖЕЛАЕМОЕ поведение для магазина телефонов.
 * Упавший тест = пробел платформы. Наблюдаемые значения пишутся в STDERR строкой "PM>".
 * Только локальная тестовая БД и вымышленные IMEI.
 */

use Webkul\Inventory\Facades\Inventory;
use Webkul\Inventory\Models\Lot;
use Webkul\Inventory\Models\ProductQuantity;
use Webkul\PointOfSale\Enums\OrderState;
use Webkul\PointOfSale\Facades\PointOfSale;
use Webkul\PointOfSale\Models\Order;

require_once __DIR__.'/../../../../support/tests/Helpers/TestBootstrapHelper.php';
require_once __DIR__.'/../../../../support/tests/Helpers/CompanyHelper.php';
require_once __DIR__.'/../../../../inventories/tests/Helpers/InventoryHelper.php';
require_once __DIR__.'/../../Helpers/PosHelper.php';

function pm(string $msg): void
{
    fwrite(STDERR, "PM> {$msg}\n");
}

function pmSell($t, $product, ?string $imei, float $qty = 1, ?string $uuid = null): Order
{
    $extra = $imei ? ['lots' => [['lot_name' => $imei, 'qty' => $qty]]] : [];

    return PointOfSale::syncOrder(PosHelper::orderPayload(
        $t->config,
        $t->session,
        [PosHelper::line($product->id, $qty, 100000.0, $extra)],
        [PosHelper::payment($t->cash, 100000.0 * $qty)],
        $uuid ? ['uuid' => $uuid] : [],
    ));
}

function pmQty($product, $location, ?int $lotId = null): float
{
    return (float) ProductQuantity::query()
        ->where('product_id', $product->id)
        ->where('location_id', $location->id)
        ->when($lotId, fn ($q) => $q->where('lot_id', $lotId))
        ->sum('quantity');
}

beforeEach(function () {
    TestBootstrapHelper::ensurePluginInstalled('inventories');
    TestBootstrapHelper::ensurePluginInstalled('accounts');
    TestBootstrapHelper::ensurePluginInstalled('point-of-sale');

    InventoryHelper::actingAsAdmin();

    $this->warehouse = InventoryHelper::warehouse();
    $this->stock = $this->warehouse->lotStockLocation;
    $this->session = PosHelper::openSession($this->warehouse);
    $this->config = $this->session->config;
    $this->cash = $this->config->paymentMethods->first();

    InventoryHelper::trackLots($this->warehouse->outType);
    $this->phone = InventoryHelper::serialTrackedProduct(['name' => 'iPhone 16 128GB Black']);
    $this->imei = InventoryHelper::lot($this->phone, '356000000000011');
    InventoryHelper::stockUp($this->phone, $this->stock, 1, $this->imei->id);
});

it('PM-01 sells one phone by IMEI and takes it out of stock', function () {
    $order = pmSell($this, $this->phone, $this->imei->name);

    pm('PM-01 state='.$order->state->value.' failed_op='.var_export($order->has_failed_operation, true)
        .' qty_after='.pmQty($this->phone, $this->stock, $this->imei->id));

    expect($order->state)->toBe(OrderState::PAID)
        ->and($order->has_failed_operation)->toBeFalse()
        ->and(pmQty($this->phone, $this->stock, $this->imei->id))->toBe(0.0);
});

it('PM-02 refuses to sell the same IMEI a second time', function () {
    pmSell($this, $this->phone, $this->imei->name);

    $second = null;
    $error = null;

    try {
        $second = pmSell($this, $this->phone, $this->imei->name);
    } catch (Throwable $e) {
        $error = get_class($e).': '.$e->getMessage();
    }

    pm('PM-02 error='.($error ?? 'none')
        .' second_state='.($second?->state?->value ?? '-')
        .' failed_op='.var_export($second?->has_failed_operation, true)
        .' qty_after='.pmQty($this->phone, $this->stock, $this->imei->id)
        .' paid_orders='.Order::query()->where('state', OrderState::PAID)->count());

    // Желаемо: вторая продажа отклонена ДО оплаты, остаток не уходит в минус.
    expect($error)->not->toBeNull()
        ->and(pmQty($this->phone, $this->stock, $this->imei->id))->toBe(0.0);
});

it('PM-03 refuses a sale of a tracked phone without an IMEI', function () {
    $error = null;
    $order = null;

    try {
        $order = pmSell($this, $this->phone, null);
    } catch (Throwable $e) {
        $error = get_class($e).': '.$e->getMessage();
    }

    pm('PM-03 error='.($error ?? 'none').' state='.($order?->state?->value ?? '-')
        .' lot_on_line='.var_export($order?->lines()->first()?->lots->first()?->lot_name, true));

    expect($error)->not->toBeNull();
});

it('PM-04 refuses a sale of an IMEI that was never received', function () {
    $error = null;
    $order = null;

    try {
        $order = pmSell($this, $this->phone, '356999999999999');
    } catch (Throwable $e) {
        $error = get_class($e).': '.$e->getMessage();
    }

    pm('PM-04 error='.($error ?? 'none').' state='.($order?->state?->value ?? '-')
        .' lot_created='.var_export(Lot::query()->where('name', '356999999999999')->exists(), true)
        .' failed_op='.var_export($order?->has_failed_operation, true));

    expect($error)->not->toBeNull()
        ->and(Lot::query()->where('name', '356999999999999')->exists())->toBeFalse();
});

it('PM-05 returns a sold phone back to stock with the same IMEI', function () {
    $order = pmSell($this, $this->phone, $this->imei->name);
    $line = $order->lines()->first();

    $refund = PointOfSale::refundOrder($order, [$line->id => 1]);
    PointOfSale::syncOrder([
        'uuid'       => $refund->uuid,
        'config_id'  => $refund->config_id,
        'session_id' => $refund->session_id,
        'payments'   => [PosHelper::payment($this->cash, -100000.0)],
    ]);
    $refund->refresh();

    $retLot = $refund->operation?->moves->first()?->lines->first()?->lot_id;
    pm('PM-05 refund_state='.$refund->state->value.' op_state='.($refund->operation?->state?->value ?? '-')
        .' return_lot='.var_export($retLot, true).' expected_lot='.$this->imei->id
        .' qty_after='.pmQty($this->phone, $this->stock, $this->imei->id));

    expect(pmQty($this->phone, $this->stock, $this->imei->id))->toBe(1.0);
});

it('PM-06 moves one IMEI between two branches', function () {
    InventoryHelper::enableLocations();
    $branch1 = InventoryHelper::warehouse();
    $branch2 = InventoryHelper::warehouse();
    $this->stock = $branch1->lotStockLocation;
    $this->imei = InventoryHelper::lot($this->phone, '356000000000077');
    InventoryHelper::stockUp($this->phone, $this->stock, 1, $this->imei->id);
    InventoryHelper::trackLots($branch1->internalType ?? $branch1->outType);
    $error = null;

    try {
        $op = InventoryHelper::internalTransfer($branch1, $this->stock, $branch2->lotStockLocation, [[$this->phone, 1]]);
        Inventory::confirmTransfer($op);
        Inventory::completeTransfer($op->refresh());
        $state = $op->refresh()->state->value;
    } catch (Throwable $e) {
        $error = get_class($e).': '.$e->getMessage();
        $state = '-';
    }

    pm('PM-06 error='.($error ?? 'none').' op_state='.$state
        .' branch1='.pmQty($this->phone, $this->stock, $this->imei->id)
        .' branch2='.pmQty($this->phone, $branch2->lotStockLocation, $this->imei->id));

    expect($error)->toBeNull()
        ->and(pmQty($this->phone, $this->stock, $this->imei->id))->toBe(0.0)
        ->and(pmQty($this->phone, $branch2->lotStockLocation, $this->imei->id))->toBe(1.0);
});

it('PM-07 refuses to sell an accessory below zero stock', function () {
    $case = InventoryHelper::product(['name' => 'Case iPhone 16']);
    $error = null;
    $order = null;

    try {
        $order = pmSell($this, $case, null, 1);
    } catch (Throwable $e) {
        $error = get_class($e).': '.$e->getMessage();
    }

    pm('PM-07 error='.($error ?? 'none').' state='.($order?->state?->value ?? '-')
        .' qty_after='.pmQty($case, $this->stock));

    expect(pmQty($case, $this->stock))->toBeGreaterThanOrEqual(0.0);
});

it('PM-08 refuses a second lot record with the same IMEI', function () {
    $error = null;

    try {
        InventoryHelper::lot($this->phone, $this->imei->name);
    } catch (Throwable $e) {
        $error = get_class($e).': '.$e->getMessage();
    }

    $otherModel = InventoryHelper::serialTrackedProduct(['name' => 'Samsung S25']);
    $error2 = null;

    try {
        InventoryHelper::lot($otherModel, $this->imei->name);
    } catch (Throwable $e) {
        $error2 = get_class($e).': '.$e->getMessage();
    }

    pm('PM-08 same_product_error='.($error ?? 'none').' other_product_error='.($error2 ?? 'none')
        .' lots_with_imei='.Lot::query()->where('name', $this->imei->name)->count());

    expect(Lot::query()->where('name', $this->imei->name)->count())->toBe(1);
});

it('PM-09 processes one POS operation only once when it is sent twice', function () {
    $uuid = (string) Illuminate\Support\Str::uuid();
    $case = InventoryHelper::product(['name' => 'Charger']);
    InventoryHelper::stockUp($case, $this->stock, 5);

    $payload = PosHelper::orderPayload($this->config, $this->session,
        [PosHelper::line($case->id, 1, 5000.0)], [PosHelper::payment($this->cash, 5000.0)], ['uuid' => $uuid]);

    PointOfSale::syncOrder($payload);
    PointOfSale::syncOrder($payload);

    pm('PM-09 orders_with_uuid='.Order::query()->where('uuid', $uuid)->count().' qty_after='.pmQty($case, $this->stock));

    expect(Order::query()->where('uuid', $uuid)->count())->toBe(1)
        ->and(pmQty($case, $this->stock))->toBe(4.0);
});

it('PM-10 keeps history when a sold product is deleted', function () {
    $order = pmSell($this, $this->phone, $this->imei->name);
    $error = null;

    try {
        $this->phone->delete();
    } catch (Throwable $e) {
        $error = 'soft: '.get_class($e).': '.$e->getMessage();
    }

    $errorHard = null;

    try {
        Illuminate\Support\Facades\DB::transaction(fn () => $this->phone->forceDelete());
    } catch (Throwable $e) {
        $errorHard = get_class($e).': '.substr($e->getMessage(), 0, 160);
    }

    $line = $order->lines()->withoutGlobalScopes()->first();
    pm('PM-10 soft='.($error ?? 'ok').' hard='.($errorHard ?? 'ok (deleted!)')
        .' line_exists='.var_export((bool) $line, true)
        .' lot_exists='.var_export(Lot::withoutGlobalScopes()->whereKey($this->imei->id)->exists(), true));

    expect($errorHard)->not->toBeNull();
});

it('PM-11 hides company A stock and IMEIs from a user of company B', function () {
    $companyA = InventoryHelper::company();
    $companyB = CompanyHelper::company();

    CompanyHelper::actingAsCompanyUser($companyB);

    $lots = Lot::query()->pluck('id');
    $quants = ProductQuantity::query()->where('product_id', $this->phone->id)->count();
    $products = Webkul\Inventory\Models\Product::query()->whereKey($this->phone->id)->count();
    $orders = Order::query()->count();

    pm("PM-11 companyA={$companyA->id} companyB={$companyB->id} lot_visible=".var_export($lots->contains($this->imei->id), true)
        ." quants_visible={$quants} product_visible={$products} pos_orders_visible={$orders}");

    expect($lots)->not->toContain($this->imei->id)
        ->and($quants)->toBe(0)
        ->and($products)->toBe(0);
});
