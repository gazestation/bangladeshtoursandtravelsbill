# Supabase accounting regression checklist

Run these checks only against a dedicated Supabase test project/branch after applying the migration.

1. Create an active staff user and confirm inactive/non-staff sessions cannot read accounting tables or execute RPCs.
2. Create a customer with opening due 10,000 and opening advance 0; confirm one opening-balance bill and a net due of 10,000.
3. Record two bills of 5,000 each and a payment of 7,000; confirm allocations hit the oldest invoice first, each allocation is within the bill balance, and net due is 13,000.
4. Repeat a bill/payment RPC with the same operation key and identical arguments; confirm no duplicate record or ledger entry is created.
5. Reuse an operation key with different arguments; confirm the RPC rejects it without writing anything.
6. Create a payment larger than all current bills; confirm the excess remains a customer advance and is applied to later bills.
7. Run two concurrent payment/bill requests for the same customer; confirm customer-level locking prevents over-allocation.
8. Compare the sum of signed ledger movements to the customer balance summary and compare each invoice total to its allocations plus outstanding amount.
9. Attempt direct insert/update/delete of ledger entries and financial records from an authenticated browser session; confirm RLS denies it.

Do not apply production migrations until the exact Supabase project, existing schema, backup/restore path, and rollback strategy have been verified.
