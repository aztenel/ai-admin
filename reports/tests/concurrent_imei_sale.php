<?php

/*
 * Prime Mobile OS — настоящий параллельный тест: два процесса PHP одновременно
 * продают через POS один и тот же IMEI. Отдельная локальная БД aureus_conc.
 * Запуск: DB_DATABASE=aureus_conc php research/concurrent_imei_sale.php [runs]
 */

use Illuminate\Support\Facades\DB;
use Webkul\Inventory\Models\ProductQuantity;
use Webkul\PointOfSale\Facades\PointOfSale;
use Webkul\PointOfSale\Models\Order;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

foreach (['inventories/tests/Helpers/InventoryHelper.php', 'point-of-sale/tests/Helpers/PosHelper.php'] as $f) {
    require_once __DIR__.'/../plugins/webkul/'.$f;
}

$runs = (int) ($argv[1] ?? 5);
$summary = ['both_paid' => 0, 'one_paid' => 0, 'neg_stock' => 0];

for ($run = 1; $run <= $runs; $run++) {
    InventoryHelper::actingAsAdmin();
    $warehouse = InventoryHelper::warehouse();
    $stock = $warehouse->lotStockLocation;
    $session = PosHelper::openSession($warehouse);
    $config = $session->config;
    $cash = $config->paymentMethods->first();
    InventoryHelper::trackLots($warehouse->outType);
    $phone = InventoryHelper::serialTrackedProduct(['name' => "Phone run {$run}"]);
    $imei = '35600000'.str_pad((string) (random_int(0, 9999999)), 7, '0', STR_PAD_LEFT);
    $lot = InventoryHelper::lot($phone, $imei);
    InventoryHelper::stockUp($phone, $stock, 1, $lot->id);

    $start = microtime(true) + 1.0;
    DB::disconnect();
    $pids = [];

    for ($i = 0; $i < 2; $i++) {
        $pid = pcntl_fork();
        if ($pid === 0) {
            DB::reconnect();
            InventoryHelper::actingAsAdmin();
            while (microtime(true) < $start) {
                usleep(200);
            }
            try {
                $o = PointOfSale::syncOrder(PosHelper::orderPayload($config, $session,
                    [PosHelper::line($phone->id, 1, 450000.0, ['lots' => [['lot_name' => $imei, 'qty' => 1]]])],
                    [PosHelper::payment($cash, 450000.0)]));
                fwrite(STDERR, "  run{$run} child{$i}: order={$o->id} state={$o->state->value} failed_op=".var_export($o->has_failed_operation, true)."\n");
            } catch (Throwable $e) {
                fwrite(STDERR, "  run{$run} child{$i}: EXCEPTION ".get_class($e).': '.substr($e->getMessage(), 0, 200)."\n");
            }
            exit(0);
        }
        $pids[] = $pid;
    }
    foreach ($pids as $p) {
        pcntl_waitpid($p, $status);
    }

    DB::reconnect();
    $paid = Order::withoutGlobalScopes()->where('session_id', $session->id)->where('state', 'paid')->count();
    $okOps = Order::withoutGlobalScopes()->where('session_id', $session->id)->where('state', 'paid')->where('has_failed_operation', false)->count();
    $qty = (float) ProductQuantity::withoutGlobalScopes()->where('product_id', $phone->id)->where('location_id', $stock->id)->sum('quantity');
    echo "run {$run}: imei={$imei} paid_orders={$paid} orders_with_stock_done={$okOps} stock_qty_after={$qty}\n";
    $summary[$paid >= 2 ? 'both_paid' : 'one_paid']++;
    if ($qty < 0) {
        $summary['neg_stock']++;
    }
}

echo 'SUMMARY '.json_encode($summary)."\n";
