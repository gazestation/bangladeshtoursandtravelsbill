# Bangladesh Tours & Travels Bill Book

A clean-room accounting application for Bangladesh Tours & Travels, built with Next.js, TypeScript, Tailwind CSS and Supabase.

## Implemented in this branch

- Staff-only sign-in (no public sign-up form).
- Customer records with independent opening due and opening advance.
- Travel bills and payment receipts.
- Signed customer ledger and ledger-derived due/advance summaries.
- FIFO payment allocation against oldest open bills.
- Carry-forward customer advances, automatically applied to later bills.
- Idempotent, transactional database RPCs for customer, bill, payment, and adjustment creation.
- Bill list with browser print-to-PDF layout and WhatsApp bill-summary sharing (attach the saved PDF manually when needed).
- Responsive dashboard and CI checks for accounting math + production build.

## Local development

1. Use Node.js 20.9+.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env.local` and fill in the **verified** Supabase project's URL and anon/publishable key.
4. Start the app: `npm run dev`.
5. Run accounting unit tests: `npm test`.
6. Run the release build: `npm run build`.

Never expose a Supabase service-role key in a `NEXT_PUBLIC_*` variable or browser code.

## Supabase setup — test project first

**Do not apply this migration to a live database until its project identity and current schema have been checked and a backup/restore plan is ready.** The migration is written as a clean-room foundation; it is not a verified compatibility migration for an already populated Supabase project.

1. Create or select a dedicated Supabase test project/branch. Confirm its project reference in the dashboard and compare it to the environment URL before making changes.
2. Apply `supabase/migrations/20261011100000_accounting_core.sql` to that test database only.
3. In Supabase Auth, create/invite the first staff user and disable public sign-ups for this internal app.
4. In the SQL editor for the same test project, add that user's Auth UUID to the allowlist:

   ```sql
   insert into public.staff_members (user_id, display_name, role, active)
   values ('AUTH-USER-UUID', 'BTNT Administrator', 'admin', true);
   ```

5. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the local environment or Vercel **Preview** environment. Do not add a service-role key to the browser app.
6. Verify active staff can read data and create records, while non-staff/anonymous users cannot. Complete the checklist in `supabase/tests/README.md` before using any real customer balances.

Active staff can read accounts and create bills/payments. Only admin/accountant roles can post ledger adjustments; role-based restrictions beyond this are not yet implemented.

## How the accounts are calculated

All values are calculated in the database from signed ledger entries—never by manually overwriting a customer balance.

- **Net balance** = opening due + travel bills + positive charge adjustments − recorded payments − opening advance − credit adjustments.
- **Due balance** = the greater of net balance or zero.
- **Customer advance** = the greater of negative net balance or zero.
- **Invoice outstanding** = invoice amount − allocations posted to that invoice, never below zero.
- **Payment allocation** runs FIFO over the oldest outstanding bill by bill date, then creation timestamp, then ID. Any payment remainder not used by open bills stays as advance and is auto-applied to later bills.
- **Opening due and opening advance** are separate entries. If both are supplied at customer creation, the advance is allocated against the opening-due bill first, up to the due amount.
- **Retry safety** uses a unique operation key plus a payload fingerprint. Concurrent retries are serialized; repeating identical details returns the original record, while reusing a key with different details is rejected.
- **Correction safety**: a positive adjustment creates a distinct charge bill so later payments can settle it. A negative adjustment creates a ledger credit and allocates it FIFO. Bills and payments themselves cannot yet be reversed from the UI; do not delete/edit their financial rows manually.

## Accounting rules

- Positive ledger entries mean the customer owes the business; negative entries mean payments/advances.
- Opening due is stored as an opening-balance bill; opening advance is stored as a negative ledger credit.
- Bill/payment records and ledger entries are created together in a database transaction.
- Payments apply FIFO to outstanding invoices. Amounts beyond current due remain as advance credit.
- Existing credits are applied FIFO when a new bill is created.
- Financial rows are not directly editable from the browser. Use audited adjustments; bill/payment reversal actions are not yet implemented.
- Every create RPC requires an operation key; a retry with identical arguments returns the original record, while reusing a key with different arguments is rejected.

## Release checklist

- [ ] Confirm target Supabase project and existing schema.
- [ ] Apply migration on an isolated test project/branch.
- [ ] Verify RLS and active-staff access.
- [ ] Run FIFO/idempotency/concurrency/reconciliation scenarios.
- [ ] Verify opening due + advance, payments, later bills, and print invoice.
- [ ] Configure a Vercel Preview deployment and environment variables.
- [ ] Review migration diff and backup/rollback strategy before production rollout.

No Supabase migration has been run and no Vercel deployment is claimed by this repository commit.
