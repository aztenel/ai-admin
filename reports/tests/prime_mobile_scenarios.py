"""Prime Mobile OS — сценарии IMEI для InvenTree через настоящий REST API (DRF APIClient)
на локальной базе PostgreSQL `inventree`. Параллельные сценарии — два процесса (fork),
каждый со своим соединением с базой. Только вымышленные данные.

Запуск: cd src/backend/InvenTree && . inv.env && python ../../../research/prime_mobile_scenarios.py
"""

import os
import random
import sys
import time
import traceback

sys.path.insert(0, os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'InvenTree.settings')

import django  # noqa: E402

django.setup()

from django.contrib.auth.models import User  # noqa: E402
from django.db import connections  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from company.models import Company  # noqa: E402
from part.models import Part  # noqa: E402
from stock.models import StockItem, StockLocation  # noqa: E402

RES = []


def log(code, ok, detail):
    """Записать результат сценария."""
    RES.append((code, ok, detail))
    print(f'PM> {code} {"PASS" if ok else "FAIL"} {detail}', flush=True)


def client(user):
    """API-клиент от имени пользователя."""
    c = APIClient()
    c.force_authenticate(user=user)
    return c


admin, _ = User.objects.get_or_create(
    username='pm_admin', defaults={'is_staff': True, 'is_superuser': True}
)
admin.is_superuser = True
admin.is_staff = True
admin.save()
api = client(admin)

tag = str(random.randint(10000, 99999))
shopA = StockLocation.objects.create(name=f'Branch A {tag}')
shopB = StockLocation.objects.create(name=f'Branch B {tag}')
cust = Company.objects.create(name=f'Retail customer {tag}', is_customer=True)
phone = Part.objects.create(
    name=f'iPhone 16 128GB {tag}', trackable=True, salable=True, component=False,
    description='test',
)
case = Part.objects.create(name=f'Case {tag}', salable=True, description='test')


def new_imei():
    """Вымышленный IMEI."""
    return '35' + ''.join(random.choice('0123456789') for _ in range(13))


def stock_phone(imei, loc=shopA):
    """Приход телефона с IMEI через API."""
    r = api.post(
        '/api/stock/',
        {'part': phone.pk, 'location': loc.pk, 'quantity': 1, 'serial_numbers': imei},
        format='json',
    )
    assert r.status_code == 201, (r.status_code, r.data)
    return StockItem.objects.get(part=phone, serial=imei)


def assign(item, c=api):
    """Продажа (выдача клиенту) через API."""
    return c.post(
        '/api/stock/assign/',
        {'items': [{'item': item.pk}], 'customer': cust.pk},
        format='json',
    )


# PM-01 продажа одного телефона
imei1 = new_imei()
it1 = stock_phone(imei1)
r = assign(it1)
it1.refresh_from_db()
log('PM-01', r.status_code == 201 and it1.customer_id == cust.pk and not it1.in_stock,
    f'status={r.status_code} customer={it1.customer_id} in_stock={it1.in_stock}')

# PM-02 повторная продажа того же IMEI
r = assign(it1)
log('PM-02', r.status_code == 400, f'status={r.status_code} body={str(getattr(r, "data", ""))[:160]}')

# PM-03 приход того же IMEI второй раз (тот же товар)
r = api.post('/api/stock/', {'part': phone.pk, 'location': shopA.pk, 'quantity': 1,
                             'serial_numbers': imei1}, format='json')
log('PM-03', r.status_code == 400,
    f'status={r.status_code} rows={StockItem.objects.filter(part=phone, serial=imei1).count()}')

# PM-03b тот же IMEI под другим товаром
other = Part.objects.create(name=f'Samsung S25 {tag}', trackable=True, salable=True,
                            description='test')
r = api.post('/api/stock/', {'part': other.pk, 'location': shopA.pk, 'quantity': 1,
                             'serial_numbers': imei1}, format='json')
log('PM-03b', r.status_code == 400,
    f'status={r.status_code} rows_any_part={StockItem.objects.filter(serial=imei1).count()} '
    '(SERIAL_NUMBER_GLOBALLY_UNIQUE по умолчанию выключен)')

# PM-04 возврат проданного телефона в филиал A
r = api.post('/api/stock/return/', {'items': [{'pk': it1.pk, 'quantity': 1}], 'location': shopA.pk},
             format='json')
it1.refresh_from_db()
print('   return body', getattr(r,'data',''))
log('PM-04', r.status_code in (200, 201) and it1.in_stock and it1.location_id == shopA.pk,
    f'status={r.status_code} in_stock={it1.in_stock} loc={it1.location_id} serial={it1.serial}')

# PM-05 перемещение IMEI между филиалами
r = api.post('/api/stock/transfer/', {'items': [{'pk': it1.pk, 'quantity': 1}],
                                      'location': shopB.pk, 'notes': 'A->B'}, format='json')
it1.refresh_from_db()
log('PM-05', r.status_code in (200, 201) and it1.location_id == shopB.pk,
    f'status={r.status_code} loc={it1.location_id} (B={shopB.pk})')

# PM-06 списание аксессуара больше остатка
acc = StockItem.objects.create(part=case, location=shopA, quantity=2)
r = api.post('/api/stock/remove/', {'items': [{'pk': acc.pk, 'quantity': 5}],
                                    'notes': 'over'}, format='json')
left = StockItem.objects.filter(pk=acc.pk).first()
log('PM-06', r.status_code == 400 and left is not None and left.quantity == 2,
    f'status={r.status_code} item_exists={left is not None} qty_after={left.quantity if left else None} body={str(getattr(r, "data", ""))[:120]}')

