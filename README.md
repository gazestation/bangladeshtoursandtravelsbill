# Bangladesh Tours & Travels Bill Book

A clean-room foundation for a customer, ticket bill, due balance, payment, and printable invoice application.

## Status

This repository is being initialised. Production Supabase/Vercel connections are not assumed or changed by this commit.

## Planned stack

- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase Auth and Postgres
- Printable PDF invoices and WhatsApp sharing

## Accounting safety principles

- Opening due and opening advance are explicit, separate balances.
- Bills and payments are recorded as immutable financial events; corrections use reversal/adjustment entries.
- Customer balance is reconciled from ledger entries, not manually overwritten.
- Bill/payment creation must be transactional and idempotent.
- Do not run database migrations against production until the target project and existing schema are verified.