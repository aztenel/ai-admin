"""Prime Mobile OS — ERPNext v15: два процесса одновременно продают один серийный номер (IMEI).
Локальный тестовый сайт pm.localhost, вымышленные данные, тестовые записи ERPNext (_Test Company).
Запуск: cd ~/lab/frappe-bench/sites && ../env/bin/python ../pm_concurrency.py <sales|pos> [runs]
"""

import os
import random
import sys
import time

import frappe

SITE = "pm.localhost"
KIND = sys.argv[1] if len(sys.argv) > 1 else "sales"
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
COMMON = dict(
	company="_Test Company",
	debit_to="Debtors - _TC",
	warehouse="Stores - _TC",
	income_account="Sales - _TC",
	expense_account="Cost of Goods Sold - _TC",
	cost_center="Main - _TC",
	account_for_change_amount="Cash - _TC",
)


def connect():
	frappe.init(site=SITE, sites_path=".")
	frappe.connect()
	frappe.set_user("Administrator")


def receive(imei):
	from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

	make_stock_entry(
		item_code="_Test Serialized Item", target="Stores - _TC", qty=1, basic_rate=100000,
		company="_Test Company", serial_no=imei, use_serial_batch_fields=1,
	)
	frappe.db.commit()


def sell(imei, customer):
	if KIND == "pos":
		from erpnext.accounts.doctype.pos_invoice.test_pos_invoice import create_pos_invoice

		doc = create_pos_invoice(item="_Test Serialized Item", rate=450000, serial_no=imei,
			use_serial_batch_fields=1, customer=customer, do_not_save=1, **COMMON)
		doc.append("payments", {"mode_of_payment": "Cash", "amount": 450000})
	else:
		from erpnext.accounts.doctype.sales_invoice.test_sales_invoice import create_sales_invoice

		doc = create_sales_invoice(item="_Test Serialized Item", rate=450000, update_stock=1,
			serial_no=imei, use_serial_batch_fields=1, customer=customer, do_not_save=1,
			company="_Test Company", debit_to="Debtors - _TC", warehouse="Stores - _TC",
			income_account="Sales - _TC", expense_account="Cost of Goods Sold - _TC",
			cost_center="Main - _TC")
	doc.insert()
	doc.submit()
	frappe.db.commit()
	return doc.name


connect()
frappe.db.set_value("Item", "_Test Serialized Item", "has_serial_no", 1)
frappe.db.commit()
both = 0
for n in range(RUNS):
	imei = "35" + "".join(random.choice("0123456789") for _ in range(13))
	receive(imei)
	frappe.destroy()
	start = time.time() + 1.0
	pids = []
	for cust in ("_Test Customer", "_Test Customer 1"):
		pid = os.fork()
		if pid == 0:
			try:
				connect()
				while time.time() < start:
					time.sleep(0.0002)
				name = sell(imei, cust)
				print(f"   run{n} {cust}: OK {name}", flush=True)
				os._exit(0)
			except Exception as e:
				print(f"   run{n} {cust}: REFUSED {type(e).__name__}: {str(e)[:150]}", flush=True)
				os._exit(1)
		pids.append(pid)
	codes = [os.waitpid(p, 0)[1] >> 8 for p in pids]
	connect()
	sle = frappe.db.sql(
		"""select count(*) from `tabSerial and Batch Entry` e join `tabSerial and Batch Bundle` b on b.name=e.parent
		where e.serial_no=%s and b.type_of_transaction='Outward' and b.docstatus=1""", imei)[0][0]
	if codes.count(0) == 2:
		both += 1
	print(f"run {n}: imei={imei} successes={codes.count(0)} outward_bundles={sle}", flush=True)
print(f"SUMMARY kind={KIND} both_succeeded={both}/{RUNS}")