# PM-07 удаление товара с историей продаж
r = api.delete(f'/api/part/{phone.pk}/')
exists = Part.objects.filter(pk=phone.pk).exists()
log('PM-07', exists, f'status={r.status_code} part_still_exists={exists} '
    f'stock_rows={StockItem.objects.filter(part_id=phone.pk).count()}')

# PM-08 повтор одной и той же операции (нет ключа идемпотентности): списание дважды
acc2 = StockItem.objects.create(part=case, location=shopA, quantity=10)
body = {'items': [{'pk': acc2.pk, 'quantity': 1}], 'notes': 'sale #42'}
api.post('/api/stock/remove/', body, format='json')
api.post('/api/stock/remove/', body, format='json')
acc2.refresh_from_db()
log('PM-08', acc2.quantity == 9, f'qty_after={acc2.quantity} (ожидали 9 при идемпотентности)')

# PM-09 сотрудник без прав на склад
clerk, _ = User.objects.get_or_create(username=f'pm_clerk_{tag}')
r = assign(stock_phone(new_imei()), c=client(clerk))
log('PM-09', r.status_code in (401, 403), f'status={r.status_code} (пользователь без ролей)')


# PM-10 два одновременных процесса продают один IMEI
def race(kind, runs=10):
    both = 0
    for n in range(runs):
        item = stock_phone(new_imei())
        start = time.time() + 0.7
        connections.close_all()
        pids = []
        for _i in range(2):
            pid = os.fork()
            if pid == 0:
                try:
                    c = client(User.objects.get(pk=admin.pk))
                    while time.time() < start:
                        time.sleep(0.0002)
                    if kind == 'assign':
                        r = assign(item, c)
                    os._exit(0 if r.status_code == 201 else 1)
                except Exception:
                    traceback.print_exc()
                    os._exit(2)
            pids.append(pid)
        codes = [os.waitpid(p, 0)[1] >> 8 for p in pids]
        ok = codes.count(0)
        if ok >= 2:
            both += 1
        hist = item.tracking_info.count() if hasattr(item, 'tracking_info') else -1
        print(f'   {kind} run{n}: successes={ok} exit_codes={codes} tracking_rows={hist}', flush=True)
    return both


cust2 = Company.objects.create(name=f'Second customer {tag}', is_customer=True)


def race2(runs=10):
    """Два кассира, два РАЗНЫХ клиента, один IMEI, ручная выдача /api/stock/assign/."""
    both = 0
    for n in range(runs):
        item = stock_phone(new_imei())
        start = time.time() + 0.7
        connections.close_all()
        pids = []
        for i, cu in enumerate((cust, cust2)):
            pid = os.fork()
            if pid == 0:
                c = client(User.objects.get(pk=admin.pk))
                while time.time() < start:
                    time.sleep(0.0002)
                r = c.post('/api/stock/assign/', {'items': [{'item': item.pk}], 'customer': cu.pk}, format='json')
                os._exit(0 if r.status_code == 201 else 1)
            pids.append(pid)
        codes = [os.waitpid(p, 0)[1] >> 8 for p in pids]
        sent = 'n/a'
        item.refresh_from_db()
        if codes.count(0) == 2:
            both += 1
        print(f'   assign2 run{n}: successes={codes.count(0)} sent_to_customer_events={sent} final_customer={item.customer_id}', flush=True)
    return both


both = race2()
log('PM-10', both == 0, f'двум разным клиентам один IMEI продан в {both} из 10 прогонов (/api/stock/assign/)')


def make_so(cu):
    so = api.post('/api/order/so/', {'customer': cu.pk, 'description': 'pm'}, format='json').data
    line = api.post('/api/order/so-line/', {'order': so['pk'], 'part': phone.pk, 'quantity': 1}, format='json').data
    sh = api.post('/api/order/so/shipment/', {'order': so['pk'], 'reference': f'S{random.randint(1,10**6)}'}, format='json').data
    return so['pk'], line['pk'], sh['pk']


def alloc(c, so, line, sh, imei):
    return c.post(f'/api/order/so/{so}/allocate-serials/', {'line_item': line, 'quantity': 1, 'serial_numbers': imei, 'shipment': sh}, format='json')


# PM-11 заказ покупателя: тот же IMEI во второй заказ последовательно
imeiS = new_imei(); itS = stock_phone(imeiS)
a = make_so(cust); b = make_so(cust2)
r1 = alloc(api, *a, imeiS); r2 = alloc(api, *b, imeiS)
log('PM-11', r1.status_code == 201 and r2.status_code == 400, f'first={r1.status_code} second={r2.status_code} {str(getattr(r2, "data", ""))[:140]}')


def race_so(runs=10):
    from order.models import SalesOrderAllocation
    both = 0
    for n in range(runs):
        imei = new_imei(); item = stock_phone(imei)
        orders = [make_so(cust), make_so(cust2)]
        start = time.time() + 0.7
        connections.close_all()
        pids = []
        for o in orders:
            pid = os.fork()
            if pid == 0:
                c = client(User.objects.get(pk=admin.pk))
                while time.time() < start:
                    time.sleep(0.0002)
                r = alloc(c, *o, imei)
                os._exit(0 if r.status_code == 201 else 1)
            pids.append(pid)
        codes = [os.waitpid(p, 0)[1] >> 8 for p in pids]
        n_alloc = SalesOrderAllocation.objects.filter(item_id=item.pk).count()
        if n_alloc >= 2:
            both += 1
        print(f'   so-alloc run{n}: successes={codes.count(0)} allocations_of_same_imei={n_alloc}', flush=True)
    return both


both = race_so()
log('PM-12', both == 0, f'один IMEI распределён в два заказа одновременно в {both} из 10 прогонов (allocate-serials)')

print('SUMMARY', sum(1 for r in RES if r[1]), 'pass /', len(RES))
