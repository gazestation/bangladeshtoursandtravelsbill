# Supabase accounting regression checklist

Run these checks only against a dedicated Supabase test project/branch after applying the migration. Use test-only users and data; never use a live customer account for concurrency or idempotency tests.

1. **Staff access:** create an active admin test user and confirm they can sign in and read customer/accounting views.
2. **Inactive user:** sign in with an Auth user not in `staff_members` (or an inactive staff row) and confirm no customer/accounting access is granted.
3. **Empty customer:** create a customer without opening balances; due, advance and net balances should all be zero.
4. **Opening due:** create a customer with opening due ৳10,000; one opening-balance bill and a net due of ৳10,000 should appear.
5. **Opening advance:** create a customer with opening advance ৳2,000 and no due; net balance should be -৳2,000 and advance should be ৳2,000.
6. **Opening due plus advance:** create a customer with opening due ৳10,000 and advance ৳3,000; advance allocation should reduce the opening bill's outstanding to ৳7,000 and customer due should be ৳7,000.
7. **New travel bills:** create two bills of ৳5,000 for one customer; total due should increase by ৳10,000 and both bill numbers must be unique.
8. **FIFO payment:** with opening due ৳10,000 and two bills of ৳5,000 each, record ৳7,000; the oldest bill should receive allocation first, and total net due should be ৳13,000.
9. **Overpayment:** record a payment larger than all open bills; invoice outstanding amounts must never be negative, and the excess must remain as advance.
10. **Advance carry-forward:** create a new bill for the customer with advance; available credit should auto-allocate to that bill, FIFO, without creating another payment.
11. **Positive adjustment:** create a positive adjustment; a separate adjustment charge bill should appear. Existing advance must allocate against it before leaving an outstanding balance.
12. **Negative adjustment:** create a negative adjustment; its credit should settle oldest open bills first, with any remainder retained as customer advance.
13. **Idempotency exact retry:** call each create RPC twice with the same operation key and identical arguments; the same record ID should return and no duplicate ledger movements should be created.
14. **Idempotency mismatch:** reuse an operation key with different amount/customer/description; the RPC should reject it and leave database rows unchanged.
15. **Concurrent operations:** run simultaneous bill/payment calls for one customer; row locking must prevent over-allocation and balances must reconcile.
16. **Ledger reconciliation:** compare each running ledger balance to the sum of signed entries and each bill total to allocations plus outstanding amount.
17. **Write protection:** attempt direct insert/update/delete of bills, payments, ledger entries and allocations from an authenticated browser session; RLS/grants should deny direct writes.
18. **Invoice output:** generate a bill PDF with English and Bengali/Devanagari customer details; confirm the PDF stays readable. Test the mobile share sheet if supported and confirm the desktop WhatsApp fallback downloads the PDF and opens a prefilled message.

## Release gate

Do not apply production migrations until the exact Supabase project, existing schema, backup/restore path, and rollback strategy have been verified. These are test steps and expected results, not a claim that a real Supabase database has already been migrated or tested.
